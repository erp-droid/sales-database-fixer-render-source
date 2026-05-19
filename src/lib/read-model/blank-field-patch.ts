import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { getReadModelDb } from "@/lib/read-model/db";
import { replaceReadModelAccountRows } from "@/lib/read-model/accounts";
import { rebuildSalesRepDirectoryFromStoredRows } from "@/lib/read-model/sales-reps";
import type { BusinessAccountRow } from "@/types/business-account";

type PatchField = "industryType" | "subCategory" | "companyDescription";

export type ReadModelBlankFieldPatchPlan = {
  missingAccounts?: MissingAccountOperation[];
  enrichExistingAccounts?: EnrichmentOperation[];
};

export type EnrichmentOperation = {
  accountRecordId: string;
  businessAccountId?: string | null;
  companyName?: string | null;
  fields: Partial<Record<PatchField, string | null>>;
};

export type MissingAccountOperation = {
  accountRecordId: string;
  businessAccountId?: string | null;
  companyName?: string | null;
  companyDescription?: string | null;
  category?: string | null;
  marketingEligible?: boolean | null;
  rowsToWrite: BusinessAccountRow[];
};

type StoredPatchRow = {
  row_key: string;
  id: string;
  account_record_id: string | null;
  business_account_id: string;
  industry_type: string | null;
  sub_category: string | null;
  payload_json: string;
};

type MetadataRow = {
  account_record_id: string;
  business_account_id: string | null;
  company_description: string | null;
  category: string | null;
  marketing_eligible: number | null;
};

type MatchedRows = {
  accountRecordId: string;
  businessAccountId: string | null;
  rows: StoredPatchRow[];
  parsedRows: BusinessAccountRow[];
};

export type ReadModelBlankFieldPatchResult = {
  dryRun: boolean;
  requestedMissingAccounts: number;
  insertedMissingAccounts: number;
  skippedMissingAccounts: Array<{
    accountRecordId: string;
    businessAccountId: string | null;
    companyName: string | null;
    reason: string;
  }>;
  requestedExistingAccounts: number;
  updatedExistingAccounts: number;
  filledFields: number;
  skippedFields: Array<{
    accountRecordId: string;
    businessAccountId: string | null;
    companyName: string | null;
    field: PatchField;
    reason: string;
    currentValue?: string;
    proposedValue?: string;
  }>;
};

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCategory(value: unknown): string | null {
  const category = cleanText(value)?.toUpperCase() ?? null;
  return category && /^[A-D]$/.test(category) ? category : null;
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseBusinessAccountRow(payloadJson: string): BusinessAccountRow | null {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as BusinessAccountRow) : null;
  } catch {
    return null;
  }
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanText(value)).filter((value): value is string => value !== null))];
}

function findMatchedRows(
  accountRecordId: string,
  businessAccountId: string | null | undefined,
): MatchedRows | null {
  const accountKeys = uniqueValues([accountRecordId]);
  const businessAccountIds = uniqueValues([businessAccountId]);
  if (accountKeys.length === 0 && businessAccountIds.length === 0) {
    return null;
  }

  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (accountKeys[0]) {
    clauses.push("(account_record_id = @accountRecordId OR id = @accountRecordId)");
    params.accountRecordId = accountKeys[0];
  }
  if (businessAccountIds[0]) {
    clauses.push("business_account_id = @businessAccountId");
    params.businessAccountId = businessAccountIds[0];
  }

  const rows = getReadModelDb()
    .prepare(
      `
      SELECT
        row_key,
        id,
        account_record_id,
        business_account_id,
        industry_type,
        sub_category,
        payload_json
      FROM account_rows
      WHERE ${clauses.join(" OR ")}
      ORDER BY row_key ASC
      `,
    )
    .all(params) as StoredPatchRow[];

  if (rows.length === 0) {
    return null;
  }

  const parsedRows = rows
    .map((row) => parseBusinessAccountRow(row.payload_json))
    .filter((row): row is BusinessAccountRow => row !== null);
  if (parsedRows.length === 0) {
    return null;
  }

  const first = rows[0];
  return {
    accountRecordId:
      cleanText(first?.account_record_id) ??
      cleanText(first?.id) ??
      cleanText(accountRecordId) ??
      parsedRows[0]?.accountRecordId ??
      parsedRows[0]?.id,
    businessAccountId:
      cleanText(first?.business_account_id) ??
      cleanText(businessAccountId) ??
      cleanText(parsedRows[0]?.businessAccountId),
    rows,
    parsedRows,
  };
}

