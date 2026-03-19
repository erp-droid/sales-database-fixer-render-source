import { describe, expect, it } from "vitest";

import {
  collectOptionalSaveWarningFields,
  formatOptionalSaveWarningMessage,
} from "@/lib/business-account-save-warnings";
import type { BusinessAccountUpdateRequest } from "@/types/business-account";

function buildDraft(
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
    companyRegion: "Region 1",
    week: "Week 1",
    companyPhone: "905-555-0100",
    primaryContactName: "Jane Doe",
    primaryContactJobTitle: "Buyer",
    primaryContactPhone: "416-555-0100",
    primaryContactExtension: null,
    primaryContactEmail: "jane@example.com",
    category: "A",
    notes: null,
    expectedLastModified: "2026-03-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("business account save warnings", () => {
  it("collects optional missing week and category", () => {
    expect(
      collectOptionalSaveWarningFields(
        buildDraft({
          category: null,
          week: null,
        }),
      ),
    ).toEqual(["category", "week"]);
  });

  it("formats a singular warning message", () => {
    expect(formatOptionalSaveWarningMessage(["category"])).toBe(
      "You have not added Category. Are you sure you want to save the changes?",
    );
  });

  it("formats a combined warning message", () => {
    expect(formatOptionalSaveWarningMessage(["category", "week"])).toBe(
      "You have not added Category and Week. Are you sure you want to save the changes?",
    );
  });
});
