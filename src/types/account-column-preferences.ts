import type { SortBy } from "@/types/business-account";

export const ACCOUNT_COLUMN_IDS: readonly SortBy[] = [
  "companyName",
  "accountType",
  "opportunityCount",
  "salesRepName",
  "industryType",
  "subCategory",
  "companyRegion",
  "week",
  "address",
  "companyPhone",
  "primaryContactName",
  "primaryContactJobTitle",
  "primaryContactPhone",
  "primaryContactExtension",
  "primaryContactEmail",
  "notes",
  "category",
  "lastCalledAt",
  "lastCalendarInvitedAt",
  "lastEmailedAt",
  "lastModifiedIso",
] as const;

export const DEFAULT_ACCOUNT_VISIBLE_COLUMNS: readonly SortBy[] = [
  "companyName",
  "accountType",
  "opportunityCount",
  "address",
  "companyPhone",
  "primaryContactName",
  "primaryContactJobTitle",
  "primaryContactPhone",
  "primaryContactExtension",
  "primaryContactEmail",
  "lastCalledAt",
  "lastCalendarInvitedAt",
  "lastEmailedAt",
  "category",
] as const;

export const DEFAULT_ACCOUNT_COLUMN_ORDER: readonly SortBy[] = [
  ...DEFAULT_ACCOUNT_VISIBLE_COLUMNS,
  ...ACCOUNT_COLUMN_IDS.filter(
    (columnId) => !DEFAULT_ACCOUNT_VISIBLE_COLUMNS.includes(columnId),
  ),
] as const;

export type AccountColumnPreferences = {
  columnOrder: SortBy[];
  visibleColumns: SortBy[];
  updatedAt: string | null;
};

export type AccountColumnPreferencesResponse = {
  preferences: AccountColumnPreferences;
};

export type AccountColumnPreferencesRequest = {
  columnOrder?: unknown;
  visibleColumns?: unknown;
};

export function isValidAccountColumnOrder(value: unknown): value is SortBy[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_ACCOUNT_COLUMN_ORDER.length) {
    return false;
  }

  const unique = new Set(value);
  if (unique.size !== DEFAULT_ACCOUNT_COLUMN_ORDER.length) {
    return false;
  }

  return DEFAULT_ACCOUNT_COLUMN_ORDER.every((column) => unique.has(column));
}

export function isKnownAccountColumnList(value: unknown): value is SortBy[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const unique = new Set(value);
  if (unique.size !== value.length) {
    return false;
  }

  return value.every((column) =>
    DEFAULT_ACCOUNT_COLUMN_ORDER.includes(column as SortBy),
  );
}

function extractKnownAccountColumns(value: unknown): SortBy[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const next: SortBy[] = [];
  for (const column of value) {
    if (
      typeof column === "string" &&
      DEFAULT_ACCOUNT_COLUMN_ORDER.includes(column as SortBy) &&
      !next.includes(column as SortBy)
    ) {
      next.push(column as SortBy);
    }
  }

  return next;
}

export function mergeAccountColumnList(
  storedColumns: readonly SortBy[],
  requiredColumns: readonly SortBy[],
): SortBy[] {
  const next = [
    ...storedColumns.filter((column) => DEFAULT_ACCOUNT_COLUMN_ORDER.includes(column)),
  ];

  for (const column of requiredColumns) {
    if (next.includes(column)) {
      continue;
    }

    const defaultIndex = DEFAULT_ACCOUNT_COLUMN_ORDER.indexOf(column);
    const nextKnownColumn = DEFAULT_ACCOUNT_COLUMN_ORDER.slice(defaultIndex + 1).find(
      (candidate) => next.includes(candidate),
    );

    if (!nextKnownColumn) {
      next.push(column);
      continue;
    }

    next.splice(next.indexOf(nextKnownColumn), 0, column);
  }

  return next;
}

export function normalizeAccountColumnPreferences(
  value: unknown,
): AccountColumnPreferences {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const knownColumnOrder = extractKnownAccountColumns(record.columnOrder);
  const knownVisibleColumns = extractKnownAccountColumns(record.visibleColumns);

  const columnOrder = isValidAccountColumnOrder(record.columnOrder)
    ? record.columnOrder
    : knownColumnOrder.length > 0
      ? mergeAccountColumnList(knownColumnOrder, DEFAULT_ACCOUNT_COLUMN_ORDER)
      : [...DEFAULT_ACCOUNT_COLUMN_ORDER];

  const visibleColumns = knownVisibleColumns.length > 0
    ? knownVisibleColumns
    : [...DEFAULT_ACCOUNT_VISIBLE_COLUMNS];

  return {
    columnOrder,
    visibleColumns: visibleColumns.filter((column) => columnOrder.includes(column)),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}
