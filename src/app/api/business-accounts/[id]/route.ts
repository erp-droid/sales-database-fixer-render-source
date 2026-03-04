import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  type AuthCookieRefreshState,
  fetchBusinessAccountById,
  fetchContactById,
  updateBusinessAccount,
  updateContact,
} from "@/lib/acumatica";
import {
  buildBusinessAccountUpdatePayload,
  buildPrimaryContactUpdatePayload,
  hasAddressChanges,
  hasPrimaryContactChanges,
  normalizeBusinessAccount,
  withPrimaryContact,
} from "@/lib/business-accounts";
import {
  shouldValidateWithAddressComplete,
  validateCanadianAddress,
} from "@/lib/address-complete";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { parseUpdatePayload } from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveBusinessAccountRecordId(rawAccount: unknown, fallbackId: string): string {
  if (rawAccount && typeof rawAccount === "object") {
    const rawId = (rawAccount as Record<string, unknown>).id;
    if (typeof rawId === "string" && rawId.trim()) {
      return rawId.trim();
    }

    const noteId = readWrappedString(rawAccount, "NoteID");
    if (noteId) {
      return noteId;
    }
  }

  return fallbackId;
}

function buildBusinessAccountIdentityPayload(rawAccount: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (rawAccount && typeof rawAccount === "object") {
    const rawId = (rawAccount as Record<string, unknown>).id;
    if (typeof rawId === "string" && rawId.trim()) {
      payload.id = rawId.trim();
    }

    const noteId = readWrappedString(rawAccount, "NoteID");
    if (noteId) {
      payload.NoteID = {
        value: noteId,
      };
    }

    const businessAccountId =
      readWrappedString(rawAccount, "BusinessAccountID") ??
      readWrappedString(rawAccount, "BAccountID") ??
      readWrappedString(rawAccount, "AccountCD");
    if (businessAccountId) {
      payload.BusinessAccountID = {
        value: businessAccountId,
      };
    }
  }

  return payload;
}

