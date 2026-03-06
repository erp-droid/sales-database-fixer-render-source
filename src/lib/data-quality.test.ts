import {
  buildDataQualitySnapshot,
  groupRowsByAccount,
  isAttributeMissing,
  isShortTextMissing,
  paginateDataQualityIssues,
  toDataQualitySummaryResponse,
} from "@/lib/data-quality";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(overrides: Partial<BusinessAccountRow>): BusinessAccountRow {
  return {
    id: overrides.id ?? "row-id",
    accountRecordId: overrides.accountRecordId ?? "account-id",
    rowKey: overrides.rowKey ?? "row-key",
    contactId: overrides.contactId !== undefined ? overrides.contactId : 1,
    isPrimaryContact: overrides.isPrimaryContact ?? false,
    phoneNumber: overrides.phoneNumber !== undefined ? overrides.phoneNumber : "416-000-0000",
    salesRepId: overrides.salesRepId !== undefined ? overrides.salesRepId : "109343",
    salesRepName:
      overrides.salesRepName !== undefined ? overrides.salesRepName : "Jorge Serrano",
    industryType: overrides.industryType !== undefined ? overrides.industryType : "Distributi",
    subCategory: overrides.subCategory !== undefined ? overrides.subCategory : "Manufactur",
    companyRegion:
      overrides.companyRegion !== undefined ? overrides.companyRegion : "Region 1",
    week: overrides.week !== undefined ? overrides.week : "Week 1",
    businessAccountId: overrides.businessAccountId ?? "02670D2595",
    companyName: overrides.companyName ?? "MeadowBrook Construction - Internal",
    address: overrides.address ?? "5579 McAdam Road, Mississauga ON L4Z 1N4, CA",
    addressLine1: overrides.addressLine1 ?? "5579 McAdam Road",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Mississauga",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "L4Z 1N4",
    country: overrides.country ?? "CA",
    primaryContactName:
      overrides.primaryContactName !== undefined
        ? overrides.primaryContactName
        : "Jorge Serrano",
    primaryContactPhone:
      overrides.primaryContactPhone !== undefined
        ? overrides.primaryContactPhone
        : "416-230-4681",
    primaryContactEmail:
      overrides.primaryContactEmail !== undefined
        ? overrides.primaryContactEmail
        : "jserrano@meadowb.com",
    primaryContactId:
      overrides.primaryContactId !== undefined ? overrides.primaryContactId : 157497,
    category: overrides.category !== undefined ? overrides.category : "A",
    notes: overrides.notes !== undefined ? overrides.notes : null,
    lastModifiedIso:
      overrides.lastModifiedIso !== undefined
        ? overrides.lastModifiedIso
        : "2026-03-04T16:39:08.13+00:00",
  };
}

