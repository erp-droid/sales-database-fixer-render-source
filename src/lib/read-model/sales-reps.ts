import type { EmployeeDirectoryItem } from "@/lib/acumatica";
import { getReadModelDb } from "@/lib/read-model/db";
import type { BusinessAccountRow } from "@/types/business-account";

export type SalesRepDirectoryItem = {
  id: string;
  name: string;
  normalizedName: string;
  usageCount: number;
  ownerReferenceId: string | null;
  loginName: string | null;
  email: string | null;
  isActive: boolean | null;
  updatedAt: string;
};

export type SalesRepDirectorySnapshot = {
  items: SalesRepDirectoryItem[];
  updatedAt: string | null;
};

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function isCanonicalEmployeeId(value: string): boolean {
  return /^E/i.test(value.trim());
}

function compareEmployeeIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function buildSalesRepDirectoryFromRows(
  rows: BusinessAccountRow[],
): Omit<SalesRepDirectoryItem, "updatedAt">[] {
  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      normalizedName: string;
      usageCount: number;
      ownerReferenceId: string | null;
      loginName: string | null;
      email: string | null;
      isActive: boolean | null;
    }
  >();

  for (const row of rows) {
    const id = row.salesRepId?.trim() ?? "";
    const name = row.salesRepName?.trim() ?? "";
    if (!id || !name) {
      continue;
    }

    const normalizedName = normalizeComparable(name);
    const existing = byId.get(id);
    if (existing) {
      existing.usageCount += 1;
      if (!existing.name && name) {
        existing.name = name;
        existing.normalizedName = normalizedName;
      }
      continue;
    }

      byId.set(id, {
        id,
        name,
        normalizedName,
        usageCount: 1,
        ownerReferenceId: id,
        loginName: null,
        email: null,
        isActive: null,
      });
    }

  return [...byId.values()].sort((left, right) => {
    const nameComparison = left.normalizedName.localeCompare(right.normalizedName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (nameComparison !== 0) {
      return nameComparison;
    }

    if (right.usageCount !== left.usageCount) {
      return right.usageCount - left.usageCount;
    }

    return compareEmployeeIds(left.id, right.id);
  });
}

export function buildSalesRepDirectoryFromEmployees(
  employees: EmployeeDirectoryItem[],
): Omit<SalesRepDirectoryItem, "updatedAt">[] {
  const byId = new Map<string, Omit<SalesRepDirectoryItem, "updatedAt">>();

  for (const employee of employees) {
    const id = employee.id.trim();
    const name = employee.name.trim();
    if (!id || !name) {
      continue;
    }

    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name,
        normalizedName: normalizeComparable(name),
        usageCount: 1,
        ownerReferenceId: null,
        loginName: employee.loginName ?? null,
        email: employee.email ?? null,
        isActive:
          typeof employee.isActive === "boolean" ? employee.isActive : null,
      });
    }
  }

  return [...byId.values()].sort((left, right) => {
    const nameComparison = left.normalizedName.localeCompare(right.normalizedName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (nameComparison !== 0) {
      return nameComparison;
    }
    return compareEmployeeIds(left.id, right.id);
  });
}

