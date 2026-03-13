import type { EmployeeDirectoryItem } from "@/lib/acumatica";
import type { BusinessAccountRow } from "@/types/business-account";
import { getReadModelDb } from "@/lib/read-model/db";

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
        sort_name,
        source,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      `,
    );

    for (const item of directory) {
      insert.run(
        item.id,
        item.name,
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
      SELECT employee_id, name, source, updated_at
      FROM employee_directory
      ORDER BY sort_name ASC, name ASC
      `,
    )
    .all() as Array<{
      employee_id: string;
      name: string;
      source: string;
      updated_at: string;
    }>;

  return {
    items: rows.map((row) => ({
      id: row.employee_id,
      name: row.name,
    })),
    source: rows[0]?.source ?? null,
    updatedAt: rows[0]?.updated_at ?? null,
  };
}

export function readEmployeeDirectory(): EmployeeDirectoryItem[] {
  return readEmployeeDirectorySnapshot().items;
}
