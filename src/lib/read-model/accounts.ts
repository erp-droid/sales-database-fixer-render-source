import {
  normalizeBusinessAccountRowClassification,
  queryBusinessAccounts,
  removeContactlessPrimaryContactDuplicateRows,
  resolveCompanyPhone,
} from "@/lib/business-accounts";
import { resolveLastCalledAtForBusinessAccountRow } from "@/lib/business-account-call-history";
import { applyDeferredActionsToRows } from "@/lib/deferred-actions-store";
import { extractNormalizedPhoneDigits } from "@/lib/phone";
import { invalidateReadModelCaches, registerReadModelCacheClearer } from "@/lib/read-model/cache";
import { applyLocalAccountMetadataToRows } from "@/lib/read-model/account-local-metadata";
import { applySharedContactNotesToRows } from "@/lib/read-model/contact-identity-notes";
import { getReadModelDb } from "@/lib/read-model/db";
import { rebuildSalesRepDirectoryFromStoredRows } from "@/lib/read-model/sales-reps";
import type {
  BusinessAccountDetailResponse,
  BusinessAccountRow,
  BusinessAccountsResponse,
} from "@/types/business-account";

type StoredAccountRow = {
  payload_json: string;
};

type RecentCallSessionIdentityRow = {
  linked_account_row_key: string | null;
  linked_contact_id: number | null;
  matched_contact_id: number | null;
  linked_business_account_id: string | null;
  matched_business_account_id: string | null;
  target_phone: string | null;
  counterparty_phone: string | null;
};

type ReadModelListQuery = Parameters<typeof queryBusinessAccounts>[1];

const RECENT_CALL_SESSION_REFRESH_LIMIT = 50;
const MAX_MATCH_VALUES_PER_FIELD = 100;

let allRowsCache: BusinessAccountRow[] | null = null;
let allRowsCacheVersion: string | null = null;

registerReadModelCacheClearer(() => {
  allRowsCache = null;
  allRowsCacheVersion = null;
});

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeIdentityText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeBusinessAccountId(value: string | null | undefined): string {
  return normalizeIdentityText(value).toUpperCase();
}

function buildAddressKey(row: BusinessAccountRow): string {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((part) => normalizeText(part))
    .join("|");
}

function buildSearchText(row: BusinessAccountRow): string {
  return [
    row.companyName,
    row.businessAccountId,
    row.accountType,
    row.opportunityCount !== null && row.opportunityCount !== undefined
      ? String(row.opportunityCount)
      : null,
    row.address,
    resolveCompanyPhone(row),
    row.primaryContactName,
    row.primaryContactEmail,
    row.primaryContactPhone,
    row.salesRepName,
    row.industryType,
    row.subCategory,
    row.companyRegion,
    row.week,
    row.companyDescription,
    row.notes,
    row.category,
    row.lastCalledAt,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function isPositiveInteger(value: number | null | undefined): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter(isPositiveInteger))];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => normalizeIdentityText(value))
        .filter((value) => value.length > 0),
    ),
  ];
}

function uniqueBusinessAccountIds(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => {
          const normalized = normalizeIdentityText(value);
          const upper = normalizeBusinessAccountId(value);
          return normalized && upper && normalized !== upper
            ? [normalized, upper]
            : [normalized || upper];
        })
        .filter((value) => value.length > 0),
    ),
  ];
}

function limitMatchValues<T>(values: T[]): T[] {
  return values.slice(0, MAX_MATCH_VALUES_PER_FIELD);
}

function buildPhoneQueryValues(values: Array<string | null | undefined>): string[] {
  const candidates: string[] = [];

  for (const value of values) {
    const normalized = normalizeIdentityText(value);
    if (normalized) {
      candidates.push(normalized);
    }

    const digits = extractNormalizedPhoneDigits(value);
    if (!digits) {
      continue;
    }

    candidates.push(digits, `+${digits}`);
    if (digits.length === 10) {
      candidates.push(`1${digits}`, `+1${digits}`);
    } else if (digits.length === 11 && digits.startsWith("1")) {
      candidates.push(digits.slice(1), `+${digits.slice(1)}`);
    }
  }

  return uniqueStrings(candidates);
}

