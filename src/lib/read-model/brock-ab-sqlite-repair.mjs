import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const REPAIR_KEY = "brock_ab_existing_accounts";
const REPAIR_VERSION = "2026-05-14-v1";
const TARGET_SALES_REP_ID = "124894";
const TARGET_SALES_REP_NAME = "Brock Koczka";

function readFeatureEnabled(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function resolveDatabasePath(inputPath = process.env.READ_MODEL_SQLITE_PATH || "./data/read-model.sqlite") {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  return path.join(process.cwd(), inputPath);
}

function readRepairSpecs() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(moduleDir, "brock-ab-existing-repairs.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildBackupPath(sqlitePath) {
  const parsed = path.parse(sqlitePath);
  return path.join(parsed.dir, `${parsed.name}.${REPAIR_KEY}.${REPAIR_VERSION}.backup${parsed.ext || ".sqlite"}`);
}

function buildAddress(row) {
  const parts = [
    normalizeText(row.addressLine1),
    normalizeText(row.addressLine2),
    normalizeText(row.city),
    normalizeText(row.state),
    normalizeText(row.postalCode),
    normalizeText(row.country),
  ].filter((value) => value.length > 0);

  return parts.join(", ");
}

function buildAddressKey(row) {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .join("|");
}

function buildSearchText(row) {
  return [
    row.companyName,
    row.businessAccountId,
    row.accountType,
    row.opportunityCount !== null && row.opportunityCount !== undefined
      ? String(row.opportunityCount)
      : null,
    row.address,
    row.phoneNumber,
    row.primaryContactName,
    row.primaryContactEmail,
    row.primaryContactPhone,
    row.salesRepName,
    row.industryType,
    row.subCategory,
    row.companyRegion,
    row.week,
    row.companyDescription,
    row.notes,
    row.category,
    row.lastCalledAt,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function parseStoredRow(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function buildPatchedRow(row, repair) {
  const accountRecordId =
    normalizeNullableText(row.accountRecordId) ??
    normalizeNullableText(row.id) ??
    normalizeNullableText(repair.accountRecordId);
  const businessAccountId =
    normalizeNullableText(row.businessAccountId) ??
    normalizeNullableText(repair.businessAccountId);
  const addressLine1 =
    normalizeNullableText(row.addressLine1) ??
    normalizeNullableText(repair.sourceAddressLine1) ??
    "";
  const city =
    normalizeNullableText(row.city) ??
    normalizeNullableText(repair.sourceCity) ??
    "";
  const postalCode =
    normalizeNullableText(row.postalCode) ??
    normalizeNullableText(repair.sourcePostalCode) ??
    "";

  const nextRow = {
    ...row,
    id: normalizeNullableText(row.id) ?? accountRecordId ?? businessAccountId,
    accountRecordId,
    businessAccountId,
    companyName: normalizeNullableText(row.companyName) ?? repair.companyName,
    addressLine1,
    addressLine2: normalizeNullableText(row.addressLine2) ?? "",
    city,
    state: normalizeNullableText(row.state) ?? "",
    postalCode,
    country: normalizeNullableText(row.country) ?? "CA",
    salesRepId: TARGET_SALES_REP_ID,
    salesRepName: TARGET_SALES_REP_NAME,
    category: normalizeNullableText(repair.sourceCategory) ?? normalizeNullableText(row.category),
    week: normalizeNullableText(repair.sourceWeek) ?? normalizeNullableText(row.week),
  };

  nextRow.address = buildAddress(nextRow);
  return nextRow;
}

function ensureRepairStateTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS read_model_repairs (
      repair_key TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    )
  `);
}

function ensureAccountLocalMetadataColumns(db) {
  const columns = db
    .prepare("PRAGMA table_info(account_local_metadata)")
    .all()
    .map((column) => String(column.name || "").trim().toLowerCase());

  if (!columns.includes("category")) {
    db.exec("ALTER TABLE account_local_metadata ADD COLUMN category TEXT");
  }

  const rows = db
    .prepare(
      `
      SELECT account_record_id, category
      FROM account_local_metadata
      WHERE category IS NOT NULL
      `,
    )
    .all();

  if (rows.length === 0) {
    return;
  }

  const normalizeCategory = db.prepare(
    `
    UPDATE account_local_metadata
    SET category = UPPER(TRIM(category))
    WHERE account_record_id = ?
    `,
  );

  for (const row of rows) {
    const accountRecordId = normalizeNullableText(row.account_record_id);
    if (!accountRecordId) {
      continue;
    }
    normalizeCategory.run(accountRecordId);
  }
}

function readRepairState(db) {
  return (
    db
      .prepare(
        `
        SELECT version, applied_at, details_json
        FROM read_model_repairs
        WHERE repair_key = ?
        `,
      )
      .get(REPAIR_KEY) ?? null
  );
}

function upsertCategoryMetadata(db, repair, nowIso) {
  const accountRecordId = normalizeNullableText(repair.accountRecordId);
  if (!accountRecordId) {
    return;
  }

  const category = normalizeNullableText(repair.sourceCategory);
  if (!category) {
    return;
  }

  const existing =
    db
      .prepare(
        `
        SELECT company_description, marketing_eligible
        FROM account_local_metadata
        WHERE account_record_id = ?
        `,
      )
      .get(accountRecordId) ?? null;

  db.prepare(
    `
    INSERT INTO account_local_metadata (
      account_record_id,
      business_account_id,
      company_description,
      category,
      marketing_eligible,
      updated_at
    ) VALUES (
      @account_record_id,
      @business_account_id,
      @company_description,
      @category,
      @marketing_eligible,
      @updated_at
    )
    ON CONFLICT(account_record_id) DO UPDATE SET
      business_account_id = excluded.business_account_id,
      company_description = excluded.company_description,
      category = excluded.category,
      marketing_eligible = excluded.marketing_eligible,
      updated_at = excluded.updated_at
    `,
  ).run({
    account_record_id: accountRecordId,
    business_account_id: normalizeNullableText(repair.businessAccountId),
    company_description:
      normalizeNullableText(existing?.company_description) ?? null,
    category,
    marketing_eligible: Number(existing?.marketing_eligible ?? 1) === 0 ? 0 : 1,
    updated_at: nowIso,
  });
}

function rebuildSalesRepDirectory(db, nowIso) {
  db.prepare("DELETE FROM sales_rep_directory").run();
  db.prepare(
    `
    INSERT INTO sales_rep_directory (
      employee_id,
      display_name,
      normalized_name,
      usage_count,
      owner_reference_id,
      login_name,
      email,
      is_active,
      updated_at
    )
    SELECT
      TRIM(sales_rep_id) AS employee_id,
      TRIM(sales_rep_name) AS display_name,
      LOWER(TRIM(sales_rep_name)) AS normalized_name,
      COUNT(*) AS usage_count,
      TRIM(sales_rep_id) AS owner_reference_id,
      NULL AS login_name,
      NULL AS email,
      NULL AS is_active,
      ? AS updated_at
    FROM account_rows
    WHERE sales_rep_id IS NOT NULL
      AND TRIM(sales_rep_id) <> ''
      AND sales_rep_name IS NOT NULL
      AND TRIM(sales_rep_name) <> ''
    GROUP BY TRIM(sales_rep_id), TRIM(sales_rep_name)
    ORDER BY LOWER(TRIM(sales_rep_name)) ASC, usage_count DESC, employee_id ASC
    `,
  ).run(nowIso);
}

function insertAccountRow(db, row, nowIso) {
  const rowKey =
    normalizeNullableText(row.rowKey) ??
    `${normalizeNullableText(row.accountRecordId) ?? normalizeNullableText(row.id) ?? normalizeNullableText(row.businessAccountId) ?? "row"}:contact:${row.contactId ?? "row"}`;
  const payloadRow = {
    ...row,
    rowKey,
  };

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
    row_key: rowKey,
    id: normalizeNullableText(payloadRow.id),
    account_record_id: normalizeNullableText(payloadRow.accountRecordId),
    business_account_id: normalizeNullableText(payloadRow.businessAccountId),
    contact_id: payloadRow.contactId ?? null,
    is_primary_contact: payloadRow.isPrimaryContact ? 1 : 0,
    company_name: normalizeNullableText(payloadRow.companyName) ?? "",
    address: normalizeNullableText(payloadRow.address) ?? "",
    address_line1: normalizeNullableText(payloadRow.addressLine1) ?? "",
    address_line2: normalizeNullableText(payloadRow.addressLine2) ?? "",
    city: normalizeNullableText(payloadRow.city) ?? "",
    state: normalizeNullableText(payloadRow.state) ?? "",
    postal_code: normalizeNullableText(payloadRow.postalCode) ?? "",
    country: normalizeNullableText(payloadRow.country) ?? "",
    phone_number: normalizeNullableText(payloadRow.phoneNumber),
    company_phone: normalizeNullableText(payloadRow.companyPhone),
    company_phone_source: normalizeNullableText(payloadRow.companyPhoneSource),
    sales_rep_id: normalizeNullableText(payloadRow.salesRepId),
    sales_rep_name: normalizeNullableText(payloadRow.salesRepName),
    industry_type: normalizeNullableText(payloadRow.industryType),
    sub_category: normalizeNullableText(payloadRow.subCategory),
    company_region: normalizeNullableText(payloadRow.companyRegion),
    week: normalizeNullableText(payloadRow.week),
    primary_contact_name: normalizeNullableText(payloadRow.primaryContactName),
    primary_contact_phone: normalizeNullableText(payloadRow.primaryContactPhone),
    primary_contact_email: normalizeNullableText(payloadRow.primaryContactEmail),
    primary_contact_id: payloadRow.primaryContactId ?? null,
    category: normalizeNullableText(payloadRow.category),
    notes: normalizeNullableText(payloadRow.notes),
    last_modified_iso: normalizeNullableText(payloadRow.lastModifiedIso),
    search_text: buildSearchText(payloadRow),
    address_key: buildAddressKey(payloadRow),
    payload_json: JSON.stringify(payloadRow),
    updated_at: nowIso,
  });
}

export async function applyBrockAbSqliteRepair(options = {}) {
  const enabled = readFeatureEnabled(
    options.enabled ?? process.env.BROCK_AB_SQLITE_REPAIR_ENABLED,
    process.env.NODE_ENV === "production",
  );
  if (!enabled) {
    return {
      enabled: false,
      status: "disabled",
      repairKey: REPAIR_KEY,
      repairVersion: REPAIR_VERSION,
    };
  }

  const sqlitePath = resolveDatabasePath(options.sqlitePath);
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  ensureRepairStateTable(db);
  ensureAccountLocalMetadataColumns(db);
  const existingState = readRepairState(db);
  if (existingState?.version === REPAIR_VERSION) {
    db.close();
    return {
      enabled: true,
      status: "already_applied",
      repairKey: REPAIR_KEY,
      repairVersion: REPAIR_VERSION,
      sqlitePath,
      appliedAt: existingState.applied_at,
    };
  }

  const repairSpecs = readRepairSpecs();
  const backupPath = buildBackupPath(sqlitePath);
  const selectRows = db.prepare(
    `
    SELECT payload_json
    FROM account_rows
    WHERE account_record_id = ?
       OR business_account_id = ?
    ORDER BY company_name COLLATE NOCASE ASC, row_key ASC
    `,
  );
  const deleteRows = db.prepare(
    `
    DELETE FROM account_rows
    WHERE account_record_id = ?
       OR business_account_id = ?
    `,
  );
  const upsertRepairState = db.prepare(
    `
    INSERT INTO read_model_repairs (
      repair_key,
      version,
      applied_at,
      details_json
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(repair_key) DO UPDATE SET
      version = excluded.version,
      applied_at = excluded.applied_at,
      details_json = excluded.details_json
    `,
  );

  const summary = {
    enabled: true,
    status: "applied",
    repairKey: REPAIR_KEY,
    repairVersion: REPAIR_VERSION,
    sqlitePath,
    backupPath,
    totalSpecs: repairSpecs.length,
    matchedAccounts: 0,
    patchedRows: 0,
    metadataUpserts: 0,
    missingAccounts: [],
    appliedAt: null,
  };

  try {
    if (!fs.existsSync(backupPath)) {
      await db.backup(backupPath);
    }

    const transaction = db.transaction(() => {
      const nowIso = new Date().toISOString();
      summary.appliedAt = nowIso;

      for (const repair of repairSpecs) {
        const accountRecordId = normalizeNullableText(repair.accountRecordId) ?? "";
        const businessAccountId = normalizeNullableText(repair.businessAccountId) ?? "";
        const storedRows = selectRows
          .all(accountRecordId, businessAccountId)
          .map((entry) => parseStoredRow(entry.payload_json))
          .filter((row) => row !== null);

        if (storedRows.length === 0) {
          summary.missingAccounts.push({
            accountRecordId,
            businessAccountId,
            companyName: repair.companyName,
          });
          continue;
        }

        const nextRows = storedRows.map((row) => buildPatchedRow(row, repair));
        deleteRows.run(accountRecordId, businessAccountId);
        for (const row of nextRows) {
          insertAccountRow(db, row, nowIso);
        }

        upsertCategoryMetadata(db, repair, nowIso);
        summary.matchedAccounts += 1;
        summary.patchedRows += nextRows.length;
        summary.metadataUpserts += 1;
      }

      rebuildSalesRepDirectory(db, nowIso);
      upsertRepairState.run(
        REPAIR_KEY,
        REPAIR_VERSION,
        nowIso,
        JSON.stringify({
          backupPath,
          matchedAccounts: summary.matchedAccounts,
          patchedRows: summary.patchedRows,
          metadataUpserts: summary.metadataUpserts,
          missingAccounts: summary.missingAccounts,
        }),
      );
    });

    transaction();
    return summary;
  } finally {
    db.close();
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const result = await applyBrockAbSqliteRepair({
    enabled: true,
    sqlitePath: process.argv[2],
  });
  console.log(JSON.stringify(result, null, 2));
}
