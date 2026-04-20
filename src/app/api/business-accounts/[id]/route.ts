export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { BusinessAccountRow } from "@/types/business-account";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
import { enqueueDeferredBusinessAccountDeleteAction } from "@/lib/deferred-actions-store";
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
  hasBusinessAccountChanges,
  hasAddressChanges,
  hasPrimaryContactChanges,
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
  resolveCompanyPhone,
  sanitizeNullableInput,
  withPrimaryContact,
} from "@/lib/business-accounts";
import { applyLastCalledAtToBusinessAccountRows } from "@/lib/business-account-call-history";
import {
  readContactBusinessAccountCode,
  readContactCompanyName,
} from "@/lib/contact-business-account";
import {
  buildRebasedUpdateRequest,
  collectConflictingConcurrencyFields,
  formatConcurrencyConflictFields,
} from "@/lib/business-account-concurrency";
import {
  buildPrimaryOnlyUpdateRequest,
  isContactOnlyUpdate,
  isPrimaryOnlyConflictRetryAllowed,
  isPrimaryOnlyUpdate,
} from "@/lib/business-account-update";
import {
  applyOptimisticSavedUpdateToRow,
  applyOptimisticSavedUpdateToRows,
  mergeSavedResponseRowIntoRows,
  responseRowMatchesSavedUpdate,
} from "@/lib/business-account-save-verification";
import { publishBusinessAccountChanged } from "@/lib/business-account-live";
import { setBusinessAccountPrimaryContact } from "@/lib/contact-merge-server";
import {
  shouldValidateWithAddressComplete,
  validateCanadianAddress,
} from "@/lib/address-complete";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { isAlwaysExcludedBusinessAccountRow } from "@/lib/internal-records";
import {
  normalizePhoneForSave,
  resolvePrimaryContactPhoneFields,
} from "@/lib/phone";
import {
  readBusinessAccountDetailFromReadModel,
  readStoredBusinessAccountRowsFromReadModel,
  replaceReadModelAccountRows,
} from "@/lib/read-model/accounts";
import {
  applyLocalAccountMetadataToRow,
  applyLocalAccountMetadataToRows,
  saveAccountCompanyDescription,
} from "@/lib/read-model/account-local-metadata";
import {
  maybeTriggerReadModelSync,
  readSyncStatus,
  waitForReadModelSync,
} from "@/lib/read-model/sync";
import {
  parseDeleteReasonPayload,
  parseContactOnlyUpdatePayload,
  parseUpdatePayload,
} from "@/lib/validation";
import type { DeferredDeleteBusinessAccountResponse } from "@/types/deferred-action";

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
        mergeSavedResponseRowIntoRows(refreshedRows, refreshedResponseRow),
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

function storedAccountStillHasContacts(rows: BusinessAccountRow[]): boolean {
  return rows.some((row) => {
    const contactId = row.contactId ?? null;
    const primaryContactId = row.primaryContactId ?? null;
    return contactId !== null || primaryContactId !== null;
  });
}

async function resolveDeleteCandidateRows(
  cookieValue: string,
  accountRecordId: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<BusinessAccountRow[]> {
  const storedRows = readStoredBusinessAccountRowsFromReadModel(accountRecordId);
  if (storedRows.length > 0 && !storedAccountStillHasContacts(storedRows)) {
    return storedRows;
  }

  try {
    const liveRaw = await fetchBusinessAccountById(
      cookieValue,
      accountRecordId,
      authCookieRefresh,
    );
    const liveRows = normalizeBusinessAccountRows(liveRaw);
    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(accountRecordId, liveRows);
    }
    return liveRows;
  } catch (error) {
    if (storedRows.length > 0) {
      return storedRows;
    }
    throw error;
  }
}

function buildStandaloneContactFallback(
  row: BusinessAccountRow,
): ReturnType<typeof parseUpdatePayload> {
  return {
    companyName: row.companyName,
    companyDescription: row.companyDescription ?? null,
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

function isUsableContactId(contactId: number | null | undefined): contactId is number {
  return Number.isInteger(contactId) && Number(contactId) > 0;
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
    extension:
      readWrappedString(record, "Extension") ??
      readWrappedString(record, "Phone1Ext") ??
      readWrappedString(record, "extension"),
  }).phone;
}

