import { describe, expect, it } from "vitest";

import { buildAddressKeyFromRow } from "@/lib/read-model/geocodes";
import {
  buildVisitationRoutePlan,
  buildVisitationRouteSalesRepOptions,
} from "@/lib/visitation-route-report";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(
  index: number,
  overrides: Partial<BusinessAccountRow> = {},
): BusinessAccountRow {
  const id = overrides.accountRecordId ?? `account-${index}`;
  return {
    id,
    accountRecordId: id,
    rowKey: overrides.rowKey ?? `${id}:contact:1`,
    contactId: overrides.contactId ?? index,
    isPrimaryContact: overrides.isPrimaryContact ?? true,
    companyPhone: overrides.companyPhone ?? `905-555-${String(index).padStart(4, "0")}`,
    salesRepId: overrides.salesRepId ?? "rep-1",
    salesRepName: overrides.salesRepName ?? "Jeffery Ye",
    industryType: overrides.industryType ?? null,
    subCategory: overrides.subCategory ?? null,
    companyRegion: overrides.companyRegion ?? null,
    week: overrides.week ?? null,
    businessAccountId: overrides.businessAccountId ?? `B${index}`,
    companyName: overrides.companyName ?? `Company ${index}`,
    address: overrides.address ?? `${index} Test Street, Toronto ON`,
    addressLine1: overrides.addressLine1 ?? `${index} Test Street`,
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Toronto",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? `M1A ${String(index).padStart(3, "0")}`,
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? `Contact ${index}`,
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? "Manager",
    primaryContactPhone: overrides.primaryContactPhone ?? "416-555-0100",
    primaryContactExtension: overrides.primaryContactExtension ?? "",
    primaryContactEmail: overrides.primaryContactEmail ?? `contact${index}@example.com`,
    primaryContactId: overrides.primaryContactId ?? index,
    category: overrides.category ?? (index % 2 === 0 ? "A" : "B"),
    notes: overrides.notes ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? null,
    ...overrides,
  };
}

describe("visitation route report", () => {
  it("counts unique A/B accounts by sales rep", () => {
    const primary = buildRow(1);
    const duplicateContact = buildRow(1, {
      id: primary.id,
      accountRecordId: primary.accountRecordId,
      rowKey: `${primary.id}:contact:2`,
      contactId: 200,
      isPrimaryContact: false,
    });
    const rows = [
      primary,
      duplicateContact,
      buildRow(2),
      buildRow(3, { salesRepId: "rep-2", salesRepName: "Alex Smith" }),
      buildRow(4, { category: "C" }),
    ];

    expect(buildVisitationRouteSalesRepOptions(rows)).toEqual([
      { id: "rep-2", name: "Alex Smith", accountCount: 1 },
      { id: "rep-1", name: "Jeffery Ye", accountCount: 2 },
    ]);
  });

  it("covers every selected account once across balanced weeks and days", () => {
    const rows = Array.from({ length: 62 }, (_, index) => buildRow(index + 1));
    rows.push(buildRow(100, { salesRepId: "rep-2", salesRepName: "Other Rep" }));
    rows.push(buildRow(101, { category: "C" }));
    const geocodes = new Map(
      rows.slice(0, 60).map((row, index) => [
        buildAddressKeyFromRow(row),
        {
          latitude: 43.5 + Math.floor(index / 10) * 0.08,
          longitude: -79.9 + (index % 10) * 0.04,
        },
      ]),
    );

    const plan = buildVisitationRoutePlan({
      rows,
      geocodes,
      salesRepId: "rep-1",
      salesRepName: "Jeffery Ye",
      generatedAt: new Date("2026-07-17T12:00:00.000Z"),
    });

    expect(plan.accountTotal).toBe(62);
    expect(plan.mappedAccountTotal).toBe(60);
    expect(plan.unmappedAccountTotal).toBe(2);
    expect(plan.days).toHaveLength(60);
    const allIds = plan.days.flatMap((day) =>
      day.accounts.map((account) => account.accountRecordId),
    );
    expect(new Set(allIds).size).toBe(62);
    expect(allIds).toHaveLength(62);

    const weekCounts = Array.from({ length: 12 }, (_, weekIndex) =>
      plan.days
        .filter((day) => day.week === weekIndex + 1)
        .reduce((sum, day) => sum + day.accounts.length, 0),
    );
    expect(Math.max(...weekCounts) - Math.min(...weekCounts)).toBeLessThanOrEqual(1);
    for (let week = 1; week <= 12; week += 1) {
      const dayCounts = plan.days
        .filter((day) => day.week === week)
        .map((day) => day.accounts.length);
      expect(dayCounts).toHaveLength(5);
      expect(Math.max(...dayCounts) - Math.min(...dayCounts)).toBeLessThanOrEqual(1);
    }
  });

  it("uses the primary contact for the route sheet", () => {
    const nonPrimary = buildRow(1, {
      isPrimaryContact: false,
      primaryContactName: "Alternate Contact",
      primaryContactEmail: "alternate@example.com",
    });
    const primary = buildRow(1, {
      rowKey: "account-1:contact:2",
      contactId: 2,
      primaryContactId: 2,
      isPrimaryContact: true,
      primaryContactName: "Primary Contact",
      primaryContactEmail: "primary@example.com",
    });
    const plan = buildVisitationRoutePlan({
      rows: [nonPrimary, primary],
      geocodes: new Map(),
      salesRepName: "Jeffery Ye",
    });
    const account = plan.days.flatMap((day) => day.accounts)[0];

    expect(account.contactName).toBe("Primary Contact");
    expect(account.contactEmail).toBe("primary@example.com");
  });
});
