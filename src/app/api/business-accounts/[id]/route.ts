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
  hasBusinessAccountChanges,
  hasAddressChanges,
  hasPrimaryContactChanges,
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
  resolveCompanyPhone,
  sanitizeNullableInput,
  withPrimaryContact,
} from "@/lib/business-accounts";
import {
  readContactBusinessAccountCode,
  readContactCompanyName,
} from "@/lib/contact-business-account";
import {
  buildPrimaryOnlyUpdateRequest,
  isPrimaryOnlyConflictRetryAllowed,
  isPrimaryOnlyUpdate,
} from "@/lib/business-account-update";
import {
  applyOptimisticSavedUpdateToRow,
  applyOptimisticSavedUpdateToRows,
  responseRowMatchesSavedUpdate,
} from "@/lib/business-account-save-verification";
import { setBusinessAccountPrimaryContact } from "@/lib/contact-merge-server";
import {
  shouldValidateWithAddressComplete,
  validateCanadianAddress,
} from "@/lib/address-complete";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  normalizePhoneForSave,
  resolvePrimaryContactPhoneFields,
} from "@/lib/phone";
import {
  readBusinessAccountDetailFromReadModel,
  replaceReadModelAccountRows,
} from "@/lib/read-model/accounts";
import {
  maybeTriggerReadModelSync,
  readSyncStatus,
  waitForReadModelSync,
} from "@/lib/read-model/sync";
import {
  parseContactOnlyUpdatePayload,
  parseUpdatePayload,
} from "@/lib/validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function readRequestedContactId(request: NextRequest): number | null {
  const raw = request.nextUrl.searchParams.get("contactId")?.trim() ?? "";
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requestBodyHasOwnField(requestBody: unknown, key: string): boolean {
  return Boolean(
    requestBody &&
      typeof requestBody === "object" &&
      Object.prototype.hasOwnProperty.call(requestBody, key),
  );
}

function selectDetailRow(
  rows: BusinessAccountRow[],
  requestedContactId: number | null,
  fallbackRow: BusinessAccountRow | null,
): BusinessAccountRow | null {
  if (requestedContactId !== null) {
    const requestedRow = rows.find((row) => row.contactId === requestedContactId);
    if (requestedRow) {
      return requestedRow;
    }
  }

  return rows.find((row) => row.isPrimaryContact) ?? fallbackRow ?? rows[0] ?? null;
}

function mergeResponseRowIntoRows(
  rows: BusinessAccountRow[],
  responseRow: BusinessAccountRow,
): BusinessAccountRow[] {
  const responseContactId = responseRow.contactId ?? null;
  if (responseContactId === null) {
    return rows;
  }

  let matched = false;
  const nextRows = rows.map((row) => {
    if (row.contactId !== responseContactId) {
      return row;
    }

    matched = true;
    return {
      ...row,
      ...responseRow,
      id: row.id,
      accountRecordId: row.accountRecordId ?? responseRow.accountRecordId ?? responseRow.id,
      rowKey:
        responseRow.rowKey ??
        row.rowKey ??
        `${row.accountRecordId ?? responseRow.accountRecordId ?? row.id}:contact:${responseContactId}`,
    };
  });

  if (matched) {
    return nextRows;
  }

  return [...rows, responseRow];
}

