import { describe, expect, it } from "vitest";

import {
  buildJeffSpecialReportPlan,
  JEFF_SPECIAL_REPORT_VISITS,
  type JeffSpecialVisitDefinition,
} from "@/lib/jeff-special-report";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(
  visit: JeffSpecialVisitDefinition,
  overrides: Partial<BusinessAccountRow> = {},
): BusinessAccountRow {
  return {
    id: visit.accountRecordId,
    accountRecordId: visit.accountRecordId,
    rowKey: `${visit.accountRecordId}:contact:1`,
    contactId: 1,
    isPrimaryContact: true,
    companyPhone: "905-555-0100",
    salesRepId: "109337",
    salesRepName: "Jeffery Buhagiar",
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: visit.businessAccountId,
    companyName: visit.companyName,
    address: "1 Test Street, Aurora ON L4G 1A1, CA",
    addressLine1: "1 Test Street",
    addressLine2: "",
    city: "Aurora",
    state: "ON",
    postalCode: "L4G 1A1",
    country: "CA",
    primaryContactName: "Primary Contact",
    primaryContactJobTitle: "Operations Manager",
    primaryContactPhone: "416-555-0100",
    primaryContactExtension: "123",
    primaryContactEmail: "primary@example.com",
    primaryContactId: 1,
    category: "B",
    notes: null,
    lastModifiedIso: null,
    ...overrides,
  };
}

const allVisits = JEFF_SPECIAL_REPORT_VISITS.flatMap((week) => week.visits);

describe("Jeff Special Report plan", () => {
  it("resolves the fixed 20 companies into the original two-week order", () => {
    const rows = allVisits.map((visit) => buildRow(visit));
    const firstVisit = allVisits[0];
    rows.push(buildRow(firstVisit, {
      rowKey: `${firstVisit.accountRecordId}:contact:2`,
      contactId: 2,
      isPrimaryContact: false,
      primaryContactName: "Alternate Contact",
      primaryContactEmail: "alternate@example.com",
    }));
    const plan = buildJeffSpecialReportPlan(
      rows,
      new Date("2026-07-17T12:00:00.000Z"),
    );

    expect(plan.accountTotal).toBe(20);
    expect(plan.matchedAccountTotal).toBe(20);
    expect(plan.missingAccountTotal).toBe(0);
    expect(plan.weeks.map((week) => week.visits.length)).toEqual([11, 9]);
    expect(plan.weeks[0].visits[0].companyName).toBe("CuBE Plastics");
    expect(plan.weeks[0].visits[0].time).toBe("9:00-9:30");
    expect(plan.weeks[0].visits[0].contactName).toBe("Primary Contact");
    expect(plan.weeks[1].visits[8].companyName).toBe("Acushnet Canada, Inc.");
    expect(plan.differences.length).toBeGreaterThan(0);
    expect(plan.differences).toContainEqual({
      week: 1,
      time: "9:00-9:30",
      companyName: "CuBE Plastics",
      field: "Contact Name",
      originalValue: "David Rubio",
      currentValue: "Primary Contact",
      result: "Changed",
    });
  });

  it("keeps missing fixed companies visible and reports the mismatch", () => {
    const plan = buildJeffSpecialReportPlan([buildRow(allVisits[0])]);

    expect(plan.accountTotal).toBe(20);
    expect(plan.matchedAccountTotal).toBe(1);
    expect(plan.missingAccountTotal).toBe(19);
    expect(plan.missingCompanyNames).toContain("TS Tech Canada");
    expect(plan.weeks[1].visits.find((visit) => visit.companyName === "TS Tech Canada")?.matched)
      .toBe(false);
    expect(plan.differences).toContainEqual({
      week: 2,
      time: "10:00-10:30",
      companyName: "TS Tech Canada",
      field: "CRM Record",
      originalValue: "TS Tech Canada",
      currentValue: "Not found",
      result: "CRM record missing",
    });
  });
});
