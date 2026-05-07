import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(
  overrides: Partial<BusinessAccountRow> & {
    id: string;
    accountRecordId?: string;
  },
): BusinessAccountRow {
  return {
    id: overrides.id,
    accountRecordId: overrides.accountRecordId ?? overrides.id,
    rowKey: overrides.rowKey ?? `${overrides.accountRecordId ?? overrides.id}:contact:row`,
    contactId: overrides.contactId ?? null,
    isPrimaryContact: overrides.isPrimaryContact ?? false,
    marketingEligible: overrides.marketingEligible,
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
    companyDescription: overrides.companyDescription,
    address: overrides.address ?? "123 Main St",
    addressLine1: overrides.addressLine1 ?? "123 Main St",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Toronto",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "M5H 2N2",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? "Example Contact",
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? null,
    primaryContactPhone: overrides.primaryContactPhone ?? null,
    primaryContactExtension: overrides.primaryContactExtension ?? null,
    primaryContactRawPhone: overrides.primaryContactRawPhone ?? null,
    primaryContactEmail: overrides.primaryContactEmail ?? null,
    primaryContactId: overrides.primaryContactId ?? null,
    category: overrides.category ?? null,
    notes: overrides.notes ?? null,
    lastEmailedAt: overrides.lastEmailedAt ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-03-17T00:00:00.000Z",
  };
}

describe("account-local-metadata", () => {
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "account-local-metadata-test-"));
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

  it("overlays saved company descriptions onto account rows", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      applyLocalAccountMetadataToRows,
      saveAccountCompanyDescription,
    } = await import("@/lib/read-model/account-local-metadata");
    closeDb = () => getReadModelDb().close();

    saveAccountCompanyDescription({
      accountRecordId: "account-1",
      businessAccountId: "BA-1",
      companyDescription: "Industrial controls and automation services provider.",
    });

    const rows = applyLocalAccountMetadataToRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
      }),
    ]);

    expect(rows[0]?.companyDescription).toBe(
      "Industrial controls and automation services provider.",
    );
    expect(rows[0]?.marketingEligible).toBe(true);
  });

  it("defaults marketing eligibility to true when no local metadata exists", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      applyLocalAccountMetadataToRow,
    } = await import("@/lib/read-model/account-local-metadata");
    closeDb = () => getReadModelDb().close();

    const row = applyLocalAccountMetadataToRow(
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
      }),
    );

    expect(row?.marketingEligible).toBe(true);
  });

  it("overlays saved marketing eligibility onto account rows", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      applyLocalAccountMetadataToRows,
      saveAccountCompanyDescription,
    } = await import("@/lib/read-model/account-local-metadata");
    closeDb = () => getReadModelDb().close();

    saveAccountCompanyDescription({
      accountRecordId: "account-1",
      businessAccountId: "BA-1",
      marketingEligible: false,
    });

    const rows = applyLocalAccountMetadataToRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
      }),
    ]);

    expect(rows[0]?.marketingEligible).toBe(false);
  });

  it("removes company descriptions when the saved value is cleared", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      applyLocalAccountMetadataToRow,
      saveAccountCompanyDescription,
    } = await import("@/lib/read-model/account-local-metadata");
    closeDb = () => getReadModelDb().close();

    saveAccountCompanyDescription({
      accountRecordId: "account-1",
      businessAccountId: "BA-1",
      companyDescription: "Industrial controls and automation services provider.",
    });
    saveAccountCompanyDescription({
      accountRecordId: "account-1",
      businessAccountId: "BA-1",
      companyDescription: null,
    });

    const row = applyLocalAccountMetadataToRow(
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        companyDescription: "Old description",
      }),
    );

    expect(row?.companyDescription).toBeNull();
    expect(row?.marketingEligible).toBe(true);
  });

  it("removes local metadata row when values reset to defaults", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      applyLocalAccountMetadataToRow,
      saveAccountCompanyDescription,
    } = await import("@/lib/read-model/account-local-metadata");
    closeDb = () => getReadModelDb().close();

    saveAccountCompanyDescription({
      accountRecordId: "account-1",
      businessAccountId: "BA-1",
      companyDescription: "Industrial controls and automation services provider.",
      marketingEligible: false,
    });
    saveAccountCompanyDescription({
      accountRecordId: "account-1",
      businessAccountId: "BA-1",
      companyDescription: null,
      marketingEligible: true,
    });

    const row = applyLocalAccountMetadataToRow(
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
      }),
    );

    expect(row?.companyDescription).toBeNull();
    expect(row?.marketingEligible).toBe(true);
  });
});
