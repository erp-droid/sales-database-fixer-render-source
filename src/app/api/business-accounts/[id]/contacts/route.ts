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
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
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
  let actor: Awaited<ReturnType<typeof resolveDeferredActionActor>> | null = null;
  let contactRequest: ReturnType<typeof parseBusinessAccountContactCreatePayload> | null = null;
  let auditBusinessAccountRecordId: string | null = null;
  let auditBusinessAccountId: string | null = null;
  let auditCompanyName: string | null = null;

  try {
    const cookieValue = requireAuthCookieValue(request);
    actor = await resolveDeferredActionActor(request, cookieValue, authCookieRefresh);
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

    if (getEnv().LOCAL_DATABASE_ONLY) {
      if (storedRows.length === 0) {
        throw new HttpError(
          404,
          "Business account is not in the local SQLite snapshot. Reload the account and try again.",
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
        warnings: ["Saved in Sales MeadowBrook only. Acumatica contact creation is disabled."],
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
    }

    let serverContext: Awaited<ReturnType<typeof fetchContactMergeServerContext>>;
    try {
      serverContext = await fetchContactMergeServerContext(
        cookieValue,
        id,
        authCookieRefresh,
      );
    } catch (error) {
      const canFallback =
        storedRows.length > 0 && shouldFallbackToLocalContactCreate(error);
      if (!canFallback) {
        throw error;
      }

      const fallbackBusinessAccountRecordId =
        storedAnchorRow?.accountRecordId ?? storedAnchorRow?.id ?? id;
      const fallbackBusinessAccountId = storedAnchorRow?.businessAccountId?.trim() ?? "";
      if (!fallbackBusinessAccountId) {
        throw new HttpError(
          422,
          "Business account ID is missing on this local account. Contact creation cannot continue.",
        );
      }

      const localContact = appendLocalContactRow(storedRows, contactRequest);
      const responseBody: BusinessAccountContactCreateResponse = {
        created: true,
        businessAccountRecordId: fallbackBusinessAccountRecordId,
        businessAccountId: fallbackBusinessAccountId,
        contactId: localContact.contactId,
        accountRows: localContact.rows,
        createdRow: localContact.createdRow,
        setAsPrimary: true,
        warnings: [
          "Saved in Sales MeadowBrook only. This account is not currently available in Acumatica.",
        ],
      };

      if (getEnv().READ_MODEL_ENABLED) {
        replaceReadModelAccountRows(
          fallbackBusinessAccountRecordId,
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
    }
    const currentRawAccount = serverContext.rawAccount;
    const businessAccountId = readBusinessAccountId(currentRawAccount);
    if (!businessAccountId) {
      throw new HttpError(
        422,
        "Business account ID is missing on this account. Contact creation cannot continue.",
      );
    }
    auditBusinessAccountRecordId = serverContext.resolvedRecordId;
    auditBusinessAccountId = businessAccountId;
    auditCompanyName = readBusinessAccountName(currentRawAccount);

    const createdContact = await createContact(
      cookieValue,
      buildContactCreatePayload({
        request: contactRequest,
        businessAccountId,
      }),
      authCookieRefresh,
    );

    const contactId = readWrappedNumber(createdContact, "ContactID");
    if (!contactId) {
      throw new HttpError(
        502,
        "Acumatica created the contact but did not return a Contact ID.",
      );
    }

    try {
      await setBusinessAccountPrimaryContact(
        cookieValue,
        serverContext,
        contactId,
        authCookieRefresh,
        createdContact,
      );
    } catch (error) {
      let refreshedRawAccount = currentRawAccount;
      try {
        refreshedRawAccount = await fetchBusinessAccountById(
          cookieValue,
          serverContext.resolvedRecordId,
          authCookieRefresh,
        );
      } catch {
        // Keep existing account state if refresh fails after a partial completion.
      }

      const refreshedRows = buildAccountRowsFromRawAccount(refreshedRawAccount);
      const responseBody: BusinessAccountContactCreatePartialResponse = {
        created: false,
        partial: true,
        businessAccountRecordId: serverContext.resolvedRecordId,
        businessAccountId,
        contactId,
        accountRows: refreshedRows,
        error:
          error instanceof HttpError
            ? error.message
            : "Contact was created, but the primary contact switch failed.",
      };
      if (getEnv().READ_MODEL_ENABLED) {
        replaceReadModelAccountRows(serverContext.resolvedRecordId, refreshedRows);
      }
      logContactCreateAudit({
        actor,
        request: contactRequest,
        resultCode: "partial",
        businessAccountRecordId: serverContext.resolvedRecordId,
        businessAccountId,
        companyName: auditCompanyName,
        contactId,
        createdRow: refreshedRows.find((row) => row.contactId === contactId) ?? null,
      });
      const response = NextResponse.json(
        {
          ...responseBody,
          accountRows: applyLocalAccountMetadataToRows(responseBody.accountRows),
        },
        { status: 409 },
      );
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      return response;
    }

    const refreshedRawAccount = await fetchBusinessAccountById(
      cookieValue,
      serverContext.resolvedRecordId,
      authCookieRefresh,
    );
    const accountRows = buildAccountRowsFromRawAccount(refreshedRawAccount);
    const createdRow =
      accountRows.find((row) => row.contactId === contactId) ?? accountRows[0];

    if (!createdRow) {
      throw new HttpError(
        502,
        "Contact was created, but the app could not normalize the refreshed account rows.",
      );
    }

    const responseBody: BusinessAccountContactCreateResponse = {
      created: true,
      businessAccountRecordId: serverContext.resolvedRecordId,
      businessAccountId,
      contactId,
      accountRows,
      createdRow,
      setAsPrimary: true,
      warnings: [],
    };

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(serverContext.resolvedRecordId, accountRows);
    }

    logContactCreateAudit({
      actor,
      request: contactRequest,
      resultCode: "succeeded",
      businessAccountRecordId: responseBody.businessAccountRecordId,
      businessAccountId: responseBody.businessAccountId,
      companyName: createdRow.companyName,
      contactId,
      createdRow,
    });

    const response = NextResponse.json(
      {
        ...responseBody,
        accountRows: applyLocalAccountMetadataToRows(responseBody.accountRows),
        createdRow: applyLocalAccountMetadataToRow(responseBody.createdRow) ?? responseBody.createdRow,
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
