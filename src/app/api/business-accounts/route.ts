export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  createBusinessAccount,
  fetchBusinessAccountById,
  fetchBusinessAccounts,
  fetchBusinessAccountsByBusinessAccountIds,
  fetchContactById,
  fetchContacts,
  readWrappedScalarString,
} from "@/lib/acumatica";
import {
  retrieveCanadaPostAddressCompleteAddress,
  type AddressInput,
} from "@/lib/address-complete";
import {
  buildBusinessAccountCreatePayload,
  normalizeCreatedBusinessAccountRows,
} from "@/lib/business-account-create";
import { logBusinessAccountCreateAudit } from "@/lib/audit-log-store";
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { resolvePrimaryContactPhoneFields } from "@/lib/phone";
import {
  enforceSinglePrimaryPerAccountRows,
  filterSuppressedBusinessAccountRows,
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
  queryBusinessAccounts,
  selectPrimaryContactIndex,
} from "@/lib/business-accounts";
import {
  readContactBusinessAccountCode,
  readContactCompanyName,
} from "@/lib/contact-business-account";
import {
  isExcludedInternalCompanyName,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
import {
  queryReadModelBusinessAccounts,
  replaceReadModelAccountRows,
} from "@/lib/read-model/accounts";
import {
  applyLocalAccountMetadataToRow,
  applyLocalAccountMetadataToRows,
  saveAccountCompanyDescription,
} from "@/lib/read-model/account-local-metadata";
import { maybeTriggerReadModelSync } from "@/lib/read-model/sync";
import type { BusinessAccountRow } from "@/types/business-account";
import type { BusinessAccountCreateResponse } from "@/types/business-account-create";
import { parseBusinessAccountCreatePayload, parseListQuery } from "@/lib/validation";

type AuthCookieRefresh = {
  value: string | null;
};

type RawRecord = Record<string, unknown>;

function readArrayField(record: unknown, key: string): unknown[] {
  if (!record || typeof record !== "object") {
    return [];
  }

  const field = (record as RawRecord)[key];
  if (Array.isArray(field)) {
    return field;
  }

  if (!field || typeof field !== "object") {
    return [];
  }

  const wrappedValue = (field as RawRecord).value;
  if (Array.isArray(wrappedValue)) {
    return wrappedValue;
  }

  const wrappedItems = (field as RawRecord).Items;
  if (Array.isArray(wrappedItems)) {
    return wrappedItems;
  }

  return [];
}

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as RawRecord)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as RawRecord).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasStandaloneApToken(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return /(?:^|[^a-z0-9])ap(?:$|[^a-z0-9])/i.test(value);
}

function shouldExcludeContactByApToken(contact: unknown): boolean {
  const candidates = [
    readWrappedString(contact, "DisplayName"),
    readWrappedString(contact, "FullName"),
    readWrappedString(contact, "ContactName"),
    readWrappedString(contact, "Attention"),
    readWrappedString(contact, "FirstName"),
    readWrappedString(contact, "MiddleName"),
    readWrappedString(contact, "LastName"),
    readWrappedString(contact, "JobTitle"),
    readWrappedString(contact, "Title"),
  ];

  return candidates.some((value) => hasStandaloneApToken(value));
}

function normalizeAccountType(value: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isLikelyVendorClassId(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  return (
    normalized.includes("vendor") ||
    normalized.includes("supplier") ||
    normalized.includes("suppl") ||
    normalized.startsWith("ven")
  );
}

function isAllowedBusinessAccountType(record: unknown): boolean {
  const normalizedType = normalizeAccountType(
    readWrappedString(record, "Type") ??
      readWrappedString(record, "TypeDescription"),
  );
  if (normalizedType) {
    return normalizedType === "customer" || normalizedType === "businessaccount";
  }

  const classId =
    readWrappedString(record, "ClassID") ??
    readWrappedString(record, "BusinessAccountClass");
  if (isLikelyVendorClassId(classId)) {
    return false;
  }

  // Keep records when type is absent so we don't drop the entire dataset.
  return true;
}

function readContactDisplayName(record: unknown): string | null {
  const explicit = [
    "DisplayName",
    "FullName",
    "ContactName",
    "Attention",
  ]
    .map((key) => readWrappedString(record, key))
    .find((value) => Boolean(value));
  if (explicit) {
    return explicit;
  }

  const first = readWrappedString(record, "FirstName");
  const middle = readWrappedString(record, "MiddleName");
  const last = readWrappedString(record, "LastName");
  const full = [first, middle, last].filter(Boolean).join(" ").trim();
  return full || null;
}

function readContactEmail(record: unknown): string | null {
  const email = readWrappedString(record, "Email") ?? readWrappedString(record, "EMail");
  return email && email.trim() ? email.trim() : null;
}

function readContactJobTitle(record: unknown): string | null {
  return readWrappedString(record, "JobTitle") ?? readWrappedString(record, "Title");
}

function readWrappedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as RawRecord)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as RawRecord).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readRecordIdentity(record: unknown): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id = (record as RawRecord).id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }

  return readWrappedString(record, "NoteID");
}

