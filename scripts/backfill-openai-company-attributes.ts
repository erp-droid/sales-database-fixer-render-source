import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  INDUSTRY_TYPE_OPTIONS,
  SUB_CATEGORY_OPTIONS,
  normalizeOptionValue,
} from "@/lib/business-account-create";
import { suggestCompanyAttributesWithOpenAi } from "@/lib/openai-company-attributes";
import { getReadModelDb } from "@/lib/read-model/db";
import {
  queryReadModelBusinessAccounts,
  readStoredAccountRowsFromReadModel,
} from "@/lib/read-model/accounts";
import { saveAccountCompanyDescription } from "@/lib/read-model/account-local-metadata";
import type { BusinessAccountRow } from "@/types/business-account";
import type {
  CompanyAttributeSuggestionResponse,
  CompanyAttributeSuggestionSource,
} from "@/types/company-attribute-suggestion";

type Candidate = BusinessAccountRow & {
  accountKey: string;
};

type ProgressEntry = {
  status: "updated" | "no_update" | "need_more_context" | "no_match" | "error";
  accountKey: string;
  businessAccountId: string | null;
  companyName: string;
  updatedFields: string[];
  error?: string;
  suggestion?: {
    industryType: string | null;
    subCategory: string | null;
    companyDescription: string | null;
    confidence: string;
    sources: CompanyAttributeSuggestionSource[];
  };
  at: string;
};

type ProgressFile = {
  startedAt: string;
  updatedAt: string;
  dbPath: string;
  entries: Record<string, ProgressEntry>;
};

const DEFAULT_PROGRESS_PATH = path.join(
  process.cwd(),
  "data",
  "openai-company-attribute-backfill-3001-progress.json",
);

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function accountKey(row: BusinessAccountRow): string | null {
  return cleanText(row.accountRecordId ?? row.id) ?? cleanText(row.businessAccountId);
}

function mergeCandidate(existing: Candidate, incoming: BusinessAccountRow): Candidate {
  return {
    ...existing,
    primaryContactEmail: existing.primaryContactEmail ?? incoming.primaryContactEmail,
    industryType: existing.industryType ?? incoming.industryType,
    subCategory: existing.subCategory ?? incoming.subCategory,
    companyDescription: existing.companyDescription ?? incoming.companyDescription,
    category: existing.category ?? incoming.category,
    companyRegion: existing.companyRegion ?? incoming.companyRegion,
    marketingEligible: existing.marketingEligible ?? incoming.marketingEligible,
  };
}

function needsSuggestion(row: BusinessAccountRow): boolean {
  return !hasText(row.industryType) || !hasText(row.subCategory) || !hasText(row.companyDescription);
}

