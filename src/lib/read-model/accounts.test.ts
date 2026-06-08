import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(
  overrides: Partial<BusinessAccountRow> & {
    id: string;
    accountRecordId?: string;
    contactId?: number | null;
    primaryContactId?: number | null;
  },
): BusinessAccountRow {
  return {
    id: overrides.id,
    accountRecordId: overrides.accountRecordId ?? overrides.id,
    rowKey:
      overrides.rowKey ??
      `${overrides.accountRecordId ?? overrides.id}:contact:${overrides.contactId ?? "row"}`,
    contactId: overrides.contactId ?? null,
    isPrimaryContact: overrides.isPrimaryContact ?? false,
    companyPhone: overrides.companyPhone ?? null,
    companyPhoneSource: overrides.companyPhoneSource ?? null,
    phoneNumber: overrides.phoneNumber ?? null,
    salesRepId: overrides.salesRepId ?? null,
    salesRepName: overrides.salesRepName ?? null,
    industryType: overrides.industryType ?? null,
    subCategory: overrides.subCategory ?? null,
    companyRegion: overrides.companyRegion ?? null,
    week: overrides.week ?? null,
    businessAccountId: overrides.businessAccountId ?? "BA-1",
    companyName: overrides.companyName ?? "Example Company",
    address: overrides.address ?? "123 Main St",
    addressLine1: overrides.addressLine1 ?? "123 Main St",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Toronto",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "M5H 2N2",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? "Example Contact",
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? null,
    primaryContactPhone: overrides.primaryContactPhone ?? "905-555-0100",
    primaryContactExtension: overrides.primaryContactExtension ?? null,
    primaryContactRawPhone: overrides.primaryContactRawPhone ?? null,
    primaryContactEmail: overrides.primaryContactEmail ?? "contact@example.com",
    primaryContactId: overrides.primaryContactId ?? overrides.contactId ?? null,
    category: overrides.category ?? null,
    notes: overrides.notes ?? null,
    lastEmailedAt: overrides.lastEmailedAt ?? null,
    lastCalledAt: overrides.lastCalledAt ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-03-13T00:00:00.000Z",
  };
}

