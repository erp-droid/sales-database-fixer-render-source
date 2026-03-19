import { formatPhoneForTwilioDial } from "@/lib/phone";
import { getReadModelDb } from "@/lib/read-model/db";

export type CallerIdentityProfile = {
  loginName: string;
  employeeId: string | null;
  contactId: number | null;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  updatedAt: string;
};

type StoredCallerIdentityProfileRow = {
  login_name: string;
  employee_id: string | null;
  contact_id: number | null;
  display_name: string;
  email: string | null;
  phone_number: string | null;
  updated_at: string;
};

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmployeeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed || null;
}

function normalizeDisplayName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || fallback;
}

function mapRow(
  row: StoredCallerIdentityProfileRow | undefined,
): CallerIdentityProfile | null {
  if (!row) {
    return null;
  }

  return {
    loginName: row.login_name,
    employeeId: row.employee_id,
    contactId: row.contact_id,
    displayName: row.display_name,
    email: row.email,
    phoneNumber: row.phone_number,
    updatedAt: row.updated_at,
  };
}

export function readCallerIdentityProfile(loginName: string): CallerIdentityProfile | null {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    return null;
  }

  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        login_name,
        employee_id,
        contact_id,
        display_name,
        email,
        phone_number,
        updated_at
      FROM caller_identity_profiles
      WHERE login_name = ?
      `,
    )
    .get(normalizedLoginName) as StoredCallerIdentityProfileRow | undefined;

  return mapRow(row);
}

export function readAllCallerIdentityProfiles(): CallerIdentityProfile[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        login_name,
        employee_id,
        contact_id,
        display_name,
        email,
        phone_number,
        updated_at
      FROM caller_identity_profiles
      ORDER BY display_name COLLATE NOCASE ASC, login_name ASC
      `,
    )
    .all() as StoredCallerIdentityProfileRow[];

  return rows
    .map((row) => mapRow(row))
    .filter((row): row is CallerIdentityProfile => row !== null);
}

export function saveCallerIdentityProfile(input: {
  loginName: string;
  employeeId?: string | null;
  contactId?: number | null;
  displayName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}): CallerIdentityProfile {
  const normalizedLoginName = normalizeLoginName(input.loginName);
  if (!normalizedLoginName) {
    throw new Error("A valid login name is required.");
  }

  const existing = readCallerIdentityProfile(normalizedLoginName);
  const displayName = normalizeDisplayName(
    input.displayName,
    existing?.displayName ?? normalizedLoginName,
  );
  const employeeId =
    normalizeEmployeeId(input.employeeId) ?? existing?.employeeId ?? null;
  const email = normalizeEmail(input.email) ?? existing?.email ?? null;
  const phoneNumber =
    formatPhoneForTwilioDial(input.phoneNumber) ?? existing?.phoneNumber ?? null;
  const contactId = input.contactId ?? existing?.contactId ?? null;

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO caller_identity_profiles (
      login_name,
      employee_id,
      contact_id,
      display_name,
      email,
      phone_number,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(login_name) DO UPDATE SET
      employee_id = excluded.employee_id,
      contact_id = excluded.contact_id,
      display_name = excluded.display_name,
      email = excluded.email,
      phone_number = excluded.phone_number,
      updated_at = excluded.updated_at
    `,
  ).run(
    normalizedLoginName,
    employeeId,
    contactId,
    displayName,
    email,
    phoneNumber,
    now,
  );

  return {
    loginName: normalizedLoginName,
    employeeId,
    contactId,
    displayName,
    email,
    phoneNumber,
    updatedAt: now,
  };
}
