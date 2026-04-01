#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";

import {
  buildCookieHeader,
  buildStoredAuthCookieValueFromSetCookies,
  getSetCookieHeaders,
} from "@/lib/auth";
import {
  createBusinessAccount,
  createContact,
  fetchBusinessAccounts,
  fetchBusinessAccountById,
  fetchContactsByBusinessAccountIds,
  readWrappedNumber,
  updateBusinessAccount,
} from "@/lib/acumatica";
import {
  buildBusinessAccountCreatePayload,
  buildContactCreatePayload,
} from "@/lib/business-account-create";
import {
  normalizeBusinessAccountRows,
  resolveCompanyPhone,
} from "@/lib/business-accounts";
import { readContactBusinessAccountCode } from "@/lib/contact-business-account";
import { getEnv } from "@/lib/env";
import { getErrorMessage, HttpError } from "@/lib/errors";
import {
  formatPhoneForDisplay,
  normalizeExtensionForSave,
  normalizePhoneForSave,
  parsePhoneWithExtension,
  resolvePrimaryContactPhoneFields,
} from "@/lib/phone";
import { readSalesRepDirectorySnapshot } from "@/lib/read-model/sales-reps";
import { triggerReadModelSync, waitForReadModelSync } from "@/lib/read-model/sync";
import type {
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
  Category,
} from "@/types/business-account";
import type {
  BusinessAccountClassCode,
  ContactClassKey,
} from "@/types/business-account-create";

loadEnvConfig(process.cwd());

type AuthCookieRefresh = {
  value: string | null;
};

type WorkbookRow = {
  rowNumber: number;
  week: string;
  priority: string;
  companyName: string;
  contact1Name: string | null;
  contact1Phone: string | null;
  contact1Email: string | null;
  city: string;
  streetAddress: string;
  postalCode: string;
  provinceState: string;
  contact2Name: string | null;
  contact2Phone: string | null;
  contact2Email: string | null;
};

type StagedContact = {
  displayName: string;
  email: string | null;
  phone: string | null;
  extension: string | null;
  jobTitle: string;
  contactClass: ContactClassKey;
  sourceRows: number[];
  sourceSlots: string[];
  desiredPrimary: boolean;
};

type StagedAccount = {
  sourceKey: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: "CA";
  week: string | null;
  category: Category;
  accountPhone: string | null;
  sourceRows: number[];
  contacts: StagedContact[];
  conflicts: string[];
};

type ExistingContact = {
  contactId: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  extension: string | null;
  isPrimary: boolean;
};

type ExistingAccountGroup = {
  groupKey: string;
  accountRecordId: string;
  businessAccountId: string;
  representativeRow: BusinessAccountRow;
  rows: BusinessAccountRow[];
  contacts: ExistingContact[];
  contactCount: number;
};

type MatchResult = {
  account: ExistingAccountGroup | null;
  matchType: string;
  ambiguousCandidates: ExistingAccountGroup[];
};

type ReportAccountAction = {
  sourceKey: string;
  companyName: string;
  matchType: string;
  sourceRows: number[];
  action: "create" | "update" | "skip";
  businessAccountId?: string;
  accountRecordId?: string;
  createdClass?: BusinessAccountClassCode;
  updatedFields?: string[];
  ambiguousExistingAccountIds?: string[];
  contactsCreated: Array<{
    name: string;
    contactId: number;
  }>;
  contactsSkipped: Array<{
    name: string;
    reason: string;
  }>;
  conflicts: string[];
  warning?: string;
  error?: string;
};

type ReportSummary = {
  stagedAccounts: number;
  stagedContacts: number;
  matchedAccounts: number;
  createdAccounts: number;
  updatedAccounts: number;
  skippedAccounts: number;
  createdContacts: number;
  skippedContacts: number;
  failedAccounts: number;
};

type ImportReport = {
  startedAt: string;
  finishedAt?: string;
  dryRun: boolean;
  workbookPath: string;
  summary: ReportSummary;
  accounts: ReportAccountAction[];
};

type ImportOptions = {
  apply: boolean;
  limit: number | null;
  workbookPath: string;
  reportPath: string;
  salesRepId: string | null;
  salesRepName: string | null;
};

type ParsedPhone = {
  phone: string | null;
  extension: string | null;
};

type UnknownRecord = Record<string, unknown>;

type ResolvedSalesRep = {
  salesRepId: string | null;
  salesRepName: string | null;
};

