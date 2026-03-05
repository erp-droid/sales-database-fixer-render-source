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
  normalizeBusinessAccountRows,
  sanitizeNullableInput,
  withPrimaryContact,
} from "@/lib/business-accounts";
import {
  shouldValidateWithAddressComplete,
  validateCanadianAddress,
} from "@/lib/address-complete";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { normalizePhoneForSave } from "@/lib/phone";
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

function readWrappedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readPrimaryContactIdFromRawAccount(rawAccount: unknown): number | null {
  if (!rawAccount || typeof rawAccount !== "object") {
    return null;
  }

  const primary = (rawAccount as Record<string, unknown>).PrimaryContact;
  return (
    readWrappedNumber(primary, "ContactID") ??
    readWrappedNumber(rawAccount, "PrimaryContactID") ??
    readWrappedNumber(rawAccount, "MainContactID")
  );
}

function buildPrimaryContactFallbackPayloads(
  rawAccount: unknown,
  targetContactId: number,
): Array<Record<string, unknown>> {
  const primaryRecordId =
    rawAccount && typeof rawAccount === "object"
      ? (() => {
          const primary = (rawAccount as Record<string, unknown>).PrimaryContact;
          if (!primary || typeof primary !== "object") {
            return null;
          }
          const rawId = (primary as Record<string, unknown>).id;
          return typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
        })()
      : null;

  return [
    {
      PrimaryContact: {
        ...(primaryRecordId ? { id: primaryRecordId } : {}),
        ContactID: {
          value: targetContactId,
        },
      },
    },
    {
      PrimaryContact: {
        value: String(targetContactId),
      },
    },
    {
      MainContact: {
        value: String(targetContactId),
      },
    },
    {
      MainContact: {
        ContactID: {
          value: targetContactId,
        },
      },
    },
    {
      PrimaryContactID: {
        value: targetContactId,
      },
    },
    {
      MainContactID: {
        value: targetContactId,
      },
    },
  ];
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
    const normalizedRows = normalizeBusinessAccountRows(rawAccount);

    const response = NextResponse.json({ row: normalized, rows: normalizedRows });
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
        const normalizedRows = normalizeBusinessAccountRows(rawAccount);

        const response = NextResponse.json({ row: normalized, rows: normalizedRows });
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
    const currentAccountRow = current;

    const requestedTargetContactId = updateRequest.targetContactId;
    const effectiveTargetContactId =
      requestedTargetContactId ??
      currentAccountRow.contactId ??
      currentAccountRow.primaryContactId;

    let currentRowForContactComparison = currentAccountRow;
    if (effectiveTargetContactId !== null) {
      try {
        const currentTargetContact = await fetchContactById(
          cookieValue,
          effectiveTargetContactId,
          authCookieRefresh,
        );
        const normalizedTargetRow = normalizeBusinessAccount(
          withPrimaryContact(currentRaw, currentTargetContact),
        );
        currentRowForContactComparison = {
          ...currentAccountRow,
          ...normalizedTargetRow,
          id: currentAccountRow.id,
          accountRecordId: currentAccountRow.accountRecordId ?? currentAccountRow.id,
          rowKey: `${currentAccountRow.accountRecordId ?? currentAccountRow.id}:contact:${effectiveTargetContactId}`,
          contactId: effectiveTargetContactId,
          isPrimaryContact:
            currentAccountRow.primaryContactId !== null &&
            currentAccountRow.primaryContactId === effectiveTargetContactId,
          primaryContactId: currentAccountRow.primaryContactId,
        };
      } catch (contactError) {
        if (
          contactError instanceof HttpError &&
          (contactError.status === 401 || contactError.status === 403)
        ) {
          throw contactError;
        }
      }
    }

    if (
      updateRequest.expectedLastModified &&
      currentAccountRow.lastModifiedIso &&
      updateRequest.expectedLastModified !== currentAccountRow.lastModifiedIso
    ) {
      return NextResponse.json(
        {
          error:
            "This record was modified in Acumatica after you loaded it. Reload and try again.",
        },
        { status: 409 },
      );
    }

    const contactWasEdited = hasPrimaryContactChanges(
      currentRowForContactComparison,
      updateRequest,
    );
    const addressWasEdited = hasAddressChanges(currentAccountRow, updateRequest);

    let effectiveUpdateRequest = updateRequest;
    const submittedPhoneChanged =
      sanitizeNullableInput(updateRequest.primaryContactPhone) !==
      sanitizeNullableInput(currentRowForContactComparison.primaryContactPhone);

    if (submittedPhoneChanged) {
      const normalizedPhone = normalizePhoneForSave(updateRequest.primaryContactPhone);
      if (updateRequest.primaryContactPhone !== null && normalizedPhone === null) {
        return NextResponse.json(
          {
            error: "Primary contact phone must use the format ###-###-####.",
          },
          { status: 422 },
        );
      }

      effectiveUpdateRequest = {
        ...effectiveUpdateRequest,
        primaryContactPhone: normalizedPhone,
      };
    }

    if (addressWasEdited && shouldValidateWithAddressComplete(updateRequest)) {
      const normalizedAddress = await validateCanadianAddress(updateRequest);
      effectiveUpdateRequest = {
        ...updateRequest,
        primaryContactPhone: effectiveUpdateRequest.primaryContactPhone,
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
        salesRepId: currentAccountRow.salesRepId,
        salesRepName: currentAccountRow.salesRepName,
      };
    }

    if (effectiveUpdateRequest.setAsPrimaryContact && effectiveTargetContactId === null) {
      return NextResponse.json(
        {
          error:
            "This row has no contact ID, so it cannot be set as primary.",
        },
        { status: 422 },
      );
    }

    if (contactWasEdited && effectiveTargetContactId === null) {
      return NextResponse.json(
        {
          error:
            "Contact ID is missing on this row. Contact fields cannot be saved until the contact exists in Acumatica.",
        },
        { status: 422 },
      );
    }

    const accountPayload = buildBusinessAccountUpdatePayload(
      currentRaw,
      {
        ...effectiveUpdateRequest,
        targetContactId: effectiveTargetContactId,
      },
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

    if (effectiveUpdateRequest.setAsPrimaryContact && effectiveTargetContactId !== null) {
      let primaryVerificationRaw = await fetchBusinessAccountById(
        cookieValue,
        resolvedRecordId,
        authCookieRefresh,
      );
      let verifiedPrimaryContactId = readPrimaryContactIdFromRawAccount(primaryVerificationRaw);

      if (verifiedPrimaryContactId !== effectiveTargetContactId) {
        const fallbackPayloads = buildPrimaryContactFallbackPayloads(
          primaryVerificationRaw,
          effectiveTargetContactId,
        );

        for (const fallbackPayload of fallbackPayloads) {
          await updateBusinessAccount(
            cookieValue,
            updateIdentifiers,
            {
              ...identityPayload,
              ...fallbackPayload,
            },
            authCookieRefresh,
          );

          primaryVerificationRaw = await fetchBusinessAccountById(
            cookieValue,
            resolvedRecordId,
            authCookieRefresh,
          );
          verifiedPrimaryContactId = readPrimaryContactIdFromRawAccount(primaryVerificationRaw);

          if (verifiedPrimaryContactId === effectiveTargetContactId) {
            break;
          }
        }
      }

      if (verifiedPrimaryContactId !== effectiveTargetContactId) {
        return NextResponse.json(
          {
            error:
              "Acumatica accepted the update but did not switch the primary contact. Please sync records and try again.",
          },
          { status: 422 },
        );
      }
    }

    if (contactWasEdited && effectiveTargetContactId !== null) {
      const contactPayload = buildPrimaryContactUpdatePayload(effectiveUpdateRequest);
      await updateContact(
        cookieValue,
        effectiveTargetContactId,
        contactPayload,
        authCookieRefresh,
      );
    }

    const refreshedRaw = await fetchBusinessAccountById(
      cookieValue,
      resolvedRecordId,
      authCookieRefresh,
    );
    const refreshedAccountRow = await normalizeWithContactNotes(
      cookieValue,
      refreshedRaw,
      authCookieRefresh,
    );

    let responseRow = refreshedAccountRow;
    const responseTargetContactId =
      effectiveTargetContactId ?? refreshedAccountRow.primaryContactId;
    if (responseTargetContactId !== null) {
      try {
        const refreshedTargetContact = await fetchContactById(
          cookieValue,
          responseTargetContactId,
          authCookieRefresh,
        );
        const normalizedTargetRow = normalizeBusinessAccount(
          withPrimaryContact(refreshedRaw, refreshedTargetContact),
        );
        responseRow = {
          ...refreshedAccountRow,
          ...normalizedTargetRow,
          id: refreshedAccountRow.id,
          accountRecordId: refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id,
          rowKey: `${refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id}:contact:${responseTargetContactId}`,
          contactId: responseTargetContactId,
          isPrimaryContact:
            refreshedAccountRow.primaryContactId !== null &&
            refreshedAccountRow.primaryContactId === responseTargetContactId,
          primaryContactId: refreshedAccountRow.primaryContactId,
        };
      } catch (contactError) {
        if (
          contactError instanceof HttpError &&
          (contactError.status === 401 || contactError.status === 403)
        ) {
          throw contactError;
        }
      }
    }

    const response = NextResponse.json(responseRow);
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
