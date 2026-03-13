import type { AuthCookieRefreshState, RawContact } from "@/lib/acumatica";
import { fetchContacts } from "@/lib/acumatica";
import { formatPhoneForTwilioDial } from "@/lib/phone";
import { getReadModelDb } from "@/lib/read-model/db";
import { INTERNAL_EMPLOYEE_EMAIL_DOMAINS } from "@/lib/internal-records";
import type { CallEmployeeDirectoryItem } from "@/lib/call-analytics/types";

type StoredEmployeeDirectoryRow = {
  login_name: string;
  contact_id: number | null;
  display_name: string;
  email: string | null;
  normalized_phone: string | null;
  caller_id_phone: string | null;
  is_active: number;
  updated_at: string;
};

type CallEmployeeDirectoryMetaRow = {
  total: number;
  latest_updated_at: string | null;
};

export type CallEmployeeDirectoryMeta = {
  total: number;
  latestUpdatedAt: string | null;
};

function readWrappedString(record: RawContact, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readWrappedNumber(record: RawContact, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readWrappedBoolean(record: RawContact, key: string): boolean {
  if (!record || typeof record !== "object") {
    return false;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return false;
  }

  return Boolean((field as Record<string, unknown>).value);
}

function readContactPhone(record: RawContact): string | null {
  return (
    readWrappedString(record, "Phone1") ??
    readWrappedString(record, "Phone2") ??
    readWrappedString(record, "Phone3")
  );
}

function readContactEmail(record: RawContact): string | null {
  return readWrappedString(record, "Email") ?? readWrappedString(record, "EMail");
}

function readContactDisplayName(record: RawContact): string | null {
  return (
    readWrappedString(record, "DisplayName") ??
    readWrappedString(record, "FullName") ??
    readWrappedString(record, "ContactName")
  );
}

function buildInternalContactFilter(): string {
  return INTERNAL_EMPLOYEE_EMAIL_DOMAINS.map(
    (domain) => `substringof('@${domain.replace(/'/g, "''")}',Email)`,
  ).join(" or ");
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeLoginName(email: string | null): string | null {
  const trimmed = email?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return null;
  }

  const atIndex = trimmed.indexOf("@");
  const local = atIndex >= 0 ? trimmed.slice(0, atIndex) : trimmed;
  return local || null;
}

function normalizeInternalContact(record: RawContact): CallEmployeeDirectoryItem | null {
  const email = readContactEmail(record);
  const loginName = normalizeLoginName(email);
  const displayName = readContactDisplayName(record) ?? loginName;
  const normalizedPhone = formatPhoneForTwilioDial(readContactPhone(record));

  if (!loginName || !displayName || !normalizedPhone) {
    return null;
  }

  return {
    loginName,
    contactId: readWrappedNumber(record, "ContactID"),
    displayName,
    email,
    normalizedPhone,
    callerIdPhone: normalizedPhone,
    isActive: readWrappedBoolean(record, "Active") || readWrappedBoolean(record, "IsActive"),
    updatedAt: new Date().toISOString(),
  };
}

export async function syncCallEmployeeDirectory(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<CallEmployeeDirectoryItem[]> {
  const contacts = await fetchContacts(
    cookieValue,
    {
      batchSize: 200,
      filter: buildInternalContactFilter(),
    },
    authCookieRefresh,
  );

  const deduped = new Map<string, CallEmployeeDirectoryItem>();
  for (const contact of contacts) {
    const normalized = normalizeInternalContact(contact);
    if (!normalized) {
      continue;
    }

    const existing = deduped.get(normalized.loginName);
    if (
      !existing ||
      (normalized.isActive && !existing.isActive) ||
      (normalized.contactId !== null && existing.contactId === null)
    ) {
      deduped.set(normalized.loginName, normalized);
    }
  }

  const items = [...deduped.values()].sort((left, right) =>
    normalizeComparable(left.displayName).localeCompare(normalizeComparable(right.displayName)),
  );
  replaceCallEmployeeDirectory(items);
  return items;
}

export function replaceCallEmployeeDirectory(items: CallEmployeeDirectoryItem[]): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const replace = db.transaction((directory: CallEmployeeDirectoryItem[]) => {
    db.prepare("DELETE FROM call_employee_directory").run();
    const insert = db.prepare(
      `
      INSERT INTO call_employee_directory (
        login_name,
        contact_id,
        display_name,
        email,
        normalized_phone,
        caller_id_phone,
        is_active,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const item of directory) {
      insert.run(
        item.loginName,
        item.contactId,
        item.displayName,
        item.email,
        item.normalizedPhone,
        item.callerIdPhone,
        item.isActive ? 1 : 0,
        item.updatedAt || now,
      );
    }
  });

  replace(items);
}

export function readCallEmployeeDirectory(): CallEmployeeDirectoryItem[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        login_name,
        contact_id,
        display_name,
        email,
        normalized_phone,
        caller_id_phone,
        is_active,
        updated_at
      FROM call_employee_directory
      ORDER BY display_name COLLATE NOCASE ASC, login_name ASC
      `,
    )
    .all() as StoredEmployeeDirectoryRow[];

  return rows.map((row) => ({
    loginName: row.login_name,
    contactId: row.contact_id,
    displayName: row.display_name,
    email: row.email,
    normalizedPhone: row.normalized_phone,
    callerIdPhone: row.caller_id_phone,
    isActive: row.is_active === 1,
    updatedAt: row.updated_at,
  }));
}

export function readCallEmployeeDirectoryMeta(): CallEmployeeDirectoryMeta {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        MAX(updated_at) AS latest_updated_at
      FROM call_employee_directory
      `,
    )
    .get() as CallEmployeeDirectoryMetaRow | undefined;

  return {
    total: row?.total ?? 0,
    latestUpdatedAt: row?.latest_updated_at ?? null,
  };
}