const REQUEST_DELAY_MS = 100;
const LOGIN_RETRY_LIMIT = 20;
const LOGIN_RETRY_DELAY_MS = 15_000;
const DEFAULT_REPORT_PATH = path.join(process.cwd(), "data", "craigs-data-import-report.json");
const DEFAULT_WORKBOOK_PATH = path.join(
  process.cwd(),
  "Sales Reps Data",
  "Craigs data.xlsx",
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

function readWrappedString(record: unknown, key: string): string | null {
  if (!isRecord(record)) {
    return null;
  }

  const field = record[key];
  if (!isRecord(field)) {
    return null;
  }

  const value = field.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readArrayField(record: unknown, key: string): unknown[] {
  if (!isRecord(record)) {
    return [];
  }

  const field = record[key];
  if (Array.isArray(field)) {
    return field;
  }

  if (!isRecord(field)) {
    return [];
  }

  if (Array.isArray(field.value)) {
    return field.value;
  }

  if (Array.isArray(field.Items)) {
    return field.Items;
  }

  return [];
}

function resolveSalesRepOwnerReference(
  salesRepId: string | null,
  salesRepName: string | null,
): ResolvedSalesRep {
  if (!salesRepId && !salesRepName) {
    return {
      salesRepId: null,
      salesRepName: null,
    };
  }

  const directory = readSalesRepDirectorySnapshot().items;
  const trimmedId = trimToNull(salesRepId);
  const trimmedName = trimToNull(salesRepName);
  const normalizedName = trimmedName?.toLowerCase() ?? "";

  const match =
    directory.find((item) => item.id === trimmedId || item.ownerReferenceId === trimmedId) ??
    directory.find((item) => item.normalizedName === normalizedName);

  if (!match?.ownerReferenceId) {
    return {
      salesRepId: trimmedId,
      salesRepName: trimmedName,
    };
  }

  if (match.ownerReferenceId !== trimmedId) {
    process.stdout.write(
      `Resolved sales rep ${match.id} (${match.name}) to owner reference ${match.ownerReferenceId}.\n`,
    );
  }

  return {
    salesRepId: match.ownerReferenceId,
    salesRepName: trimmedName ?? match.name,
  };
}

function trimToNull(value: string | null | undefined): string | null {
  if (!hasText(value)) {
    return null;
  }

  return value.trim();
}

function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function canonicalWeek(value: string | null | undefined): string | null {
  if (!hasText(value)) {
    return null;
  }

  const match = value.trim().match(/^week\s*(\d+)$/i);
  if (!match) {
    return collapseWhitespace(value) || null;
  }

  return `Week ${match[1]}`;
}

function weekSortValue(value: string | null | undefined): number {
  const match = canonicalWeek(value)?.match(/^Week (\d+)$/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function betterWeek(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return weekSortValue(left) <= weekSortValue(right) ? left : right;
}

function categoryRank(value: Category): number {
  return {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
  }[value];
}

function betterCategory(left: Category, right: Category): Category {
  return categoryRank(left) <= categoryRank(right) ? left : right;
}

function normalizeCategory(value: string): Category {
  const normalized = collapseWhitespace(value).toUpperCase();
  if (normalized === "A" || normalized === "B" || normalized === "C" || normalized === "D") {
    return normalized;
  }

  throw new Error(`Unsupported category value: ${value}`);
}

function toTitleCase(value: string): string {
  const lower = collapseWhitespace(value).toLowerCase();
  if (!lower) {
    return "";
  }

  return lower.replace(/\b([a-z])([a-z]*)/g, (_match, first: string, rest: string) => {
    return `${first.toUpperCase()}${rest}`;
  });
}

function normalizeCity(value: string): string {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) {
    return "";
  }

  if (collapsed === collapsed.toUpperCase() || collapsed === collapsed.toLowerCase()) {
    return toTitleCase(collapsed);
  }

  return collapsed;
}

function normalizePostalCode(value: string): string {
  const stripped = collapseWhitespace(value).toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(stripped)) {
    return `${stripped.slice(0, 3)} ${stripped.slice(3)}`;
  }

  return stripped;
}

function normalizeState(value: string): string {
  return collapseWhitespace(value).toUpperCase();
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = trimToNull(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

function normalizeComparable(value: string | null | undefined): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStreetToken(token: string): string {
  const map: Record<string, string> = {
    avenue: "ave",
    boulevard: "blvd",
    court: "ct",
    crescent: "cres",
    drive: "dr",
    east: "e",
    expressway: "expy",
    highway: "hwy",
    lane: "ln",
    north: "n",
    parkway: "pkwy",
    place: "pl",
    road: "rd",
    south: "s",
    square: "sq",
    street: "st",
    suite: "ste",
    terrace: "terr",
    unit: "unit",
    west: "w",
  };

  return map[token] ?? token;
}

function normalizeAddressComparable(value: string | null | undefined): string {
  return normalizeComparable(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => normalizeStreetToken(token))
    .join(" ");
}

function normalizeAdministrativeCodeComparable(value: string | null | undefined): string {
  const collapsed = collapseWhitespace(value).toUpperCase();
  const match = collapsed.match(/^([A-Z]{2,3})\s*-/);
  if (match?.[1]) {
    return normalizeComparable(match[1]);
  }

  return normalizeComparable(value);
}

function stripCompanySuffixes(value: string): string {
  const suffixes = new Set([
    "inc",
    "incorporated",
    "corp",
    "corporation",
    "co",
    "company",
    "ltd",
    "limited",
    "llc",
    "lp",
    "plc",
    "canada",
  ]);

  const tokens = normalizeComparable(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !suffixes.has(token));

  return tokens.join(" ").trim();
}

function buildAddressKey(parts: {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  withPostalCode?: boolean;
}): string {
  return [
    normalizeAddressComparable(parts.addressLine1),
    normalizeAddressComparable(parts.addressLine2),
    normalizeComparable(parts.city),
    normalizeAdministrativeCodeComparable(parts.state),
    parts.withPostalCode === false ? "" : normalizeComparable(parts.postalCode),
    normalizeAdministrativeCodeComparable(parts.country),
  ].join("|");
}

function buildStrictAccountKey(companyName: string, address: Parameters<typeof buildAddressKey>[0]): string {
  return `${normalizeComparable(companyName)}|${buildAddressKey(address)}`;
}

function buildStrippedAccountKey(
  companyName: string,
  address: Parameters<typeof buildAddressKey>[0],
): string {
  return `${stripCompanySuffixes(companyName)}|${buildAddressKey(address)}`;
}

function buildStrictAccountKeyNoPostal(
  companyName: string,
  address: Parameters<typeof buildAddressKey>[0],
): string {
  return `${normalizeComparable(companyName)}|${buildAddressKey({ ...address, withPostalCode: false })}`;
}

function buildStrippedAccountKeyNoPostal(
  companyName: string,
  address: Parameters<typeof buildAddressKey>[0],
): string {
  return `${stripCompanySuffixes(companyName)}|${buildAddressKey({ ...address, withPostalCode: false })}`;
}

function normalizeContactName(value: string | null | undefined): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed) {
    return null;
  }

  const withoutEmbeddedEmail = trimmed.replace(/\s*\(([^)]*@[^)]*)\)\s*$/i, "").trim();
  return withoutEmbeddedEmail || null;
}

function extractEmbeddedEmail(value: string | null | undefined): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/\(([^)]*@[^)]*)\)\s*$/i);
  return match?.[1] ? normalizeEmail(match[1]) : null;
}

function splitDisplayName(displayName: string): { firstName: string | null; lastName: string } {
  const parts = collapseWhitespace(displayName).split(" ").filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: null,
      lastName: displayName,
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? displayName,
  };
}

function parsePhoneValue(value: string | null | undefined): ParsedPhone {
  const parsed = parsePhoneWithExtension(value);
  if (parsed.kind === "plain_phone" || parsed.kind === "phone_with_extension") {
    return {
      phone: parsed.phone,
      extension: parsed.extension,
    };
  }

  return {
    phone: normalizePhoneForSave(value),
    extension: null,
  };
}

function contactNameKey(value: string | null | undefined): string {
  return normalizeComparable(value);
}

