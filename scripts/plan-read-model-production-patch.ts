import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  queryReadModelBusinessAccounts,
  readStoredAccountRowsFromReadModel,
} from "@/lib/read-model/accounts";
import type { BusinessAccountRow } from "@/types/business-account";

type SnapshotTableRow = Record<string, unknown>;

type Snapshot = {
  createdAt?: string;
  sourceLabel?: string | null;
  tables?: Record<string, SnapshotTableRow[]>;
};

type AccountAggregate = {
  accountRecordId: string;
  businessAccountId: string | null;
  companyName: string;
  accountType: string | null;
  category: string | null;
  marketingEligible: boolean | null;
  industryType: string | null;
  subCategory: string | null;
  companyDescription: string | null;
  rowCount: number;
  rows: BusinessAccountRow[];
};

type ProductionAccountAggregate = Omit<AccountAggregate, "rows"> & {
  rowKeys: string[];
};

type EnrichmentOperation = {
  accountRecordId: string;
  businessAccountId: string | null;
  companyName: string;
  fields: {
    industryType?: string;
    subCategory?: string;
    companyDescription?: string;
  };
};

type MissingAccountOperation = {
  accountRecordId: string;
  businessAccountId: string | null;
  companyName: string;
  companyDescription: string | null;
  category: string | null;
  marketingEligible: boolean | null;
  rowsToWrite: BusinessAccountRow[];
};

type SkippedExistingValue = {
  accountRecordId: string;
  businessAccountId: string | null;
  companyName: string;
  field: "industryType" | "subCategory" | "companyDescription";
  productionValue: string;
  previewValue: string;
};

type ResidualMissingField = {
  accountRecordId: string;
  businessAccountId: string | null;
  companyName: string;
  field: "industryType" | "subCategory" | "companyDescription";
};

function readArgument(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstText(values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanText(value);
    if (text) {
      return text;
    }
  }

  return null;
}