function readPrimaryContactDetailsFromAccountPayload(account: unknown): {
  name: string | null;
  email: string | null;
} {
  if (!account || typeof account !== "object") {
    return {
      name: null,
      email: null,
    };
  }

  const accountRecord = account as RawRecord;
  const primaryContact = accountRecord.PrimaryContact;
  const primaryName = readContactDisplayName(primaryContact);
  const primaryEmail = readContactEmail(primaryContact);
  if (primaryName || primaryEmail) {
    return {
      name: primaryName,
      email: primaryEmail,
    };
  }

  const primaryContactId = readWrappedNumber(primaryContact, "ContactID");
  const contacts = readArrayField(accountRecord, "Contacts");
  if (contacts.length === 0) {
    return {
      name: null,
      email: null,
    };
  }

  const matchingContact =
    primaryContactId !== null
      ? contacts.find((contact) => readWrappedNumber(contact, "ContactID") === primaryContactId)
      : null;
  const fallbackContact = matchingContact ?? contacts[0];
  return {
    name: readContactDisplayName(fallbackContact),
    email: readContactEmail(fallbackContact),
  };
}

function normalizeComparable(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase();
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickFirstText(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (hasText(value)) {
      return value;
    }
  }

  return null;
}

function normalizeBusinessAccountCode(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toUpperCase();
}

function readBusinessAccountCode(record: unknown): string | null {
  return (
    readWrappedString(record, "BusinessAccountID") ??
    readWrappedString(record, "BAccountID") ??
    readWrappedString(record, "AccountCD")
  );
}

