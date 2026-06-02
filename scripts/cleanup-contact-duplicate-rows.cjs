#!/usr/bin/env node

const Database = require("better-sqlite3");

const sqlitePath = process.env.READ_MODEL_SQLITE_PATH || "/app/data/read-model.sqlite";
const apply = process.argv.includes("--apply");
const includeExact = process.argv.includes("--include-exact");

const COLUMNS = [
  "row_key",
  "id",
  "account_record_id",
  "business_account_id",
  "contact_id",
  "is_primary_contact",
  "company_name",
  "address",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "phone_number",
  "company_phone",
  "company_phone_source",
  "sales_rep_id",
  "sales_rep_name",
  "industry_type",
  "sub_category",
  "company_region",
  "week",
  "primary_contact_name",
  "primary_contact_phone",
  "primary_contact_email",
  "primary_contact_id",
  "category",
  "notes",
  "last_modified_iso",
  "search_text",
  "address_key",
  "payload_json",
  "updated_at",
];

const JSON_IDENTIFIER_KEYS = new Set([
  "rowKey",
  "contactId",
]);
const BOOLEAN_KEYS = new Set(["isPrimaryContact", "marketingEligible"]);
const DATE_KEYS = new Set([
  "lastModifiedIso",
  "lastCalledAt",
  "lastEmailedAt",
  "updatedAt",
  "createdAt",
]);
const NOTE_KEYS = new Set(["notes", "contactNotes"]);
const DB_IDENTIFIER_COLUMNS = new Set(["row_key", "contact_id"]);
const DB_DERIVED_COLUMNS = new Set(["search_text", "address_key"]);
const DB_BOOLEAN_COLUMNS = new Set(["is_primary_contact"]);
const DB_DATE_COLUMNS = new Set(["last_modified_iso", "updated_at"]);
const DB_NOTE_COLUMNS = new Set(["notes"]);

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeComparable(key, value) {
  if (isBlank(value)) {
    return "";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value !== "string") {
    return JSON.stringify(value);
  }

  const normalized = value.trim();
  const loweredKey = key.toLowerCase();
  if (loweredKey.includes("phone")) {
    return normalizePhone(normalized);
  }
  if (loweredKey.includes("email")) {
    return normalized.toLowerCase();
  }

  return normalized.toLowerCase();
}

function latestDateValue(left, right) {
  const leftMs = Date.parse(left ?? "");
  const rightMs = Date.parse(right ?? "");
  if (!Number.isFinite(leftMs)) {
    return right;
  }
  if (!Number.isFinite(rightMs)) {
    return left;
  }
  return rightMs > leftMs ? right : left;
}

function combineNotes(targetValue, sourceValue) {
  const target = String(targetValue ?? "").trim();
  const source = String(sourceValue ?? "").trim();
  if (!target) {
    return source || null;
  }
  if (!source || normalizeComparable("notes", target) === normalizeComparable("notes", source)) {
    return targetValue;
  }
  return `${target}\n\nMerged duplicate note:\n${source}`;
}

function mergeScalar(key, targetValue, sourceValue, options = {}) {
  if (isBlank(sourceValue)) {
    return { value: targetValue, changed: false, conflicts: [] };
  }
  if (isBlank(targetValue)) {
    return { value: sourceValue, changed: true, conflicts: [] };
  }
  if (normalizeComparable(key, targetValue) === normalizeComparable(key, sourceValue)) {
    return { value: targetValue, changed: false, conflicts: [] };
  }

  if (options.boolean) {
    const value = Boolean(targetValue) || Boolean(sourceValue) ? 1 : 0;
    return { value, changed: value !== targetValue, conflicts: [] };
  }

  if (options.date) {
    const value = latestDateValue(targetValue, sourceValue);
    return { value, changed: value !== targetValue, conflicts: [] };
  }

  if (options.note && typeof targetValue === "string" && typeof sourceValue === "string") {
    const value = combineNotes(targetValue, sourceValue);
    return { value, changed: value !== targetValue, conflicts: [] };
  }

  return {
    value: targetValue,
    changed: false,
    conflicts: [
      {
        field: key,
        keepValue: targetValue,
        duplicateValue: sourceValue,
      },
    ],
  };
}

function parsePayload(row) {
  try {
    return JSON.parse(row.payload_json || "{}");
  } catch {
    return {};
  }
}

