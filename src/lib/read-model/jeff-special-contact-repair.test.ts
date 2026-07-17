/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- exercises the production ESM repair module against SQLite fixtures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildJeffSpecialReportPlan } from "../jeff-special-report";
import { applyJeffSpecialContactRepair } from "./jeff-special-contact-repair.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const specs = JSON.parse(
  fs.readFileSync(path.join(moduleDir, "jeff-special-contact-repairs.json"), "utf8"),
);
const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-special-contact-repair-"));
  tempDirs.push(tempDir);
  const sqlitePath = path.join(tempDir, "read-model.sqlite");
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE account_rows (
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
      company_phone TEXT,
      company_phone_source TEXT,
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
      last_called_at TEXT,
      last_calendar_invited_at TEXT,
      last_modified_iso TEXT,
      search_text TEXT NOT NULL,
      address_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return { db, sqlitePath };
}

function accountRow(spec, overrides = {}) {
  const contactId = overrides.contactId ?? null;
  const accountRecordId = overrides.accountRecordId ?? spec.accountRecordId;
  return {
    id: accountRecordId,
    accountRecordId,
    rowKey: `${accountRecordId}:contact:${contactId ?? "row"}`,
    contactId,
    isPrimaryContact: overrides.isPrimaryContact ?? false,
    companyPhone: null,
    companyPhoneSource: null,
    phoneNumber: null,
    salesRepId: "109337",
    salesRepName: "Jeffery Buhagiar",
    accountType: "Customer",
    opportunityCount: null,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: overrides.businessAccountId ?? spec.businessAccountId,
    companyName: overrides.companyName ?? spec.companyName,
    companyDescription: null,
    address: overrides.address ?? spec.address,
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "CA",
    primaryContactName: overrides.primaryContactName ?? null,
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? null,
    primaryContactPhone: overrides.primaryContactPhone ?? null,
    primaryContactExtension: overrides.primaryContactExtension ?? null,
    primaryContactRawPhone: overrides.primaryContactPhone ?? null,
    primaryContactEmail: overrides.primaryContactEmail ?? null,
    primaryContactId: overrides.primaryContactId ?? null,
    category: "A",
    notes: null,
    lastCalledAt: null,
    lastCalendarInvitedAt: null,
    lastModifiedIso: "2026-07-13T00:00:00.000Z",
  };
}

