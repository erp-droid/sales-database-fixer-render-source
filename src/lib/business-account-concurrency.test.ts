import { describe, expect, it } from "vitest";

import {
  buildBusinessAccountConcurrencySnapshot,
  buildRebasedUpdateRequest,
  collectConflictingConcurrencyFields,
  formatConcurrencyConflictFields,
} from "@/lib/business-account-concurrency";
import type {
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
} from "@/types/business-account";

function buildRow(
  overrides: Partial<BusinessAccountRow> & {
    id: string;
    businessAccountId: string;
    companyName: string;
  },
): BusinessAccountRow {
  return {
    id: overrides.id,
    accountRecordId: overrides.accountRecordId ?? overrides.id,
    rowKey:
      overrides.rowKey ??
      `${overrides.accountRecordId ?? overrides.id}:contact:${overrides.contactId ?? "row"}`,
    contactId: overrides.contactId ?? 100,
    isPrimaryContact: overrides.isPrimaryContact ?? true,
    companyPhone: overrides.companyPhone ?? "905-555-0100",
    companyPhoneSource: overrides.companyPhoneSource ?? "account",
    phoneNumber: overrides.phoneNumber ?? overrides.companyPhone ?? "905-555-0100",
    salesRepId: overrides.salesRepId ?? "1001",
    salesRepName: overrides.salesRepName ?? "Samuel Tita",
    industryType: overrides.industryType ?? "Manufactur",
    subCategory: overrides.subCategory ?? "Package",
    companyRegion: overrides.companyRegion ?? "North",
    week: overrides.week ?? "Week 1",
    businessAccountId: overrides.businessAccountId,
    companyName: overrides.companyName,
    companyDescription: overrides.companyDescription ?? null,
    address: overrides.address ?? "123 Main St, Toronto, ON M1M 1M1, CA",
    addressLine1: overrides.addressLine1 ?? "123 Main St",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Toronto",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "M1M 1M1",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? "Kris Wawak",
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? "Buyer",
    primaryContactPhone: overrides.primaryContactPhone ?? "416-555-0100",
    primaryContactExtension: overrides.primaryContactExtension ?? null,
    primaryContactRawPhone:
      overrides.primaryContactRawPhone ??
      overrides.primaryContactPhone ??
      "416-555-0100",
    primaryContactEmail: overrides.primaryContactEmail ?? "kris@example.com",
    primaryContactId: overrides.primaryContactId ?? 100,
    category: overrides.category ?? "A",
    notes: overrides.notes ?? "Original notes",
    lastEmailedAt: overrides.lastEmailedAt ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-03-25T09:00:00.000Z",
  };
}

function buildUpdateRequest(
  row: BusinessAccountRow,
  overrides: Partial<BusinessAccountUpdateRequest> = {},
): BusinessAccountUpdateRequest {
  return {
    companyName: row.companyName,
    companyDescription: row.companyDescription ?? null,
    assignedBusinessAccountRecordId:
      row.businessAccountId.trim().length > 0 ? (row.accountRecordId ?? row.id) : null,
    assignedBusinessAccountId: row.businessAccountId.trim() || null,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    targetContactId: row.contactId ?? row.primaryContactId ?? null,
    setAsPrimaryContact: false,
    primaryOnlyIntent: false,
    contactOnlyIntent: false,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName,
    industryType: row.industryType,
    subCategory: row.subCategory,
    companyRegion: row.companyRegion,
    week: row.week,
    companyPhone: row.companyPhone ?? null,
    primaryContactName: row.primaryContactName,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone: row.primaryContactPhone,
    primaryContactExtension: row.primaryContactExtension ?? null,
    primaryContactEmail: row.primaryContactEmail,
    category: row.category,
    notes: row.notes,
    expectedLastModified: row.lastModifiedIso,
    baseSnapshot: buildBusinessAccountConcurrencySnapshot(row),
    ...overrides,
  };
}

describe("business account concurrency", () => {
  it("rebases a stale save when only untouched fields changed on the server", () => {
    const baseRow = buildRow({
      id: "acct-1",
      businessAccountId: "BA-100",
      companyName: "Linex Manufacturing",
    });
    const currentAccountRow = buildRow({
      ...baseRow,
      lastModifiedIso: "2026-03-25T09:05:00.000Z",
    });
    const currentContactRow = buildRow({
      ...currentAccountRow,
      notes: "Fresh server notes",
      lastModifiedIso: "2026-03-25T09:05:00.000Z",
    });
    const updateRequest = buildUpdateRequest(baseRow, {
      primaryContactPhone: "416-555-0199",
    });

    expect(
      collectConflictingConcurrencyFields(
        currentAccountRow,
        currentContactRow,
        updateRequest,
      ),
    ).toEqual([]);

    const rebased = buildRebasedUpdateRequest(
      currentAccountRow,
      currentContactRow,
      updateRequest,
      currentContactRow.contactId ?? null,
    );

    expect(rebased.primaryContactPhone).toBe("416-555-0199");
    expect(rebased.notes).toBe("Fresh server notes");
    expect(rebased.expectedLastModified).toBe("2026-03-25T09:05:00.000Z");
  });

  it("detects true same-field conflicts", () => {
    const baseRow = buildRow({
      id: "acct-1",
      businessAccountId: "BA-100",
      companyName: "Linex Manufacturing",
    });
    const currentAccountRow = buildRow({
      ...baseRow,
      lastModifiedIso: "2026-03-25T09:05:00.000Z",
    });
    const currentContactRow = buildRow({
      ...currentAccountRow,
      primaryContactPhone: "416-555-0188",
      lastModifiedIso: "2026-03-25T09:05:00.000Z",
    });
    const updateRequest = buildUpdateRequest(baseRow, {
      primaryContactPhone: "416-555-0199",
    });

    expect(
      formatConcurrencyConflictFields(
        collectConflictingConcurrencyFields(
          currentAccountRow,
          currentContactRow,
          updateRequest,
        ),
      ),
    ).toEqual(["Primary Contact Phone"]);
  });
});
