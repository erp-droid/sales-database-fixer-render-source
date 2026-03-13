import {
  buildBusinessAccountRegionProfiles,
  normalizeCanadianPostalCodeFsa,
  resolveBusinessAccountClassDecision,
  resolveBusinessAccountRegion,
  resolveExactBusinessAccountRegion,
} from "@/lib/business-account-region-resolution";

describe("business-account region resolution", () => {
  it("classifies active customer accounts as CUSTOMER", () => {
    expect(
      resolveBusinessAccountClassDecision({
        type: "Customer",
        status: "Active",
        classId: "LEAD",
      }),
    ).toEqual({
      skip: false,
      skippedReason: null,
      targetClassId: "CUSTOMER",
    });
  });

  it("classifies non-customer business accounts as LEAD", () => {
    expect(
      resolveBusinessAccountClassDecision({
        type: "Business Account",
        status: "Active",
        classId: "CUSTOMER",
      }),
    ).toEqual({
      skip: false,
      skippedReason: null,
      targetClassId: "LEAD",
    });
  });

  it("skips vendor records", () => {
    expect(
      resolveBusinessAccountClassDecision({
        type: "Vendor",
        status: "Active",
        classId: "VENDOR",
      }),
    ).toEqual({
      skip: true,
      skippedReason: "vendor",
      targetClassId: null,
    });
  });

  it("treats prospects as LEAD instead of skipping them", () => {
    expect(
      resolveBusinessAccountClassDecision({
        type: "Prospect",
        status: "Prospect",
        classId: "DEF",
      }),
    ).toEqual({
      skip: false,
      skippedReason: null,
      targetClassId: "LEAD",
    });
  });

  it("normalizes Canadian FSAs and resolves exact mappings with first-listed precedence", () => {
    expect(normalizeCanadianPostalCodeFsa("l4z 1n4")).toBe("L4Z");
    expect(resolveExactBusinessAccountRegion("L3R 5H6")).toEqual({
      region: "Region 2",
      fsa: "L3R",
    });
    expect(resolveExactBusinessAccountRegion("L4Z 1N4")).toEqual({
      region: "Region 6",
      fsa: "L4Z",
    });
  });

  it("uses the city fallback when an FSA is unmapped", () => {
    const profiles = buildBusinessAccountRegionProfiles([
      {
        postalCode: "L4Z 1N4",
        city: "Mississauga",
        state: "ON",
        country: "CA",
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
      },
      {
        postalCode: "L4W 5A5",
        city: "Mississauga",
        state: "ON",
        country: "CA",
        salesRepId: "109337",
        salesRepName: "Jeffery Buhagiar",
      },
      {
        postalCode: "L3R 1M2",
        city: "Markham",
        state: "ON",
        country: "CA",
        salesRepId: "109321",
        salesRepName: "Derek Cowell",
      },
    ]);

    expect(
      resolveBusinessAccountRegion(
        {
          postalCode: "M5S 2R7",
          city: "Mississauga",
          state: "ON",
          country: "CA",
          salesRepId: "999999",
          salesRepName: "Unknown",
        },
        profiles,
      ),
    ).toEqual({
      region: "Region 6",
      source: "city_fallback",
      fsa: "M5S",
    });
  });

  it("uses the sales-rep fallback when city data is unavailable", () => {
    const profiles = buildBusinessAccountRegionProfiles([
      {
        postalCode: "L8P 1A1",
        city: "Hamilton",
        state: "ON",
        country: "CA",
        salesRepId: "124894",
        salesRepName: "Brock Koczka",
      },
      {
        postalCode: "L8W 2B2",
        city: "Hamilton",
        state: "ON",
        country: "CA",
        salesRepId: "124894",
        salesRepName: "Brock Koczka",
      },
      {
        postalCode: "L8R 1A1",
        city: "Hamilton",
        state: "ON",
        country: "CA",
        salesRepId: "124894",
        salesRepName: "Brock Koczka",
      },
      {
        postalCode: "L4Z 1N4",
        city: "Mississauga",
        state: "ON",
        country: "CA",
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
      },
    ]);

    expect(
      resolveBusinessAccountRegion(
        {
          postalCode: "N9C 2L8",
          city: null,
          state: null,
          country: null,
          salesRepId: "124894",
          salesRepName: "Brock Koczka",
        },
        profiles,
      ),
    ).toEqual({
      region: "Region 9",
      source: "sales_rep_fallback",
      fsa: "N9C",
    });
  });

  it("uses the global fallback when neither city nor sales rep can be resolved", () => {
    const profiles = buildBusinessAccountRegionProfiles([
      {
        postalCode: "L4Z 1N4",
        city: "Mississauga",
        state: "ON",
        country: "CA",
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
      },
      {
        postalCode: "L4W 5A5",
        city: "Mississauga",
        state: "ON",
        country: "CA",
        salesRepId: "109337",
        salesRepName: "Jeffery Buhagiar",
      },
      {
        postalCode: "L3R 5H6",
        city: "Markham",
        state: "ON",
        country: "CA",
        salesRepId: "109321",
        salesRepName: "Derek Cowell",
      },
    ]);

    expect(
      resolveBusinessAccountRegion(
        {
          postalCode: null,
          city: null,
          state: null,
          country: null,
          salesRepId: null,
          salesRepName: null,
        },
        profiles,
      ),
    ).toEqual({
      region: "Region 6",
      source: "global_fallback",
      fsa: null,
    });
  });
});