function mergePayload(targetPayload, sourcePayload) {
  const next = { ...targetPayload };
  const conflicts = [];
  let changed = false;

  for (const key of new Set([...Object.keys(sourcePayload), ...Object.keys(targetPayload)])) {
    if (JSON_IDENTIFIER_KEYS.has(key)) {
      continue;
    }

    if (key === "isPrimaryContact") {
      const value = Boolean(targetPayload[key]) || Boolean(sourcePayload[key]);
      if (value !== targetPayload[key]) {
        next[key] = value;
        changed = true;
      }
      continue;
    }

    const result = mergeScalar(key, targetPayload[key], sourcePayload[key], {
      boolean: BOOLEAN_KEYS.has(key),
      date: DATE_KEYS.has(key),
      note: NOTE_KEYS.has(key),
    });
    if (result.conflicts.length > 0) {
      conflicts.push(...result.conflicts);
      continue;
    }
    if (result.changed) {
      next[key] = result.value;
      changed = true;
    }
  }

  return { payload: next, conflicts, changed };
}

function accountKey(row) {
  return String(row.account_record_id || row.id || "").trim();
}

function exactIdentityKey(row) {
  const name = normalizeComparable("primary_contact_name", row.primary_contact_name);
  const email = normalizeComparable("primary_contact_email", row.primary_contact_email);
  const phone = normalizeComparable("primary_contact_phone", row.primary_contact_phone);
  if (!name || (!email && !phone)) {
    return null;
  }
  return [accountKey(row), name, email, phone].join("|");
}

function buildSearchText(row, payload) {
  return [
    row.company_name,
    row.business_account_id,
    row.address,
    row.company_phone,
    row.phone_number,
    row.primary_contact_name,
    row.primary_contact_email,
    row.primary_contact_phone,
    row.sales_rep_name,
    row.industry_type,
    row.sub_category,
    row.company_region,
    row.week,
    payload.companyDescription,
    row.notes,
    row.category,
    payload.lastCalledAt,
    payload.lastEmailedAt,
    row.last_modified_iso,
  ]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .toLowerCase();
}

