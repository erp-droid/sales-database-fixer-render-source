import { formatPhoneForTwilioDial } from "@/lib/phone";
import { getReadModelDb } from "@/lib/read-model/db";

export type CallerPhoneOverride = {
  loginName: string;
  phoneNumber: string;
  updatedAt: string;
};

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

export function readCallerPhoneOverride(loginName: string): CallerPhoneOverride | null {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    return null;
  }

  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT login_name, phone_number, updated_at
      FROM caller_phone_overrides
      WHERE login_name = ?
      `,
    )
    .get(normalizedLoginName) as
    | {
        login_name: string;
        phone_number: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    loginName: row.login_name,
    phoneNumber: row.phone_number,
    updatedAt: row.updated_at,
  };
}

export function readAllCallerPhoneOverrides(): CallerPhoneOverride[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT login_name, phone_number, updated_at
      FROM caller_phone_overrides
      ORDER BY login_name ASC
      `,
    )
    .all() as Array<{
      login_name: string;
      phone_number: string;
      updated_at: string;
    }>;

  return rows.map((row) => ({
    loginName: row.login_name,
    phoneNumber: row.phone_number,
    updatedAt: row.updated_at,
  }));
}

export function saveCallerPhoneOverride(loginName: string, phoneNumber: string): CallerPhoneOverride {
  const normalizedLoginName = normalizeLoginName(loginName);
  const normalizedPhoneNumber = formatPhoneForTwilioDial(phoneNumber);
  if (!normalizedLoginName || !normalizedPhoneNumber) {
    throw new Error("A valid login name and phone number are required.");
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO caller_phone_overrides (
      login_name,
      phone_number,
      updated_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(login_name) DO UPDATE SET
      phone_number = excluded.phone_number,
      updated_at = excluded.updated_at
    `,
  ).run(normalizedLoginName, normalizedPhoneNumber, now);

  return {
    loginName: normalizedLoginName,
    phoneNumber: normalizedPhoneNumber,
    updatedAt: now,
  };
}