function readCurrentFieldValue(
  matched: MatchedRows,
  field: Exclude<PatchField, "companyDescription">,
): string | null {
  const column = field === "industryType" ? "industry_type" : "sub_category";
  for (const row of matched.rows) {
    const payload = parsePayload(row.payload_json);
    const current = cleanText(row[column]) ?? cleanText(payload[field]);
    if (current) {
      return current;
    }
  }

  return null;
}

function metadataRowsForMatchedAccount(matched: MatchedRows): MetadataRow[] {
  const accountRecordIds = uniqueValues([
    matched.accountRecordId,
    ...matched.rows.map((row) => row.account_record_id),
    ...matched.rows.map((row) => row.id),
  ]);
  const businessAccountIds = uniqueValues([
    matched.businessAccountId,
    ...matched.rows.map((row) => row.business_account_id),
  ]);

  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (accountRecordIds.length > 0) {
    clauses.push(
      `account_record_id IN (${accountRecordIds.map((_, index) => `@accountRecordId${index}`).join(", ")})`,
    );
    accountRecordIds.forEach((value, index) => {
      params[`accountRecordId${index}`] = value;
    });
  }
  if (businessAccountIds.length > 0) {
    clauses.push(
      `business_account_id IN (${businessAccountIds.map((_, index) => `@businessAccountId${index}`).join(", ")})`,
    );
    businessAccountIds.forEach((value, index) => {
      params[`businessAccountId${index}`] = value;
    });
  }
  if (clauses.length === 0) {
    return [];
  }

  return getReadModelDb()
    .prepare(
      `
      SELECT
        account_record_id,
        business_account_id,
        company_description,
        category,
        marketing_eligible
      FROM account_local_metadata
      WHERE ${clauses.join(" OR ")}
      ORDER BY account_record_id ASC
      `,
    )
    .all(params) as MetadataRow[];
}

function readCurrentCompanyDescription(matched: MatchedRows): string | null {
  for (const row of metadataRowsForMatchedAccount(matched)) {
    const description = cleanText(row.company_description);
    if (description) {
      return description;
    }
  }

  for (const row of matched.parsedRows) {
    const description = cleanText(row.companyDescription);
    if (description) {
      return description;
    }
  }

  return null;
}

function updateMetadataDescriptionIfBlank(
  matched: MatchedRows,
  description: string,
  dryRun: boolean,
): boolean {
  const existing = metadataRowsForMatchedAccount(matched)[0] ?? null;
  const currentDescription = cleanText(existing?.company_description);
  if (currentDescription) {
    return false;
  }
  if (dryRun) {
    return true;
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `
      UPDATE account_local_metadata
      SET company_description = ?,
          business_account_id = COALESCE(business_account_id, ?),
          updated_at = ?
      WHERE account_record_id = ?
      `,
    ).run(description, matched.businessAccountId, now, existing.account_record_id);
    return true;
  }

  db.prepare(
    `
    INSERT INTO account_local_metadata (
      account_record_id,
      business_account_id,
      company_description,
      category,
      marketing_eligible,
      updated_at
    ) VALUES (?, ?, ?, NULL, 1, ?)
    `,
  ).run(matched.accountRecordId, matched.businessAccountId, description, now);
  return true;
}

function applyRowFieldUpdates(
  matched: MatchedRows,
  fields: Partial<Record<Exclude<PatchField, "companyDescription">, string>>,
  dryRun: boolean,
): boolean {
  if (Object.keys(fields).length === 0) {
    return false;
  }
  if (dryRun) {
    return true;
  }

  const nextRows = matched.parsedRows.map((row) => ({
    ...row,
    industryType: fields.industryType ?? row.industryType ?? null,
    subCategory: fields.subCategory ?? row.subCategory ?? null,
  }));
  replaceReadModelAccountRows(matched.accountRecordId, nextRows);
  return true;
}

function hasExistingAccount(accountRecordId: string, businessAccountId: string | null | undefined): boolean {
  return findMatchedRows(accountRecordId, businessAccountId) !== null;
}

function insertMissingAccount(operation: MissingAccountOperation, dryRun: boolean): boolean {
  if (dryRun) {
    return true;
  }

  replaceReadModelAccountRows(operation.accountRecordId, operation.rowsToWrite);

  const description = cleanText(operation.companyDescription);
  const category = normalizeCategory(operation.category);
  const marketingEligible = operation.marketingEligible !== false;
  if (description || category || !marketingEligible) {
    const now = new Date().toISOString();
    getReadModelDb()
      .prepare(
        `
        INSERT INTO account_local_metadata (
          account_record_id,
          business_account_id,
          company_description,
          category,
          marketing_eligible,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_record_id) DO UPDATE SET
          business_account_id = COALESCE(account_local_metadata.business_account_id, excluded.business_account_id),
          company_description = CASE
            WHEN TRIM(COALESCE(account_local_metadata.company_description, '')) = ''
            THEN excluded.company_description
            ELSE account_local_metadata.company_description
          END,
          category = COALESCE(account_local_metadata.category, excluded.category),
          marketing_eligible = account_local_metadata.marketing_eligible,
          updated_at = excluded.updated_at
        `,
      )
      .run(
        operation.accountRecordId,
        cleanText(operation.businessAccountId),
        description,
        category,
        marketingEligible ? 1 : 0,
        now,
      );
  }

  return true;
}

