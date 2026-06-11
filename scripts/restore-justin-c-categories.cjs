#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Restores Justin accounts that were category C before the Region 6 apply
// but were swept into D. Reads the original category from the pre-apply
// backup database and only touches accounts that are currently D.

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const {
  DEFAULT_SQLITE_PATH,
  quoteIdentifier,
  tableExists,
  readTableColumns,
  parsePayload,
  readAccounts,
  summarizeAccount,
  createBackup,
} = require("./route-weeks-shared.cjs");

function parseArgs(argv) {
  const options = {
    apply: false,
    sqlitePath: process.env.READ_MODEL_SQLITE_PATH || DEFAULT_SQLITE_PATH,
    backupPath: "",
    reportPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg === "--sqlite-path") {
      options.sqlitePath = argv[++index];
    } else if (arg === "--backup-path") {
      options.backupPath = argv[++index];
    } else if (arg === "--report") {
      options.reportPath = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.backupPath) {
    throw new Error("--backup-path is required.");
  }

  return options;
}

function isJustinAccount(account) {
  const label = `${account.salesRepName || ""} ${account.salesRepId || ""}`.toLowerCase();
  return label.includes("justin") || label.includes("settle");
}

function countCategories(accounts) {
  const counts = {};
  for (const account of accounts) {
    const key = account.category || "blank";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function updateCategoryOnSourceRows(db, tableName, account, category, timestamp) {
  const columns = readTableColumns(db, tableName);
  if (columns.size === 0 || !columns.has("category")) {
    return 0;
  }

  const matchClauses = [];
  const params = {};
  if (columns.has("account_record_id") || columns.has("id")) {
    const recordExpr =
      columns.has("account_record_id") && columns.has("id")
        ? "COALESCE(NULLIF(account_record_id, ''), id)"
        : columns.has("account_record_id")
          ? "account_record_id"
          : "id";
    matchClauses.push(`${recordExpr} = @account_record_id`);
    params.account_record_id = account.accountRecordId;
  }
  if (columns.has("business_account_id") && account.businessAccountId) {
    matchClauses.push("business_account_id = @business_account_id");
    params.business_account_id = account.businessAccountId;
  }
  if (matchClauses.length === 0) {
    return 0;
  }

  const rows = db
    .prepare(
      `
      SELECT rowid AS row_id,
        ${columns.has("payload_json") ? "payload_json" : "'{}' AS payload_json"}
      FROM ${quoteIdentifier(tableName)}
      WHERE ${matchClauses.join(" OR ")}
      `,
    )
    .all(params);
  if (rows.length === 0) {
    return 0;
  }

  const setClauses = ["category = @category"];
  if (columns.has("payload_json")) {
    setClauses.push("payload_json = @payload_json");
  }
  if (columns.has("updated_at")) {
    setClauses.push("updated_at = @updated_at");
  }

  const statement = db.prepare(`
    UPDATE ${quoteIdentifier(tableName)}
    SET ${setClauses.join(", ")}
    WHERE rowid = @row_id
  `);
  let updated = 0;
  for (const row of rows) {
    const payload = parsePayload(row.payload_json);
    const nextPayload =
      payload && typeof payload === "object"
        ? JSON.stringify({ ...payload, category })
        : row.payload_json;
    updated += statement.run({
      row_id: row.row_id,
      category,
      payload_json: nextPayload,
      updated_at: timestamp,
    }).changes;
  }

  return updated;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(options.sqlitePath);
  const backupSourcePath = path.resolve(options.backupPath);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }
  if (!fs.existsSync(backupSourcePath)) {
    throw new Error(`Backup database not found at ${backupSourcePath}`);
  }

  const backupDb = new Database(backupSourcePath, { readonly: true });
  let previousCategoryByAccountRecordId;
  try {
    previousCategoryByAccountRecordId = new Map(
      readAccounts(backupDb).map((account) => [account.accountRecordId, account.category]),
    );
  } finally {
    backupDb.close();
  }

  const db = new Database(sqlitePath);
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  let backupPath = null;

  try {
    const accounts = readAccounts(db);
    const justinAccounts = accounts.filter(isJustinAccount);
    const restoreAccounts = justinAccounts.filter(
      (account) =>
        account.category === "D" &&
        previousCategoryByAccountRecordId.get(account.accountRecordId) === "C",
    );

    if (options.apply && restoreAccounts.length > 0) {
      backupPath = await createBackup(db, sqlitePath, safeTimestamp, "justin-c-restore-preapply");
      const sourceTables = [
        "account_rows",
        ...(tableExists(db, "local_account_rows") ? ["local_account_rows"] : []),
      ];
      const upsertMetadata = db.prepare(`
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
          company_description = COALESCE(account_local_metadata.company_description, excluded.company_description),
          category = excluded.category,
          marketing_eligible = account_local_metadata.marketing_eligible,
          updated_at = excluded.updated_at
      `);
      const txn = db.transaction(() => {
        for (const account of restoreAccounts) {
          const existingMetadata = account.metadata || {};
          upsertMetadata.run({
            account_record_id: account.accountRecordId,
            business_account_id: account.businessAccountId,
            company_description: existingMetadata.companyDescription || null,
            category: "C",
            marketing_eligible: existingMetadata.marketingEligible === false ? 0 : 1,
            updated_at: timestamp,
          });
          for (const tableName of sourceTables) {
            updateCategoryOnSourceRows(db, tableName, account, "C", timestamp);
          }
        }
      });
      txn();
    }

    const finalJustinAccounts = options.apply ? readAccounts(db).filter(isJustinAccount) : justinAccounts;
    const report = {
      ok: true,
      mode: options.apply ? "apply" : "dry-run",
      backupSourcePath,
      backupPath,
      justinAccountTotal: justinAccounts.length,
      restoreTotal: restoreAccounts.length,
      justinCategoryCountsBefore: countCategories(justinAccounts),
      justinCategoryCountsAfter: options.apply
        ? countCategories(finalJustinAccounts)
        : null,
      restoreSamples: restoreAccounts.slice(0, 25).map(summarizeAccount),
    };
    const output = JSON.stringify(report);
    if (options.reportPath) {
      fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${output}\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