function contactIdentityKey(contact: {
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const email = normalizeEmail(contact.email);
  if (email) {
    return `email:${email}`;
  }

  const name = contactNameKey(contact.displayName ?? contact.name);
  const phone = normalizePhoneForSave(contact.phone);
  if (name && phone) {
    return `name-phone:${name}|${phone}`;
  }

  if (name) {
    return `name:${name}`;
  }

  return `phone:${normalizePhoneForSave(contact.phone) ?? normalizeComparable(contact.phone ?? "")}`;
}

function stagedContactMatchKey(contact: StagedContact): string {
  return contactIdentityKey(contact);
}

function existingContactMatchKey(contact: ExistingContact): string {
  return contactIdentityKey(contact);
}

function readContactDisplayName(record: unknown): string | null {
  const explicit = [
    "DisplayName",
    "FullName",
    "ContactName",
    "Attention",
  ]
    .map((key) => readWrappedString(record, key))
    .find((value): value is string => Boolean(value));
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
  return normalizeEmail(
    readWrappedString(record, "Email") ?? readWrappedString(record, "EMail"),
  );
}

function normalizeBusinessAccountIdKey(value: string | null | undefined): string {
  return collapseWhitespace(value).toUpperCase();
}

function toExistingContact(record: unknown): ExistingContact | null {
  const phoneFields = resolvePrimaryContactPhoneFields({
    phone1: readWrappedString(record, "Phone1"),
    phone2: readWrappedString(record, "Phone2"),
    phone3: readWrappedString(record, "Phone3"),
  });

  const candidate: ExistingContact = {
    contactId: readWrappedNumber(record, "ContactID"),
    name: trimToNull(readContactDisplayName(record)),
    email: readContactEmail(record),
    phone: formatPhoneForDisplay(phoneFields.phone),
    extension: normalizeExtensionForSave(phoneFields.extension),
    isPrimary: false,
  };

  if (!candidate.contactId && !candidate.name && !candidate.email && !candidate.phone) {
    return null;
  }

  return candidate;
}

function mergeExistingContacts(...lists: ExistingContact[][]): ExistingContact[] {
  const byKey = new Map<string, ExistingContact>();

  for (const list of lists) {
    for (const contact of list) {
      const key = existingContactMatchKey(contact);
      const existing = byKey.get(key);
      if (existing) {
        existing.isPrimary = existing.isPrimary || contact.isPrimary;
        existing.contactId = existing.contactId ?? contact.contactId;
        existing.email = existing.email ?? contact.email;
        existing.phone = existing.phone ?? contact.phone;
        existing.extension = existing.extension ?? contact.extension;
        existing.name = existing.name ?? contact.name;
        continue;
      }

      byKey.set(key, {
        ...contact,
      });
    }
  }

  return [...byKey.values()];
}

function buildExistingContactsByBusinessAccountId(rawContacts: unknown[]): Map<string, ExistingContact[]> {
  const grouped = new Map<string, ExistingContact[]>();

  for (const rawContact of rawContacts) {
    const businessAccountId = normalizeBusinessAccountIdKey(
      readContactBusinessAccountCode(rawContact, readWrappedString),
    );
    if (!businessAccountId) {
      continue;
    }

    const contact = toExistingContact(rawContact);
    if (!contact) {
      continue;
    }

    const existing = grouped.get(businessAccountId) ?? [];
    existing.push(contact);
    grouped.set(businessAccountId, existing);
  }

  for (const [businessAccountId, contacts] of grouped.entries()) {
    grouped.set(businessAccountId, mergeExistingContacts(contacts));
  }

  return grouped;
}

function shouldTreatAsSameContact(staged: StagedContact, existing: ExistingContact): boolean {
  const stagedEmail = normalizeEmail(staged.email);
  const existingEmail = normalizeEmail(existing.email);
  if (stagedEmail && existingEmail) {
    return stagedEmail === existingEmail;
  }

  const stagedName = contactNameKey(staged.displayName);
  const existingName = contactNameKey(existing.name);
  if (stagedName && existingName && stagedName === existingName) {
    const stagedPhone = normalizePhoneForSave(staged.phone);
    const existingPhone = normalizePhoneForSave(existing.phone);
    if (stagedPhone && existingPhone) {
      return stagedPhone === existingPhone;
    }

    if (!stagedEmail && !existingEmail) {
      return true;
    }
  }

  return false;
}

function chooseRepresentativeRow(rows: BusinessAccountRow[]): BusinessAccountRow {
  return (
    rows.find((row) => row.isPrimaryContact) ??
    rows.find((row) => row.primaryContactId !== null) ??
    rows[0]
  );
}

function uniqueContacts(rows: BusinessAccountRow[]): ExistingContact[] {
  const byKey = new Map<string, ExistingContact>();

  for (const row of rows) {
    const candidate: ExistingContact = {
      contactId: row.contactId ?? row.primaryContactId ?? null,
      name: trimToNull(row.primaryContactName),
      email: normalizeEmail(row.primaryContactEmail),
      phone: formatPhoneForDisplay(row.primaryContactPhone),
      extension: normalizeExtensionForSave(row.primaryContactExtension ?? null),
      isPrimary: row.isPrimaryContact === true || row.contactId === row.primaryContactId,
    };

    if (!candidate.contactId && !candidate.name && !candidate.email && !candidate.phone) {
      continue;
    }

    const key = existingContactMatchKey(candidate);
    const existing = byKey.get(key);
    if (existing) {
      existing.isPrimary = existing.isPrimary || candidate.isPrimary;
      existing.contactId = existing.contactId ?? candidate.contactId;
      existing.email = existing.email ?? candidate.email;
      existing.phone = existing.phone ?? candidate.phone;
      existing.extension = existing.extension ?? candidate.extension;
      existing.name = existing.name ?? candidate.name;
      continue;
    }

    byKey.set(key, candidate);
  }

  return [...byKey.values()];
}

function buildExistingAccountGroups(rows: BusinessAccountRow[]): ExistingAccountGroup[] {
  const grouped = new Map<string, BusinessAccountRow[]>();

  for (const row of rows) {
    const key = trimToNull(row.accountRecordId) ?? trimToNull(row.id) ?? trimToNull(row.businessAccountId);
    if (!key) {
      continue;
    }

    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  return [...grouped.entries()].map(([groupKey, groupRows]) => {
    const representativeRow = chooseRepresentativeRow(groupRows);
    const contacts = uniqueContacts(groupRows);

    return {
      groupKey,
      accountRecordId: representativeRow.accountRecordId ?? representativeRow.id,
      businessAccountId: representativeRow.businessAccountId,
      representativeRow,
      rows: groupRows,
      contacts,
      contactCount: contacts.length,
    };
  });
}

function buildExistingAccountGroupsFromRawAccounts(rawAccounts: unknown[]): ExistingAccountGroup[] {
  return buildExistingAccountGroups(
    rawAccounts.flatMap((rawAccount) => normalizeBusinessAccountRows(rawAccount)),
  );
}

function indexExistingAccounts(groups: ExistingAccountGroup[]) {
  const exact = new Map<string, ExistingAccountGroup[]>();
  const stripped = new Map<string, ExistingAccountGroup[]>();
  const exactNoPostal = new Map<string, ExistingAccountGroup[]>();
  const strippedNoPostal = new Map<string, ExistingAccountGroup[]>();

  for (const group of groups) {
    const address = {
      addressLine1: group.representativeRow.addressLine1,
      addressLine2: group.representativeRow.addressLine2,
      city: group.representativeRow.city,
      state: group.representativeRow.state,
      postalCode: group.representativeRow.postalCode,
      country: group.representativeRow.country,
    };

    const keys = [
      [exact, buildStrictAccountKey(group.representativeRow.companyName, address)],
      [stripped, buildStrippedAccountKey(group.representativeRow.companyName, address)],
      [exactNoPostal, buildStrictAccountKeyNoPostal(group.representativeRow.companyName, address)],
      [
        strippedNoPostal,
        buildStrippedAccountKeyNoPostal(group.representativeRow.companyName, address),
      ],
    ] as const;

    for (const [index, key] of keys) {
      const existing = index.get(key);
      if (existing) {
        existing.push(group);
      } else {
        index.set(key, [group]);
      }
    }
  }

  return {
    exact,
    stripped,
    exactNoPostal,
    strippedNoPostal,
  };
}

function pickBestExistingAccount(
  source: StagedAccount,
  candidates: ExistingAccountGroup[],
): ExistingAccountGroup {
  const sourceCompanyComparable = normalizeComparable(source.companyName);

  return [...candidates].sort((left, right) => {
    const leftExact = normalizeComparable(left.representativeRow.companyName) === sourceCompanyComparable;
    const rightExact = normalizeComparable(right.representativeRow.companyName) === sourceCompanyComparable;
    if (leftExact !== rightExact) {
      return leftExact ? -1 : 1;
    }

    if (left.contactCount !== right.contactCount) {
      return right.contactCount - left.contactCount;
    }

    return left.businessAccountId.localeCompare(right.businessAccountId);
  })[0] as ExistingAccountGroup;
}

function matchExistingAccount(
  source: StagedAccount,
  indexes: ReturnType<typeof indexExistingAccounts>,
): MatchResult {
  const address = {
    addressLine1: source.addressLine1,
    addressLine2: source.addressLine2,
    city: source.city,
    state: source.state,
    postalCode: source.postalCode,
    country: source.country,
  };

  const attempts = [
    {
      matchType: "exact-name-address-postal",
      candidates: indexes.exact.get(buildStrictAccountKey(source.companyName, address)) ?? [],
    },
    {
      matchType: "stripped-name-address-postal",
      candidates: indexes.stripped.get(buildStrippedAccountKey(source.companyName, address)) ?? [],
    },
    {
      matchType: "exact-name-address",
      candidates:
        indexes.exactNoPostal.get(buildStrictAccountKeyNoPostal(source.companyName, address)) ?? [],
    },
    {
      matchType: "stripped-name-address",
      candidates:
        indexes.strippedNoPostal.get(
          buildStrippedAccountKeyNoPostal(source.companyName, address),
        ) ?? [],
    },
  ];

  for (const attempt of attempts) {
    if (attempt.candidates.length === 0) {
      continue;
    }

    return {
      account: pickBestExistingAccount(source, attempt.candidates),
      matchType: attempt.matchType,
      ambiguousCandidates: attempt.candidates.length > 1 ? attempt.candidates : [],
    };
  }

  return {
    account: null,
    matchType: "new-account",
    ambiguousCandidates: [],
  };
}

function buildAccountUpdateRequest(
  existing: BusinessAccountRow,
  source: StagedAccount,
  options?: {
    salesRepId?: string | null;
    salesRepName?: string | null;
  },
): BusinessAccountUpdateRequest {
  return {
    companyName: existing.companyName,
    companyDescription: existing.companyDescription ?? null,
    assignedBusinessAccountRecordId: existing.accountRecordId ?? existing.id,
    assignedBusinessAccountId: existing.businessAccountId,
    addressLine1: existing.addressLine1,
    addressLine2: existing.addressLine2,
    city: existing.city,
    state: existing.state,
    postalCode: existing.postalCode,
    country: existing.country || "CA",
    targetContactId: null,
    setAsPrimaryContact: false,
    primaryOnlyIntent: false,
    contactOnlyIntent: false,
    salesRepId: options?.salesRepId ?? existing.salesRepId,
    salesRepName: options?.salesRepName ?? existing.salesRepName,
    industryType: existing.industryType,
    subCategory: existing.subCategory,
    companyRegion: existing.companyRegion,
    week: source.week,
    companyPhone: resolveCompanyPhone(existing) ?? source.accountPhone,
    primaryContactName: existing.primaryContactName,
    primaryContactJobTitle: existing.primaryContactJobTitle ?? null,
    primaryContactPhone: existing.primaryContactPhone,
    primaryContactExtension: existing.primaryContactExtension ?? null,
    primaryContactEmail: existing.primaryContactEmail,
    category: source.category,
    notes: existing.notes,
    expectedLastModified: existing.lastModifiedIso,
  };
}

function buildBusinessAccountIdentityPayload(record: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const rawId = isRecord(record) && typeof record.id === "string" ? record.id.trim() : "";
  if (rawId) {
    payload.id = rawId;
  }

  const noteId = readWrappedString(record, "NoteID");
  if (noteId) {
    payload.NoteID = {
      value: noteId,
    };
  }

  const businessAccountId =
    readWrappedString(record, "BusinessAccountID") ??
    readWrappedString(record, "BAccountID") ??
    readWrappedString(record, "AccountCD");
  if (businessAccountId) {
    payload.BusinessAccountID = {
      value: businessAccountId,
    };
  }

  return payload;
}

function upsertAttributeValue(
  attributes: unknown[],
  attributeId: string,
  value: string,
): unknown[] {
  let hasExisting = false;

  const next = attributes.map((attribute) => {
    const currentAttributeId = readWrappedString(attribute, "AttributeID");
    if (currentAttributeId !== attributeId) {
      return attribute;
    }

    hasExisting = true;
    return {
      ...(isRecord(attribute) ? attribute : {}),
      AttributeID: {
        value: attributeId,
      },
      Value: {
        value,
      },
    };
  });

  if (!hasExisting) {
    next.push({
      AttributeID: {
        value: attributeId,
      },
      Value: {
        value,
      },
    });
  }

  return next;
}

function buildWeekCategoryUpdatePayload(
  existingRawAccount: unknown,
  update: BusinessAccountUpdateRequest,
): Record<string, unknown> {
  let attributes = [...readArrayField(existingRawAccount, "Attributes")];
  attributes = upsertAttributeValue(attributes, "CLIENTTYPE", update.category ?? "");

  const normalizedWeek = canonicalWeek(update.week);
  if (normalizedWeek) {
    attributes = upsertAttributeValue(attributes, "WEEK", normalizedWeek);
  }

  return {
    ...buildBusinessAccountIdentityPayload(existingRawAccount),
    ...(update.salesRepId
      ? {
          Owner: {
            value: update.salesRepId,
          },
        }
      : {}),
    Attributes: attributes,
  };
}

function needsAccountUpdate(
  existing: BusinessAccountRow,
  source: StagedAccount,
  options?: {
    salesRepId?: string | null;
  },
): string[] {
  const changed: string[] = [];

  if ((existing.week ?? null) !== source.week) {
    changed.push("week");
  }
  if (existing.category !== source.category) {
    changed.push("category");
  }
  if ((options?.salesRepId ?? existing.salesRepId ?? null) !== (existing.salesRepId ?? null)) {
    changed.push("salesRep");
  }

  return changed;
}

function buildManualContactCreatePayload(input: {
  stagedContact: StagedContact;
  businessAccountId: string;
  companyName: string;
}) {
  const payload = buildContactCreatePayload({
    request: {
      displayName: input.stagedContact.displayName,
      jobTitle: input.stagedContact.jobTitle,
      email: input.stagedContact.email ?? "",
      phone1: input.stagedContact.phone ?? "",
      extension: input.stagedContact.extension ?? null,
      contactClass: input.stagedContact.contactClass,
    },
    businessAccountId: input.businessAccountId,
  }) as Record<string, unknown>;

  if (input.stagedContact.extension) {
    payload.Phone2 = {
      value: input.stagedContact.extension,
    };
  }

  return payload;
}

function parseArgs(argv: string[]): ImportOptions {
  let apply = false;
  let limit: number | null = null;
  let workbookPath = DEFAULT_WORKBOOK_PATH;
  let reportPath = DEFAULT_REPORT_PATH;
  let salesRepId: string | null = null;
  let salesRepName: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--limit") {
      const raw = argv[index + 1];
      const numeric = Number(raw);
      if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      limit = numeric;
      index += 1;
      continue;
    }

    if (arg === "--workbook") {
      const raw = argv[index + 1];
      if (!raw?.trim()) {
        throw new Error("--workbook requires a path.");
      }
      workbookPath = path.resolve(process.cwd(), raw.trim());
      index += 1;
      continue;
    }

    if (arg === "--report-file") {
      const raw = argv[index + 1];
      if (!raw?.trim()) {
        throw new Error("--report-file requires a path.");
      }
      reportPath = path.resolve(process.cwd(), raw.trim());
      index += 1;
      continue;
    }

    if (arg === "--sales-rep-id") {
      const raw = argv[index + 1];
      if (!raw?.trim()) {
        throw new Error("--sales-rep-id requires a value.");
      }
      salesRepId = raw.trim();
      index += 1;
      continue;
    }

    if (arg === "--sales-rep-name") {
      const raw = argv[index + 1];
      if (!raw?.trim()) {
        throw new Error("--sales-rep-name requires a value.");
      }
      salesRepName = raw.trim();
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage:",
          "  npx tsx scripts/import-craigs-data.ts [--apply] [--limit N] [--workbook path] [--report-file path] [--sales-rep-id E0000017] [--sales-rep-name 'Craig Vukovic']",
          "",
          "Behavior:",
          "  - dry-run by default",
          "  - with --apply, creates missing accounts, updates week/category on matches, and adds missing contacts",
          "  - dedupes against live Acumatica by normalized company name plus address",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    limit,
    workbookPath,
    reportPath,
    salesRepId,
    salesRepName,
  };
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReport(reportPath: string, report: ImportReport): void {
  ensureParentDirectory(reportPath);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function parseWorkbook(workbookPath: string): WorkbookRow[] {
  const python = `
import json
from openpyxl import load_workbook

path = ${JSON.stringify(workbookPath)}
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]

def norm(value):
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None

rows = []
for row_number, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    if not any(value not in (None, "") for value in row):
        continue
    rows.append({
        "rowNumber": row_number,
        "week": norm(row[0]) or "",
        "priority": norm(row[1]) or "",
        "companyName": norm(row[2]) or "",
        "contact1Name": norm(row[3]),
        "contact1Phone": norm(row[4]),
        "contact1Email": norm(row[5]),
        "city": norm(row[6]) or "",
        "streetAddress": norm(row[7]) or "",
        "postalCode": norm(row[8]) or "",
        "provinceState": norm(row[9]) or "",
        "contact2Name": norm(row[10]),
        "contact2Phone": norm(row[11]),
        "contact2Email": norm(row[12]),
    })

print(json.dumps(rows))
`;

  const result = spawnSync("python3", ["-c", python], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to parse workbook.");
  }

  const parsed = JSON.parse(result.stdout) as WorkbookRow[];
  return parsed;
}

function upsertStagedContact(account: StagedAccount, nextContact: Omit<StagedContact, "desiredPrimary">): void {
  let normalizedEmail = normalizeEmail(nextContact.email);
  const normalizedName = contactNameKey(nextContact.displayName);
  const normalizedPhone = normalizePhoneForSave(nextContact.phone);

  for (const existing of account.contacts) {
    const existingEmail = normalizeEmail(existing.email);
    const existingName = contactNameKey(existing.displayName);
    const existingPhone = normalizePhoneForSave(existing.phone);

    if (normalizedEmail && existingEmail && normalizedEmail === existingEmail) {
      if (existingName && normalizedName && existingName !== normalizedName) {
        normalizedEmail = null;
        continue;
      }

      existing.phone = existing.phone ?? nextContact.phone;
      existing.extension = existing.extension ?? nextContact.extension;
      existing.email = existing.email ?? normalizedEmail;
      existing.sourceRows.push(...nextContact.sourceRows);
      existing.sourceSlots.push(...nextContact.sourceSlots);
      return;
    }

    if (existingName && normalizedName && existingName === normalizedName) {
      if (normalizedPhone && existingPhone && normalizedPhone !== existingPhone) {
        continue;
      }

      existing.phone = existing.phone ?? nextContact.phone;
      existing.extension = existing.extension ?? nextContact.extension;
      existing.email = existing.email ?? normalizedEmail;
      existing.sourceRows.push(...nextContact.sourceRows);
      existing.sourceSlots.push(...nextContact.sourceSlots);
      return;
    }
  }

  account.contacts.push({
    ...nextContact,
    email: normalizedEmail,
    desiredPrimary: false,
  });
}

function buildStagedAccounts(rows: WorkbookRow[]): StagedAccount[] {
  const grouped = new Map<string, StagedAccount>();

  for (const row of rows) {
    const companyName = collapseWhitespace(row.companyName);
    const addressLine1 = collapseWhitespace(row.streetAddress);
    const city = normalizeCity(row.city);
    const state = normalizeState(row.provinceState);
    const postalCode = normalizePostalCode(row.postalCode);
    const week = canonicalWeek(row.week);
    const category = normalizeCategory(row.priority);
    const sourceKey = buildStrictAccountKey(companyName, {
      addressLine1,
      addressLine2: "",
      city,
      state,
      postalCode,
      country: "CA",
    });

    const existing = grouped.get(sourceKey);
    const account =
      existing ??
      ({
        sourceKey,
        companyName,
        addressLine1,
        addressLine2: "",
        city,
        state,
        postalCode,
        country: "CA",
        week,
        category,
        accountPhone: null,
        sourceRows: [],
        contacts: [],
        conflicts: [],
      } satisfies StagedAccount);

    account.sourceRows.push(row.rowNumber);

    if (existing) {
      const nextWeek = betterWeek(account.week, week);
      if (account.week !== nextWeek && account.week !== null && week !== null) {
        account.conflicts.push(`Week conflict on rows ${row.rowNumber}: kept ${nextWeek}.`);
      }
      account.week = nextWeek;

      const nextCategory = betterCategory(account.category, category);
      if (account.category !== nextCategory && account.category !== category) {
        account.conflicts.push(`Category conflict on rows ${row.rowNumber}: kept ${nextCategory}.`);
      }
      account.category = nextCategory;
    }

    const contactCandidates = [
      {
        slot: "contact1",
        name: normalizeContactName(row.contact1Name),
        embeddedEmail: extractEmbeddedEmail(row.contact1Name),
        email: normalizeEmail(row.contact1Email),
        phone: trimToNull(row.contact1Phone),
      },
      {
        slot: "contact2",
        name: normalizeContactName(row.contact2Name),
        embeddedEmail: extractEmbeddedEmail(row.contact2Name),
        email: normalizeEmail(row.contact2Email),
        phone: trimToNull(row.contact2Phone),
      },
    ];

    for (const candidate of contactCandidates) {
      const effectiveEmail = candidate.email ?? candidate.embeddedEmail;
      const parsedPhone = parsePhoneValue(candidate.phone);

      if (!candidate.name) {
        if (!account.accountPhone && parsedPhone.phone) {
          account.accountPhone = parsedPhone.phone;
        }
        continue;
      }

      upsertStagedContact(account, {
        displayName: candidate.name,
        email: effectiveEmail,
        phone: parsedPhone.phone,
        extension: parsedPhone.extension,
        jobTitle: "",
        contactClass: "sales",
        sourceRows: [row.rowNumber],
        sourceSlots: [candidate.slot],
      });
    }

    if (!existing) {
      grouped.set(sourceKey, account);
    }
  }

  const stagedAccounts = [...grouped.values()].map((account) => {
    account.contacts.sort((left, right) => {
      const leftRow = Math.min(...left.sourceRows);
      const rightRow = Math.min(...right.sourceRows);
      if (leftRow !== rightRow) {
        return leftRow - rightRow;
      }

      return left.displayName.localeCompare(right.displayName);
    });

    if (account.contacts[0]) {
      account.contacts[0].desiredPrimary = true;
    }

    account.sourceRows = [...new Set(account.sourceRows)].sort((left, right) => left - right);
    return account;
  });

  stagedAccounts.sort((left, right) => {
    const leftWeek = weekSortValue(left.week);
    const rightWeek = weekSortValue(right.week);
    if (leftWeek !== rightWeek) {
      return leftWeek - rightWeek;
    }

    if (left.category !== right.category) {
      return categoryRank(left.category) - categoryRank(right.category);
    }

    return left.companyName.localeCompare(right.companyName, undefined, {
      sensitivity: "base",
    });
  });

  return stagedAccounts;
}

function parseSetCookies(setCookies: string[]): Record<string, string> {
  const jar: Record<string, string> = {};

  for (const setCookie of setCookies) {
    const first = String(setCookie).split(";")[0] ?? "";
    const separatorIndex = first.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = first.slice(0, separatorIndex).trim();
    const value = first.slice(separatorIndex + 1).trim();
    if (name && value) {
      jar[name] = value;
    }
  }

  return jar;
}

function buildCookieHeaderFromJar(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractHiddenFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const tag of html.match(/<input[^>]+>/gi) ?? []) {
    const nameMatch = tag.match(/\bname="([^"]+)"/i);
    if (!nameMatch?.[1]) {
      continue;
    }

    const valueMatch = tag.match(/\bvalue="([^"]*)"/i);
    fields[nameMatch[1]] = valueMatch?.[1] ?? "";
  }

  return fields;
}

