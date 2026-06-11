#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Reassigns route weeks for every sales rep: each rep's category A/B
// accounts are clustered into 12 balanced, geographically compact groups
// (Week 1-12) so the rep can drive between same-week accounts quickly.
// Accounts without coordinates are spread across the lightest weeks.

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const {
  WEEK_COUNT,
  DEFAULT_SQLITE_PATH,
  normalizeText,
  quoteIdentifier,
  tableExists,
  readTableColumns,
  parsePayload,
  readAccounts,
  mostCommonText,
  summarizeAccount,
  hasCoordinate,
  projectPoints,
  findFarthestPair,
  assignRouteWeeks,
  createBackup,
  ensureRouteWeekTables,
} = require("./route-weeks-shared.cjs");

const ASSIGNMENT_VERSION_PREFIX = "rep-proximity-ab";
const ASSIGNMENT_REASON_PREFIX = "rep_proximity";

function parseArgs(argv) {
  const options = {
    apply: false,
    sqlitePath: process.env.READ_MODEL_SQLITE_PATH || DEFAULT_SQLITE_PATH,
    clusterIterations: 40,
    clearNonAbWeeks: true,
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
    } else if (arg === "--cluster-iterations") {
      options.clusterIterations = Number(argv[++index]);
    } else if (arg === "--clear-non-ab-weeks") {
      options.clearNonAbWeeks = true;
    } else if (arg === "--keep-non-ab-weeks") {
      options.clearNonAbWeeks = false;
    } else if (arg === "--report") {
      options.reportPath = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.clusterIterations) || options.clusterIterations <= 0) {
    throw new Error("--cluster-iterations must be a positive integer.");
  }

  return options;
}

function repKey(account) {
  const name = normalizeText(account.salesRepName);
  if (name) {
    return `name:${name.toLowerCase()}`;
  }
  return `id:${normalizeText(account.salesRepId)}`;
}

function isRoutableAccount(account) {
  return (
    (account.category === "A" || account.category === "B") &&
    Boolean(normalizeText(account.salesRepId) || normalizeText(account.salesRepName))
  );
}

