import {
  CATEGORY_VALUES,
  type BusinessAccountRow,
  type BusinessAccountUpdateRequest,
  type Category,
  type CompanyPhoneSource,
  type SortBy,
  type SortDir,
} from "@/types/business-account";
import { isExcludedInternalBusinessAccountRow } from "@/lib/internal-records";
import {
  extractNormalizedPhoneDigits,
  formatPhoneForDisplay,
  looksLikeFullNorthAmericanPhone,
  normalizeExtensionForSave,
  normalizePhoneForSave,
  phoneValuesEquivalent,
  resolvePrimaryContactPhoneFields,
} from "@/lib/phone";
import { canonicalBusinessAccountRegionValue } from "@/lib/business-account-region-values";

type UnknownRecord = Record<string, unknown>;

type QueryOptions = {
  q?: string;
  category?: Category;
  filterCompanyInitial?: string;
  filterCompanyName?: string;
  filterSalesRep?: string;
  filterIndustryType?: string;
  filterSubCategory?: string;
  filterCompanyRegion?: string;
  filterWeek?: string;
  filterAddress?: string;
  filterCompanyPhone?: string;
  filterPrimaryContactName?: string;
  filterPrimaryContactJobTitle?: string;
  filterPrimaryContactPhone?: string;
  filterPrimaryContactExtension?: string;
  filterPrimaryContactEmail?: string;
  filterNotes?: string;
  filterCategory?: Category;
  filterLastEmailed?: string;
  filterLastModified?: string;
  sortBy?: SortBy;
  sortDir?: SortDir;
  includeInternalRows?: boolean;
  page: number;
  pageSize: number;
};

type SuppressionOptions = {
  includeInternalRows?: boolean;
};

export type PrimaryContactCandidate = {
  contactId: number | null;
  recordId: string | null;
  email: string | null;
  name: string | null;
  rowNumber: number | null;
  index: number;
};

export type PrimaryContactHint = {
  contactId: number | null;
  recordId: string | null;
  email: string | null;
  name: string | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

function getField(record: unknown, key: string): unknown {
  if (!isRecord(record)) {
    return undefined;
  }

  return record[key];
}

function readArrayField(record: unknown, key: string): unknown[] {
  const field = getField(record, key);
  if (Array.isArray(field)) {
    return field;
  }

  if (!isRecord(field)) {
    return [];
  }

  const wrappedValue = field.value;
  if (Array.isArray(wrappedValue)) {
    return wrappedValue;
  }

  const wrappedItems = (field as UnknownRecord).Items;
  if (Array.isArray(wrappedItems)) {
    return wrappedItems;
  }

  return [];
}

function readWrappedValue<T>(source: unknown): T | null {
  if (!isRecord(source)) {
    return null;
  }

  if (!("value" in source)) {
    return null;
  }

  const value = source.value;
  if (value === undefined || value === null) {
    return null;
  }

  return value as T;
}

function unwrapRecordValue(source: unknown): unknown {
  const wrapped = readWrappedValue<unknown>(source);
  return wrapped ?? source;
}

function readString(record: unknown, key: string): string {
  const raw = readWrappedValue<string>(getField(record, key));
  return raw?.trim() ?? "";
}

function readFirstString(record: unknown, keys: string[]): string {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) {
      return value;
    }
  }

  return "";
}

function readFirstPhone(record: unknown, keys: string[]): string | null {
  const value = readFirstString(record, keys);
  return formatPhoneForDisplay(value);
}

function readRawPrimaryContactPhoneValue(record: unknown): string | null {
  const phone1 = readNullableString(record, "Phone1");
  if (phone1) {
    return phone1;
  }

  const phone2 = readNullableString(record, "Phone2");
  if (phone2 && looksLikeFullNorthAmericanPhone(phone2)) {
    return phone2;
  }

  const phone3 = readNullableString(record, "Phone3");
  if (phone3 && looksLikeFullNorthAmericanPhone(phone3)) {
    return phone3;
  }

  return phone2 ?? phone3 ?? null;
}

function readPrimaryContactPhone(record: unknown): {
  phone: string | null;
  extension: string | null;
  rawPhone: string | null;
} {
  const resolved = resolvePrimaryContactPhoneFields({
    phone1: readNullableString(record, "Phone1"),
    phone2: readNullableString(record, "Phone2"),
    phone3: readNullableString(record, "Phone3"),
  });

  return {
    ...resolved,
    rawPhone: readRawPrimaryContactPhoneValue(record),
  };
}

function readNullableString(record: unknown, key: string): string | null {
  const value = readString(record, key);
  return value ? value : null;
}

function readRecordIdentity(record: unknown): string | null {
  if (!isRecord(record)) {
    return null;
  }

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (id) {
    return id;
  }

  return readNullableString(record, "NoteID");
}

function readNullableNumber(record: unknown, key: string): number | null {
  const wrapped = readWrappedValue<number | string>(getField(record, key));

  if (wrapped == null) {
    return null;
  }

  const numeric = Number(wrapped);
  return Number.isFinite(numeric) ? numeric : null;
}

function toCategory(value: string | null): Category | null {
  if (!value) {
    return null;
  }

  const upper = value.toUpperCase();
  return (CATEGORY_VALUES as readonly string[]).includes(upper)
    ? (upper as Category)
    : null;
}

function formatAddress(parts: {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}): string {
  const line = [parts.line1, parts.line2].filter(Boolean).join(" ");
  const cityLine = [parts.city, parts.state, parts.postalCode].filter(Boolean).join(" ");
  return [line, cityLine, parts.country].filter(Boolean).join(", ");
}

function splitContactName(displayName: string | null | undefined): {
  firstName: string | null;
  lastName: string;
} {
  const trimmed = (displayName ?? "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: null,
      lastName: trimmed,
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? trimmed,
  };
}

function composeContactName(record: unknown): string | null {
  const explicit = readFirstString(record, [
    "DisplayName",
    "FullName",
    "ContactName",
    "Attention",
  ]);
  if (explicit) {
    return explicit;
  }

  const first = readString(record, "FirstName");
  const middle = readString(record, "MiddleName");
  const last = readString(record, "LastName");
  const composite = [first, middle, last].filter(Boolean).join(" ").trim();
  return composite || null;
}

