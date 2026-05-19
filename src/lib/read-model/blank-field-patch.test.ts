import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(overrides: Partial<BusinessAccountRow> & { id: string }): BusinessAccountRow {
  return {
    id: overrides.id,
    accountRecordId: overrides.accountRecordId ?? overrides.id,
    rowKey: overrides.rowKey ?? `${overrides.accountRecordId ?? overrides.id}:primary`,
    contactId: overrides.contactId ?? null,
    isPrimaryContact: overrides.isPrimaryContact ?? false,
    companyPhone: overrides.companyPhone ?? null,
    companyPhoneSource: overrides.companyPhoneSource ?? null,
    phoneNumber: overrides.phoneNumber ?? null,
    salesRepId: overrides.salesRepId ?? null,
    salesRepName: overrides.salesRepName ?? null,
    accountType: overrides.accountType ?? "Lead",
    opportunityCount: overrides.opportunityCount ?? 0,
    industryType: overrides.industryType ?? null,
    subCategory: overrides.subCategory ?? null,
    companyRegion: overrides.companyRegion ?? null,
    week: overrides.week ?? null,
    businessAccountId: overrides.businessAccountId ?? "B100",
    companyName: overrides.companyName ?? "Example Company",
    companyDescription: overrides.companyDescription ?? null,
    address: overrides.address ?? "123 Main St, Toronto ON M5H 2N2, CA",
    addressLine1: overrides.addressLine1 ?? "123 Main St",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Toronto",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "M5H 2N2",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? null,
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? null,
    primaryContactPhone: overrides.primaryContactPhone ?? null,
    primaryContactExtension: overrides.primaryContactExtension ?? null,
    primaryContactRawPhone: overrides.primaryContactRawPhone ?? null,
    primaryContactEmail: overrides.primaryContactEmail ?? null,
    primaryContactId: overrides.primaryContactId ?? null,
    category: overrides.category ?? null,
    notes: overrides.notes ?? null,
    lastEmailedAt: overrides.lastEmailedAt ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? null,
    lastCalledAt: overrides.lastCalledAt ?? null,
    marketingEligible: overrides.marketingEligible,
  };
}

describe("applyReadModelBlankFieldPatch", () => {
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "blank-field-patch-test-"));
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

  it("fills only blank fields on existing accounts", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { replaceReadModelAccountRows, readBusinessAccountDetailFromReadModel } =
      await import("@/lib/read-model/accounts");
    const { applyReadModelBlankFieldPatch } = await import(
      "@/lib/read-model/blank-field-patch"
    );
    closeDb = () => getReadModelDb().close();

    replaceReadModelAccountRows("account-1", [
      buildRow({
        id: "account-1",
        businessAccountId: "B100",
        industryType: null,
        subCategory: null,
      }),
    ]);

    const result = applyReadModelBlankFieldPatch({
      enrichExistingAccounts: [
        {
          accountRecordId: "account-1",
          businessAccountId: "B100",
          companyName: "Example Company",
          fields: {
            industryType: "Manufactur",
            subCategory: "Package",
            companyDescription: "Example Company manufactures packaging products.",
          },
        },
      ],
    });

    expect(result.filledFields).toBe(3);
    expect(result.updatedExistingAccounts).toBe(1);
    expect(result.skippedFields).toEqual([]);

    const detail = readBusinessAccountDetailFromReadModel("account-1");
    expect(detail?.row.industryType).toBe("Manufactur");
    expect(detail?.row.subCategory).toBe("Package");
    expect(detail?.row.companyDescription).toBe(
      "Example Company manufactures packaging products.",
    );
  });

  it("skips fields that production already filled", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { replaceReadModelAccountRows, readBusinessAccountDetailFromReadModel } =
      await import("@/lib/read-model/accounts");
    const { saveAccountCompanyDescription } = await import(
      "@/lib/read-model/account-local-metadata"
    );
    const { applyReadModelBlankFieldPatch } = await import(
      "@/lib/read-model/blank-field-patch"
    );
    closeDb = () => getReadModelDb().close();

    replaceReadModelAccountRows("account-1", [
      buildRow({
        id: "account-1",
        businessAccountId: "B100",
        industryType: "Service",
        subCategory: null,
      }),
    ]);
    saveAccountCompanyDescription({
      accountRecordId: "account-1",
      businessAccountId: "B100",
      companyDescription: "Existing employee-written description.",
      category: "A",
      marketingEligible: false,
    });

    const result = applyReadModelBlankFieldPatch({
      enrichExistingAccounts: [
        {
          accountRecordId: "account-1",
          businessAccountId: "B100",
          companyName: "Example Company",
          fields: {
            industryType: "Manufactur",
            subCategory: "Package",
            companyDescription: "Generated description.",
          },
        },
      ],
    });

    expect(result.filledFields).toBe(1);
    expect(result.skippedFields).toHaveLength(2);

    const detail = readBusinessAccountDetailFromReadModel("account-1");
    expect(detail?.row.industryType).toBe("Service");
    expect(detail?.row.subCategory).toBe("Package");
    expect(detail?.row.companyDescription).toBe("Existing employee-written description.");
    expect(detail?.row.category).toBe("A");
    expect(detail?.row.marketingEligible).toBe(false);
  });

  it("inserts missing accounts only when still absent", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { readBusinessAccountDetailFromReadModel } = await import("@/lib/read-model/accounts");
    const { applyReadModelBlankFieldPatch } = await import(
      "@/lib/read-model/blank-field-patch"
    );
    closeDb = () => getReadModelDb().close();

    const result = applyReadModelBlankFieldPatch({
      missingAccounts: [
        {
          accountRecordId: "account-2",
          businessAccountId: "B200",
          companyName: "New Company",
          companyDescription: "New Company provides industrial services.",
          rowsToWrite: [
            buildRow({
              id: "account-2",
              accountRecordId: "account-2",
              businessAccountId: "B200",
              companyName: "New Company",
              industryType: "Service",
              subCategory: "General",
            }),
          ],
        },
      ],
    });

    expect(result.insertedMissingAccounts).toBe(1);
    expect(readBusinessAccountDetailFromReadModel("account-2")?.row.companyName).toBe(
      "New Company",
    );

    const secondResult = applyReadModelBlankFieldPatch({
      missingAccounts: [
        {
          accountRecordId: "account-2",
          businessAccountId: "B200",
          companyName: "New Company",
          rowsToWrite: [
            buildRow({
              id: "account-2",
              accountRecordId: "account-2",
              businessAccountId: "B200",
              companyName: "New Company",
            }),
          ],
        },
      ],
    });

    expect(secondResult.insertedMissingAccounts).toBe(0);
    expect(secondResult.skippedMissingAccounts[0]?.reason).toBe(
      "already-exists-in-production",
    );
  });
});
