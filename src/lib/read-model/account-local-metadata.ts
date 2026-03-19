import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { getReadModelDb } from "@/lib/read-model/db";
import type { BusinessAccountRow } from "@/types/business-account";

type StoredAccountLocalMetadataRow = {
  account_record_id: string;
  company_description: string | null;
};

type AccountLocalMetadataInput = {
  accountRecordId: string | null | undefined;
  businessAccountId?: string | null | undefined;
  companyDescription: string | null | undefined;
};

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAccountRecordId(row: BusinessAccountRow): string | null {
  return normalizeText(row.accountRecordId ?? row.id);
}

function buildDescriptionMap(accountRecordIds: string[]): Map<string, string | null> {
  if (accountRecordIds.length === 0) {
    return new Map();
  }

  const db = getReadModelDb();
  const placeholders = accountRecordIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT account_record_id, company_description
      FROM account_local_metadata
      WHERE account_record_id IN (${placeholders})
      `,
    )
    .all(...accountRecordIds) as StoredAccountLocalMetadataRow[];

  return new Map(
    rows.map((row) => [
      row.account_record_id,
      normalizeText(row.company_description),
    ]),
  );
}

export function saveAccountCompanyDescription(input: AccountLocalMetadataInput): void {
  const accountRecordId = normalizeText(input.accountRecordId);
  const businessAccountId = normalizeText(input.businessAccountId);
  const companyDescription = normalizeText(input.companyDescription);
  if (!accountRecordId) {
    return;
  }

  const db = getReadModelDb();
  if (!companyDescription) {
    db.prepare(
      `
      DELETE FROM account_local_metadata
      WHERE account_record_id = ?
      `,
    ).run(accountRecordId);
    invalidateReadModelCaches();
    return;
  }

  db.prepare(
    `
    INSERT INTO account_local_metadata (
      account_record_id,
      business_account_id,
      company_description,
      updated_at
    ) VALUES (
      @account_record_id,
      @business_account_id,
      @company_description,
      @updated_at
    )
    ON CONFLICT(account_record_id) DO UPDATE SET
      business_account_id = excluded.business_account_id,
      company_description = excluded.company_description,
      updated_at = excluded.updated_at
    `,
  ).run({
    account_record_id: accountRecordId,
    business_account_id: businessAccountId,
    company_description: companyDescription,
    updated_at: new Date().toISOString(),
  });
  invalidateReadModelCaches();
}

export function applyLocalAccountMetadataToRows(
  rows: BusinessAccountRow[],
): BusinessAccountRow[] {
  const accountRecordIds = [
    ...new Set(rows.map(resolveAccountRecordId).filter((value): value is string => value !== null)),
  ];
  if (accountRecordIds.length === 0) {
    return rows;
  }

  const descriptionByAccountRecordId = buildDescriptionMap(accountRecordIds);
  let changed = false;
  const nextRows = rows.map((row) => {
    const accountRecordId = resolveAccountRecordId(row);
    const companyDescription =
      accountRecordId !== null
        ? (descriptionByAccountRecordId.get(accountRecordId) ?? null)
        : null;
    const currentDescription = normalizeText(row.companyDescription);
    if (currentDescription === companyDescription) {
      return row;
    }

    changed = true;
    return {
      ...row,
      companyDescription,
    };
  });

  return changed ? nextRows : rows;
}

export function applyLocalAccountMetadataToRow(
  row: BusinessAccountRow | null,
): BusinessAccountRow | null {
  if (!row) {
    return row;
  }

  const [nextRow] = applyLocalAccountMetadataToRows([row]);
  return nextRow ?? row;
}
