import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildJeffSpecialReportPlan,
  JEFF_SPECIAL_REPORT_VISITS,
  type JeffSpecialVisitDefinition,
} from "@/lib/jeff-special-report";
import { buildJeffSpecialWorkbook } from "@/lib/jeff-special-workbook";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(visit: JeffSpecialVisitDefinition): BusinessAccountRow {
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
  };
}

describe("Jeff Special Report workbook", () => {
  it("creates two route sheets and a print-ready original-to-current comparison", async () => {
    const rows = JEFF_SPECIAL_REPORT_VISITS
      .flatMap((week) => week.visits)
      .map(buildRow);
    const plan = buildJeffSpecialReportPlan(
      rows,
      new Date("2026-07-17T12:00:00.000Z"),
    );
    const output = await buildJeffSpecialWorkbook(plan);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output);

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "Week 1",
      "Week 2",
      "Changes Since Original",
    ]);
    for (const worksheet of [workbook.getWorksheet("Week 1"), workbook.getWorksheet("Week 2")]) {
      expect(worksheet).toBeDefined();
      expect(worksheet.pageSetup.paperSize).toBe(3);
      expect(worksheet.pageSetup.orientation).toBe("landscape");
      expect(worksheet.pageSetup.fitToWidth).toBe(1);
      expect(worksheet.pageSetup.fitToHeight).toBe(1);
      expect(worksheet.pageSetup.printTitlesRow).toBe("1:3");
    }

    const firstSheet = workbook.getWorksheet("Week 1");
    expect(firstSheet?.getRow(3).values).toEqual([
      undefined,
      "Time",
      "Company",
      "Address",
      "City",
      "Company Phone",
      "Contact Name",
      "Job Title",
      "Contact Phone",
      "Extension",
      "Email Address",
    ]);
    expect(firstSheet?.getCell("A4").text).toBe("9:00-9:30");
    expect(firstSheet?.getCell("B4").text).toBe("CuBE Plastics");
    expect(firstSheet?.getCell("C4").hyperlink).toContain("google.com/maps/search");
    expect(firstSheet?.getCell("A5").text).toBe("Notes:");
    expect(firstSheet?.getCell("B5").text).toContain("Jeff to meet with David");

    const changesSheet = workbook.getWorksheet("Changes Since Original");
    expect(changesSheet?.pageSetup.paperSize).toBe(3);
    expect(changesSheet?.pageSetup.orientation).toBe("landscape");
    expect(changesSheet?.pageSetup.fitToWidth).toBe(1);
    expect(changesSheet?.pageSetup.fitToHeight).toBe(0);
    expect(changesSheet?.pageSetup.printTitlesRow).toBe("1:3");
    expect(changesSheet?.getRow(3).values).toEqual([
      undefined,
      "Week",
      "Time",
      "Company",
      "Field",
      "Original Report",
      "Current CRM",
      "Result",
    ]);
    expect(changesSheet?.getCell("C4").text).toBe("CuBE Plastics");
    expect(changesSheet?.getCell("G4").text).toMatch(/Added|Changed|Removed/);
  });
});
