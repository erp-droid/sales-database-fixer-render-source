import { describe, expect, it } from "vitest";

import {
  buildPrimaryOnlyUpdateRequest,
  isPrimaryOnlyConflictRetryAllowed,
  isPrimaryOnlyUpdate,
} from "@/lib/business-account-update";
import type {
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
} from "@/types/business-account";

const currentAccountRow: BusinessAccountRow = {
  id: "account-1",
  accountRecordId: "account-1",
  rowKey: "account-1:contact:100",
  contactId: 100,
  isPrimaryContact: true,
  companyPhone: null,
  phoneNumber: null,
  salesRepId: "109343",
  salesRepName: "Jorge Serrano",
  industryType: "Distribution",
  subCategory: "Industrial",
  companyRegion: "Region 1",
  week: "Week 1",
  businessAccountId: "B20266",
  companyName: "ABB Inc.",
  address: "1150 CHAMPLAIN CT, Whitby ON L1N 6K9, CA",
  addressLine1: "1150 CHAMPLAIN CT",
  addressLine2: "",
  city: "Whitby",
  state: "ON",
  postalCode: "L1N 6K9",
  country: "CA",
  primaryContactName: "Existing Primary",
  primaryContactPhone: "416-555-0100",
  primaryContactExtension: "100",
  primaryContactEmail: "existing@example.com",
  primaryContactId: 100,
  category: "A",
  notes: "Current account note",
  lastModifiedIso: "2026-03-06T10:00:00.000Z",
};

const targetContactRow: BusinessAccountRow = {
  ...currentAccountRow,
  rowKey: "account-1:contact:157315",
  contactId: 157315,
  isPrimaryContact: false,
  primaryContactName: "Rob Geisel",
  primaryContactPhone: "416-555-0199",
  primaryContactExtension: "220",
  primaryContactEmail: "rgeisel@example.com",
  notes: "Target contact note",
};

function buildRequest(
  overrides: Partial<BusinessAccountUpdateRequest> = {},
): BusinessAccountUpdateRequest {
  return {
    companyName: currentAccountRow.companyName,
    assignedBusinessAccountRecordId: currentAccountRow.accountRecordId ?? currentAccountRow.id,
    assignedBusinessAccountId: currentAccountRow.businessAccountId,
    addressLine1: currentAccountRow.addressLine1,
    addressLine2: currentAccountRow.addressLine2,
    city: currentAccountRow.city,
    state: currentAccountRow.state,
    postalCode: currentAccountRow.postalCode,
    country: currentAccountRow.country,
    targetContactId: targetContactRow.contactId ?? null,
    setAsPrimaryContact: true,
    primaryOnlyIntent: false,
    salesRepId: currentAccountRow.salesRepId,
    salesRepName: currentAccountRow.salesRepName,
    industryType: currentAccountRow.industryType,
    subCategory: currentAccountRow.subCategory,
    companyRegion: currentAccountRow.companyRegion,
    week: currentAccountRow.week,
    companyPhone: currentAccountRow.companyPhone ?? null,
    primaryContactName: targetContactRow.primaryContactName,
    primaryContactPhone: targetContactRow.primaryContactPhone,
    primaryContactExtension: targetContactRow.primaryContactExtension ?? null,
    primaryContactEmail: targetContactRow.primaryContactEmail,
    category: currentAccountRow.category,
    notes: targetContactRow.notes,
    expectedLastModified: currentAccountRow.lastModifiedIso,
    ...overrides,
  };
}

describe("business-account primary-only helpers", () => {
  it("recognizes a primary-only update when the submitted values match the latest rows", () => {
    const request = buildRequest();

    expect(
      isPrimaryOnlyUpdate(currentAccountRow, targetContactRow, request),
    ).toBe(true);
  });

  it("allows stale-conflict retry only for explicit primary-only intent", () => {
    expect(
      isPrimaryOnlyConflictRetryAllowed(buildRequest(), targetContactRow.contactId ?? null),
    ).toBe(false);

    expect(
      isPrimaryOnlyConflictRetryAllowed(
        buildRequest({ primaryOnlyIntent: true }),
        targetContactRow.contactId ?? null,
      ),
    ).toBe(true);
  });

  it("rebuilds a primary-only request from the latest account and target-contact state", () => {
    const rebuilt = buildPrimaryOnlyUpdateRequest(
      currentAccountRow,
      targetContactRow,
      targetContactRow.contactId as number,
    );

    expect(rebuilt).toEqual({
      companyName: currentAccountRow.companyName,
      assignedBusinessAccountRecordId: currentAccountRow.accountRecordId,
      assignedBusinessAccountId: currentAccountRow.businessAccountId,
      addressLine1: currentAccountRow.addressLine1,
      addressLine2: currentAccountRow.addressLine2,
      city: currentAccountRow.city,
      state: currentAccountRow.state,
      postalCode: currentAccountRow.postalCode,
      country: currentAccountRow.country,
      companyPhone: currentAccountRow.companyPhone,
      targetContactId: targetContactRow.contactId,
      setAsPrimaryContact: true,
      primaryOnlyIntent: true,
      salesRepId: currentAccountRow.salesRepId,
      salesRepName: currentAccountRow.salesRepName,
      industryType: currentAccountRow.industryType,
      subCategory: currentAccountRow.subCategory,
      companyRegion: currentAccountRow.companyRegion,
      week: currentAccountRow.week,
      primaryContactName: targetContactRow.primaryContactName,
      primaryContactPhone: targetContactRow.primaryContactPhone,
      primaryContactExtension: targetContactRow.primaryContactExtension,
      primaryContactEmail: targetContactRow.primaryContactEmail,
      category: currentAccountRow.category,
      notes: targetContactRow.notes,
      expectedLastModified: currentAccountRow.lastModifiedIso,
    });
  });
});
