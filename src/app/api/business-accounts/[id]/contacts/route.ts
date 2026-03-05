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
import { HttpError, getErrorMessage } from "@/lib/errors";
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

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const contactRequest = parseBusinessAccountContactCreatePayload(body);

    const serverContext = await fetchContactMergeServerContext(
      cookieValue,
      id,
      authCookieRefresh,
    );
    const currentRawAccount = serverContext.rawAccount;
    const businessAccountId = readBusinessAccountId(currentRawAccount);
    if (!businessAccountId) {
      throw new HttpError(
        422,
        "Business account ID is missing on this account. Contact creation cannot continue.",
      );
    }

    const createdContact = await createContact(
      cookieValue,
      buildContactCreatePayload({
        request: contactRequest,
        businessAccountId,
        companyName: readBusinessAccountName(currentRawAccount),
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
      const response = NextResponse.json(responseBody, { status: 409 });
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
