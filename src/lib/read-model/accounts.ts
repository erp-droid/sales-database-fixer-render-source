import {
  queryBusinessAccounts,
  resolveCompanyPhone,
} from "@/lib/business-accounts";
import { applyLastCalledAtToBusinessAccountRows } from "@/lib/business-account-call-history";
import { applyDeferredActionsToRows } from "@/lib/deferred-actions-store";
import { invalidateReadModelCaches, registerReadModelCacheClearer } from "@/lib/read-model/cache";
import { applyLocalAccountMetadataToRows } from "@/lib/read-model/account-local-metadata";
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

type ReadModelListQuery = Parameters<typeof queryBusinessAccounts>[1];

let allRowsCache: BusinessAccountRow[] | null = null;
let allRowsCacheVersion: string | null = null;

registerReadModelCacheClearer(() => {
  allRowsCache = null;
  allRowsCacheVersion = null;
});

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
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

function inheritSupplementalAccountMetadata(
  nextRows: BusinessAccountRow[],
  existingRows: BusinessAccountRow[],
): BusinessAccountRow[] {
  const existingAccountType =
    existingRows.find((row) => typeof row.accountType === "string")?.accountType;
  const existingOpportunityCount = existingRows.find(
    (row) => row.opportunityCount !== undefined,
  )?.opportunityCount;

  if (existingAccountType === undefined && existingOpportunityCount === undefined) {
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
  return applyLastCalledAtToBusinessAccountRows(
    inheritSupplementalAccountMetadata(nextRows, existingRows),
  ).map(normalizeStoredSupplementalFields);
}

function parseStoredRow(payload: string): BusinessAccountRow | null {
  try {
    return JSON.parse(payload) as BusinessAccountRow;
  } catch {
    return null;
  }
}

function readAccountRowsVersion(): string {
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

  return [
    Number(accountRow?.row_count ?? 0),
    accountRow?.latest_updated_at ?? "",
    Number(callSessionRow?.row_count ?? 0),
    callSessionRow?.latest_updated_at ?? "",
  ].join("|");
}

export function readAllAccountRowsFromReadModel(): BusinessAccountRow[] {
  const nextVersion = readAccountRowsVersion();
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

  allRowsCache = rows
    .map((row) => parseStoredRow(row.payload_json))
    .filter((row): row is BusinessAccountRow => row !== null);
  allRowsCache = applyDeferredActionsToRows(allRowsCache);
  allRowsCache = applyLocalAccountMetadataToRows(allRowsCache);
  allRowsCache = applyLastCalledAtToBusinessAccountRows(allRowsCache);
  allRowsCacheVersion = nextVersion;

  return allRowsCache;
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

export function refreshStoredReadModelAccountSupplementalFields(): void {
  const db = getReadModelDb();
  const currentRows = (db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      ORDER BY company_name COLLATE NOCASE ASC, row_key ASC
      `,
    )
    .all() as StoredAccountRow[])
    .map((row) => parseStoredRow(row.payload_json))
    .filter((row): row is BusinessAccountRow => row !== null);

  if (currentRows.length === 0) {
    return;
  }

  replaceAllAccountRows(currentRows);
}

export function readBusinessAccountRowsFromReadModel(
  accountRecordId: string,
): BusinessAccountRow[] {
  const normalized = accountRecordId.trim();
  return readAllAccountRowsFromReadModel().filter((row) => {
    const rowAccountKey = row.accountRecordId?.trim() || row.id.trim();
    return rowAccountKey === normalized;
  });
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

export function queryReadModelBusinessAccounts(
  params: ReadModelListQuery,
): BusinessAccountsResponse {
  const rows = readAllAccountRowsFromReadModel();
  return queryBusinessAccounts(rows, params);
}