function appendInClause<T extends string | number>(
  clauses: string[],
  params: Array<string | number>,
  column: string,
  values: T[],
): void {
  const limitedValues = limitMatchValues(values);
  if (limitedValues.length === 0) {
    return;
  }

  clauses.push(`${column} IN (${limitedValues.map(() => "?").join(", ")})`);
  params.push(...limitedValues);
}

function resolveLastCalledAtMatchKeys(row: BusinessAccountRow): string[] {
  const keys: string[] = [];
  const rowKey = normalizeIdentityText(row.rowKey ?? row.id);
  if (rowKey) {
    keys.push(`row:${rowKey}`);
  }

  for (const contactId of uniqueNumbers([row.contactId, row.primaryContactId])) {
    keys.push(`contact:${contactId}`);
  }

  return keys;
}

function pickLaterIso(left: string | null | undefined, right: string | null | undefined): string | null {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return rightTime > leftTime ? right : left;
  }

  return right > left ? right : left;
}

function buildExistingLastCalledAtLookup(existingRows: BusinessAccountRow[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const row of existingRows) {
    if (!row.lastCalledAt) {
      continue;
    }

    for (const key of resolveLastCalledAtMatchKeys(row)) {
      const nextValue = pickLaterIso(lookup.get(key), row.lastCalledAt);
      if (nextValue) {
        lookup.set(key, nextValue);
      }
    }
  }

  return lookup;
}

function resolveInheritedLastCalledAt(
  row: BusinessAccountRow,
  lookup: Map<string, string>,
  accountFallback: string | null,
): string | null {
  for (const key of resolveLastCalledAtMatchKeys(row)) {
    const value = lookup.get(key);
    if (value) {
      return value;
    }
  }

  return accountFallback;
}

function inheritSupplementalAccountMetadata(
  nextRows: BusinessAccountRow[],
  existingRows: BusinessAccountRow[],
): BusinessAccountRow[] {
  const existingAccountType =
    existingRows.find((row) => typeof row.accountType === "string")?.accountType;
  const existingOpportunityCount = existingRows.find(
    (row) => row.opportunityCount !== undefined,
  )?.opportunityCount;
  const existingLastCalledAtByRow = buildExistingLastCalledAtLookup(existingRows);
  const accountLastCalledAtFallback =
    existingRows.length === 1 ? existingRows[0]?.lastCalledAt ?? null : null;

  if (
    existingAccountType === undefined &&
    existingOpportunityCount === undefined &&
    existingLastCalledAtByRow.size === 0 &&
    !accountLastCalledAtFallback
  ) {
    return nextRows;
  }

  return nextRows.map((row) => {
    const nextRow = { ...row };

    if (nextRow.accountType === undefined && existingAccountType !== undefined) {
      nextRow.accountType = existingAccountType;
    }

    if (nextRow.opportunityCount === undefined && existingOpportunityCount !== undefined) {
      nextRow.opportunityCount = existingOpportunityCount;
    }

    if (!nextRow.lastCalledAt) {
      nextRow.lastCalledAt = resolveInheritedLastCalledAt(
        nextRow,
        existingLastCalledAtByRow,
        accountLastCalledAtFallback,
      );
    }

    return nextRow;
  });
}

function normalizeStoredSupplementalFields(row: BusinessAccountRow): BusinessAccountRow {
  return {
    ...row,
    accountType: row.accountType ?? null,
    opportunityCount: row.opportunityCount ?? null,
    lastCalledAt: row.lastCalledAt ?? null,
  };
}

function prepareRowsForStorage(
  nextRows: BusinessAccountRow[],
  existingRows: BusinessAccountRow[] = [],
): BusinessAccountRow[] {
  return removeContactlessPrimaryContactDuplicateRows(
    inheritSupplementalAccountMetadata(nextRows, existingRows).map(normalizeStoredSupplementalFields),
  );
}

function parseStoredRow(payload: string): BusinessAccountRow | null {
  try {
    return JSON.parse(payload) as BusinessAccountRow;
  } catch {
    return null;
  }
}

