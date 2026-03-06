import type { EmployeeDirectoryItem } from "@/lib/acumatica";
import type { BusinessAccountRow } from "@/types/business-account";
import { getReadModelDb } from "@/lib/read-model/db";

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

export function replaceEmployeeDirectory(items: EmployeeDirectoryItem[]): void {
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
        "sync",
        now,
      );
    }
  });

  replace(items);
}

export function readEmployeeDirectory(): EmployeeDirectoryItem[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT employee_id, name
      FROM employee_directory
      ORDER BY sort_name ASC, name ASC
      `,
    )
    .all() as Array<{ employee_id: string; name: string }>;

  return rows.map((row) => ({
    id: row.employee_id,
    name: row.name,
  }));
}