function buildWeekCounts(assignments) {
  const counts = {};
  for (const assignment of assignments) {
    const label = `Week ${assignment.assignedWeek}`;
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function computeRepSpatialStats(assignments) {
  const grouped = new Map();
  for (const assignment of assignments) {
    if (!hasCoordinate(assignment)) {
      continue;
    }
    const group = grouped.get(assignment.assignedWeek) || [];
    group.push(assignment);
    grouped.set(assignment.assignedWeek, group);
  }
  return [...grouped.entries()]
    .map(([week, points]) => {
      const projected = points.every((point) => Number.isFinite(point.x))
        ? points
        : projectPoints(points);
      const farthestPair = findFarthestPair(projected);
      return {
        week: `Week ${week}`,
        count: points.length,
        diameterKm: Number(farthestPair.distanceKm.toFixed(2)),
        farthestPair: farthestPair.accounts.map((account) => ({
          companyName: account.companyName,
          city: account.city,
          latitude: account.latitude,
          longitude: account.longitude,
        })),
      };
    })
    .sort((left, right) => Number(left.week.replace(/\D/g, "")) - Number(right.week.replace(/\D/g, "")));
}

function findCountBalanceViolations(weekCounts, totalCount) {
  const expectedFloor = Math.floor(totalCount / WEEK_COUNT);
  const counts = Array.from({ length: WEEK_COUNT }, (_, index) =>
    totalCount >= WEEK_COUNT ? weekCounts[`Week ${index + 1}`] || 0 : null,
  ).filter((count) => count !== null);
  return counts.some((count) => count < expectedFloor || count > expectedFloor + 1)
    ? { expectedFloor, weekCounts }
    : null;
}

function updateWeekOnSourceRows(db, tableName, account, weekLabel, timestamp) {
  const columns = readTableColumns(db, tableName);
  if (columns.size === 0 || !columns.has("week")) {
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

  const setClauses = ["week = @week"];
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
        ? JSON.stringify({ ...payload, week: weekLabel })
        : row.payload_json;
    updated += statement.run({
      row_id: row.row_id,
      week: weekLabel,
      payload_json: nextPayload,
      updated_at: timestamp,
    }).changes;
  }

  return updated;
}

function applyAssignments(db, plan, sourceTables, assignmentVersion, timestamp) {
  ensureRouteWeekTables(db);
  const insertRouteWeek = db.prepare(`
    INSERT INTO account_route_weeks (
      account_record_id,
      business_account_id,
      sales_rep_id,
      sales_rep_name,
      category,
      route_week,
      route_week_label,
      latitude,
      longitude,
      assignment_version,
      assignment_reason,
      updated_at
    ) VALUES (
      @account_record_id,
      @business_account_id,
      @sales_rep_id,
      @sales_rep_name,
      @category,
      @route_week,
      @route_week_label,
      @latitude,
      @longitude,
      @assignment_version,
      @assignment_reason,
      @updated_at
    )
    ON CONFLICT(account_record_id) DO UPDATE SET
      business_account_id = excluded.business_account_id,
      sales_rep_id = excluded.sales_rep_id,
      sales_rep_name = excluded.sales_rep_name,
      category = excluded.category,
      route_week = excluded.route_week,
      route_week_label = excluded.route_week_label,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      assignment_version = excluded.assignment_version,
      assignment_reason = excluded.assignment_reason,
      updated_at = excluded.updated_at
  `);

  const txn = db.transaction(() => {
    db.prepare(
      "CREATE TEMP TABLE rep_route_candidate_ids (account_record_id TEXT PRIMARY KEY)",
    ).run();
    const insertCandidateId = db.prepare(
      "INSERT OR IGNORE INTO rep_route_candidate_ids VALUES (?)",
    );

    for (const assignment of plan.assignments) {
      insertCandidateId.run(assignment.accountRecordId);
      insertRouteWeek.run({
        account_record_id: assignment.accountRecordId,
        business_account_id: assignment.businessAccountId,
        sales_rep_id: assignment.salesRepId,
        sales_rep_name: assignment.salesRepName,
        category: assignment.category,
        route_week: assignment.assignedWeek,
        route_week_label: `Week ${assignment.assignedWeek}`,
        latitude: assignment.latitude,
        longitude: assignment.longitude,
        assignment_version: assignmentVersion,
        assignment_reason: assignment.assignmentReason,
        updated_at: timestamp,
      });
      for (const tableName of sourceTables) {
        updateWeekOnSourceRows(
          db,
          tableName,
          assignment,
          `Week ${assignment.assignedWeek}`,
          timestamp,
        );
      }
    }

    for (const account of plan.weekClearAccounts) {
      for (const tableName of sourceTables) {
        updateWeekOnSourceRows(db, tableName, account, null, timestamp);
      }
    }

    db.prepare(
      `
      DELETE FROM account_route_weeks
      WHERE account_record_id NOT IN (SELECT account_record_id FROM rep_route_candidate_ids)
      `,
    ).run();
    db.prepare("DROP TABLE rep_route_candidate_ids").run();

    if (tableExists(db, "sync_state")) {
      db.prepare(
        `
        UPDATE sync_state
        SET completed_at = ?,
            last_successful_sync_at = ?,
            last_error = NULL,
            phase = NULL,
            progress_json = NULL
        WHERE scope = 'full'
        `,
      ).run(timestamp, timestamp);
    }
  });

  txn();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(options.sqlitePath);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }

  const db = new Database(sqlitePath);
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const assignmentVersion = `${ASSIGNMENT_VERSION_PREFIX}-${safeTimestamp}`;
  let backupPath = null;

  try {
    ensureRouteWeekTables(db);
    const accounts = readAccounts(db);
    const routable = accounts.filter(isRoutableAccount);

    const repGroups = new Map();
    for (const account of routable) {
      const key = repKey(account);
      const group = repGroups.get(key) || [];
      group.push(account);
      repGroups.set(key, group);
    }

    const assignments = [];
    const repReports = [];
    for (const [key, repAccounts] of [...repGroups.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      const repAssignments = assignRouteWeeks(
        repAccounts,
        options.clusterIterations,
        ASSIGNMENT_REASON_PREFIX,
      );
      assignments.push(...repAssignments);
      const weekCounts = buildWeekCounts(repAssignments);
      const spatialStats = computeRepSpatialStats(repAssignments);
      repReports.push({
        repKey: key,
        salesRepName: mostCommonText(repAccounts.map((account) => account.salesRepName)),
        salesRepId: mostCommonText(repAccounts.map((account) => account.salesRepId)),
        accountTotal: repAccounts.length,
        geocodedTotal: repAccounts.filter(hasCoordinate).length,
        unmappedTotal: repAccounts.filter((account) => !hasCoordinate(account)).length,
        weekCounts,
        countBalanceViolation: findCountBalanceViolations(weekCounts, repAccounts.length),
        spatialStats,
        widestWeek: [...spatialStats].sort((left, right) => right.diameterKm - left.diameterKm)[0] || null,
      });
    }

    const weekClearAccounts = options.clearNonAbWeeks
      ? accounts.filter(
          (account) =>
            !isRoutableAccount(account) &&
            Boolean(normalizeText(account.salesRepId) || normalizeText(account.salesRepName)) &&
            Boolean(normalizeText(account.week)),
        )
      : [];

    const plan = { assignments, weekClearAccounts };

    if (options.apply) {
      backupPath = await createBackup(db, sqlitePath, safeTimestamp, "rep-route-weeks-preapply");
      const sourceTables = [
        "account_rows",
        ...(tableExists(db, "local_account_rows") ? ["local_account_rows"] : []),
      ];
      applyAssignments(db, plan, sourceTables, assignmentVersion, timestamp);
    }

    const report = {
      ok: true,
      mode: options.apply ? "apply" : "dry-run",
      assignmentVersion,
      backupPath,
      options: {
        clusterIterations: options.clusterIterations,
        clearNonAbWeeks: options.clearNonAbWeeks,
      },
      accountTotal: accounts.length,
      routableAccountTotal: routable.length,
      repTotal: repGroups.size,
      assignedTotal: assignments.length,
      weekClearTotal: weekClearAccounts.length,
      reps: repReports,
      weekClearSamples: weekClearAccounts.slice(0, 15).map(summarizeAccount),
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
