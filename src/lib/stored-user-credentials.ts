import crypto from "node:crypto";

import { getEnv } from "@/lib/env";
import { getReadModelDb } from "@/lib/read-model/db";

type StoredCredentialRow = {
  login_name: string;
  username: string;
  encrypted_password: string;
  created_at: string;
  updated_at: string;
};

export type StoredUserCredentials = {
  loginName: string;
  username: string;
  password: string;
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
      "A secret is required to store encrypted user credentials. Set USER_CREDENTIALS_SECRET or MAIL_SERVICE_SHARED_SECRET.",
    );
  }

  return secret.trim();
}

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(readCredentialsSecret()).digest();
}

function encryptPassword(password: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptPassword(value: string): string {
  const [version, ivEncoded, tagEncoded, payloadEncoded] = value.split(".");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !payloadEncoded) {
    throw new Error("Stored credential payload has an unsupported format.");
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

function normalizeRow(row: StoredCredentialRow): StoredUserCredentials {
  return {
    loginName: row.login_name,
    username: row.username,
    password: decryptPassword(row.encrypted_password),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function storeUserCredentials(input: {
  loginName: string;
  username: string;
  password: string;
}): void {
  const loginName = normalizeLoginName(input.loginName);
  const username = input.username.trim();
  const password = input.password;
  if (!loginName || !username || !password) {
    throw new Error("loginName, username, and password are required to store user credentials.");
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO user_auth_credentials (
      login_name,
      username,
      encrypted_password,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(login_name) DO UPDATE SET
      username = excluded.username,
      encrypted_password = excluded.encrypted_password,
      updated_at = excluded.updated_at
    `,
  ).run(loginName, username, encryptPassword(password), now, now);
}

export function readStoredUserCredentials(loginName: string): StoredUserCredentials | null {
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
        username,
        encrypted_password,
        created_at,
        updated_at
      FROM user_auth_credentials
      WHERE login_name = ?
      `,
    )
    .get(normalized) as StoredCredentialRow | undefined;

  return row ? normalizeRow(row) : null;
}

