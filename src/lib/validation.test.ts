import { ZodError } from "zod";

import {
  parseBusinessAccountContactCreatePayload,
  parseBusinessAccountCreatePayload,
  parseContactOnlyUpdatePayload,
  parseContactMergePayload,
  parseContactMergePreviewQuery,
  parseDataQualityBasisQuery,
  parseDataQualityIssuesQuery,
  parseDataQualityStatusPayload,
  parseDeleteReasonPayload,
  parseListQuery,
  parseMeetingCreatePayload,
  parseOpportunityCreatePayload,
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
        filterLastEmailed: "2026-03-10",
        filterLastModified: "2026-03-04",
        sortBy: "lastEmailedAt",
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
      filterLastEmailed: "2026-03-10",
      filterLastModified: "2026-03-04",
      sortBy: "lastEmailedAt",
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
    companyPhone: "19055550100",
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

  it("normalizes company phone to ###-###-####", () => {
    const parsed = parseUpdatePayload(validPayload);

    expect(parsed.companyPhone).toBe("905-555-0100");
    expect(parsed.primaryContactPhone).toBe("416-230-4681");
  });

  it("rejects invalid company phone", () => {
    expect(() =>
      parseUpdatePayload({
        ...validPayload,
        companyPhone: "12345",
      }),
    ).toThrow(ZodError);
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
    expect(parsed.contactOnlyIntent).toBe(false);
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

  it("parses contactOnlyIntent when provided", () => {
    const parsed = parseUpdatePayload({
      ...validPayload,
      contactOnlyIntent: true,
      targetContactId: 157315,
    });

    expect(parsed.contactOnlyIntent).toBe(true);
    expect(parsed.targetContactId).toBe(157315);
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

describe("parseContactOnlyUpdatePayload", () => {
  const fallback = {
    companyName: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "CA",
    salesRepId: null,
    salesRepName: null,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    primaryContactName: "Ashur Hanna",
    primaryContactPhone: "905-878-9000",
    primaryContactExtension: "120",
    primaryContactEmail: "ashur.hanna@freshstartfoods.com",
    category: null,
    notes: null,
    expectedLastModified: "2026-03-04T16:39:08.13+00:00",
  } as const;

  it("allows standalone contact updates without required account fields", () => {
    const parsed = parseContactOnlyUpdatePayload(
      {
        targetContactId: 157315,
        primaryContactPhone: "19058789000",
        expectedLastModified: "2026-03-04T16:39:08.13+00:00",
      },
      fallback,
    );

    expect(parsed.companyName).toBe("");
    expect(parsed.addressLine1).toBe("");
    expect(parsed.country).toBe("CA");
    expect(parsed.targetContactId).toBe(157315);
    expect(parsed.primaryContactName).toBe("Ashur Hanna");
    expect(parsed.primaryContactPhone).toBe("905-878-9000");
    expect(parsed.primaryContactExtension).toBe("120");
    expect(parsed.primaryContactEmail).toBe("ashur.hanna@freshstartfoods.com");
  });

  it("parses and normalizes contact-only extension values", () => {
    const parsed = parseContactOnlyUpdatePayload(
      {
        targetContactId: 157315,
        primaryContactPhone: "9053370800",
        primaryContactExtension: "ext. 101",
      },
      fallback,
    );

    expect(parsed.primaryContactPhone).toBe("905-337-0800");
    expect(parsed.primaryContactExtension).toBe("101");
  });

  it("ignores invalid company phones on contact-only payloads", () => {
    const parsed = parseContactOnlyUpdatePayload(
      {
        targetContactId: 157315,
        companyPhone: "905-456-8700 x249",
        primaryContactPhone: "9054568700",
        primaryContactExtension: "249",
      },
      fallback,
    );

    expect(parsed.companyPhone).toBeNull();
    expect(parsed.primaryContactPhone).toBe("905-456-8700");
    expect(parsed.primaryContactExtension).toBe("249");
  });

  it("defaults contactOnlyIntent to false for contact-only payloads", () => {
    const parsed = parseContactOnlyUpdatePayload(
      {
        targetContactId: 157315,
      },
      fallback,
    );

    expect(parsed.contactOnlyIntent).toBe(false);
  });

  it("still rejects invalid contact-only email values", () => {
    expect(() =>
      parseContactOnlyUpdatePayload(
        {
          targetContactId: 157315,
          primaryContactEmail: "not-an-email",
        },
        fallback,
      ),
    ).toThrow(ZodError);
  });

  it("rejects invalid contact-only extension values", () => {
    expect(() =>
      parseContactOnlyUpdatePayload(
        {
          targetContactId: 157315,
          primaryContactExtension: "123456",
        },
        fallback,
      ),
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

describe("parseOpportunityCreatePayload", () => {
  const validPayload = {
    businessAccountRecordId: "02670D2595",
    businessAccountId: "BA0001",
    contactId: 157497,
    subject: "Warehouse electrical upgrade",
    classId: "PRODUCTION",
    location: "MAIN",
    stage: "Awaiting Estimate",
    estimationDate: "2026-03-11T00:00:00.000Z",
    note: null,
    willWinJob: "Yes",
    linkToDrive: "https://drive.google.com/example",
    projectType: "Electrical",
    ownerId: null,
    ownerName: "Jane Doe",
  };

  it("requires businessAccountRecordId", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        businessAccountRecordId: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires a positive contactId", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        contactId: 0,
      }),
    ).toThrow(ZodError);
  });

  it("requires subject", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        subject: "   ",
      }),
    ).toThrow(ZodError);
  });

  it("requires businessAccountId", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        businessAccountId: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires class and estimation date", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        classId: "",
      }),
    ).toThrow(ZodError);

    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        estimationDate: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires valid willWinJob values", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        willWinJob: "Maybe",
      }),
    ).toThrow(ZodError);
  });

  it("requires linkToDrive", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        linkToDrive: "",
      }),
    ).toThrow(ZodError);
  });

  it("requires a supported projectType", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        projectType: "Roofing",
      }),
    ).toThrow(ZodError);
  });

  it("requires ownerId or ownerName", () => {
    expect(() =>
      parseOpportunityCreatePayload({
        ...validPayload,
        ownerName: null,
      }),
    ).toThrowError("Estimator is required.");
  });

  it("accepts a valid payload and trims strings", () => {
    const parsed = parseOpportunityCreatePayload({
      ...validPayload,
      businessAccountRecordId: " 02670D2595 ",
      businessAccountId: " BA0001 ",
      subject: " Warehouse electrical upgrade ",
      classId: " PRODUCTION ",
      location: " MAIN ",
      stage: " Awaiting Estimate ",
      estimationDate: " 2026-03-11T00:00:00.000Z ",
      linkToDrive: " https://drive.google.com/example ",
      ownerId: " E0001 ",
      ownerName: " Jane Doe ",
    });

    expect(parsed).toEqual({
      businessAccountRecordId: "02670D2595",
      businessAccountId: "BA0001",
      contactId: 157497,
      subject: "Warehouse electrical upgrade",
      classId: "PRODUCTION",
      location: "MAIN",
      stage: "Awaiting Estimate",
      estimationDate: "2026-03-11T00:00:00.000Z",
      note: null,
      willWinJob: "Yes",
      linkToDrive: "https://drive.google.com/example",
      projectType: "Electrical",
      ownerId: "E0001",
      ownerName: "Jane Doe",
    });
  });
});