function readProgress(filePath: string, dbPath: string): ProgressFile {
  if (!existsSync(filePath)) {
    return {
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dbPath,
      entries: {},
    };
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ProgressFile;
  return {
    startedAt: parsed.startedAt,
    updatedAt: parsed.updatedAt,
    dbPath: parsed.dbPath || dbPath,
    entries: parsed.entries ?? {},
  };
}

function writeProgress(filePath: string, progress: ProgressFile): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  progress.updatedAt = new Date().toISOString();
  writeFileSync(filePath, `${JSON.stringify(progress, null, 2)}\n`);
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
    row.companyPhone,
    row.phoneNumber,
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

function groupStoredRowsByAccountKey(): Map<string, BusinessAccountRow[]> {
  const grouped = new Map<string, BusinessAccountRow[]>();
  for (const row of readStoredAccountRowsFromReadModel()) {
    const key = accountKey(row);
    if (!key) {
      continue;
    }

    const rows = grouped.get(key);
    if (rows) {
      rows.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  return grouped;
}

function readCandidates(limit: number | null): Candidate[] {
  const firstPage = queryReadModelBusinessAccounts({
    q: "",
    sortBy: "companyName",
    sortDir: "asc",
    page: 1,
    pageSize: 1,
    includeInternalRows: true,
  });
  const allRows = queryReadModelBusinessAccounts({
    q: "",
    sortBy: "companyName",
    sortDir: "asc",
    page: 1,
    pageSize: Math.max(firstPage.total, 1),
    includeInternalRows: true,
  }).items;

  const byAccount = new Map<string, Candidate>();
  for (const row of allRows) {
    const key = accountKey(row);
    if (!key) {
      continue;
    }

    const existing = byAccount.get(key);
    if (existing) {
      byAccount.set(key, mergeCandidate(existing, row));
    } else {
      byAccount.set(key, {
        ...row,
        accountKey: key,
      });
    }
  }

  const candidates = [...byAccount.values()].filter(needsSuggestion);
  return limit === null ? candidates : candidates.slice(0, limit);
}

function updateAccountRows(
  storedRows: BusinessAccountRow[],
  nextIndustryType: string | null,
  nextSubCategory: string | null,
): string[] {
  const updatedFields: string[] = [];
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE account_rows
    SET industry_type = @industry_type,
        sub_category = @sub_category,
        search_text = @search_text,
        payload_json = @payload_json,
        updated_at = @updated_at
    WHERE row_key = @row_key
  `);

  const rowsToUpdate = storedRows.map((row) => {
    const industryType =
      !hasText(row.industryType) && nextIndustryType ? nextIndustryType : row.industryType;
    const subCategory =
      !hasText(row.subCategory) && nextSubCategory ? nextSubCategory : row.subCategory;

    if (industryType !== row.industryType && !updatedFields.includes("industryType")) {
      updatedFields.push("industryType");
    }
    if (subCategory !== row.subCategory && !updatedFields.includes("subCategory")) {
      updatedFields.push("subCategory");
    }

    return {
      ...row,
      industryType,
      subCategory,
    };
  });

  if (updatedFields.length === 0) {
    return [];
  }

  const transaction = db.transaction(() => {
    for (const row of rowsToUpdate) {
      update.run({
        row_key: row.rowKey ?? `${row.accountRecordId ?? row.id}:contact:${row.contactId ?? "row"}`,
        industry_type: row.industryType ?? null,
        sub_category: row.subCategory ?? null,
        search_text: buildSearchText(row),
        payload_json: JSON.stringify(row),
        updated_at: now,
      });
    }
  });
  transaction();

  return updatedFields;
}

function applySuggestion(
  candidate: Candidate,
  storedRowsByAccountKey: Map<string, BusinessAccountRow[]>,
  result: CompanyAttributeSuggestionResponse,
): ProgressEntry {
  if (result.status !== "ready") {
    return {
      status: result.status,
      accountKey: candidate.accountKey,
      businessAccountId: candidate.businessAccountId,
      companyName: candidate.companyName,
      updatedFields: [],
      at: new Date().toISOString(),
    };
  }

  const suggestion = result.suggestion;
  const nextIndustryType = !hasText(candidate.industryType)
    ? normalizeOptionValue(INDUSTRY_TYPE_OPTIONS, suggestion.industryType)
    : null;
  const nextSubCategory = !hasText(candidate.subCategory)
    ? normalizeOptionValue(SUB_CATEGORY_OPTIONS, suggestion.subCategory)
    : null;
  const nextCompanyDescription =
    !hasText(candidate.companyDescription) && hasText(suggestion.companyDescription)
      ? suggestion.companyDescription.trim()
      : null;

  const storedRows = storedRowsByAccountKey.get(candidate.accountKey) ?? [];
  const updatedFields = updateAccountRows(storedRows, nextIndustryType, nextSubCategory);

  if (nextCompanyDescription) {
    saveAccountCompanyDescription({
      accountRecordId: candidate.accountKey,
      businessAccountId: candidate.businessAccountId,
      companyDescription: nextCompanyDescription,
      category: candidate.category,
      marketingEligible: candidate.marketingEligible,
    });
    updatedFields.push("companyDescription");
  }

  return {
    status: updatedFields.length > 0 ? "updated" : "no_update",
    accountKey: candidate.accountKey,
    businessAccountId: candidate.businessAccountId,
    companyName: candidate.companyName,
    updatedFields,
    suggestion: {
      industryType: suggestion.industryType,
      subCategory: suggestion.subCategory,
      companyDescription: suggestion.companyDescription,
      confidence: suggestion.confidence,
      sources: suggestion.sources,
    },
    at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const dryRun = process.env.OPENAI_BACKFILL_DRY_RUN === "1";
  const limitEnv = process.env.OPENAI_BACKFILL_LIMIT;
  const limit = limitEnv ? readPositiveInteger(limitEnv, 0) : null;
  const progressPath = process.env.OPENAI_BACKFILL_PROGRESS_PATH || DEFAULT_PROGRESS_PATH;
  const sqlitePath = process.env.READ_MODEL_SQLITE_PATH || "data/read-model.sqlite";
  const concurrency = readPositiveInteger(process.env.OPENAI_BACKFILL_CONCURRENCY, 3);
  const progress = readProgress(progressPath, sqlitePath);
  const storedRowsByAccountKey = groupStoredRowsByAccountKey();
  const candidates = readCandidates(limit);
  const retryErrors = process.env.OPENAI_BACKFILL_RETRY_ERRORS === "1";
  const pendingCandidates = candidates.filter((candidate) => {
    const entry = progress.entries[candidate.accountKey];
    if (!entry) {
      return true;
    }
    return retryErrors && entry.status === "error";
  });

  console.log(
    JSON.stringify(
      {
        dryRun,
        sqlitePath,
        progressPath,
        candidates: candidates.length,
        pending: pendingCandidates.length,
        alreadyProcessed: candidates.length - pendingCandidates.length,
        concurrency,
      },
      null,
      2,
    ),
  );

  let processed = 0;
  let nextIndex = 0;

  async function processCandidate(candidate: Candidate): Promise<void> {
    const currentIndex = processed + 1;
    processed = currentIndex;
    try {
      const result = await suggestCompanyAttributesWithOpenAi({
        companyName: candidate.companyName,
        companyDescription: candidate.companyDescription ?? null,
        businessAccountId: candidate.businessAccountId ?? null,
        addressLine1: candidate.addressLine1,
        city: candidate.city,
        state: candidate.state,
        postalCode: candidate.postalCode,
        country: candidate.country,
        contactEmail: candidate.primaryContactEmail,
        industryType: candidate.industryType,
        subCategory: candidate.subCategory,
        category: candidate.category,
        companyRegion: candidate.companyRegion,
      });

      const entry = dryRun
        ? {
            status: result.status === "ready" ? "no_update" : result.status,
            accountKey: candidate.accountKey,
            businessAccountId: candidate.businessAccountId,
            companyName: candidate.companyName,
            updatedFields: [],
            at: new Date().toISOString(),
          } satisfies ProgressEntry
        : applySuggestion(candidate, storedRowsByAccountKey, result);
      progress.entries[candidate.accountKey] = entry;
      writeProgress(progressPath, progress);
      console.log(
        `[${currentIndex}/${pendingCandidates.length}] ${entry.status} ${candidate.companyName} ${entry.updatedFields.join(",")}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress.entries[candidate.accountKey] = {
        status: "error",
        accountKey: candidate.accountKey,
        businessAccountId: candidate.businessAccountId,
        companyName: candidate.companyName,
        updatedFields: [],
        error: message,
        at: new Date().toISOString(),
      };
      writeProgress(progressPath, progress);
      console.error(`[${currentIndex}/${pendingCandidates.length}] error ${candidate.companyName}: ${message}`);
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < pendingCandidates.length) {
      const candidate = pendingCandidates[nextIndex];
      nextIndex += 1;
      if (candidate) {
        await processCandidate(candidate);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, pendingCandidates.length) }, () => worker()),
  );

  const entries = Object.values(progress.entries);
  const summary = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ done: true, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