function chooseFirst(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readContactJobTitle(record: unknown): string | null {
  return chooseFirst([
    readNullableString(record, "JobTitle"),
    readNullableString(record, "Title"),
  ]);
}

function normalizeComparable(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase();
}

function splitEmailAddresses(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[;,]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickPreferredText(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  if (hasText(incoming)) {
    return incoming;
  }

  if (hasText(existing)) {
    return existing;
  }

  return null;
}

function pickRequiredText(existing: string, incoming: string): string {
  return hasText(incoming) ? incoming : existing;
}

function mergeBusinessAccountRows(
  existing: BusinessAccountRow,
  incoming: BusinessAccountRow,
): BusinessAccountRow {
  return {
    ...existing,
    ...incoming,
    id: pickRequiredText(existing.id, incoming.id),
    accountRecordId: pickPreferredText(existing.accountRecordId, incoming.accountRecordId) ?? undefined,
    rowKey: pickPreferredText(existing.rowKey, incoming.rowKey) ?? undefined,
    contactId: incoming.contactId ?? existing.contactId,
    isPrimaryContact: Boolean(existing.isPrimaryContact || incoming.isPrimaryContact),
    companyPhone: pickPreferredText(existing.companyPhone, incoming.companyPhone),
    companyPhoneSource:
      (hasText(incoming.companyPhone) ? incoming.companyPhoneSource : null) ??
      (hasText(existing.companyPhone) ? existing.companyPhoneSource : null) ??
      null,
    phoneNumber: pickPreferredText(existing.phoneNumber, incoming.phoneNumber),
    salesRepId: pickPreferredText(existing.salesRepId, incoming.salesRepId),
    salesRepName: pickPreferredText(existing.salesRepName, incoming.salesRepName),
    industryType: pickPreferredText(existing.industryType, incoming.industryType),
    subCategory: pickPreferredText(existing.subCategory, incoming.subCategory),
    companyRegion: pickPreferredText(existing.companyRegion, incoming.companyRegion),
    week: pickPreferredText(existing.week, incoming.week),
    businessAccountId: pickRequiredText(existing.businessAccountId, incoming.businessAccountId),
    companyName: pickRequiredText(existing.companyName, incoming.companyName),
    companyDescription: pickPreferredText(existing.companyDescription, incoming.companyDescription),
    address: pickRequiredText(existing.address, incoming.address),
    addressLine1: pickRequiredText(existing.addressLine1, incoming.addressLine1),
    addressLine2: pickRequiredText(existing.addressLine2, incoming.addressLine2),
    city: pickRequiredText(existing.city, incoming.city),
    state: pickRequiredText(existing.state, incoming.state),
    postalCode: pickRequiredText(existing.postalCode, incoming.postalCode),
    country: pickRequiredText(existing.country, incoming.country),
    primaryContactName: pickPreferredText(
      existing.primaryContactName,
      incoming.primaryContactName,
    ),
    primaryContactJobTitle: pickPreferredText(
      existing.primaryContactJobTitle,
      incoming.primaryContactJobTitle,
    ),
    primaryContactPhone: pickPreferredText(
      existing.primaryContactPhone,
      incoming.primaryContactPhone,
    ),
    primaryContactExtension: pickPreferredText(
      existing.primaryContactExtension,
      incoming.primaryContactExtension,
    ),
    primaryContactRawPhone: pickPreferredText(
      existing.primaryContactRawPhone,
      incoming.primaryContactRawPhone,
    ),
    primaryContactEmail: pickPreferredText(
      existing.primaryContactEmail,
      incoming.primaryContactEmail,
    ),
    primaryContactId: incoming.primaryContactId ?? existing.primaryContactId,
    category: incoming.category ?? existing.category,
    notes: pickPreferredText(existing.notes, incoming.notes),
    lastEmailedAt: pickPreferredText(existing.lastEmailedAt, incoming.lastEmailedAt),
    lastModifiedIso: pickPreferredText(existing.lastModifiedIso, incoming.lastModifiedIso),
  };
}

function resolveBusinessAccountRowKey(row: BusinessAccountRow, index: number): string {
  if (hasText(row.rowKey)) {
    return row.rowKey.trim();
  }

  const accountKey =
    (hasText(row.accountRecordId) && row.accountRecordId.trim()) ||
    row.id.trim() ||
    row.businessAccountId.trim() ||
    `row-${index}`;
  const contactKey =
    row.contactId !== null && row.contactId !== undefined ? String(row.contactId) : String(index);

  return `${accountKey}:contact:${contactKey}`;
}

function isApMailboxLocalPart(localPart: string): boolean {
  if (!localPart) {
    return false;
  }

  return (
    localPart === "ap" ||
    localPart.includes("payable") ||
    /(?:^|[-_.])ap(?:$|[-_.])/.test(localPart) ||
    localPart.endsWith("ap")
  );
}

export function isApEmailMailbox(value: string | null | undefined): boolean {
  return splitEmailAddresses(value).some((email) => {
    const atIndex = email.indexOf("@");
    if (atIndex <= 0) {
      return false;
    }

    return isApMailboxLocalPart(email.slice(0, atIndex));
  });
}

function hasUsableSuppressedContactName(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/^[.\s]+$/.test(value);
}

export function isUsableContactRow(row: BusinessAccountRow): boolean {
  return hasUsableSuppressedContactName(row.primaryContactName);
}

function isAssociatedContactRow(row: BusinessAccountRow): boolean {
  return typeof row.rowKey === "string" && row.rowKey.includes(":contact:");
}

function isOrphanPlaceholderBusinessAccountRow(row: BusinessAccountRow): boolean {
  return (
    !hasText(row.companyName) &&
    !hasText(row.businessAccountId) &&
    !hasText(row.address) &&
    !hasText(row.primaryContactName) &&
    !hasText(row.primaryContactEmail) &&
    row.contactId === null
  );
}

function buildCanonicalAddressKey(row: BusinessAccountRow): string {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((part) => normalizeComparable(part))
    .join("|");
}

export function buildCanonicalCompanyPhoneGroupKey(row: BusinessAccountRow): string {
  const addressKey = buildCanonicalAddressKey(row);
  const normalizedBusinessAccountId = normalizeComparable(row.businessAccountId);
  if (normalizedBusinessAccountId) {
    return `business-account:${normalizedBusinessAccountId}|address:${addressKey}`;
  }

  const normalizedAccountRecordId = normalizeComparable(row.accountRecordId ?? row.id);
  if (normalizedAccountRecordId) {
    return `account-record:${normalizedAccountRecordId}|address:${addressKey}`;
  }

  return `company-name:${normalizeComparable(row.companyName)}|address:${addressKey}`;
}

function normalizePhoneCandidate(value: string | null | undefined): string | null {
  return formatPhoneForDisplay(value);
}

type CompanyPhoneCandidate = {
  value: string;
  key: string;
  count: number;
  firstIndex: number;
  source: CompanyPhoneSource;
};

function upsertCompanyPhoneCandidate(
  candidates: Map<string, CompanyPhoneCandidate>,
  value: string | null | undefined,
  source: CompanyPhoneSource,
  index: number,
): void {
  const normalized = normalizePhoneCandidate(value);
  if (!normalized) {
    return;
  }

  const key = normalizePhoneForSave(normalized) ?? normalizeComparable(normalized);
  const existing = candidates.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }

  candidates.set(key, {
    value: normalized,
    key,
    count: 1,
    firstIndex: index,
    source,
  });
}

function compareCompanyPhoneCandidates(
  left: CompanyPhoneCandidate,
  right: CompanyPhoneCandidate,
): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }

  return left.firstIndex - right.firstIndex;
}