function readBusinessAccountName(record: unknown): string | null {
  return (
    readWrappedString(record, "Name") ??
    readWrappedString(record, "CompanyName") ??
    readWrappedString(record, "AcctName") ??
    readWrappedString(record, "BusinessAccountName")
  );
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

function readCreatedBusinessAccountIdentifiers(rawAccount: unknown): {
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
} {
  const businessAccountRecordId = readRecordIdentity(rawAccount);
  const businessAccountId =
    readWrappedString(rawAccount, "BusinessAccountID") ??
    readWrappedString(rawAccount, "BAccountID") ??
    readWrappedString(rawAccount, "AccountCD") ??
    readWrappedScalarString(rawAccount, "BusinessAccountID") ??
    readWrappedScalarString(rawAccount, "BAccountID") ??
    readWrappedScalarString(rawAccount, "AccountCD") ??
    null;

  return {
    businessAccountRecordId,
    businessAccountId: businessAccountId?.trim() || null,
  };
}

function buildAccountCreateFallbackAddress(
  payload: ReturnType<typeof parseBusinessAccountCreatePayload>,
): AddressInput {
  return {
    addressLine1: payload.addressLine1,
    addressLine2: payload.addressLine2,
    city: payload.city,
    state: payload.state,
    postalCode: payload.postalCode,
    country: "CA",
  };
}

function buildFallbackRowFromContact(contact: unknown, index: number): BusinessAccountRow {
  const contactId = readWrappedNumber(contact, "ContactID");
  const contactRecordId = readRecordIdentity(contact) ?? `contact-${contactId ?? index}`;
  const contactName = readContactDisplayName(contact);
  const contactEmail = readContactEmail(contact);
  const contactPhone = readContactPhone(contact);

  return {
    id: contactRecordId,
    accountRecordId: contactRecordId,
    rowKey: `${contactRecordId}:contact:${contactId ?? index}`,
    contactId,
    isPrimaryContact: false,
    phoneNumber: contactPhone,
    salesRepId: null,
    salesRepName: null,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: readContactBusinessAccountCode(contact, readWrappedString) ?? "",
    companyName: readContactCompanyName(contact, readWrappedString) ?? "",
    address: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    primaryContactName: contactName,
    primaryContactJobTitle: readContactJobTitle(contact),
    primaryContactPhone: contactPhone,
    primaryContactExtension: readContactExtension(contact),
    primaryContactRawPhone: readContactRawPhone(contact),
    primaryContactEmail: contactEmail,
    primaryContactId: contactId,
    category: null,
    notes: readWrappedString(contact, "note"),
    lastModifiedIso: readWrappedString(contact, "LastModifiedDateTime"),
  };
}

function buildSyncRowsFromContacts(
  rawContacts: unknown[],
  rawAccounts: unknown[],
): BusinessAccountRow[] {
  const accountByBusinessId = new Map<string, unknown>();
  rawAccounts.forEach((account) => {
    const businessId = readBusinessAccountCode(account);
    const normalizedBusinessId = normalizeBusinessAccountCode(businessId);
    if (normalizedBusinessId) {
      accountByBusinessId.set(normalizedBusinessId, account);
    }
  });

  type PreparedSyncRow = {
    row: BusinessAccountRow;
    accountKey: string;
    hint: {
      contactId: number | null;
      recordId: string | null;
      email: string | null;
      name: string | null;
    };
    candidate: {
      contactId: number | null;
      recordId: string | null;
      email: string | null;
      name: string | null;
      rowNumber: number | null;
    };
    basePrimary: {
      name: string | null;
      jobTitle: string | null;
      phone: string | null;
      extension: string | null;
      rawPhone: string | null;
      email: string | null;
      notes: string | null;
    };
  };

  const preparedRows: PreparedSyncRow[] = rawContacts.map((contact, index) => {
    const businessAccountCode = readContactBusinessAccountCode(contact, readWrappedString);
    const normalizedBusinessAccountCode = normalizeBusinessAccountCode(
      businessAccountCode,
    );
    const rawAccount = businessAccountCode
      ? accountByBusinessId.get(normalizedBusinessAccountCode)
      : undefined;

    const base = rawAccount
      ? normalizeBusinessAccount(rawAccount)
      : buildFallbackRowFromContact(contact, index);

    const primaryRaw =
      rawAccount && typeof rawAccount === "object"
        ? (rawAccount as RawRecord).PrimaryContact
        : undefined;
    const primaryContactId = readWrappedNumber(primaryRaw, "ContactID") ?? base.primaryContactId;
    const primaryContactName = readContactDisplayName(primaryRaw) ?? base.primaryContactName;
    const primaryContactEmail = readContactEmail(primaryRaw) ?? base.primaryContactEmail;
    const primaryRecordId = readRecordIdentity(primaryRaw);

    const contactId = readWrappedNumber(contact, "ContactID");
    const contactName = readContactDisplayName(contact);
    const contactJobTitle = readContactJobTitle(contact);
    const contactPhone = readContactPhone(contact);
    const contactExtension = readContactExtension(contact);
    const contactRawPhone = readContactRawPhone(contact);
    const contactEmail = readContactEmail(contact);
    const contactNotes = readWrappedString(contact, "note");
    const contactRecordId = readRecordIdentity(contact);

    const row: BusinessAccountRow = {
      ...base,
      rowKey: `${base.accountRecordId ?? base.id}:contact:${contactId ?? contactRecordId ?? index}`,
      accountRecordId: base.accountRecordId ?? base.id,
      businessAccountId: businessAccountCode ?? base.businessAccountId,
      companyName: hasText(businessAccountCode)
        ? pickFirstText([
            base.companyName,
            readContactCompanyName(contact, readWrappedString),
            businessAccountCode,
            contactName,
          ]) ?? ""
        : pickFirstText([
            base.companyName,
            readContactCompanyName(contact, readWrappedString),
          ]) ?? "",
      contactId,
      isPrimaryContact: false,
      primaryContactName: pickFirstText([contactName]),
      primaryContactJobTitle: pickFirstText([
        contactJobTitle,
        base.primaryContactJobTitle ?? null,
      ]),
      primaryContactPhone: pickFirstText([contactPhone]),
      primaryContactExtension: pickFirstText([
        contactExtension,
        base.primaryContactExtension ?? null,
      ]),
      primaryContactRawPhone: pickFirstText([
        contactRawPhone,
        base.primaryContactRawPhone ?? null,
      ]),
      primaryContactEmail: pickFirstText([contactEmail]),
      notes: pickFirstText([contactNotes]),
      phoneNumber: pickFirstText([base.phoneNumber, contactPhone, base.primaryContactPhone]),
      primaryContactId: primaryContactId ?? base.primaryContactId,
    };

    return {
      row,
      accountKey:
        (base.accountRecordId ?? "").trim() ||
        base.id.trim() ||
        (businessAccountCode ?? "").trim() ||
        base.businessAccountId.trim() ||
        base.companyName.trim() ||
        `row-${index}`,
      hint: {
        contactId: primaryContactId,
        recordId: primaryRecordId,
        email: primaryContactEmail,
        name: primaryContactName,
      },
      candidate: {
        contactId,
        recordId: contactRecordId,
        email: contactEmail,
        name: contactName,
        rowNumber: readWrappedNumber(contact, "rowNumber"),
      },
      basePrimary: {
        name: base.primaryContactName,
        jobTitle: base.primaryContactJobTitle ?? null,
        phone: base.primaryContactPhone,
        extension: base.primaryContactExtension ?? null,
        rawPhone: base.primaryContactRawPhone ?? null,
        email: base.primaryContactEmail,
        notes: base.notes,
      },
    };
  });

  const rowsByAccount = new Map<string, number[]>();
  preparedRows.forEach((preparedRow, index) => {
    const key = preparedRow.accountKey;
    const existing = rowsByAccount.get(key);
    if (existing) {
      existing.push(index);
    } else {
      rowsByAccount.set(key, [index]);
    }
  });

  rowsByAccount.forEach((rowIndexes) => {
    if (rowIndexes.length === 0) {
      return;
    }

    const hint = preparedRows[rowIndexes[0]]?.hint ?? {
      contactId: null,
      recordId: null,
      email: null,
      name: null,
    };

    const candidates = rowIndexes.map((rowIndex, candidateIndex) => {
      const candidate = preparedRows[rowIndex]?.candidate ?? {
        contactId: null,
        recordId: null,
        email: null,
        name: null,
        rowNumber: null,
      };
      return {
        contactId: candidate.contactId,
        recordId: candidate.recordId,
        email: candidate.email,
        name: candidate.name,
        rowNumber: candidate.rowNumber,
        index: candidateIndex,
      };
    });

    const selectedLocalIndex = selectPrimaryContactIndex(candidates, hint);
    if (selectedLocalIndex === null) {
      return;
    }

    const selectedRowIndex = rowIndexes[selectedLocalIndex];
    const selectedPrepared = preparedRows[selectedRowIndex];
    if (!selectedPrepared) {
      return;
    }

    preparedRows[selectedRowIndex] = {
      ...selectedPrepared,
      row: {
        ...selectedPrepared.row,
        isPrimaryContact: true,
        primaryContactName: pickFirstText([
          selectedPrepared.row.primaryContactName,
          selectedPrepared.basePrimary.name,
        ]),
        primaryContactJobTitle: pickFirstText([
          selectedPrepared.row.primaryContactJobTitle ?? null,
          selectedPrepared.basePrimary.jobTitle,
        ]),
        primaryContactPhone: pickFirstText([
          selectedPrepared.row.primaryContactPhone,
          selectedPrepared.basePrimary.phone,
        ]),
        primaryContactExtension: pickFirstText([
          selectedPrepared.row.primaryContactExtension ?? null,
          selectedPrepared.basePrimary.extension,
        ]),
        primaryContactRawPhone: pickFirstText([
          selectedPrepared.row.primaryContactRawPhone ?? null,
          selectedPrepared.basePrimary.rawPhone,
        ]),
        primaryContactEmail: pickFirstText([
          selectedPrepared.row.primaryContactEmail,
          selectedPrepared.basePrimary.email,
        ]),
        notes: pickFirstText([selectedPrepared.row.notes, selectedPrepared.basePrimary.notes]),
      },
    };
  });

  const cleanedRows = preparedRows.map((prepared) => prepared.row);

  return enforceSinglePrimaryPerAccountRows(cleanedRows).filter(
    (row) =>
      Boolean(
        row.id ||
          row.accountRecordId ||
          row.businessAccountId ||
          row.companyName ||
          row.primaryContactName,
      ),
  );
}

function needsPrimaryContactNameResolution(row: BusinessAccountRow): boolean {
  if (!hasText(row.primaryContactName)) {
    return true;
  }

  return normalizeComparable(row.primaryContactName) === normalizeComparable(row.companyName);
}

function needsPrimaryContactEmailResolution(row: BusinessAccountRow): boolean {
  return !hasText(row.primaryContactEmail);
}

function shouldResolvePrimaryContactName(row: BusinessAccountRow): boolean {
  if (row.isPrimaryContact === false) {
    return false;
  }

  return needsPrimaryContactNameResolution(row) || needsPrimaryContactEmailResolution(row);
}

async function runWithConcurrency<T>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  if (values.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.trunc(limit));
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(values[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => consume()),
  );
}