function schedulePostSyncAccountRefresh(
  cookieValue: string,
  accountRecordId: string,
  targetContactId: number | null,
): void {
  if (readSyncStatus().status !== "running") {
    return;
  }

  void (async () => {
    try {
      await waitForReadModelSync();

      const postSyncAuthCookieRefresh = {
        value: null as string | null,
      };
      const refreshedRaw = await fetchBusinessAccountById(
        cookieValue,
        accountRecordId,
        postSyncAuthCookieRefresh,
      );
      const refreshedAccountRow = await normalizeWithContactNotes(
        cookieValue,
        refreshedRaw,
        postSyncAuthCookieRefresh,
      );

      let refreshedResponseRow = refreshedAccountRow;
      if (targetContactId !== null) {
        try {
          const refreshedTargetContact = await fetchContactById(
            cookieValue,
            targetContactId,
            postSyncAuthCookieRefresh,
          );
          const normalizedTargetRow = normalizeBusinessAccount(
            withPrimaryContact(refreshedRaw, refreshedTargetContact),
          );
          refreshedResponseRow = {
            ...refreshedAccountRow,
            ...normalizedTargetRow,
            id: refreshedAccountRow.id,
            accountRecordId: refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id,
            rowKey: `${refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id}:contact:${targetContactId}`,
            contactId: targetContactId,
            isPrimaryContact:
              refreshedAccountRow.primaryContactId !== null &&
              refreshedAccountRow.primaryContactId === targetContactId,
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

      const refreshedRows = normalizeBusinessAccountRows(refreshedRaw);
      replaceReadModelAccountRows(
        accountRecordId,
        mergeResponseRowIntoRows(refreshedRows, refreshedResponseRow),
      );
    } catch (error) {
      console.warn("[business-account-update]", {
        event: "post-sync-refresh-failed",
        accountRecordId,
        targetContactId,
        error: getErrorMessage(error),
      });
    }
  })();
}

async function waitForDelay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isStandaloneContactRow(row: BusinessAccountRow | null): row is BusinessAccountRow {
  return (
    row !== null &&
    row.businessAccountId.trim().length === 0 &&
    (row.contactId ?? row.primaryContactId ?? null) !== null
  );
}

function buildStandaloneContactFallback(
  row: BusinessAccountRow,
): ReturnType<typeof parseUpdatePayload> {
  return {
    companyName: row.companyName,
    assignedBusinessAccountRecordId: null,
    assignedBusinessAccountId: row.businessAccountId.trim() || null,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country.trim().toUpperCase() || "CA",
    targetContactId: row.contactId ?? row.primaryContactId ?? null,
    setAsPrimaryContact: false,
    primaryOnlyIntent: false,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName,
    industryType: row.industryType,
    subCategory: row.subCategory,
    companyRegion: row.companyRegion,
    week: row.week,
    companyPhone: resolveCompanyPhone(row),
    primaryContactName: row.primaryContactName,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone: row.primaryContactPhone,
    primaryContactExtension: row.primaryContactExtension ?? null,
    primaryContactEmail: row.primaryContactEmail,
    category: row.category,
    notes: row.notes,
    expectedLastModified: row.lastModifiedIso,
  };
}

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
  return resolvePrimaryContactPhoneFields({
    phone1: readWrappedString(record, "Phone1"),
    phone2: readWrappedString(record, "Phone2"),
    phone3: readWrappedString(record, "Phone3"),
  }).phone;
}

function readContactExtension(record: unknown): string | null {
  return resolvePrimaryContactPhoneFields({
    phone1: readWrappedString(record, "Phone1"),
    phone2: readWrappedString(record, "Phone2"),
    phone3: readWrappedString(record, "Phone3"),
  }).extension;
}

function readContactRawPhone(record: unknown): string | null {
  return (
    readWrappedString(record, "Phone1") ??
    readWrappedString(record, "Phone2") ??
    readWrappedString(record, "Phone3")
  );
}

function readContactEmail(record: unknown): string | null {
  return readWrappedString(record, "Email") ?? readWrappedString(record, "EMail");
}

function readContactJobTitle(record: unknown): string | null {
  return readWrappedString(record, "JobTitle") ?? readWrappedString(record, "Title");
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
    companyPhone: existingRow?.companyPhone ?? null,
    companyPhoneSource: existingRow?.companyPhoneSource ?? null,
    phoneNumber: readContactPhone(contact),
    salesRepId: existingRow?.salesRepId ?? null,
    salesRepName: existingRow?.salesRepName ?? null,
    industryType: existingRow?.industryType ?? null,
    subCategory: existingRow?.subCategory ?? null,
    companyRegion: existingRow?.companyRegion ?? null,
    week: existingRow?.week ?? null,
    businessAccountId: readContactBusinessAccountCode(contact, readWrappedString) ?? "",
    companyName:
      existingRow?.companyName ??
      readContactCompanyName(contact, readWrappedString) ??
      "",
    address: existingRow?.address ?? "",
    addressLine1: existingRow?.addressLine1 ?? "",
    addressLine2: existingRow?.addressLine2 ?? "",
    city: existingRow?.city ?? "",
    state: existingRow?.state ?? "",
    postalCode: existingRow?.postalCode ?? "",
    country: existingRow?.country ?? "",
    primaryContactName: readContactDisplayName(contact),
    primaryContactJobTitle: readContactJobTitle(contact) ?? existingRow?.primaryContactJobTitle ?? null,
    primaryContactPhone: readContactPhone(contact),
    primaryContactExtension: readContactExtension(contact),
    primaryContactRawPhone: readContactRawPhone(contact),
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

function buildContactOnlyUpdateRequestFromCurrentRow(
  currentRow: BusinessAccountRow,
  targetContactId: number,
  parsedRequest: ReturnType<typeof parseUpdatePayload>,
  requestBody: unknown,
): ReturnType<typeof parseUpdatePayload> {
  const nextRequest: ReturnType<typeof parseUpdatePayload> = {
    companyName: currentRow.companyName,
    assignedBusinessAccountRecordId: currentRow.accountRecordId ?? currentRow.id,
    assignedBusinessAccountId: currentRow.businessAccountId,
    addressLine1: currentRow.addressLine1,
    addressLine2: currentRow.addressLine2,
    city: currentRow.city,
    state: currentRow.state,
    postalCode: currentRow.postalCode,
    country: currentRow.country,
    targetContactId,
    setAsPrimaryContact: false,
    primaryOnlyIntent: false,
    contactOnlyIntent: true,
    salesRepId: currentRow.salesRepId,
    salesRepName: currentRow.salesRepName,
    industryType: currentRow.industryType,
    subCategory: currentRow.subCategory,
    companyRegion: currentRow.companyRegion,
    week: currentRow.week,
    companyPhone: resolveCompanyPhone(currentRow),
    primaryContactName: currentRow.primaryContactName,
    primaryContactJobTitle: currentRow.primaryContactJobTitle ?? null,
    primaryContactPhone: currentRow.primaryContactPhone,
    primaryContactExtension: currentRow.primaryContactExtension ?? null,
    primaryContactEmail: currentRow.primaryContactEmail,
    category: currentRow.category,
    notes: currentRow.notes,
    expectedLastModified: currentRow.lastModifiedIso,
  };

  if (requestBodyHasOwnField(requestBody, "primaryContactName")) {
    nextRequest.primaryContactName = parsedRequest.primaryContactName;
  }
  if (requestBodyHasOwnField(requestBody, "primaryContactJobTitle")) {
    nextRequest.primaryContactJobTitle = parsedRequest.primaryContactJobTitle ?? null;
  }
  if (requestBodyHasOwnField(requestBody, "primaryContactPhone")) {
    nextRequest.primaryContactPhone = parsedRequest.primaryContactPhone;
  }
  if (requestBodyHasOwnField(requestBody, "primaryContactExtension")) {
    nextRequest.primaryContactExtension = parsedRequest.primaryContactExtension;
  }
  if (requestBodyHasOwnField(requestBody, "primaryContactEmail")) {
    nextRequest.primaryContactEmail = parsedRequest.primaryContactEmail;
  }
  if (requestBodyHasOwnField(requestBody, "notes")) {
    nextRequest.notes = parsedRequest.notes;
  }
  if (requestBodyHasOwnField(requestBody, "expectedLastModified")) {
    nextRequest.expectedLastModified = parsedRequest.expectedLastModified;
  }

  return nextRequest;
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

function readAccountLocation(rawAccount: unknown): string | null {
  return (
    readWrappedString(rawAccount, "Location") ??
    readWrappedString(rawAccount, "LocationID") ??
    readWrappedString(rawAccount, "LocationCD") ??
    readWrappedString(rawAccount, "DefaultLocation")
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

async function buildResponseRowFromRawAccount(
  cookieValue: string,
  rawAccount: unknown,
  targetContactId: number | null,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<{
  refreshedAccountRow: BusinessAccountRow;
  responseRow: BusinessAccountRow;
}> {
  const refreshedAccountRow = await normalizeWithContactNotes(
    cookieValue,
    rawAccount,
    authCookieRefresh,
  );

  let responseRow = refreshedAccountRow;
  if (targetContactId !== null) {
    try {
      const refreshedTargetContact = await fetchContactById(
        cookieValue,
        targetContactId,
        authCookieRefresh,
      );
      const normalizedTargetRow = normalizeBusinessAccount(
        withPrimaryContact(rawAccount, refreshedTargetContact),
      );
      responseRow = {
        ...refreshedAccountRow,
        ...normalizedTargetRow,
        id: refreshedAccountRow.id,
        accountRecordId: refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id,
        rowKey: `${refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id}:contact:${targetContactId}`,
        contactId: targetContactId,
        isPrimaryContact:
          refreshedAccountRow.primaryContactId !== null &&
          refreshedAccountRow.primaryContactId === targetContactId,
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

  return {
    refreshedAccountRow,
    responseRow,
  };
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };
  let cookieValue: string | null = null;
  const requestedContactId = readRequestedContactId(request);

  try {
    const { id } = await context.params;
    cookieValue = requireAuthCookieValue(request);
    const forceLive = request.nextUrl.searchParams.get("live") === "1";
    if (getEnv().READ_MODEL_ENABLED && !forceLive) {
      maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
      const cached = readBusinessAccountDetailFromReadModel(id, requestedContactId);
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
    const detailRow = selectDetailRow(normalizedRows, requestedContactId, normalized);

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(id, normalizedRows);
    }

    const response = NextResponse.json({
      row: detailRow,
      rows: normalizedRows,
      accountLocation: readAccountLocation(rawAccount),
    });
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
        const detailRow = selectDetailRow(normalizedRows, requestedContactId, normalized);

        const response = NextResponse.json({
          row: detailRow,
          rows: normalizedRows,
          accountLocation: readAccountLocation(rawAccount),
        });
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
  let requestBody: unknown;
  let updateRequest: ReturnType<typeof parseUpdatePayload> | null = null;

  const executePutWithCookie = async (
    activeCookieValue: string,
    activeAuthCookieRefresh: AuthCookieRefreshState,
  ): Promise<BusinessAccountRow> => {
    const cachedDetail = readBusinessAccountDetailFromReadModel(id);
    const cachedCurrentRow = cachedDetail?.row ?? null;
    const isExplicitContactOnlyIntent =
      Boolean(requestBody) &&
      typeof requestBody === "object" &&
      (requestBody as Record<string, unknown>).contactOnlyIntent === true;

    if (!updateRequest) {
      try {
        updateRequest = isExplicitContactOnlyIntent
          ? parseContactOnlyUpdatePayload(requestBody, cachedCurrentRow ?? undefined)
          : parseUpdatePayload(requestBody);
      } catch (error) {
        if (error instanceof ZodError && isStandaloneContactRow(cachedCurrentRow)) {
          updateRequest = parseContactOnlyUpdatePayload(
            requestBody,
            buildStandaloneContactFallback(cachedCurrentRow),
          );
        } else {
          throw error;
        }
      }
    }

    if (!updateRequest) {
      throw new HttpError(500, "Update payload was not parsed.");
    }

    const cachedTargetContactId =
      updateRequest.targetContactId ??
      cachedCurrentRow?.contactId ??
      cachedCurrentRow?.primaryContactId ??
      null;
    const cachedTargetDetail =
      cachedTargetContactId !== null
        ? readBusinessAccountDetailFromReadModel(id, cachedTargetContactId)
        : cachedDetail;
    const cachedTargetRow = cachedTargetDetail?.row ?? cachedCurrentRow;
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

    if (updateRequest.contactOnlyIntent === true && cachedTargetContactId !== null) {
      const cachedContactComparisonRow =
        cachedTargetRow !== null
          ? {
              ...cachedTargetRow,
              accountRecordId: cachedTargetRow.accountRecordId ?? cachedTargetRow.id,
              contactId: cachedTargetContactId,
              rowKey:
                cachedTargetRow.rowKey ??
                `${cachedTargetRow.accountRecordId ?? cachedTargetRow.id}:contact:${cachedTargetContactId}`,
            }
          : cachedCurrentRow !== null
            ? {
                ...cachedCurrentRow,
                accountRecordId: cachedCurrentRow.accountRecordId ?? cachedCurrentRow.id,
                contactId: cachedTargetContactId,
                rowKey:
                  cachedCurrentRow.rowKey ??
                  `${cachedCurrentRow.accountRecordId ?? cachedCurrentRow.id}:contact:${cachedTargetContactId}`,
              }
            : null;

      const currentTargetContact = await fetchContactById(
        activeCookieValue,
        cachedTargetContactId,
        activeAuthCookieRefresh,
      );
      const currentTargetRow = buildFallbackRowFromContact(
        currentTargetContact,
        id,
        cachedContactComparisonRow,
      );
      const effectiveContactOnlyUpdateRequest = buildContactOnlyUpdateRequestFromCurrentRow(
        currentTargetRow,
        cachedTargetContactId,
        updateRequest,
        requestBody,
      );

      if (
        requestBodyHasOwnField(requestBody, "expectedLastModified") &&
        effectiveContactOnlyUpdateRequest.expectedLastModified &&
        currentTargetRow.lastModifiedIso &&
        effectiveContactOnlyUpdateRequest.expectedLastModified !== currentTargetRow.lastModifiedIso
      ) {
        throw new HttpError(
          409,
          "This record was modified in Acumatica after you loaded it. Reload and try again.",
        );
      }

      const contactPayload = buildPrimaryContactUpdatePayload(
        effectiveContactOnlyUpdateRequest,
      );
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
      const refreshedRow = buildFallbackRowFromContact(
        refreshedContact,
        id,
        currentTargetRow,
      );

      if (getEnv().READ_MODEL_ENABLED) {
        replaceReadModelAccountRows(
          refreshedRow.accountRecordId ?? id,
          mergeResponseRowIntoRows(
            cachedTargetDetail?.rows ?? cachedDetail?.rows ?? [currentTargetRow],
            refreshedRow,
          ),
        );
        schedulePostSyncAccountRefresh(
          activeCookieValue,
          refreshedRow.accountRecordId ?? id,
          cachedTargetContactId,
        );
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
    const requestedContactOnlyIntent = updateRequest.contactOnlyIntent === true;
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

    if (requestedContactOnlyIntent && effectiveTargetContactId === null) {
      throw new HttpError(
        422,
        "Contact-only updates require a valid contact ID.",
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

    let normalizedUpdateRequest: typeof updateRequest = {
      ...updateRequest,
      targetContactId: effectiveTargetContactId,
    };

    if (requestedContactOnlyIntent && effectiveTargetContactId !== null) {
      normalizedUpdateRequest = {
        ...normalizedUpdateRequest,
        companyName: currentAccountRow.companyName,
        assignedBusinessAccountRecordId:
          currentAccountRow.accountRecordId ?? currentAccountRow.id,
        assignedBusinessAccountId: currentAccountRow.businessAccountId,
        addressLine1: currentAccountRow.addressLine1,
        addressLine2: currentAccountRow.addressLine2,
        city: currentAccountRow.city,
        state: currentAccountRow.state,
        postalCode: currentAccountRow.postalCode,
        country: currentAccountRow.country,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: currentAccountRow.salesRepId,
        salesRepName: currentAccountRow.salesRepName,
        industryType: currentAccountRow.industryType,
        subCategory: currentAccountRow.subCategory,
        companyRegion: currentAccountRow.companyRegion,
        week: currentAccountRow.week,
        companyPhone: resolveCompanyPhone(currentAccountRow),
        category: currentAccountRow.category,
        contactOnlyIntent: true,
      };
    }
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
        companyPhone: effectiveUpdateRequest.companyPhone,
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
    const accountWasEdited = hasBusinessAccountChanges(
      currentAccountRow,
      effectiveUpdateRequest,
    );
    const companyPhoneWasEdited =
      sanitizeNullableInput(effectiveUpdateRequest.companyPhone) !==
      sanitizeNullableInput(resolveCompanyPhone(currentAccountRow));
    const primaryOnlySwitch =
      primaryOnlyUpdate &&
      effectiveUpdateRequest.setAsPrimaryContact &&
      effectiveTargetContactId !== null;

    if (
      !primaryOnlySwitch &&
      (accountWasEdited ||
        (effectiveUpdateRequest.setAsPrimaryContact && effectiveTargetContactId !== null))
    ) {
      const accountPayload = buildBusinessAccountUpdatePayload(currentRaw, {
        ...effectiveUpdateRequest,
        targetContactId: effectiveTargetContactId,
      }, {
        includeCompanyPhone: companyPhoneWasEdited,
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

    const responseTargetContactId =
      effectiveTargetContactId ?? currentAccountRow.primaryContactId;

    const verificationDelaysMs = [0, 180, 450, 900];
    let refreshedRaw: unknown = null;
    let refreshedAccountRow: BusinessAccountRow | null = null;
    let responseRow: BusinessAccountRow | null = null;
    let verifiedResponse = false;

    for (const delayMs of verificationDelaysMs) {
      await waitForDelay(delayMs);

      refreshedRaw = await fetchBusinessAccountById(
        activeCookieValue,
        resolvedRecordId,
        activeAuthCookieRefresh,
      );
      const refreshedResult = await buildResponseRowFromRawAccount(
        activeCookieValue,
        refreshedRaw,
        responseTargetContactId,
        activeAuthCookieRefresh,
      );
      refreshedAccountRow = refreshedResult.refreshedAccountRow;
      responseRow = refreshedResult.responseRow;

      if (
        responseRowMatchesSavedUpdate(
          responseRow,
          currentAccountRow,
          effectiveUpdateRequest,
          responseTargetContactId,
        )
      ) {
        verifiedResponse = true;
        break;
      }
    }

    if (!refreshedRaw || !refreshedAccountRow || !responseRow) {
      throw new HttpError(502, "Unable to verify the saved account state.");
    }

    if (!verifiedResponse) {
      const optimisticRows = applyOptimisticSavedUpdateToRows(
        normalizeBusinessAccountRows(refreshedRaw),
        currentAccountRow,
        effectiveUpdateRequest,
        responseTargetContactId,
      );
      responseRow = applyOptimisticSavedUpdateToRow(
        responseRow,
        currentAccountRow,
        effectiveUpdateRequest,
        responseTargetContactId,
      );

      console.warn("[business-account-update]", {
        event: "save-verification-stale-response",
        accountRecordId: resolvedRecordId,
        targetContactId: responseTargetContactId,
      });

      if (getEnv().READ_MODEL_ENABLED) {
        replaceReadModelAccountRows(
          resolvedRecordId,
          mergeResponseRowIntoRows(optimisticRows, responseRow),
        );
        schedulePostSyncAccountRefresh(
          activeCookieValue,
          resolvedRecordId,
          responseTargetContactId,
        );
      }

      return responseRow;
    }

    if (getEnv().READ_MODEL_ENABLED) {
      const refreshedRows = normalizeBusinessAccountRows(refreshedRaw);
      replaceReadModelAccountRows(
        resolvedRecordId,
        mergeResponseRowIntoRows(refreshedRows, responseRow),
      );
      schedulePostSyncAccountRefresh(
        activeCookieValue,
        resolvedRecordId,
        responseTargetContactId,
      );
    }

    return responseRow;
  };

  try {
    cookieValue = requireAuthCookieValue(request);
    requestBody = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });

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
