import type { EmployeeDirectoryItem } from "@/lib/acumatica";
import type { BusinessAccountRow } from "@/types/business-account";
import { getReadModelDb } from "@/lib/read-model/db";
import { formatPhoneForTwilioDial } from "@/lib/phone";

export const DERIVED_EMPLOYEE_DIRECTORY_SOURCE = "sync";
export const FULL_EMPLOYEE_DIRECTORY_SOURCE = "acumatica_employees";

export type EmployeeDirectorySnapshot = {
  items: EmployeeDirectoryItem[];
  source: string | null;
  updatedAt: string | null;
};

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

export function buildEmployeeDirectoryFromRows(
  rows: BusinessAccountRow[],
): EmployeeDirectoryItem[] {
  const byId = new Map<string, EmployeeDirectoryItem>();

  for (const row of rows) {
    const id = row.salesRepId?.trim() ?? "";
    const name = row.salesRepName?.trim() ?? "";
    if (!id || !name) {
      continue;
    }

    if (!byId.has(id)) {
      byId.set(id, { id, name });
    }
  }

  return [...byId.values()].sort((left, right) =>
    normalizeComparable(left.name).localeCompare(normalizeComparable(right.name)),
  );
}

export function replaceEmployeeDirectory(
  items: EmployeeDirectoryItem[],
  source: string = DERIVED_EMPLOYEE_DIRECTORY_SOURCE,
): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const replace = db.transaction((directory: EmployeeDirectoryItem[]) => {
    db.prepare("DELETE FROM employee_directory").run();
    const insert = db.prepare(
      `
      INSERT INTO employee_directory (
        employee_id,
        name,
        login_name,
        email,
        contact_id,
        normalized_phone,
        is_active,
        sort_name,
        source,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const item of directory) {
      insert.run(
        item.id,
        item.name,
        item.loginName ?? null,
        item.email ?? null,
        item.contactId ?? null,
        formatPhoneForTwilioDial(item.phone ?? null),
        typeof item.isActive === "boolean" ? (item.isActive ? 1 : 0) : null,
        normalizeComparable(item.name),
        source,
        now,
      );
    }
  });

  replace(items);
}

export function readEmployeeDirectorySnapshot(): EmployeeDirectorySnapshot {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        employee_id,
        name,
        login_name,
        email,
        contact_id,
        normalized_phone,
        is_active,
        source,
        updated_at
      FROM employee_directory
      ORDER BY sort_name ASC, name ASC
      `,
    )
    .all() as Array<{
      employee_id: string;
      name: string;
      login_name: string | null;
      email: string | null;
      contact_id: number | null;
      normalized_phone: string | null;
      is_active: number | null;
      source: string;
      updated_at: string;
    }>;

  return {
    items: rows.map((row) => ({
      id: row.employee_id,
      name: row.name,
      loginName: row.login_name,
      email: row.email,
      contactId: row.contact_id,
      phone: row.normalized_phone,
      isActive: row.is_active === null ? undefined : row.is_active > 0,
    })),
    source: rows[0]?.source ?? null,
    updatedAt: rows[0]?.updated_at ?? null,
  };
}

export function readEmployeeDirectory(): EmployeeDirectoryItem[] {
  return readEmployeeDirectorySnapshot().items;
}

export function countDetailedEmployeeDirectoryItems(
  items: EmployeeDirectoryItem[],
): number {
  return items.filter((item) => item.email?.trim()).length;
}

export function hasDetailedEmployeeDirectory(items: EmployeeDirectoryItem[]): boolean {
  if (items.length === 0) {
    return false;
  }

  const detailedCount = countDetailedEmployeeDirectoryItems(items);
  return detailedCount >= Math.min(items.length, 25);
}
