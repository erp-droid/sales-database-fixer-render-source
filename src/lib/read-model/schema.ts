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

CREATE INDEX IF NOT EXISTS idx_account_rows_account_record_id
  ON account_rows(account_record_id);
CREATE INDEX IF NOT EXISTS idx_account_rows_business_account_id
  ON account_rows(business_account_id);
CREATE INDEX IF NOT EXISTS idx_account_rows_contact_id
  ON account_rows(contact_id);
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
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_local_metadata_business_account_id
  ON account_local_metadata(business_account_id);

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
CREATE INDEX IF NOT EXISTS idx_call_sessions_matched_business_account_id
  ON call_sessions(matched_business_account_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_target_phone
  ON call_sessions(target_phone);

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
`;

export function ensureReadModelSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);

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
