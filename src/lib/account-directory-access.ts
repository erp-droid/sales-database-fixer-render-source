import type { BusinessAccountRow } from "@/types/business-account";

export const LOGIN_NAME_COOKIE = "mb_login_name";
export const JEFFERY_DIRECTORY_LOGIN = "jbuhagiar@meadowb.com";
export const JEFFERY_DIRECTORY_SALES_REP = "Jeffery Buhagiar";

const JEFFERY_DIRECTORY_LOGIN_NAMES = new Set([
  "jbuhagiar",
  JEFFERY_DIRECTORY_LOGIN,
]);

const JEFFERY_DIRECTORY_SALES_REP_NAMES = new Set([
  "jeff buhagiar",
  JEFFERY_DIRECTORY_SALES_REP.toLowerCase(),
]);

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

export function isJefferyDirectoryUser(
  loginName: string | null | undefined,
): boolean {
  return JEFFERY_DIRECTORY_LOGIN_NAMES.has(normalizeComparable(loginName));
}

export function isJefferyDirectoryAccount(row: BusinessAccountRow): boolean {
  const category = normalizeComparable(row.category).toUpperCase();
  const salesRepName = normalizeComparable(row.salesRepName);

  return (
    (category === "A" || category === "B") &&
    JEFFERY_DIRECTORY_SALES_REP_NAMES.has(salesRepName)
  );
}

export function filterAccountRowsForDirectoryUser(
  rows: readonly BusinessAccountRow[],
  loginName: string | null | undefined,
): BusinessAccountRow[] {
  if (!isJefferyDirectoryUser(loginName)) {
    return [...rows];
  }

  return rows.filter(isJefferyDirectoryAccount);
}

export function canDirectoryUserAccessAccount(
  loginName: string | null | undefined,
  row: BusinessAccountRow,
): boolean {
  return !isJefferyDirectoryUser(loginName) || isJefferyDirectoryAccount(row);
}