describe("data-quality helpers", () => {
  it("detects short missing text using <= 2 rule", () => {
    expect(isShortTextMissing("")).toBe(true);
    expect(isShortTextMissing("A")).toBe(true);
    expect(isShortTextMissing("AP")).toBe(true);
    expect(isShortTextMissing("Joe")).toBe(false);
  });

  it("detects missing attribute values", () => {
    expect(isAttributeMissing(null)).toBe(true);
    expect(isAttributeMissing("")).toBe(true);
    expect(isAttributeMissing("   ")).toBe(true);
    expect(isAttributeMissing("-")).toBe(true);
    expect(isAttributeMissing("Unassigned")).toBe(true);
    expect(isAttributeMissing("UNASSIGNED")).toBe(true);
    expect(isAttributeMissing("Region 1")).toBe(false);
  });

  it("treats orphan contacts with blank company name as a company assignment issue", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "orphan-contact",
        accountRecordId: "orphan-contact",
        rowKey: "orphan-contact:contact:42",
        businessAccountId: "",
        companyName: "",
        primaryContactName: "Jane Doe",
        primaryContactEmail: "jane@example.com",
        contactId: 42,
        primaryContactId: 42,
      }),
    ]);

    const metric = snapshot.metrics.find((item) => item.key === "missingCompany");
    expect(metric?.missingAccounts).toBe(1);
    expect(metric?.missingRows).toBe(1);
  });

  it("does not classify orphan contacts as sales representative issues", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "orphan-contact",
        accountRecordId: "orphan-contact",
        rowKey: "orphan-contact:contact:42",
        businessAccountId: "",
        companyName: "",
        primaryContactName: ". .",
        primaryContactEmail: "orphan@example.com",
        contactId: 42,
        primaryContactId: 42,
        salesRepId: "",
        salesRepName: "",
      }),
    ]);

    const metric = snapshot.metrics.find((item) => item.key === "missingSalesRep");
    expect(metric?.missingAccounts).toBe(0);
    expect(metric?.missingRows).toBe(0);
  });

  it("excludes AP-mailbox rows from data-quality totals and issue counts", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "ap-contact",
        accountRecordId: "ap-contact",
        rowKey: "ap-contact:contact:1",
        businessAccountId: "AP-100",
        companyName: "Triovest",
        primaryContactName: "Inquiry",
        primaryContactEmail: "ontarioap@triovest.com",
      }),
      buildRow({
        id: "normal-contact",
        accountRecordId: "normal-contact",
        rowKey: "normal-contact:contact:2",
        businessAccountId: "",
        companyName: "",
        primaryContactName: "Jane Doe",
        primaryContactEmail: "jane@example.com",
      }),
    ]);

    expect(snapshot.totals.rows).toBe(1);
    expect(snapshot.totals.accounts).toBe(1);
    const missingCompanyMetric = snapshot.metrics.find((item) => item.key === "missingCompany");
    expect(missingCompanyMetric?.missingRows).toBe(1);
  });

  it("excludes contact rows with blank names from data-quality totals and issue counts", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "blank-contact",
        accountRecordId: "blank-contact",
        rowKey: "blank-contact:contact:1",
        businessAccountId: "BLANK-100",
        companyName: "Blank Contact Co",
        primaryContactName: "   ",
        primaryContactEmail: "blank@example.com",
      }),
      buildRow({
        id: "normal-contact",
        accountRecordId: "normal-contact",
        rowKey: "normal-contact:contact:2",
        businessAccountId: "",
        companyName: "",
        primaryContactName: "Jane Doe",
        primaryContactEmail: "jane@example.com",
      }),
    ]);

    expect(snapshot.totals.rows).toBe(1);
    expect(snapshot.totals.accounts).toBe(1);
    const missingCompanyMetric = snapshot.metrics.find((item) => item.key === "missingCompany");
    expect(missingCompanyMetric?.missingRows).toBe(1);
  });

  it("does not flag a synthetic primary row when a sibling row already resolves the same primary contact", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "acc-640",
        accountRecordId: "acc-640",
        rowKey: "acc-640:primary",
        businessAccountId: "B200000640",
        companyName: "3M Canada Company",
        contactId: 154987,
        isPrimaryContact: true,
        primaryContactId: 154987,
        primaryContactName: null,
        primaryContactEmail: "epreza@mmm.com",
      }),
      buildRow({
        id: "acc-640",
        accountRecordId: "acc-640",
        rowKey: "acc-640:contact:157847",
        businessAccountId: "B200000640",
        companyName: "3M Canada Company",
        contactId: 157847,
        isPrimaryContact: true,
        primaryContactId: 154987,
        primaryContactName: "Enrique Preza",
        primaryContactEmail: "epreza@mmm.com",
      }),
    ]);

    const metric = snapshot.metrics.find((item) => item.key === "missingContact");
    expect(metric?.missingAccounts).toBe(0);
    expect(metric?.missingRows).toBe(0);
    expect(snapshot.issues.missingContact.row).toHaveLength(0);
  });

  it("flags accounts with no associated contact rows as primary contact issues", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "acc-no-contact",
        accountRecordId: "acc-no-contact",
        rowKey: "acc-no-contact:primary",
        businessAccountId: "ACC-NO-CONTACT",
        companyName: "Costco Wholesale Burlington #253",
        contactId: 154517,
        isPrimaryContact: true,
        primaryContactId: 154517,
        primaryContactName: null,
        primaryContactEmail: "w253mgr2@costco.com",
      }),
    ]);

    const metric = snapshot.metrics.find((item) => item.key === "missingContact");
    expect(metric?.missingAccounts).toBe(1);
    expect(metric?.missingRows).toBe(1);
    expect(snapshot.issues.missingContact.row).toHaveLength(1);
  });

  it("flags invalid contact phone numbers when they are not ###-###-#### or start with 111", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "phone-1",
        accountRecordId: "phone-acc-1",
        rowKey: "phone-acc-1:contact:1",
        businessAccountId: "PHONE-1",
        companyName: "Bad Phone Formatting",
        primaryContactPhone: "4162304681",
      }),
      buildRow({
        id: "phone-2",
        accountRecordId: "phone-acc-2",
        rowKey: "phone-acc-2:contact:2",
        businessAccountId: "PHONE-2",
        companyName: "Bad Phone Prefix",
        primaryContactPhone: "111-555-0100",
      }),
      buildRow({
        id: "phone-3",
        accountRecordId: "phone-acc-3",
        rowKey: "phone-acc-3:contact:3",
        businessAccountId: "PHONE-3",
        companyName: "Valid Phone",
        primaryContactPhone: "416-555-0101",
      }),
    ]);

    const metric = snapshot.metrics.find((item) => item.key === "invalidPhone");
    expect(metric?.missingAccounts).toBe(2);
    expect(metric?.missingRows).toBe(2);
    expect(snapshot.issues.invalidPhone.row).toHaveLength(2);
  });

  it("flags contact rows with missing email addresses", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "email-1",
        accountRecordId: "email-acc-1",
        rowKey: "email-acc-1:contact:1",
        businessAccountId: "EMAIL-1",
        companyName: "Missing Email",
        primaryContactEmail: null,
      }),
      buildRow({
        id: "email-2",
        accountRecordId: "email-acc-2",
        rowKey: "email-acc-2:contact:2",
        businessAccountId: "EMAIL-2",
        companyName: "Present Email",
        primaryContactEmail: "present@example.com",
      }),
    ]);

    const metric = snapshot.metrics.find((item) => item.key === "missingContactEmail");
    expect(metric?.missingAccounts).toBe(1);
    expect(metric?.missingRows).toBe(1);
    expect(snapshot.issues.missingContactEmail.row).toHaveLength(1);
  });
});

