import {
  buildBusinessAccountUpdateIdentifiers,
  buildPrimaryContactFallbackPayloads,
  enforceSinglePrimaryPerAccountRows,
  hasAddressChanges,
  hasPrimaryContactChanges,
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
  queryBusinessAccounts,
  selectPrimaryContactIndex,
} from "@/lib/business-accounts";
import type { BusinessAccountRow } from "@/types/business-account";

function makePayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "a1",
    BusinessAccountID: { value: "AC-100" },
    Name: { value: "Alpha Inc" },
    note: { value: "Important account" },
    LastModifiedDateTime: { value: "2026-03-04T16:39:08.13+00:00" },
    Owner: { value: "109343" },
    OwnerEmployeeName: { value: "Jorge Serrano" },
    MainAddress: {
      AddressLine1: { value: "5579 McAdam Road" },
      AddressLine2: {},
      City: { value: "Mississauga" },
      State: { value: "ON" },
      PostalCode: { value: "L4Z 1N4" },
      Country: { value: "CA" },
    },
    Attributes: [
      {
        AttributeID: { value: "CLIENTTYPE" },
        Value: { value: "A" },
      },
      {
        AttributeID: { value: "INDUSTRY" },
        Value: { value: "Distributi" },
        ValueDescription: { value: "Distribution" },
      },
      {
        AttributeID: { value: "INDSUBCATE" },
        Value: { value: "Manufactur" },
        ValueDescription: { value: "Pharmaceuticals" },
      },
      {
        AttributeID: { value: "REGION" },
        Value: { value: "Region 1" },
      },
      {
        AttributeID: { value: "WEEK" },
        Value: { value: "Week 1" },
      },
    ],
    PrimaryContact: {
      ContactID: { value: 157497 },
      DisplayName: { value: "Jorge Serrano" },
      Phone1: { value: "4162304681" },
      Email: { value: "jserrano@meadowb.com" },
      note: { value: "Contact-level note" },
    },
    Contacts: [
      {
        ContactID: { value: 157497 },
        Active: { value: true },
        DisplayName: { value: "Jorge Serrano" },
        Phone1: { value: "4162304681" },
        Email: { value: "jserrano@meadowb.com" },
      },
    ],
    ...overrides,
  };
}

describe("normalizeBusinessAccount", () => {
  it("maps values from payload and formats address", () => {
    const row = normalizeBusinessAccount(makePayload());

    expect(row).toMatchObject({
      id: "a1",
      businessAccountId: "AC-100",
      companyName: "Alpha Inc",
      salesRepId: "109343",
      salesRepName: "Jorge Serrano",
      industryType: "Distribution",
      subCategory: "Pharmaceuticals",
      companyRegion: "Region 1",
      week: "Week 1",
      primaryContactId: 157497,
      primaryContactName: "Jorge Serrano",
      primaryContactPhone: "4162304681",
      primaryContactEmail: "jserrano@meadowb.com",
      category: "A",
      notes: "Contact-level note",
      country: "CA",
    });
    expect(row.address).toContain("5579 McAdam Road");
    expect(row.address).toContain("Mississauga");
  });

  it("does not infer primary contact from active contacts when primary contact is missing", () => {
    const row = normalizeBusinessAccount(
      makePayload({
        PrimaryContact: {},
        Contacts: [
          {
            ContactID: { value: 42 },
            Active: { value: false },
            DisplayName: { value: "Dormant" },
          },
          {
            ContactID: { value: 43 },
            Active: { value: true },
            DisplayName: { value: "Active Contact" },
            note: { value: "Active contact note" },
          },
        ],
      }),
    );

    expect(row.primaryContactId).toBeNull();
    expect(row.primaryContactName).toBeNull();
    expect(row.primaryContactEmail).toBeNull();
    expect(row.primaryContactPhone).toBeNull();
  });

  it("builds primary contact name from first and last name when display name is missing", () => {
    const row = normalizeBusinessAccount(
      makePayload({
        PrimaryContact: {
          ContactID: { value: 157497 },
          FirstName: { value: "Jorge" },
          LastName: { value: "Serrano" },
          Phone1: { value: "4162304681" },
          Email: { value: "jserrano@meadowb.com" },
        },
      }),
    );

    expect(row.primaryContactName).toBe("Jorge Serrano");
  });

  it("falls back to matching contact record when primary contact fields are blank", () => {
    const row = normalizeBusinessAccount(
      makePayload({
        PrimaryContact: {
          ContactID: { value: 157497 },
          DisplayName: {},
          Phone1: {},
          Email: {},
        },
      }),
    );

    expect(row.primaryContactName).toBe("Jorge Serrano");
    expect(row.primaryContactPhone).toBe("4162304681");
    expect(row.primaryContactEmail).toBe("jserrano@meadowb.com");
  });
});

