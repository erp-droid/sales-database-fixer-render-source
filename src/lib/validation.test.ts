import { ZodError } from "zod";

import { parseListQuery, parseUpdatePayload } from "@/lib/validation";

describe("parseListQuery", () => {
  it("uses defaults", () => {
    const parsed = parseListQuery(new URLSearchParams());
    expect(parsed).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it("parses explicit values", () => {
    const parsed = parseListQuery(
      new URLSearchParams({
        q: "alpha",
        category: "B",
        filterCompanyName: "Alpha",
        filterSalesRep: "Jorge",
        filterIndustryType: "Distribution",
        filterSubCategory: "Pharmaceuticals",
        filterCompanyRegion: "Region 1",
        filterWeek: "Week 1",
        filterAddress: "Road",
        filterPrimaryContactName: "Jorge",
        filterPrimaryContactPhone: "416",
        filterPrimaryContactEmail: "meadowb.com",
        filterCategory: "B",
        filterLastModified: "2026-03-04",
        sortBy: "salesRepName",
        sortDir: "desc",
        page: "2",
        pageSize: "50",
      }),
    );

    expect(parsed).toEqual({
      q: "alpha",
      category: "B",
      filterCompanyName: "Alpha",
      filterSalesRep: "Jorge",
      filterIndustryType: "Distribution",
      filterSubCategory: "Pharmaceuticals",
      filterCompanyRegion: "Region 1",
      filterWeek: "Week 1",
      filterAddress: "Road",
      filterPrimaryContactName: "Jorge",
      filterPrimaryContactPhone: "416",
      filterPrimaryContactEmail: "meadowb.com",
      filterCategory: "B",
      filterLastModified: "2026-03-04",
      sortBy: "salesRepName",
      sortDir: "desc",
      page: 2,
      pageSize: 50,
    });
  });
});

describe("parseUpdatePayload", () => {
  const validPayload = {
    companyName: "Alpha Inc",
    addressLine1: "5579 McAdam Road",
    addressLine2: "",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z1N4",
    country: "CA",
    primaryContactName: "Jorge Serrano",
    primaryContactPhone: "4162304681",
    primaryContactEmail: "jserrano@meadowb.com",
    salesRepId: "109343",
    salesRepName: "Jorge Serrano",
    category: "A",
    notes: "Hi",
    expectedLastModified: "2026-03-04T16:39:08.13+00:00",
  };

  it("normalizes empty optional values to null", () => {
    const parsed = parseUpdatePayload({
      ...validPayload,
      primaryContactName: "",
      primaryContactPhone: "",
      primaryContactEmail: "",
      category: "",
      notes: "",
    });

    expect(parsed.primaryContactName).toBeNull();
    expect(parsed.primaryContactPhone).toBeNull();
    expect(parsed.primaryContactEmail).toBeNull();
    expect(parsed.category).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("rejects invalid category", () => {
    expect(() =>
      parseUpdatePayload({
        ...validPayload,
        category: "Z",
      }),
    ).toThrow(ZodError);
  });

  it("rejects invalid email", () => {
    expect(() =>
      parseUpdatePayload({
        ...validPayload,
        primaryContactEmail: "not-an-email",
      }),
    ).toThrow(ZodError);
  });
});