describe("buildDataQualitySnapshot", () => {
  const rows: BusinessAccountRow[] = [
    buildRow({
      id: "row-1",
      accountRecordId: "acc-1",
      rowKey: "acc-1:contact:1",
      businessAccountId: "ACC-1",
      companyName: "Acme Inc.",
      primaryContactName: "Jo",
      primaryContactEmail: "jo@acme.com",
      primaryContactId: 1,
    }),
    buildRow({
      id: "row-2",
      accountRecordId: "acc-1",
      rowKey: "acc-1:contact:2",
      contactId: 2,
      businessAccountId: "ACC-1",
      companyName: "Acme Inc.",
      primaryContactName: "John Manager",
      primaryContactEmail: "john@acme.com",
      primaryContactId: 2,
    }),
    buildRow({
      id: "row-3",
      accountRecordId: "acc-2",
      rowKey: "acc-2:contact:3",
      contactId: 3,
      businessAccountId: "ACC-2",
      companyName: "A",
      salesRepId: null,
      salesRepName: null,
      primaryContactName: null,
      primaryContactEmail: null,
      primaryContactPhone: null,
      primaryContactId: null,
      category: null,
      companyRegion: "Unassigned",
      subCategory: "-",
      industryType: "",
    }),
    buildRow({
      id: "row-4",
      accountRecordId: "acc-3",
      rowKey: "acc-3:contact:4",
      contactId: 4,
      businessAccountId: "ACC-3",
      companyName: "Acme Incorporated",
      salesRepId: null,
      salesRepName: null,
      primaryContactName: "Mary Jane",
      primaryContactEmail: "mary.jane@acme.com",
      category: "B",
      companyRegion: "Region 2",
      subCategory: "Manufactur",
      industryType: "Service",
    }),
    buildRow({
      id: "row-5",
      accountRecordId: "acc-3",
      rowKey: "acc-3:contact:5",
      contactId: 5,
      businessAccountId: "ACC-3",
      companyName: "Acme Incorporated",
      salesRepId: null,
      salesRepName: null,
      primaryContactName: "Mary-Jane",
      primaryContactEmail: "maryj@acme.com",
      category: "B",
      companyRegion: "Region 2",
      subCategory: "Manufactur",
      industryType: "Service",
    }),
  ];

  it("groups rows by account", () => {
    const groups = groupRowsByAccount(rows);
    expect(groups).toHaveLength(3);
    expect(groups[0].rows.length + groups[1].rows.length + groups[2].rows.length).toBe(5);
  });

  it("computes missing, duplicate, and missing-sales-rep counts", () => {
    const snapshot = buildDataQualitySnapshot(rows, "2026-03-05T15:00:00.000Z");
    const metric = (key: string) => snapshot.metrics.find((item) => item.key === key)!;

    expect(snapshot.totals).toEqual({
      accounts: 2,
      rows: 4,
    });

    expect(metric("missingCompany").missingAccounts).toBe(0);
    expect(metric("missingCompany").missingRows).toBe(0);

    expect(metric("missingContact").missingAccounts).toBe(0);
    expect(metric("missingContact").missingRows).toBe(0);

    expect(metric("invalidPhone").missingAccounts).toBe(0);
    expect(metric("invalidPhone").missingRows).toBe(0);

    expect(metric("missingContactEmail").missingAccounts).toBe(0);
    expect(metric("missingContactEmail").missingRows).toBe(0);

    expect(metric("missingSalesRep").missingAccounts).toBe(1);
    expect(metric("missingSalesRep").missingRows).toBe(2);

    expect(metric("duplicateBusinessAccount").missingAccounts).toBe(2);
    expect(metric("duplicateBusinessAccount").missingRows).toBe(2);

    expect(metric("duplicateContact").missingAccounts).toBe(1);
    expect(metric("duplicateContact").missingRows).toBe(2);

    expect(metric("missingCategory").missingAccounts).toBe(0);
    expect(metric("missingRegion").missingAccounts).toBe(0);
    expect(metric("missingSubCategory").missingAccounts).toBe(0);
    expect(metric("missingIndustry").missingAccounts).toBe(0);

    expect(metric("missingContact").rowMissingPct).toBe(0);
    expect(metric("missingCompany").accountMissingPct).toBe(0);
    expect(snapshot.issueTotals).toEqual({
      accountsWithIssues: 2,
      rowsWithIssues: 4,
      accountIssuePct: 100,
      rowIssuePct: 100,
    });
    expect(snapshot.overallScorePct).toBe(81.8);
  });

  it("builds summary response schema", () => {
    const snapshot = buildDataQualitySnapshot(rows, "2026-03-05T15:00:00.000Z");
    const summary = toDataQualitySummaryResponse(snapshot);

    expect(summary.source).toBe("live");
    expect(summary.computedAtIso).toBe("2026-03-05T15:00:00.000Z");
    expect(summary.issueTotals).toEqual({
      accountsWithIssues: 2,
      rowsWithIssues: 4,
      accountIssuePct: 100,
      rowIssuePct: 100,
    });
    expect(summary.metrics).toHaveLength(11);
  });

  it("paginates issue rows per metric+basis", () => {
    const snapshot = buildDataQualitySnapshot(rows, "2026-03-05T15:00:00.000Z");
    const page1 = paginateDataQualityIssues(snapshot, "duplicateContact", "row", 1, 1);
    const page2 = paginateDataQualityIssues(snapshot, "duplicateContact", "row", 2, 1);

    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    const names = [page1.items[0].contactName, page2.items[0].contactName];
    expect(names).toContain("Mary Jane");
    expect(names).toContain("Mary-Jane");
    expect(page1.items[0].duplicateGroupKey).toBe("acc-3|mary jane");
    expect(page2.items[0].duplicateGroupKey).toBe("acc-3|mary jane");
  });

  it("does not mark duplicate business accounts when company names match but addresses differ", () => {
    const addressVariantRows: BusinessAccountRow[] = [
      buildRow({
        id: "addr-row-1",
        accountRecordId: "addr-acc-1",
        rowKey: "addr-acc-1:contact:11",
        businessAccountId: "ADDR-1",
        companyName: "Ontario Health atHome",
        address: "199 County Court Blvd, Brampton ON L6W4P3, CA",
        addressLine1: "199 County Court Blvd",
        city: "Brampton",
        state: "ON",
        postalCode: "L6W 4P3",
      }),
      buildRow({
        id: "addr-row-2",
        accountRecordId: "addr-acc-2",
        rowKey: "addr-acc-2:contact:12",
        businessAccountId: "ADDR-2",
        companyName: "Ontario Health @ Home",
        address: "218 Henry Street, Brantford ON N3S 7R4, CA",
        addressLine1: "218 Henry Street",
        city: "Brantford",
        state: "ON",
        postalCode: "N3S 7R4",
      }),
    ];

    const snapshot = buildDataQualitySnapshot(addressVariantRows, "2026-03-05T15:00:00.000Z");
    const duplicateMetric = snapshot.metrics.find(
      (item) => item.key === "duplicateBusinessAccount",
    );

    expect(duplicateMetric?.missingAccounts).toBe(0);
    expect(duplicateMetric?.missingRows).toBe(0);
    expect(snapshot.issues.duplicateBusinessAccount.account).toHaveLength(0);
    expect(snapshot.issues.duplicateBusinessAccount.row).toHaveLength(0);
  });

  it("does not treat a primary placeholder row as a missing-contact issue when a sibling row resolves the same primary contact", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "primary-only",
        accountRecordId: "acc-missing-contact",
        rowKey: "acc-missing-contact:primary",
        businessAccountId: "ACC-MISSING-CONTACT",
        companyName: "ABB Inc.",
        contactId: 154499,
        isPrimaryContact: true,
        primaryContactId: 154499,
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactEmail: null,
      }),
      buildRow({
        id: "secondary-contact",
        accountRecordId: "acc-missing-contact",
        rowKey: "acc-missing-contact:contact:156943",
        businessAccountId: "ACC-MISSING-CONTACT",
        companyName: "ABB Inc.",
        contactId: 156943,
        isPrimaryContact: false,
        primaryContactId: 154499,
        primaryContactName: "Satish Dokur",
        primaryContactPhone: "416-555-0101",
        primaryContactEmail: "satish@example.com",
      }),
    ]);

    expect(snapshot.issues.missingContact.row).toHaveLength(0);
    expect(snapshot.issues.missingContact.account).toHaveLength(0);
  });
});