describe("normalizeBusinessAccountRows", () => {
  it("returns one row per contact and marks only the matching primary contact", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        id: "c65accd4-7ded-f011-8370-025dbe72350a",
        BusinessAccountID: { value: "02670D2595" },
        Name: { value: "MeadowBrook Construction - Internal" },
        PrimaryContact: {
          ContactID: { value: 157497 },
          DisplayName: { value: "Jorge Serrano" },
          Email: { value: "jserrano@meadowb.com" },
          Phone1: { value: "4162304681" },
        },
        Contacts: [
          {
            ContactID: { value: 157497 },
            Active: { value: true },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jserrano@meadowb.com" },
            Phone1: { value: "4162304681" },
          },
          {
            ContactID: { value: 158410 },
            Active: { value: true },
            DisplayName: { value: "Derek Cowell" },
            Email: { value: "dcowell@meadowb.com" },
            Phone1: { value: "4164520752" },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);

    const primaryRow = rows.find((row) => row.isPrimaryContact);
    const secondaryRow = rows.find((row) => !row.isPrimaryContact);

    expect(primaryRow).toBeDefined();
    expect(primaryRow?.primaryContactName).toBe("Jorge Serrano");
    expect(primaryRow?.primaryContactEmail).toBe("jserrano@meadowb.com");
    expect(primaryRow?.contactId).toBe(157497);

    expect(secondaryRow).toBeDefined();
    expect(secondaryRow?.primaryContactName).toBe("Derek Cowell");
    expect(secondaryRow?.primaryContactEmail).toBe("dcowell@meadowb.com");
    expect(secondaryRow?.contactId).toBe(158410);
  });

  it("returns a single account row when the business account has no contacts", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        id: "contactless-account",
        BusinessAccountID: { value: "AC-404" },
        Name: { value: "No Contact Co" },
        PrimaryContact: {},
        Contacts: [],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountRecordId: "contactless-account",
      rowKey: "contactless-account:primary",
      businessAccountId: "AC-404",
      companyName: "No Contact Co",
      contactId: null,
      primaryContactId: null,
      primaryContactName: null,
      primaryContactEmail: null,
      primaryContactPhone: null,
    });
  });

  it("supports wrapped Contacts and Attributes collections", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        Attributes: {
          value: [{ AttributeID: { value: "CLIENTTYPE" }, Value: { value: "A" } }],
        },
        Contacts: {
          value: [
            {
              ContactID: { value: 157497 },
              DisplayName: { value: "Jorge Serrano" },
              Email: { value: "jserrano@meadowb.com" },
              Phone1: { value: "4162304681" },
            },
          ],
        },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.primaryContactName).toBe("Jorge Serrano");
    expect(rows[0]?.primaryContactEmail).toBe("jserrano@meadowb.com");
    expect(rows[0]?.category).toBe("A");
  });

  it("marks only the PrimaryContact entry as primary", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        PrimaryContact: {
          ContactID: { value: 157497 },
          DisplayName: { value: "Jorge Serrano" },
        },
        Contacts: [
          {
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
          },
          {
            ContactID: { value: 158410 },
            DisplayName: { value: "Derek Cowell" },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isPrimaryContact)).toHaveLength(1);
    expect(
      rows.find((row) => row.contactId === 157497)?.isPrimaryContact,
    ).toBe(true);
    expect(
      rows.find((row) => row.contactId === 158410)?.isPrimaryContact,
    ).toBe(false);
  });

  it("marks primary by NoteID/id fallback when PrimaryContact.ContactID is missing", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        PrimaryContact: {
          NoteID: { value: "21b3b035-a7ef-f011-8370-025dbe72350a" },
          DisplayName: { value: "Jorge Serrano" },
        },
        Contacts: [
          {
            id: "21b3b035-a7ef-f011-8370-025dbe72350a",
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jserrano@meadowb.com" },
          },
          {
            id: "80b4ba86-a8ef-f011-8370-025dbe72350a",
            ContactID: { value: 158410 },
            DisplayName: { value: "Derek Cowell" },
            Email: { value: "dcowell@meadowb.com" },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isPrimaryContact)).toHaveLength(1);
    expect(rows.find((row) => row.contactId === 157497)?.isPrimaryContact).toBe(true);
    expect(rows.find((row) => row.contactId === 158410)?.isPrimaryContact).toBe(false);
  });

  it("marks primary by name or email when PrimaryContact.ContactID is mismatched", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        PrimaryContact: {
          ContactID: { value: 999999 },
          DisplayName: { value: "Jorge Serrano" },
          Email: { value: "jserrano@meadowb.com" },
        },
        Contacts: [
          {
            id: "21b3b035-a7ef-f011-8370-025dbe72350a",
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jserrano@meadowb.com" },
          },
          {
            id: "80b4ba86-a8ef-f011-8370-025dbe72350a",
            ContactID: { value: 158410 },
            DisplayName: { value: "Derek Cowell" },
            Email: { value: "dcowell@meadowb.com" },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isPrimaryContact)).toHaveLength(1);
    expect(rows.find((row) => row.contactId === 157497)?.isPrimaryContact).toBe(true);
    expect(rows.find((row) => row.contactId === 158410)?.isPrimaryContact).toBe(false);
  });
});