function isConcurrentApiLoginLimit(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("concurrent api login") ||
    normalized.includes("number of concurrent api logins") ||
    normalized.includes("users (sm201010)") ||
    normalized.includes("checkapiuserslimits")
  );
}

async function clearStaleApiSessions(): Promise<void> {
  const env = getEnv();
  const loginPageUrl = new URL("/Frames/Login.aspx", env.ACUMATICA_BASE_URL).toString();

  const loginPageResponse = await fetch(loginPageUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });
  if (!loginPageResponse.ok) {
    throw new Error(`Failed to load Acumatica web login page (${loginPageResponse.status}).`);
  }

  const cookieJar = parseSetCookies(getSetCookieHeaders(loginPageResponse.headers));
  const formFields = extractHiddenFormFields(await loginPageResponse.text());
  formFields["ctl00$phUser$txtUser"] =
    env.ACUMATICA_USERNAME ?? env.ACUMATICA_SERVICE_USERNAME ?? "";
  formFields["ctl00$phUser$txtPass"] =
    env.ACUMATICA_PASSWORD ?? env.ACUMATICA_SERVICE_PASSWORD ?? "";
  formFields["ctl00$phUser$btnLogin"] = "Sign In";

  const loginSubmitResponse = await fetch(loginPageUrl, {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: buildCookieHeaderFromJar(cookieJar),
      Referer: loginPageUrl,
    },
    body: new URLSearchParams(formFields).toString(),
    redirect: "manual",
    cache: "no-store",
  });

  Object.assign(cookieJar, parseSetCookies(getSetCookieHeaders(loginSubmitResponse.headers)));

  const logoutUrl = new URL("/entity/auth/logout", env.ACUMATICA_BASE_URL).toString();
  await fetch(logoutUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Cookie: buildCookieHeaderFromJar(cookieJar),
      Referer: loginPageUrl,
    },
    cache: "no-store",
  });
}

