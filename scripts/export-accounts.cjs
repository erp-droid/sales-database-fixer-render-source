#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Prints a slim JSON array of all deduplicated accounts for offline
// comparison tooling (name/address/phone matching).

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const { DEFAULT_SQLITE_PATH, readAccounts } = require("./route-weeks-shared.cjs");

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
    const accounts = readAccounts(db).map((account) => ({
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
      primaryContactPhone: account.primaryContactPhone,
    }));
    process.stdout.write(`${JSON.stringify(accounts)}\n`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
