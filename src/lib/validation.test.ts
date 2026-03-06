import { ZodError } from "zod";

import {
  parseBusinessAccountContactCreatePayload,
  parseBusinessAccountCreatePayload,
  parseContactMergePayload,
  parseContactMergePreviewQuery,
  parseDataQualityBasisQuery,
  parseDataQualityIssuesQuery,
  parseDataQualityStatusPayload,
  parseListQuery,
  parseUpdatePayload,
} from "@/lib/validation";

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

  it("defaults blank country to CA", () => {
    const parsed = parseUpdatePayload({
      ...validPayload,
      country: "",
    });

    expect(parsed.country).toBe("CA");
  });

  it("defaults primaryOnlyIntent to false", () => {
    const parsed = parseUpdatePayload(validPayload);
    expect(parsed.primaryOnlyIntent).toBe(false);
  });

  it("parses primaryOnlyIntent when provided", () => {
    const parsed = parseUpdatePayload({
      ...validPayload,
      primaryOnlyIntent: true,
      setAsPrimaryContact: true,
      targetContactId: 157315,
      assignedBusinessAccountRecordId: "account-1",
      assignedBusinessAccountId: "B20266",
    });

    expect(parsed.primaryOnlyIntent).toBe(true);
    expect(parsed.setAsPrimaryContact).toBe(true);
    expect(parsed.targetContactId).toBe(157315);
    expect(parsed.assignedBusinessAccountRecordId).toBe("account-1");
    expect(parsed.assignedBusinessAccountId).toBe("B20266");
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

describe("parseBusinessAccountCreatePayload", () => {
  const validPayload = {
    companyName: "Alpha Inc",
    classId: "CUSTOMER",
    salesRepId: "109343",
    salesRepName: "Jorge Serrano",
    industryType: "Distributi",
    subCategory: "Manufactur",
    companyRegion: "Region 1",
    week: null,
    category: "A",
    addressLookupId: "cp-123",
    addressLine1: "5579 McAdam Road",
    addressLine2: "Unit 4",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "",
  };

  it("requires company name", () => {
    expect(() =>
      parseBusinessAccountCreatePayload({
        ...validPayload,
        companyName: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires classId", () => {
    expect(() =>
      parseBusinessAccountCreatePayload({
        ...validPayload,
        classId: undefined,
      }),
    ).toThrow(ZodError);
  });

  it("requires industry type", () => {
    expect(() =>
      parseBusinessAccountCreatePayload({
        ...validPayload,
        industryType: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires sub-category", () => {
    expect(() =>
      parseBusinessAccountCreatePayload({
        ...validPayload,
        subCategory: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires client type", () => {
    expect(() =>
      parseBusinessAccountCreatePayload({
        ...validPayload,
        category: undefined,
      }),
    ).toThrow(ZodError);
  });

  it("requires company region", () => {
    expect(() =>
      parseBusinessAccountCreatePayload({
        ...validPayload,
        companyRegion: "",
      }),
    ).toThrow(ZodError);
  });

  it("allows null week", () => {
    const parsed = parseBusinessAccountCreatePayload(validPayload);
    expect(parsed.week).toBeNull();
  });

  it("requires addressLookupId", () => {
    expect(() =>
      parseBusinessAccountCreatePayload({
        ...validPayload,
        addressLookupId: "",
      }),
    ).toThrow(ZodError);
  });

  it("normalizes country to CA", () => {
    const parsed = parseBusinessAccountCreatePayload({
      ...validPayload,
      country: "",
    });
    expect(parsed.country).toBe("CA");
  });
});

describe("parseBusinessAccountContactCreatePayload", () => {
  const validPayload = {
    displayName: "Jorge Serrano",
    jobTitle: "Sales",
    email: "jserrano@meadowb.com",
    phone1: "4162304681",
    contactClass: "sales",
  };

  it("requires name", () => {
    expect(() =>
      parseBusinessAccountContactCreatePayload({
        ...validPayload,
        displayName: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires job title", () => {
    expect(() =>
      parseBusinessAccountContactCreatePayload({
        ...validPayload,
        jobTitle: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires valid email", () => {
    expect(() =>
      parseBusinessAccountContactCreatePayload({
        ...validPayload,
        email: "not-an-email",
      }),
    ).toThrow(ZodError);
  });

  it("requires valid phone format", () => {
    expect(() =>
      parseBusinessAccountContactCreatePayload({
        ...validPayload,
        phone1: "12345",
      }),
    ).toThrow(ZodError);
  });

  it("requires contact class", () => {
    expect(() =>
      parseBusinessAccountContactCreatePayload({
        ...validPayload,
        contactClass: "unknown",
      }),
    ).toThrow(ZodError);
  });
});

describe("parseDataQualityIssuesQuery", () => {
  it("uses defaults for basis and pagination", () => {
    const parsed = parseDataQualityIssuesQuery(
      new URLSearchParams({
        metric: "missingCompany",
      }),
    );

    expect(parsed).toEqual({
      metric: "missingCompany",
      basis: "row",
      page: 1,
      pageSize: 25,
    });
  });

  it("parses explicit values", () => {
    const parsed = parseDataQualityIssuesQuery(
      new URLSearchParams({
        metric: "missingSalesRep",
        basis: "row",
        page: "3",
        pageSize: "75",
      }),
    );

    expect(parsed).toEqual({
      metric: "missingSalesRep",
      basis: "row",
      page: 3,
      pageSize: 75,
    });
  });

  it("rejects invalid metric", () => {
    expect(() =>
      parseDataQualityIssuesQuery(
        new URLSearchParams({
          metric: "badMetric",
        }),
      ),
    ).toThrow(ZodError);
  });

  it("rejects invalid basis", () => {
    expect(() =>
      parseDataQualityIssuesQuery(
        new URLSearchParams({
          metric: "missingCompany",
          basis: "invalid",
        }),
      ),
    ).toThrow(ZodError);
  });

  it("rejects out-of-range page and pageSize", () => {
    expect(() =>
      parseDataQualityIssuesQuery(
        new URLSearchParams({
          metric: "missingCompany",
          page: "0",
        }),
      ),
    ).toThrow(ZodError);

    expect(() =>
      parseDataQualityIssuesQuery(
        new URLSearchParams({
          metric: "missingCompany",
          pageSize: "201",
        }),
      ),
    ).toThrow(ZodError);
  });
});

describe("parseDataQualityBasisQuery", () => {
  it("defaults to row basis", () => {
    const parsed = parseDataQualityBasisQuery(new URLSearchParams());
    expect(parsed).toEqual({
      basis: "row",
    });
  });

  it("parses explicit basis", () => {
    const parsed = parseDataQualityBasisQuery(
      new URLSearchParams({
        basis: "account",
      }),
    );
    expect(parsed).toEqual({
      basis: "account",
    });
  });
});

describe("parseDataQualityStatusPayload", () => {
  it("parses valid payload", () => {
    const parsed = parseDataQualityStatusPayload({
      action: "review",
      issueKeys: ["a", "b"],
    });
    expect(parsed).toEqual({
      action: "review",
      issueKeys: ["a", "b"],
    });
  });

  it("rejects invalid payload", () => {
    expect(() =>
      parseDataQualityStatusPayload({
        action: "bad",
        issueKeys: [],
      }),
    ).toThrow(ZodError);
  });
});

describe("parseContactMergePreviewQuery", () => {
  it("parses valid IDs", () => {
    const parsed = parseContactMergePreviewQuery(
      new URLSearchParams({
        businessAccountRecordId: "acc-1",
        keepContactId: "157497",
        deleteContactId: "158410",
      }),
    );

    expect(parsed).toEqual({
      businessAccountRecordId: "acc-1",
      keepContactId: 157497,
      deleteContactId: 158410,
    });
  });
});

describe("parseContactMergePayload", () => {
  const validPayload = {
    businessAccountRecordId: "acc-1",
    businessAccountId: "AC-100",
    keepContactId: 157497,
    deleteContactId: 158410,
    setKeptAsPrimary: true,
    expectedAccountLastModified: "2026-03-04T16:39:08.13+00:00",
    expectedKeepContactLastModified: "2026-03-04T16:39:08.13+00:00",
    expectedDeleteContactLastModified: "2026-03-04T16:39:08.13+00:00",
    fieldChoices: [
      {
        field: "displayName",
        source: "keep",
      },
    ],
  };

  it("rejects same keep and delete contact IDs", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        deleteContactId: 157497,
      }),
    ).toThrow(ZodError);
  });

  it("rejects unknown field names", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        fieldChoices: [
          {
            field: "badField",
            source: "keep",
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it("rejects duplicate field entries", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        fieldChoices: [
          {
            field: "displayName",
            source: "keep",
          },
          {
            field: "displayName",
            source: "delete",
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it("requires businessAccountRecordId", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        businessAccountRecordId: "",
      }),
    ).toThrow(ZodError);
  });
});
