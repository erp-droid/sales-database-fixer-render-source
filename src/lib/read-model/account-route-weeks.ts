import { getReadModelDb } from "@/lib/read-model/db";
import type { BusinessAccountRow } from "@/types/business-account";

type StoredAccountRouteWeekRow = {
  account_record_id: string;
  route_week_label: string;
};

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAccountRecordId(row: BusinessAccountRow): string | null {
  return normalizeText(row.accountRecordId ?? row.id);
}

function buildRouteWeekMap(accountRecordIds: string[]): Map<string, string> {
  if (accountRecordIds.length === 0) {
    return new Map();
  }

  const db = getReadModelDb();
  const placeholders = accountRecordIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT account_record_id, route_week_label
      FROM account_route_weeks
      WHERE account_record_id IN (${placeholders})
      `,
    )
    .all(...accountRecordIds) as StoredAccountRouteWeekRow[];

  return new Map(
    rows.map((row) => [
      row.account_record_id,
      normalizeText(row.route_week_label) ?? "Week 1",
    ]),
  );
}

export function applyLocalAccountRouteWeeksToRows(
  rows: BusinessAccountRow[],
): BusinessAccountRow[] {
  const accountRecordIds = [
    ...new Set(rows.map(resolveAccountRecordId).filter((value): value is string => value !== null)),
  ];
  if (accountRecordIds.length === 0) {
    return rows;
  }

  const routeWeekByAccountRecordId = buildRouteWeekMap(accountRecordIds);
  if (routeWeekByAccountRecordId.size === 0) {
    return rows;
  }

  let changed = false;
  const nextRows = rows.map((row) => {
    const accountRecordId = resolveAccountRecordId(row);
    const routeWeek =
      accountRecordId !== null ? routeWeekByAccountRecordId.get(accountRecordId) : undefined;
    if (!routeWeek || row.week === routeWeek) {
      return row;
    }

    changed = true;
    return {
      ...row,
      week: routeWeek,
    };
  });

  return changed ? nextRows : rows;
}