async function loginToAcumaticaViaWeb(): Promise<string> {
  const env = getEnv();
  const username = env.ACUMATICA_SERVICE_USERNAME ?? env.ACUMATICA_USERNAME;
  const password = env.ACUMATICA_SERVICE_PASSWORD ?? env.ACUMATICA_PASSWORD;
  if (!username || !password) {
    throw new Error("Acumatica credentials are not configured.");
  }

  const loginPageUrl = new URL("/Frames/Login.aspx", env.ACUMATICA_BASE_URL).toString();
  const loginPageResponse = await fetch(loginPageUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });
  if (!loginPageResponse.ok) {
    throw new Error(`Failed to load Acumatica web login page (${loginPageResponse.status}).`);
  }

  const cookieJar = parseSetCookies(getSetCookieHeaders(loginPageResponse.headers));
  const formFields = extractHiddenFormFields(await loginPageResponse.text());
  formFields["ctl00$phUser$txtUser"] = username;
  formFields["ctl00$phUser$txtPass"] = password;
  formFields["ctl00$phUser$btnLogin"] = "Sign In";

  const submitResponse = await fetch(loginPageUrl, {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: buildCookieHeaderFromJar(cookieJar),
      Referer: loginPageUrl,
    },
    body: new URLSearchParams(formFields).toString(),
    redirect: "manual",
    cache: "no-store",
  });

  if (!(submitResponse.status === 302 || submitResponse.ok)) {
    const text = await submitResponse.text();
    throw new Error(`Acumatica web login failed (${submitResponse.status}): ${text || "No response body."}`);
  }

  Object.assign(cookieJar, parseSetCookies(getSetCookieHeaders(submitResponse.headers)));

  const entityLoginUrl = new URL("/entity/auth/login", env.ACUMATICA_BASE_URL).toString();
  const entityLoginResponse = await fetch(entityLoginUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: buildCookieHeaderFromJar(cookieJar),
      Referer: loginPageUrl,
    },
    body: JSON.stringify({
      name: username,
      password,
      company: env.ACUMATICA_COMPANY ?? "MeadowBrook Live",
      ...(env.ACUMATICA_BRANCH ? { branch: env.ACUMATICA_BRANCH } : {}),
      ...(env.ACUMATICA_LOCALE ? { locale: env.ACUMATICA_LOCALE } : {}),
    }),
    cache: "no-store",
  });

  if (!entityLoginResponse.ok) {
    const text = await entityLoginResponse.text();
    throw new Error(
      `Acumatica entity login via web session failed (${entityLoginResponse.status}): ${text || "No response body."}`,
    );
  }

  Object.assign(cookieJar, parseSetCookies(getSetCookieHeaders(entityLoginResponse.headers)));
  const stored = buildStoredAuthCookieValueFromSetCookies(
    getSetCookieHeaders(entityLoginResponse.headers),
  );
  if (!stored) {
    throw new Error("Acumatica entity login via web session did not return reusable auth cookies.");
  }

  return stored;
}

