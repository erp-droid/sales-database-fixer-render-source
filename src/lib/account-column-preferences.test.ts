import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("account-column-preferences", () => {
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "account-column-preferences-test-"));
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

  it("saves column order and visibility per login", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      readAccountColumnPreferences,
      saveAccountColumnPreferences,
    } = await import("@/lib/account-column-preferences");
    closeDb = () => getReadModelDb().close();

    saveAccountColumnPreferences("JSERRANO", {
      columnOrder: [
        "companyName",
        "accountType",
        "opportunityCount",
        "salesRepName",
        "industryType",
        "subCategory",
        "companyRegion",
        "week",
        "address",
        "companyPhone",
        "primaryContactName",
        "primaryContactJobTitle",
        "primaryContactPhone",
        "primaryContactExtension",
        "primaryContactEmail",
        "notes",
        "category",
        "lastCalledAt",
        "lastCalendarInvitedAt",
        "lastEmailedAt",
        "lastModifiedIso",
      ],
      visibleColumns: ["companyName", "salesRepName", "category"],
    });

    expect(readAccountColumnPreferences("jserrano").visibleColumns).toEqual([
      "companyName",
      "salesRepName",
      "category",
    ]);
    expect(readAccountColumnPreferences("sarah").visibleColumns).not.toEqual([
      "companyName",
      "salesRepName",
      "category",
    ]);
  });

  it("normalizes old or incomplete column payloads before saving", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { saveAccountColumnPreferences } = await import("@/lib/account-column-preferences");
    closeDb = () => getReadModelDb().close();

    const preferences = saveAccountColumnPreferences("jserrano", {
      columnOrder: ["category", "companyName"],
      visibleColumns: ["category", "unknown-column", "companyName"],
    });

    expect(new Set(preferences.columnOrder).size).toBe(preferences.columnOrder.length);
    expect(preferences.columnOrder).toContain("category");
    expect(preferences.columnOrder).toContain("companyName");
    expect(preferences.columnOrder).toContain("lastModifiedIso");
    expect(preferences.visibleColumns).toEqual(["category", "companyName"]);
  });
});