describe("primary-contact helpers", () => {
  it("selects a single primary candidate by ContactID when duplicates share name/email", () => {
    const selectedIndex = selectPrimaryContactIndex(
      [
        {
          contactId: 157497,
          recordId: "contact-a",
          email: "carleen.newland@hccontario.ca",
          name: "Carleen Newland",
          rowNumber: 2,
          index: 0,
        },
        {
          contactId: 157497,
          recordId: "contact-b",
          email: "carleen.newland@hccontario.ca",
          name: "Carleen Newland",
          rowNumber: 1,
          index: 1,
        },
      ],
      {
        contactId: 157497,
        recordId: null,
        email: null,
        name: null,
      },
    );

    expect(selectedIndex).toBe(1);
  });

  it("uses deterministic fallback ordering when matching by email/name", () => {
    const selectedIndex = selectPrimaryContactIndex(
      [
        {
          contactId: 300,
          recordId: "contact-c",
          email: "primary@example.com",
          name: "Primary Person",
          rowNumber: null,
          index: 0,
        },
        {
          contactId: 200,
          recordId: "contact-b",
          email: "primary@example.com",
          name: "Primary Person",
          rowNumber: null,
          index: 1,
        },
      ],
      {
        contactId: null,
        recordId: null,
        email: "primary@example.com",
        name: "Primary Person",
      },
    );

    expect(selectedIndex).toBe(1);
  });

  it("enforces max one primary per account row group", () => {
    const normalized = enforceSinglePrimaryPerAccountRows([
      {
        ...normalizeBusinessAccount(makePayload()),
        rowKey: "a1:contact:157497",
        contactId: 157497,
        primaryContactId: 157497,
        primaryContactName: "Jorge Serrano",
        isPrimaryContact: true,
      },
      {
        ...normalizeBusinessAccount(makePayload()),
        rowKey: "a1:contact:157498",
        contactId: 157498,
        primaryContactId: 157497,
        primaryContactName: "Duplicate Jorge",
        isPrimaryContact: true,
      },
    ]);

    expect(normalized.filter((row) => row.isPrimaryContact)).toHaveLength(1);
    expect(normalized.find((row) => row.contactId === 157497)?.isPrimaryContact).toBe(true);
    expect(normalized.find((row) => row.contactId === 157498)?.isPrimaryContact).toBe(false);
  });
});