function parsePayload(row: SnapshotTableRow): Record<string, unknown> {
  const payloadJson = cleanText(row.payload_json);
  if (!payloadJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function accountKeyFromParts(input: {
  accountRecordId?: unknown;
  id?: unknown;
  businessAccountId?: unknown;
}): string | null {
  return firstText([input.accountRecordId, input.id, input.businessAccountId]);
}

function rowAccountKey(row: BusinessAccountRow): string | null {
  return accountKeyFromParts({
    accountRecordId: row.accountRecordId,
    id: row.id,
    businessAccountId: row.businessAccountId,
  });
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return null;
}

function mergeLocalAggregate(existing: AccountAggregate, row: BusinessAccountRow): AccountAggregate {
  return {
    ...existing,
    businessAccountId: existing.businessAccountId ?? cleanText(row.businessAccountId),
    companyName: existing.companyName || row.companyName,
    accountType: existing.accountType ?? row.accountType ?? null,
    category: existing.category ?? row.category ?? null,
    marketingEligible: existing.marketingEligible ?? normalizeBoolean(row.marketingEligible),
    industryType: existing.industryType ?? cleanText(row.industryType),
    subCategory: existing.subCategory ?? cleanText(row.subCategory),
    companyDescription: existing.companyDescription ?? cleanText(row.companyDescription),
    rowCount: existing.rowCount + 1,
  };
}

function buildLocalAccountMap(): Map<string, AccountAggregate> {
  const firstPage = queryReadModelBusinessAccounts({
    q: "",
    sortBy: "companyName",
    sortDir: "asc",
    page: 1,
    pageSize: 1,
    includeInternalRows: true,
  });
  const visibleRows = queryReadModelBusinessAccounts({
    q: "",
    sortBy: "companyName",
    sortDir: "asc",
    page: 1,
    pageSize: Math.max(firstPage.total, 1),
    includeInternalRows: true,
  }).items;

  const storedRowsByAccountKey = new Map<string, BusinessAccountRow[]>();
  for (const row of readStoredAccountRowsFromReadModel()) {
    const key = rowAccountKey(row);
    if (!key) {
      continue;
    }

    const rows = storedRowsByAccountKey.get(key);
    if (rows) {
      rows.push(row);
    } else {
      storedRowsByAccountKey.set(key, [row]);
    }
  }

  const accounts = new Map<string, AccountAggregate>();
  for (const row of visibleRows) {
    const key = rowAccountKey(row);
    if (!key) {
      continue;
    }

    const existing = accounts.get(key);
    if (existing) {
      accounts.set(key, mergeLocalAggregate(existing, row));
      continue;
    }

    accounts.set(key, {
      accountRecordId: key,
      businessAccountId: cleanText(row.businessAccountId),
      companyName: row.companyName,
      accountType: row.accountType ?? null,
      category: row.category ?? null,
      marketingEligible: normalizeBoolean(row.marketingEligible),
      industryType: cleanText(row.industryType),
      subCategory: cleanText(row.subCategory),
      companyDescription: cleanText(row.companyDescription),
      rowCount: 1,
      rows: storedRowsByAccountKey.get(key) ?? [row],
    });
  }

  return accounts;
}

function buildProductionAccountMap(snapshot: Snapshot): {
  accountsByKey: Map<string, ProductionAccountAggregate>;
  keysByBusinessAccountId: Map<string, string>;
} {
  const accountRows = snapshot.tables?.account_rows ?? [];
  const metadataRows = snapshot.tables?.account_local_metadata ?? [];
  const descriptionByAccountRecordId = new Map<string, string>();
  for (const row of metadataRows) {
    const key = cleanText(row.account_record_id);
    const description = cleanText(row.company_description);
    if (key && description) {
      descriptionByAccountRecordId.set(key, description);
    }
  }

  const accountsByKey = new Map<string, ProductionAccountAggregate>();
  const keysByBusinessAccountId = new Map<string, string>();

  for (const row of accountRows) {
    const payload = parsePayload(row);
    const key = accountKeyFromParts({
      accountRecordId: firstText([row.account_record_id, payload.accountRecordId]),
      id: firstText([row.id, payload.id]),
      businessAccountId: firstText([row.business_account_id, payload.businessAccountId]),
    });
    if (!key) {
      continue;
    }

    const businessAccountId = firstText([row.business_account_id, payload.businessAccountId]);
    const companyName = firstText([row.company_name, payload.companyName]) ?? "(unknown)";
    const description =
      descriptionByAccountRecordId.get(key) ??
      firstText([payload.companyDescription, row.company_description]);
    const rowKey = firstText([row.row_key, payload.rowKey]);
    const current = accountsByKey.get(key);
    if (current) {
      current.businessAccountId = current.businessAccountId ?? businessAccountId;
      current.companyName = current.companyName || companyName;
      current.accountType = current.accountType ?? firstText([payload.accountType]);
      current.category = current.category ?? firstText([row.category, payload.category]);
      current.marketingEligible =
        current.marketingEligible ?? normalizeBoolean(payload.marketingEligible);
      current.industryType = current.industryType ?? firstText([row.industry_type, payload.industryType]);
      current.subCategory = current.subCategory ?? firstText([row.sub_category, payload.subCategory]);
      current.companyDescription = current.companyDescription ?? description;
      current.rowCount += 1;
      if (rowKey) {
        current.rowKeys.push(rowKey);
      }
    } else {
      accountsByKey.set(key, {
        accountRecordId: key,
        businessAccountId,
        companyName,
        accountType: firstText([payload.accountType]),
        category: firstText([row.category, payload.category]),
        marketingEligible: normalizeBoolean(payload.marketingEligible),
        industryType: firstText([row.industry_type, payload.industryType]),
        subCategory: firstText([row.sub_category, payload.subCategory]),
        companyDescription: description,
        rowCount: 1,
        rowKeys: rowKey ? [rowKey] : [],
      });
    }

    if (businessAccountId && !keysByBusinessAccountId.has(businessAccountId)) {
      keysByBusinessAccountId.set(businessAccountId, key);
    }
  }

  return { accountsByKey, keysByBusinessAccountId };
}

function readProductionMatch(
  localAccount: AccountAggregate,
  accountsByKey: Map<string, ProductionAccountAggregate>,
  keysByBusinessAccountId: Map<string, string>,
): ProductionAccountAggregate | null {
  const byKey = accountsByKey.get(localAccount.accountRecordId);
  if (byKey) {
    return byKey;
  }

  if (localAccount.businessAccountId) {
    const matchedKey = keysByBusinessAccountId.get(localAccount.businessAccountId);
    if (matchedKey) {
      return accountsByKey.get(matchedKey) ?? null;
    }
  }

  return null;
}

function addSkippedIfDifferent(
  skipped: SkippedExistingValue[],
  account: ProductionAccountAggregate,
  field: SkippedExistingValue["field"],
  productionValue: string | null,
  previewValue: string | null,
): void {
  if (!productionValue || !previewValue || productionValue === previewValue) {
    return;
  }

  skipped.push({
    accountRecordId: account.accountRecordId,
    businessAccountId: account.businessAccountId,
    companyName: account.companyName,
    field,
    productionValue,
    previewValue,
  });
}

function buildPlan(snapshot: Snapshot): {
  snapshotCreatedAt: string | null;
  sourceLabel: string | null;
  summary: Record<string, number>;
  missingAccounts: MissingAccountOperation[];
  enrichExistingAccounts: EnrichmentOperation[];
  skippedExistingValues: SkippedExistingValue[];
  residualMissingFields: ResidualMissingField[];
} {
  const localAccounts = buildLocalAccountMap();
  const { accountsByKey, keysByBusinessAccountId } = buildProductionAccountMap(snapshot);
  const missingAccounts: MissingAccountOperation[] = [];
  const enrichExistingAccounts: EnrichmentOperation[] = [];
  const skippedExistingValues: SkippedExistingValue[] = [];
  const residualMissingFields: ResidualMissingField[] = [];

  for (const localAccount of localAccounts.values()) {
    const productionAccount = readProductionMatch(
      localAccount,
      accountsByKey,
      keysByBusinessAccountId,
    );

    if (!productionAccount) {
      missingAccounts.push({
        accountRecordId: localAccount.accountRecordId,
        businessAccountId: localAccount.businessAccountId,
        companyName: localAccount.companyName,
        companyDescription: localAccount.companyDescription,
        category: localAccount.category,
        marketingEligible: localAccount.marketingEligible,
        rowsToWrite: localAccount.rows,
      });
      continue;
    }

    const fields: EnrichmentOperation["fields"] = {};
    if (!productionAccount.industryType && localAccount.industryType) {
      fields.industryType = localAccount.industryType;
    } else if (!productionAccount.industryType) {
      residualMissingFields.push({
        accountRecordId: productionAccount.accountRecordId,
        businessAccountId: productionAccount.businessAccountId,
        companyName: productionAccount.companyName,
        field: "industryType",
      });
    }

    if (!productionAccount.subCategory && localAccount.subCategory) {
      fields.subCategory = localAccount.subCategory;
    } else if (!productionAccount.subCategory) {
      residualMissingFields.push({
        accountRecordId: productionAccount.accountRecordId,
        businessAccountId: productionAccount.businessAccountId,
        companyName: productionAccount.companyName,
        field: "subCategory",
      });
    }

    if (!productionAccount.companyDescription && localAccount.companyDescription) {
      fields.companyDescription = localAccount.companyDescription;
    } else if (!productionAccount.companyDescription) {
      residualMissingFields.push({
        accountRecordId: productionAccount.accountRecordId,
        businessAccountId: productionAccount.businessAccountId,
        companyName: productionAccount.companyName,
        field: "companyDescription",
      });
    }

    addSkippedIfDifferent(
      skippedExistingValues,
      productionAccount,
      "industryType",
      productionAccount.industryType,
      localAccount.industryType,
    );
    addSkippedIfDifferent(
      skippedExistingValues,
      productionAccount,
      "subCategory",
      productionAccount.subCategory,
      localAccount.subCategory,
    );
    addSkippedIfDifferent(
      skippedExistingValues,
      productionAccount,
      "companyDescription",
      productionAccount.companyDescription,
      localAccount.companyDescription,
    );

    if (Object.keys(fields).length > 0) {
      enrichExistingAccounts.push({
        accountRecordId: productionAccount.accountRecordId,
        businessAccountId: productionAccount.businessAccountId,
        companyName: productionAccount.companyName,
        fields,
      });
    }
  }

  const fieldsToFill = enrichExistingAccounts.reduce(
    (count, operation) => count + Object.keys(operation.fields).length,
    0,
  );
  const missingAccountRows = missingAccounts.reduce(
    (count, operation) => count + operation.rowsToWrite.length,
    0,
  );

  return {
    snapshotCreatedAt: snapshot.createdAt ?? null,
    sourceLabel: snapshot.sourceLabel ?? null,
    summary: {
      localVisibleAccounts: localAccounts.size,
      productionRawAccounts: accountsByKey.size,
      missingAccounts: missingAccounts.length,
      missingAccountRows,
      existingAccountsToEnrich: enrichExistingAccounts.length,
      existingFieldsToFill: fieldsToFill,
      skippedExistingValues: skippedExistingValues.length,
      residualMissingFields: residualMissingFields.length,
    },
    missingAccounts,
    enrichExistingAccounts,
    skippedExistingValues,
    residualMissingFields,
  };
}

function main(): void {
  const productionSnapshotPath =
    readArgument("production-snapshot") ?? process.env.PRODUCTION_SNAPSHOT_PATH;
  const outputPath = readArgument("output") ?? process.env.PATCH_PLAN_PATH;

  if (!productionSnapshotPath) {
    throw new Error("Missing --production-snapshot=/path/to/snapshot.json");
  }

  const snapshot = JSON.parse(readFileSync(productionSnapshotPath, "utf8")) as Snapshot;
  const plan = buildPlan(snapshot);
  const resolvedOutputPath =
    outputPath ??
    path.join(
      process.cwd(),
      "tmp",
      `read-model-production-patch-plan-${new Date().toISOString().replaceAll(":", "-")}.json`,
    );
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath: resolvedOutputPath, summary: plan.summary }, null, 2));
}

main();