function pickCanonicalCompanyPhoneCandidate(
  rows: BusinessAccountRow[],
): CompanyPhoneCandidate | null {
  const explicitCandidates = new Map<string, CompanyPhoneCandidate>();
  const placeholderCandidates = new Map<string, CompanyPhoneCandidate>();
  const fallbackCandidates = new Map<string, CompanyPhoneCandidate>();

  rows.forEach((row, index) => {
    if (row.companyPhoneSource === "account") {
      upsertCompanyPhoneCandidate(explicitCandidates, row.companyPhone, "account", index);
    } else if (row.companyPhoneSource === "placeholder") {
      upsertCompanyPhoneCandidate(
        placeholderCandidates,
        row.companyPhone ?? row.phoneNumber,
        "placeholder",
        index,
      );
    }

    if (row.companyPhoneSource !== "placeholder" && isPlaceholderCompanyPhoneRow(row)) {
      upsertCompanyPhoneCandidate(
        placeholderCandidates,
        row.phoneNumber ?? row.companyPhone,
        "placeholder",
        index,
      );
    }

    upsertCompanyPhoneCandidate(fallbackCandidates, resolveCompanyPhone(row), "fallback", index);
  });

  const explicit = [...explicitCandidates.values()].sort(compareCompanyPhoneCandidates)[0] ?? null;
  if (explicit) {
    return explicit;
  }

  const placeholder =
    [...placeholderCandidates.values()].sort(compareCompanyPhoneCandidates)[0] ?? null;
  if (placeholder) {
    return placeholder;
  }

  return [...fallbackCandidates.values()].sort(compareCompanyPhoneCandidates)[0] ?? null;
}

function comparePlaceholderVisibility(left: IndexedRow, right: IndexedRow): number {
  const leftAssociated = isAssociatedContactRow(left.row);
  const rightAssociated = isAssociatedContactRow(right.row);
  if (leftAssociated !== rightAssociated) {
    return leftAssociated ? 1 : -1;
  }

  const leftHasCompanyPhone = hasText(resolveCompanyPhone(left.row));
  const rightHasCompanyPhone = hasText(resolveCompanyPhone(right.row));
  if (leftHasCompanyPhone !== rightHasCompanyPhone) {
    return leftHasCompanyPhone ? -1 : 1;
  }

  const leftContactId = left.row.contactId ?? Number.POSITIVE_INFINITY;
  const rightContactId = right.row.contactId ?? Number.POSITIVE_INFINITY;
  if (leftContactId !== rightContactId) {
    return leftContactId - rightContactId;
  }

  return left.index - right.index;
}

export function isPlaceholderCompanyPhoneRow(row: BusinessAccountRow): boolean {
  if (isUsableContactRow(row)) {
    return false;
  }

  if (row.companyPhoneSource === "placeholder" && hasText(row.companyPhone)) {
    return true;
  }

  if (hasText(row.phoneNumber)) {
    return true;
  }

  return !isAssociatedContactRow(row) && hasText(row.companyPhone);
}

export function canonicalizeBusinessAccountRows(
  rows: BusinessAccountRow[],
): BusinessAccountRow[] {
  const uniqueRows = dedupeBusinessAccountRows(rows);
  if (uniqueRows.length === 0) {
    return uniqueRows;
  }

  const grouped = new Map<string, IndexedRow[]>();
  uniqueRows.forEach((row, index) => {
    const key = buildCanonicalCompanyPhoneGroupKey(row);
    const existing = grouped.get(key);
    if (existing) {
      existing.push({ row, index });
      return;
    }

    grouped.set(key, [{ row, index }]);
  });

  const nextRows: BusinessAccountRow[] = [];
  grouped.forEach((entries) => {
    const candidate = pickCanonicalCompanyPhoneCandidate(entries.map((entry) => entry.row));
    const canonicalPhone = candidate?.value ?? null;
    const canonicalSource = candidate?.source ?? null;
    const rowsWithCanonicalPhone = entries.map((entry) => ({
      ...entry.row,
      companyPhone: canonicalPhone,
      companyPhoneSource: canonicalSource,
    }));

    const realContactRows = rowsWithCanonicalPhone.filter(isUsableContactRow);
    if (realContactRows.length > 0) {
      nextRows.push(...realContactRows);
      return;
    }

    const placeholderRows = rowsWithCanonicalPhone.filter(isPlaceholderCompanyPhoneRow);
    const hasAccountLevelRow = entries.some((entry) => !isAssociatedContactRow(entry.row));
    if (placeholderRows.length === 0 && !hasAccountLevelRow) {
      return;
    }

    const visibleRow = entries
      .map((entry, index) => ({
        row: rowsWithCanonicalPhone[index] ?? entry.row,
        index: entry.index,
      }))
      .sort(comparePlaceholderVisibility)[0];
    if (visibleRow) {
      nextRows.push({
        ...visibleRow.row,
        primaryContactName: null,
        primaryContactJobTitle: null,
        primaryContactEmail: null,
        primaryContactPhone: null,
        primaryContactExtension: null,
        primaryContactRawPhone: null,
        primaryContactId: null,
        contactId: null,
        isPrimaryContact: false,
      });
    }
  });

  return enforceSinglePrimaryPerAccountRows(nextRows);
}

export function filterSuppressedBusinessAccountRows(
  rows: BusinessAccountRow[],
  options: SuppressionOptions = {},
): BusinessAccountRow[] {
  return canonicalizeBusinessAccountRows(rows).filter((row) => {
    if (isOrphanPlaceholderBusinessAccountRow(row)) {
      return false;
    }

    if (!options.includeInternalRows && isExcludedInternalBusinessAccountRow(row)) {
      return false;
    }

    if (isApEmailMailbox(row.primaryContactEmail)) {
      return false;
    }

    return true;
  });
}

export function dedupeBusinessAccountRows(rows: BusinessAccountRow[]): BusinessAccountRow[] {
  if (rows.length <= 1) {
    return rows;
  }

  const deduped = new Map<string, BusinessAccountRow>();
  let changed = false;

  rows.forEach((row, index) => {
    const key = resolveBusinessAccountRowKey(row, index);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, {
        ...row,
        rowKey: row.rowKey ?? key,
      });
      return;
    }

    changed = true;
    deduped.set(key, mergeBusinessAccountRows(existing, row));
  });

  return changed ? [...deduped.values()] : rows;
}

function selectBestPrimaryCandidateIndex(
  candidates: PrimaryContactCandidate[],
): number | null {
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftRowNumber = left.rowNumber ?? Number.POSITIVE_INFINITY;
    const rightRowNumber = right.rowNumber ?? Number.POSITIVE_INFINITY;
    if (leftRowNumber !== rightRowNumber) {
      return leftRowNumber - rightRowNumber;
    }

    const leftContactId = left.contactId ?? Number.POSITIVE_INFINITY;
    const rightContactId = right.contactId ?? Number.POSITIVE_INFINITY;
    if (leftContactId !== rightContactId) {
      return leftContactId - rightContactId;
    }

    return left.index - right.index;
  });

  return sorted[0]?.index ?? null;
}

