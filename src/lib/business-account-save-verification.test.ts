import { describe, expect, it } from "vitest";

import {
  applyOptimisticSavedUpdateToRow,
  applyOptimisticSavedUpdateToRows,
  buildVerificationUpdateRequest,
  mergeSavedResponseRowIntoRows,
  responseRowMatchesSavedUpdate,
} from "@/lib/business-account-save-verification";
import type {
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
} from "@/types/business-account";

function buildRow(overrides: Partial<BusinessAccountRow> = {}): BusinessAccountRow {
  return {
    id: "account-1",
    accountRecordId: "account-1",
    rowKey: "account-1:contact:100",
    contactId: 100,
    isPrimaryContact: true,
    companyPhone: "905-555-0100",
    companyPhoneSource: "account",
    phoneNumber: "416-555-0100",
    salesRepId: "109343",
    salesRepName: "Jorge Serrano",
    industryType: "Distribution",
    subCategory: "Pharmaceuticals",
    companyRegion: "Region 6",
    week: "Week 1",
    businessAccountId: "AC-100",
    companyName: "Alpha Inc",
    address: "123 Main Street, Mississauga ON L4Z 1N4, CA",
    addressLine1: "123 Main Street",
    addressLine2: "",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA",
    primaryContactName: "Jane Doe",
    primaryContactJobTitle: "Buyer",
    primaryContactPhone: "416-555-0100",
    primaryContactExtension: null,
    primaryContactEmail: "jane@example.com",
    primaryContactId: 100,
    category: "A",
    notes: "Existing note",
    lastModifiedIso: "2026-03-17T12:00:00.000Z",
    ...overrides,
  };
}