function insertRow(db, row) {
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
      @is_primary_contact, @company_name, @address, '', '', '', '', '', 'CA',
      NULL, NULL, NULL, @sales_rep_id, @sales_rep_name, NULL, NULL, NULL, NULL,
      @primary_contact_name, @primary_contact_phone, @primary_contact_email,
      @primary_contact_id, 'A', NULL, NULL, NULL, @last_modified_iso, '', '',
      @payload_json, @updated_at
    )
    `,
  ).run({
    row_key: row.rowKey,
    id: row.id,
    account_record_id: row.accountRecordId,
    business_account_id: row.businessAccountId,
    contact_id: row.contactId,
    is_primary_contact: row.isPrimaryContact ? 1 : 0,
    company_name: row.companyName,
    address: row.address,
    sales_rep_id: row.salesRepId,
    sales_rep_name: row.salesRepName,
    primary_contact_name: row.primaryContactName,
    primary_contact_phone: row.primaryContactPhone,
    primary_contact_email: row.primaryContactEmail,
    primary_contact_id: row.primaryContactId,
    last_modified_iso: row.lastModifiedIso,
    payload_json: JSON.stringify(row),
    updated_at: row.lastModifiedIso,
  });
}

function readRows(db, accountRecordId) {
  return db
    .prepare(
      `
      SELECT contact_id, is_primary_contact, primary_contact_id, payload_json
      FROM account_rows
      WHERE account_record_id = ?
      ORDER BY contact_id ASC
      `,
    )
    .all(accountRecordId)
    .map((row) => ({
      ...row,
      payload: JSON.parse(row.payload_json),
    }));
}

describe("Jeff special contact repair", () => {
  it("creates each missing source contact once and makes it primary when the account has no primary", async () => {
    const { db, sqlitePath } = createDatabase();
    for (const spec of specs) {
      insertRow(db, accountRow(spec));
    }
    db.close();

    const first = await applyJeffSpecialContactRepair({ enabled: true, sqlitePath });
    expect(first.status).toBe("applied");
    expect(first.sourceContactCount).toBe(14);
    expect(first.matchedAccountCount).toBe(14);
    expect(first.missingAccounts).toEqual([]);
    expect(first.actionCounts).toEqual({ created_primary: 14 });

    const verifyDb = new Database(sqlitePath);
    const reportRows = [];
    for (const spec of specs) {
      const rows = readRows(verifyDb, spec.accountRecordId);
      expect(rows).toHaveLength(1);
      expect(rows[0].is_primary_contact).toBe(1);
      expect(rows[0].contact_id).toBe(rows[0].primary_contact_id);
      expect(rows[0].payload.primaryContactName).toBe(spec.contact.displayName);
      reportRows.push(rows[0].payload);
    }
    verifyDb.close();

    const report = buildJeffSpecialReportPlan(
      reportRows,
      new Date("2026-07-17T12:00:00.000Z"),
    );
    const reportVisits = report.weeks.flatMap((week) => week.visits);
    for (const spec of specs) {
      const visit = reportVisits.find((entry) => entry.companyName === spec.companyName);
      expect(visit?.contactName).toBe(spec.contact.displayName);
    }

    const second = await applyJeffSpecialContactRepair({ enabled: true, sqlitePath });
    expect(second.status).toBe("already_applied");
    expect(second.changedAccountCount).toBe(0);
    expect(second.actionCounts).toEqual({ verified_primary: 14 });

    const finalDb = new Database(sqlitePath);
    expect(finalDb.prepare("SELECT COUNT(*) AS count FROM account_rows").get().count).toBe(14);
    finalDb.close();
  });

  it("reuses an existing contact instead of creating a duplicate", async () => {
    const agility = specs.find((spec) => spec.companyName === "Agility Tooling");
    const { db, sqlitePath } = createDatabase();
    insertRow(
      db,
      accountRow(agility, {
        contactId: 12345,
        primaryContactName: "Stefan Mouradian",
        primaryContactEmail: "stefan.mouradian@agilitytooling.com",
      }),
    );
    db.close();

    const result = await applyJeffSpecialContactRepair({ enabled: true, sqlitePath });
    const agilityResult = result.results.find((entry) => entry.companyName === "Agility Tooling");
    expect(agilityResult.action).toBe("updated_primary");
    expect(agilityResult.contactId).toBe(12345);

    const verifyDb = new Database(sqlitePath);
    const rows = readRows(verifyDb, agility.accountRecordId);
    expect(rows).toHaveLength(1);
    expect(rows[0].contact_id).toBe(12345);
    expect(rows[0].is_primary_contact).toBe(1);
    expect(rows[0].payload.primaryContactJobTitle).toBe("Maintenance Manager");
    verifyDb.close();
  });

  it("preserves a different valid primary while adding the missing source contact", async () => {
    const descon = specs.find((spec) => spec.companyName === "Descon Conveyor Systems");
    const { db, sqlitePath } = createDatabase();
    insertRow(
      db,
      accountRow(descon, {
        contactId: 222,
        isPrimaryContact: true,
        primaryContactId: 222,
        primaryContactName: "Current Primary",
        primaryContactEmail: "current@example.com",
      }),
    );
    db.close();

    const result = await applyJeffSpecialContactRepair({ enabled: true, sqlitePath });
    const desconResult = result.results.find((entry) => entry.companyName === descon.companyName);
    expect(desconResult.action).toBe("created_preserved_existing_primary");
    expect(desconResult.primaryContactName).toBe("Current Primary");

    const verifyDb = new Database(sqlitePath);
    const rows = readRows(verifyDb, descon.accountRecordId);
    expect(rows).toHaveLength(2);
    const current = rows.find((row) => row.contact_id === 222);
    const steve = rows.find((row) => row.payload.primaryContactName === "Steve Nixon");
    expect(current.is_primary_contact).toBe(1);
    expect(steve.is_primary_contact).toBe(0);
    expect(steve.primary_contact_id).toBe(222);
    verifyDb.close();
  });

  it("does not use a shared address when the company identity does not match", async () => {
    const generalConveyor = specs.find((spec) => spec.companyName === "General Conveyor Inc.");
    const { db, sqlitePath } = createDatabase();
    insertRow(
      db,
      accountRow(generalConveyor, {
        accountRecordId: "different-tenant-record",
        businessAccountId: "DIFFERENT-TENANT",
        companyName: "Unrelated Tenant Ltd.",
      }),
    );
    db.close();

    const result = await applyJeffSpecialContactRepair({ enabled: true, sqlitePath });
    expect(result.matchedAccountCount).toBe(0);
    expect(result.missingAccounts).toHaveLength(14);

    const verifyDb = new Database(sqlitePath);
    const stored = verifyDb.prepare("SELECT contact_id FROM account_rows").all();
    expect(stored).toEqual([{ contact_id: null }]);
    verifyDb.close();
  });
});