function parseRawStoredRows(rows: StoredAccountRow[]): BusinessAccountRow[] {
  return removeContactlessPrimaryContactDuplicateRows(
    rows
      .map((row) => parseStoredRow(row.payload_json))
      .filter((row): row is BusinessAccountRow => row !== null),
  );
}

function parseStoredRows(rows: StoredAccountRow[]): BusinessAccountRow[] {
  return removeContactlessPrimaryContactDuplicateRows(
    rows
      .map((row) => parseStoredRow(row.payload_json))
      .filter((row): row is BusinessAccountRow => row !== null)
      .map(normalizeBusinessAccountRowClassification),
  );
}

function applyReadModelRowDecorations(rows: BusinessAccountRow[]): BusinessAccountRow[] {
  return applySharedContactNotesToRows(
    applyLocalAccountMetadataToRows(applyDeferredActionsToRows(rows)),
  );
}

export function readReadModelRowsSnapshotVersion(): string {
  const db = getReadModelDb();
  const accountRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS row_count,
        COALESCE(MAX(updated_at), '') AS latest_updated_at
      FROM account_rows
      `,
    )
    .get() as {
    row_count?: number;
    latest_updated_at?: string;
  };

  const callSessionRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS row_count,
        COALESCE(MAX(updated_at), '') AS latest_updated_at
      FROM call_sessions
      `,
    )
    .get() as {
    row_count?: number;
    latest_updated_at?: string;
  };

  const contactIdentityNotesRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS row_count,
        COALESCE(MAX(updated_at), '') AS latest_updated_at
      FROM contact_identity_notes
      `,
    )
    .get() as {
    row_count?: number;
    latest_updated_at?: string;
  };

  return [
    Number(accountRow?.row_count ?? 0),
    accountRow?.latest_updated_at ?? "",
    Number(callSessionRow?.row_count ?? 0),
    callSessionRow?.latest_updated_at ?? "",
    Number(contactIdentityNotesRow?.row_count ?? 0),
    contactIdentityNotesRow?.latest_updated_at ?? "",
  ].join("|");
}

export function readAllAccountRowsFromReadModel(): BusinessAccountRow[] {
  const nextVersion = readReadModelRowsSnapshotVersion();
  if (allRowsCache && allRowsCacheVersion === nextVersion) {
    return allRowsCache;
  }

  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      ORDER BY company_name COLLATE NOCASE ASC, row_key ASC
      `,
    )
    .all() as StoredAccountRow[];

  allRowsCache = applyReadModelRowDecorations(parseStoredRows(rows));
  allRowsCacheVersion = nextVersion;

  return allRowsCache;
}