function buildUpdate(
  overrides: Partial<BusinessAccountUpdateRequest> = {},
): BusinessAccountUpdateRequest {
  return {
    companyName: "Alpha Inc",
    assignedBusinessAccountRecordId: "account-1",
    assignedBusinessAccountId: "AC-100",
    addressLine1: "123 Main Street",
    addressLine2: "",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA",
    targetContactId: 100,
    setAsPrimaryContact: false,
    primaryOnlyIntent: false,
    contactOnlyIntent: false,
    salesRepId: "109343",
    salesRepName: "Jorge Serrano",
    industryType: "Distribution",
    subCategory: "Pharmaceuticals",
    companyRegion: "Region 6",
    week: "Week 1",
    companyPhone: "905-555-0100",
    primaryContactName: "Jane Doe",
    primaryContactJobTitle: "Buyer",
    primaryContactPhone: "416-555-0100",
    primaryContactExtension: null,
    primaryContactEmail: "jane@example.com",
    category: "A",
    notes: "Existing note",
    expectedLastModified: "2026-03-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("business-account save verification", () => {
  it("treats blank optional week and category as keep-current for verification", () => {
    const currentRow = buildRow();
    const updateRequest = buildUpdate({
      week: null,
      category: null,
    });

    expect(buildVerificationUpdateRequest(currentRow, updateRequest)).toMatchObject({
      week: "Week 1",
      category: "A",
    });
  });

  it("matches a saved response row when required fields are updated", () => {
    const currentRow = buildRow();
    const updateRequest = buildUpdate({
      industryType: "Manufacturing",
      subCategory: "Packaging",
      companyRegion: "Region 9",
      category: null,
      week: null,
    });
    const responseRow = buildRow({
      industryType: "Manufacturing",
      subCategory: "Packaging",
      companyRegion: "Region 9",
      category: "A",
      week: "Week 1",
    });

    expect(responseRowMatchesSavedUpdate(responseRow, currentRow, updateRequest, 100)).toBe(true);
  });

  it("rejects a stale response row that still has old saved attributes", () => {
    const currentRow = buildRow();
    const updateRequest = buildUpdate({
      industryType: "Manufacturing",
    });
    const staleResponseRow = buildRow();

    expect(
      responseRowMatchesSavedUpdate(staleResponseRow, currentRow, updateRequest, 100),
    ).toBe(false);
  });

  it("builds an optimistic response row when the verification read is stale", () => {
    const currentRow = buildRow();
    const updateRequest = buildUpdate({
      industryType: "Service",
      subCategory: "General",
      companyRegion: "Region 6",
      category: null,
      week: null,
    });
    const staleResponseRow = buildRow({
      industryType: null,
      subCategory: null,
      companyRegion: null,
      category: null,
      week: null,
    });

    expect(
      applyOptimisticSavedUpdateToRow(staleResponseRow, currentRow, updateRequest, 100),
    ).toMatchObject({
      industryType: "Service",
      subCategory: "General",
      companyRegion: "Region 6",
      category: "A",
      week: "Week 1",
    });
  });

  it("applies optimistic account updates across all account rows but keeps contact edits scoped to the target contact", () => {
    const currentRow = buildRow({
      primaryContactId: 100,
    });
    const secondContactRow = buildRow({
      rowKey: "account-1:contact:101",
      contactId: 101,
      isPrimaryContact: false,
      primaryContactName: "John Roe",
      primaryContactEmail: "john@example.com",
      primaryContactPhone: "647-555-0101",
      primaryContactId: 100,
      primaryContactJobTitle: "Operations",
      notes: "Second note",
    });
    const updateRequest = buildUpdate({
      industryType: "Service",
      subCategory: "General",
      companyRegion: "Region 6",
      category: null,
      week: null,
      targetContactId: 101,
      setAsPrimaryContact: true,
      primaryContactName: "John Roe",
      primaryContactJobTitle: "Director",
      primaryContactPhone: "647-555-0101",
      primaryContactEmail: "john@example.com",
      notes: "Updated note",
    });

    const nextRows = applyOptimisticSavedUpdateToRows(
      [currentRow, secondContactRow],
      currentRow,
      updateRequest,
      101,
    );

    expect(nextRows[0]).toMatchObject({
      industryType: "Service",
      subCategory: "General",
      companyRegion: "Region 6",
      category: "A",
      week: "Week 1",
      primaryContactId: 101,
      isPrimaryContact: false,
      primaryContactName: "Jane Doe",
    });
    expect(nextRows[1]).toMatchObject({
      industryType: "Service",
      subCategory: "General",
      companyRegion: "Region 6",
      category: "A",
      week: "Week 1",
      primaryContactId: 101,
      isPrimaryContact: true,
      primaryContactName: "John Roe",
      primaryContactJobTitle: "Director",
      notes: "Updated note",
    });
  });

  it("propagates a verified primary contact switch across sibling rows when merging the response row", () => {
    const currentPrimaryRow = buildRow({
      rowKey: "account-1:contact:100",
      contactId: 100,
      isPrimaryContact: true,
      primaryContactId: 100,
      primaryContactName: "Jane Doe",
    });
    const targetRow = buildRow({
      rowKey: "account-1:contact:101",
      contactId: 101,
      isPrimaryContact: false,
      primaryContactId: 100,
      primaryContactName: "John Roe",
    });
    const responseRow = buildRow({
      rowKey: "account-1:contact:101",
      contactId: 101,
      isPrimaryContact: true,
      primaryContactId: 101,
      primaryContactName: "John Roe",
    });

    const merged = mergeSavedResponseRowIntoRows(
      [currentPrimaryRow, targetRow],
      responseRow,
    );

    expect(merged.find((row) => row.contactId === 100)).toMatchObject({
      primaryContactId: 101,
      isPrimaryContact: false,
    });
    expect(merged.find((row) => row.contactId === 101)).toMatchObject({
      primaryContactId: 101,
      isPrimaryContact: true,
    });
    expect(merged.filter((row) => row.isPrimaryContact)).toHaveLength(1);
  });

  it("adds a missing response row and clears the old primary when the new primary row was absent locally", () => {
    const currentPrimaryRow = buildRow({
      rowKey: "account-1:contact:100",
      contactId: 100,
      isPrimaryContact: true,
      primaryContactId: 100,
      primaryContactName: "Jane Doe",
    });
    const responseRow = buildRow({
      rowKey: "account-1:contact:101",
      contactId: 101,
      isPrimaryContact: true,
      primaryContactId: 101,
      primaryContactName: "John Roe",
    });

    const merged = mergeSavedResponseRowIntoRows([currentPrimaryRow], responseRow);

    expect(merged.find((row) => row.contactId === 100)).toMatchObject({
      primaryContactId: 101,
      isPrimaryContact: false,
    });
    expect(merged.find((row) => row.contactId === 101)).toMatchObject({
      primaryContactId: 101,
      isPrimaryContact: true,
    });
    expect(merged.filter((row) => row.isPrimaryContact)).toHaveLength(1);
  });
});
