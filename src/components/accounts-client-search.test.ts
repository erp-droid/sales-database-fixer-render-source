import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEADER_FILTERS,
  matchesFallbackTextFilters,
} from "@/components/accounts-client";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(companyName: string): BusinessAccountRow {
  return {
    id: companyName,
    salesRepId: null,
    salesRepName: "Jeffery Buhagiar",
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: companyName,
    companyName,
    address: "1 Main Street, Toronto, ON, CA",
    addressLine1: "1 Main Street",
    addressLine2: "",
    city: "Toronto",
    state: "ON",
    postalCode: "M5V 1A1",
    country: "CA",
    primaryContactName: null,
    primaryContactPhone: null,
    primaryContactEmail: null,
    primaryContactId: null,
    category: "A",
    notes: null,
    lastModifiedIso: null,
  };
}

describe("account search fallback", () => {
  it("does not restore the full list when no records match the search", () => {
    const rows = [buildRow("Acme Manufacturing"), buildRow("Beacon Foods")];

    const matches = rows.filter((row) =>
      matchesFallbackTextFilters(row, {
        q: "company that does not exist",
        headerFilters: DEFAULT_HEADER_FILTERS,
      }),
    );

    expect(matches).toEqual([]);
  });

  it("keeps matching records available to the fallback", () => {
    const row = buildRow("Acme Manufacturing");

    expect(
      matchesFallbackTextFilters(row, {
        q: "acme",
        headerFilters: DEFAULT_HEADER_FILTERS,
      }),
    ).toBe(true);
  });
});