async function logoutAcumatica(cookieValue: string | null | undefined): Promise<void> {
  if (!cookieValue) {
    return;
  }

  const env = getEnv();
  try {
    await fetch(new URL("/entity/auth/logout", env.ACUMATICA_BASE_URL).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: buildCookieHeader(cookieValue),
      },
      cache: "no-store",
    });
  } catch {
    // Best effort only.
  }
}

async function loginToAcumatica(): Promise<string> {
  const env = getEnv();
  const loginUrl = new URL("/entity/auth/login", env.ACUMATICA_BASE_URL).toString();
  const username = env.ACUMATICA_SERVICE_USERNAME ?? env.ACUMATICA_USERNAME;
  const password = env.ACUMATICA_SERVICE_PASSWORD ?? env.ACUMATICA_PASSWORD;

  if (!username || !password) {
    throw new Error("Acumatica credentials are not configured.");
  }

  const payload = {
    name: username,
    password,
    company: env.ACUMATICA_COMPANY ?? "MeadowBrook Live",
    ...(env.ACUMATICA_BRANCH ? { branch: env.ACUMATICA_BRANCH } : {}),
    ...(env.ACUMATICA_LOCALE ? { locale: env.ACUMATICA_LOCALE } : {}),
  };

  for (let attempt = 1; attempt <= LOGIN_RETRY_LIMIT; attempt += 1) {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (response.ok) {
      const stored = buildStoredAuthCookieValueFromSetCookies(
        getSetCookieHeaders(response.headers),
      );
      if (!stored) {
        throw new Error("Acumatica login succeeded but no reusable auth cookies were returned.");
      }
      return stored;
    }

    const text = await response.text();
    if (attempt < LOGIN_RETRY_LIMIT && isConcurrentApiLoginLimit(text)) {
      process.stdout.write(
        `Acumatica API login limit reached. Cleanup attempt ${attempt}/${LOGIN_RETRY_LIMIT}...\n`,
      );
      try {
        await clearStaleApiSessions();
      } catch (error) {
        process.stdout.write(
          `Cleanup did not complete: ${getErrorMessage(error)}\n`,
        );
      }

      await sleep(LOGIN_RETRY_DELAY_MS);
      continue;
    }

    const apiError = `Acumatica login failed (${response.status}): ${text || "No response body."}`;

    try {
      process.stdout.write(`API login path failed, falling back to web login: ${apiError}\n`);
      return await loginToAcumaticaViaWeb();
    } catch (webError) {
      throw new Error(`${apiError}; web fallback also failed: ${getErrorMessage(webError)}`);
    }
  }

  throw new Error("Acumatica login failed after repeated retries.");
}