async function enrichPagePrimaryContacts(
  cookieValue: string,
  rows: BusinessAccountRow[],
  authCookieRefresh: AuthCookieRefresh,
): Promise<BusinessAccountRow[]> {
  const targets = rows.filter((row) => shouldResolvePrimaryContactName(row));
  if (targets.length === 0) {
    return rows;
  }

  const contactLookup = new Map<number, { name: string | null; email: string | null }>();
  const accountLookup = new Map<string, { name: string | null; email: string | null }>();

  await runWithConcurrency(targets, 8, async (row) => {
    const contactId = row.contactId ?? row.primaryContactId;
    if (contactId === null || contactLookup.has(contactId)) {
      return;
    }

    try {
      const contact = await fetchContactById(
        cookieValue,
        contactId,
        authCookieRefresh,
      );
      contactLookup.set(contactId, {
        name: readContactDisplayName(contact),
        email: readContactEmail(contact),
      });
    } catch {
      contactLookup.set(contactId, {
        name: null,
        email: null,
      });
    }
  });

  await runWithConcurrency(targets, 6, async (row) => {
    const accountId = row.accountRecordId ?? row.id;
    if (!accountId || accountLookup.has(accountId)) {
      return;
    }

    const contactId = row.contactId ?? row.primaryContactId;
    const resolvedFromContact = contactId !== null ? contactLookup.get(contactId) : undefined;
    const shouldFetchAccountForName =
      needsPrimaryContactNameResolution(row) && !hasText(resolvedFromContact?.name);
    const shouldFetchAccountForEmail =
      needsPrimaryContactEmailResolution(row) && !hasText(resolvedFromContact?.email);
    if (!shouldFetchAccountForName && !shouldFetchAccountForEmail) {
      return;
    }

    try {
      const account = await fetchBusinessAccountById(
        cookieValue,
        accountId,
        authCookieRefresh,
      );
      accountLookup.set(
        accountId,
        readPrimaryContactDetailsFromAccountPayload(account),
      );
    } catch {
      accountLookup.set(accountId, {
        name: null,
        email: null,
      });
    }
  });

  return rows.map((row) => {
    if (!shouldResolvePrimaryContactName(row)) {
      return row;
    }

    const contactId = row.contactId ?? row.primaryContactId;
    const resolvedFromContact = contactId !== null ? contactLookup.get(contactId) : undefined;
    const accountId = row.accountRecordId ?? row.id;
    const resolvedFromAccount = accountId ? accountLookup.get(accountId) : undefined;
    const resolvedName = resolvedFromContact?.name ?? resolvedFromAccount?.name ?? null;
    const resolvedEmail = resolvedFromContact?.email ?? resolvedFromAccount?.email ?? null;

    const currentName = row.primaryContactName;
    const shouldReplaceName = needsPrimaryContactNameResolution(row);
    const nextName = shouldReplaceName && hasText(resolvedName)
      ? resolvedName
      : currentName;
    const nextEmail =
      hasText(row.primaryContactEmail)
        ? row.primaryContactEmail
        : hasText(resolvedEmail)
          ? resolvedEmail
          : row.primaryContactEmail;

    if (nextName === row.primaryContactName && nextEmail === row.primaryContactEmail) {
      return row;
    }

    return {
      ...row,
      primaryContactName: nextName,
      primaryContactEmail: nextEmail,
    };
  });
}

