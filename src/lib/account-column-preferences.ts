import { getReadModelDb } from "@/lib/read-model/db";
import { HttpError } from "@/lib/errors";
import {
  normalizeAccountColumnPreferences,
  type AccountColumnPreferences,
  type AccountColumnPreferencesRequest,
} from "@/types/account-column-preferences";

const ACCOUNT_COLUMNS_PREFERENCE_KEY = "accounts.columns.v1";

type AccountUserPreferenceRow = {
  value_json: string;
  updated_at: string;
};

function ensureAccountUserPreferencesSchema(): void {
  const db = getReadModelDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_user_preferences (
      login_name TEXT NOT NULL,
      preference_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(login_name, preference_key)
    );

    CREATE INDEX IF NOT EXISTS idx_account_user_preferences_updated_at
      ON account_user_preferences(updated_at);
  `);
}

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

function parsePreferenceJson(value: string, updatedAt: string | null): AccountColumnPreferences {
  try {
    return normalizeAccountColumnPreferences({
      ...(JSON.parse(value) as Record<string, unknown>),
      updatedAt,
    });
  } catch {
    return normalizeAccountColumnPreferences({ updatedAt });
  }
}

export function readAccountColumnPreferences(loginName: string): AccountColumnPreferences {
  ensureAccountUserPreferencesSchema();
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    throw new HttpError(401, "Signed-in username is unavailable.");
  }

  const row = getReadModelDb()
    .prepare(
      `
      SELECT value_json, updated_at
      FROM account_user_preferences
      WHERE login_name = ? AND preference_key = ?
    `,
    )
    .get(normalizedLoginName, ACCOUNT_COLUMNS_PREFERENCE_KEY) as
    | AccountUserPreferenceRow
    | undefined;

  if (!row) {
    return normalizeAccountColumnPreferences(null);
  }

  return parsePreferenceJson(row.value_json, row.updated_at);
}

export function saveAccountColumnPreferences(
  loginName: string,
  input: AccountColumnPreferencesRequest,
): AccountColumnPreferences {
  ensureAccountUserPreferencesSchema();
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    throw new HttpError(401, "Signed-in username is unavailable.");
  }

  const preferences = normalizeAccountColumnPreferences(input);
  const now = new Date().toISOString();
  getReadModelDb()
    .prepare(
      `
      INSERT INTO account_user_preferences (
        login_name,
        preference_key,
        value_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(login_name, preference_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      normalizedLoginName,
      ACCOUNT_COLUMNS_PREFERENCE_KEY,
      JSON.stringify({
        columnOrder: preferences.columnOrder,
        visibleColumns: preferences.visibleColumns,
      }),
      now,
      now,
    );

  return {
    ...preferences,
    updatedAt: now,
  };
}
