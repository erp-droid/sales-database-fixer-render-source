import {
  applyOptimisticCreatedAccountRequestToRow,
  applyOptimisticCreatedAccountRequestToRows,
  buildBusinessAccountCreatePayload,
  buildContactCreatePayload,
  CONTACT_CLASS_VALUE_MAP,
} from "@/lib/business-account-create";
import type { BusinessAccountRow } from "@/types/business-account";

describe("buildBusinessAccountCreatePayload", () => {
  const baseRequest = {
    companyName: "Alpha Inc",
    classId: "LEAD" as const,
    salesRepId: "109343",
    salesRepName: "Jorge Serrano",
    industryType: "Distribution",
    subCategory: "Pharmaceuticals",
    companyRegion: "Region 1",
    week: "Week 1",
    category: "A" as const,
    addressLookupId: "cp-123",
    addressLine1: "5579 McAdam Road",
    addressLine2: "Unit 4",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA" as const,
  };

  it("maps LEAD to the Acumatica lead class and type", () => {
    const payload = buildBusinessAccountCreatePayload(baseRequest);

    expect(payload).toMatchObject({
      Name: { value: "Alpha Inc" },
      ClassID: { value: "LEAD" },
      Type: { value: "Lead" },
    });
  });

  it("maps CUSTOMER to the Acumatica customer class and type", () => {
    const payload = buildBusinessAccountCreatePayload({
      ...baseRequest,
      classId: "CUSTOMER",
    });

    expect(payload).toMatchObject({
      ClassID: { value: "CUSTOMER" },
      Type: { value: "Customer" },
    });
  });

  it("emits the required attributes", () => {
    const payload = buildBusinessAccountCreatePayload(baseRequest) as {
      Attributes: Array<Record<string, { value: string }>>;
    };

    expect(payload.Attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          AttributeID: { value: "CLIENTTYPE" },
          Value: { value: "A" },
        }),
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
    );
  });

  it("canonicalizes Region 10 when creating the REGION attribute", () => {
    const payload = buildBusinessAccountCreatePayload({
      ...baseRequest,
      companyRegion: "region10",
    }) as {
      Attributes: Array<Record<string, { value: string }>>;
    };

    expect(payload.Attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          AttributeID: { value: "REGION" },
          Value: { value: "Region 10" },
        }),
      ]),
    );
  });

  it("omits the WEEK attribute when blank", () => {
    const payload = buildBusinessAccountCreatePayload({
      ...baseRequest,
      week: null,
    }) as {
      Attributes: Array<Record<string, { value: string }>>;
    };

    expect(
      payload.Attributes.some(
        (attribute) => attribute.AttributeID?.value === "WEEK",
      ),
    ).toBe(false);
  });

  it("maps the canonical address with unit number override", () => {
    const payload = buildBusinessAccountCreatePayload(baseRequest) as {
      MainAddress: Record<string, { value: string }>;
    };

    expect(payload.MainAddress).toMatchObject({
      AddressLine1: { value: "5579 McAdam Road" },
      AddressLine2: { value: "Unit 4" },
      City: { value: "Mississauga" },
      State: { value: "ON" },
      PostalCode: { value: "L4Z 1N4" },
      Country: { value: "CA" },
    });
  });
});

describe("buildContactCreatePayload", () => {
  it("maps all required contact fields", () => {
    const payload = buildContactCreatePayload({
      request: {
        displayName: "Jorge Serrano",
        jobTitle: "Sales",
        email: "jserrano@meadowb.com",
        phone1: "416-230-4681",
        contactClass: "sales",
      },
      businessAccountId: "B200000003",
      companyName: "Alpha Inc",
    });

    expect(payload).toMatchObject({
      DisplayName: { value: "Jorge Serrano" },
      FirstName: { value: "Jorge" },
      LastName: { value: "Serrano" },
      JobTitle: { value: "Sales" },
      Email: { value: "jserrano@meadowb.com" },
      Phone1: { value: "416-230-4681" },
      BusinessAccount: { value: "B200000003" },
      CompanyName: { value: "Alpha Inc" },
      Type: { value: "Contact" },
    });
  });

  it("falls back to a last-name-only payload for single-word names", () => {
    const payload = buildContactCreatePayload({
      request: {
        displayName: "Prince",
        jobTitle: "Sales",
        email: "prince@example.com",
        phone1: "416-230-4681",
        contactClass: "sales",
      },
      businessAccountId: "B200000003",
      companyName: "Alpha Inc",
    });

    expect(payload).toMatchObject({
      DisplayName: { value: "Prince" },
      LastName: { value: "Prince" },
    });
    expect(payload).not.toHaveProperty("FirstName");
  });

  it("uses the centralized contact class mapping", () => {
    const payload = buildContactCreatePayload({
      request: {
        displayName: "Jorge Serrano",
        jobTitle: "Sales",
        email: "jserrano@meadowb.com",
        phone1: "416-230-4681",
        contactClass: "billing",
      },
      businessAccountId: "B200000003",
      companyName: "Alpha Inc",
    });

    expect(payload).toMatchObject({
      ContactClass: { value: CONTACT_CLASS_VALUE_MAP.billing },
    });
  });
});

describe("applyOptimisticCreatedAccountRequestToRows", () => {
  const baseRequest = {
    companyName: "Alpha Inc",
    classId: "LEAD" as const,
    salesRepId: "E0000045",
    salesRepName: "Jorge Serrano",
    industryType: "Service",
    subCategory: "General",
    companyRegion: "Region 6",
    week: "Week 7",
    category: "A" as const,
    addressLookupId: "cp-123",
    addressLine1: "5579 McAdam Road",
    addressLine2: "Unit 4",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA" as const,
  };

  const baseRow: BusinessAccountRow = {
    id: "account-1",
    accountRecordId: "account-1",
    rowKey: "account-1:primary",
    contactId: null,
    isPrimaryContact: true,
    companyPhone: null,
    companyPhoneSource: null,
    phoneNumber: null,
    salesRepId: null,
    salesRepName: null,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: "B200000003",
    companyName: "Alpha Inc",
    address: "5579 McAdam Road, Mississauga, ON L4Z 1N4, CA",
    addressLine1: "5579 McAdam Road",
    addressLine2: "",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA",
    primaryContactName: null,
    primaryContactPhone: null,
    primaryContactEmail: null,
    primaryContactId: null,
    category: null,
    notes: null,
    lastModifiedIso: null,
  };

  it("applies created account attributes to stale normalized rows", () => {
    const rows = applyOptimisticCreatedAccountRequestToRows([baseRow], baseRequest);

    expect(rows[0]).toMatchObject({
      companyName: "Alpha Inc",
      salesRepId: "E0000045",
      salesRepName: "Jorge Serrano",
      industryType: "Service",
      subCategory: "General",
      companyRegion: "Region 6",
      week: "Week 7",
      category: "A",
      addressLine2: "Unit 4",
    });
    expect(rows[0]?.address).toBe("5579 McAdam Road Unit 4, Mississauga ON L4Z 1N4, CA");
  });

  it("applies created account attributes to an individual created row", () => {
    const row = applyOptimisticCreatedAccountRequestToRow(baseRow, baseRequest);

    expect(row).toMatchObject({
      salesRepId: "E0000045",
      industryType: "Service",
      subCategory: "General",
      companyRegion: "Region 6",
      week: "Week 7",
      category: "A",
    });
  });
});
