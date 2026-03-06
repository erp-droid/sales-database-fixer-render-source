export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { BusinessAccountRow } from "@/types/business-account";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  type AuthCookieRefreshState,
  fetchBusinessAccountById,
  fetchContactById,
  invokeBusinessAccountAction,
  updateBusinessAccount,
  updateContact,
} from "@/lib/acumatica";
import {
  buildPrimaryContactFallbackPayloads,
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
  buildPrimaryOnlyUpdateRequest,
  isPrimaryOnlyConflictRetryAllowed,
  isPrimaryOnlyUpdate,
} from "@/lib/business-account-update";
import { setBusinessAccountPrimaryContact } from "@/lib/contact-merge-server";
import {
  shouldValidateWithAddressComplete,
  validateCanadianAddress,
} from "@/lib/address-complete";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { normalizePhoneForSave } from "@/lib/phone";
import {
  readBusinessAccountDetailFromReadModel,
  replaceReadModelAccountRows,
} from "@/lib/read-model/accounts";
import { maybeTriggerReadModelSync } from "@/lib/read-model/sync";
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

function readContactDisplayName(record: unknown): string | null {
  const explicit =
    readWrappedString(record, "DisplayName") ??
    readWrappedString(record, "FullName") ??
    readWrappedString(record, "ContactName") ??
    readWrappedString(record, "Attention");
  if (explicit) {
    return explicit;
  }

  const first = readWrappedString(record, "FirstName") ?? "";
  const middle = readWrappedString(record, "MiddleName") ?? "";
  const last = readWrappedString(record, "LastName") ?? "";
  const composite = [first, middle, last].filter(Boolean).join(" ").trim();
  return composite || null;
}

function readContactPhone(record: unknown): string | null {
  return (
    readWrappedString(record, "Phone1") ??
    readWrappedString(record, "Phone2") ??
    readWrappedString(record, "Phone3")
  );
}

function readContactEmail(record: unknown): string | null {
  return readWrappedString(record, "Email") ?? readWrappedString(record, "EMail");
}

function buildFallbackRowFromContact(
  contact: unknown,
  fallbackId: string,
  existingRow: BusinessAccountRow | null,
): BusinessAccountRow {
  const contactId = readWrappedNumber(contact, "ContactID");
  const contactRecordId = readWrappedString(contact, "NoteID") ?? fallbackId;
  const rowId = existingRow?.id ?? contactRecordId;
  const accountRecordId = existingRow?.accountRecordId ?? contactRecordId;

  return {
    id: rowId,
    accountRecordId,
    rowKey: `${accountRecordId}:contact:${contactId ?? contactRecordId}`,
    contactId,
    isPrimaryContact: existingRow?.isPrimaryContact ?? false,
    phoneNumber: readContactPhone(contact),
    salesRepId: existingRow?.salesRepId ?? null,
    salesRepName: existingRow?.salesRepName ?? null,
    industryType: existingRow?.industryType ?? null,
    subCategory: existingRow?.subCategory ?? null,
    companyRegion: existingRow?.companyRegion ?? null,
    week: existingRow?.week ?? null,
    businessAccountId: readWrappedString(contact, "BusinessAccount") ?? "",
    companyName: existingRow?.companyName ?? "",
    address: existingRow?.address ?? "",
    addressLine1: existingRow?.addressLine1 ?? "",
    addressLine2: existingRow?.addressLine2 ?? "",
    city: existingRow?.city ?? "",
    state: existingRow?.state ?? "",
    postalCode: existingRow?.postalCode ?? "",
    country: existingRow?.country ?? "",
    primaryContactName: readContactDisplayName(contact),
    primaryContactPhone: readContactPhone(contact),
    primaryContactEmail: readContactEmail(contact),
    primaryContactId: contactId,
    category: existingRow?.category ?? null,
    notes: readWrappedString(contact, "note") ?? existingRow?.notes ?? null,
    lastModifiedIso:
      readWrappedString(contact, "LastModifiedDateTime") ??
      existingRow?.lastModifiedIso ??
      null,
  };
}

