import { describe, expect, it } from "vitest";

import { appendLocalContactRow } from "@/lib/local-account-rows";
import type { BusinessAccountRow } from "@/types/business-account";
import type { BusinessAccountContactCreateRequest } from "@/types/business-account-create";

function buildRow(overrides: Partial<BusinessAccountRow> = {}): BusinessAccountRow {
  return {
    id: overrides.id ?? "account-1",
    accountRecordId: overrides.accountRecordId ?? "account-1",
    rowKey: overrides.rowKey ?? "account-1:contact:row",
    contactId: overrides.contactId ?? null,
    isPrimaryContact: overrides.isPrimaryContact ?? false,
    companyPhone: overrides.companyPhone ?? "905-555-0100",
    companyPhoneSource: overrides.companyPhoneSource ?? "account",
    phoneNumber: overrides.phoneNumber ?? null,
    salesRepId: overrides.salesRepId ?? null,
    salesRepName: overrides.salesRepName ?? null,
    accountType: overrides.accountType ?? "Lead",
    opportunityCount: overrides.opportunityCount ?? null,
    industryType: overrides.industryType ?? "Food",
    subCategory: overrides.subCategory ?? "Bakery",
    companyRegion: overrides.companyRegion ?? "Toronto",
    week: overrides.week ?? null,
    businessAccountId: overrides.businessAccountId ?? "LOCAL-ACCOUNT",
    companyName: overrides.companyName ?? "Example Bakery",
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
    category: overrides.category ?? "A",
    notes: overrides.notes ?? null,
    lastCalledAt: overrides.lastCalledAt ?? null,
    lastEmailedAt: overrides.lastEmailedAt ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-06-02T10:00:00.000Z",
  };
}

function buildContactRequest(
  overrides: Partial<BusinessAccountContactCreateRequest> = {},
): BusinessAccountContactCreateRequest {
  return {
    displayName: overrides.displayName ?? "New Contact",
    jobTitle: overrides.jobTitle ?? "Owner",
    email: overrides.email ?? "new@example.com",
    phone1: overrides.phone1 ?? "905-555-0199",
    extension: overrides.extension ?? null,
    contactClass: overrides.contactClass ?? "sales",
  };
}

describe("appendLocalContactRow", () => {
  it("replaces a contactless placeholder with the created contact row", () => {
    const placeholder = buildRow({
      contactId: null,
      primaryContactId: null,
      primaryContactName: null,
      primaryContactEmail: null,
      primaryContactPhone: null,
    });

    const result = appendLocalContactRow([placeholder], buildContactRequest());

    expect(result.contactId).toBeLessThan(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      contactId: result.contactId,
      primaryContactId: result.contactId,
      primaryContactName: "New Contact",
      primaryContactEmail: "new@example.com",
      primaryContactPhone: "905-555-0199",
      isPrimaryContact: true,
    });
  });

  it("does not overwrite existing contact rows when adding a new primary contact", () => {
    const existingContact = buildRow({
      rowKey: "account-1:contact:101",
      contactId: 101,
      primaryContactId: 101,
      primaryContactName: "Existing Contact",
      primaryContactEmail: "existing@example.com",
      primaryContactPhone: "905-555-0101",
      isPrimaryContact: true,
    });

    const result = appendLocalContactRow([existingContact], buildContactRequest());
    const preservedRow = result.rows.find((row) => row.contactId === 101);
    const createdRow = result.rows.find((row) => row.contactId === result.contactId);

    expect(result.rows).toHaveLength(2);
    expect(preservedRow).toMatchObject({
      primaryContactName: "Existing Contact",
      primaryContactEmail: "existing@example.com",
      primaryContactPhone: "905-555-0101",
      primaryContactId: result.contactId,
      isPrimaryContact: false,
    });
    expect(createdRow).toMatchObject({
      primaryContactName: "New Contact",
      primaryContactEmail: "new@example.com",
      primaryContactPhone: "905-555-0199",
      primaryContactId: result.contactId,
      isPrimaryContact: true,
    });
  });
});
