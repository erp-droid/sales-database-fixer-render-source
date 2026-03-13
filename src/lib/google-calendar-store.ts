import crypto from "node:crypto";

import { getEnv } from "@/lib/env";
import { getReadModelDb } from "@/lib/read-model/db";

type GoogleCalendarConnectionRow = {
  login_name: string;
  connected_google_email: string;
  encrypted_refresh_token: string;
  encrypted_access_token: string | null;
  token_scope: string | null;
  access_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredGoogleCalendarConnection = {
  loginName: string;
  connectedGoogleEmail: string;
  refreshToken: string;
  accessToken: string | null;
  tokenScope: string | null;
  accessTokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeLoginName(loginName: string): string {
  return loginName.trim().toLowerCase();
}

function readCredentialsSecret(): string {
  const env = getEnv();
  const secret = env.USER_CREDENTIALS_SECRET ?? env.MAIL_SERVICE_SHARED_SECRET;
  if (!secret?.trim()) {
    throw new Error(
      "A secret is required to store encrypted calendar credentials. Set USER_CREDENTIALS_SECRET or MAIL_SERVICE_SHARED_SECRET.",
    );
  }

  return secret.trim();
}

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(readCredentialsSecret()).digest();
}

function encryptValue(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptValue(value: string): string {
  const [version, ivEncoded, tagEncoded, payloadEncoded] = value.split(".");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !payloadEncoded) {
    throw new Error("Stored calendar credential payload has an unsupported format.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadEncoded, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function normalizeRow(row: GoogleCalendarConnectionRow): StoredGoogleCalendarConnection {
  return {
    loginName: row.login_name,
    connectedGoogleEmail: row.connected_google_email,
    refreshToken: decryptValue(row.encrypted_refresh_token),
    accessToken: row.encrypted_access_token ? decryptValue(row.encrypted_access_token) : null,
    tokenScope: row.token_scope,
    accessTokenExpiresAt: row.access_token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function storeGoogleCalendarConnection(input: {
  loginName: string;
  connectedGoogleEmail: string;
  refreshToken: string;
  accessToken: string | null;
  tokenScope: string | null;
  accessTokenExpiresAt: string | null;
}): void {
  const loginName = normalizeLoginName(input.loginName);
  const connectedGoogleEmail = input.connectedGoogleEmail.trim().toLowerCase();
  const refreshToken = input.refreshToken.trim();
  const accessToken = input.accessToken?.trim() || null;
  const tokenScope = input.tokenScope?.trim() || null;
  const accessTokenExpiresAt = input.accessTokenExpiresAt?.trim() || null;

  if (!loginName || !connectedGoogleEmail || !refreshToken) {
    throw new Error(
      "loginName, connectedGoogleEmail, and refreshToken are required to store a calendar connection.",
    );
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO google_calendar_connections (
      login_name,
      connected_google_email,
      encrypted_refresh_token,
      encrypted_access_token,
      token_scope,
      access_token_expires_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(login_name) DO UPDATE SET
      connected_google_email = excluded.connected_google_email,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      encrypted_access_token = excluded.encrypted_access_token,
      token_scope = excluded.token_scope,
      access_token_expires_at = excluded.access_token_expires_at,
      updated_at = excluded.updated_at
    `,
  ).run(
    loginName,
    connectedGoogleEmail,
    encryptValue(refreshToken),
    accessToken ? encryptValue(accessToken) : null,
    tokenScope,
    accessTokenExpiresAt,
    now,
    now,
  );
}

export function readGoogleCalendarConnection(
  loginName: string,
): StoredGoogleCalendarConnection | null {
  const normalized = normalizeLoginName(loginName);
  if (!normalized) {
    return null;
  }

  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        login_name,
        connected_google_email,
        encrypted_refresh_token,
        encrypted_access_token,
        token_scope,
        access_token_expires_at,
        created_at,
        updated_at
      FROM google_calendar_connections
      WHERE login_name = ?
      `,
    )
    .get(normalized) as GoogleCalendarConnectionRow | undefined;

  return row ? normalizeRow(row) : null;
}

export function updateGoogleCalendarAccessToken(input: {
  loginName: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  tokenScope?: string | null;
}): void {
  const loginName = normalizeLoginName(input.loginName);
  if (!loginName) {
    throw new Error("loginName is required to update a calendar access token.");
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE google_calendar_connections
    SET
      encrypted_access_token = ?,
      access_token_expires_at = ?,
      token_scope = COALESCE(?, token_scope),
      updated_at = ?
    WHERE login_name = ?
    `,
  ).run(
    input.accessToken?.trim() ? encryptValue(input.accessToken.trim()) : null,
    input.accessTokenExpiresAt?.trim() || null,
    input.tokenScope?.trim() || null,
    now,
    loginName,
  );
}

export function deleteGoogleCalendarConnection(loginName: string): void {
  const normalized = normalizeLoginName(loginName);
  if (!normalized) {
    return;
  }

  const db = getReadModelDb();
  db.prepare("DELETE FROM google_calendar_connections WHERE login_name = ?").run(normalized);
}
