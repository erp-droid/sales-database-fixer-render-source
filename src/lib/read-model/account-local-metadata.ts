import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { getReadModelDb } from "@/lib/read-model/db";
import type { BusinessAccountRow } from "@/types/business-account";

type StoredAccountLocalMetadataRow = {
  account_record_id: string;
  company_description: string | null;
  marketing_eligible: number | null;
};

type AccountLocalMetadataInput = {
  accountRecordId: string | null | undefined;
  businessAccountId?: string | null | undefined;
  companyDescription?: string | null | undefined;
  marketingEligible?: boolean | null | undefined;
};

type StoredAccountLocalMetadata = {
  companyDescription: string | null;
  marketingEligible: boolean;
};

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAccountRecordId(row: BusinessAccountRow): string | null {
  return normalizeText(row.accountRecordId ?? row.id);
}

function normalizeMarketingEligible(value: boolean | null | undefined): boolean {
  return value !== false;
}

function normalizeStoredMarketingEligible(value: number | null | undefined): boolean {
  return value !== 0;
}

function buildMetadataMap(accountRecordIds: string[]): Map<string, StoredAccountLocalMetadata> {
  if (accountRecordIds.length === 0) {
    return new Map();
  }

  const db = getReadModelDb();
  const placeholders = accountRecordIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT account_record_id, company_description, marketing_eligible
      FROM account_local_metadata
      WHERE account_record_id IN (${placeholders})
      `,
    )
    .all(...accountRecordIds) as StoredAccountLocalMetadataRow[];

  return new Map(
    rows.map((row) => [
      row.account_record_id,
      {
        companyDescription: normalizeText(row.company_description),
        marketingEligible: normalizeStoredMarketingEligible(row.marketing_eligible),
      },
    ]),
  );
}

export function saveAccountCompanyDescription(input: AccountLocalMetadataInput): void {
  const accountRecordId = normalizeText(input.accountRecordId);
  const businessAccountId = normalizeText(input.businessAccountId);
  const companyDescription = normalizeText(input.companyDescription);
  const marketingEligible = normalizeMarketingEligible(input.marketingEligible);
  if (!accountRecordId) {
    return;
  }

  const db = getReadModelDb();
  if (!companyDescription && marketingEligible) {
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
      marketing_eligible,
      updated_at
    ) VALUES (
      @account_record_id,
      @business_account_id,
      @company_description,
      @marketing_eligible,
      @updated_at
    )
    ON CONFLICT(account_record_id) DO UPDATE SET
      business_account_id = excluded.business_account_id,
      company_description = excluded.company_description,
      marketing_eligible = excluded.marketing_eligible,
      updated_at = excluded.updated_at
    `,
  ).run({
    account_record_id: accountRecordId,
    business_account_id: businessAccountId,
    company_description: companyDescription,
    marketing_eligible: marketingEligible ? 1 : 0,
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

  const metadataByAccountRecordId = buildMetadataMap(accountRecordIds);
  let changed = false;
  const nextRows = rows.map((row) => {
    const accountRecordId = resolveAccountRecordId(row);
    const metadata =
      accountRecordId !== null ? metadataByAccountRecordId.get(accountRecordId) : undefined;
    const companyDescription = metadata?.companyDescription ?? null;
    const marketingEligible = metadata?.marketingEligible ?? true;
    const currentDescription = normalizeText(row.companyDescription);
    const currentMarketingEligible = normalizeMarketingEligible(row.marketingEligible);
    const hasExplicitDescription = row.companyDescription !== undefined;
    const hasExplicitMarketingEligible = typeof row.marketingEligible === "boolean";
    if (
      currentDescription === companyDescription &&
      currentMarketingEligible === marketingEligible &&
      hasExplicitDescription &&
      hasExplicitMarketingEligible
    ) {
      return row;
    }

    changed = true;
    return {
      ...row,
      companyDescription,
      marketingEligible,
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