describe("readBusinessAccountDetailFromReadModel", () => {
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "read-model-accounts-test-"));
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.ACUMATICA_BASE_URL = "https://example.invalid";
    process.env.ACUMATICA_COMPANY = "Test Company";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
  });

  afterEach(() => {
    closeDb?.();
    closeDb = null;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the requested contact row when contactId is provided", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        contactId: 101,
        isPrimaryContact: true,
        primaryContactName: "Primary Contact",
        primaryContactJobTitle: "Owner",
      }),
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        contactId: 202,
        isPrimaryContact: false,
        primaryContactName: "Filtered Contact",
        primaryContactJobTitle: "Buyer",
      }),
    ]);

    const detail = readModelAccounts.readBusinessAccountDetailFromReadModel("account-1", 202);

    expect(detail?.row.contactId).toBe(202);
    expect(detail?.row.primaryContactJobTitle).toBe("Buyer");
  });

  it("falls back to the primary row when the requested contact is missing", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        contactId: 101,
        isPrimaryContact: true,
        primaryContactName: "Primary Contact",
        primaryContactJobTitle: "Owner",
      }),
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        contactId: 202,
        isPrimaryContact: false,
        primaryContactName: "Filtered Contact",
        primaryContactJobTitle: "Buyer",
      }),
    ]);

    const detail = readModelAccounts.readBusinessAccountDetailFromReadModel("account-1", 999);

    expect(detail?.row.contactId).toBe(101);
    expect(detail?.row.primaryContactJobTitle).toBe("Owner");
  });

  it("removes contactless placeholder rows when a concrete row exists for the same contact", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:row",
        contactId: null,
        primaryContactId: 202,
        primaryContactName: "Duplicated Contact",
        primaryContactEmail: "duplicate@example.com",
        isPrimaryContact: false,
      }),
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:202",
        contactId: 202,
        primaryContactId: 202,
        primaryContactName: "Duplicated Contact",
        primaryContactEmail: "duplicate@example.com",
        isPrimaryContact: true,
      }),
    ]);

    const rows = readModelAccounts.readStoredBusinessAccountRowsFromReadModel("account-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowKey).toBe("account-1:contact:202");
    expect(rows[0]?.contactId).toBe(202);
  });

  it("reads account details directly from sqlite instead of the full snapshot cache", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:202",
        contactId: 202,
        isPrimaryContact: true,
        primaryContactName: "Cached Contact",
        primaryContactPhone: "905-555-0000",
      }),
      buildRow({
        id: "account-2",
        accountRecordId: "account-2",
        rowKey: "account-2:contact:303",
        contactId: 303,
        isPrimaryContact: true,
        primaryContactName: "Other Contact",
      }),
    ]);

    const cachedRows = readModelAccounts.readAllAccountRowsFromReadModel();
    expect(cachedRows.find((row) => row.accountRecordId === "account-1")?.primaryContactPhone).toBe(
      "905-555-0000",
    );

    const replacementRow = buildRow({
      id: "account-1",
      accountRecordId: "account-1",
      rowKey: "account-1:contact:202",
      contactId: 202,
      isPrimaryContact: true,
      primaryContactName: "Fresh Contact",
      primaryContactPhone: "905-555-9999",
    });

    getReadModelDb()
      .prepare(
        `
        UPDATE account_rows
        SET payload_json = ?,
            primary_contact_name = ?,
            primary_contact_phone = ?
        WHERE row_key = ?
        `,
      )
      .run(
        JSON.stringify(replacementRow),
        replacementRow.primaryContactName,
        replacementRow.primaryContactPhone,
        replacementRow.rowKey,
      );

    const detail = readModelAccounts.readBusinessAccountDetailFromReadModel("account-1", 202);

    expect(detail?.row.primaryContactName).toBe("Fresh Contact");
    expect(detail?.row.primaryContactPhone).toBe("905-555-9999");
  });

  it("reloads rows when sqlite changes outside the current process cache", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        contactId: 202,
        isPrimaryContact: false,
        primaryContactName: "Andy McMullen",
        primaryContactPhone: null,
        primaryContactRawPhone: "19058299927",
      }),
    ]);

    const initialRows = readModelAccounts.readAllAccountRowsFromReadModel();
    expect(initialRows[0]?.primaryContactRawPhone).toBe("19058299927");

    const db = getReadModelDb();
    const replacementRow = buildRow({
      id: "account-1",
      accountRecordId: "account-1",
      contactId: 202,
      isPrimaryContact: false,
      primaryContactName: "Andy McMullen",
      primaryContactPhone: "905-829-9927",
      primaryContactRawPhone: "905-829-9927",
    });
    db.prepare(
      `
      UPDATE account_rows
      SET payload_json = ?,
          primary_contact_phone = ?,
          updated_at = ?
      WHERE row_key = ?
      `,
    ).run(
      JSON.stringify(replacementRow),
      replacementRow.primaryContactPhone,
      "2026-03-13T17:30:00.000Z",
      replacementRow.rowKey,
    );

    const refreshedRows = readModelAccounts.readAllAccountRowsFromReadModel();
    expect(refreshedRows[0]?.primaryContactRawPhone).toBe("905-829-9927");
    expect(refreshedRows[0]?.primaryContactPhone).toBe("905-829-9927");
  });

  it("does not rebuild last-called metadata while reading the account snapshot", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:202",
        contactId: 202,
        primaryContactId: 202,
        primaryContactName: "Andy McMullen",
        primaryContactPhone: "905-829-9927",
      }),
    ]);

    const initialRows = readModelAccounts.readAllAccountRowsFromReadModel();
    expect(initialRows[0]?.lastCalledAt ?? null).toBeNull();

    const db = getReadModelDb();
    db.prepare(
      `
      INSERT INTO call_sessions (
        session_id,
        root_call_sid,
        primary_leg_sid,
        source,
        direction,
        outcome,
        answered,
        started_at,
        answered_at,
        ended_at,
        talk_duration_seconds,
        ring_duration_seconds,
        employee_login_name,
        employee_display_name,
        employee_contact_id,
        employee_phone,
        recipient_employee_login_name,
        recipient_employee_display_name,
        presented_caller_id,
        bridge_number,
        target_phone,
        counterparty_phone,
        matched_contact_id,
        matched_contact_name,
        matched_business_account_id,
        matched_company_name,
        phone_match_type,
        phone_match_ambiguity_count,
        initiated_from_surface,
        linked_account_row_key,
        linked_business_account_id,
        linked_contact_id,
        metadata_json,
        updated_at
      ) VALUES (
        @session_id,
        @root_call_sid,
        @primary_leg_sid,
        @source,
        @direction,
        @outcome,
        @answered,
        @started_at,
        @answered_at,
        @ended_at,
        @talk_duration_seconds,
        @ring_duration_seconds,
        @employee_login_name,
        @employee_display_name,
        @employee_contact_id,
        @employee_phone,
        @recipient_employee_login_name,
        @recipient_employee_display_name,
        @presented_caller_id,
        @bridge_number,
        @target_phone,
        @counterparty_phone,
        @matched_contact_id,
        @matched_contact_name,
        @matched_business_account_id,
        @matched_company_name,
        @phone_match_type,
        @phone_match_ambiguity_count,
        @initiated_from_surface,
        @linked_account_row_key,
        @linked_business_account_id,
        @linked_contact_id,
        @metadata_json,
        @updated_at
      )
      `,
    ).run({
      session_id: "call-1",
      root_call_sid: "CA-root",
      primary_leg_sid: "CA-leg",
      source: "app_bridge",
      direction: "outbound",
      outcome: "answered",
      answered: 1,
      started_at: "2026-04-12T16:30:00.000Z",
      answered_at: "2026-04-12T16:30:03.000Z",
      ended_at: "2026-04-12T16:36:00.000Z",
      talk_duration_seconds: 357,
      ring_duration_seconds: 3,
      employee_login_name: "jserrano",
      employee_display_name: "Jorge Serrano",
      employee_contact_id: 157497,
      employee_phone: "+14162304681",
      recipient_employee_login_name: null,
      recipient_employee_display_name: null,
      presented_caller_id: "+14162304681",
      bridge_number: "+16474929859",
      target_phone: "+19058299927",
      counterparty_phone: "+19058299927",
      matched_contact_id: 202,
      matched_contact_name: "Andy McMullen",
      matched_business_account_id: "BA-1",
      matched_company_name: "Example Company",
      phone_match_type: "contact_phone",
      phone_match_ambiguity_count: 1,
      initiated_from_surface: "accounts",
      linked_account_row_key: "account-1:contact:202",
      linked_business_account_id: "BA-1",
      linked_contact_id: 202,
      metadata_json: "{}",
      updated_at: "2026-04-12T16:36:00.000Z",
    });

    const refreshedRows = readModelAccounts.readAllAccountRowsFromReadModel();
    expect(refreshedRows[0]?.lastCalledAt ?? null).toBeNull();
  });

  it("writes refreshed last-called metadata back into the stored account snapshot", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:202",
        contactId: 202,
        primaryContactId: 202,
        primaryContactName: "Andy McMullen",
        primaryContactPhone: "905-829-9927",
      }),
    ]);

    const db = getReadModelDb();
    db.prepare(
      `
      INSERT INTO call_sessions (
        session_id,
        root_call_sid,
        primary_leg_sid,
        source,
        direction,
        outcome,
        answered,
        started_at,
        answered_at,
        ended_at,
        talk_duration_seconds,
        ring_duration_seconds,
        employee_login_name,
        employee_display_name,
        employee_contact_id,
        employee_phone,
        recipient_employee_login_name,
        recipient_employee_display_name,
        presented_caller_id,
        bridge_number,
        target_phone,
        counterparty_phone,
        matched_contact_id,
        matched_contact_name,
        matched_business_account_id,
        matched_company_name,
        phone_match_type,
        phone_match_ambiguity_count,
        initiated_from_surface,
        linked_account_row_key,
        linked_business_account_id,
        linked_contact_id,
        metadata_json,
        updated_at
      ) VALUES (
        @session_id,
        @root_call_sid,
        @primary_leg_sid,
        @source,
        @direction,
        @outcome,
        @answered,
        @started_at,
        @answered_at,
        @ended_at,
        @talk_duration_seconds,
        @ring_duration_seconds,
        @employee_login_name,
        @employee_display_name,
        @employee_contact_id,
        @employee_phone,
        @recipient_employee_login_name,
        @recipient_employee_display_name,
        @presented_caller_id,
        @bridge_number,
        @target_phone,
        @counterparty_phone,
        @matched_contact_id,
        @matched_contact_name,
        @matched_business_account_id,
        @matched_company_name,
        @phone_match_type,
        @phone_match_ambiguity_count,
        @initiated_from_surface,
        @linked_account_row_key,
        @linked_business_account_id,
        @linked_contact_id,
        @metadata_json,
        @updated_at
      )
      `,
    ).run({
      session_id: "call-1",
      root_call_sid: "CA-root",
      primary_leg_sid: "CA-leg",
      source: "app_bridge",
      direction: "outbound",
      outcome: "answered",
      answered: 1,
      started_at: "2026-04-12T16:30:00.000Z",
      answered_at: "2026-04-12T16:30:03.000Z",
      ended_at: "2026-04-12T16:36:00.000Z",
      talk_duration_seconds: 357,
      ring_duration_seconds: 3,
      employee_login_name: "jserrano",
      employee_display_name: "Jorge Serrano",
      employee_contact_id: 157497,
      employee_phone: "+14162304681",
      recipient_employee_login_name: null,
      recipient_employee_display_name: null,
      presented_caller_id: "+14162304681",
      bridge_number: "+16474929859",
      target_phone: "+19058299927",
      counterparty_phone: "+19058299927",
      matched_contact_id: 202,
      matched_contact_name: "Andy McMullen",
      matched_business_account_id: "BA-1",
      matched_company_name: "Example Company",
      phone_match_type: "contact_phone",
      phone_match_ambiguity_count: 1,
      initiated_from_surface: "accounts",
      linked_account_row_key: "account-1:contact:202",
      linked_business_account_id: "BA-1",
      linked_contact_id: 202,
      metadata_json: "{}",
      updated_at: "2026-04-12T16:36:00.000Z",
    });

    readModelAccounts.refreshStoredReadModelAccountSupplementalFields();

    const stored = db
      .prepare(
        `
        SELECT payload_json
        FROM account_rows
        WHERE row_key = ?
        `,
      )
      .get("account-1:contact:202") as { payload_json: string } | undefined;

    const parsed = stored ? (JSON.parse(stored.payload_json) as BusinessAccountRow) : null;
    expect(parsed?.lastCalledAt).toBe("2026-04-12T16:30:00.000Z");
    expect(parsed?.accountType ?? null).toBeNull();
    expect(parsed?.opportunityCount ?? null).toBeNull();
  });

  it("preserves stored last-called metadata when replacing one account", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:202",
        contactId: 202,
        primaryContactId: 202,
        primaryContactName: "Andy McMullen",
        lastCalledAt: "2026-04-12T16:30:00.000Z",
      }),
    ]);

    readModelAccounts.replaceReadModelAccountRows("account-1", [
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:202",
        contactId: 202,
        primaryContactId: 202,
        primaryContactName: "Andy McMullen Updated",
      }),
    ]);

    const storedRows = readModelAccounts.readStoredBusinessAccountRowsFromReadModel("account-1");
    expect(storedRows[0]?.primaryContactName).toBe("Andy McMullen Updated");
    expect(storedRows[0]?.lastCalledAt).toBe("2026-04-12T16:30:00.000Z");
  });

  it("shares notes across matching company/contact identities regardless of address", async () => {
    const readModelAccounts = await import("@/lib/read-model/accounts");
    const { upsertSharedContactNotesForRow } = await import(
      "@/lib/read-model/contact-identity-notes"
    );
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    readModelAccounts.replaceAllAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:101",
        contactId: 101,
        businessAccountId: "ADV-1",
        companyName: "Adventec",
        address: "100 Main St",
        addressLine1: "100 Main St",
        primaryContactName: "Jim Campbell",
        notes: "Initial shared note",
      }),
      buildRow({
        id: "account-2",
        accountRecordId: "account-2",
        rowKey: "account-2:contact:202",
        contactId: 202,
        businessAccountId: "ADV-2",
        companyName: "Adventec",
        address: "200 Main St",
        addressLine1: "200 Main St",
        primaryContactName: "Jim Campbell",
        notes: null,
      }),
    ]);

    const seededRows = readModelAccounts.readAllAccountRowsFromReadModel();
    expect(seededRows.map((row) => row.notes)).toEqual([
      "Initial shared note",
      "Initial shared note",
    ]);

    const targetRow = seededRows.find((row) => row.contactId === 202);
    expect(targetRow).toBeDefined();
    upsertSharedContactNotesForRow({
      row: targetRow as BusinessAccountRow,
      notes: "Updated shared note",
      updatedBy: "jserrano",
    });

    const refreshedRows = readModelAccounts.readAllAccountRowsFromReadModel();
    expect(refreshedRows.map((row) => row.notes)).toEqual([
      "Updated shared note",
      "Updated shared note",
    ]);
  });
});