export function readStoredAccountRowsFromReadModel(): BusinessAccountRow[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      ORDER BY company_name COLLATE NOCASE ASC, row_key ASC
      `,
    )
    .all() as StoredAccountRow[];

  return parseStoredRows(rows);
}

export function replaceAllAccountRows(rows: BusinessAccountRow[]): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const nextRows = prepareRowsForStorage(rows);

  const replace = db.transaction((nextRows: BusinessAccountRow[]) => {
    db.prepare("DELETE FROM account_rows").run();

    const insert = db.prepare(
      `
      INSERT INTO account_rows (
        row_key,
        id,
        account_record_id,
        business_account_id,
        contact_id,
        is_primary_contact,
        company_name,
        address,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        phone_number,
        company_phone,
        company_phone_source,
        sales_rep_id,
        sales_rep_name,
        industry_type,
        sub_category,
        company_region,
        week,
        primary_contact_name,
        primary_contact_phone,
        primary_contact_email,
        primary_contact_id,
        category,
        notes,
        last_modified_iso,
        search_text,
        address_key,
        payload_json,
        updated_at
      ) VALUES (
        @row_key,
        @id,
        @account_record_id,
        @business_account_id,
        @contact_id,
        @is_primary_contact,
        @company_name,
        @address,
        @address_line1,
        @address_line2,
        @city,
        @state,
        @postal_code,
        @country,
        @phone_number,
        @company_phone,
        @company_phone_source,
        @sales_rep_id,
        @sales_rep_name,
        @industry_type,
        @sub_category,
        @company_region,
        @week,
        @primary_contact_name,
        @primary_contact_phone,
        @primary_contact_email,
        @primary_contact_id,
        @category,
        @notes,
        @last_modified_iso,
        @search_text,
        @address_key,
        @payload_json,
        @updated_at
      )
      `,
    );

    for (const row of nextRows) {
      insert.run({
        row_key: row.rowKey ?? `${row.accountRecordId ?? row.id}:contact:${row.contactId ?? "row"}`,
        id: row.id,
        account_record_id: row.accountRecordId ?? null,
        business_account_id: row.businessAccountId,
        contact_id: row.contactId ?? null,
        is_primary_contact: row.isPrimaryContact ? 1 : 0,
        company_name: row.companyName,
        address: row.address,
        address_line1: row.addressLine1,
        address_line2: row.addressLine2,
        city: row.city,
        state: row.state,
        postal_code: row.postalCode,
        country: row.country,
        phone_number: row.phoneNumber ?? null,
        company_phone: resolveCompanyPhone(row),
        company_phone_source: row.companyPhoneSource ?? null,
        sales_rep_id: row.salesRepId ?? null,
        sales_rep_name: row.salesRepName ?? null,
        industry_type: row.industryType ?? null,
        sub_category: row.subCategory ?? null,
        company_region: row.companyRegion ?? null,
        week: row.week ?? null,
        primary_contact_name: row.primaryContactName ?? null,
        primary_contact_phone: row.primaryContactPhone ?? null,
        primary_contact_email: row.primaryContactEmail ?? null,
        primary_contact_id: row.primaryContactId ?? null,
        category: row.category ?? null,
        notes: row.notes ?? null,
        last_modified_iso: row.lastModifiedIso ?? null,
        search_text: buildSearchText(row),
        address_key: buildAddressKey(row),
        payload_json: JSON.stringify(row),
        updated_at: now,
      });
    }
  });

  replace(nextRows);
  rebuildSalesRepDirectoryFromStoredRows();
  invalidateReadModelCaches();
}

export function replaceReadModelAccountRows(
  accountRecordId: string,
  rows: BusinessAccountRow[],
): void {
  const db = getReadModelDb();
  const normalizedAccountRecordId = accountRecordId.trim();
  const accountKey =
    rows[0]?.accountRecordId?.trim() ||
    rows[0]?.id.trim() ||
    normalizedAccountRecordId;
  const existingRows = (db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      WHERE account_record_id = ?
         OR id = ?
      `,
    )
    .all(accountKey, accountKey) as StoredAccountRow[])
    .map((row) => parseStoredRow(row.payload_json))
    .filter((row): row is BusinessAccountRow => row !== null);
  const nextRows = prepareRowsForStorage(rows, existingRows);
  const now = new Date().toISOString();

  const replace = db.transaction(() => {
    db.prepare(
      `
      DELETE FROM account_rows
      WHERE account_record_id = ?
         OR id = ?
      `,
    ).run(accountKey, accountKey);

    const insert = db.prepare(
      `
      INSERT INTO account_rows (
        row_key,
        id,
        account_record_id,
        business_account_id,
        contact_id,
        is_primary_contact,
        company_name,
        address,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        phone_number,
        company_phone,
        company_phone_source,
        sales_rep_id,
        sales_rep_name,
        industry_type,
        sub_category,
        company_region,
        week,
        primary_contact_name,
        primary_contact_phone,
        primary_contact_email,
        primary_contact_id,
        category,
        notes,
        last_modified_iso,
        search_text,
        address_key,
        payload_json,
        updated_at
      ) VALUES (
        @row_key,
        @id,
        @account_record_id,
        @business_account_id,
        @contact_id,
        @is_primary_contact,
        @company_name,
        @address,
        @address_line1,
        @address_line2,
        @city,
        @state,
        @postal_code,
        @country,
        @phone_number,
        @company_phone,
        @company_phone_source,
        @sales_rep_id,
        @sales_rep_name,
        @industry_type,
        @sub_category,
        @company_region,
        @week,
        @primary_contact_name,
        @primary_contact_phone,
        @primary_contact_email,
        @primary_contact_id,
        @category,
        @notes,
        @last_modified_iso,
        @search_text,
        @address_key,
        @payload_json,
        @updated_at
      )
      `,
    );

    for (const row of nextRows) {
      insert.run({
        row_key: row.rowKey ?? `${row.accountRecordId ?? row.id}:contact:${row.contactId ?? "row"}`,
        id: row.id,
        account_record_id: row.accountRecordId ?? null,
        business_account_id: row.businessAccountId,
        contact_id: row.contactId ?? null,
        is_primary_contact: row.isPrimaryContact ? 1 : 0,
        company_name: row.companyName,
        address: row.address,
        address_line1: row.addressLine1,
        address_line2: row.addressLine2,
        city: row.city,
        state: row.state,
        postal_code: row.postalCode,
        country: row.country,
        phone_number: row.phoneNumber ?? null,
        company_phone: resolveCompanyPhone(row),
        company_phone_source: row.companyPhoneSource ?? null,
        sales_rep_id: row.salesRepId ?? null,
        sales_rep_name: row.salesRepName ?? null,
        industry_type: row.industryType ?? null,
        sub_category: row.subCategory ?? null,
        company_region: row.companyRegion ?? null,
        week: row.week ?? null,
        primary_contact_name: row.primaryContactName ?? null,
        primary_contact_phone: row.primaryContactPhone ?? null,
        primary_contact_email: row.primaryContactEmail ?? null,
        primary_contact_id: row.primaryContactId ?? null,
        category: row.category ?? null,
        notes: row.notes ?? null,
        last_modified_iso: row.lastModifiedIso ?? null,
        search_text: buildSearchText(row),
        address_key: buildAddressKey(row),
        payload_json: JSON.stringify(row),
        updated_at: now,
      });
    }
  });

  replace();
  rebuildSalesRepDirectoryFromStoredRows();
  invalidateReadModelCaches();
}