export function selectPrimaryContactIndex(
  candidates: PrimaryContactCandidate[],
  hint: PrimaryContactHint,
): number | null {
  if (candidates.length === 0) {
    return null;
  }

  if (hint.contactId !== null) {
    const byContactId = candidates.filter(
      (candidate) => candidate.contactId !== null && candidate.contactId === hint.contactId,
    );
    const selectedByContactId = selectBestPrimaryCandidateIndex(byContactId);
    if (selectedByContactId !== null) {
      return selectedByContactId;
    }
  }

  const normalizedRecordId = normalizeComparable(hint.recordId);
  if (normalizedRecordId) {
    const byRecordId = candidates.filter(
      (candidate) => normalizeComparable(candidate.recordId) === normalizedRecordId,
    );
    const selectedByRecordId = selectBestPrimaryCandidateIndex(byRecordId);
    if (selectedByRecordId !== null) {
      return selectedByRecordId;
    }
  }

  const normalizedEmail = normalizeComparable(hint.email);
  if (normalizedEmail) {
    const candidateEmails = splitEmailAddresses(hint.email);
    const byEmail = candidates.filter((candidate) => {
      const candidateEmail = normalizeComparable(candidate.email);
      return Boolean(candidateEmail) && candidateEmails.includes(candidateEmail);
    });
    const selectedByEmail = selectBestPrimaryCandidateIndex(byEmail);
    if (selectedByEmail !== null) {
      return selectedByEmail;
    }
  }

  const normalizedName = normalizeComparable(hint.name);
  if (normalizedName) {
    const byName = candidates.filter(
      (candidate) => normalizeComparable(candidate.name) === normalizedName,
    );
    const selectedByName = selectBestPrimaryCandidateIndex(byName);
    if (selectedByName !== null) {
      return selectedByName;
    }
  }

  return null;
}

type IndexedRow = {
  row: BusinessAccountRow;
  index: number;
};

function accountPrimaryKey(row: BusinessAccountRow, index: number): string {
  if (hasText(row.accountRecordId)) {
    return row.accountRecordId.trim();
  }
  if (hasText(row.id)) {
    return row.id.trim();
  }
  if (hasText(row.businessAccountId)) {
    return row.businessAccountId.trim();
  }
  if (hasText(row.companyName)) {
    return row.companyName.trim();
  }

  return `row-${index}`;
}