function buildBusinessAccountUpdateIdentifiers(
  rawAccount: unknown,
  fallbackId: string,
): string[] {
  const rawId =
    rawAccount && typeof rawAccount === "object" && typeof (rawAccount as Record<string, unknown>).id === "string"
      ? ((rawAccount as Record<string, unknown>).id as string).trim()
      : "";

  const businessAccountId =
    readWrappedString(rawAccount, "BusinessAccountID") ??
    readWrappedString(rawAccount, "BAccountID") ??
    readWrappedString(rawAccount, "AccountCD");
  const noteId = readWrappedString(rawAccount, "NoteID");

  return [
    businessAccountId ?? "",
    rawId,
    noteId ?? "",
    fallbackId,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

async function normalizeWithContactNotes(
  cookieValue: string,
  rawAccount: unknown,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ReturnType<typeof normalizeBusinessAccount>> {
  const baseRow = normalizeBusinessAccount(rawAccount);
  if (!baseRow.primaryContactId) {
    return baseRow;
  }

  try {
    const rawContact = await fetchContactById(
      cookieValue,
      baseRow.primaryContactId,
      authCookieRefresh,
    );
    return normalizeBusinessAccount(withPrimaryContact(rawAccount, rawContact));
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      throw error;
    }

    // Do not fail account detail reads when contact enrichment is unavailable.
    // The account payload still contains the core values needed by the UI.
    if (error instanceof HttpError && error.status === 404) {
      return baseRow;
    }

    return baseRow;
  }
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };
  let cookieValue: string | null = null;

  try {
    const { id } = await context.params;
    cookieValue = requireAuthCookieValue(request);
    const rawAccount = await fetchBusinessAccountById(cookieValue, id, authCookieRefresh);
    const normalized = await normalizeWithContactNotes(
      cookieValue,
      rawAccount,
      authCookieRefresh,
    );

    const response = NextResponse.json({ row: normalized });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (requestError) {
    const { id } = await context.params;
    let error = requestError;

    if (
      error instanceof HttpError &&
      error.status === 401 &&
      cookieValue
    ) {
      const retryAuthCookieRefresh = {
        value: null as string | null,
      };
      const retryCookieValue = authCookieRefresh.value ?? cookieValue;
      try {
        const rawAccount = await fetchBusinessAccountById(
          retryCookieValue,
          id,
          retryAuthCookieRefresh,
        );
        const normalized = await normalizeWithContactNotes(
          retryCookieValue,
          rawAccount,
          retryAuthCookieRefresh,
        );

        const response = NextResponse.json({ row: normalized });
        if (retryAuthCookieRefresh.value) {
          setAuthCookie(response, retryAuthCookieRefresh.value);
        } else if (authCookieRefresh.value) {
          setAuthCookie(response, authCookieRefresh.value);
        }
        return response;
      } catch (retryError) {
        error = retryError;
        if (retryAuthCookieRefresh.value) {
          authCookieRefresh.value = retryAuthCookieRefresh.value;
        }
      }
    }

    let response: NextResponse;
    if (error instanceof HttpError) {
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

export async function PUT(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const { id } = await context.params;
    const cookieValue = requireAuthCookieValue(request);

    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });

    const updateRequest = parseUpdatePayload(body);

    const currentRaw = await fetchBusinessAccountById(cookieValue, id, authCookieRefresh);
    const resolvedRecordId = resolveBusinessAccountRecordId(currentRaw, id);
    const updateIdentifiers = buildBusinessAccountUpdateIdentifiers(currentRaw, id);
    const current = await normalizeWithContactNotes(
      cookieValue,
      currentRaw,
      authCookieRefresh,
    );
    const currentRow = current;

    if (
      updateRequest.expectedLastModified &&
      currentRow.lastModifiedIso &&
      updateRequest.expectedLastModified !== currentRow.lastModifiedIso
    ) {
      return NextResponse.json(
        {
          error:
            "This record was modified in Acumatica after you loaded it. Reload and try again.",
        },
        { status: 409 },
      );
    }

    const contactWasEdited = hasPrimaryContactChanges(currentRow, updateRequest);
    const addressWasEdited = hasAddressChanges(currentRow, updateRequest);

    let effectiveUpdateRequest = updateRequest;
    if (addressWasEdited && shouldValidateWithAddressComplete(updateRequest)) {
      const normalizedAddress = await validateCanadianAddress(updateRequest);
      effectiveUpdateRequest = {
        ...updateRequest,
        ...normalizedAddress,
      };
    }

    if (effectiveUpdateRequest.salesRepName && !effectiveUpdateRequest.salesRepId) {
      return NextResponse.json(
        {
          error:
            "Select a valid Sales Rep from the employee list before saving.",
        },
        { status: 422 },
      );
    }

    if (!effectiveUpdateRequest.salesRepId && !effectiveUpdateRequest.salesRepName) {
      effectiveUpdateRequest = {
        ...effectiveUpdateRequest,
        salesRepId: currentRow.salesRepId,
        salesRepName: currentRow.salesRepName,
      };
    }

    if (contactWasEdited && !currentRow.primaryContactId) {
      return NextResponse.json(
        {
          error:
            "Primary contact is missing on this account. Contact fields are read-only until a primary contact exists in Acumatica.",
        },
        { status: 422 },
      );
    }

    const accountPayload = buildBusinessAccountUpdatePayload(
      currentRaw,
      effectiveUpdateRequest,
    );
    const identityPayload = buildBusinessAccountIdentityPayload(currentRaw);
    await updateBusinessAccount(
      cookieValue,
      updateIdentifiers,
      {
        ...identityPayload,
        ...accountPayload,
      },
      authCookieRefresh,
    );

    if (contactWasEdited && currentRow.primaryContactId) {
      const contactPayload = buildPrimaryContactUpdatePayload(effectiveUpdateRequest);
      await updateContact(
        cookieValue,
        currentRow.primaryContactId,
        contactPayload,
        authCookieRefresh,
      );
    }

    const refreshedRaw = await fetchBusinessAccountById(
      cookieValue,
      resolvedRecordId,
      authCookieRefresh,
    );
    const refreshed = await normalizeWithContactNotes(
      cookieValue,
      refreshedRaw,
      authCookieRefresh,
    );

    const response = NextResponse.json(refreshed);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid update payload",
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
