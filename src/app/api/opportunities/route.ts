export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  createOpportunity,
  readOpportunityId,
  readWrappedNumber,
  readWrappedString,
  type RawBusinessAccount,
} from "@/lib/acumatica";
import {
  buildOpportunityCreateOptions,
  buildOpportunityCreatePayload,
  isOpportunityOwnerNotFoundErrorMessage,
  resolveOpportunityLocation,
} from "@/lib/opportunity-create";
import { fetchContactMergeServerContext } from "@/lib/contact-merge-server";
import { normalizeRawBusinessAccountForMerge } from "@/lib/contact-merge";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { parseOpportunityCreatePayload } from "@/lib/validation";
import type { OpportunityCreateResponse } from "@/types/opportunity-create";

function readAccountContacts(rawAccount: RawBusinessAccount): Array<Record<string, unknown>> {
  const directContacts = rawAccount.Contacts;
  if (Array.isArray(directContacts)) {
    return directContacts as Array<Record<string, unknown>>;
  }

  if (
    directContacts &&
    typeof directContacts === "object" &&
    Array.isArray((directContacts as { value?: unknown[] }).value)
  ) {
    return ((directContacts as { value?: unknown[] }).value ?? []) as Array<Record<string, unknown>>;
  }

  return [];
}

function readContactDisplayName(record: unknown): string | null {
  const explicit =
    readWrappedString(record, "DisplayName") ||
    readWrappedString(record, "FullName") ||
    readWrappedString(record, "ContactName") ||
    readWrappedString(record, "Attention");
  if (explicit) {
    return explicit;
  }

  const composite = [
    readWrappedString(record, "FirstName"),
    readWrappedString(record, "MiddleName"),
    readWrappedString(record, "LastName"),
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
    .trim();

  return composite || null;
}

function readContactName(
  rawAccount: RawBusinessAccount,
  contactId: number,
): string | null {
  for (const contact of readAccountContacts(rawAccount)) {
    if (readWrappedNumber(contact, "ContactID") === contactId) {
      return readContactDisplayName(contact);
    }
  }

  return null;
}

function readCompanyName(rawAccount: RawBusinessAccount): string | null {
  return (
    readWrappedString(rawAccount, "Name") ||
    readWrappedString(rawAccount, "CompanyName") ||
    readWrappedString(rawAccount, "AcctName")
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const opportunityRequest = parseOpportunityCreatePayload(body);

    const context = await fetchContactMergeServerContext(
      cookieValue,
      opportunityRequest.businessAccountRecordId,
      authCookieRefresh,
    );
    const account = normalizeRawBusinessAccountForMerge(context.rawAccountWithContacts);

    if (!account.businessAccountId) {
      throw new HttpError(
        422,
        "Business account ID is missing on this account. Opportunity creation cannot continue.",
      );
    }

    if (account.businessAccountId !== opportunityRequest.businessAccountId) {
      throw new HttpError(
        422,
        "The selected account no longer matches the current business account record.",
      );
    }

    if (!account.contactIds.has(opportunityRequest.contactId)) {
      throw new HttpError(
        422,
        "The selected contact no longer belongs to this business account.",
      );
    }

    const opportunityDefaults = buildOpportunityCreateOptions();
    const normalizedOpportunityRequest = {
      ...opportunityRequest,
      stage: opportunityDefaults.defaultStage,
      location:
        resolveOpportunityLocation(context.rawAccountWithContacts) ||
        opportunityDefaults.defaultLocation ||
        opportunityRequest.location,
    };

    const createWithOwnerValue = async (
      ownerValue: string | null | undefined,
    ): Promise<Record<string, unknown>> => {
      const payload = buildOpportunityCreatePayload({
        request: normalizedOpportunityRequest,
        ownerValue,
      });

      return await createOpportunity(cookieValue, payload, authCookieRefresh);
    };

    const primaryOwnerValue =
      normalizedOpportunityRequest.ownerName ?? normalizedOpportunityRequest.ownerId;
    let createdOpportunity: Record<string, unknown>;

    try {
      createdOpportunity = await createWithOwnerValue(primaryOwnerValue);
    } catch (error) {
      if (
        normalizedOpportunityRequest.ownerId &&
        normalizedOpportunityRequest.ownerName &&
        primaryOwnerValue !== normalizedOpportunityRequest.ownerId &&
        error instanceof HttpError &&
        isOpportunityOwnerNotFoundErrorMessage(error.message)
      ) {
        createdOpportunity = await createWithOwnerValue(normalizedOpportunityRequest.ownerId);
      } else {
        throw error;
      }
    }

    const opportunityId = readOpportunityId(createdOpportunity);
    if (!opportunityId) {
      throw new HttpError(
        502,
        "Acumatica created the opportunity but did not return an Opportunity ID.",
      );
    }

    const responseBody: OpportunityCreateResponse = {
      created: true,
      opportunityId,
      businessAccountRecordId: context.resolvedRecordId,
      businessAccountId: account.businessAccountId,
      companyName: readCompanyName(context.rawAccountWithContacts),
      contactId: normalizedOpportunityRequest.contactId,
      contactName: readContactName(
        context.rawAccountWithContacts,
        normalizedOpportunityRequest.contactId,
      ),
      subject: normalizedOpportunityRequest.subject,
      ownerId: normalizedOpportunityRequest.ownerId,
      ownerName: normalizedOpportunityRequest.ownerName,
      warnings: [],
    };

    const response = NextResponse.json(responseBody, { status: 201 });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid opportunity create payload",
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
