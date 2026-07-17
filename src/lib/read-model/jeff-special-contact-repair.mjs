import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const REPAIR_KEY = "jeff_special_original_contacts";
const REPAIR_VERSION = "2026-07-17-v1";

const COMPANY_SUFFIXES = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "ltd",
  "limited",
]);

const GENERIC_COMPANY_TOKENS = new Set([
  ...COMPANY_SUFFIXES,
  "canada",
  "canadian",
  "group",
  "industries",
  "international",
  "manufacturing",
  "sales",
  "solutions",
  "systems",
]);

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

function nullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeCompanyComparable(value) {
  const words = normalizeComparable(value).split(" ").filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words.at(-1) ?? "")) {
    words.pop();
  }
  return words.join(" ");
}

function normalizeAddressComparable(value) {
  return normalizeComparable(value).replace(/\s+(?:ca|canada)$/, "").trim();
}

function companyTokens(value) {
  return new Set(
    normalizeCompanyComparable(value)
      .split(" ")
      .filter((word) => word.length >= 4 && !GENERIC_COMPANY_TOKENS.has(word)),
  );
}

function hasCompanyTokenOverlap(left, right) {
  const leftTokens = companyTokens(left);
  return [...companyTokens(right)].some((token) => leftTokens.has(token));
}

function isLocalIdentity(value) {
  return /^local[-_]/i.test(normalizeText(value));
}

function resolveDatabasePath(inputPath = process.env.READ_MODEL_SQLITE_PATH || "./data/read-model.sqlite") {
  return path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
}

function readRepairSpecs() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(
    fs.readFileSync(path.join(moduleDir, "jeff-special-contact-repairs.json"), "utf8"),
  );
}

