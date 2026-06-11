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

  it("creates the meeting_bookings table", () => {
    ensureReadModelSchema(db);

    const columns = db.prepare("PRAGMA table_info(meeting_bookings)").all() as Array<{
      name: string;
    }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "event_id",
        "actor_login_name",
        "actor_name",
        "business_account_record_id",
        "business_account_id",
        "company_name",
        "related_contact_id",
        "related_contact_name",
        "category",
        "meeting_summary",
        "attendee_count",
        "attendee_details_json",
        "invite_authority",
        "calendar_invite_status",
        "occurred_at",
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
        "category",
        "marketing_eligible",
        "updated_at",
      ]),
    );
  });

  it("creates the local account_route_weeks table", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(account_route_weeks)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "account_record_id",
        "business_account_id",
        "sales_rep_id",
        "sales_rep_name",
        "category",
        "route_week",
        "route_week_label",
        "latitude",
        "longitude",
        "assignment_version",
        "assignment_reason",
        "updated_at",
      ]),
    );
  });

  it("adds account row supplemental timestamp columns and indexes to legacy account_rows tables", () => {
    db.exec(`
      CREATE TABLE account_rows (
        row_key TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        account_record_id TEXT,
        business_account_id TEXT NOT NULL,
        contact_id INTEGER,
        is_primary_contact INTEGER NOT NULL,
        company_name TEXT NOT NULL,
        address TEXT NOT NULL,
        address_line1 TEXT NOT NULL,
        address_line2 TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        postal_code TEXT NOT NULL,
        country TEXT NOT NULL,
        phone_number TEXT,
        company_phone TEXT,
        company_phone_source TEXT,
        sales_rep_id TEXT,
        sales_rep_name TEXT,
        industry_type TEXT,
        sub_category TEXT,
        company_region TEXT,
        week TEXT,
        primary_contact_name TEXT,
        primary_contact_phone TEXT,
        primary_contact_email TEXT,
        primary_contact_id INTEGER,
        category TEXT,
        notes TEXT,
        last_modified_iso TEXT,
        search_text TEXT NOT NULL,
        address_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `
      INSERT INTO account_rows (
        row_key,
        id,
        account_record_id,
        business_account_id,
        contact_id,
        is_primary_contact,
        company_name,
        address,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        phone_number,
        company_phone,
        company_phone_source,
        sales_rep_id,
        sales_rep_name,
        industry_type,
        sub_category,
        company_region,
        week,
        primary_contact_name,
        primary_contact_phone,
        primary_contact_email,
        primary_contact_id,
        category,
        notes,
        last_modified_iso,
        search_text,
        address_key,
        payload_json,
        updated_at
      ) VALUES (
        @row_key,
        @id,
        @account_record_id,
        @business_account_id,
        @contact_id,
        @is_primary_contact,
        @company_name,
        @address,
        @address_line1,
        @address_line2,
        @city,
        @state,
        @postal_code,
        @country,
        @phone_number,
        @company_phone,
        @company_phone_source,
        @sales_rep_id,
        @sales_rep_name,
        @industry_type,
        @sub_category,
        @company_region,
        @week,
        @primary_contact_name,
        @primary_contact_phone,
        @primary_contact_email,
        @primary_contact_id,
        @category,
        @notes,
        @last_modified_iso,
        @search_text,
        @address_key,
        @payload_json,
        @updated_at
      )
      `,
    ).run({
      row_key: "account-1:contact:202",
      id: "account-1",
      account_record_id: "account-1",
      business_account_id: "BA-1",
      contact_id: 202,
      is_primary_contact: 1,
      company_name: "Example Company",
      address: "123 Main St",
      address_line1: "123 Main St",
      address_line2: "",
      city: "Toronto",
      state: "ON",
      postal_code: "M5H 2N2",
      country: "CA",
      phone_number: null,
      company_phone: null,
      company_phone_source: null,
      sales_rep_id: null,
      sales_rep_name: null,
      industry_type: null,
      sub_category: null,
      company_region: null,
      week: null,
      primary_contact_name: "Example Contact",
      primary_contact_phone: null,
      primary_contact_email: null,
      primary_contact_id: 202,
      category: null,
      notes: null,
      last_modified_iso: "2026-03-13T00:00:00.000Z",
      search_text: "example company",
      address_key: "123 main st||toronto|on|m5h 2n2|ca",
      payload_json: JSON.stringify({
        companyPhone: "905-555-0100",
        companyPhoneSource: "account",
        lastCalledAt: "2026-04-12T16:30:00.000Z",
        lastCalendarInvitedAt: "2026-04-13T10:00:00.000Z",
      }),
      updated_at: "2026-03-13T00:00:00.000Z",
    });

    ensureReadModelSchema(db);

    const columns = db.prepare("PRAGMA table_info(account_rows)").all() as Array<{
      name: string;
    }>;
    const indexes = db.prepare("PRAGMA index_list(account_rows)").all() as Array<{
      name: string;
    }>;
    const row = db
      .prepare(
        `
        SELECT
          company_phone,
          company_phone_source,
          last_called_at,
          last_calendar_invited_at
        FROM account_rows
        WHERE row_key = ?
        `,
      )
      .get("account-1:contact:202") as
      | {
          company_phone: string | null;
          company_phone_source: string | null;
          last_called_at: string | null;
          last_calendar_invited_at: string | null;
        }
      | undefined;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["last_called_at", "last_calendar_invited_at"]),
    );
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "idx_account_rows_last_called_at",
        "idx_account_rows_last_calendar_invited_at",
      ]),
    );
    expect(row).toEqual({
      company_phone: "905-555-0100",
      company_phone_source: "account",
      last_called_at: "2026-04-12T16:30:00.000Z",
      last_calendar_invited_at: "2026-04-13T10:00:00.000Z",
    });
  });

  it("creates the contact_identity_notes table", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(contact_identity_notes)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "identity_key",
        "company_name",
        "contact_name",
        "notes",
        "source_row_key",
        "source_contact_id",
        "updated_by",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("adds account_local_metadata marketing eligibility column to legacy tables", () => {
    db.exec(`
      DROP TABLE IF EXISTS account_local_metadata;
      CREATE TABLE account_local_metadata (
        account_record_id TEXT PRIMARY KEY,
        business_account_id TEXT,
        company_description TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(account_local_metadata)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toContain("marketing_eligible");
  });

  it("adds account_local_metadata category column to legacy tables", () => {
    db.exec(`
      DROP TABLE IF EXISTS account_local_metadata;
      CREATE TABLE account_local_metadata (
        account_record_id TEXT PRIMARY KEY,
        business_account_id TEXT,
        company_description TEXT,
        marketing_eligible INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);

    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(account_local_metadata)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toContain("category");
  });

  it("creates the rich employee_directory columns", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(employee_directory)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "employee_id",
        "name",
        "login_name",
        "email",
        "contact_id",
        "normalized_phone",
        "is_active",
        "sort_name",
        "source",
        "updated_at",
      ]),
    );
  });

  it("creates the sales_rep_directory table", () => {
    ensureReadModelSchema(db);

    const columns = db
      .prepare("PRAGMA table_info(sales_rep_directory)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "employee_id",
        "display_name",
        "normalized_name",
        "usage_count",
        "owner_reference_id",
        "login_name",
        "email",
        "is_active",
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

  it("creates the call_sessions active lookup index", () => {
    ensureReadModelSchema(db);

    const indexes = db.prepare("PRAGMA index_list(call_sessions)").all() as Array<{
      name: string;
    }>;

    expect(indexes.map((index) => index.name)).toContain("idx_call_sessions_ended_at_outcome");
  });
});
