import type Database from "better-sqlite3";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS account_rows (
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
  last_called_at TEXT,
  last_calendar_invited_at TEXT,
  last_modified_iso TEXT,
  search_text TEXT NOT NULL,
  address_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_rows_account_record_id
  ON account_rows(account_record_id);
CREATE INDEX IF NOT EXISTS idx_account_rows_business_account_id
  ON account_rows(business_account_id);
CREATE INDEX IF NOT EXISTS idx_account_rows_contact_id
  ON account_rows(contact_id);
CREATE INDEX IF NOT EXISTS idx_account_rows_primary_contact_id
  ON account_rows(primary_contact_id);
CREATE INDEX IF NOT EXISTS idx_account_rows_company_name
  ON account_rows(company_name);
CREATE INDEX IF NOT EXISTS idx_account_rows_sales_rep_name
  ON account_rows(sales_rep_name);
CREATE INDEX IF NOT EXISTS idx_account_rows_address_key
  ON account_rows(address_key);

CREATE TABLE IF NOT EXISTS account_local_metadata (
  account_record_id TEXT PRIMARY KEY,
  business_account_id TEXT,
  company_description TEXT,
  category TEXT,
  marketing_eligible INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_local_metadata_business_account_id
  ON account_local_metadata(business_account_id);

CREATE TABLE IF NOT EXISTS account_route_weeks (
  account_record_id TEXT PRIMARY KEY,
  business_account_id TEXT,
  sales_rep_id TEXT,
  sales_rep_name TEXT,
  category TEXT,
  route_week INTEGER NOT NULL CHECK(route_week BETWEEN 1 AND 12),
  route_week_label TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  assignment_version TEXT NOT NULL,
  assignment_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_route_weeks_business_account_id
  ON account_route_weeks(business_account_id);
CREATE INDEX IF NOT EXISTS idx_account_route_weeks_sales_rep_name
  ON account_route_weeks(sales_rep_name);
CREATE INDEX IF NOT EXISTS idx_account_route_weeks_route_week
  ON account_route_weeks(route_week);

CREATE TABLE IF NOT EXISTS contact_identity_notes (
  identity_key TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  notes TEXT,
  source_row_key TEXT,
  source_contact_id INTEGER,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_identity_notes_company_contact
  ON contact_identity_notes(company_name, contact_name);
CREATE INDEX IF NOT EXISTS idx_contact_identity_notes_updated_at
  ON contact_identity_notes(updated_at);

CREATE TABLE IF NOT EXISTS account_filter_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('user', 'company')),
  owner_login_name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_filter_lists_scope
  ON account_filter_lists(scope);
CREATE INDEX IF NOT EXISTS idx_account_filter_lists_owner
  ON account_filter_lists(owner_login_name);
CREATE INDEX IF NOT EXISTS idx_account_filter_lists_updated_at
  ON account_filter_lists(updated_at);

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

CREATE TABLE IF NOT EXISTS employee_directory (
  employee_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login_name TEXT,
  email TEXT,
  contact_id INTEGER,
  normalized_phone TEXT,
  is_active INTEGER,
  sort_name TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_rep_directory (
  employee_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  usage_count INTEGER NOT NULL,
  owner_reference_id TEXT,
  login_name TEXT,
  email TEXT,
  is_active INTEGER,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_rep_directory_normalized_name
  ON sales_rep_directory(normalized_name);

CREATE TABLE IF NOT EXISTS address_geocodes (
  address_key TEXT PRIMARY KEY,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  provider TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  last_attempted_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  scope TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  last_successful_sync_at TEXT,
  last_error TEXT,
  rows_count INTEGER NOT NULL,
  accounts_count INTEGER NOT NULL,
  contacts_count INTEGER NOT NULL,
  phase TEXT,
  progress_json TEXT
);

CREATE TABLE IF NOT EXISTS call_employee_directory (
  login_name TEXT PRIMARY KEY,
  contact_id INTEGER,
  display_name TEXT NOT NULL,
  email TEXT,
  normalized_phone TEXT,
  caller_id_phone TEXT,
  is_active INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_employee_directory_normalized_phone
  ON call_employee_directory(normalized_phone);
CREATE INDEX IF NOT EXISTS idx_call_employee_directory_caller_id_phone
  ON call_employee_directory(caller_id_phone);

CREATE TABLE IF NOT EXISTS caller_phone_overrides (
  login_name TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_caller_phone_overrides_updated_at
  ON caller_phone_overrides(updated_at);

CREATE TABLE IF NOT EXISTS caller_identity_profiles (
  login_name TEXT PRIMARY KEY,
  employee_id TEXT,
  contact_id INTEGER,
  display_name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_caller_identity_profiles_employee_id
  ON caller_identity_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_caller_identity_profiles_phone_number
  ON caller_identity_profiles(phone_number);

CREATE TABLE IF NOT EXISTS caller_id_verifications (
  login_name TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  validation_code TEXT,
  call_sid TEXT,
  status TEXT NOT NULL,
  failure_message TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_caller_id_verifications_phone_number
  ON caller_id_verifications(phone_number);

CREATE TABLE IF NOT EXISTS call_legs (
  sid TEXT PRIMARY KEY,
  parent_sid TEXT,
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_number TEXT,
  to_number TEXT,
  status TEXT,
  answered INTEGER NOT NULL,
  answered_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  ring_duration_seconds INTEGER,
  price TEXT,
  price_unit TEXT,
  source TEXT NOT NULL,
  leg_type TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_legs_parent_sid
  ON call_legs(parent_sid);
CREATE INDEX IF NOT EXISTS idx_call_legs_session_id
  ON call_legs(session_id);
CREATE INDEX IF NOT EXISTS idx_call_legs_started_at
  ON call_legs(started_at);
CREATE INDEX IF NOT EXISTS idx_call_legs_from_number
  ON call_legs(from_number);
CREATE INDEX IF NOT EXISTS idx_call_legs_to_number
  ON call_legs(to_number);

CREATE TABLE IF NOT EXISTS call_sessions (
  session_id TEXT PRIMARY KEY,
  root_call_sid TEXT NOT NULL,
  primary_leg_sid TEXT,
  source TEXT NOT NULL,
  direction TEXT NOT NULL,
  outcome TEXT NOT NULL,
  answered INTEGER NOT NULL,
  started_at TEXT,
  answered_at TEXT,
  ended_at TEXT,
  talk_duration_seconds INTEGER,
  ring_duration_seconds INTEGER,
  employee_login_name TEXT,
  employee_display_name TEXT,
  employee_contact_id INTEGER,
  employee_phone TEXT,
  recipient_employee_login_name TEXT,
  recipient_employee_display_name TEXT,
  presented_caller_id TEXT,
  bridge_number TEXT,
  target_phone TEXT,
  counterparty_phone TEXT,
  matched_contact_id INTEGER,
  matched_contact_name TEXT,
  matched_business_account_id TEXT,
  matched_company_name TEXT,
  phone_match_type TEXT,
  phone_match_ambiguity_count INTEGER NOT NULL,
  initiated_from_surface TEXT,
  linked_account_row_key TEXT,
  linked_business_account_id TEXT,
  linked_contact_id INTEGER,
  metadata_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_started_at
  ON call_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_call_sessions_employee_login_name
  ON call_sessions(employee_login_name);
CREATE INDEX IF NOT EXISTS idx_call_sessions_answered
  ON call_sessions(answered);
CREATE INDEX IF NOT EXISTS idx_call_sessions_outcome
  ON call_sessions(outcome);
CREATE INDEX IF NOT EXISTS idx_call_sessions_ended_at_outcome
  ON call_sessions(ended_at, outcome);
CREATE INDEX IF NOT EXISTS idx_call_sessions_matched_business_account_id
  ON call_sessions(matched_business_account_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_linked_business_account_id
  ON call_sessions(linked_business_account_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_linked_account_row_key
  ON call_sessions(linked_account_row_key);
CREATE INDEX IF NOT EXISTS idx_call_sessions_linked_contact_id
  ON call_sessions(linked_contact_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_matched_contact_id
  ON call_sessions(matched_contact_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_target_phone
  ON call_sessions(target_phone);
CREATE INDEX IF NOT EXISTS idx_call_sessions_counterparty_phone
  ON call_sessions(counterparty_phone);
CREATE INDEX IF NOT EXISTS idx_call_sessions_active_bridge_lookup
  ON call_sessions(source, employee_login_name, target_phone, COALESCE(started_at, updated_at) DESC, session_id DESC);

CREATE TABLE IF NOT EXISTS call_ingest_state (
  scope TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_recent_sync_at TEXT,
  last_full_backfill_at TEXT,
  latest_seen_start_time TEXT,
  oldest_seen_start_time TEXT,
  full_history_complete INTEGER NOT NULL,
  last_webhook_at TEXT,
  last_error TEXT,
  progress_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_activity_sync (
  session_id TEXT PRIMARY KEY,
  recording_sid TEXT UNIQUE,
  recording_status TEXT,
  recording_duration_seconds INTEGER,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  transcript_text TEXT,
  summary_text TEXT,
  activity_id TEXT,
  error_message TEXT,
  recording_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_activity_sync_status
  ON call_activity_sync(status);
CREATE INDEX IF NOT EXISTS idx_call_activity_sync_recording_sid
  ON call_activity_sync(recording_sid);

CREATE TABLE IF NOT EXISTS daily_call_coaching_reports (
  report_date TEXT NOT NULL,
  subject_login_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  sender_login_name TEXT NOT NULL,
  status TEXT NOT NULL,
  preview_mode INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  analyzed_call_count INTEGER NOT NULL DEFAULT 0,
  transcript_call_count INTEGER NOT NULL DEFAULT 0,
  subject_line TEXT,
  report_json TEXT,
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (report_date, subject_login_name, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_daily_call_coaching_reports_sent_at
  ON daily_call_coaching_reports(sent_at);
CREATE INDEX IF NOT EXISTS idx_daily_call_coaching_reports_status
  ON daily_call_coaching_reports(status);

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_name TEXT NOT NULL,
  window_key TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_name, window_key)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_updated_at
  ON scheduled_job_runs(updated_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_status
  ON scheduled_job_runs(status);

CREATE TABLE IF NOT EXISTS meeting_bookings (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  actor_login_name TEXT,
  actor_name TEXT,
  business_account_record_id TEXT,
  business_account_id TEXT,
  company_name TEXT,
  related_contact_id INTEGER,
  related_contact_name TEXT,
  category TEXT,
  meeting_summary TEXT NOT NULL,
  private_notes TEXT,
  attendee_count INTEGER NOT NULL,
  attendee_details_json TEXT NOT NULL DEFAULT '[]',
  invite_authority TEXT,
  calendar_invite_status TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_bookings_event_id
  ON meeting_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_meeting_bookings_occurred_at
  ON meeting_bookings(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_bookings_actor_login_name
  ON meeting_bookings(actor_login_name);
CREATE INDEX IF NOT EXISTS idx_meeting_bookings_business_account_id
  ON meeting_bookings(business_account_id);

CREATE TABLE IF NOT EXISTS mail_send_jobs (
  id TEXT PRIMARY KEY,
  requested_by_login_name TEXT,
  requested_by_name TEXT,
  payload_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_status
  ON mail_send_jobs(status, updated_at, created_at);

CREATE TABLE IF NOT EXISTS user_auth_credentials (
  login_name TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_auth_credentials_updated_at
  ON user_auth_credentials(updated_at);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  login_name TEXT PRIMARY KEY,
  connected_google_email TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  encrypted_access_token TEXT,
  token_scope TEXT,
  access_token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_updated_at
  ON google_calendar_connections(updated_at);

CREATE TABLE IF NOT EXISTS deferred_actions (
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
  reason TEXT,
  payload_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  requested_by_login_name TEXT,
  requested_by_name TEXT,
  requested_at TEXT NOT NULL,
  execute_after_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_attempt_at TEXT,
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

CREATE INDEX IF NOT EXISTS idx_deferred_actions_status
  ON deferred_actions(status);
CREATE INDEX IF NOT EXISTS idx_deferred_actions_execute_after_at
  ON deferred_actions(execute_after_at);
CREATE INDEX IF NOT EXISTS idx_deferred_actions_account_record_id
  ON deferred_actions(business_account_record_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  item_type TEXT NOT NULL,
  action_group TEXT NOT NULL,
  result_code TEXT NOT NULL,
  actor_login_name TEXT,
  actor_name TEXT,
  source_surface TEXT,
  summary TEXT NOT NULL,
  business_account_record_id TEXT,
  business_account_id TEXT,
  company_name TEXT,
  contact_id INTEGER,
  contact_name TEXT,
  phone_number TEXT,
  email_subject TEXT,
  email_thread_id TEXT,
  email_message_id TEXT,
  call_session_id TEXT,
  call_direction TEXT,
  activity_sync_status TEXT,
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_item_type
  ON audit_events(item_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_group
  ON audit_events(action_group);
CREATE INDEX IF NOT EXISTS idx_audit_events_result_code
  ON audit_events(result_code);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_login_name
  ON audit_events(actor_login_name);
CREATE INDEX IF NOT EXISTS idx_audit_events_account_record_id
  ON audit_events(business_account_record_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_contact_id
  ON audit_events(contact_id);

CREATE TABLE IF NOT EXISTS audit_event_fields (
  audit_event_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  PRIMARY KEY (audit_event_id, field_key)
);

CREATE TABLE IF NOT EXISTS audit_event_links (
  audit_event_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  role TEXT NOT NULL,
  business_account_record_id TEXT,
  business_account_id TEXT,
  company_name TEXT,
  contact_id INTEGER,
  contact_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_event_links_account_record_id
  ON audit_event_links(business_account_record_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_links_contact_id
  ON audit_event_links(contact_id);

CREATE TABLE IF NOT EXISTS account_notes (
  id TEXT PRIMARY KEY,
  account_record_id TEXT NOT NULL,
  business_account_id TEXT,
  company_name TEXT,
  contact_id INTEGER,
  contact_name TEXT,
  note TEXT NOT NULL,
  author TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_notes_account
  ON account_notes(account_record_id, created_at);
`;

function readPayloadText(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function backfillAccountRowSupplementalColumns(db: Database.Database): void {
  const rows = db
    .prepare(
      `
      SELECT
        row_key,
        payload_json,
        company_phone,
        company_phone_source,
        last_called_at,
        last_calendar_invited_at
      FROM account_rows
      `,
    )
    .all() as Array<{
    row_key: string;
    payload_json: string;
    company_phone: string | null;
    company_phone_source: string | null;
    last_called_at: string | null;
    last_calendar_invited_at: string | null;
  }>;

  if (rows.length === 0) {
    return;
  }

  const update = db.prepare(
    `
    UPDATE account_rows
    SET company_phone = @company_phone,
        company_phone_source = @company_phone_source,
        last_called_at = @last_called_at,
        last_calendar_invited_at = @last_calendar_invited_at
    WHERE row_key = @row_key
    `,
  );

  const backfill = db.transaction(() => {
    for (const row of rows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }

      update.run({
        row_key: row.row_key,
        company_phone: readPayloadText(payload, "companyPhone") ?? row.company_phone,
        company_phone_source:
          readPayloadText(payload, "companyPhoneSource") ?? row.company_phone_source,
        last_called_at: readPayloadText(payload, "lastCalledAt") ?? row.last_called_at,
        last_calendar_invited_at:
          readPayloadText(payload, "lastCalendarInvitedAt") ??
          row.last_calendar_invited_at,
      });
    }
  });

  backfill();
}

type LegacyColumnMigration = {
  name: string;
  definition: string;
};

type LegacyTableMigration = {
  tableName: string;
  columns: LegacyColumnMigration[];
};

const SAFE_SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const LEGACY_TABLE_MIGRATIONS: LegacyTableMigration[] = [
  {
    tableName: "account_notes",
    columns: [
      { name: "account_record_id", definition: "account_record_id TEXT NOT NULL DEFAULT ''" },
      { name: "business_account_id", definition: "business_account_id TEXT" },
      { name: "company_name", definition: "company_name TEXT" },
      { name: "contact_id", definition: "contact_id INTEGER" },
      { name: "contact_name", definition: "contact_name TEXT" },
      { name: "note", definition: "note TEXT NOT NULL DEFAULT ''" },
      { name: "author", definition: "author TEXT" },
      { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
      { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    tableName: "call_sessions",
    columns: [
      { name: "root_call_sid", definition: "root_call_sid TEXT NOT NULL DEFAULT ''" },
      { name: "primary_leg_sid", definition: "primary_leg_sid TEXT" },
      { name: "source", definition: "source TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "direction", definition: "direction TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "outcome", definition: "outcome TEXT NOT NULL DEFAULT 'unknown'" },
      { name: "answered", definition: "answered INTEGER NOT NULL DEFAULT 0" },
      { name: "started_at", definition: "started_at TEXT" },
      { name: "answered_at", definition: "answered_at TEXT" },
      { name: "ended_at", definition: "ended_at TEXT" },
      { name: "talk_duration_seconds", definition: "talk_duration_seconds INTEGER" },
      { name: "ring_duration_seconds", definition: "ring_duration_seconds INTEGER" },
      { name: "employee_login_name", definition: "employee_login_name TEXT" },
      { name: "employee_display_name", definition: "employee_display_name TEXT" },
      { name: "employee_contact_id", definition: "employee_contact_id INTEGER" },
      { name: "employee_phone", definition: "employee_phone TEXT" },
      { name: "recipient_employee_login_name", definition: "recipient_employee_login_name TEXT" },
      { name: "recipient_employee_display_name", definition: "recipient_employee_display_name TEXT" },
      { name: "presented_caller_id", definition: "presented_caller_id TEXT" },
      { name: "bridge_number", definition: "bridge_number TEXT" },
      { name: "target_phone", definition: "target_phone TEXT" },
      { name: "counterparty_phone", definition: "counterparty_phone TEXT" },
      { name: "matched_contact_id", definition: "matched_contact_id INTEGER" },
      { name: "matched_contact_name", definition: "matched_contact_name TEXT" },
      { name: "matched_business_account_id", definition: "matched_business_account_id TEXT" },
      { name: "matched_company_name", definition: "matched_company_name TEXT" },
      { name: "phone_match_type", definition: "phone_match_type TEXT" },
      {
        name: "phone_match_ambiguity_count",
        definition: "phone_match_ambiguity_count INTEGER NOT NULL DEFAULT 0",
      },
      { name: "initiated_from_surface", definition: "initiated_from_surface TEXT" },
      { name: "linked_account_row_key", definition: "linked_account_row_key TEXT" },
      { name: "linked_business_account_id", definition: "linked_business_account_id TEXT" },
      { name: "linked_contact_id", definition: "linked_contact_id INTEGER" },
      { name: "metadata_json", definition: "metadata_json TEXT NOT NULL DEFAULT '{}'" },
      { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    tableName: "call_activity_sync",
    columns: [
      { name: "recording_sid", definition: "recording_sid TEXT" },
      { name: "recording_status", definition: "recording_status TEXT" },
      { name: "recording_duration_seconds", definition: "recording_duration_seconds INTEGER" },
      { name: "status", definition: "status TEXT NOT NULL DEFAULT 'queued'" },
      { name: "attempts", definition: "attempts INTEGER NOT NULL DEFAULT 0" },
      { name: "transcript_text", definition: "transcript_text TEXT" },
      { name: "summary_text", definition: "summary_text TEXT" },
      { name: "activity_id", definition: "activity_id TEXT" },
      { name: "error_message", definition: "error_message TEXT" },
      { name: "recording_deleted_at", definition: "recording_deleted_at TEXT" },
      { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
      { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    tableName: "audit_events",
    columns: [
      { name: "occurred_at", definition: "occurred_at TEXT NOT NULL DEFAULT ''" },
      { name: "item_type", definition: "item_type TEXT NOT NULL DEFAULT 'business_account'" },
      {
        name: "action_group",
        definition: "action_group TEXT NOT NULL DEFAULT 'business_account_update'",
      },
      { name: "result_code", definition: "result_code TEXT NOT NULL DEFAULT 'succeeded'" },
      { name: "actor_login_name", definition: "actor_login_name TEXT" },
      { name: "actor_name", definition: "actor_name TEXT" },
      { name: "source_surface", definition: "source_surface TEXT" },
      { name: "summary", definition: "summary TEXT NOT NULL DEFAULT ''" },
      { name: "business_account_record_id", definition: "business_account_record_id TEXT" },
      { name: "business_account_id", definition: "business_account_id TEXT" },
      { name: "company_name", definition: "company_name TEXT" },
      { name: "contact_id", definition: "contact_id INTEGER" },
      { name: "contact_name", definition: "contact_name TEXT" },
      { name: "phone_number", definition: "phone_number TEXT" },
      { name: "email_subject", definition: "email_subject TEXT" },
      { name: "email_thread_id", definition: "email_thread_id TEXT" },
      { name: "email_message_id", definition: "email_message_id TEXT" },
      { name: "call_session_id", definition: "call_session_id TEXT" },
      { name: "call_direction", definition: "call_direction TEXT" },
      { name: "activity_sync_status", definition: "activity_sync_status TEXT" },
      { name: "search_text", definition: "search_text TEXT NOT NULL DEFAULT ''" },
      { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
      { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    tableName: "audit_event_fields",
    columns: [
      { name: "audit_event_id", definition: "audit_event_id TEXT NOT NULL DEFAULT ''" },
      { name: "field_key", definition: "field_key TEXT NOT NULL DEFAULT ''" },
      { name: "field_label", definition: "field_label TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    tableName: "audit_event_links",
    columns: [
      { name: "audit_event_id", definition: "audit_event_id TEXT NOT NULL DEFAULT ''" },
      { name: "link_type", definition: "link_type TEXT NOT NULL DEFAULT 'business_account'" },
      { name: "role", definition: "role TEXT NOT NULL DEFAULT 'primary'" },
      { name: "business_account_record_id", definition: "business_account_record_id TEXT" },
      { name: "business_account_id", definition: "business_account_id TEXT" },
      { name: "company_name", definition: "company_name TEXT" },
      { name: "contact_id", definition: "contact_id INTEGER" },
      { name: "contact_name", definition: "contact_name TEXT" },
    ],
  },
  {
    tableName: "meeting_bookings",
    columns: [
      { name: "event_id", definition: "event_id TEXT NOT NULL DEFAULT ''" },
      { name: "actor_login_name", definition: "actor_login_name TEXT" },
      { name: "actor_name", definition: "actor_name TEXT" },
      { name: "business_account_record_id", definition: "business_account_record_id TEXT" },
      { name: "business_account_id", definition: "business_account_id TEXT" },
      { name: "company_name", definition: "company_name TEXT" },
      { name: "related_contact_id", definition: "related_contact_id INTEGER" },
      { name: "related_contact_name", definition: "related_contact_name TEXT" },
      { name: "category", definition: "category TEXT" },
      { name: "meeting_summary", definition: "meeting_summary TEXT NOT NULL DEFAULT ''" },
      { name: "private_notes", definition: "private_notes TEXT" },
      { name: "attendee_count", definition: "attendee_count INTEGER NOT NULL DEFAULT 0" },
      {
        name: "attendee_details_json",
        definition: "attendee_details_json TEXT NOT NULL DEFAULT '[]'",
      },
      { name: "invite_authority", definition: "invite_authority TEXT" },
      { name: "calendar_invite_status", definition: "calendar_invite_status TEXT" },
      { name: "occurred_at", definition: "occurred_at TEXT NOT NULL DEFAULT ''" },
      { name: "created_at", definition: "created_at TEXT NOT NULL DEFAULT ''" },
      { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    tableName: "deferred_actions",
    columns: [
      { name: "reason", definition: "reason TEXT" },
      { name: "attempt_count", definition: "attempt_count INTEGER NOT NULL DEFAULT 0" },
      { name: "max_attempts", definition: "max_attempts INTEGER NOT NULL DEFAULT 5" },
      { name: "last_attempt_at", definition: "last_attempt_at TEXT" },
    ],
  },
  {
    tableName: "call_ingest_state",
    columns: [
      { name: "status", definition: "status TEXT NOT NULL DEFAULT 'idle'" },
      { name: "last_recent_sync_at", definition: "last_recent_sync_at TEXT" },
      { name: "last_full_backfill_at", definition: "last_full_backfill_at TEXT" },
      { name: "latest_seen_start_time", definition: "latest_seen_start_time TEXT" },
      { name: "oldest_seen_start_time", definition: "oldest_seen_start_time TEXT" },
      { name: "full_history_complete", definition: "full_history_complete INTEGER NOT NULL DEFAULT 0" },
      { name: "last_webhook_at", definition: "last_webhook_at TEXT" },
      { name: "last_error", definition: "last_error TEXT" },
      { name: "progress_json", definition: "progress_json TEXT" },
      { name: "updated_at", definition: "updated_at TEXT NOT NULL DEFAULT ''" },
    ],
  },
  {
    tableName: "sync_state",
    columns: [
      { name: "status", definition: "status TEXT NOT NULL DEFAULT 'idle'" },
      { name: "started_at", definition: "started_at TEXT" },
      { name: "completed_at", definition: "completed_at TEXT" },
      { name: "last_successful_sync_at", definition: "last_successful_sync_at TEXT" },
      { name: "last_error", definition: "last_error TEXT" },
      { name: "rows_count", definition: "rows_count INTEGER NOT NULL DEFAULT 0" },
      { name: "accounts_count", definition: "accounts_count INTEGER NOT NULL DEFAULT 0" },
      { name: "contacts_count", definition: "contacts_count INTEGER NOT NULL DEFAULT 0" },
      { name: "phase", definition: "phase TEXT" },
      { name: "progress_json", definition: "progress_json TEXT" },
    ],
  },
];

function assertSafeSqlIdentifier(identifier: string): void {
  if (!SAFE_SQL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier '${identifier}'.`);
  }
}

function readExistingTableColumns(
  db: Database.Database,
  tableName: string,
): Set<string> | null {
  assertSafeSqlIdentifier(tableName);

  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  if (!table) {
    return null;
  }

  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function addMissingLegacyColumns(
  db: Database.Database,
  tableName: string,
  columns: LegacyColumnMigration[],
): void {
  const existingColumns = readExistingTableColumns(db, tableName);
  if (!existingColumns) {
    return;
  }

  for (const column of columns) {
    assertSafeSqlIdentifier(column.name);
    if (existingColumns.has(column.name)) {
      continue;
    }

    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.definition}`);
    existingColumns.add(column.name);
  }
}

function migrateLegacyReadModelTables(db: Database.Database): void {
  for (const migration of LEGACY_TABLE_MIGRATIONS) {
    addMissingLegacyColumns(db, migration.tableName, migration.columns);
  }
}

export function ensureReadModelSchema(db: Database.Database): void {
  migrateLegacyReadModelTables(db);
  db.exec(SCHEMA_SQL);

  const accountRowColumns = db
    .prepare("PRAGMA table_info(account_rows)")
    .all() as Array<{ name: string }>;
  const hasCompanyPhoneColumn = accountRowColumns.some(
    (column) => column.name === "company_phone",
  );
  if (!hasCompanyPhoneColumn) {
    db.exec("ALTER TABLE account_rows ADD COLUMN company_phone TEXT");
  }
  const hasCompanyPhoneSourceColumn = accountRowColumns.some(
    (column) => column.name === "company_phone_source",
  );
  if (!hasCompanyPhoneSourceColumn) {
    db.exec("ALTER TABLE account_rows ADD COLUMN company_phone_source TEXT");
  }
  const hasLastCalledAtColumn = accountRowColumns.some(
    (column) => column.name === "last_called_at",
  );
  if (!hasLastCalledAtColumn) {
    db.exec("ALTER TABLE account_rows ADD COLUMN last_called_at TEXT");
  }
  const hasLastCalendarInvitedAtColumn = accountRowColumns.some(
    (column) => column.name === "last_calendar_invited_at",
  );
  if (!hasLastCalendarInvitedAtColumn) {
    db.exec("ALTER TABLE account_rows ADD COLUMN last_calendar_invited_at TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_account_rows_company_phone ON account_rows(company_phone)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_account_rows_last_called_at ON account_rows(last_called_at)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_account_rows_last_calendar_invited_at ON account_rows(last_calendar_invited_at)",
  );
  backfillAccountRowSupplementalColumns(db);

  const accountNoteColumns = db
    .prepare("PRAGMA table_info(account_notes)")
    .all() as Array<{ name: string }>;
  const hasAccountNotesContactIdColumn = accountNoteColumns.some(
    (column) => column.name === "contact_id",
  );
  if (!hasAccountNotesContactIdColumn) {
    db.exec("ALTER TABLE account_notes ADD COLUMN contact_id INTEGER");
  }
  const hasAccountNotesContactNameColumn = accountNoteColumns.some(
    (column) => column.name === "contact_name",
  );
  if (!hasAccountNotesContactNameColumn) {
    db.exec("ALTER TABLE account_notes ADD COLUMN contact_name TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_account_notes_contact ON account_notes(account_record_id, contact_id)",
  );

  const accountLocalMetadataColumns = db
    .prepare("PRAGMA table_info(account_local_metadata)")
    .all() as Array<{ name: string }>;
  const hasMarketingEligibleColumn = accountLocalMetadataColumns.some(
    (column) => column.name === "marketing_eligible",
  );
  if (!hasMarketingEligibleColumn) {
    db.exec(
      "ALTER TABLE account_local_metadata ADD COLUMN marketing_eligible INTEGER NOT NULL DEFAULT 1",
    );
  }
  const hasCategoryColumn = accountLocalMetadataColumns.some(
    (column) => column.name === "category",
  );
  if (!hasCategoryColumn) {
    db.exec("ALTER TABLE account_local_metadata ADD COLUMN category TEXT");
  }
  db.prepare(
    `
    UPDATE account_local_metadata
    SET marketing_eligible = 1
    WHERE marketing_eligible IS NULL
    `,
  ).run();

  const employeeDirectoryColumns = db
    .prepare("PRAGMA table_info(employee_directory)")
    .all() as Array<{ name: string }>;
  const hasEmployeeLoginNameColumn = employeeDirectoryColumns.some(
    (column) => column.name === "login_name",
  );
  if (!hasEmployeeLoginNameColumn) {
    db.exec("ALTER TABLE employee_directory ADD COLUMN login_name TEXT");
  }
  const hasEmployeeEmailColumn = employeeDirectoryColumns.some(
    (column) => column.name === "email",
  );
  if (!hasEmployeeEmailColumn) {
    db.exec("ALTER TABLE employee_directory ADD COLUMN email TEXT");
  }
  const hasEmployeeContactIdColumn = employeeDirectoryColumns.some(
    (column) => column.name === "contact_id",
  );
  if (!hasEmployeeContactIdColumn) {
    db.exec("ALTER TABLE employee_directory ADD COLUMN contact_id INTEGER");
  }
  const hasEmployeeNormalizedPhoneColumn = employeeDirectoryColumns.some(
    (column) => column.name === "normalized_phone",
  );
  if (!hasEmployeeNormalizedPhoneColumn) {
    db.exec("ALTER TABLE employee_directory ADD COLUMN normalized_phone TEXT");
  }
  const hasEmployeeIsActiveColumn = employeeDirectoryColumns.some(
    (column) => column.name === "is_active",
  );
  if (!hasEmployeeIsActiveColumn) {
    db.exec("ALTER TABLE employee_directory ADD COLUMN is_active INTEGER");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_employee_directory_login_name ON employee_directory(login_name)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_employee_directory_email ON employee_directory(email)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_sales_rep_directory_normalized_name ON sales_rep_directory(normalized_name)",
  );
  const salesRepDirectoryColumns = db
    .prepare("PRAGMA table_info(sales_rep_directory)")
    .all() as Array<{ name: string }>;
  const hasSalesRepOwnerReferenceIdColumn = salesRepDirectoryColumns.some(
    (column) => column.name === "owner_reference_id",
  );
  if (!hasSalesRepOwnerReferenceIdColumn) {
    db.exec("ALTER TABLE sales_rep_directory ADD COLUMN owner_reference_id TEXT");
  }
  const hasSalesRepLoginNameColumn = salesRepDirectoryColumns.some(
    (column) => column.name === "login_name",
  );
  if (!hasSalesRepLoginNameColumn) {
    db.exec("ALTER TABLE sales_rep_directory ADD COLUMN login_name TEXT");
  }
  const hasSalesRepEmailColumn = salesRepDirectoryColumns.some(
    (column) => column.name === "email",
  );
  if (!hasSalesRepEmailColumn) {
    db.exec("ALTER TABLE sales_rep_directory ADD COLUMN email TEXT");
  }
  const hasSalesRepIsActiveColumn = salesRepDirectoryColumns.some(
    (column) => column.name === "is_active",
  );
  if (!hasSalesRepIsActiveColumn) {
    db.exec("ALTER TABLE sales_rep_directory ADD COLUMN is_active INTEGER");
  }

  const deferredActionColumns = db
    .prepare("PRAGMA table_info(deferred_actions)")
    .all() as Array<{ name: string }>;
  const hasReasonColumn = deferredActionColumns.some((column) => column.name === "reason");
  if (!hasReasonColumn) {
    db.exec("ALTER TABLE deferred_actions ADD COLUMN reason TEXT");
  }
  const hasAttemptCountColumn = deferredActionColumns.some(
    (column) => column.name === "attempt_count",
  );
  if (!hasAttemptCountColumn) {
    db.exec(
      "ALTER TABLE deferred_actions ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
    );
  }
  const hasMaxAttemptsColumn = deferredActionColumns.some(
    (column) => column.name === "max_attempts",
  );
  if (!hasMaxAttemptsColumn) {
    db.exec(
      "ALTER TABLE deferred_actions ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 5",
    );
  }
  const hasLastAttemptAtColumn = deferredActionColumns.some(
    (column) => column.name === "last_attempt_at",
  );
  if (!hasLastAttemptAtColumn) {
    db.exec("ALTER TABLE deferred_actions ADD COLUMN last_attempt_at TEXT");
  }

  const meetingBookingColumns = db
    .prepare("PRAGMA table_info(meeting_bookings)")
    .all() as Array<{ name: string }>;
  const hasMeetingAttendeeDetailsColumn = meetingBookingColumns.some(
    (column) => column.name === "attendee_details_json",
  );
  if (!hasMeetingAttendeeDetailsColumn) {
    db.exec(
      "ALTER TABLE meeting_bookings ADD COLUMN attendee_details_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  const hasMeetingCategoryColumn = meetingBookingColumns.some(
    (column) => column.name === "category",
  );
  if (!hasMeetingCategoryColumn) {
    db.exec("ALTER TABLE meeting_bookings ADD COLUMN category TEXT");
  }
  const hasMeetingPrivateNotesColumn = meetingBookingColumns.some(
    (column) => column.name === "private_notes",
  );
  if (!hasMeetingPrivateNotesColumn) {
    db.exec("ALTER TABLE meeting_bookings ADD COLUMN private_notes TEXT");
  }

  const callerIdentityProfileColumns = db
    .prepare("PRAGMA table_info(caller_identity_profiles)")
    .all() as Array<{ name: string }>;
  const hasCallerIdentityEmployeeIdColumn = callerIdentityProfileColumns.some(
    (column) => column.name === "employee_id",
  );
  if (!hasCallerIdentityEmployeeIdColumn) {
    db.exec("ALTER TABLE caller_identity_profiles ADD COLUMN employee_id TEXT");
  }
  const hasCallerIdentityContactIdColumn = callerIdentityProfileColumns.some(
    (column) => column.name === "contact_id",
  );
  if (!hasCallerIdentityContactIdColumn) {
    db.exec("ALTER TABLE caller_identity_profiles ADD COLUMN contact_id INTEGER");
  }
  const hasCallerIdentityDisplayNameColumn = callerIdentityProfileColumns.some(
    (column) => column.name === "display_name",
  );
  if (!hasCallerIdentityDisplayNameColumn) {
    db.exec(
      "ALTER TABLE caller_identity_profiles ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    );
  }
  const hasCallerIdentityEmailColumn = callerIdentityProfileColumns.some(
    (column) => column.name === "email",
  );
  if (!hasCallerIdentityEmailColumn) {
    db.exec("ALTER TABLE caller_identity_profiles ADD COLUMN email TEXT");
  }
  const hasCallerIdentityPhoneColumn = callerIdentityProfileColumns.some(
    (column) => column.name === "phone_number",
  );
  if (!hasCallerIdentityPhoneColumn) {
    db.exec("ALTER TABLE caller_identity_profiles ADD COLUMN phone_number TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_caller_identity_profiles_employee_id ON caller_identity_profiles(employee_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_caller_identity_profiles_phone_number ON caller_identity_profiles(phone_number)",
  );

  db.prepare(
    `
    INSERT INTO sync_state (
      scope,
      status,
      started_at,
      completed_at,
      last_successful_sync_at,
      last_error,
      rows_count,
      accounts_count,
      contacts_count,
      phase,
      progress_json
    )
    VALUES ('full', 'idle', NULL, NULL, NULL, NULL, 0, 0, 0, NULL, NULL)
    ON CONFLICT(scope) DO NOTHING
    `,
  ).run();

  db.prepare(
    `
    INSERT INTO call_ingest_state (
      scope,
      status,
      last_recent_sync_at,
      last_full_backfill_at,
      latest_seen_start_time,
      oldest_seen_start_time,
      full_history_complete,
      last_webhook_at,
      last_error,
      progress_json,
      updated_at
    )
    VALUES ('voice', 'idle', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(scope) DO NOTHING
    `,
  ).run();
}