function buildContactAccountAssignmentPayload(
  updateRequest: ReturnType<typeof parseUpdatePayload>,
): Record<string, unknown> {
  const payload = buildPrimaryContactUpdatePayload(updateRequest);
  const assignedBusinessAccountId = sanitizeNullableInput(
    updateRequest.assignedBusinessAccountId,
  );
  const companyName = updateRequest.companyName.trim();

  return {
    ...payload,
    ...(assignedBusinessAccountId
      ? {
          BusinessAccount: {
            value: assignedBusinessAccountId,
          },
        }
      : {}),
    ...(companyName
      ? {
          CompanyName: {
            value: companyName,
          },
        }
      : {}),
  };
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
    if (getEnv().READ_MODEL_ENABLED) {
      maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
      const cached = readBusinessAccountDetailFromReadModel(id);
      if (cached) {
        const response = NextResponse.json(cached);
        if (authCookieRefresh.value) {
          setAuthCookie(response, authCookieRefresh.value);
        }
        return response;
      }
    }

    const rawAccount = await fetchBusinessAccountById(cookieValue, id, authCookieRefresh);
    const normalized = await normalizeWithContactNotes(
      cookieValue,
      rawAccount,
      authCookieRefresh,
    );
    const normalizedRows = normalizeBusinessAccountRows(rawAccount);

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(id, normalizedRows);
    }

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
  const { id } = await context.params;
  const authCookieRefresh = {
    value: null as string | null,
  };
  let cookieValue: string | null = null;
  let updateRequest: ReturnType<typeof parseUpdatePayload> | null = null;

  const executePutWithCookie = async (
    activeCookieValue: string,
    activeAuthCookieRefresh: AuthCookieRefreshState,
  ): Promise<BusinessAccountRow> => {
    if (!updateRequest) {
      throw new HttpError(500, "Update payload was not parsed.");
    }

    const cachedDetail = readBusinessAccountDetailFromReadModel(id);
    const cachedCurrentRow = cachedDetail?.row ?? null;
    const cachedTargetContactId =
      updateRequest.targetContactId ??
      cachedCurrentRow?.contactId ??
      cachedCurrentRow?.primaryContactId ??
      null;
    const requestedAssignedBusinessAccountId = sanitizeNullableInput(
      updateRequest.assignedBusinessAccountId,
    );
    const requestedAssignedBusinessAccountRecordId = sanitizeNullableInput(
      updateRequest.assignedBusinessAccountRecordId,
    );
    const currentCachedBusinessAccountId = cachedCurrentRow?.businessAccountId.trim() ?? "";
    const isOrphanContactAssignment =
      cachedCurrentRow !== null &&
      !currentCachedBusinessAccountId &&
      requestedAssignedBusinessAccountId !== null &&
      cachedTargetContactId !== null;

    if (isOrphanContactAssignment) {
      if (
        updateRequest.expectedLastModified &&
        cachedCurrentRow.lastModifiedIso &&
        updateRequest.expectedLastModified !== cachedCurrentRow.lastModifiedIso
      ) {
        throw new HttpError(
          409,
          "This record was modified in Acumatica after you loaded it. Reload and try again.",
        );
      }

      const contactPayload = buildContactAccountAssignmentPayload({
        ...updateRequest,
        targetContactId: cachedTargetContactId,
      });
      await updateContact(
        activeCookieValue,
        cachedTargetContactId,
        contactPayload,
        activeAuthCookieRefresh,
      );

      const targetIdentifier =
        requestedAssignedBusinessAccountRecordId ?? requestedAssignedBusinessAccountId;
      const refreshedTargetRaw = await fetchBusinessAccountById(
        activeCookieValue,
        targetIdentifier,
        activeAuthCookieRefresh,
      );
      const refreshedTargetRows = normalizeBusinessAccountRows(refreshedTargetRaw);
      const refreshedTargetRecordId = resolveBusinessAccountRecordId(
        refreshedTargetRaw,
        targetIdentifier,
      );
      const matchedTargetRow =
        refreshedTargetRows.find((row) => row.contactId === cachedTargetContactId) ??
        refreshedTargetRows.find((row) => row.isPrimaryContact) ??
        normalizeBusinessAccount(refreshedTargetRaw);

      if (getEnv().READ_MODEL_ENABLED) {
        replaceReadModelAccountRows(id, []);
        replaceReadModelAccountRows(refreshedTargetRecordId, refreshedTargetRows);
      }

      return matchedTargetRow;
    }

    if (cachedCurrentRow && !currentCachedBusinessAccountId && cachedTargetContactId !== null) {
      if (
        updateRequest.expectedLastModified &&
        cachedCurrentRow.lastModifiedIso &&
        updateRequest.expectedLastModified !== cachedCurrentRow.lastModifiedIso
      ) {
        throw new HttpError(
          409,
          "This record was modified in Acumatica after you loaded it. Reload and try again.",
        );
      }

      const contactPayload = buildPrimaryContactUpdatePayload({
        ...updateRequest,
        targetContactId: cachedTargetContactId,
      });
      await updateContact(
        activeCookieValue,
        cachedTargetContactId,
        contactPayload,
        activeAuthCookieRefresh,
      );
      const refreshedContact = await fetchContactById(
        activeCookieValue,
        cachedTargetContactId,
        activeAuthCookieRefresh,
      );
      const refreshedRow = buildFallbackRowFromContact(refreshedContact, id, cachedCurrentRow);

      if (getEnv().READ_MODEL_ENABLED) {
        replaceReadModelAccountRows(id, [refreshedRow]);
      }

      return refreshedRow;
    }

    const currentRaw = await fetchBusinessAccountById(
      activeCookieValue,
      id,
      activeAuthCookieRefresh,
    );
    const resolvedRecordId = resolveBusinessAccountRecordId(currentRaw, id);
    const updateIdentifiers = buildBusinessAccountUpdateIdentifiers(currentRaw, id);
    const currentAccountRow = await normalizeWithContactNotes(
      activeCookieValue,
      currentRaw,
      activeAuthCookieRefresh,
    );

    const requestedTargetContactId = updateRequest.targetContactId;
    const effectiveTargetContactId =
      requestedTargetContactId ??
      currentAccountRow.contactId ??
      currentAccountRow.primaryContactId;

    let currentRowForContactComparison = currentAccountRow;
    let currentTargetContactRaw: unknown = null;
    if (effectiveTargetContactId !== null) {
      try {
        const currentTargetContact = await fetchContactById(
          activeCookieValue,
          effectiveTargetContactId,
          activeAuthCookieRefresh,
        );
        currentTargetContactRaw = currentTargetContact;
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

    if (updateRequest.setAsPrimaryContact && effectiveTargetContactId === null) {
      throw new HttpError(
        422,
        "This row has no contact ID, so it cannot be set as primary.",
      );
    }

    if (
      hasPrimaryContactChanges(currentRowForContactComparison, updateRequest) &&
      effectiveTargetContactId === null
    ) {
      throw new HttpError(
        422,
        "Contact ID is missing on this row. Contact fields cannot be saved until the contact exists in Acumatica.",
      );
    }

    const normalizedUpdateRequest: typeof updateRequest = {
      ...updateRequest,
      targetContactId: effectiveTargetContactId,
    };
    const primaryOnlyUpdate = isPrimaryOnlyUpdate(
      currentAccountRow,
      currentRowForContactComparison,
      normalizedUpdateRequest,
    );
    const primaryOnlyConflictRetryAllowed = isPrimaryOnlyConflictRetryAllowed(
      updateRequest,
      effectiveTargetContactId,
    );

    if (
      updateRequest.expectedLastModified &&
      currentAccountRow.lastModifiedIso &&
      updateRequest.expectedLastModified !== currentAccountRow.lastModifiedIso &&
      !primaryOnlyUpdate &&
      !primaryOnlyConflictRetryAllowed
    ) {
      throw new HttpError(
        409,
        "This record was modified in Acumatica after you loaded it. Reload and try again.",
      );
    }

    let effectiveUpdateRequest = primaryOnlyUpdate && effectiveTargetContactId !== null
      ? buildPrimaryOnlyUpdateRequest(
          currentAccountRow,
          currentRowForContactComparison,
          effectiveTargetContactId,
        )
      : normalizedUpdateRequest;
    const contactWasEdited = hasPrimaryContactChanges(
      currentRowForContactComparison,
      effectiveUpdateRequest,
    );
    const addressWasEdited = hasAddressChanges(currentAccountRow, effectiveUpdateRequest);
    const submittedPhoneChanged =
      sanitizeNullableInput(effectiveUpdateRequest.primaryContactPhone) !==
      sanitizeNullableInput(currentRowForContactComparison.primaryContactPhone);

    if (submittedPhoneChanged) {
      const normalizedPhone = normalizePhoneForSave(
        effectiveUpdateRequest.primaryContactPhone,
      );
      if (
        effectiveUpdateRequest.primaryContactPhone !== null &&
        normalizedPhone === null
      ) {
        throw new HttpError(
          422,
          "Primary contact phone must use the format ###-###-####.",
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
      throw new HttpError(
        422,
        "Select a valid Sales Rep from the employee list before saving.",
      );
    }

    if (!effectiveUpdateRequest.salesRepId && !effectiveUpdateRequest.salesRepName) {
      effectiveUpdateRequest = {
        ...effectiveUpdateRequest,
        salesRepId: currentAccountRow.salesRepId,
        salesRepName: currentAccountRow.salesRepName,
      };
    }

    const identityPayload = buildBusinessAccountIdentityPayload(currentRaw);
    const primaryOnlySwitch =
      primaryOnlyUpdate &&
      effectiveUpdateRequest.setAsPrimaryContact &&
      effectiveTargetContactId !== null;

    if (!primaryOnlySwitch) {
      const accountPayload = buildBusinessAccountUpdatePayload(currentRaw, {
        ...effectiveUpdateRequest,
        targetContactId: effectiveTargetContactId,
      });
      await updateBusinessAccount(
        activeCookieValue,
        updateIdentifiers,
        {
          ...identityPayload,
          ...accountPayload,
        },
        activeAuthCookieRefresh,
      );
    }

    if (primaryOnlySwitch) {
      await setBusinessAccountPrimaryContact(
        activeCookieValue,
        {
          rawAccount: currentRaw as Record<string, unknown>,
          rawAccountWithContacts: currentRaw as Record<string, unknown>,
          resolvedRecordId,
          updateIdentifiers,
          identityPayload,
        },
        effectiveTargetContactId,
        activeAuthCookieRefresh,
        currentTargetContactRaw as Record<string, unknown> | null,
      );
    }

    if (
      effectiveUpdateRequest.setAsPrimaryContact &&
      effectiveTargetContactId !== null &&
      !primaryOnlySwitch
    ) {
      let primaryVerificationRaw = await fetchBusinessAccountById(
        activeCookieValue,
        resolvedRecordId,
        activeAuthCookieRefresh,
      );
      let verifiedPrimaryContactId = readPrimaryContactIdFromRawAccount(primaryVerificationRaw);

      if (verifiedPrimaryContactId !== effectiveTargetContactId) {
        const targetContactRecordId =
          currentTargetContactRaw &&
          typeof currentTargetContactRaw === "object" &&
          typeof (currentTargetContactRaw as Record<string, unknown>).id === "string"
            ? ((currentTargetContactRaw as Record<string, unknown>).id as string).trim()
            : "";

        try {
          await invokeBusinessAccountAction(
            activeCookieValue,
            "makeContactPrimary",
            {
              ...buildBusinessAccountIdentityPayload(primaryVerificationRaw),
              Contacts: [
                {
                  ...(targetContactRecordId ? { id: targetContactRecordId } : {}),
                  ContactID: {
                    value: effectiveTargetContactId,
                  },
                },
              ],
            },
            {},
            activeAuthCookieRefresh,
          );

          primaryVerificationRaw = await fetchBusinessAccountById(
            activeCookieValue,
            resolvedRecordId,
            activeAuthCookieRefresh,
          );
          verifiedPrimaryContactId = readPrimaryContactIdFromRawAccount(
            primaryVerificationRaw,
          );
        } catch (primaryActionError) {
          if (
            primaryActionError instanceof HttpError &&
            (primaryActionError.status === 401 || primaryActionError.status === 403)
          ) {
            throw primaryActionError;
          }
        }
      }

      if (verifiedPrimaryContactId !== effectiveTargetContactId) {
        const fallbackPayloads = buildPrimaryContactFallbackPayloads(
          primaryVerificationRaw,
          effectiveTargetContactId,
          currentTargetContactRaw,
        );

        for (const fallbackPayload of fallbackPayloads) {
          await updateBusinessAccount(
            activeCookieValue,
            updateIdentifiers,
            {
              ...identityPayload,
              ...fallbackPayload,
            },
            activeAuthCookieRefresh,
          );

          primaryVerificationRaw = await fetchBusinessAccountById(
            activeCookieValue,
            resolvedRecordId,
            activeAuthCookieRefresh,
          );
          verifiedPrimaryContactId = readPrimaryContactIdFromRawAccount(
            primaryVerificationRaw,
          );

          if (verifiedPrimaryContactId === effectiveTargetContactId) {
            break;
          }
        }
      }

      if (verifiedPrimaryContactId !== effectiveTargetContactId) {
        throw new HttpError(
          422,
          "Acumatica accepted the update but did not switch the primary contact. Please sync records and try again.",
        );
      }
    }

    if (contactWasEdited && effectiveTargetContactId !== null) {
      const contactPayload = buildPrimaryContactUpdatePayload(effectiveUpdateRequest);
      await updateContact(
        activeCookieValue,
        effectiveTargetContactId,
        contactPayload,
        activeAuthCookieRefresh,
      );
    }

    const refreshedRaw = await fetchBusinessAccountById(
      activeCookieValue,
      resolvedRecordId,
      activeAuthCookieRefresh,
    );
    const refreshedAccountRow = await normalizeWithContactNotes(
      activeCookieValue,
      refreshedRaw,
      activeAuthCookieRefresh,
    );

    let responseRow = refreshedAccountRow;
    const responseTargetContactId =
      effectiveTargetContactId ?? refreshedAccountRow.primaryContactId;
    if (responseTargetContactId !== null) {
      try {
        const refreshedTargetContact = await fetchContactById(
          activeCookieValue,
          responseTargetContactId,
          activeAuthCookieRefresh,
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

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(
        resolvedRecordId,
        normalizeBusinessAccountRows(refreshedRaw),
      );
    }

    return responseRow;
  };

  try {
    cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    updateRequest = parseUpdatePayload(body);

    const responseRow = await executePutWithCookie(cookieValue, authCookieRefresh);
    const response = NextResponse.json(responseRow);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (requestError) {
    let error = requestError;

    if (
      error instanceof HttpError &&
      error.status === 401 &&
      cookieValue &&
      updateRequest
    ) {
      const retryAuthCookieRefresh = {
        value: null as string | null,
      };
      const retryCookieValue = authCookieRefresh.value ?? cookieValue;

      try {
        const responseRow = await executePutWithCookie(
          retryCookieValue,
          retryAuthCookieRefresh,
        );
        const response = NextResponse.json(responseRow);
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
