import {
  buildBusinessAccountCreatePayload,
  buildContactCreatePayload,
  CONTACT_CLASS_VALUE_MAP,
} from "@/lib/business-account-create";

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
      JobTitle: { value: "Sales" },
      Email: { value: "jserrano@meadowb.com" },
      Phone1: { value: "416-230-4681" },
      BusinessAccount: { value: "B200000003" },
      CompanyName: { value: "Alpha Inc" },
      Type: { value: "Contact" },
    });
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