export function applyReadModelBlankFieldPatch(
  plan: ReadModelBlankFieldPatchPlan,
  options?: { dryRun?: boolean },
): ReadModelBlankFieldPatchResult {
  const dryRun = options?.dryRun === true;
  const result: ReadModelBlankFieldPatchResult = {
    dryRun,
    requestedMissingAccounts: plan.missingAccounts?.length ?? 0,
    insertedMissingAccounts: 0,
    skippedMissingAccounts: [],
    requestedExistingAccounts: plan.enrichExistingAccounts?.length ?? 0,
    updatedExistingAccounts: 0,
    filledFields: 0,
    skippedFields: [],
  };

  for (const operation of plan.missingAccounts ?? []) {
    const accountRecordId = cleanText(operation.accountRecordId);
    if (!accountRecordId) {
      result.skippedMissingAccounts.push({
        accountRecordId: operation.accountRecordId,
        businessAccountId: cleanText(operation.businessAccountId),
        companyName: cleanText(operation.companyName),
        reason: "missing-account-record-id",
      });
      continue;
    }
    if (operation.rowsToWrite.length === 0) {
      result.skippedMissingAccounts.push({
        accountRecordId,
        businessAccountId: cleanText(operation.businessAccountId),
        companyName: cleanText(operation.companyName),
        reason: "no-rows-to-write",
      });
      continue;
    }
    if (hasExistingAccount(accountRecordId, operation.businessAccountId)) {
      result.skippedMissingAccounts.push({
        accountRecordId,
        businessAccountId: cleanText(operation.businessAccountId),
        companyName: cleanText(operation.companyName),
        reason: "already-exists-in-production",
      });
      continue;
    }

    insertMissingAccount(operation, dryRun);
    result.insertedMissingAccounts += 1;
  }

  for (const operation of plan.enrichExistingAccounts ?? []) {
    const matched = findMatchedRows(operation.accountRecordId, operation.businessAccountId);
    if (!matched) {
      for (const field of Object.keys(operation.fields) as PatchField[]) {
        result.skippedFields.push({
          accountRecordId: operation.accountRecordId,
          businessAccountId: cleanText(operation.businessAccountId),
          companyName: cleanText(operation.companyName),
          field,
          reason: "account-not-found",
          proposedValue: cleanText(operation.fields[field]) ?? undefined,
        });
      }
      continue;
    }

    const rowFieldUpdates: Partial<Record<Exclude<PatchField, "companyDescription">, string>> = {};
    let accountFilledFields = 0;

    for (const field of ["industryType", "subCategory"] as const) {
      const proposedValue = cleanText(operation.fields[field]);
      if (!proposedValue) {
        continue;
      }

      const currentValue = readCurrentFieldValue(matched, field);
      if (currentValue) {
        result.skippedFields.push({
          accountRecordId: matched.accountRecordId,
          businessAccountId: matched.businessAccountId,
          companyName: cleanText(operation.companyName),
          field,
          reason: "production-already-has-value",
          currentValue,
          proposedValue,
        });
        continue;
      }

      rowFieldUpdates[field] = proposedValue;
      accountFilledFields += 1;
    }

    const proposedDescription = cleanText(operation.fields.companyDescription);
    if (proposedDescription) {
      const currentValue = readCurrentCompanyDescription(matched);
      if (currentValue) {
        result.skippedFields.push({
          accountRecordId: matched.accountRecordId,
          businessAccountId: matched.businessAccountId,
          companyName: cleanText(operation.companyName),
          field: "companyDescription",
          reason: "production-already-has-value",
          currentValue,
          proposedValue: proposedDescription,
        });
      } else if (updateMetadataDescriptionIfBlank(matched, proposedDescription, dryRun)) {
        accountFilledFields += 1;
      }
    }

    if (applyRowFieldUpdates(matched, rowFieldUpdates, dryRun) || accountFilledFields > 0) {
      result.updatedExistingAccounts += 1;
      result.filledFields += accountFilledFields;
    }
  }

  if (!dryRun && (result.filledFields > 0 || result.insertedMissingAccounts > 0)) {
    rebuildSalesRepDirectoryFromStoredRows();
    invalidateReadModelCaches();
  }

  return result;
}