async function queryAccountsWithCookie(
  cookieValue: string,
  params: ReturnType<typeof parseListQuery>,
  authCookieRefresh: AuthCookieRefresh,
  options?: {
    full?: boolean;
    includeInternal?: boolean;
  },
) {
  const { READ_MODEL_ENABLED } = getEnv();
  if (READ_MODEL_ENABLED) {
    maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
    const total = options?.full
      ? queryReadModelBusinessAccounts({
          ...params,
          includeInternalRows: options?.includeInternal,
          page: 1,
          pageSize: 1,
        }).total
      : null;
    const result = queryReadModelBusinessAccounts({
      ...params,
      includeInternalRows: options?.includeInternal,
      page: options?.full ? 1 : params.page,
      pageSize: options?.full ? Math.max(1, total ?? 1) : params.pageSize,
    });

    return result;
  }

  const isFullDatasetRequest = Boolean(options?.full);
  const rawAccounts = await fetchBusinessAccounts(
    cookieValue,
    {
      batchSize: isFullDatasetRequest ? 300 : 180,
      ensureMainAddress: true,
      ensurePrimaryContact: true,
      ensureAttributes: true,
      ensureContacts: true,
    },
    authCookieRefresh,
  );

  const allowedRawAccounts = rawAccounts.filter(
    (account) =>
      isAllowedBusinessAccountType(account) &&
      (options?.includeInternal ||
        !isExcludedInternalCompanyName(readBusinessAccountName(account))),
  );

  const normalizedRows = filterSuppressedBusinessAccountRows(
    allowedRawAccounts
    .flatMap((item) => normalizeBusinessAccountRows(item))
    .filter((item) => Boolean(item.id || item.businessAccountId || item.companyName)),
    {
      includeInternalRows: options?.includeInternal,
    },
  );
  const queried = queryBusinessAccounts(normalizedRows, {
    ...params,
    includeInternalRows: options?.includeInternal,
    page: isFullDatasetRequest ? 1 : params.page,
    pageSize: isFullDatasetRequest
      ? Math.max(1, normalizedRows.length)
      : params.pageSize,
  });

  if (isFullDatasetRequest) {
    return queried;
  }

  const activeCookie = authCookieRefresh.value ?? cookieValue;
  const enrichedItems = await enrichPagePrimaryContacts(
    activeCookie,
    queried.items,
    authCookieRefresh,
  );

  return {
    ...queried,
    items: enrichedItems,
  };
}

