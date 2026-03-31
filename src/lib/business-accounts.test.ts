import {
  buildBusinessAccountUpdatePayload,
  buildBusinessAccountUpdateIdentifiers,
  buildPrimaryContactFallbackPayloads,
  buildPrimaryContactUpdatePayload,
  dedupeBusinessAccountRows,
  enforceSinglePrimaryPerAccountRows,
  hasAddressChanges,
  hasPrimaryContactChanges,
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
  queryBusinessAccounts,
  readRawBusinessAccountPrimaryContactId,
  selectPrimaryContactIndex,
} from "@/lib/business-accounts";
import type { BusinessAccountRow } from "@/types/business-account";

function makePayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "a1",
    BusinessAccountID: { value: "AC-100" },
    Name: { value: "Alpha Inc" },
    Business1: { value: "905-555-0100" },
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
      Email: { value: "jorge@example.com" },
      note: { value: "Contact-level note" },
    },
    Contacts: [
      {
        ContactID: { value: 157497 },
        Active: { value: true },
        DisplayName: { value: "Jorge Serrano" },
        Phone1: { value: "4162304681" },
        Email: { value: "jorge@example.com" },
      },
    ],
    ...overrides,
  };
}

describe("normalizeBusinessAccount", () => {
  it("treats non-positive primary contact ids as missing", () => {
    expect(
      readRawBusinessAccountPrimaryContactId(
        makePayload({
          PrimaryContact: {
            ContactID: { value: -2147483647 },
          },
          PrimaryContactID: { value: -2147483647 },
        }),
      ),
    ).toBeNull();
  });

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
      companyPhone: "905-555-0100",
      primaryContactId: 157497,
      primaryContactName: "Jorge Serrano",
      primaryContactPhone: "416-230-4681",
      primaryContactEmail: "jorge@example.com",
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
          Email: { value: "jorge@example.com" },
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
    expect(row.primaryContactPhone).toBe("416-230-4681");
    expect(row.primaryContactEmail).toBe("jorge@example.com");
  });

  it("derives company phone from hidden blank-name contacts when account phone is missing", () => {
    const row = normalizeBusinessAccount(
      makePayload({
        Business1: {},
        Contacts: [
          {
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jorge@example.com" },
            Phone1: { value: "4162304681" },
          },
          {
            ContactID: { value: 157498 },
            DisplayName: {},
            Email: {},
            Phone1: { value: "905-555-2222" },
          },
        ],
      }),
    );

    expect(row.companyPhone).toBe("905-555-2222");
  });

  it("resolves a visible primary contact from a semicolon-delimited primary email payload", () => {
    const row = normalizeBusinessAccount(
      makePayload({
        id: "641760f6-7eed-f011-8370-025dbe72350a",
        BusinessAccountID: { value: "B200000854" },
        Name: { value: "Shipmaster Containers Ltd" },
        PrimaryContact: {
          ContactID: { value: 155050 },
          DisplayName: {},
          Email: { value: "ap@shipmaster.com; anandakumar@shipmaster.com" },
          Phone1: { value: "4164939193" },
        },
        Contacts: [
          {
            ContactID: { value: 159185 },
            DisplayName: { value: "Arun Nandakumar" },
            Email: { value: "anandakumar@shipmaster.com" },
            Phone1: { value: "4164939193" },
          },
        ],
      }),
    );

    expect(row.primaryContactId).toBe(159185);
    expect(row.primaryContactName).toBe("Arun Nandakumar");
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
          Email: { value: "jorge@example.com" },
          Phone1: { value: "4162304681" },
        },
        Contacts: [
          {
            ContactID: { value: 157497 },
            Active: { value: true },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jorge@example.com" },
            Phone1: { value: "4162304681" },
          },
          {
            ContactID: { value: 158410 },
            Active: { value: true },
            DisplayName: { value: "Derek Cowell" },
            Email: { value: "derek@example.com" },
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
    expect(primaryRow?.primaryContactEmail).toBe("jorge@example.com");
    expect(primaryRow?.contactId).toBe(157497);
    expect(primaryRow?.companyPhone).toBe("905-555-0100");

    expect(secondaryRow).toBeDefined();
    expect(secondaryRow?.primaryContactName).toBe("Derek Cowell");
    expect(secondaryRow?.primaryContactEmail).toBe("derek@example.com");
    expect(secondaryRow?.contactId).toBe(158410);
    expect(secondaryRow?.companyPhone).toBe("905-555-0100");
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
              Email: { value: "jorge@example.com" },
              Phone1: { value: "4162304681" },
            },
          ],
        },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.primaryContactName).toBe("Jorge Serrano");
    expect(rows[0]?.primaryContactEmail).toBe("jorge@example.com");
    expect(rows[0]?.category).toBe("A");
  });

  it("supports wrapped MainAddress and PrimaryContact objects", () => {
    const row = normalizeBusinessAccount(
      makePayload({
        MainAddress: {
          value: {
            AddressLine1: { value: "8301 WINSTON CHURCHILL BLVD" },
            City: { value: "Brampton" },
            State: { value: "ON" },
            PostalCode: { value: "L6Y 0A2" },
            Country: { value: "CA" },
          },
        },
        PrimaryContact: {
          value: {
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jorge@example.com" },
            Phone1: { value: "4162304681" },
          },
        },
      }),
    );

    expect(row).toMatchObject({
      addressLine1: "8301 WINSTON CHURCHILL BLVD",
      city: "Brampton",
      state: "ON",
      postalCode: "L6Y 0A2",
      country: "CA",
      primaryContactId: 157497,
      primaryContactName: "Jorge Serrano",
      primaryContactEmail: "jorge@example.com",
    });
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

  it("marks the matching visible contact as primary when the raw primary email contains multiple addresses", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        id: "641760f6-7eed-f011-8370-025dbe72350a",
        BusinessAccountID: { value: "B200000854" },
        Name: { value: "Shipmaster Containers Ltd" },
        PrimaryContact: {
          ContactID: { value: 155050 },
          DisplayName: {},
          Email: { value: "ap@shipmaster.com; anandakumar@shipmaster.com" },
          Phone1: { value: "4164939193" },
        },
        Contacts: [
          {
            ContactID: { value: 159185 },
            DisplayName: { value: "Arun Nandakumar" },
            Email: { value: "anandakumar@shipmaster.com" },
            Phone1: { value: "4164939193" },
          },
          {
            ContactID: { value: 159266 },
            DisplayName: { value: "Christina Tang" },
            Email: { value: "ctang@shipmaster.com" },
            Phone1: { value: "4164939193" },
          },
        ],
      }),
    );

    expect(rows.find((row) => row.contactId === 159185)?.isPrimaryContact).toBe(true);
    expect(rows.find((row) => row.contactId === 159266)?.isPrimaryContact).toBe(false);
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
            Email: { value: "jorge@example.com" },
          },
          {
            id: "80b4ba86-a8ef-f011-8370-025dbe72350a",
            ContactID: { value: 158410 },
            DisplayName: { value: "Derek Cowell" },
            Email: { value: "derek@example.com" },
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
          Email: { value: "jorge@example.com" },
        },
        Contacts: [
          {
            id: "21b3b035-a7ef-f011-8370-025dbe72350a",
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jorge@example.com" },
          },
          {
            id: "80b4ba86-a8ef-f011-8370-025dbe72350a",
            ContactID: { value: 158410 },
            DisplayName: { value: "Derek Cowell" },
            Email: { value: "derek@example.com" },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.isPrimaryContact)).toHaveLength(1);
    expect(rows.find((row) => row.contactId === 157497)?.isPrimaryContact).toBe(true);
    expect(rows.find((row) => row.contactId === 158410)?.isPrimaryContact).toBe(false);
  });

  it("dedupes repeated contact rows that share the same generated row key", () => {
    const rows = normalizeBusinessAccountRows(
      makePayload({
        Contacts: [
          {
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jorge@example.com" },
            Phone1: { value: "4162304681" },
          },
          {
            ContactID: { value: 157497 },
            DisplayName: { value: "Jorge Serrano" },
            Email: { value: "jorge@example.com" },
            Phone1: { value: "4162304681" },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowKey).toBe("a1:contact:157497");
  });
});

describe("primary-contact helpers", () => {
  it("dedupes account rows by row key before rendering logic runs", () => {
    const deduped = dedupeBusinessAccountRows([
      {
        ...normalizeBusinessAccount(makePayload()),
        rowKey: "a1:contact:157497",
        contactId: 157497,
        primaryContactId: 157497,
        primaryContactName: null,
        primaryContactEmail: null,
        notes: null,
      },
      {
        ...normalizeBusinessAccount(makePayload()),
        rowKey: "a1:contact:157497",
        contactId: 157497,
        primaryContactId: 157497,
        primaryContactName: "Jorge Serrano",
        primaryContactEmail: "jorge@example.com",
        notes: "Contact-level note",
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.rowKey).toBe("a1:contact:157497");
    expect(deduped[0]?.primaryContactName).toBe("Jorge Serrano");
    expect(deduped[0]?.primaryContactEmail).toBe("jorge@example.com");
    expect(deduped[0]?.notes).toBe("Contact-level note");
  });

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
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          lastEmailedAt: "2026-03-10T14:15:00.000Z",
        },
        rows[1],
      ],
      {
        filterCompanyName: "alpha",
        filterSalesRep: "jorge",
        filterIndustryType: "distribution",
        filterSubCategory: "pharmaceuticals",
        filterCompanyRegion: "region 1",
        filterWeek: "week 1",
        filterAddress: "mississauga",
        filterCompanyPhone: "905-555",
        filterPrimaryContactName: "jorge",
        filterPrimaryContactPhone: "416230",
        filterPrimaryContactEmail: "example.com",
        filterCategory: "A",
        filterLastEmailed: "2026-03-10",
        filterLastModified: "2026-03-04",
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.businessAccountId).toBe("AC-100");
  });

  it("supports last emailed filtering and sorting", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          businessAccountId: "AC-100",
          lastEmailedAt: "2026-03-10T14:15:00.000Z",
        },
        {
          ...rows[1],
          businessAccountId: "AC-200",
          lastEmailedAt: "2026-03-08T09:00:00.000Z",
        },
      ],
      {
        filterLastEmailed: "2026-03-10",
        page: 1,
        pageSize: 25,
        sortBy: "lastEmailedAt",
        sortDir: "desc",
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.businessAccountId).toBe("AC-100");
  });

  it("supports company phone filtering and sorting", () => {
    const result = queryBusinessAccounts(rows, {
      filterCompanyPhone: "905-555",
      page: 1,
      pageSize: 25,
      sortBy: "companyPhone",
      sortDir: "asc",
    });

    expect(result.total).toBe(2);
    expect(result.items[0]?.companyPhone).toBe("905-555-0100");
  });

  it("suppresses AP-mailbox rows from results", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          accountRecordId: "ap-row",
          id: "ap-row",
          rowKey: "ap-row:contact:1",
          businessAccountId: "AP-100",
          companyName: "Triovest",
          primaryContactName: "Inquiry",
          primaryContactEmail: "ontarioap@triovest.com",
        },
        rows[1],
      ],
      {
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.companyName).toBe("Beta Ltd");
  });

  it("keeps phone-bearing blank-name rows as company-only entries", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          accountRecordId: "blank-contact",
          id: "blank-contact",
          rowKey: "blank-contact:contact:1",
          businessAccountId: "BLANK-100",
          companyName: "Blank Contact Co",
          primaryContactName: ". .",
          primaryContactEmail: "blank@example.com",
        },
        rows[1],
      ],
      {
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(2);
    const blankCompany = result.items.find((item) => item.businessAccountId === "BLANK-100");
    expect(blankCompany?.companyName).toBe("Blank Contact Co");
    expect(blankCompany?.primaryContactName).toBeNull();
    expect(blankCompany?.companyPhone).toBe("905-555-0100");
  });

  it("propagates a placeholder company phone across visible rows and hides the placeholder row", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          accountRecordId: "shared-account",
          id: "shared-account",
          rowKey: "shared-account:contact:1",
          businessAccountId: "SHARED-100",
          companyName: "Shared Phone Co",
          addressLine1: "100 Test Street",
          city: "Mississauga",
          state: "ON",
          postalCode: "L4Z 1N4",
          country: "CA",
          address: "100 Test Street, Mississauga ON L4Z 1N4, CA",
          companyPhone: null,
          companyPhoneSource: null,
          primaryContactName: "Jane Doe",
          primaryContactEmail: "jane@example.com",
          primaryContactPhone: "416-555-0100",
          phoneNumber: "416-555-0100",
        },
        {
          ...rows[0],
          accountRecordId: "shared-account",
          id: "shared-account",
          rowKey: "shared-account:contact:2",
          businessAccountId: "SHARED-100",
          companyName: "Shared Phone Co",
          addressLine1: "100 Test Street",
          city: "Mississauga",
          state: "ON",
          postalCode: "L4Z 1N4",
          country: "CA",
          address: "100 Test Street, Mississauga ON L4Z 1N4, CA",
          companyPhone: "905-555-2222",
          companyPhoneSource: "placeholder",
          primaryContactName: null,
          primaryContactEmail: null,
          primaryContactPhone: null,
          primaryContactId: null,
          contactId: null,
          phoneNumber: "905-555-2222",
          isPrimaryContact: false,
        },
      ],
      {
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.companyPhone).toBe("905-555-2222");
    expect(result.items[0]?.primaryContactName).toBe("Jane Doe");
  });

  it("suppresses orphan placeholder rows with only a phone number", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          accountRecordId: "orphan-placeholder",
          id: "orphan-placeholder",
          rowKey: "orphan-placeholder:contact:108862",
          businessAccountId: "",
          companyName: "",
          address: "",
          addressLine1: "",
          addressLine2: "",
          city: "",
          state: "",
          postalCode: "",
          country: "",
          companyPhone: "905-549-0111",
          companyPhoneSource: "placeholder",
          phoneNumber: "905-549-0111",
          primaryContactName: null,
          primaryContactPhone: null,
          primaryContactEmail: null,
          primaryContactId: null,
          contactId: null,
          isPrimaryContact: false,
          notes: "Legacy AP note",
        },
        rows[1],
      ],
      {
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.companyName).toBe("Beta Ltd");
  });

  it("suppresses MeadowBrook business accounts from results", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          accountRecordId: "mb-account",
          id: "mb-account",
          rowKey: "mb-account:contact:1",
          businessAccountId: "MB-100",
          companyName: "MeadowBrook Construction - Internal",
          primaryContactEmail: "internal@example.com",
        },
        rows[1],
      ],
      {
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.companyName).toBe("Beta Ltd");
  });

  it("suppresses internal MeadowBrook contact emails from results", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          accountRecordId: "internal-contact",
          id: "internal-contact",
          rowKey: "internal-contact:contact:1",
          businessAccountId: "INT-100",
          companyName: "Customer With Internal Contact",
          primaryContactEmail: "person@meadowbrookconstruction.ca",
        },
        rows[1],
      ],
      {
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.companyName).toBe("Beta Ltd");
  });

  it("can include internal MeadowBrook contact emails when requested", () => {
    const result = queryBusinessAccounts(
      [
        {
          ...rows[0],
          accountRecordId: "internal-contact",
          id: "internal-contact",
          rowKey: "internal-contact:contact:1",
          businessAccountId: "INT-100",
          companyName: "Customer With Internal Contact",
          primaryContactEmail: "person@meadowb.com",
        },
        rows[1],
      ],
      {
        includeInternalRows: true,
        page: 1,
        pageSize: 25,
        sortBy: "companyName",
        sortDir: "asc",
      },
    );

    expect(result.total).toBe(2);
    expect(result.items.some((row) => row.businessAccountId === "INT-100")).toBe(true);
  });

  it("removes duplicate row identities before pagination and render ordering", () => {
    const duplicate = {
      ...rows[0],
      rowKey: "a1:contact:157497",
      contactId: 157497,
    };
    const result = queryBusinessAccounts([duplicate, duplicate, rows[1]], {
      page: 1,
      pageSize: 25,
      sortBy: "companyName",
      sortDir: "asc",
    });

    expect(result.total).toBe(2);
    expect(result.items.filter((row) => row.rowKey === "a1:contact:157497")).toHaveLength(1);
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
        assignedBusinessAccountRecordId: existing.accountRecordId ?? existing.id,
        assignedBusinessAccountId: existing.businessAccountId,
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        country: existing.country,
        targetContactId: existing.contactId ?? existing.primaryContactId ?? null,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: existing.salesRepId,
        salesRepName: existing.salesRepName,
        industryType: existing.industryType,
        subCategory: existing.subCategory,
        companyRegion: existing.companyRegion,
        week: existing.week,
        companyPhone: existing.companyPhone ?? null,
        primaryContactName: "Changed",
        primaryContactJobTitle: existing.primaryContactJobTitle,
        primaryContactPhone: existing.primaryContactPhone,
        primaryContactEmail: existing.primaryContactEmail,
        category: existing.category,
        notes: existing.notes,
        expectedLastModified: existing.lastModifiedIso,
      }),
    ).toBe(true);
  });

  it("detects primary contact extension changes", () => {
    expect(
      hasPrimaryContactChanges(existing, {
        companyName: existing.companyName,
        assignedBusinessAccountRecordId: existing.accountRecordId ?? existing.id,
        assignedBusinessAccountId: existing.businessAccountId,
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        country: existing.country,
        targetContactId: existing.contactId ?? existing.primaryContactId ?? null,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: existing.salesRepId,
        salesRepName: existing.salesRepName,
        industryType: existing.industryType,
        subCategory: existing.subCategory,
        companyRegion: existing.companyRegion,
        week: existing.week,
        companyPhone: existing.companyPhone ?? null,
        primaryContactName: existing.primaryContactName,
        primaryContactJobTitle: existing.primaryContactJobTitle,
        primaryContactPhone: existing.primaryContactPhone,
        primaryContactExtension: "3008",
        primaryContactEmail: existing.primaryContactEmail,
        category: existing.category,
        notes: existing.notes,
        expectedLastModified: existing.lastModifiedIso,
      }),
    ).toBe(true);
  });

  it("detects primary contact job title changes", () => {
    expect(
      hasPrimaryContactChanges(existing, {
        companyName: existing.companyName,
        assignedBusinessAccountRecordId: existing.accountRecordId ?? existing.id,
        assignedBusinessAccountId: existing.businessAccountId,
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        country: existing.country,
        targetContactId: existing.contactId ?? existing.primaryContactId ?? null,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: existing.salesRepId,
        salesRepName: existing.salesRepName,
        industryType: existing.industryType,
        subCategory: existing.subCategory,
        companyRegion: existing.companyRegion,
        week: existing.week,
        companyPhone: existing.companyPhone ?? null,
        primaryContactName: existing.primaryContactName,
        primaryContactJobTitle: "Director of Purchasing",
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
        assignedBusinessAccountRecordId: existing.accountRecordId ?? existing.id,
        assignedBusinessAccountId: existing.businessAccountId,
        addressLine1: "100 New Street",
        addressLine2: existing.addressLine2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        country: existing.country,
        targetContactId: existing.contactId ?? existing.primaryContactId ?? null,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: existing.salesRepId,
        salesRepName: existing.salesRepName,
        industryType: existing.industryType,
        subCategory: existing.subCategory,
        companyRegion: existing.companyRegion,
        week: existing.week,
        companyPhone: existing.companyPhone ?? null,
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
  it("builds initial primary-contact updates with top-level numeric contact fields", () => {
    const payload = buildBusinessAccountUpdatePayload(makePayload(), {
      companyName: "Alpha Inc",
      assignedBusinessAccountRecordId: "a1",
      assignedBusinessAccountId: "AC-100",
      addressLine1: "5579 McAdam Road",
      addressLine2: "",
      city: "Mississauga",
      state: "ON",
      postalCode: "L4Z 1N4",
      country: "CA",
      targetContactId: 158410,
      setAsPrimaryContact: true,
      primaryOnlyIntent: true,
      salesRepId: "109343",
      salesRepName: "Jorge Serrano",
      industryType: "Distribution",
      subCategory: "Pharmaceuticals",
      companyRegion: "Region 1",
      week: "Week 1",
      companyPhone: "905-555-0100",
      primaryContactName: "Derek Cowell",
      primaryContactPhone: "4164520752",
      primaryContactEmail: "derek@example.com",
      category: "A",
      notes: "Contact-level note",
      expectedLastModified: "2026-03-04T16:39:08.13+00:00",
    });

    expect(payload).toMatchObject({
      ContactID: {
        value: 158410,
      },
      PrimaryContactID: {
        value: 158410,
      },
      PrimaryContact: {
        ContactID: {
          value: 158410,
        },
      },
    });
  });

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
      ContactID: {
        value: 158410,
      },
    });
    expect(payloads[1]).toEqual({
      PrimaryContact: {
        ContactID: {
          value: 158410,
        },
      },
    });
    expect(payloads).toHaveLength(7);
  });

  it("writes company phone to the existing Business1 field when requested", () => {
    const payload = buildBusinessAccountUpdatePayload(
      makePayload(),
      {
        companyName: "Alpha Inc",
        assignedBusinessAccountRecordId: "a1",
        assignedBusinessAccountId: "AC-100",
        addressLine1: "5579 McAdam Road",
        addressLine2: "",
        city: "Mississauga",
        state: "ON",
        postalCode: "L4Z 1N4",
        country: "CA",
        targetContactId: null,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
        industryType: "Distribution",
        subCategory: "Pharmaceuticals",
        companyRegion: "Region 1",
        week: "Week 1",
        companyPhone: "905-555-2222",
        primaryContactName: "Jorge Serrano",
        primaryContactPhone: "416-230-4681",
        primaryContactEmail: "jorge@example.com",
        category: "A",
        notes: "Contact-level note",
        expectedLastModified: "2026-03-04T16:39:08.13+00:00",
      },
      {
        includeCompanyPhone: true,
      },
    );

    expect(payload).toMatchObject({
      Business1: {
        value: "905-555-2222",
      },
    });
  });

  it("canonicalizes Region 10 when building business-account updates", () => {
    const payload = buildBusinessAccountUpdatePayload(makePayload(), {
      companyName: "Alpha Inc",
      assignedBusinessAccountRecordId: "a1",
      assignedBusinessAccountId: "AC-100",
      addressLine1: "5579 McAdam Road",
      addressLine2: "",
      city: "Mississauga",
      state: "ON",
      postalCode: "L4Z 1N4",
      country: "CA",
      targetContactId: null,
      setAsPrimaryContact: false,
      primaryOnlyIntent: false,
      salesRepId: "109343",
      salesRepName: "Jorge Serrano",
      industryType: "Distribution",
      subCategory: "Pharmaceuticals",
      companyRegion: "region10",
      week: "Week 1",
      companyPhone: "905-555-0100",
      primaryContactName: "Jorge Serrano",
      primaryContactPhone: "416-230-4681",
      primaryContactEmail: "jorge@example.com",
      category: "A",
      notes: "Contact-level note",
      expectedLastModified: "2026-03-04T16:39:08.13+00:00",
    });

    expect(payload).toMatchObject({
      Attributes: expect.arrayContaining([
        expect.objectContaining({
          AttributeID: { value: "REGION" },
          Value: { value: "Region 10" },
        }),
      ]),
    });
  });

  it("omits blank optional category and week updates", () => {
    const payload = buildBusinessAccountUpdatePayload(makePayload(), {
      companyName: "Alpha Inc",
      assignedBusinessAccountRecordId: "a1",
      assignedBusinessAccountId: "AC-100",
      addressLine1: "5579 McAdam Road",
      addressLine2: "",
      city: "Mississauga",
      state: "ON",
      postalCode: "L4Z 1N4",
      country: "CA",
      targetContactId: null,
      setAsPrimaryContact: false,
      primaryOnlyIntent: false,
      salesRepId: "109343",
      salesRepName: "Jorge Serrano",
      industryType: "Distribution",
      subCategory: "Pharmaceuticals",
      companyRegion: "Region 1",
      week: null,
      companyPhone: "905-555-0100",
      primaryContactName: "Jorge Serrano",
      primaryContactPhone: "416-230-4681",
      primaryContactEmail: "jorge@example.com",
      category: null,
      notes: "Contact-level note",
      expectedLastModified: "2026-03-04T16:39:08.13+00:00",
    });

    expect(payload).toMatchObject({
      Attributes: expect.arrayContaining([
        expect.objectContaining({
          AttributeID: { value: "INDUSTRY" },
          Value: { value: "Distributi" },
        }),
        expect.objectContaining({
          AttributeID: { value: "INDSUBCATE" },
          Value: { value: "Manufactur" },
        }),
        expect.objectContaining({
          AttributeID: { value: "REGION" },
          Value: { value: "Region 1" },
        }),
      ]),
    });
    expect(payload).not.toMatchObject({
      Attributes: expect.arrayContaining([
        expect.objectContaining({
          AttributeID: { value: "CLIENTTYPE" },
          Value: { value: "" },
        }),
      ]),
    });
    expect(payload).not.toMatchObject({
      Attributes: expect.arrayContaining([
        expect.objectContaining({
          AttributeID: { value: "WEEK" },
          Value: { value: "" },
        }),
      ]),
    });
  });

  it("falls back to BusinessPhone and then Phone1 when saving company phone", () => {
    const businessPhonePayload = buildBusinessAccountUpdatePayload(
      makePayload({
        Business1: {},
        BusinessPhone: { value: "905-555-0100" },
      }),
      {
        companyName: "Alpha Inc",
        assignedBusinessAccountRecordId: "a1",
        assignedBusinessAccountId: "AC-100",
        addressLine1: "5579 McAdam Road",
        addressLine2: "",
        city: "Mississauga",
        state: "ON",
        postalCode: "L4Z 1N4",
        country: "CA",
        targetContactId: null,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
        industryType: "Distribution",
        subCategory: "Pharmaceuticals",
        companyRegion: "Region 1",
        week: "Week 1",
        companyPhone: "905-555-2222",
        primaryContactName: "Jorge Serrano",
        primaryContactPhone: "416-230-4681",
        primaryContactEmail: "jorge@example.com",
        category: "A",
        notes: "Contact-level note",
        expectedLastModified: "2026-03-04T16:39:08.13+00:00",
      },
      {
        includeCompanyPhone: true,
      },
    );

    expect(businessPhonePayload).toMatchObject({
      BusinessPhone: {
        value: "905-555-2222",
      },
    });

    const phone1Payload = buildBusinessAccountUpdatePayload(
      makePayload({
        Business1: {},
        BusinessPhone: {},
        Phone1: { value: "905-555-0100" },
      }),
      {
        companyName: "Alpha Inc",
        assignedBusinessAccountRecordId: "a1",
        assignedBusinessAccountId: "AC-100",
        addressLine1: "5579 McAdam Road",
        addressLine2: "",
        city: "Mississauga",
        state: "ON",
        postalCode: "L4Z 1N4",
        country: "CA",
        targetContactId: null,
        setAsPrimaryContact: false,
        primaryOnlyIntent: false,
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
        industryType: "Distribution",
        subCategory: "Pharmaceuticals",
        companyRegion: "Region 1",
        week: "Week 1",
        companyPhone: "905-555-2222",
        primaryContactName: "Jorge Serrano",
        primaryContactPhone: "416-230-4681",
        primaryContactEmail: "jorge@example.com",
        category: "A",
        notes: "Contact-level note",
        expectedLastModified: "2026-03-04T16:39:08.13+00:00",
      },
      {
        includeCompanyPhone: true,
      },
    );

    expect(phone1Payload).toMatchObject({
      Phone1: {
        value: "905-555-2222",
      },
    });
  });

  it("includes target contact record-id variants for primary contact fallback payloads", () => {
    const payloads = buildPrimaryContactFallbackPayloads(makePayload(), 158410, {
      id: "80b4ba86-a8ef-f011-8370-025dbe72350a",
      NoteID: { value: "80b4ba86-a8ef-f011-8370-025dbe72350a" },
      ContactID: { value: 158410 },
    });

    expect(payloads).toContainEqual({
      PrimaryContact: {
        value: "80b4ba86-a8ef-f011-8370-025dbe72350a",
      },
    });
    expect(payloads).toContainEqual({
      PrimaryContact: {
        NoteID: {
          value: "80b4ba86-a8ef-f011-8370-025dbe72350a",
        },
      },
    });
  });

  it("writes the extension to Phone2 in primary contact payloads", () => {
    const payload = buildPrimaryContactUpdatePayload({
      companyName: "Alpha Inc",
      assignedBusinessAccountRecordId: "a1",
      assignedBusinessAccountId: "AC-100",
      addressLine1: "5579 McAdam Road",
      addressLine2: "",
      city: "Mississauga",
      state: "ON",
      postalCode: "L4Z 1N4",
      country: "CA",
      targetContactId: 158410,
      setAsPrimaryContact: false,
      primaryOnlyIntent: false,
      salesRepId: "109343",
      salesRepName: "Jorge Serrano",
      industryType: "Distribution",
      subCategory: "Pharmaceuticals",
      companyRegion: "Region 1",
      week: "Week 1",
      companyPhone: "905-555-2222",
      primaryContactName: "Jorge Serrano",
      primaryContactJobTitle: "Regional Sales Manager",
      primaryContactPhone: "416-230-4681",
      primaryContactExtension: "3008",
      primaryContactEmail: "jorge@example.com",
      category: "A",
      notes: "Contact-level note",
      expectedLastModified: "2026-03-04T16:39:08.13+00:00",
    });

    expect(payload).toMatchObject({
      JobTitle: {
        value: "Regional Sales Manager",
      },
      Phone1: {
        value: "416-230-4681",
      },
      Phone2: {
        value: "3008",
      },
    });
  });
});