function buildAddressKey(row) {
  return [
    row.address_line1,
    row.address_line2,
    row.city,
    row.state,
    row.postal_code,
    row.country,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("|");
}

function mergeRows(target, source) {
  const next = { ...target };
  const conflicts = [];
  let changed = false;

  for (const column of COLUMNS) {
    if (
      column === "payload_json" ||
      DB_IDENTIFIER_COLUMNS.has(column) ||
      DB_DERIVED_COLUMNS.has(column)
    ) {
      continue;
    }

    const result = mergeScalar(column, target[column], source[column], {
      boolean: DB_BOOLEAN_COLUMNS.has(column),
      date: DB_DATE_COLUMNS.has(column),
      note: DB_NOTE_COLUMNS.has(column),
    });
    if (result.conflicts.length > 0) {
      conflicts.push(...result.conflicts);
      continue;
    }
    if (result.changed) {
      next[column] = result.value;
      changed = true;
    }
  }

  const targetPayload = parsePayload(target);
  const sourcePayload = parsePayload(source);
  const payloadResult = mergePayload(targetPayload, sourcePayload);
  conflicts.push(...payloadResult.conflicts.map((conflict) => ({
    ...conflict,
    field: `payload_json.${conflict.field}`,
  })));

  if (payloadResult.changed) {
    next.payload_json = JSON.stringify(payloadResult.payload);
    changed = true;
  }

  if (changed) {
    next.updated_at = latestDateValue(target.updated_at, source.updated_at) || new Date().toISOString();
    next.search_text = buildSearchText(next, payloadResult.payload);
    next.address_key = buildAddressKey(next);
  }

  return { row: next, conflicts, changed };
}

function rowSummary(row) {
  return {
    rowKey: row.row_key,
    accountKey: accountKey(row),
    businessAccountId: row.business_account_id,
    companyName: row.company_name,
    contactId: row.contact_id,
    primaryContactId: row.primary_contact_id,
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    primaryContactPhone: row.primary_contact_phone,
  };
}


function isKnownVerificationRow(row) {
  const name = normalizeComparable("primary_contact_name", row.primary_contact_name);
  const email = normalizeComparable("primary_contact_email", row.primary_contact_email);
  return name.startsWith("deploy verify") || email.startsWith("deploy-verify");
}

function chooseKeepRow(rows) {
  return [...rows].sort((left, right) => {
    const leftPrimary = left.primary_contact_id !== null && left.contact_id === left.primary_contact_id;
    const rightPrimary = right.primary_contact_id !== null && right.contact_id === right.primary_contact_id;
    if (leftPrimary !== rightPrimary) {
      return leftPrimary ? -1 : 1;
    }

    const leftCalled = Date.parse(parsePayload(left).lastCalledAt || "");
    const rightCalled = Date.parse(parsePayload(right).lastCalledAt || "");
    if (Number.isFinite(leftCalled) || Number.isFinite(rightCalled)) {
      return (Number.isFinite(rightCalled) ? rightCalled : 0) - (Number.isFinite(leftCalled) ? leftCalled : 0);
    }

    return String(left.row_key).localeCompare(String(right.row_key), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  })[0];
}

function readRows(db) {
  return db.prepare(`SELECT ${COLUMNS.join(", ")} FROM account_rows`).all();
}

function buildDuplicateWork(rows) {
  const byAccountContact = new Map();
  for (const row of rows) {
    if (row.contact_id === null || row.contact_id === undefined) {
      continue;
    }
    const key = `${accountKey(row)}|${row.contact_id}`;
    const existing = byAccountContact.get(key);
    if (existing) {
      existing.push(row);
    } else {
      byAccountContact.set(key, [row]);
    }
  }

  const placeholderWork = [];
  for (const row of rows) {
    if (row.contact_id !== null && row.contact_id !== undefined) {
      continue;
    }
    if (row.primary_contact_id === null || row.primary_contact_id === undefined) {
      continue;
    }
    const candidates = byAccountContact.get(`${accountKey(row)}|${row.primary_contact_id}`) || [];
    const target = chooseKeepRow(candidates);
    if (target) {
      placeholderWork.push({ type: "placeholder", target, source: row });
    }
  }

  const exactGroups = new Map();
  for (const row of rows) {
    if (row.contact_id === null || row.contact_id === undefined) {
      continue;
    }
    const key = exactIdentityKey(row);
    if (!key) {
      continue;
    }
    const existing = exactGroups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      exactGroups.set(key, [row]);
    }
  }

  const exactWork = [];
  for (const groupRows of exactGroups.values()) {
    if (groupRows.length <= 1) {
      continue;
    }
    const target = chooseKeepRow(groupRows);
    for (const source of groupRows) {
      if (source.row_key !== target.row_key) {
        exactWork.push({ type: "exact-contact", target, source });
      }
    }
  }

  return { placeholderWork, exactWork };
}

const db = new Database(sqlitePath);
try {
  const updateColumns = COLUMNS.filter((column) => column !== "row_key");
  const updateTarget = db.prepare(
    `UPDATE account_rows SET ${updateColumns.map((column) => `${column} = @${column}`).join(", ")} WHERE row_key = @row_key`,
  );
  const deleteSource = db.prepare("DELETE FROM account_rows WHERE row_key = ?");

  const rows = readRows(db);
  const beforeWork = buildDuplicateWork(rows);
  const selectedWork = [
    ...beforeWork.placeholderWork,
    ...(includeExact ? beforeWork.exactWork : []),
  ];

  const report = {
    sqlitePath,
    mode: apply ? "apply" : "dry-run",
    includeExact,
    placeholderDuplicateRowsBefore: beforeWork.placeholderWork.length,
    exactDuplicateRowsBefore: beforeWork.exactWork.length,
    mergedRows: 0,
    deletedRows: 0,
    skippedRows: 0,
    skipped: [],
    samples: selectedWork.slice(0, 10).map((item) => ({
      type: item.type,
      keep: rowSummary(item.target),
      duplicate: rowSummary(item.source),
    })),
  };

  const applyCleanup = db.transaction(() => {
    const rowsByKey = new Map(rows.map((row) => [row.row_key, row]));
    for (const item of selectedWork) {
      const target = rowsByKey.get(item.target.row_key);
      const source = rowsByKey.get(item.source.row_key);
      if (!target || !source) {
        continue;
      }

      if (item.type === "placeholder" && isKnownVerificationRow(source)) {
        if (apply) {
          deleteSource.run(source.row_key);
        }
        rowsByKey.delete(source.row_key);
        report.deletedRows += 1;
        continue;
      }

      const merged = mergeRows(target, source);
      if (merged.conflicts.length > 0) {
        report.skippedRows += 1;
        if (report.skipped.length < 25) {
          report.skipped.push({
            type: item.type,
            keep: rowSummary(target),
            duplicate: rowSummary(source),
            conflicts: merged.conflicts.slice(0, 10),
          });
        }
        continue;
      }

      if (apply) {
        updateTarget.run(merged.row);
        deleteSource.run(source.row_key);
      }
      rowsByKey.set(target.row_key, merged.row);
      rowsByKey.delete(source.row_key);
      report.mergedRows += merged.changed ? 1 : 0;
      report.deletedRows += 1;
    }
  });

  applyCleanup();

  const afterWork = buildDuplicateWork(readRows(db));
  report.placeholderDuplicateRowsAfter = afterWork.placeholderWork.length;
  report.exactDuplicateRowsAfter = afterWork.exactWork.length;

  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