export function buildSalesRepDirectory(
  rows: BusinessAccountRow[],
  employees: EmployeeDirectoryItem[],
): Omit<SalesRepDirectoryItem, "updatedAt">[] {
  const employeesById = new Map<string, EmployeeDirectoryItem>();
  const employeesByNormalizedName = new Map<string, EmployeeDirectoryItem[]>();
  const byId = new Map<string, Omit<SalesRepDirectoryItem, "updatedAt">>();

  for (const employee of employees) {
    const id = employee.id.trim();
    const name = employee.name.trim();
    if (!id || !name) {
      continue;
    }

    employeesById.set(id, employee);
    const normalizedName = normalizeComparable(name);
    const existingMatches = employeesByNormalizedName.get(normalizedName) ?? [];
    existingMatches.push(employee);
    employeesByNormalizedName.set(normalizedName, existingMatches);

    if (!isCanonicalEmployeeId(id) || byId.has(id)) {
      continue;
    }

    byId.set(id, {
      id,
      name,
      normalizedName,
      usageCount: 0,
      ownerReferenceId: null,
      loginName: employee.loginName ?? null,
      email: employee.email ?? null,
      isActive:
        typeof employee.isActive === "boolean" ? employee.isActive : null,
    });
  }

  for (const row of rows) {
    const rawId = row.salesRepId?.trim() ?? "";
    const rawName = row.salesRepName?.trim() ?? "";
    if (!rawId || !rawName) {
      continue;
    }

    const normalizedName = normalizeComparable(rawName);
    const directMatch = employeesById.get(rawId);
    const normalizedMatches = employeesByNormalizedName.get(normalizedName) ?? [];
    const canonicalMatch =
      (directMatch && isCanonicalEmployeeId(directMatch.id) ? directMatch : null) ??
      (normalizedMatches.length === 1 && isCanonicalEmployeeId(normalizedMatches[0]?.id ?? "")
        ? normalizedMatches[0] ?? null
        : null);

    const canonicalId = canonicalMatch?.id ?? rawId;
    const existing = byId.get(canonicalId);
    if (existing) {
      existing.usageCount += 1;
      if (!existing.ownerReferenceId && rawId !== canonicalId) {
        existing.ownerReferenceId = rawId;
      }
      if (!existing.loginName && canonicalMatch?.loginName) {
        existing.loginName = canonicalMatch.loginName;
      }
      if (!existing.email && canonicalMatch?.email) {
        existing.email = canonicalMatch.email;
      }
      if (existing.isActive === null && typeof canonicalMatch?.isActive === "boolean") {
        existing.isActive = canonicalMatch.isActive;
      }
      continue;
    }

    byId.set(canonicalId, {
      id: canonicalId,
      name: canonicalMatch?.name ?? rawName,
      normalizedName: normalizeComparable(canonicalMatch?.name ?? rawName),
      usageCount: 1,
      ownerReferenceId: rawId === canonicalId ? null : rawId,
      loginName: canonicalMatch?.loginName ?? null,
      email: canonicalMatch?.email ?? null,
      isActive:
        typeof canonicalMatch?.isActive === "boolean" ? canonicalMatch.isActive : null,
    });
  }

  return [...byId.values()].sort((left, right) => {
    if (right.usageCount !== left.usageCount) {
      return right.usageCount - left.usageCount;
    }

    const nameComparison = left.normalizedName.localeCompare(right.normalizedName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return compareEmployeeIds(left.id, right.id);
  });
}

export function replaceSalesRepDirectory(
  items: Array<Omit<SalesRepDirectoryItem, "updatedAt">>,
): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();

  const replace = db.transaction((directory: Array<Omit<SalesRepDirectoryItem, "updatedAt">>) => {
    db.prepare("DELETE FROM sales_rep_directory").run();
    const insert = db.prepare(
      `
      INSERT INTO sales_rep_directory (
        employee_id,
        display_name,
        normalized_name,
        usage_count,
        owner_reference_id,
        login_name,
        email,
        is_active,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const item of directory) {
      insert.run(
        item.id,
        item.name,
        item.normalizedName,
        item.usageCount,
        item.ownerReferenceId,
        item.loginName,
        item.email,
        item.isActive === null ? null : item.isActive ? 1 : 0,
        now,
      );
    }
  });

  replace(items);
}

export function readSalesRepDirectorySnapshot(): SalesRepDirectorySnapshot {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        employee_id,
        display_name,
        normalized_name,
        usage_count,
        owner_reference_id,
        login_name,
        email,
        is_active,
        updated_at
      FROM sales_rep_directory
      ORDER BY normalized_name ASC, usage_count DESC, employee_id ASC
      `,
    )
    .all() as Array<{
      employee_id: string;
      display_name: string;
      normalized_name: string;
      usage_count: number;
      owner_reference_id: string | null;
      login_name: string | null;
      email: string | null;
      is_active: number | null;
      updated_at: string;
    }>;

  return {
    items: rows.map((row) => ({
      id: row.employee_id,
      name: row.display_name,
      normalizedName: row.normalized_name,
      usageCount: Number(row.usage_count ?? 0),
      ownerReferenceId: row.owner_reference_id,
      loginName: row.login_name,
      email: row.email,
      isActive: row.is_active === null ? null : row.is_active > 0,
      updatedAt: row.updated_at,
    })),
    updatedAt: rows[0]?.updated_at ?? null,
  };
}

export function buildSalesRepOptions(
  items: Array<Pick<SalesRepDirectoryItem, "id" | "name" | "normalizedName" | "usageCount">>,
): Array<{ id: string; name: string }> {
  const byName = new Map<
    string,
    {
      id: string;
      name: string;
      normalizedName: string;
      usageCount: number;
    }
  >();

  for (const item of items) {
    const id = item.id.trim();
    const name = item.name.trim();
    const normalizedName = item.normalizedName.trim() || normalizeComparable(name);
    if (!id || !name || !normalizedName) {
      continue;
    }

    const existing = byName.get(normalizedName);
    if (!existing) {
      byName.set(normalizedName, {
        id,
        name,
        normalizedName,
        usageCount: item.usageCount,
      });
      continue;
    }

    if (item.usageCount > existing.usageCount) {
      byName.set(normalizedName, {
        id,
        name,
        normalizedName,
        usageCount: item.usageCount,
      });
      continue;
    }

    if (item.usageCount === existing.usageCount && compareEmployeeIds(id, existing.id) < 0) {
      byName.set(normalizedName, {
        id,
        name,
        normalizedName,
        usageCount: item.usageCount,
      });
    }
  }

  return [...byName.values()]
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
    }));
}

export function rebuildSalesRepDirectoryFromStoredRows(): void {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT sales_rep_id, sales_rep_name, COUNT(*) AS usage_count
      FROM account_rows
      WHERE sales_rep_id IS NOT NULL
        AND TRIM(sales_rep_id) <> ''
        AND sales_rep_name IS NOT NULL
        AND TRIM(sales_rep_name) <> ''
      GROUP BY sales_rep_id, sales_rep_name
      ORDER BY LOWER(TRIM(sales_rep_name)) ASC, usage_count DESC, sales_rep_id ASC
      `,
    )
    .all() as Array<{
      sales_rep_id: string;
      sales_rep_name: string;
      usage_count: number;
    }>;

  replaceSalesRepDirectory(
    rows.map((row) => ({
      id: row.sales_rep_id.trim(),
      name: row.sales_rep_name.trim(),
      normalizedName: normalizeComparable(row.sales_rep_name),
      usageCount: Number(row.usage_count ?? 0),
      ownerReferenceId: row.sales_rep_id.trim(),
      loginName: null,
      email: null,
      isActive: null,
    })),
  );
}
