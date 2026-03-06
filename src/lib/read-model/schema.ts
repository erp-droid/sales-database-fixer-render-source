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

CREATE TABLE IF NOT EXISTS employee_directory (
  employee_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_name TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
`;

export function ensureReadModelSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);

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
}
