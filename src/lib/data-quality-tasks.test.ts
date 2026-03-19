import { buildDataQualitySnapshot } from "@/lib/data-quality";
import { buildDataQualityTasks } from "@/lib/data-quality-tasks";
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
    companyName: overrides.companyName ?? "Example Internal Company",
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
        : "jorge@example.com",
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

describe("data-quality tasks", () => {
  it("groups repeated company-assignment rows for the same person into one task", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "orphan-1",
        accountRecordId: "orphan-1",
        rowKey: "orphan-1:contact:44",
        businessAccountId: "",
        companyName: "",
        contactId: 44,
        primaryContactId: 44,
        primaryContactName: "Anthony Rimac",
        primaryContactEmail: "anthony.rimac@magna.com",
      }),
      buildRow({
        id: "orphan-2",
        accountRecordId: "orphan-2",
        rowKey: "orphan-2:contact:44",
        businessAccountId: "",
        companyName: "",
        contactId: 44,
        primaryContactId: 44,
        primaryContactName: "Anthony Rimac",
        primaryContactEmail: "anthony.rimac@magna.com",
      }),
    ]);

    const tasks = buildDataQualityTasks(snapshot);
    const companyTasks = tasks.tasks.filter((task) => task.metric === "missingCompany");

    expect(companyTasks).toHaveLength(1);
    expect(companyTasks[0]?.affectedCount).toBe(2);
    expect(companyTasks[0]?.relatedIssues).toHaveLength(2);
  });

  it("uses the best available clue across grouped company-assignment rows", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "orphan-best-1",
        accountRecordId: "orphan-best-1",
        rowKey: "orphan-best-1:contact:44",
        businessAccountId: "",
        companyName: "",
        contactId: 44,
        primaryContactId: 44,
        primaryContactName: null,
        primaryContactEmail: null,
        primaryContactPhone: null,
        address: "",
        addressLine1: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
      }),
      buildRow({
        id: "orphan-best-2",
        accountRecordId: "orphan-best-2",
        rowKey: "orphan-best-2:contact:44",
        businessAccountId: "",
        companyName: "",
        contactId: 44,
        primaryContactId: 44,
        primaryContactName: "Anthony Rimac",
        primaryContactEmail: "anthony.rimac@magna.com",
        address: "337 Magna Dr, Aurora ON L4G 7K1, CA",
      }),
    ]);

    const tasks = buildDataQualityTasks(snapshot);
    const companyTask = tasks.tasks.find((task) => task.metric === "missingCompany");

    expect(companyTask?.actionable).toBe(true);
    expect(companyTask?.title).toBe("Anthony Rimac");
    expect(companyTask?.companyAssignmentContext?.email).toBe("anthony.rimac@magna.com");
    expect(companyTask?.reviewReason).toBeNull();
  });

  it("moves zero-context company-assignment tasks into review", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "orphan-review",
        accountRecordId: "orphan-review",
        rowKey: "orphan-review:contact:99",
        businessAccountId: "",
        companyName: "",
        contactId: 99,
        primaryContactId: 99,
        primaryContactName: null,
        primaryContactEmail: null,
        primaryContactPhone: null,
        address: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
      }),
    ]);

    const tasks = buildDataQualityTasks(snapshot);
    const companyTask = tasks.tasks.find((task) => task.metric === "missingCompany");

    expect(companyTask?.actionable).toBe(false);
    expect(companyTask?.reviewReason).toBe("missing_identity");
    expect(companyTask?.title).toBe("Review unassigned record");
    expect(tasks.total).toBe(1);
    expect(tasks.reviewTotal).toBe(1);
  });

  it("counts only actionable tasks in totals and rep summaries", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "actionable-company",
        accountRecordId: "actionable-company",
        rowKey: "actionable-company:contact:2",
        businessAccountId: "",
        companyName: "",
        primaryContactName: "Allison Fagan",
        primaryContactEmail: "afagan@strategicpm.ca",
        contactId: 2,
        primaryContactId: 2,
        salesRepName: "Jorge Serrano",
      }),
      buildRow({
        id: "review-company",
        accountRecordId: "review-company",
        rowKey: "review-company:contact:3",
        businessAccountId: "",
        companyName: "",
        primaryContactName: null,
        primaryContactEmail: null,
        primaryContactPhone: null,
        address: "",
        addressLine1: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
        contactId: 3,
        primaryContactId: 3,
        salesRepId: null,
        salesRepName: null,
      }),
    ]);

    const tasks = buildDataQualityTasks(snapshot);
    const rep = tasks.reps.find((item) => item.salesRepName === "Jorge Serrano");

    expect(tasks.total).toBe(2);
    expect(tasks.reviewTotal).toBe(1);
    expect(rep?.openTasks).toBe(1);
  });

  it("dedupes account-level issues into a single task", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "acc-1",
        accountRecordId: "acc-1",
        rowKey: "acc-1:primary",
        businessAccountId: "ACC-1",
        companyName: "Category Missing Co",
        contactId: 100,
        primaryContactId: 100,
        category: null,
      }),
      buildRow({
        id: "acc-1",
        accountRecordId: "acc-1",
        rowKey: "acc-1:contact:101",
        businessAccountId: "ACC-1",
        companyName: "Category Missing Co",
        contactId: 101,
        primaryContactId: 100,
        category: null,
      }),
    ]);

    const tasks = buildDataQualityTasks(snapshot);
    const categoryTasks = tasks.tasks.filter((task) => task.metric === "missingCategory");

    expect(categoryTasks).toHaveLength(1);
    expect(categoryTasks[0]?.basis).toBe("account");
  });

  it("groups duplicate contacts into one task per duplicate set", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "dup-1",
        accountRecordId: "dup-1",
        rowKey: "dup-1:contact:1",
        businessAccountId: "DUP-1",
        companyName: "Duplicate Contact Co",
        contactId: 1,
        primaryContactId: 1,
        primaryContactName: "Jane Doe",
      }),
      buildRow({
        id: "dup-1",
        accountRecordId: "dup-1",
        rowKey: "dup-1:contact:2",
        businessAccountId: "DUP-1",
        companyName: "Duplicate Contact Co",
        contactId: 2,
        primaryContactId: 1,
        primaryContactName: "Jane Doe",
      }),
    ]);

    const tasks = buildDataQualityTasks(snapshot);
    const duplicateTasks = tasks.tasks.filter((task) => task.metric === "duplicateContact");

    expect(duplicateTasks).toHaveLength(1);
    expect(duplicateTasks[0]?.affectedCount).toBe(2);
    expect(duplicateTasks[0]?.actionPage).toBe("quality");
  });

  it("surfaces unassigned work under an Unassigned rep bucket", () => {
    const snapshot = buildDataQualitySnapshot([
      buildRow({
        id: "acc-unassigned",
        accountRecordId: "acc-unassigned",
        rowKey: "acc-unassigned:contact:55",
        businessAccountId: "ACC-U",
        companyName: "Unassigned Co",
        contactId: 55,
        primaryContactId: 55,
        salesRepId: null,
        salesRepName: null,
      }),
    ]);

    const tasks = buildDataQualityTasks(snapshot);
    const unassignedRep = tasks.reps.find((rep) => rep.salesRepName === "Unassigned");
    const salesRepTask = tasks.tasks.find((task) => task.metric === "missingSalesRep");

    expect(unassignedRep?.openTasks).toBe(1);
    expect(salesRepTask?.assigneeName).toBe("Unassigned");
  });
});
