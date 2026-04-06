import { describe, expect, it } from "vitest";

import {
  buildBusinessAccountsCsv,
  buildBusinessAccountsCsvFilename,
  canExportBusinessAccountsCsv,
} from "@/lib/business-account-export";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(overrides: Partial<BusinessAccountRow> = {}): BusinessAccountRow {
  return {
    id: overrides.id ?? "acct-1",
    accountRecordId: overrides.accountRecordId ?? "acct-1",
    rowKey: overrides.rowKey ?? "acct-1:contact:101",
    contactId: overrides.contactId ?? 101,
    isPrimaryContact: overrides.isPrimaryContact ?? true,
    companyPhone: overrides.companyPhone ?? "905-555-0100",
    companyPhoneSource: overrides.companyPhoneSource ?? "account",
    phoneNumber: overrides.phoneNumber ?? "905-555-0100",
    salesRepId: overrides.salesRepId ?? "109343",
    salesRepName: overrides.salesRepName ?? "Jorge Serrano",
    industryType: overrides.industryType ?? "Distribution",
    subCategory: overrides.subCategory ?? "Packaging",
    companyRegion: overrides.companyRegion ?? "Region 5",
    week: overrides.week ?? "Week 4",
    businessAccountId: overrides.businessAccountId ?? "B200000049",
    companyName: overrides.companyName ?? "Footage Tools",
    companyDescription: overrides.companyDescription ?? "Industrial tooling",
    address: overrides.address ?? "54 Audia Ct Unit 11, Concord ON L4K 3N4, CA",
    addressLine1: overrides.addressLine1 ?? "54 Audia Ct Unit 11",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Concord",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "L4K 3N4",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? 'Yash "M" Marathe',
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? "Facility Lead",
    primaryContactPhone: overrides.primaryContactPhone ?? "905-695-9900",
    primaryContactExtension: overrides.primaryContactExtension ?? "235",
    primaryContactRawPhone: overrides.primaryContactRawPhone ?? "9056959900 x235",
    primaryContactEmail: overrides.primaryContactEmail ?? "yash@example.com",
    primaryContactId: overrides.primaryContactId ?? 101,
    category: overrides.category ?? "A",
    notes: overrides.notes ?? "Confirmed,\nneeds quote",
    lastEmailedAt: overrides.lastEmailedAt ?? "2026-04-06T09:00:00.000Z",
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-04-06T09:30:00.000Z",
  };
}

describe("business account export", () => {
  it("builds CSV with escaped fields and a BOM", () => {
    const csv = buildBusinessAccountsCsv([buildRow()]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Company Name");
    expect(csv).toContain("Footage Tools");
    expect(csv).toContain('"Yash ""M"" Marathe"');
    expect(csv).toContain('"Confirmed,\r\nneeds quote"');
  });

  it("builds a dated filename", () => {
    expect(buildBusinessAccountsCsvFilename(new Date("2026-04-06T12:00:00.000Z"))).toBe(
      "accounts-export-2026-04-06.csv",
    );
  });

  it("only allows jserrano to export", () => {
    expect(canExportBusinessAccountsCsv("jserrano")).toBe(true);
    expect(canExportBusinessAccountsCsv("JSeRRano")).toBe(true);
    expect(canExportBusinessAccountsCsv("sdoal")).toBe(false);
    expect(canExportBusinessAccountsCsv(null)).toBe(false);
  });
});