describe("parseMeetingCreatePayload", () => {
  const validPayload = {
    businessAccountRecordId: "02670D2595",
    businessAccountId: "BA0001",
    sourceContactId: 157497,
    organizerContactId: 157499,
    includeOrganizerInAcumatica: true,
    relatedContactId: 157497,
    summary: "Operations sync",
    location: "Boardroom",
    timeZone: "America/Toronto",
    startDate: "2026-03-11",
    startTime: "09:00",
    endDate: "2026-03-11",
    endTime: "10:00",
    priority: "Normal",
    details: "Review open items.",
    attendeeContactIds: [157497, 157498],
    attendeeEmails: ["guest@example.com"],
  };

  it("accepts a valid payload and trims strings", () => {
    const parsed = parseMeetingCreatePayload({
      ...validPayload,
      businessAccountRecordId: " 02670D2595 ",
      businessAccountId: " BA0001 ",
      summary: " Operations sync ",
      location: " Boardroom ",
      timeZone: " America/Toronto ",
      details: " Review open items. ",
    });

    expect(parsed).toEqual({
      businessAccountRecordId: "02670D2595",
      businessAccountId: "BA0001",
      sourceContactId: 157497,
      organizerContactId: 157499,
      includeOrganizerInAcumatica: true,
      relatedContactId: 157497,
      summary: "Operations sync",
      location: "Boardroom",
      timeZone: "America/Toronto",
      startDate: "2026-03-11",
      startTime: "09:00",
      endDate: "2026-03-11",
      endTime: "10:00",
      priority: "Normal",
      details: "Review open items.",
      attendeeContactIds: [157497, 157498],
      attendeeEmails: ["guest@example.com"],
    });
  });

  it("requires summary and related contact", () => {
    expect(() =>
      parseMeetingCreatePayload({
        ...validPayload,
        summary: "   ",
      }),
    ).toThrow(ZodError);

    expect(() =>
      parseMeetingCreatePayload({
        ...validPayload,
        relatedContactId: 0,
      }),
    ).toThrow(ZodError);
  });

  it("requires organizer contact when including organizer in Acumatica", () => {
    expect(() =>
      parseMeetingCreatePayload({
        ...validPayload,
        organizerContactId: null,
      }),
    ).toThrow(ZodError);

    expect(
      parseMeetingCreatePayload({
        ...validPayload,
        includeOrganizerInAcumatica: false,
        organizerContactId: null,
      }),
    ).toEqual({
      ...validPayload,
      organizerContactId: null,
      includeOrganizerInAcumatica: false,
    });
  });

  it("allows attendee normalization to happen server-side", () => {
    const parsed = parseMeetingCreatePayload({
      ...validPayload,
      attendeeContactIds: [157498, 157498],
    });

    expect(parsed.attendeeContactIds).toEqual([157498, 157498]);
    expect(parsed.attendeeEmails).toEqual(["guest@example.com"]);

    const parsedWithoutAttendees = parseMeetingCreatePayload({
      ...validPayload,
      attendeeContactIds: [],
      attendeeEmails: [],
    });

    expect(parsedWithoutAttendees.attendeeContactIds).toEqual([]);
    expect(parsedWithoutAttendees.attendeeEmails).toEqual([]);
  });

  it("rejects end values that are not after start", () => {
    expect(() =>
      parseMeetingCreatePayload({
        ...validPayload,
        endTime: "08:59",
      }),
    ).toThrow(ZodError);
  });

  it("rejects unsupported priorities and invalid date formats", () => {
    expect(() =>
      parseMeetingCreatePayload({
        ...validPayload,
        priority: "Urgent",
      }),
    ).toThrow(ZodError);

    expect(() =>
      parseMeetingCreatePayload({
        ...validPayload,
        startDate: "03/11/2026",
      }),
    ).toThrow(ZodError);

    expect(() =>
      parseMeetingCreatePayload({
        ...validPayload,
        attendeeEmails: ["not-an-email"],
      }),
    ).toThrow(ZodError);
  });
});

