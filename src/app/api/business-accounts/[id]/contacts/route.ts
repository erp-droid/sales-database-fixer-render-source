export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  createContact,
  fetchBusinessAccountById,
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import { buildContactCreatePayload } from "@/lib/business-account-create";
import {
  buildAccountRowsFromRawAccount,
  fetchContactMergeServerContext,
  setBusinessAccountPrimaryContact,
} from "@/lib/contact-merge-server";
import { logContactCreateAudit } from "@/lib/audit-log-store";
import { resolveStoredDeferredActionActor } from "@/lib/deferred-action-actor";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { appendLocalContactRow } from "@/lib/local-account-rows";
import {
  readStoredBusinessAccountRowsFromReadModel,
  replaceReadModelAccountRows,
} from "@/lib/read-model/accounts";
import {
  applyLocalAccountMetadataToRow,
  applyLocalAccountMetadataToRows,
} from "@/lib/read-model/account-local-metadata";
import type {
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import { parseBusinessAccountContactCreatePayload } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function readBusinessAccountId(rawAccount: unknown): string | null {
  return (
    readWrappedString(rawAccount, "BusinessAccountID") ||
    readWrappedString(rawAccount, "BAccountID") ||
    readWrappedString(rawAccount, "AccountCD") ||
    null
  );
}

function readBusinessAccountName(rawAccount: unknown): string {
  return (
    readWrappedString(rawAccount, "Name") ||
    readWrappedString(rawAccount, "CompanyName") ||
    ""
  );
}

function includesNoEntitySatisfiesMessage(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return value.toLowerCase().includes("no entity satisfies the condition");
}

function shouldFallbackToLocalContactCreate(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  if (includesNoEntitySatisfiesMessage(error.message)) {
    return true;
  }

  const details = error.details;
  if (!details || typeof details !== "object") {
    return false;
  }

  const record = details as Record<string, unknown>;
  return [
    record.message,
    record.Message,
    record.error,
    record.Error,
    record.exceptionMessage,
    record.ExceptionMessage,
  ].some(includesNoEntitySatisfiesMessage);
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };
  let actor: ReturnType<typeof resolveStoredDeferredActionActor> | null = null;
  let contactRequest: ReturnType<typeof parseBusinessAccountContactCreatePayload> | null = null;
  let auditBusinessAccountRecordId: string | null = null;
  let auditBusinessAccountId: string | null = null;
  let auditCompanyName: string | null = null;

  try {
    requireAuthCookieValue(request);
    actor = resolveStoredDeferredActionActor(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    contactRequest = parseBusinessAccountContactCreatePayload(body);
    const storedRows = readStoredBusinessAccountRowsFromReadModel(id);
    const storedAnchorRow = storedRows[0] ?? null;
    if (storedAnchorRow) {
      auditBusinessAccountRecordId = storedAnchorRow.accountRecordId ?? storedAnchorRow.id;
      auditBusinessAccountId = storedAnchorRow.businessAccountId;
      auditCompanyName = storedAnchorRow.companyName;
    }

    if (storedRows.length === 0) {
      throw new HttpError(
        404,
        "Business account is not in the local database. Reload the account and try again.",
      );
    }

    const localBusinessAccountRecordId =
      storedAnchorRow?.accountRecordId ?? storedAnchorRow?.id ?? id;
    const localBusinessAccountId = storedAnchorRow?.businessAccountId?.trim() ?? "";
    if (!localBusinessAccountId) {
      throw new HttpError(
        422,
        "Business account ID is missing on this local account. Contact creation cannot continue.",
      );
    }

    const localContact = appendLocalContactRow(storedRows, contactRequest);
    const responseBody: BusinessAccountContactCreateResponse = {
      created: true,
      businessAccountRecordId: localBusinessAccountRecordId,
      businessAccountId: localBusinessAccountId,
      contactId: localContact.contactId,
      accountRows: localContact.rows,
      createdRow: localContact.createdRow,
      setAsPrimary: true,
      warnings: ["Saved locally."],
    };

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(
        localBusinessAccountRecordId,
        responseBody.accountRows,
      );
    }

    logContactCreateAudit({
      actor,
      request: contactRequest,
      resultCode: "succeeded",
      businessAccountRecordId: responseBody.businessAccountRecordId,
      businessAccountId: responseBody.businessAccountId,
      companyName: responseBody.createdRow.companyName,
      contactId: responseBody.contactId,
      createdRow: responseBody.createdRow,
    });

    const response = NextResponse.json(
      {
        ...responseBody,
        accountRows: applyLocalAccountMetadataToRows(responseBody.accountRows),
        createdRow:
          applyLocalAccountMetadataToRow(responseBody.createdRow) ??
          responseBody.createdRow,
      },
      { status: 201 },
    );
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;

  } catch (error) {
    if (actor && contactRequest) {
      logContactCreateAudit({
        actor,
        request: contactRequest,
        resultCode: "failed",
        businessAccountRecordId: auditBusinessAccountRecordId,
        businessAccountId: auditBusinessAccountId,
        companyName: auditCompanyName,
      });
    }

    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid contact create payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