function readContactExtension(record: unknown): string | null {
  return resolvePrimaryContactPhoneFields({
    phone1: readWrappedString(record, "Phone1"),
    phone2: readWrappedString(record, "Phone2"),
    phone3: readWrappedString(record, "Phone3"),
    extension:
      readWrappedString(record, "Extension") ??
      readWrappedString(record, "Phone1Ext") ??
      readWrappedString(record, "extension"),
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
    companyDescription: existingRow?.companyDescription ?? null,
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
    ...(!assignedBusinessAccountId && companyName
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
    companyDescription: currentRow.companyDescription ?? null,
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
  if (requestBodyHasOwnField(requestBody, "companyDescription")) {
    nextRequest.companyDescription = parsedRequest.companyDescription ?? null;
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

function buildCachedContactComparisonRow(
  cachedCurrentRow: BusinessAccountRow | null,
  cachedTargetRow: BusinessAccountRow | null,
  cachedTargetContactId: number | null,
): BusinessAccountRow | null {
  if (cachedTargetContactId === null) {
    return cachedTargetRow ?? cachedCurrentRow;
  }

  if (cachedTargetRow !== null) {
    return {
      ...cachedTargetRow,
      accountRecordId: cachedTargetRow.accountRecordId ?? cachedTargetRow.id,
      contactId: cachedTargetContactId,
      rowKey:
        cachedTargetRow.rowKey ??
        `${cachedTargetRow.accountRecordId ?? cachedTargetRow.id}:contact:${cachedTargetContactId}`,
    };
  }

  if (cachedCurrentRow !== null) {
    return {
      ...cachedCurrentRow,
      accountRecordId: cachedCurrentRow.accountRecordId ?? cachedCurrentRow.id,
      contactId: cachedTargetContactId,
      rowKey:
        cachedCurrentRow.rowKey ??
        `${cachedCurrentRow.accountRecordId ?? cachedCurrentRow.id}:contact:${cachedTargetContactId}`,
    };
  }

  return null;
}

function hydrateSparseUpdateRequestFromCachedRow(
  parsedRequest: ReturnType<typeof parseUpdatePayload>,
  requestBody: unknown,
  fallbackRow: BusinessAccountRow,
): ReturnType<typeof parseUpdatePayload> {
  const nextRequest = { ...parsedRequest };

  const applyIfMissing = <K extends keyof ReturnType<typeof parseUpdatePayload>>(
    key: K,
    value: ReturnType<typeof parseUpdatePayload>[K],
  ) => {
    if (!requestBodyHasOwnField(requestBody, String(key))) {
      nextRequest[key] = value;
    }
  };

  // Preserve optional account/contact values when callers submit sparse payloads.
  applyIfMissing("companyDescription", fallbackRow.companyDescription ?? null);
  applyIfMissing("salesRepId", fallbackRow.salesRepId ?? null);
  applyIfMissing("salesRepName", fallbackRow.salesRepName ?? null);
  applyIfMissing("industryType", fallbackRow.industryType ?? null);
  applyIfMissing("subCategory", fallbackRow.subCategory ?? null);
  applyIfMissing("companyRegion", fallbackRow.companyRegion ?? null);
  applyIfMissing("week", fallbackRow.week ?? null);
  applyIfMissing("companyPhone", resolveCompanyPhone(fallbackRow));
  applyIfMissing("primaryContactName", fallbackRow.primaryContactName ?? null);
  applyIfMissing("primaryContactJobTitle", fallbackRow.primaryContactJobTitle ?? null);
  applyIfMissing("primaryContactPhone", fallbackRow.primaryContactPhone ?? null);
  applyIfMissing("primaryContactExtension", fallbackRow.primaryContactExtension ?? null);
  applyIfMissing("primaryContactEmail", fallbackRow.primaryContactEmail ?? null);
  applyIfMissing("category", fallbackRow.category ?? null);
  applyIfMissing("notes", fallbackRow.notes ?? null);

  return nextRequest;
}

async function normalizeWithContactNotes(
  cookieValue: string,
  rawAccount: unknown,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ReturnType<typeof normalizeBusinessAccount>> {
  const baseRow = normalizeBusinessAccount(rawAccount);
  if (!isUsableContactId(baseRow.primaryContactId)) {
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
  const normalizedRows = normalizeBusinessAccountRows(rawAccount);

  let responseRow = refreshedAccountRow;
  if (isUsableContactId(targetContactId)) {
    const targetContactRow =
      normalizedRows.find(
        (row) =>
          row.contactId !== null &&
          row.contactId !== undefined &&
          row.contactId === targetContactId,
      ) ?? null;

    if (targetContactRow) {
      responseRow = {
        ...refreshedAccountRow,
        ...targetContactRow,
        id: refreshedAccountRow.id,
        accountRecordId: refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id,
        rowKey:
          targetContactRow.rowKey ??
          `${refreshedAccountRow.accountRecordId ?? refreshedAccountRow.id}:contact:${targetContactId}`,
        contactId: targetContactRow.contactId ?? targetContactId,
        primaryContactId: targetContactRow.primaryContactId ?? refreshedAccountRow.primaryContactId,
      };
    } else {
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
  }

  return {
    refreshedAccountRow,
    responseRow,
  };
}

function persistLocalCompanyDescription(
  row: BusinessAccountRow,
  updateRequest: ReturnType<typeof parseUpdatePayload>,
  shouldPersist: boolean,
): void {
  if (!shouldPersist) {
    return;
  }

  saveAccountCompanyDescription({
    accountRecordId: row.accountRecordId ?? row.id,
    businessAccountId: row.businessAccountId,
    companyDescription: updateRequest.companyDescription,
  });
}

function withLocalCompanyDescription(
  row: BusinessAccountRow,
  updateRequest: ReturnType<typeof parseUpdatePayload>,
  shouldPersist: boolean,
): BusinessAccountRow {
  persistLocalCompanyDescription(row, updateRequest, shouldPersist);
  return applyLocalAccountMetadataToRow(row) ?? row;
}

function buildConcurrencyConflictMessage(conflictingFields: string[]): string {
  if (conflictingFields.length === 0) {
    return "This record was modified in Acumatica after you loaded it. Reload and try again.";
  }

  if (conflictingFields.length === 1) {
    return `This record changed while you were editing it. Reload to review the latest ${conflictingFields[0]}.`;
  }

  return `This record changed while you were editing it. Reload to review the latest ${conflictingFields.join(", ")}.`;
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
        if (isAlwaysExcludedBusinessAccountRow(cached.row)) {
          throw new HttpError(404, "Business account not found.");
        }
        const response = NextResponse.json({
          ...cached,
          row: applyLocalAccountMetadataToRow(cached.row) ?? cached.row,
          rows: cached.rows ? applyLocalAccountMetadataToRows(cached.rows) : cached.rows,
        });
        if (authCookieRefresh.value) {
          setAuthCookie(response, authCookieRefresh.value);
        }
        return response;
      }

      throw new HttpError(
        404,
        "Business account is not in the local SQLite snapshot. Click Sync records to refresh.",
      );
    }

    const rawAccount = await fetchBusinessAccountById(cookieValue, id, authCookieRefresh);
    const normalized = await normalizeWithContactNotes(
      cookieValue,
      rawAccount,
      authCookieRefresh,
    );
    if (isAlwaysExcludedBusinessAccountRow(normalized)) {
      throw new HttpError(404, "Business account not found.");
    }

    const normalizedRows = normalizeBusinessAccountRows(rawAccount);
    const rowsWithCallHistory = applyLastCalledAtToBusinessAccountRows(normalizedRows);
    const detailRow = selectDetailRow(rowsWithCallHistory, requestedContactId, normalized);

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(id, normalizedRows);
    }

    const response = NextResponse.json({
      row: applyLocalAccountMetadataToRow(detailRow) ?? detailRow,
      rows: applyLocalAccountMetadataToRows(rowsWithCallHistory),
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
        if (isAlwaysExcludedBusinessAccountRow(normalized)) {
          throw new HttpError(404, "Business account not found.");
        }

        const normalizedRows = normalizeBusinessAccountRows(rawAccount);
        const rowsWithCallHistory = applyLastCalledAtToBusinessAccountRows(normalizedRows);
        const detailRow = selectDetailRow(rowsWithCallHistory, requestedContactId, normalized);

        const response = NextResponse.json({
          row: applyLocalAccountMetadataToRow(detailRow) ?? detailRow,
          rows: applyLocalAccountMetadataToRows(rowsWithCallHistory),
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

    const submittedCompanyDescription = requestBodyHasOwnField(
      requestBody,
      "companyDescription",
    );

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
    if (cachedTargetRow !== null) {
      updateRequest = hydrateSparseUpdateRequestFromCachedRow(
        updateRequest,
        requestBody,
        cachedTargetRow,
      );
    }
    const implicitContactOnlyIntent =
      cachedCurrentRow !== null &&
      cachedTargetContactId !== null &&
      isContactOnlyUpdate(cachedCurrentRow, updateRequest);
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
    const cachedContactComparisonRow = buildCachedContactComparisonRow(
      cachedCurrentRow,
      cachedTargetRow,
      cachedTargetContactId,
    );
    const requestedUnknownTargetContact =
      cachedTargetContactId !== null && cachedTargetRow === null;
    const isNoopSaveAgainstCachedRow =
      cachedCurrentRow !== null &&
      !isOrphanContactAssignment &&
      !requestedUnknownTargetContact &&
      !updateRequest.setAsPrimaryContact &&
      !hasBusinessAccountChanges(cachedCurrentRow, updateRequest) &&
      !hasPrimaryContactChanges(
        cachedContactComparisonRow ?? cachedCurrentRow,
        updateRequest,
      );

    if (isNoopSaveAgainstCachedRow) {
      return withLocalCompanyDescription(
        cachedContactComparisonRow ?? cachedCurrentRow,
        updateRequest,
        submittedCompanyDescription,
      );
    }

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

      return withLocalCompanyDescription(
        matchedTargetRow,
        updateRequest,
        submittedCompanyDescription,
      );
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

      return withLocalCompanyDescription(
        refreshedRow,
        updateRequest,
        submittedCompanyDescription,
      );
    }

    if (
      (updateRequest.contactOnlyIntent === true || implicitContactOnlyIntent) &&
      cachedTargetContactId !== null
    ) {
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
      let effectiveContactOnlyUpdateRequest = buildContactOnlyUpdateRequestFromCurrentRow(
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
        const conflictingFields = formatConcurrencyConflictFields(
          collectConflictingConcurrencyFields(
            currentTargetRow,
            currentTargetRow,
            effectiveContactOnlyUpdateRequest,
          ),
        );

        if (effectiveContactOnlyUpdateRequest.baseSnapshot && conflictingFields.length === 0) {
          effectiveContactOnlyUpdateRequest = buildRebasedUpdateRequest(
            currentTargetRow,
            currentTargetRow,
            effectiveContactOnlyUpdateRequest,
            cachedTargetContactId,
          );
        } else {
          throw new HttpError(409, buildConcurrencyConflictMessage(conflictingFields));
        }
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
          mergeSavedResponseRowIntoRows(
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

      return withLocalCompanyDescription(
        refreshedRow,
        updateRequest,
        submittedCompanyDescription,
      );
    }

    const currentRaw = await fetchBusinessAccountById(
      activeCookieValue,
      id,
      activeAuthCookieRefresh,
    );
    const resolvedRecordId = resolveBusinessAccountRecordId(currentRaw, id);
    const updateIdentifiers = buildBusinessAccountUpdateIdentifiers(currentRaw, id);
    const normalizedCurrentAccountRow = await normalizeWithContactNotes(
      activeCookieValue,
      currentRaw,
      activeAuthCookieRefresh,
    );
    const currentAccountRow =
      applyLocalAccountMetadataToRow(normalizedCurrentAccountRow) ?? normalizedCurrentAccountRow;

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
    const companyDescriptionChanged =
      submittedCompanyDescription &&
      sanitizeNullableInput(normalizedUpdateRequest.companyDescription) !==
      sanitizeNullableInput(currentAccountRow.companyDescription);
    const isLocalDescriptionOnlySave =
      companyDescriptionChanged &&
      !hasBusinessAccountChanges(currentAccountRow, normalizedUpdateRequest) &&
      !hasPrimaryContactChanges(currentRowForContactComparison, normalizedUpdateRequest) &&
      !normalizedUpdateRequest.setAsPrimaryContact;

    if (isLocalDescriptionOnlySave) {
      return withLocalCompanyDescription(
        currentRowForContactComparison,
        normalizedUpdateRequest,
        submittedCompanyDescription,
      );
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
      const conflictingFields = formatConcurrencyConflictFields(
        collectConflictingConcurrencyFields(
          currentAccountRow,
          currentRowForContactComparison,
          normalizedUpdateRequest,
        ),
      );

      if (normalizedUpdateRequest.baseSnapshot && conflictingFields.length === 0) {
        normalizedUpdateRequest = buildRebasedUpdateRequest(
          currentAccountRow,
          currentRowForContactComparison,
          normalizedUpdateRequest,
          effectiveTargetContactId,
        );
      } else {
        throw new HttpError(409, buildConcurrencyConflictMessage(conflictingFields));
      }
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
        {
          strategy: "body-first",
        },
      );
    }

    if (effectiveUpdateRequest.setAsPrimaryContact && effectiveTargetContactId !== null) {
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

    const verificationDelaysMs = [0, 250];
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
      const optimisticTargetRow =
        responseTargetContactId !== null
          ? optimisticRows.find(
              (row) =>
                row.contactId !== null &&
                row.contactId !== undefined &&
                row.contactId === responseTargetContactId,
            ) ?? null
          : null;
      responseRow =
        optimisticTargetRow ??
        applyOptimisticSavedUpdateToRow(
          responseRow,
          currentAccountRow,
          effectiveUpdateRequest,
          responseTargetContactId,
        );

      console.warn("[business-account-update]", {
        event: "save-verification-stale-response",
        accountRecordId: resolvedRecordId,
        targetContactId: responseTargetContactId,
        responseContactId: responseRow.contactId ?? null,
      });

      if (getEnv().READ_MODEL_ENABLED) {
        replaceReadModelAccountRows(
          resolvedRecordId,
          mergeSavedResponseRowIntoRows(optimisticRows, responseRow),
        );
        schedulePostSyncAccountRefresh(
          activeCookieValue,
          resolvedRecordId,
          responseTargetContactId,
        );
      }

      return withLocalCompanyDescription(
        responseRow,
        effectiveUpdateRequest,
        submittedCompanyDescription,
      );
    }

    if (getEnv().READ_MODEL_ENABLED) {
      const refreshedRows = normalizeBusinessAccountRows(refreshedRaw);
      replaceReadModelAccountRows(
        resolvedRecordId,
        mergeSavedResponseRowIntoRows(refreshedRows, responseRow),
      );
      schedulePostSyncAccountRefresh(
        activeCookieValue,
        resolvedRecordId,
        responseTargetContactId,
      );
    }

    return withLocalCompanyDescription(
      responseRow,
      effectiveUpdateRequest,
      submittedCompanyDescription,
    );
  };

  try {
    cookieValue = requireAuthCookieValue(request);
    requestBody = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });

    const responseRow = await executePutWithCookie(cookieValue, authCookieRefresh);
    publishBusinessAccountChanged({
      accountRecordId: responseRow.accountRecordId ?? responseRow.id,
      businessAccountId: responseRow.businessAccountId || null,
      targetContactId: responseRow.contactId ?? responseRow.primaryContactId ?? null,
      reason: "business-account-updated",
    });
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
        publishBusinessAccountChanged({
          accountRecordId: responseRow.accountRecordId ?? responseRow.id,
          businessAccountId: responseRow.businessAccountId || null,
          targetContactId: responseRow.contactId ?? responseRow.primaryContactId ?? null,
          reason: "business-account-updated",
        });
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

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const { id } = await context.params;
    const accountRecordId = id.trim();
    if (!accountRecordId) {
      throw new HttpError(400, "Business account ID is required.");
    }

    const cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const { reason } = parseDeleteReasonPayload(body);
    const candidateRows = await resolveDeleteCandidateRows(
      cookieValue,
      accountRecordId,
      authCookieRefresh,
    );
    if (candidateRows.length === 0) {
      throw new HttpError(
        404,
        "Business account was not found in the current snapshot. Sync the accounts list and try again.",
      );
    }

    const actor = await resolveDeferredActionActor(
      request,
      cookieValue,
      authCookieRefresh,
    );
    const representativeRow = candidateRows[0];
    const businessAccountId = representativeRow?.businessAccountId?.trim() ?? "";
    if (!businessAccountId) {
      throw new HttpError(
        400,
        "This business account does not have an Acumatica account ID, so it cannot be queued for deletion.",
      );
    }

    const queued = enqueueDeferredBusinessAccountDeleteAction({
      sourceSurface: request.nextUrl.searchParams.get("source")?.trim() || "accounts",
      businessAccountRecordId: accountRecordId,
      businessAccountId,
      companyName: representativeRow?.companyName?.trim() || null,
      reason,
      actor,
    });

    const response = NextResponse.json({
      queued: true,
      actionId: queued.id,
      actionType: "deleteBusinessAccount",
      businessAccountRecordId: accountRecordId,
      businessAccountId,
      reason,
      executeAfterAt: queued.executeAfterAt,
      status: "pending_review",
    } satisfies DeferredDeleteBusinessAccountResponse);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const response =
      error instanceof ZodError
        ? NextResponse.json(
            {
              error: "Invalid delete request payload",
              details: error.flatten(),
            },
            { status: 400 },
          )
        : error instanceof HttpError
          ? NextResponse.json(
              {
                error: error.message,
                details: error.details,
              },
              { status: error.status },
            )
          : NextResponse.json(
              {
                error: getErrorMessage(error),
              },
              { status: 500 },
            );

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
