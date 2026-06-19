import { randomUUID } from "node:crypto";

import { CATEGORY_VALUES } from "@/types/business-account";
import type {
  AccountListCreateRequest,
  AccountListFilters,
  AccountListHeaderFilters,
  AccountListScope,
  AccountListSummary,
} from "@/types/account-list";
import { getReadModelDb } from "@/lib/read-model/db";
import { HttpError } from "@/lib/errors";

const BLANK_CATEGORY_FILTER = "__blank_category__";
const UNASSIGNED_SALES_REP_FILTER = "__unassigned__";
const ACCOUNT_LIST_NAME_MAX_LENGTH = 80;

const DEFAULT_HEADER_FILTERS: AccountListHeaderFilters = {
  companyName: "",
  accountType: "",
  opportunityCount: "",
  salesRepName: "",
  industryType: "",
  subCategory: "",
  companyRegion: "",
  week: "",
  address: "",
  companyPhone: "",
  primaryContactName: "",
  primaryContactJobTitle: "",
  primaryContactPhone: "",
  primaryContactExtension: "",
  primaryContactEmail: "",
  notes: "",
  category: "",
  lastCalled: "",
  lastCalendarInvited: "",
  lastEmailed: "",
  lastModified: "",
};

type AccountListRow = {
  id: string;
  name: string;
  scope: AccountListScope;
  owner_login_name: string;
  filters_json: string;
  created_at: string;
  updated_at: string;
};

function ensureAccountListSchema(): void {
  const db = getReadModelDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_filter_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('user', 'company')),
      owner_login_name TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_account_filter_lists_scope
      ON account_filter_lists(scope);
    CREATE INDEX IF NOT EXISTS idx_account_filter_lists_owner
      ON account_filter_lists(owner_login_name);
    CREATE INDEX IF NOT EXISTS idx_account_filter_lists_updated_at
      ON account_filter_lists(updated_at);
  `);
}

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeText(value: unknown, maxLength = 240): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeStringList(value: unknown, maxItemLength = 120): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, maxItemLength))
        .filter(Boolean),
    ),
  ];
}

function normalizeWeekFilterValue(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^week\s*(\d+)$/i);
  if (!match) {
    return null;
  }

  const weekNumber = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(weekNumber) && weekNumber >= 1 && weekNumber <= 12
    ? `Week ${weekNumber}`
    : null;
}

function compareWeekFilterValues(left: string, right: string): number {
  const leftNumber = Number.parseInt(left.replace(/\D+/g, ""), 10);
  const rightNumber = Number.parseInt(right.replace(/\D+/g, ""), 10);

  if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function normalizeWeekFilters(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(normalizeWeekFilterValue)
        .filter((item): item is string => Boolean(item)),
    ),
  ].sort(compareWeekFilterValues);
}

function normalizeCategoryFilters(value: unknown): string[] {
  return normalizeStringList(value, 40).filter(
    (item) =>
      item === BLANK_CATEGORY_FILTER ||
      (CATEGORY_VALUES as readonly string[]).includes(item),
  );
}

function normalizeSalesRepFilters(value: unknown): string[] {
  return normalizeStringList(value, 120).filter(
    (item) => item === UNASSIGNED_SALES_REP_FILTER || item.length > 0,
  );
}

function normalizeHeaderFilters(value: unknown): AccountListHeaderFilters {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    companyName: normalizeText(record.companyName),
    accountType: normalizeText(record.accountType),
    opportunityCount: normalizeText(record.opportunityCount),
    salesRepName: normalizeText(record.salesRepName),
    industryType: normalizeText(record.industryType),
    subCategory: normalizeText(record.subCategory),
    companyRegion: normalizeText(record.companyRegion),
    week: normalizeText(record.week),
    address: normalizeText(record.address),
    companyPhone: normalizeText(record.companyPhone),
    primaryContactName: normalizeText(record.primaryContactName),
    primaryContactJobTitle: normalizeText(record.primaryContactJobTitle),
    primaryContactPhone: normalizeText(record.primaryContactPhone),
    primaryContactExtension: normalizeText(record.primaryContactExtension),
    primaryContactEmail: normalizeText(record.primaryContactEmail),
    notes: normalizeText(record.notes),
    category:
      typeof record.category === "string" &&
      (record.category === "" || (CATEGORY_VALUES as readonly string[]).includes(record.category))
        ? record.category
        : "",
    lastCalled: normalizeText(record.lastCalled),
    lastCalendarInvited: normalizeText(record.lastCalendarInvited),
    lastEmailed: normalizeText(record.lastEmailed),
    lastModified: normalizeText(record.lastModified),
  };
}

export function normalizeAccountListFilters(value: unknown): AccountListFilters {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    activeFilterView:
      record.activeFilterView === "marketingOnly" ? "marketingOnly" : "allCompanies",
    selectedCategoryFilters: normalizeCategoryFilters(record.selectedCategoryFilters),
    selectedWeekFilters: normalizeWeekFilters(record.selectedWeekFilters),
    selectedSalesRepFilters: normalizeSalesRepFilters(record.selectedSalesRepFilters),
    q: normalizeText(record.q),
    headerFilters: normalizeHeaderFilters(record.headerFilters),
  };
}

function parseFiltersJson(value: string): AccountListFilters {
  try {
    return normalizeAccountListFilters(JSON.parse(value) as unknown);
  } catch {
    return normalizeAccountListFilters(null);
  }
}

function rowToSummary(row: AccountListRow): AccountListSummary {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    ownerLoginName: row.owner_login_name,
    filters: parseFiltersJson(row.filters_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listVisibleAccountLists(loginName: string): AccountListSummary[] {
  ensureAccountListSchema();
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    throw new HttpError(401, "Signed-in username is unavailable.");
  }

  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT id, name, scope, owner_login_name, filters_json, created_at, updated_at
      FROM account_filter_lists
      WHERE scope = 'company' OR owner_login_name = ?
      ORDER BY
        CASE scope WHEN 'user' THEN 0 ELSE 1 END,
        lower(name) ASC,
        updated_at DESC
      `,
    )
    .all(normalizedLoginName) as AccountListRow[];

  return rows.map(rowToSummary);
}