describe("queryBusinessAccounts", () => {
  const rows: BusinessAccountRow[] = [
    normalizeBusinessAccount(makePayload()),
    normalizeBusinessAccount(
      makePayload({
        id: "b2",
        BusinessAccountID: { value: "AC-200" },
        Name: { value: "Beta Ltd" },
        Attributes: [{ AttributeID: { value: "CLIENTTYPE" }, Value: { value: "B" } }],
      }),
    ),
  ];

  it("filters and paginates rows", () => {
    const result = queryBusinessAccounts(rows, {
      q: "beta",
      page: 1,
      pageSize: 25,
      sortBy: "companyName",
      sortDir: "asc",
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.companyName).toBe("Beta Ltd");
  });

  it("supports category filter", () => {
    const result = queryBusinessAccounts(rows, {
      category: "A",
      page: 1,
      pageSize: 25,
      sortBy: "companyName",
      sortDir: "asc",
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.category).toBe("A");
  });

  it("supports per-header filters", () => {
    const result = queryBusinessAccounts(rows, {
      filterCompanyName: "alpha",
      filterSalesRep: "jorge",
      filterIndustryType: "distribution",
      filterSubCategory: "pharmaceuticals",
      filterCompanyRegion: "region 1",
      filterWeek: "week 1",
      filterAddress: "mississauga",
      filterPrimaryContactName: "jorge",
      filterPrimaryContactPhone: "416230",
      filterPrimaryContactEmail: "meadowb.com",
      filterCategory: "A",
      filterLastModified: "2026-03-04",
      page: 1,
      pageSize: 25,
      sortBy: "companyName",
      sortDir: "asc",
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.businessAccountId).toBe("AC-100");
  });

  it("sorts by any table header", () => {
    const byAddress = queryBusinessAccounts(rows, {
      page: 1,
      pageSize: 25,
      sortBy: "address",
      sortDir: "asc",
    });
    const byContact = queryBusinessAccounts(rows, {
      page: 1,
      pageSize: 25,
      sortBy: "primaryContactName",
      sortDir: "asc",
    });
    const bySalesRep = queryBusinessAccounts(rows, {
      page: 1,
      pageSize: 25,
      sortBy: "salesRepName",
      sortDir: "asc",
    });

    expect(byAddress.items.length).toBe(2);
    expect(byContact.items.length).toBe(2);
    expect(bySalesRep.items.length).toBe(2);
  });
});

describe("change detection helpers", () => {
  const existing = normalizeBusinessAccount(makePayload());

  it("detects primary contact changes", () => {
    expect(
      hasPrimaryContactChanges(existing, {
        companyName: existing.companyName,
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        country: existing.country,
        targetContactId: existing.contactId ?? existing.primaryContactId ?? null,
        setAsPrimaryContact: false,
        salesRepId: existing.salesRepId,
        salesRepName: existing.salesRepName,
        industryType: existing.industryType,
        subCategory: existing.subCategory,
        companyRegion: existing.companyRegion,
        week: existing.week,
        primaryContactName: "Changed",
        primaryContactPhone: existing.primaryContactPhone,
        primaryContactEmail: existing.primaryContactEmail,
        category: existing.category,
        notes: existing.notes,
        expectedLastModified: existing.lastModifiedIso,
      }),
    ).toBe(true);
  });

  it("detects address changes", () => {
    expect(
      hasAddressChanges(existing, {
        companyName: existing.companyName,
        addressLine1: "100 New Street",
        addressLine2: existing.addressLine2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        country: existing.country,
        targetContactId: existing.contactId ?? existing.primaryContactId ?? null,
        setAsPrimaryContact: false,
        salesRepId: existing.salesRepId,
        salesRepName: existing.salesRepName,
        industryType: existing.industryType,
        subCategory: existing.subCategory,
        companyRegion: existing.companyRegion,
        week: existing.week,
        primaryContactName: existing.primaryContactName,
        primaryContactPhone: existing.primaryContactPhone,
        primaryContactEmail: existing.primaryContactEmail,
        category: existing.category,
        notes: existing.notes,
        expectedLastModified: existing.lastModifiedIso,
      }),
    ).toBe(true);
  });
});

describe("business account merge helpers", () => {
  it("builds stable update identifiers", () => {
    expect(buildBusinessAccountUpdateIdentifiers(makePayload(), "fallback-id")).toEqual([
      "AC-100",
      "a1",
      "fallback-id",
    ]);
  });

  it("builds primary contact fallback payloads", () => {
    const payloads = buildPrimaryContactFallbackPayloads(makePayload(), 158410);

    expect(payloads[0]).toEqual({
      PrimaryContact: {
        ContactID: {
          value: 158410,
        },
      },
    });
    expect(payloads).toHaveLength(6);
  });
});
