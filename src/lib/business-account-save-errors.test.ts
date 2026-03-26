import { describe, expect, it } from "vitest";

import {
  buildBusinessAccountSaveErrorFeedback,
  parseApiErrorMessage,
} from "@/lib/business-account-save-errors";
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

describe("business account save errors", () => {
  it("parses generic API errors from nested details", () => {
    expect(
      parseApiErrorMessage({
        error: "An error has occurred.",
        details: {
          modelState: {
            value: ["'Value' cannot be empty."],
          },
        },
      }),
    ).toBe("value: 'Value' cannot be empty.");
  });

  it("maps structured attribute field errors to drawer fields", () => {
    const feedback = buildBusinessAccountSaveErrorFeedback(
      {
        error: "An error has occurred.",
        details: {
          errors: {
            INDUSTRY: "Industry Type is required.",
            WEEK: "Week is required.",
          },
        },
      },
      buildDraft(),
    );

    expect(feedback.message).toBe("INDUSTRY: Industry Type is required.");
    expect(feedback.fieldErrors).toEqual({
      industryType: "Industry Type is required.",
      week: "Week is required.",
    });
  });

  it("turns generic value-empty errors into missing attribute guidance", () => {
    const feedback = buildBusinessAccountSaveErrorFeedback(
      {
        error: "An error has occurred.",
        details: {
          lastError: {
            modelState: {
              value: ["'Value' cannot be empty."],
            },
          },
        },
      },
      buildDraft({
        industryType: null,
        subCategory: null,
        companyRegion: null,
        week: null,
        category: null,
      }),
    );

    expect(feedback).toEqual({
      message:
        "Complete the missing attribute values before saving: Industry Type, Sub-Category, Company Region.",
      fieldErrors: {
        industryType: "Select a value before saving.",
        subCategory: "Select a value before saving.",
        companyRegion: "Select a value before saving.",
      },
    });
  });

  it("leaves unrelated save errors untouched", () => {
    const feedback = buildBusinessAccountSaveErrorFeedback(
      {
        error: "Phone number must use the format ###-###-####.",
      },
      buildDraft({
        industryType: null,
        subCategory: null,
      }),
    );

    expect(feedback).toEqual({
      message: "Phone number must use the format ###-###-####.",
      fieldErrors: {},
    });
  });

  it("surfaces flattened zod field errors instead of the generic invalid payload message", () => {
    const feedback = buildBusinessAccountSaveErrorFeedback(
      {
        error: "Invalid update payload",
        details: {
          fieldErrors: {
            baseSnapshot: ["Phone number must use the format ###-###-####."],
          },
          formErrors: [],
        },
      },
      buildDraft(),
    );

    expect(feedback).toEqual({
      message: "Phone number must use the format ###-###-####.",
      fieldErrors: {},
    });
  });
});