function readRecentlyTouchedAccountRowsFromReadModel(): BusinessAccountRow[] {
  const db = getReadModelDb();
  const recentSessions = db
    .prepare(
      `
      SELECT
        linked_account_row_key,
        linked_contact_id,
        matched_contact_id,
        linked_business_account_id,
        matched_business_account_id,
        target_phone,
        counterparty_phone
      FROM call_sessions
      ORDER BY COALESCE(started_at, updated_at) DESC, session_id DESC
      LIMIT ?
      `,
    )
    .all(RECENT_CALL_SESSION_REFRESH_LIMIT) as RecentCallSessionIdentityRow[];

  if (recentSessions.length === 0) {
    return [];
  }

  const rowKeys = uniqueStrings(
    recentSessions.map((session) => session.linked_account_row_key),
  );
  const contactIds = uniqueNumbers(
    recentSessions.flatMap((session) => [
      session.linked_contact_id,
      session.matched_contact_id,
    ]),
  );
  const businessAccountIds = uniqueBusinessAccountIds(
    recentSessions.flatMap((session) => [
      session.linked_business_account_id,
      session.matched_business_account_id,
    ]),
  );
  const phoneValues = buildPhoneQueryValues(
    recentSessions.flatMap((session) => [
      session.target_phone,
      session.counterparty_phone,
    ]),
  );

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  appendInClause(clauses, params, "row_key", rowKeys);
  appendInClause(clauses, params, "contact_id", contactIds);
  appendInClause(clauses, params, "primary_contact_id", contactIds);
  appendInClause(clauses, params, "business_account_id", businessAccountIds);
  appendInClause(clauses, params, "phone_number", phoneValues);
  appendInClause(clauses, params, "company_phone", phoneValues);
  appendInClause(clauses, params, "primary_contact_phone", phoneValues);

  if (clauses.length === 0) {
    return [];
  }

  const rows = db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      WHERE ${clauses.map((clause) => `(${clause})`).join(" OR ")}
      ORDER BY company_name COLLATE NOCASE ASC, row_key ASC
      `,
    )
    .all(...params) as StoredAccountRow[];

  return parseRawStoredRows(rows);
}

export function refreshStoredReadModelAccountSupplementalFields(): void {
  const currentRows = readRecentlyTouchedAccountRowsFromReadModel();

  if (currentRows.length === 0) {
    return;
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  const update = db.prepare(
    `
    UPDATE account_rows
    SET search_text = @search_text,
        payload_json = @payload_json,
        updated_at = @updated_at
    WHERE row_key = @row_key
    `,
  );
  let changedCount = 0;

  const refresh = db.transaction(() => {
    for (const row of currentRows) {
      const nextLastCalledAt = resolveLastCalledAtForBusinessAccountRow(row);
      if ((row.lastCalledAt ?? null) === nextLastCalledAt) {
        continue;
      }

      const nextRow = normalizeStoredSupplementalFields({
        ...row,
        lastCalledAt: nextLastCalledAt,
      });
      update.run({
        row_key: nextRow.rowKey ?? `${nextRow.accountRecordId ?? nextRow.id}:contact:${nextRow.contactId ?? "row"}`,
        search_text: buildSearchText(nextRow),
        payload_json: JSON.stringify(nextRow),
        updated_at: now,
      });
      changedCount += 1;
    }
  });

  refresh();

  if (changedCount > 0) {
    invalidateReadModelCaches();
  }
}

export function readBusinessAccountRowsFromReadModel(
  accountRecordId: string,
): BusinessAccountRow[] {
  const normalized = accountRecordId.trim();
  if (!normalized) {
    return [];
  }

  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      WHERE account_record_id = ?
         OR id = ?
      ORDER BY updated_at DESC, row_key ASC
      `,
    )
    .all(normalized, normalized) as StoredAccountRow[];

  return applyReadModelRowDecorations(parseStoredRows(rows));
}