function selectBestPrimaryRowIndex(entries: IndexedRow[]): number | null {
  if (entries.length === 0) {
    return null;
  }

  const sorted = [...entries].sort((left, right) => {
    const leftContactId = left.row.contactId ?? Number.POSITIVE_INFINITY;
    const rightContactId = right.row.contactId ?? Number.POSITIVE_INFINITY;
    if (leftContactId !== rightContactId) {
      return leftContactId - rightContactId;
    }

    const leftRowKey = left.row.rowKey ?? "";
    const rightRowKey = right.row.rowKey ?? "";
    const rowKeyCompare = leftRowKey.localeCompare(rightRowKey, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (rowKeyCompare !== 0) {
      return rowKeyCompare;
    }

    return left.index - right.index;
  });

  return sorted[0]?.index ?? null;
}

export function enforceSinglePrimaryPerAccountRows(
  rows: BusinessAccountRow[],
): BusinessAccountRow[] {
  const uniqueRows = dedupeBusinessAccountRows(rows);
  if (uniqueRows.length <= 1) {
    return uniqueRows;
  }

  const grouped = new Map<string, IndexedRow[]>();
  uniqueRows.forEach((row, index) => {
    const key = accountPrimaryKey(row, index);
    const existing = grouped.get(key);
    if (existing) {
      existing.push({ row, index });
      return;
    }

    grouped.set(key, [{ row, index }]);
  });

  let changed = false;
  const next = [...uniqueRows];

  grouped.forEach((entries) => {
    if (entries.length <= 1) {
      return;
    }

    const primaryContactId = entries.reduce<number | null>((value, entry) => {
      if (value !== null) {
        return value;
      }
      return entry.row.primaryContactId ?? null;
    }, null);

    const byPrimaryContactId =
      primaryContactId !== null
        ? entries.filter(
            (entry) =>
              entry.row.contactId !== null &&
              entry.row.contactId !== undefined &&
              entry.row.contactId === primaryContactId,
          )
        : [];
    const flaggedPrimaryRows =
      byPrimaryContactId.length === 0
        ? entries.filter((entry) => entry.row.isPrimaryContact === true)
        : [];

    const selectedIndex =
      selectBestPrimaryRowIndex(byPrimaryContactId) ??
      selectBestPrimaryRowIndex(flaggedPrimaryRows);
    const selectedEntry =
      selectedIndex !== null ? entries.find((entry) => entry.index === selectedIndex) : undefined;
    const selectedContactId = selectedEntry?.row.contactId ?? primaryContactId;

    if (selectedIndex === null) {
      return;
    }

    entries.forEach((entry) => {
      const shouldBePrimary = entry.index === selectedIndex;
      const existingRow = next[entry.index];
      if (!existingRow) {
        return;
      }

      const primaryIdChanged =
        selectedContactId !== null &&
        selectedContactId !== undefined &&
        existingRow.primaryContactId !== selectedContactId;
      const primaryFlagChanged = Boolean(existingRow.isPrimaryContact) !== shouldBePrimary;
      if (!primaryIdChanged && !primaryFlagChanged) {
        return;
      }

      changed = true;
      next[entry.index] = {
        ...existingRow,
        primaryContactId:
          selectedContactId !== null && selectedContactId !== undefined
            ? selectedContactId
            : existingRow.primaryContactId,
        isPrimaryContact: shouldBePrimary,
      };
    });
  });

  return changed ? next : uniqueRows;
}

function normalizeAttributeCandidate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function canonicalIndustryType(value: string | null | undefined): string {
  const normalized = normalizeAttributeCandidate(value);
  if (!normalized) {
    return "";
  }

  const key = normalized.toLowerCase();
  const map: Record<string, string> = {
    distributi: "Distributi",
    distribution: "Distributi",
    manufactur: "Manufactur",
    manufacturing: "Manufactur",
    recreation: "Recreation",
    service: "Service",
  };

  return map[key] ?? normalized;
}

function canonicalSubCategory(value: string | null | undefined): string {
  const normalized = normalizeAttributeCandidate(value);
  if (!normalized) {
    return "";
  }

  const key = normalized.toLowerCase();
  const map: Record<string, string> = {
    automotive: "Automotive",
    distributi: "Distributi",
    "food & beverage": "Distributi",
    electronic: "Electronic",
    electronics: "Electronic",
    fabric: "Fabric",
    fabrication: "Fabric",
    general: "General",
    manufactur: "Manufactur",
    pharmaceuticals: "Manufactur",
    package: "Package",
    packaging: "Package",
    plastics: "Plastics",
    recreation: "Recreation",
    "aerospace & defense": "Recreation",
    service: "Service",
    chemical: "Service",
  };

  return map[key] ?? normalized;
}

function canonicalCompanyRegion(value: string | null | undefined): string {
  return canonicalBusinessAccountRegionValue(value);
}

function canonicalWeek(value: string | null | undefined): string {
  const normalized = normalizeAttributeCandidate(value);
  if (!normalized) {
    return "";
  }

  const weekMatch = normalized.match(/^week\s*(\d+)$/i);
  if (weekMatch) {
    return `Week ${weekMatch[1]}`;
  }

  return normalized;
}

function upsertAttributeValue(
  attributes: unknown[],
  attributeId: string,
  value: string,
): { hasExisting: boolean; next: unknown[] } {
  let hasExisting = false;
  const next = attributes.map((attribute) => {
    const id = readNullableString(attribute, "AttributeID");
    if (id !== attributeId) {
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

  return { hasExisting, next };
}

function readAccountPhone(record: unknown): string | null {
  return readFirstPhone(record, [
    "Business1",
    "Phone1",
    "BusinessPhone",
    "Phone2",
    "Phone3",
  ]);
}

type WritableBusinessAccountPhoneField = "Business1" | "BusinessPhone" | "Phone1";

function resolveWritableBusinessAccountPhoneField(
  record: unknown,
): WritableBusinessAccountPhoneField {
  const candidates: WritableBusinessAccountPhoneField[] = [
    "Business1",
    "BusinessPhone",
    "Phone1",
  ];

  for (const candidate of candidates) {
    if (hasText(readString(record, candidate))) {
      return candidate;
    }
  }

  return "Business1";
}

function readCompanyPhoneFromContacts(account: unknown): string | null {
  const contacts = readArrayField(account, "Contacts");

  for (const contact of contacts) {
    const contactPhone = readPrimaryContactPhone(contact).phone;
    if (!contactPhone) {
      continue;
    }

    const contactName = composeContactName(contact);
    if (hasUsableSuppressedContactName(contactName)) {
      continue;
    }

    const contactEmail = readFirstString(contact, ["Email", "EMail"]) || null;
    if (hasText(contactEmail)) {
      continue;
    }

    return contactPhone;
  }

  return null;
}

function readSalesRepId(record: unknown): string | null {
  return chooseFirst([
    readNullableString(record, "Owner"),
    readNullableString(record, "OwnerID"),
  ]);
}

function readSalesRepName(record: unknown): string | null {
  return chooseFirst([
    readNullableString(record, "OwnerEmployeeName"),
    readNullableString(record, "OwnerName"),
  ]);
}

function normalizePrimaryContact(account: unknown): {
  id: number | null;
  name: string | null;
  jobTitle: string | null;
  phone: string | null;
  extension: string | null;
  rawPhone: string | null;
  email: string | null;
  notes: string | null;
} {
  const primary = unwrapRecordValue(getField(account, "PrimaryContact"));
  const primaryContactId = readNullableNumber(primary, "ContactID");
  const primaryContactName = composeContactName(primary);
  const primaryContactEmail = readFirstString(primary, ["Email", "EMail"]) || null;
  const primaryEmailCandidates = splitEmailAddresses(primaryContactEmail);
  const contacts = readArrayField(account, "Contacts");

  const matchingContactById =
    primaryContactId !== null
      ? contacts.find(
          (contact) => readNullableNumber(contact, "ContactID") === primaryContactId,
        )
      : null;
  const matchingContactByName =
    !matchingContactById && primaryContactName
      ? contacts.find((contact) => composeContactName(contact) === primaryContactName)
      : null;
  const matchingContactByEmail =
    !matchingContactById && !matchingContactByName && primaryEmailCandidates.length > 0
      ? contacts.find((contact) => {
          const contactEmail = readFirstString(contact, ["Email", "EMail"]) || null;
          const contactCandidates = splitEmailAddresses(contactEmail);
          return contactCandidates.some((email) => primaryEmailCandidates.includes(email));
        })
      : null;
  const matchingContact =
    matchingContactById ?? matchingContactByName ?? matchingContactByEmail;
  const resolvedContactId =
    readNullableNumber(matchingContact, "ContactID") ?? primaryContactId;
  const primaryPhone = readPrimaryContactPhone(primary);
  const matchingPhone = readPrimaryContactPhone(matchingContact);

  return {
    id: resolvedContactId,
    name: chooseFirst([primaryContactName, composeContactName(matchingContact)]),
    jobTitle: chooseFirst([
      readContactJobTitle(primary),
      readContactJobTitle(matchingContact),
    ]),
    phone: chooseFirst([
      primaryPhone.phone,
      matchingPhone.phone,
    ]),
    extension: chooseFirst([primaryPhone.extension, matchingPhone.extension]),
    rawPhone: chooseFirst([primaryPhone.rawPhone, matchingPhone.rawPhone]),
    email: chooseFirst([
      primaryContactEmail,
      readFirstString(matchingContact, ["Email", "EMail"]),
    ]),
    notes: chooseFirst([
      readNullableString(primary, "note"),
      readNullableString(matchingContact, "note"),
    ]),
  };
}

function extractCategory(account: unknown): Category | null {
  const attrs = readArrayField(account, "Attributes");
  if (!attrs.length) {
    return null;
  }

  for (const attribute of attrs) {
    const attributeId = readNullableString(attribute, "AttributeID");
    if (attributeId !== "CLIENTTYPE") {
      continue;
    }

    const direct = toCategory(readNullableString(attribute, "Value"));
    if (direct) {
      return direct;
    }

    const description = readNullableString(attribute, "ValueDescription");
    if (!description) {
      return null;
    }

    const match = description.trim().match(/^[A-D]/i);
    return match ? toCategory(match[0].toUpperCase()) : null;
  }

  return null;
}

function extractAttributeValue(account: unknown, attributeId: string): string | null {
  const attrs = readArrayField(account, "Attributes");
  if (!attrs.length) {
    return null;
  }

  for (const attribute of attrs) {
    const currentId = readNullableString(attribute, "AttributeID");
    if (currentId !== attributeId) {
      continue;
    }

    return chooseFirst([
      readNullableString(attribute, "ValueDescription"),
      readNullableString(attribute, "Value"),
    ]);
  }

  return null;
}

export function resolveCompanyPhone(row: BusinessAccountRow): string | null {
  if (hasText(row.companyPhone)) {
    return row.companyPhone.trim();
  }

  if (!hasText(row.phoneNumber)) {
    return null;
  }

  const fallback = row.phoneNumber.trim();
  const primaryPhone = row.primaryContactPhone?.trim() ?? "";
  if (!primaryPhone) {
    return fallback;
  }

  if (normalizeComparable(fallback) !== normalizeComparable(primaryPhone)) {
    return fallback;
  }

  if (!hasText(row.primaryContactEmail)) {
    return fallback;
  }

  return null;
}

function sortValue(row: BusinessAccountRow, sortBy: SortBy): string {
  if (sortBy === "companyPhone") {
    return resolveCompanyPhone(row)?.toLowerCase() ?? "";
  }

  const value = row[sortBy];
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).toLowerCase();
}

function includesFilter(value: string | null, filter: string | undefined): boolean {
  if (!filter) {
    return true;
  }

  return (value ?? "").toLowerCase().includes(filter.toLowerCase());
}

function readCompanyNameInitial(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const first = trimmed[0]?.toUpperCase() ?? "";
  return /^[A-Z]$/.test(first) ? first : null;
}

function includesPhoneFilter(value: string | null, filter: string | undefined): boolean {
  if (includesFilter(value, filter)) {
    return true;
  }

  const filterDigits = extractNormalizedPhoneDigits(filter);
  if (!filterDigits) {
    return false;
  }

  const valueDigits = extractNormalizedPhoneDigits(value);
  return valueDigits.includes(filterDigits);
}

function includesLastModifiedFilter(
  value: string | null,
  filter: string | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  const raw = (value ?? "").toLowerCase();
  if (raw.includes(filter.toLowerCase())) {
    return true;
  }

  if (!value) {
    return false;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const formattedDate = date.toLocaleString().toLowerCase();
  return formattedDate.includes(filter.toLowerCase());
}

export function normalizeBusinessAccount(account: unknown): BusinessAccountRow {
  const mainAddress = unwrapRecordValue(getField(account, "MainAddress"));

  const addressParts = {
    line1: readString(mainAddress, "AddressLine1"),
    line2: readString(mainAddress, "AddressLine2"),
    city: readString(mainAddress, "City"),
    state: readString(mainAddress, "State"),
    postalCode: readString(mainAddress, "PostalCode"),
    country: readString(mainAddress, "Country"),
  };

  const contact = normalizePrimaryContact(account);

  const id = getField(account, "id");
  const accountNote = readNullableString(account, "note");
  const noteId = readNullableString(account, "NoteID");
  const businessAccountId = readFirstString(account, [
    "BusinessAccountID",
    "BAccountID",
    "AccountCD",
    "AccountID",
    "BusinessAccountCD",
  ]);
  const companyName = readFirstString(account, [
    "Name",
    "CompanyName",
    "AcctName",
    "BusinessAccountName",
  ]);
  const rowId =
    (typeof id === "string" && id) || noteId || businessAccountId || companyName;
  const accountPhone = readAccountPhone(account);
  const inferredCompanyPhone = readCompanyPhoneFromContacts(account);
  const companyPhone = chooseFirst([accountPhone, inferredCompanyPhone]);
  const companyPhoneSource: CompanyPhoneSource | null = accountPhone
    ? "account"
    : inferredCompanyPhone
      ? "placeholder"
      : null;
  const salesRepId = readSalesRepId(account);
  const salesRepName = readSalesRepName(account);
  const industryType = extractAttributeValue(account, "INDUSTRY");
  const subCategory = extractAttributeValue(account, "INDSUBCATE");
  const companyRegion = extractAttributeValue(account, "REGION");
  const week = extractAttributeValue(account, "WEEK");

  return {
    id: rowId,
    accountRecordId: rowId,
    rowKey: `${rowId}:primary`,
    contactId: contact.id,
    isPrimaryContact: true,
    companyPhone,
    companyPhoneSource,
    phoneNumber: contact.phone,
    salesRepId,
    salesRepName,
    industryType,
    subCategory,
    companyRegion,
    week,
    businessAccountId,
    companyName,
    companyDescription: null,
    address: formatAddress(addressParts),
    addressLine1: addressParts.line1,
    addressLine2: addressParts.line2,
    city: addressParts.city,
    state: addressParts.state,
    postalCode: addressParts.postalCode,
    country: addressParts.country,
    primaryContactName: contact.name,
    primaryContactJobTitle: contact.jobTitle,
    primaryContactPhone: contact.phone,
    primaryContactExtension: contact.extension,
    primaryContactRawPhone: contact.rawPhone,
    primaryContactEmail: contact.email,
    primaryContactId: contact.id,
    category: extractCategory(account),
    notes: contact.notes ?? accountNote,
    lastEmailedAt: null,
    lastModifiedIso: readNullableString(account, "LastModifiedDateTime"),
  };
}

export function normalizeBusinessAccountRows(account: unknown): BusinessAccountRow[] {
  const base = normalizeBusinessAccount(account);
  const contacts = readArrayField(account, "Contacts");
  const primary = unwrapRecordValue(getField(account, "PrimaryContact"));
  const primaryId = readNullableNumber(primary, "ContactID");
  const primaryFromPayload = composeContactName(primary);
  const primaryEmail = readFirstString(primary, ["Email", "EMail"]) || null;
  const primaryRecordId = readRecordIdentity(primary);
  const primaryHint: PrimaryContactHint = {
    contactId: primaryId,
    recordId: primaryRecordId,
    email: primaryEmail,
    name: primaryFromPayload,
  };
  const primaryCandidates: PrimaryContactCandidate[] = contacts.map((contact, index) => ({
    contactId: readNullableNumber(contact, "ContactID"),
    recordId: readRecordIdentity(contact),
    email: readFirstString(contact, ["Email", "EMail"]) || null,
    name: composeContactName(contact),
    rowNumber: readNullableNumber(contact, "rowNumber"),
    index,
  }));
  const selectedPrimaryIndex = selectPrimaryContactIndex(primaryCandidates, primaryHint);
  const rows: BusinessAccountRow[] = [];

  for (let index = 0; index < contacts.length; index += 1) {
    const contact = contacts[index];
    const contactId = readNullableNumber(contact, "ContactID");
    const contactName = composeContactName(contact);
    const contactPhoneFields = readPrimaryContactPhone(contact);
    const contactPhone = contactPhoneFields.phone;
    const contactEmail = readFirstString(contact, ["Email", "EMail"]) || null;
    const contactRecordId = readRecordIdentity(contact);
    const isPrimary = selectedPrimaryIndex !== null && selectedPrimaryIndex === index;

    if (!hasUsableSuppressedContactName(contactName)) {
      continue;
    }

    rows.push({
      ...base,
      rowKey: `${base.id}:contact:${contactId ?? contactRecordId ?? index}`,
      accountRecordId: base.id,
      contactId,
      isPrimaryContact: isPrimary,
      companyPhone: base.companyPhone,
      companyPhoneSource: base.companyPhoneSource ?? null,
      primaryContactName: chooseFirst([
        contactName,
        isPrimary ? base.primaryContactName : null,
      ]),
      primaryContactJobTitle: chooseFirst([
        readContactJobTitle(contact),
        isPrimary ? base.primaryContactJobTitle ?? null : null,
      ]),
      primaryContactPhone: chooseFirst([
        contactPhone,
        isPrimary ? base.primaryContactPhone : null,
      ]),
      primaryContactRawPhone: chooseFirst([
        contactPhoneFields.rawPhone,
        isPrimary ? base.primaryContactRawPhone ?? null : null,
      ]),
      primaryContactExtension: chooseFirst([
        contactPhoneFields.extension,
        isPrimary ? base.primaryContactExtension ?? null : null,
      ]),
      primaryContactEmail: chooseFirst([
        contactEmail,
        isPrimary ? base.primaryContactEmail : null,
      ]),
      notes: chooseFirst([readNullableString(contact, "note"), isPrimary ? base.notes : null]),
      phoneNumber: chooseFirst([contactPhone, isPrimary ? base.primaryContactPhone : null]),
    });
  }

  if (rows.length === 0) {
    return canonicalizeBusinessAccountRows([
      {
        ...base,
        rowKey: `${base.id}:primary`,
        accountRecordId: base.id,
        contactId: base.primaryContactId,
        isPrimaryContact: Boolean(base.primaryContactId || base.primaryContactName),
        companyPhone: base.companyPhone,
        companyPhoneSource: base.companyPhoneSource ?? null,
        phoneNumber: base.primaryContactPhone,
        primaryContactJobTitle: base.primaryContactJobTitle ?? null,
        primaryContactRawPhone: base.primaryContactRawPhone ?? null,
        primaryContactExtension: base.primaryContactExtension ?? null,
      },
    ]);
  }

  return canonicalizeBusinessAccountRows(rows);
}

export function queryBusinessAccounts(
  rows: BusinessAccountRow[],
  options: QueryOptions,
): { items: BusinessAccountRow[]; total: number; page: number; pageSize: number } {
  const sourceRows = dedupeBusinessAccountRows(
    filterSuppressedBusinessAccountRows(rows, {
      includeInternalRows: options.includeInternalRows,
    }),
  );
  const normalizedSearch = options.q?.trim().toLowerCase() ?? "";
  const effectiveCategory = options.filterCategory ?? options.category;

  const filtered = sourceRows.filter((row) => {
    if (effectiveCategory && row.category !== effectiveCategory) {
      return false;
    }

    if (
      options.filterCompanyInitial &&
      readCompanyNameInitial(row.companyName) !== options.filterCompanyInitial.trim().toUpperCase()
    ) {
      return false;
    }

    if (!includesFilter(row.companyName, options.filterCompanyName)) {
      return false;
    }

    if (!includesFilter(row.salesRepName, options.filterSalesRep)) {
      return false;
    }

    if (!includesFilter(row.industryType, options.filterIndustryType)) {
      return false;
    }

    if (!includesFilter(row.subCategory, options.filterSubCategory)) {
      return false;
    }

    if (!includesFilter(row.companyRegion, options.filterCompanyRegion)) {
      return false;
    }

    if (!includesFilter(row.week, options.filterWeek)) {
      return false;
    }

    if (!includesFilter(row.address, options.filterAddress)) {
      return false;
    }

    if (!includesPhoneFilter(resolveCompanyPhone(row), options.filterCompanyPhone)) {
      return false;
    }

    if (!includesFilter(row.primaryContactName, options.filterPrimaryContactName)) {
      return false;
    }

    if (!includesFilter(row.primaryContactJobTitle ?? null, options.filterPrimaryContactJobTitle)) {
      return false;
    }

    if (!includesPhoneFilter(row.primaryContactPhone, options.filterPrimaryContactPhone)) {
      return false;
    }

    if (!includesFilter(row.primaryContactExtension ?? null, options.filterPrimaryContactExtension)) {
      return false;
    }

    if (!includesFilter(row.primaryContactEmail, options.filterPrimaryContactEmail)) {
      return false;
    }

    if (!includesFilter(row.notes, options.filterNotes)) {
      return false;
    }

    if (!includesLastModifiedFilter(row.lastEmailedAt ?? null, options.filterLastEmailed)) {
      return false;
    }

    if (!includesLastModifiedFilter(row.lastModifiedIso, options.filterLastModified)) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      row.companyName,
      row.salesRepName,
      row.industryType,
      row.subCategory,
      row.companyRegion,
      row.week,
      row.address,
      resolveCompanyPhone(row),
      row.primaryContactName,
      row.primaryContactJobTitle,
      row.primaryContactPhone,
      row.primaryContactExtension,
      row.primaryContactEmail,
      row.notes,
      row.lastEmailedAt,
      row.businessAccountId,
      row.companyDescription,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });

  const sortBy = options.sortBy ?? "companyName";
  const sortDir = options.sortDir ?? "asc";

  const sorted = [...filtered].sort((left, right) => {
    const leftValue = sortValue(left, sortBy);
    const rightValue = sortValue(right, sortBy);
    const leftBlank = leftValue.trim().length === 0;
    const rightBlank = rightValue.trim().length === 0;

    if (leftBlank !== rightBlank) {
      return leftBlank ? 1 : -1;
    }

    const compare = leftValue.localeCompare(rightValue, undefined, {
      numeric: true,
      sensitivity: "base",
    });

    return sortDir === "asc" ? compare : -compare;
  });

  const total = sorted.length;
  const page = Math.max(options.page, 1);
  const pageSize = Math.max(options.pageSize, 1);
  const start = (page - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
  };
}

export function sanitizeNullableInput(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasPrimaryContactChanges(
  existing: BusinessAccountRow,
  incoming: BusinessAccountUpdateRequest,
): boolean {
  return (
    sanitizeNullableInput(incoming.primaryContactName) !==
      sanitizeNullableInput(existing.primaryContactName) ||
    sanitizeNullableInput(incoming.primaryContactJobTitle) !==
      sanitizeNullableInput(existing.primaryContactJobTitle) ||
    sanitizeNullableInput(incoming.primaryContactPhone) !==
      sanitizeNullableInput(existing.primaryContactPhone) ||
    sanitizeNullableInput(incoming.primaryContactExtension) !==
      sanitizeNullableInput(existing.primaryContactExtension) ||
    sanitizeNullableInput(incoming.primaryContactEmail) !==
      sanitizeNullableInput(existing.primaryContactEmail) ||
    sanitizeNullableInput(incoming.notes) !== sanitizeNullableInput(existing.notes)
  );
}

export function hasBusinessAccountChanges(
  existing: BusinessAccountRow,
  incoming: BusinessAccountUpdateRequest,
): boolean {
  return (
    existing.companyName.trim() !== incoming.companyName.trim() ||
    hasAddressChanges(existing, incoming) ||
    sanitizeNullableInput(incoming.salesRepId) !== sanitizeNullableInput(existing.salesRepId) ||
    sanitizeNullableInput(incoming.salesRepName) !== sanitizeNullableInput(existing.salesRepName) ||
    sanitizeNullableInput(incoming.industryType) !== sanitizeNullableInput(existing.industryType) ||
    sanitizeNullableInput(incoming.subCategory) !== sanitizeNullableInput(existing.subCategory) ||
    sanitizeNullableInput(incoming.companyRegion) !==
      sanitizeNullableInput(existing.companyRegion) ||
    sanitizeNullableInput(incoming.week) !== sanitizeNullableInput(existing.week) ||
    incoming.category !== existing.category ||
    !phoneValuesEquivalent(incoming.companyPhone, resolveCompanyPhone(existing))
  );
}

export function hasAddressChanges(
  existing: BusinessAccountRow,
  incoming: BusinessAccountUpdateRequest,
): boolean {
  return (
    existing.addressLine1.trim() !== incoming.addressLine1.trim() ||
    existing.addressLine2.trim() !== incoming.addressLine2.trim() ||
    existing.city.trim() !== incoming.city.trim() ||
    existing.state.trim() !== incoming.state.trim() ||
    existing.postalCode.trim() !== incoming.postalCode.trim() ||
    existing.country.trim().toUpperCase() !== incoming.country.trim().toUpperCase()
  );
}

export function buildBusinessAccountUpdatePayload(
  existingRawAccount: unknown,
  update: BusinessAccountUpdateRequest,
  options?: {
    includeCompanyPhone?: boolean;
  },
): Record<string, unknown> {
  const existingPrimary = getField(existingRawAccount, "PrimaryContact");
  const existingPrimaryRecordId = readRecordIdentity(existingPrimary);
  const attributes = [...readArrayField(existingRawAccount, "Attributes")];
  const attributeUpdates: Array<{ id: string; value: string; skipWhenBlank?: boolean }> = [
    { id: "CLIENTTYPE", value: update.category ?? "", skipWhenBlank: true },
    { id: "INDUSTRY", value: canonicalIndustryType(update.industryType) },
    { id: "INDSUBCATE", value: canonicalSubCategory(update.subCategory) },
    { id: "REGION", value: canonicalCompanyRegion(update.companyRegion) },
    { id: "WEEK", value: canonicalWeek(update.week), skipWhenBlank: true },
  ];

  let updatedAttributes = attributes;
  for (const attributeUpdate of attributeUpdates) {
    if (attributeUpdate.skipWhenBlank && attributeUpdate.value.trim().length === 0) {
      continue;
    }

    const upsert = upsertAttributeValue(
      updatedAttributes,
      attributeUpdate.id,
      attributeUpdate.value,
    );
    updatedAttributes = upsert.next;

    if (!upsert.hasExisting) {
      updatedAttributes.push({
        AttributeID: {
          value: attributeUpdate.id,
        },
        Value: {
          value: attributeUpdate.value,
        },
      });
    }
  }

  const companyPhoneField = resolveWritableBusinessAccountPhoneField(existingRawAccount);
  const includeCompanyPhone = options?.includeCompanyPhone === true;

  return {
    Name: {
      value: update.companyName,
    },
    Owner: {
      value: update.salesRepId ?? "",
    },
    MainAddress: {
      AddressLine1: {
        value: update.addressLine1,
      },
      AddressLine2: {
        value: update.addressLine2,
      },
      City: {
        value: update.city,
      },
      State: {
        value: update.state,
      },
      PostalCode: {
        value: update.postalCode,
      },
      Country: {
        value: update.country,
      },
    },
    Attributes: updatedAttributes,
    ...(includeCompanyPhone
      ? {
          [companyPhoneField]: {
            value: update.companyPhone ?? "",
          },
        }
      : {}),
    ...(update.setAsPrimaryContact && update.targetContactId !== null
      ? {
          ContactID: {
            value: update.targetContactId,
          },
          PrimaryContactID: {
            value: update.targetContactId,
          },
          PrimaryContact: {
            ...(existingPrimaryRecordId
              ? {
                  id: existingPrimaryRecordId,
                }
              : {}),
            ContactID: {
              value: update.targetContactId,
            },
          },
        }
      : {}),
  };
}

export function buildPrimaryContactUpdatePayload(
  update: BusinessAccountUpdateRequest,
): Record<string, unknown> {
  const name = splitContactName(update.primaryContactName);
  const normalizedExtension = normalizeExtensionForSave(update.primaryContactExtension);
  return {
    DisplayName: {
      value: update.primaryContactName ?? "",
    },
    ...(name.firstName
      ? {
          FirstName: {
            value: name.firstName,
          },
        }
      : {}),
    LastName: {
      value: name.lastName,
    },
    JobTitle: {
      value: update.primaryContactJobTitle ?? "",
    },
    Phone1: {
      value: update.primaryContactPhone ?? "",
    },
    Phone2: {
      value: normalizedExtension ?? "",
    },
    Email: {
      value: update.primaryContactEmail ?? "",
    },
    note: {
      value: update.notes ?? "",
    },
  };
}

export function readRawBusinessAccountPrimaryContactId(rawAccount: unknown): number | null {
  if (!isRecord(rawAccount)) {
    return null;
  }

  const primary = rawAccount.PrimaryContact;
  return (
    readNullableNumber(primary, "ContactID") ??
    readNullableNumber(rawAccount, "PrimaryContactID") ??
    readNullableNumber(rawAccount, "MainContactID")
  );
}

export function resolveBusinessAccountRecordId(
  rawAccount: unknown,
  fallbackId: string,
): string {
  if (isRecord(rawAccount)) {
    const rawId = typeof rawAccount.id === "string" ? rawAccount.id.trim() : "";
    if (rawId) {
      return rawId;
    }

    const noteId = readNullableString(rawAccount, "NoteID");
    if (noteId) {
      return noteId;
    }
  }

  return fallbackId;
}

export function buildBusinessAccountIdentityPayload(
  rawAccount: unknown,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (!isRecord(rawAccount)) {
    return payload;
  }

  const rawId = typeof rawAccount.id === "string" ? rawAccount.id.trim() : "";
  if (rawId) {
    payload.id = rawId;
  }

  const noteId = readNullableString(rawAccount, "NoteID");
  if (noteId) {
    payload.NoteID = {
      value: noteId,
    };
  }

  const businessAccountId =
    readNullableString(rawAccount, "BusinessAccountID") ??
    readNullableString(rawAccount, "BAccountID") ??
    readNullableString(rawAccount, "AccountCD");
  if (businessAccountId) {
    payload.BusinessAccountID = {
      value: businessAccountId,
    };
  }

  return payload;
}

export function buildBusinessAccountUpdateIdentifiers(
  rawAccount: unknown,
  fallbackId: string,
): string[] {
  const rawId =
    isRecord(rawAccount) && typeof rawAccount.id === "string" ? rawAccount.id.trim() : "";
  const businessAccountId =
    readNullableString(rawAccount, "BusinessAccountID") ??
    readNullableString(rawAccount, "BAccountID") ??
    readNullableString(rawAccount, "AccountCD");
  const noteId = readNullableString(rawAccount, "NoteID");

  return [businessAccountId ?? "", rawId, noteId ?? "", fallbackId]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

export function buildPrimaryContactFallbackPayloads(
  rawAccount: unknown,
  targetContactId: number,
  targetContact?: unknown,
): Array<Record<string, unknown>> {
  const primary =
    isRecord(rawAccount) && isRecord(rawAccount.PrimaryContact) ? rawAccount.PrimaryContact : null;
  const primaryRecordId =
    primary && typeof primary.id === "string" && primary.id.trim() ? primary.id.trim() : null;
  const targetContactRecordId = readRecordIdentity(targetContact);

  const payloads: Array<Record<string, unknown>> = [
    {
      ContactID: {
        value: targetContactId,
      },
    },
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

  if (targetContactRecordId) {
    payloads.push(
      {
        PrimaryContact: {
          value: targetContactRecordId,
        },
      },
      {
        MainContact: {
          value: targetContactRecordId,
        },
      },
      {
        PrimaryContact: {
          id: targetContactRecordId,
        },
      },
      {
        MainContact: {
          id: targetContactRecordId,
        },
      },
      {
        PrimaryContact: {
          NoteID: {
            value: targetContactRecordId,
          },
        },
      },
      {
        MainContact: {
          NoteID: {
            value: targetContactRecordId,
          },
        },
      },
    );
  }

  const seen = new Set<string>();
  return payloads.filter((payload) => {
    const fingerprint = JSON.stringify(payload);
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

export function withAccountContacts(
  businessAccount: unknown,
  contacts: unknown[],
): unknown {
  if (!isRecord(businessAccount)) {
    return businessAccount;
  }

  return {
    ...businessAccount,
    Contacts: contacts,
  };
}

export function withPrimaryContact(
  businessAccount: unknown,
  primaryContact: unknown,
): unknown {
  if (!isRecord(businessAccount)) {
    return businessAccount;
  }

  return {
    ...businessAccount,
    PrimaryContact: primaryContact,
  };
}
