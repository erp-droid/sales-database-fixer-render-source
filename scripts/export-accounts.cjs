#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Prints a slim JSON array of all deduplicated accounts for offline
// comparison tooling (name/address/phone matching).

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const {
  DEFAULT_SQLITE_PATH,
  normalizeText,
  readAccounts,
} = require("./route-weeks-shared.cjs");

const CONTACT_FIELD_KEYS = [
  "primaryContactName",
  "primaryContactJobTitle",
  "primaryContactPhone",
  "primaryContactExtension",
  "primaryContactEmail",
];

function normalizeContactId(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? String(numeric) : normalized;
}

function readContactField(row, key) {
  return normalizeText(row?.payload?.[key]) || normalizeText(row?.[key]);
}

function toContactCandidate(row) {
  const contactId = normalizeContactId(row?.payload?.contactId ?? row?.contactId);
  const primaryContactId = normalizeContactId(
    row?.payload?.primaryContactId ?? row?.primaryContactId,
  );
  const fields = Object.fromEntries(
    CONTACT_FIELD_KEYS.map((key) => [key, readContactField(row, key)]),
  );

  if (!contactId && !CONTACT_FIELD_KEYS.some((key) => fields[key])) {
    return null;
  }

  return {
    ...fields,
    contactId,
    primaryContactId,
    isPrimaryContact: row?.isPrimaryContact === true || row?.payload?.isPrimaryContact === true,
    sourceTable: normalizeText(row?.sourceTable),
    rowKey: normalizeText(row?.rowKey),
  };
}

function contactCompleteness(candidate) {
  return CONTACT_FIELD_KEYS.reduce(
    (count, key) => count + (candidate[key] ? 1 : 0),
    0,
  );
}

function compareContactCandidates(left, right) {
  const completenessDifference = contactCompleteness(right) - contactCompleteness(left);
  if (completenessDifference !== 0) {
    return completenessDifference;
  }

  const leftSourceRank = left.sourceTable === "local_account_rows" ? 0 : 1;
  const rightSourceRank = right.sourceTable === "local_account_rows" ? 0 : 1;
  if (leftSourceRank !== rightSourceRank) {
    return leftSourceRank - rightSourceRank;
  }

  for (const [leftValue, rightValue] of [
    [left.contactId, right.contactId],
    [left.rowKey, right.rowKey],
    ...CONTACT_FIELD_KEYS.map((key) => [left[key], right[key]]),
  ]) {
    const comparison = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function bestContact(candidates) {
  return [...candidates].sort(compareContactCandidates)[0] || null;
}

function selectContact(account) {
  const sourceRows = Array.isArray(account?.rows) && account.rows.length > 0
    ? account.rows
    : [account];
  const candidates = sourceRows.map(toContactCandidate).filter(Boolean);

  const matchingPrimaryId = candidates.filter(
    (candidate) =>
      candidate.contactId !== null && candidate.contactId === candidate.primaryContactId,
  );
  if (matchingPrimaryId.length > 0) {
    return bestContact(matchingPrimaryId);
  }

  const flaggedPrimary = candidates.filter((candidate) => candidate.isPrimaryContact);
  if (flaggedPrimary.length > 0) {
    return bestContact(flaggedPrimary);
  }

  const namedContacts = candidates.filter((candidate) => candidate.primaryContactName);
  if (namedContacts.length === 1) {
    return namedContacts[0];
  }
  return bestContact(namedContacts);
}

function toExportAccount(account) {
  const contact = selectContact(account);
  return {
    accountRecordId: account.accountRecordId,
    businessAccountId: account.businessAccountId,
    companyName: account.companyName,
    address: account.address,
    addressLine1: account.addressLine1,
    city: account.city,
    postalCode: account.postalCode,
    salesRepId: account.salesRepId,
    salesRepName: account.salesRepName,
    category: account.category,
    week: account.week,
    companyPhone: account.companyPhone,
    phoneNumber: account.phoneNumber,
    primaryContactName: contact?.primaryContactName ?? null,
    primaryContactJobTitle: contact?.primaryContactJobTitle ?? null,
    primaryContactPhone: contact?.primaryContactPhone ?? null,
    primaryContactExtension: contact?.primaryContactExtension ?? null,
    primaryContactEmail: contact?.primaryContactEmail ?? null,
  };
}

function parseArgs(argv) {
  const options = {
    sqlitePath: process.env.READ_MODEL_SQLITE_PATH || DEFAULT_SQLITE_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sqlite-path") {
      options.sqlitePath = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(options.sqlitePath);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }

  const db = new Database(sqlitePath, { readonly: true });
  try {
    const accounts = readAccounts(db).map(toExportAccount);
    process.stdout.write(`${JSON.stringify(accounts)}\n`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  compareContactCandidates,
  selectContact,
  toContactCandidate,
  toExportAccount,
};