export function readStoredBusinessAccountRowsFromReadModel(
  accountRecordId: string,
): BusinessAccountRow[] {
  const normalized = accountRecordId.trim();
  if (!normalized) {
    return [];
  }

  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      WHERE account_record_id = ?
         OR id = ?
      ORDER BY updated_at DESC, row_key ASC
      `,
    )
    .all(normalized, normalized) as StoredAccountRow[];

  return parseStoredRows(rows);
}

export function readBusinessAccountDetailFromReadModel(
  accountRecordId: string,
  contactId?: number | null,
): BusinessAccountDetailResponse | null {
  const rows = readBusinessAccountRowsFromReadModel(accountRecordId);
  if (rows.length === 0) {
    return null;
  }

  const requestedRow =
    contactId !== null && contactId !== undefined
      ? rows.find((row) => row.contactId === contactId)
      : null;

  return {
    row: requestedRow ?? rows.find((row) => row.isPrimaryContact) ?? rows[0],
    rows,
  };
}

export function removeReadModelRowsByContactId(contactId: number): void {
  const db = getReadModelDb();
  db.prepare(
    `
    DELETE FROM account_rows
    WHERE contact_id = ?
    `,
  ).run(contactId);
  rebuildSalesRepDirectoryFromStoredRows();
  invalidateReadModelCaches();
}

export function removeReadModelRowsByAccount(
  accountRecordId: string,
  businessAccountId?: string | null,
): void {
  const normalizedAccountRecordId = accountRecordId.trim();
  const normalizedBusinessAccountId = businessAccountId?.trim() ?? "";
  const db = getReadModelDb();

  if (normalizedBusinessAccountId) {
    db.prepare(
      `
      DELETE FROM account_rows
      WHERE account_record_id = ?
         OR id = ?
         OR business_account_id = ?
      `,
    ).run(normalizedAccountRecordId, normalizedAccountRecordId, normalizedBusinessAccountId);
  } else {
    db.prepare(
      `
      DELETE FROM account_rows
      WHERE account_record_id = ?
         OR id = ?
      `,
    ).run(normalizedAccountRecordId, normalizedAccountRecordId);
  }

  rebuildSalesRepDirectoryFromStoredRows();
  invalidateReadModelCaches();
}

export function queryReadModelBusinessAccounts(
  params: ReadModelListQuery,
): BusinessAccountsResponse {
  const rows = readAllAccountRowsFromReadModel();
  return queryBusinessAccounts(rows, params);
}