describe("parseDeleteReasonPayload", () => {
  it("rejects empty and whitespace-only reasons", () => {
    expect(() => parseDeleteReasonPayload({ reason: "" })).toThrow(ZodError);
    expect(() => parseDeleteReasonPayload({ reason: "   " })).toThrow(ZodError);
  });

  it("rejects reasons longer than 1000 characters", () => {
    expect(() =>
      parseDeleteReasonPayload({
        reason: "x".repeat(1001),
      }),
    ).toThrow(ZodError);
  });

  it("trims valid reasons", () => {
    expect(
      parseDeleteReasonPayload({
        reason: " Duplicate contact requested by sales rep ",
      }),
    ).toEqual({
      reason: "Duplicate contact requested by sales rep",
    });
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
        salesRep: " Jorge Serrano ",
        page: "3",
        pageSize: "75",
      }),
    );

    expect(parsed).toEqual({
      metric: "missingSalesRep",
      basis: "row",
      salesRep: "Jorge Serrano",
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
      new URLSearchParams([
        ["businessAccountRecordId", "acc-1"],
        ["keepContactId", "157497"],
        ["contactId", "157497"],
        ["contactId", "158410"],
        ["contactId", "158499"],
      ]),
    );

    expect(parsed).toEqual({
      businessAccountRecordId: "acc-1",
      keepContactId: 157497,
      contactIds: [157497, 158410, 158499],
    });
  });
});

describe("parseContactMergePayload", () => {
  const validPayload = {
    businessAccountRecordId: "acc-1",
    businessAccountId: "AC-100",
    keepContactId: 157497,
    selectedContactIds: [157497, 158410, 158499],
    setKeptAsPrimary: true,
    expectedAccountLastModified: "2026-03-04T16:39:08.13+00:00",
    expectedContactLastModifieds: [
      {
        contactId: 157497,
        lastModified: "2026-03-04T16:39:08.13+00:00",
      },
      {
        contactId: 158410,
        lastModified: "2026-03-04T16:39:08.13+00:00",
      },
      {
        contactId: 158499,
        lastModified: "2026-03-04T16:39:08.13+00:00",
      },
    ],
    fieldChoices: [
      {
        field: "displayName",
        sourceContactId: 157497,
      },
    ],
  };

  it("rejects duplicate selected contact IDs", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        selectedContactIds: [157497, 157497],
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
            sourceContactId: 157497,
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
            sourceContactId: 157497,
          },
          {
            field: "displayName",
            sourceContactId: 158410,
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it("rejects keep contact IDs that are not selected", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        keepContactId: 999999,
      }),
    ).toThrow(ZodError);
  });

  it("rejects field choices that reference unselected contacts", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        fieldChoices: [
          {
            field: "displayName",
            sourceContactId: 999999,
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it("rejects incomplete expected contact timestamps", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        expectedContactLastModifieds: validPayload.expectedContactLastModifieds.slice(0, 2),
      }),
    ).toThrow(ZodError);
  });

  it("rejects duplicate expected contact timestamps", () => {
    expect(() =>
      parseContactMergePayload({
        ...validPayload,
        expectedContactLastModifieds: [
          validPayload.expectedContactLastModifieds[0],
          validPayload.expectedContactLastModifieds[0],
          validPayload.expectedContactLastModifieds[2],
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
