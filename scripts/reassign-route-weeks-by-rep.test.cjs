/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Database = require("better-sqlite3");

const SCRIPT_PATH = path.join(__dirname, "reassign-route-weeks-by-rep.cjs");

function createFixture(reverse = false) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rep-route-weeks-test-"));
  const sqlitePath = path.join(tempDir, "read-model.sqlite");
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE account_rows (
      row_key TEXT PRIMARY KEY,
      id TEXT,
      account_record_id TEXT,
      business_account_id TEXT,
      company_name TEXT,
      address TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state TEXT,
      postal_code TEXT,
      country TEXT,
      address_key TEXT,
      sales_rep_id TEXT,
      sales_rep_name TEXT,
      category TEXT,
      week TEXT,
      is_primary_contact INTEGER,
      payload_json TEXT,
      updated_at TEXT
    );
    CREATE TABLE address_geocodes (
      address_key TEXT PRIMARY KEY,
      latitude REAL,
      longitude REAL,
      provider TEXT,
      status TEXT
    );
    CREATE TABLE account_route_weeks (
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
  `);

  const accounts = [];
  for (let index = 1; index <= 25; index += 1) {
    accounts.push({
      accountRecordId: `jeff-${String(index).padStart(2, "0")}`,
      businessAccountId: `J${String(index).padStart(3, "0")}`,
      companyName: `Jeff Account ${String(index).padStart(2, "0")}`,
      salesRepId: "109337",
      salesRepName: "Jeffery Buhagiar",
      category: index % 2 === 0 ? "A" : "B",
      week: "Week 1",
      latitude: index <= 23 ? 43.4 + index * 0.01 : null,
      longitude: index <= 23 ? -79.9 + index * 0.012 : null,
    });
  }
  for (let index = 1; index <= 12; index += 1) {
    accounts.push({
      accountRecordId: `other-${String(index).padStart(2, "0")}`,
      businessAccountId: `O${String(index).padStart(3, "0")}`,
      companyName: `Other Account ${String(index).padStart(2, "0")}`,
      salesRepId: "999999",
      salesRepName: "Other Rep",
      category: "A",
      week: "Week 4",
      latitude: 44 + index * 0.01,
      longitude: -80 + index * 0.01,
    });
  }
  accounts.push({
    accountRecordId: "jeff-category-c",
    businessAccountId: "JC001",
    companyName: "Jeff Category C",
    salesRepId: "109337",
    salesRepName: "Jeffery Buhagiar",
    category: "C",
    week: "Week 6",
    latitude: 43.6,
    longitude: -79.6,
  });

  const insertAccount = db.prepare(`
    INSERT INTO account_rows (
      row_key, id, account_record_id, business_account_id, company_name,
      address, address_line1, city, state, postal_code, country, address_key,
      sales_rep_id, sales_rep_name, category, week, is_primary_contact,
      payload_json, updated_at
    ) VALUES (
      @rowKey, @accountRecordId, @accountRecordId, @businessAccountId, @companyName,
      @address, @address, @city, 'ON', @postalCode, 'Canada', @addressKey,
      @salesRepId, @salesRepName, @category, @week, 1, @payloadJson, @updatedAt
    )
  `);
  const insertGeocode = db.prepare(`
    INSERT INTO address_geocodes (address_key, latitude, longitude, provider, status)
    VALUES (?, ?, ?, 'fixture', 'ready')
  `);
  for (const [index, account] of (reverse ? [...accounts].reverse() : accounts).entries()) {
    const addressKey = `address-${account.accountRecordId}`;
    const address = `${index + 1} Test Street`;
    insertAccount.run({
      ...account,
      rowKey: `${account.accountRecordId}:primary`,
      address,
      city: "Test City",
      postalCode: `L5A ${String(index).padStart(3, "0")}`,
      addressKey,
      payloadJson: JSON.stringify({ ...account, addressLine1: address, addressKey }),
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    if (account.latitude !== null && account.longitude !== null) {
      insertGeocode.run(addressKey, account.latitude, account.longitude);
    }
  }

  const insertRouteWeek = db.prepare(`
    INSERT INTO account_route_weeks (
      account_record_id, business_account_id, sales_rep_id, sales_rep_name,
      category, route_week, route_week_label, latitude, longitude,
      assignment_version, assignment_reason, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fixture', 'fixture', '2026-01-01T00:00:00.000Z')
  `);
  insertRouteWeek.run(
    "jeff-01",
    "J001",
    "109337",
    "Jeffery Buhagiar",
    "B",
    7,
    "Week 7",
    43.41,
    -79.888,
  );
  insertRouteWeek.run(
    "other-01",
    "O001",
    "999999",
    "Other Rep",
    "A",
    12,
    "Week 12",
    44.01,
    -79.99,
  );
  insertRouteWeek.run(
    "jeff-category-c",
    "JC001",
    "109337",
    "Jeffery Buhagiar",
    "C",
    6,
    "Week 6",
    43.6,
    -79.6,
  );
  db.close();
  return { tempDir, sqlitePath };
}

function runScript(sqlitePath, mode) {
  const stdout = execFileSync(
    process.execPath,
    [
      SCRIPT_PATH,
      mode,
      "--sqlite-path",
      sqlitePath,
      "--sales-rep-id",
      "109337",
      "--sales-rep-name",
      "Jeffery Buhagiar",
      "--keep-non-ab-weeks",
      "--include-assignments",
      "--cluster-iterations",
      "50",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
}

function assignmentMap(report) {
  return Object.fromEntries(
    report.assignments.map((assignment) => [assignment.accountRecordId, assignment.assignedWeek]),
  );
}

test("targeted dry-run is deterministic, complete, and balanced", () => {
  const first = createFixture(false);
  const reversed = createFixture(true);
  try {
    const firstReport = runScript(first.sqlitePath, "--dry-run");
    const reversedReport = runScript(reversed.sqlitePath, "--dry-run");

    assert.equal(firstReport.assignedTotal, 25);
    assert.equal(firstReport.repTotal, 1);
    assert.equal(firstReport.reps[0].geocodedTotal, 23);
    assert.equal(firstReport.reps[0].unmappedTotal, 2);
    assert.equal(firstReport.reps[0].countBalanceViolation, null);
    assert.equal(firstReport.assignments.length, 25);
    assert.deepEqual(assignmentMap(firstReport), assignmentMap(reversedReport));

    const counts = Object.values(firstReport.reps[0].weekCounts);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), 25);
    assert.ok(counts.every((count) => count === 2 || count === 3));
    assert.equal(
      firstReport.assignments.find((assignment) => assignment.accountRecordId === "jeff-01")
        .previousWeek,
      "Week 7",
    );
  } finally {
    fs.rmSync(first.tempDir, { recursive: true, force: true });
    fs.rmSync(reversed.tempDir, { recursive: true, force: true });
  }
});

test("targeted apply changes only the requested rep's A/B accounts", () => {
  const fixture = createFixture(false);
  try {
    const report = runScript(fixture.sqlitePath, "--apply");
    assert.equal(report.mode, "apply");
    assert.ok(report.backupPath);

    const db = new Database(fixture.sqlitePath, { readonly: true });
    try {
      const jeffWeeks = db
        .prepare(
          `SELECT DISTINCT week FROM account_rows WHERE sales_rep_id = '109337' AND category IN ('A', 'B')`,
        )
        .all()
        .map((row) => row.week);
      assert.equal(jeffWeeks.length, 12);
      assert.equal(
        db.prepare("SELECT week FROM account_rows WHERE account_record_id = 'jeff-category-c'").get()
          .week,
        "Week 6",
      );
      assert.equal(
        db.prepare("SELECT week FROM account_rows WHERE account_record_id = 'other-01'").get().week,
        "Week 4",
      );
      assert.equal(
        db
          .prepare(
            "SELECT route_week_label FROM account_route_weeks WHERE account_record_id = 'other-01'",
          )
          .get().route_week_label,
        "Week 12",
      );
      assert.equal(
        db
          .prepare(
            "SELECT route_week_label FROM account_route_weeks WHERE account_record_id = 'jeff-category-c'",
          )
          .get().route_week_label,
        "Week 6",
      );
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM account_route_weeks WHERE sales_rep_id = '109337' AND category IN ('A', 'B')",
          )
          .get().count,
        25,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(fixture.tempDir, { recursive: true, force: true });
  }
});
