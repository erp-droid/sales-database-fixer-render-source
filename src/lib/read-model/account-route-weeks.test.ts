import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(overrides: Partial<BusinessAccountRow> = {}): BusinessAccountRow {
  return {
    id: "account-1",
    accountRecordId: "account-1",
    rowKey: "account-1:contact:1",
    contactId: 1,
    isPrimaryContact: true,
    companyPhone: null,
    companyPhoneSource: null,
    phoneNumber: null,
    salesRepId: "rep-1",
    salesRepName: "Sales Rep",
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: "Week 16",
    businessAccountId: "BA-1",
    companyName: "Example Company",
    address: "123 Main St",
    addressLine1: "123 Main St",
    addressLine2: "",
    city: "Toronto",
    state: "ON",
    postalCode: "M5H 2N2",
    country: "CA",
    primaryContactName: "Example Contact",
    primaryContactJobTitle: null,
    primaryContactPhone: "905-555-0100",
    primaryContactExtension: null,
    primaryContactRawPhone: null,
    primaryContactEmail: "contact@example.com",
    primaryContactId: 1,
    category: "A",
    notes: null,
    lastEmailedAt: null,
    lastCalledAt: null,
    lastCalendarInvitedAt: null,
    lastModifiedIso: "2026-03-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyLocalAccountRouteWeeksToRows", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "account-route-weeks-test-"));
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.ACUMATICA_BASE_URL = "https://example.invalid";
    process.env.ACUMATICA_COMPANY = "Test Company";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
  });

  afterEach(async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    getReadModelDb().close();
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("overlays app-owned route weeks on account rows", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { applyLocalAccountRouteWeeksToRows } = await import(
      "@/lib/read-model/account-route-weeks"
    );
    const db = getReadModelDb();
    db.prepare(
      `
      INSERT INTO account_route_weeks (
        account_record_id,
        business_account_id,
        sales_rep_id,
        sales_rep_name,
        category,
        route_week,
        route_week_label,
        assignment_version,
        assignment_reason,
        updated_at
      ) VALUES (
        'account-1',
        'BA-1',
        'rep-1',
        'Sales Rep',
        'A',
        5,
        'Week 5',
        'test',
        'unit_test',
        '2026-06-11T00:00:00.000Z'
      )
      `,
    ).run();

    const rows = applyLocalAccountRouteWeeksToRows([buildRow()]);

    expect(rows[0]?.week).toBe("Week 5");
  });
});