export function createAccountList(
  ownerLoginName: string,
  request: AccountListCreateRequest,
): AccountListSummary {
  ensureAccountListSchema();
  const normalizedLoginName = normalizeLoginName(ownerLoginName);
  if (!normalizedLoginName) {
    throw new HttpError(401, "Signed-in username is unavailable.");
  }

  const name = normalizeText(request.name, ACCOUNT_LIST_NAME_MAX_LENGTH);
  if (!name) {
    throw new HttpError(400, "List name is required.");
  }

  const scope = request.scope === "company" ? "company" : "user";
  const filters = normalizeAccountListFilters(request.filters);
  const now = new Date().toISOString();
  const id = randomUUID();

  getReadModelDb()
    .prepare(
      `
      INSERT INTO account_filter_lists (
        id,
        name,
        scope,
        owner_login_name,
        filters_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(id, name, scope, normalizedLoginName, JSON.stringify(filters), now, now);

  return {
    id,
    name,
    scope,
    ownerLoginName: normalizedLoginName,
    filters,
    createdAt: now,
    updatedAt: now,
  };
}

export function deleteAccountList(id: string, loginName: string): void {
  ensureAccountListSchema();
  const normalizedLoginName = normalizeLoginName(loginName);
  const listId = normalizeText(id, 80);
  if (!normalizedLoginName || !listId) {
    throw new HttpError(400, "List id and signed-in username are required.");
  }

  const result = getReadModelDb()
    .prepare(
      `
      DELETE FROM account_filter_lists
      WHERE id = ?
        AND owner_login_name = ?
      `,
    )
    .run(listId, normalizedLoginName);

  if (result.changes === 0) {
    throw new HttpError(404, "List was not found or cannot be deleted by this user.");
  }
}

export { DEFAULT_HEADER_FILTERS as DEFAULT_ACCOUNT_LIST_HEADER_FILTERS };
