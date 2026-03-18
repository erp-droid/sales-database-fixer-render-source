import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureReadModelSchema } from "@/lib/read-model/schema";

describe("ensureReadModelSchema", () => {
  let tempDir = "";
  let db: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "schema-test-"));
    db = new Database(path.join(tempDir, "read-model.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds deferred action retry columns to legacy deferred_actions tables", () => {
    db.exec(`
      CREATE TABLE deferred_actions (
        id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL,
        source_surface TEXT NOT NULL,
        business_account_record_id TEXT,
        business_account_id TEXT,
        company_name TEXT,
        contact_id INTEGER,
        contact_name TEXT,
        contact_row_key TEXT,
        kept_contact_id INTEGER,
        kept_contact_name TEXT,
        loser_contact_ids_json TEXT NOT NULL,
        loser_contact_names_json TEXT NOT NULL,
        affected_fields_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        requested_by_login_name TEXT,
        requested_by_name TEXT,
        requested_at TEXT NOT NULL,
        execute_after_at TEXT NOT NULL,
        approved_by_login_name TEXT,
        approved_by_name TEXT,
        approved_at TEXT,
        cancelled_by_login_name TEXT,
        cancelled_by_name TEXT,
        cancelled_at TEXT,
        executed_by_login_name TEXT,
        executed_by_name TEXT,
        executed_at TEXT,
        failure_message TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    ensureReadModelSchema(db);

    const columns = db.prepare("PRAGMA table_info(deferred_actions)").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "reason",
        "attempt_count",
        "max_attempts",
        "last_attempt_at",
      ]),
    );
  });

  it("creates the call_activity_sync table", () => {
    ensureReadModelSchema(db);

    const columns = db.prepare("PRAGMA table_info(call_activity_sync)").all() as Array<{
      name: string;
    }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "session_id",
        "recording_sid",
        "recording_status",
        "recording_duration_seconds",
        "status",
        "attempts",
        "transcript_text",
        "summary_text",
        "activity_id",
        "error_message",
        "recording_deleted_at",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("creates the mail_send_jobs table", () => {
    ensureReadModelSchema(db);

    const columns = db.prepare("PRAGMA table_info(mail_send_jobs)").all() as Array<{
      name: string;
    }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "requested_by_login_name",
        "requested_by_name",
        "payload_json",
        "response_json",
        "status",
        "attempts",
        "error_message",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("creates the user_auth_credentials table", () => {
    ensureReadModelSchema(db);

    const columns = db.prepare("PRAGMA table_info(user_auth_credentials)").all() as Array<{
      name: string;
    }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "login_name",
        "username",
        "encrypted_password",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("creates the google_calendar_connections table", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(google_calendar_connections)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "login_name",
        "connected_google_email",
        "encrypted_refresh_token",
        "encrypted_access_token",
        "token_scope",
        "access_token_expires_at",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("creates the account_local_metadata table", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(account_local_metadata)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "account_record_id",
        "business_account_id",
        "company_description",
        "updated_at",
      ]),
    );
  });

  it("creates the caller_phone_overrides table", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(caller_phone_overrides)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "login_name",
        "phone_number",
        "updated_at",
      ]),
    );
  });

  it("creates the caller_id_verifications table", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(caller_id_verifications)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "login_name",
        "phone_number",
        "validation_code",
        "call_sid",
        "status",
        "failure_message",
        "verified_at",
        "updated_at",
      ]),
    );
  });
});