function buildBackupPath(sqlitePath) {
  const parsed = path.parse(sqlitePath);
  return path.join(
    parsed.dir,
    `${parsed.name}.${REPAIR_KEY}.${REPAIR_VERSION}.backup${parsed.ext || ".sqlite"}`,
  );
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

function parseStoredRow(entry) {
  try {
    const payload = JSON.parse(entry.payload_json);
    return {
      ...payload,
      rowKey: normalizeText(payload.rowKey) || entry.row_key,
      lastCalledAt: entry.last_called_at ?? payload.lastCalledAt ?? null,
      lastCalendarInvitedAt:
        entry.last_calendar_invited_at ?? payload.lastCalendarInvitedAt ?? null,
    };
  } catch {
    return null;
  }
}

function readAllRows(db) {
  return db
    .prepare(
      `
      SELECT row_key, payload_json, last_called_at, last_calendar_invited_at
      FROM account_rows
      ORDER BY company_name COLLATE NOCASE ASC, row_key ASC
      `,
    )
    .all()
    .map(parseStoredRow)
    .filter((row) => row !== null);
}

function rowAccountRecordId(row) {
  return normalizeText(row.accountRecordId) || normalizeText(row.id);
}

function fullAddress(row) {
  const street = [normalizeText(row.addressLine1), normalizeText(row.addressLine2)]
    .filter(Boolean)
    .join(", ");
  const locality = [normalizeText(row.city), normalizeText(row.state), normalizeText(row.postalCode)]
    .filter(Boolean)
    .join(" ");
  const structured = [street, locality, normalizeText(row.country)].filter(Boolean).join(", ");
  return normalizeText(row.address) || structured;
}

function accountIdentity(row, index) {
  const accountRecordId = normalizeComparable(rowAccountRecordId(row));
  if (accountRecordId) {
    return `record:${accountRecordId}`;
  }
  const businessAccountId = normalizeComparable(row.businessAccountId);
  if (businessAccountId) {
    return `business:${businessAccountId}`;
  }
  return `fallback:${normalizeCompanyComparable(row.companyName)}:${normalizeAddressComparable(fullAddress(row))}:${index}`;
}

function groupAccountRows(rows) {
  const grouped = new Map();
  rows.forEach((row, index) => {
    const key = accountIdentity(row, index);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  });
  return [...grouped.values()];
}

function buildGroupIndex(groups, valueForRow, normalizer = normalizeComparable) {
  const index = new Map();
  for (const rows of groups) {
    const values = new Set(rows.map((row) => normalizer(valueForRow(row))).filter(Boolean));
    for (const value of values) {
      const existing = index.get(value) ?? [];
      existing.push(rows);
      index.set(value, existing);
    }
  }
  return index;
}

function contactId(row) {
  const value = Number(row.contactId);
  return Number.isInteger(value) && value !== 0 ? value : null;
}

function isDesignatedPrimary(row) {
  const rowContactId = contactId(row);
  const primaryContactId = Number(row.primaryContactId);
  return row.isPrimaryContact === true || (
    rowContactId !== null &&
    Number.isInteger(primaryContactId) &&
    rowContactId === primaryContactId
  );
}

function usableContactName(value) {
  const text = normalizeText(value);
  return /^(unknown|uknown|unkown|contact needed|no contact)$/i.test(text) ? "" : text;
}

function usableJobTitle(value) {
  const text = normalizeText(value);
  return /^(unknown|uknown|unkown|n\/a)$/i.test(text) ? "" : text;
}

function usablePhone(value) {
  const text = normalizeText(value);
  const digits = text.replace(/\D/g, "");
  return digits && !/^0+$/.test(digits) ? text : "";
}

function usableEmail(value) {
  const text = normalizeText(value);
  return /(?:unknown|uknown|unkown|dontknow|do-not-reply|noemail)/i.test(text) ? "" : text;
}

function contactCompleteness(row) {
  return [
    usableContactName(row.primaryContactName),
    usableJobTitle(row.primaryContactJobTitle),
    usablePhone(row.primaryContactPhone),
    normalizeText(row.primaryContactExtension),
    usableEmail(row.primaryContactEmail),
  ].filter(Boolean).length;
}

function chooseAccountRow(rows) {
  return [...rows].sort(
    (left, right) =>
      [right.addressLine1, right.addressLine2, right.city, right.state, right.postalCode, right.country]
        .filter((value) => normalizeText(value)).length -
        [left.addressLine1, left.addressLine2, left.city, left.state, left.postalCode, left.country]
          .filter((value) => normalizeText(value)).length ||
      Number(Boolean(right.companyPhone)) - Number(Boolean(left.companyPhone)) ||
      normalizeText(left.rowKey).localeCompare(normalizeText(right.rowKey)),
  )[0];
}

function chooseUsablePrimary(rows) {
  return rows
    .filter((row) => contactId(row) !== null && isDesignatedPrimary(row))
    .filter((row) => usableContactName(row.primaryContactName))
    .sort(
      (left, right) =>
        contactCompleteness(right) - contactCompleteness(left) ||
        usableContactName(left.primaryContactName).localeCompare(
          usableContactName(right.primaryContactName),
        ),
    )[0] ?? null;
}

function isLocalGroup(rows) {
  const row = chooseAccountRow(rows);
  return isLocalIdentity(normalizeText(row.businessAccountId) || rowAccountRecordId(row));
}

function currentAccountScore(rows) {
  const primary = chooseUsablePrimary(rows);
  return (primary ? 200 + contactCompleteness(primary) * 2 : 0) + (isLocalGroup(rows) ? 0 : 10);
}

function addCandidateGroups(candidates, groups, score, predicate = () => true) {
  for (const rows of groups ?? []) {
    if (predicate(rows)) {
      candidates.set(rows, (candidates.get(rows) ?? 0) + score);
    }
  }
}

function buildAccountIndexes(rows) {
  const groups = groupAccountRows(rows);
  return {
    groups,
    byAccountRecordId: buildGroupIndex(groups, rowAccountRecordId),
    byBusinessAccountId: buildGroupIndex(groups, (row) => row.businessAccountId),
    byCompanyName: buildGroupIndex(groups, (row) => row.companyName),
    byRelaxedCompanyName: buildGroupIndex(
      groups,
      (row) => row.companyName,
      normalizeCompanyComparable,
    ),
    byAddress: buildGroupIndex(groups, fullAddress, normalizeAddressComparable),
  };
}

function selectMatchingAccountRows(spec, indexes) {
  const candidates = new Map();
  addCandidateGroups(
    candidates,
    indexes.byAccountRecordId.get(normalizeComparable(spec.accountRecordId)),
    50,
  );
  addCandidateGroups(
    candidates,
    indexes.byBusinessAccountId.get(normalizeComparable(spec.businessAccountId)),
    45,
  );
  addCandidateGroups(
    candidates,
    indexes.byCompanyName.get(normalizeComparable(spec.companyName)),
    35,
  );
  addCandidateGroups(
    candidates,
    indexes.byRelaxedCompanyName.get(normalizeCompanyComparable(spec.companyName)),
    25,
  );

  const addressGroups = (
    indexes.byAddress.get(normalizeAddressComparable(spec.address)) ?? []
  ).filter((rows) => hasCompanyTokenOverlap(spec.companyName, chooseAccountRow(rows).companyName));
  const onlyLocalIdentityCandidates =
    candidates.size > 0 && [...candidates.keys()].every(isLocalGroup);
  const safeAddressGroups =
    (candidates.size === 0 && addressGroups.length <= 1) || onlyLocalIdentityCandidates
      ? addressGroups
      : [];
  addCandidateGroups(candidates, safeAddressGroups, 30);

  return [...candidates.entries()].sort(
    ([leftRows, leftScore], [rightRows, rightScore]) =>
      rightScore + currentAccountScore(rightRows) - (leftScore + currentAccountScore(leftRows)) ||
      normalizeText(chooseAccountRow(leftRows).companyName).localeCompare(
        normalizeText(chooseAccountRow(rightRows).companyName),
      ),
  )[0]?.[0] ?? [];
}

function findSourceContact(rows, spec) {
  const sourceName = normalizeComparable(spec.contact.displayName);
  const sourceEmail = normalizeText(spec.contact.email).toLowerCase();
  const aliases = new Set(
    (spec.contactAliases ?? []).map(normalizeComparable).filter(Boolean),
  );

  return rows
    .filter((row) => contactId(row) !== null)
    .map((row) => {
      const rowName = normalizeComparable(usableContactName(row.primaryContactName));
      const rowEmail = usableEmail(row.primaryContactEmail).toLowerCase();
      const exactName = Boolean(sourceName && rowName === sourceName);
      const exactEmail = Boolean(sourceEmail && rowEmail === sourceEmail);
      const aliasName = Boolean(rowName && aliases.has(rowName));
      return {
        row,
        exactSource: exactName || exactEmail,
        score:
          (exactName ? 100 : 0) +
          (exactEmail ? 90 : 0) +
          (aliasName ? 70 : 0) +
          contactCompleteness(row),
      };
    })
    .filter((candidate) => candidate.score >= 70)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function fillSourceFields(row, spec, exactSource) {
  const source = spec.contact;
  const next = { ...row };
  if (!usableContactName(next.primaryContactName)) {
    next.primaryContactName = source.displayName;
  }
  if (exactSource && !usableJobTitle(next.primaryContactJobTitle) && normalizeText(source.jobTitle)) {
    next.primaryContactJobTitle = source.jobTitle;
  }
  if (exactSource && !usablePhone(next.primaryContactPhone) && normalizeText(source.phone)) {
    next.primaryContactPhone = source.phone;
    next.primaryContactRawPhone = source.phone;
  }
  if (exactSource && !normalizeText(next.primaryContactExtension) && normalizeText(source.extension)) {
    next.primaryContactExtension = source.extension;
  }
  if (exactSource && !usableEmail(next.primaryContactEmail) && normalizeText(source.email)) {
    next.primaryContactEmail = source.email;
  }
  return next;
}

function stableContactIdSeed(spec) {
  const input = `${REPAIR_VERSION}|${spec.accountRecordId}|${spec.contact.displayName}`;
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return -(500_000_000 + (hash % 1_500_000_000));
}

function allocateContactId(spec, usedContactIds) {
  let candidate = stableContactIdSeed(spec);
  while (usedContactIds.has(candidate) || candidate === 0) {
    candidate -= 1;
  }
  usedContactIds.add(candidate);
  return candidate;
}

function makePrimary(rows, targetContactId) {
  return rows.map((row) => ({
    ...row,
    isPrimaryContact: contactId(row) === targetContactId,
    primaryContactId: targetContactId,
  }));
}

function createSourceContactRow(rows, spec, newContactId, existingPrimary) {
  const contactRows = rows.filter((row) => contactId(row) !== null);
  const anchor = rows.find((row) => contactId(row) === null) ?? rows[0];
  if (!anchor) {
    throw new Error(`Cannot create ${spec.contact.displayName}: the matched account has no row.`);
  }

  const primaryId = existingPrimary ? contactId(existingPrimary) : newContactId;
  const accountRecordId = rowAccountRecordId(anchor) || normalizeText(spec.accountRecordId);
  const createdRow = {
    ...anchor,
    rowKey: `${accountRecordId}:contact:${newContactId}`,
    contactId: newContactId,
    isPrimaryContact: !existingPrimary,
    primaryContactName: spec.contact.displayName,
    primaryContactJobTitle: nullableText(spec.contact.jobTitle),
    primaryContactPhone: nullableText(spec.contact.phone),
    primaryContactRawPhone: nullableText(spec.contact.phone),
    primaryContactExtension: nullableText(spec.contact.extension),
    primaryContactEmail: nullableText(spec.contact.email),
    primaryContactId: primaryId,
  };

  const nextRows = contactRows.map((row) => ({
    ...row,
    ...(existingPrimary
      ? {}
      : {
          isPrimaryContact: false,
          primaryContactId: newContactId,
        }),
  }));
  return existingPrimary ? [...nextRows, createdRow] : makePrimary([...nextRows, createdRow], newContactId);
}

function rowsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconcileContact(rows, spec, usedContactIds) {
  const existingPrimary = chooseUsablePrimary(rows);
  const sourceMatch = findSourceContact(rows, spec);

  if (!sourceMatch) {
    const newContactId = allocateContactId(spec, usedContactIds);
    return {
      nextRows: createSourceContactRow(rows, spec, newContactId, existingPrimary),
      action: existingPrimary ? "created_preserved_existing_primary" : "created_primary",
      contactId: newContactId,
      primaryContactName: existingPrimary?.primaryContactName ?? spec.contact.displayName,
    };
  }

  const sourceId = contactId(sourceMatch.row);
  let nextRows = rows.map((row) =>
    row === sourceMatch.row ? fillSourceFields(row, spec, sourceMatch.exactSource) : row,
  );
  const resolvedExistingPrimary = chooseUsablePrimary(nextRows);
  if (!resolvedExistingPrimary && sourceId !== null) {
    nextRows = makePrimary(nextRows, sourceId);
  }

  const sourceFieldsChanged = !rowsEqual(rows, nextRows);
  const sourceIsPrimary = sourceId !== null && isDesignatedPrimary(
    nextRows.find((row) => contactId(row) === sourceId) ?? {},
  );
  return {
    nextRows,
    action: sourceFieldsChanged
      ? sourceIsPrimary
        ? "updated_primary"
        : "updated_preserved_existing_primary"
      : sourceIsPrimary
        ? "verified_primary"
        : "verified_preserved_existing_primary",
    contactId: sourceId,
    primaryContactName:
      chooseUsablePrimary(nextRows)?.primaryContactName ?? spec.contact.displayName,
  };
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
    row.companyPhone,
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
    row.lastCalendarInvitedAt,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();
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

function insertAccountRow(db, row, nowIso) {
  const rowKey =
    normalizeText(row.rowKey) ||
    `${rowAccountRecordId(row) || normalizeText(row.businessAccountId) || "row"}:contact:${contactId(row) ?? "row"}`;
  const payload = {
    ...row,
    rowKey,
    lastModifiedIso: nowIso,
  };

  db.prepare(
    `
    INSERT INTO account_rows (
      row_key, id, account_record_id, business_account_id, contact_id,
      is_primary_contact, company_name, address, address_line1, address_line2,
      city, state, postal_code, country, phone_number, company_phone,
      company_phone_source, sales_rep_id, sales_rep_name, industry_type,
      sub_category, company_region, week, primary_contact_name,
      primary_contact_phone, primary_contact_email, primary_contact_id,
      category, notes, last_called_at, last_calendar_invited_at,
      last_modified_iso, search_text, address_key, payload_json, updated_at
    ) VALUES (
      @row_key, @id, @account_record_id, @business_account_id, @contact_id,
      @is_primary_contact, @company_name, @address, @address_line1, @address_line2,
      @city, @state, @postal_code, @country, @phone_number, @company_phone,
      @company_phone_source, @sales_rep_id, @sales_rep_name, @industry_type,
      @sub_category, @company_region, @week, @primary_contact_name,
      @primary_contact_phone, @primary_contact_email, @primary_contact_id,
      @category, @notes, @last_called_at, @last_calendar_invited_at,
      @last_modified_iso, @search_text, @address_key, @payload_json, @updated_at
    )
    `,
  ).run({
    row_key: rowKey,
    id: normalizeText(payload.id) || rowAccountRecordId(payload) || normalizeText(payload.businessAccountId),
    account_record_id: nullableText(payload.accountRecordId) ?? nullableText(payload.id),
    business_account_id: normalizeText(payload.businessAccountId),
    contact_id: contactId(payload),
    is_primary_contact: payload.isPrimaryContact === true ? 1 : 0,
    company_name: normalizeText(payload.companyName),
    address: normalizeText(payload.address) || fullAddress(payload),
    address_line1: normalizeText(payload.addressLine1),
    address_line2: normalizeText(payload.addressLine2),
    city: normalizeText(payload.city),
    state: normalizeText(payload.state),
    postal_code: normalizeText(payload.postalCode),
    country: normalizeText(payload.country),
    phone_number: nullableText(payload.phoneNumber),
    company_phone: nullableText(payload.companyPhone) ?? nullableText(payload.phoneNumber),
    company_phone_source: nullableText(payload.companyPhoneSource),
    sales_rep_id: nullableText(payload.salesRepId),
    sales_rep_name: nullableText(payload.salesRepName),
    industry_type: nullableText(payload.industryType),
    sub_category: nullableText(payload.subCategory),
    company_region: nullableText(payload.companyRegion),
    week: nullableText(payload.week),
    primary_contact_name: nullableText(payload.primaryContactName),
    primary_contact_phone: nullableText(payload.primaryContactPhone),
    primary_contact_email: nullableText(payload.primaryContactEmail),
    primary_contact_id:
      Number.isInteger(Number(payload.primaryContactId)) && Number(payload.primaryContactId) !== 0
        ? Number(payload.primaryContactId)
        : null,
    category: nullableText(payload.category),
    notes: nullableText(payload.notes),
    last_called_at: nullableText(payload.lastCalledAt),
    last_calendar_invited_at: nullableText(payload.lastCalendarInvitedAt),
    last_modified_iso: nowIso,
    search_text: buildSearchText(payload),
    address_key: buildAddressKey(payload),
    payload_json: JSON.stringify(payload),
    updated_at: nowIso,
  });
}

function summarizeActionCounts(results) {
  const counts = {};
  for (const result of results) {
    counts[result.action] = (counts[result.action] ?? 0) + 1;
  }
  return counts;
}

export async function applyJeffSpecialContactRepair(options = {}) {
  const enabled = readFeatureEnabled(
    options.enabled ?? process.env.JEFF_SPECIAL_CONTACT_REPAIR_ENABLED,
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

  try {
    const previousState = readRepairState(db);
    const specs = readRepairSpecs();
    const allRows = readAllRows(db);
    const indexes = buildAccountIndexes(allRows);
    const usedContactIds = new Set(
      allRows.map(contactId).filter((value) => value !== null),
    );
    const plans = [];
    const missingAccounts = [];

    for (const spec of specs) {
      const matchedRows = selectMatchingAccountRows(spec, indexes);
      if (matchedRows.length === 0) {
        missingAccounts.push({
          accountRecordId: spec.accountRecordId,
          businessAccountId: spec.businessAccountId,
          companyName: spec.companyName,
          contactName: spec.contact.displayName,
        });
        continue;
      }

      const result = reconcileContact(matchedRows, spec, usedContactIds);
      const changed = !rowsEqual(matchedRows, result.nextRows);
      plans.push({
        spec,
        matchedRows,
        nextRows: result.nextRows,
        changed,
        action: result.action,
        contactId: result.contactId,
        matchedAccountRecordId: rowAccountRecordId(chooseAccountRow(matchedRows)),
        matchedBusinessAccountId: normalizeText(chooseAccountRow(matchedRows).businessAccountId),
        matchedCompanyName: normalizeText(chooseAccountRow(matchedRows).companyName),
        primaryContactName: normalizeText(result.primaryContactName),
      });
    }

    const changedPlans = plans.filter((plan) => plan.changed);
    const backupPath = buildBackupPath(sqlitePath);
    if (changedPlans.length > 0 && !fs.existsSync(backupPath)) {
      await db.backup(backupPath);
    }

    const appliedAt = new Date().toISOString();
    const resultRows = plans.map((plan) => ({
      companyName: plan.spec.companyName,
      contactName: plan.spec.contact.displayName,
      action: plan.action,
      contactId: plan.contactId,
      matchedAccountRecordId: plan.matchedAccountRecordId,
      matchedBusinessAccountId: plan.matchedBusinessAccountId,
      matchedCompanyName: plan.matchedCompanyName,
      primaryContactName: plan.primaryContactName,
    }));

    const transaction = db.transaction(() => {
      const deleteRow = db.prepare("DELETE FROM account_rows WHERE row_key = ?");
      for (const plan of changedPlans) {
        for (const row of plan.matchedRows) {
          deleteRow.run(row.rowKey);
        }
        for (const row of plan.nextRows) {
          insertAccountRow(db, row, appliedAt);
        }
      }

      db.prepare(
        `
        INSERT INTO read_model_repairs (repair_key, version, applied_at, details_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(repair_key) DO UPDATE SET
          version = excluded.version,
          applied_at = excluded.applied_at,
          details_json = excluded.details_json
        `,
      ).run(
        REPAIR_KEY,
        REPAIR_VERSION,
        appliedAt,
        JSON.stringify({
          backupPath: changedPlans.length > 0 ? backupPath : null,
          sourceContactCount: specs.length,
          matchedAccountCount: plans.length,
          changedAccountCount: changedPlans.length,
          missingAccounts,
          actionCounts: summarizeActionCounts(resultRows),
          results: resultRows,
        }),
      );
    });
    transaction();

    const status =
      changedPlans.length > 0
        ? "applied"
        : previousState?.version === REPAIR_VERSION && missingAccounts.length === 0
          ? "already_applied"
          : "verified";
    return {
      enabled: true,
      status,
      repairKey: REPAIR_KEY,
      repairVersion: REPAIR_VERSION,
      sqlitePath,
      backupPath: changedPlans.length > 0 ? backupPath : null,
      sourceContactCount: specs.length,
      matchedAccountCount: plans.length,
      changedAccountCount: changedPlans.length,
      missingAccounts,
      actionCounts: summarizeActionCounts(resultRows),
      results: resultRows,
      appliedAt,
    };
  } finally {
    db.close();
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const result = await applyJeffSpecialContactRepair({
    enabled: true,
    sqlitePath: process.argv[2],
  });
  console.log(JSON.stringify(result, null, 2));
}