async function querySyncBatchWithCookie(
  cookieValue: string,
  params: ReturnType<typeof parseListQuery>,
  authCookieRefresh: AuthCookieRefresh,
  options?: {
    full?: boolean;
    includeInternal?: boolean;
  },
) {
  const { READ_MODEL_ENABLED } = getEnv();
  if (READ_MODEL_ENABLED) {
    maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
    if (options?.full) {
      const total = queryReadModelBusinessAccounts({
        ...params,
        includeInternalRows: options?.includeInternal,
        page: 1,
        pageSize: 1,
      }).total;
      return queryReadModelBusinessAccounts({
        ...params,
        includeInternalRows: options?.includeInternal,
        page: 1,
        pageSize: Math.max(1, total ?? 1),
      });
    }

    const result = queryReadModelBusinessAccounts({
      ...params,
      includeInternalRows: options?.includeInternal,
    });
    return {
      ...result,
      hasMore: params.page * params.pageSize < result.total,
    };
  }

  if (options?.full) {
    const { fetchAllSyncRows } = await import("@/lib/data-quality-live");
    const normalizedRows = await fetchAllSyncRows(cookieValue, authCookieRefresh, {
      includeInternal: options?.includeInternal,
    });

    return queryBusinessAccounts(normalizedRows, {
      ...params,
      includeInternalRows: options?.includeInternal,
      page: 1,
      pageSize: Math.max(1, normalizedRows.length),
    });
  }

  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, params.pageSize);
  const skip = (page - 1) * pageSize;

  const rawContactsPage = await fetchContacts(
    cookieValue,
    {
      batchSize: pageSize,
      maxRecords: pageSize,
      initialSkip: skip,
    },
    authCookieRefresh,
  );
  const rawContacts = rawContactsPage.filter(
    (contact) =>
      !shouldExcludeContactByApToken(contact) &&
      (options?.includeInternal || !isExcludedInternalContactEmail(readContactEmail(contact))) &&
      (options?.includeInternal ||
        !isExcludedInternalCompanyName(readContactCompanyName(contact, readWrappedString))),
  );

  const businessAccountIds = rawContacts
    .map((contact) => readContactBusinessAccountCode(contact, readWrappedString))
    .filter((id): id is string => Boolean(id));

  const rawAccounts = await fetchBusinessAccountsByBusinessAccountIds(
    cookieValue,
    businessAccountIds,
    authCookieRefresh,
  );

  const accountTypeByBusinessId = new Map<string, "allowed" | "blocked">();
  rawAccounts.forEach((account) => {
    const businessId = readBusinessAccountCode(account);
    const normalizedBusinessId = normalizeBusinessAccountCode(businessId);
    if (!normalizedBusinessId) {
      return;
    }

    accountTypeByBusinessId.set(
      normalizedBusinessId,
      isAllowedBusinessAccountType(account) &&
        (options?.includeInternal || !isExcludedInternalCompanyName(readBusinessAccountName(account)))
        ? "allowed"
        : "blocked",
    );
  });

  const normalizedRows = filterSuppressedBusinessAccountRows(
    buildSyncRowsFromContacts(rawContacts, rawAccounts).filter((row) => {
      const normalizedBusinessId = normalizeBusinessAccountCode(row.businessAccountId);
      if (!normalizedBusinessId) {
        return false;
      }

      return accountTypeByBusinessId.get(normalizedBusinessId) === "allowed";
    }),
    {
      includeInternalRows: options?.includeInternal,
    },
  );
  const queried = queryBusinessAccounts(normalizedRows, {
    ...params,
    includeInternalRows: options?.includeInternal,
    page: 1,
    pageSize: Math.max(1, normalizedRows.length),
  });
  const hasMore = rawContactsPage.length === pageSize;
  const estimatedTotal = hasMore
    ? skip + rawContactsPage.length + pageSize
    : skip + rawContactsPage.length;

  return {
    items: queried.items,
    total: estimatedTotal,
    page,
    pageSize,
    hasMore,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefresh = { value: null };
  let actor: Awaited<ReturnType<typeof resolveDeferredActionActor>> | null = null;
  let createRequest: ReturnType<typeof parseBusinessAccountCreatePayload> | null = null;

  try {
    const cookieValue = requireAuthCookieValue(request);
    actor = await resolveDeferredActionActor(request, cookieValue, authCookieRefresh);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    createRequest = parseBusinessAccountCreatePayload(body);

    const normalizedAddress = await retrieveCanadaPostAddressCompleteAddress({
      id: createRequest.addressLookupId,
      fallback: buildAccountCreateFallbackAddress(createRequest),
    });

    const effectiveRequest = {
      ...createRequest,
      addressLine1: normalizedAddress.addressLine1,
      addressLine2: createRequest.addressLine2,
      city: normalizedAddress.city,
      state: normalizedAddress.state,
      postalCode: normalizedAddress.postalCode,
      country: "CA" as const,
    };

    const createdRaw = await createBusinessAccount(
      cookieValue,
      buildBusinessAccountCreatePayload(effectiveRequest),
      authCookieRefresh,
    );

    let identifiers = readCreatedBusinessAccountIdentifiers(createdRaw);
    const warnings: string[] = [];
    let accountSource = createdRaw;
    if (identifiers.businessAccountRecordId || identifiers.businessAccountId) {
      try {
        const refetchIdentifier =
          identifiers.businessAccountRecordId || identifiers.businessAccountId;
        if (!refetchIdentifier) {
          throw new HttpError(500, "Created account identifier is missing.");
        }
        accountSource = await fetchBusinessAccountById(
          cookieValue,
          refetchIdentifier,
          authCookieRefresh,
        );
        const refreshedIdentifiers = readCreatedBusinessAccountIdentifiers(accountSource);
        identifiers = {
          businessAccountRecordId:
            refreshedIdentifiers.businessAccountRecordId ?? identifiers.businessAccountRecordId,
          businessAccountId:
            refreshedIdentifiers.businessAccountId ?? identifiers.businessAccountId,
        };
      } catch {
        warnings.push(
          "Business account was created, but the app could not refresh the full record. Sync records if details look incomplete.",
        );
      }
    }

    if (!identifiers.businessAccountId) {
      throw new HttpError(
        502,
        "Acumatica created the account but did not return a Business Account ID.",
      );
    }

    const accountRows = normalizeCreatedBusinessAccountRows(accountSource);
    const createdRow =
      accountRows.find((row) => (row.accountRecordId ?? row.id) === identifiers.businessAccountRecordId) ??
      accountRows[0];

    if (!createdRow) {
      throw new HttpError(
        502,
        "Acumatica created the account but the app could not normalize the created record.",
      );
    }

    const responseBody: BusinessAccountCreateResponse = {
      created: true,
      businessAccountRecordId:
        identifiers.businessAccountRecordId ?? createdRow.accountRecordId ?? createdRow.id,
      businessAccountId: identifiers.businessAccountId,
      accountRows,
      createdRow,
      warnings,
    };

    saveAccountCompanyDescription({
      accountRecordId: responseBody.businessAccountRecordId,
      businessAccountId: responseBody.businessAccountId,
      companyDescription: createRequest.companyDescription,
    });

    const responseRows = applyLocalAccountMetadataToRows(responseBody.accountRows);
    const responseCreatedRow =
      applyLocalAccountMetadataToRow(responseBody.createdRow) ?? responseBody.createdRow;

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(
        responseBody.businessAccountRecordId,
        responseBody.accountRows,
      );
    }

    logBusinessAccountCreateAudit({
      actor,
      request: createRequest,
      resultCode: "succeeded",
      sourceSurface: "accounts",
      businessAccountRecordId: responseBody.businessAccountRecordId,
      businessAccountId: responseBody.businessAccountId,
      companyName: responseBody.createdRow.companyName,
      createdRow: responseBody.createdRow,
    });

    const response = NextResponse.json(
      {
        ...responseBody,
        accountRows: responseRows,
        createdRow: responseCreatedRow,
      },
      { status: 201 },
    );
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    if (actor && createRequest) {
      logBusinessAccountCreateAudit({
        actor,
        request: createRequest,
        resultCode: "failed",
        sourceSurface: "accounts",
        companyName: createRequest.companyName,
      });
    }

    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid create payload",
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefresh = { value: null };
  let cookieValue: string | null = null;
  let params: ReturnType<typeof parseListQuery> | null = null;
  const fullDataset =
    request.nextUrl.searchParams.get("full") === "1" ||
    request.nextUrl.searchParams.get("full") === "true";
  const syncBatch =
    request.nextUrl.searchParams.get("sync") === "1" ||
    request.nextUrl.searchParams.get("sync") === "true";
  const includeInternal =
    request.nextUrl.searchParams.get("includeInternal") === "1" ||
    request.nextUrl.searchParams.get("includeInternal") === "true";
  const shouldUseSyncDataset = syncBatch || (fullDataset && includeInternal);

  try {
    cookieValue = requireAuthCookieValue(request);
    params = parseListQuery(request.nextUrl.searchParams);
    const result = shouldUseSyncDataset
      ? await querySyncBatchWithCookie(cookieValue, params, authCookieRefresh, {
          full: fullDataset,
          includeInternal,
        })
      : await queryAccountsWithCookie(
          cookieValue,
          params,
          authCookieRefresh,
          {
            full: fullDataset,
            includeInternal,
          },
        );

    const response = NextResponse.json({
      ...result,
      items: applyLocalAccountMetadataToRows(result.items),
    });
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
      params
    ) {
      const retryAuthCookieRefresh: AuthCookieRefresh = { value: null };
      const retryCookieValue = authCookieRefresh.value ?? cookieValue;
      try {
        const retryResult = shouldUseSyncDataset
          ? await querySyncBatchWithCookie(
              retryCookieValue,
              params,
              retryAuthCookieRefresh,
              {
                full: fullDataset,
                includeInternal,
              },
            )
          : await queryAccountsWithCookie(
              retryCookieValue,
              params,
              retryAuthCookieRefresh,
              {
                full: fullDataset,
                includeInternal,
              },
            );

        const response = NextResponse.json({
          ...retryResult,
          items: applyLocalAccountMetadataToRows(retryResult.items),
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
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid query parameters",
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