function readCreatedAccountIdentifiers(rawAccount: unknown): {
  accountRecordId: string | null;
  businessAccountId: string | null;
} {
  const rows = normalizeBusinessAccountRows(rawAccount);
  const first = rows[0];

  return {
    accountRecordId: trimToNull(first?.accountRecordId ?? first?.id),
    businessAccountId: trimToNull(first?.businessAccountId),
  };
}

function findMatchingExistingContact(
  stagedContact: StagedContact,
  existingContacts: ExistingContact[],
): ExistingContact | null {
  const exactEmail = normalizeEmail(stagedContact.email);
  if (exactEmail) {
    const byEmail = existingContacts.find(
      (contact) => normalizeEmail(contact.email) === exactEmail,
    );
    if (byEmail) {
      return byEmail;
    }
  }

  for (const contact of existingContacts) {
    if (shouldTreatAsSameContact(stagedContact, contact)) {
      return contact;
    }
  }

  return null;
}

async function importAccounts(options: ImportOptions): Promise<ImportReport> {
  const workbookRows = parseWorkbook(options.workbookPath);
  let stagedAccounts = buildStagedAccounts(workbookRows);
  if (options.limit !== null) {
    stagedAccounts = stagedAccounts.slice(0, options.limit);
  }
  const resolvedSalesRep = resolveSalesRepOwnerReference(
    options.salesRepId,
    options.salesRepName,
  );

  const report: ImportReport = {
    startedAt: new Date().toISOString(),
    dryRun: !options.apply,
    workbookPath: options.workbookPath,
    summary: {
      stagedAccounts: stagedAccounts.length,
      stagedContacts: stagedAccounts.reduce((sum, account) => sum + account.contacts.length, 0),
      matchedAccounts: 0,
      createdAccounts: 0,
      updatedAccounts: 0,
      skippedAccounts: 0,
      createdContacts: 0,
      skippedContacts: 0,
      failedAccounts: 0,
    },
    accounts: [],
  };

  const cookieValue = await loginToAcumatica();
  const authCookieRefresh: AuthCookieRefresh = { value: null };

  try {
    process.stdout.write("Fetching live Acumatica business accounts for duplicate checks...\n");
    const rawLiveAccounts = await fetchBusinessAccounts(
      cookieValue,
      {
        batchSize: 250,
        ensureMainAddress: true,
        ensurePrimaryContact: true,
        ensureAttributes: true,
        ensureContacts: true,
      },
      authCookieRefresh,
    );
    const existingGroups = buildExistingAccountGroupsFromRawAccounts(rawLiveAccounts);
    const indexes = indexExistingAccounts(existingGroups);
    const stagedMatches = stagedAccounts.map((account) => ({
      account,
      match: matchExistingAccount(account, indexes),
    }));
    const matchedBusinessAccountIds = [
      ...new Set(
        stagedMatches
          .map(({ match }) => trimToNull(match.account?.businessAccountId))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const existingContactsByBusinessAccountId =
      matchedBusinessAccountIds.length > 0
        ? (() => {
            process.stdout.write("Fetching live Acumatica contacts for matched accounts...\n");
            return fetchContactsByBusinessAccountIds(
              cookieValue,
              matchedBusinessAccountIds,
              authCookieRefresh,
            );
          })()
        : Promise.resolve([]);
    const extraExistingContactsByBusinessAccountId = buildExistingContactsByBusinessAccountId(
      await existingContactsByBusinessAccountId,
    );

    for (const { account, match } of stagedMatches) {
      const matchedBusinessAccountId = normalizeBusinessAccountIdKey(
        match.account?.businessAccountId,
      );
      const effectiveExistingContacts = match.account
        ? mergeExistingContacts(
            match.account.contacts,
            extraExistingContactsByBusinessAccountId.get(matchedBusinessAccountId) ?? [],
          )
        : [];
      const action: ReportAccountAction = {
        sourceKey: account.sourceKey,
        companyName: account.companyName,
        matchType: match.matchType,
        sourceRows: account.sourceRows,
        action: match.account ? "update" : "create",
        contactsCreated: [],
        contactsSkipped: [],
        conflicts: [...account.conflicts],
        ambiguousExistingAccountIds: match.ambiguousCandidates.map((candidate) => candidate.businessAccountId),
      };

      report.accounts.push(action);

      try {
        if (match.account) {
          report.summary.matchedAccounts += 1;
          action.businessAccountId = match.account.businessAccountId;
          action.accountRecordId = match.account.accountRecordId;

          const changedFields = needsAccountUpdate(match.account.representativeRow, account, {
            salesRepId: resolvedSalesRep.salesRepId,
          });
          if (changedFields.length > 0) {
            action.updatedFields = changedFields;
          }

          if (!options.apply) {
            if (changedFields.length > 0) {
              report.summary.updatedAccounts += 1;
            } else {
              report.summary.skippedAccounts += 1;
            }

            for (const stagedContact of account.contacts) {
              const existingContact = findMatchingExistingContact(
                stagedContact,
                effectiveExistingContacts,
              );
              if (existingContact) {
                action.contactsSkipped.push({
                  name: stagedContact.displayName,
                  reason: "matching-contact-exists",
                });
                report.summary.skippedContacts += 1;
              } else {
                action.contactsCreated.push({
                  name: stagedContact.displayName,
                  contactId: 0,
                });
                report.summary.createdContacts += 1;
              }
            }

            await sleep(REQUEST_DELAY_MS);
            continue;
          }

          if (changedFields.length > 0) {
            const rawAccount = await fetchBusinessAccountById(
              cookieValue,
              match.account.accountRecordId,
              authCookieRefresh,
            );
            const updateRequest = buildAccountUpdateRequest(match.account.representativeRow, account, {
              salesRepId: resolvedSalesRep.salesRepId,
              salesRepName: resolvedSalesRep.salesRepName,
            });
            const updatePayload = buildWeekCategoryUpdatePayload(rawAccount, updateRequest);

            await updateBusinessAccount(
              cookieValue,
              [match.account.accountRecordId, match.account.businessAccountId],
              updatePayload,
              authCookieRefresh,
            );
            report.summary.updatedAccounts += 1;
          } else {
            report.summary.skippedAccounts += 1;
          }

          for (const stagedContact of account.contacts) {
            const existingContact = findMatchingExistingContact(
              stagedContact,
              effectiveExistingContacts,
            );
            if (existingContact) {
              action.contactsSkipped.push({
                name: stagedContact.displayName,
                reason: "matching-contact-exists",
              });
              report.summary.skippedContacts += 1;
              continue;
            }

            const createdContact = await createContact(
              cookieValue,
              buildManualContactCreatePayload({
                stagedContact,
                businessAccountId: match.account.businessAccountId,
                companyName: match.account.representativeRow.companyName,
              }),
              authCookieRefresh,
            );
            const contactId = readWrappedNumber(createdContact, "ContactID");
            if (!contactId) {
              throw new HttpError(
                502,
                `Contact ${stagedContact.displayName} was created without a Contact ID.`,
              );
            }

            action.contactsCreated.push({
              name: stagedContact.displayName,
              contactId,
            });
            report.summary.createdContacts += 1;

            await sleep(REQUEST_DELAY_MS);
          }

          continue;
        }

        if (!options.apply) {
          report.summary.createdAccounts += 1;
          for (const stagedContact of account.contacts) {
            action.contactsCreated.push({
              name: stagedContact.displayName,
              contactId: 0,
            });
            report.summary.createdContacts += 1;
          }
          await sleep(REQUEST_DELAY_MS);
          continue;
        }

        let createdClass: BusinessAccountClassCode = "CUSTOMER";
        let createdRawAccount;
        try {
          createdRawAccount = await createBusinessAccount(
            cookieValue,
            buildBusinessAccountCreatePayload({
              companyName: account.companyName,
              companyDescription: null,
              classId: "CUSTOMER",
              salesRepId: resolvedSalesRep.salesRepId,
              salesRepName: resolvedSalesRep.salesRepName,
              industryType: "",
              subCategory: "",
              companyRegion: "",
              week: account.week,
              companyPhone: account.accountPhone,
              category: account.category,
              addressLookupId: "manual-import",
              addressLine1: account.addressLine1,
              addressLine2: account.addressLine2,
              city: account.city,
              state: account.state,
              postalCode: account.postalCode,
              country: "CA",
            }),
            authCookieRefresh,
          );
        } catch (error) {
          const message = getErrorMessage(error).toLowerCase();
          if (message.includes("customer management preferences form")) {
            createdClass = "LEAD";
            createdRawAccount = await createBusinessAccount(
              cookieValue,
              buildBusinessAccountCreatePayload({
                companyName: account.companyName,
                companyDescription: null,
                classId: "LEAD",
                salesRepId: resolvedSalesRep.salesRepId,
                salesRepName: resolvedSalesRep.salesRepName,
                industryType: "",
                subCategory: "",
                companyRegion: "",
                week: account.week,
                companyPhone: account.accountPhone,
                category: account.category,
                addressLookupId: "manual-import",
                addressLine1: account.addressLine1,
                addressLine2: account.addressLine2,
                city: account.city,
                state: account.state,
                postalCode: account.postalCode,
                country: "CA",
              }),
              authCookieRefresh,
            );
          } else {
            throw error;
          }
        }

        const createdIdentifiers = readCreatedAccountIdentifiers(createdRawAccount);
        if (!createdIdentifiers.accountRecordId || !createdIdentifiers.businessAccountId) {
          throw new HttpError(
            502,
            `Account ${account.companyName} was created but Acumatica did not return identifiers.`,
          );
        }

        action.accountRecordId = createdIdentifiers.accountRecordId;
        action.businessAccountId = createdIdentifiers.businessAccountId;
        action.createdClass = createdClass;
        report.summary.createdAccounts += 1;

        for (const stagedContact of account.contacts) {
          const createdContact = await createContact(
            cookieValue,
            buildManualContactCreatePayload({
              stagedContact,
              businessAccountId: createdIdentifiers.businessAccountId,
              companyName: account.companyName,
            }),
            authCookieRefresh,
          );
          const contactId = readWrappedNumber(createdContact, "ContactID");
          if (!contactId) {
            throw new HttpError(
              502,
              `Contact ${stagedContact.displayName} was created without a Contact ID.`,
            );
          }

          action.contactsCreated.push({
            name: stagedContact.displayName,
            contactId,
          });
          report.summary.createdContacts += 1;

          await sleep(REQUEST_DELAY_MS);
        }

      } catch (error) {
        action.error = getErrorMessage(error);
        report.summary.failedAccounts += 1;
        if (action.contactsCreated.length > 0) {
          report.summary.createdContacts -= action.contactsCreated.length;
        }
        action.contactsCreated = [];
      } finally {
        writeReport(options.reportPath, report);
        await sleep(REQUEST_DELAY_MS);
      }
    }

    if (options.apply) {
      process.stdout.write("Refreshing the local read model after import...\n");
      await triggerReadModelSync(authCookieRefresh.value ?? cookieValue, {
        authCookieRefresh,
        force: true,
      });
      await waitForReadModelSync();
    }

    report.finishedAt = new Date().toISOString();
    writeReport(options.reportPath, report);
    return report;
  } finally {
    await logoutAcumatica(authCookieRefresh.value ?? cookieValue);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.workbookPath)) {
    throw new Error(`Workbook not found: ${options.workbookPath}`);
  }

  process.stdout.write(
    `${options.apply ? "Applying" : "Dry-running"} import from ${path.basename(options.workbookPath)}...\n`,
  );
  const report = await importAccounts(options);

  process.stdout.write(
    [
      "",
      `Report: ${options.reportPath}`,
      `Staged accounts: ${report.summary.stagedAccounts}`,
      `Staged contacts: ${report.summary.stagedContacts}`,
      `Matched accounts: ${report.summary.matchedAccounts}`,
      `Created accounts: ${report.summary.createdAccounts}`,
      `Updated accounts: ${report.summary.updatedAccounts}`,
      `Skipped accounts: ${report.summary.skippedAccounts}`,
      `Created contacts: ${report.summary.createdContacts}`,
      `Skipped contacts: ${report.summary.skippedContacts}`,
      `Failed accounts: ${report.summary.failedAccounts}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exit(1);
});
