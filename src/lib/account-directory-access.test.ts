import { describe, expect, it } from "vitest";

import {
  canDirectoryUserAccessAccount,
  filterAccountRowsForDirectoryUser,
  isJefferyDirectoryUser,
} from "@/lib/account-directory-access";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(input: {
  category: BusinessAccountRow["category"];
  id: string;
  salesRepName: string | null;
}): BusinessAccountRow {
  return {
    id: input.id,
    salesRepId: null,
    salesRepName: input.salesRepName,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: input.id,
    companyName: `Company ${input.id}`,
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
    category: input.category,
    notes: null,
    lastModifiedIso: null,
  };
}

describe("Jeffery directory access", () => {
  it("recognizes both the email login and short login", () => {
    expect(isJefferyDirectoryUser("jbuhagiar@meadowb.com")).toBe(true);
    expect(isJefferyDirectoryUser("JBUHAGIAR")).toBe(true);
    expect(isJefferyDirectoryUser("jserrano")).toBe(false);
  });

  it("keeps only A and B accounts assigned to Jeffery or Jeff Buhagiar", () => {
    const rows = [
      buildRow({ category: "A", id: "a-jeffery", salesRepName: "Jeffery Buhagiar" }),
      buildRow({ category: "B", id: "b-jeff", salesRepName: "Jeff Buhagiar" }),
      buildRow({ category: "C", id: "c-jeffery", salesRepName: "Jeffery Buhagiar" }),
      buildRow({ category: "A", id: "a-justin", salesRepName: "Justin Settle" }),
    ];

    expect(
      filterAccountRowsForDirectoryUser(rows, "jbuhagiar@meadowb.com").map(
        (row) => row.id,
      ),
    ).toEqual(["a-jeffery", "b-jeff"]);
    expect(canDirectoryUserAccessAccount("jbuhagiar", rows[2])).toBe(false);
    expect(filterAccountRowsForDirectoryUser(rows, "jserrano")).toEqual(rows);
  });
});
