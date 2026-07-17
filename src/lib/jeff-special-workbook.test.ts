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
      "Today — Jul 14",
      "Tomorrow — Jul 15",
      "Changes Since Original",
    ]);
    for (const worksheet of [
      workbook.getWorksheet("Today — Jul 14"),
      workbook.getWorksheet("Tomorrow — Jul 15"),
    ]) {
      expect(worksheet).toBeDefined();
      expect(worksheet.pageSetup.paperSize).toBe(3);
      expect(worksheet.pageSetup.orientation).toBe("landscape");
      expect(worksheet.pageSetup.fitToWidth).toBe(1);
      expect(worksheet.pageSetup.fitToHeight).toBe(1);
      expect(worksheet.pageSetup.printTitlesRow).toBe("1:4");
    }

    const firstSheet = workbook.getWorksheet("Today — Jul 14");
    expect(firstSheet?.getRow(4).values).toEqual([
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
    expect(firstSheet?.getCell("A1").text).toBe(
      "Tuesday, July 14, 2026 - Customer Visit Route",
    );
    expect(firstSheet?.getCell("A3").text).toBe("");
    expect(firstSheet?.getRow(3).height).toBe(6);
    expect(firstSheet?.getCell("A5").text).toBe("9:00-9:30");
    expect(firstSheet?.getCell("B5").text).toBe("CuBE Plastics");
    expect(firstSheet?.getCell("C5").text).toBe("1 Test Street, Aurora ON L4G 1A1, CA");
    expect(firstSheet?.getCell("C5").hyperlink).toBeUndefined();
    expect(firstSheet?.getCell("A6").text).toBe("Notes:");
    expect(firstSheet?.getCell("B6").text).toContain("Jeff to meet with David");
    expect(firstSheet?.getColumn(1).width).toBe(9.5);
    expect(firstSheet?.getColumn(7).width).toBe(33.88);
    expect(firstSheet?.getColumn(10).width).toBe(33.88);
    expect(firstSheet?.getRow(5).height).toBe(28.5);
    expect(firstSheet?.getRow(6).height).toBe(39);
    expect(firstSheet?.getRow(12).height).toBe(33);
    expect(firstSheet?.getCell("A1").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFDBE8F4" },
    });
    expect(firstSheet?.getCell("A4").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFEFF2F4" },
    });
    expect(firstSheet?.getCell("B6").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFF7F9FC" },
    });

    const secondSheet = workbook.getWorksheet("Tomorrow — Jul 15");
    expect(secondSheet?.getRow(5).height).toBe(36);
    expect(secondSheet?.getRow(6).height).toBe(39);
    expect(secondSheet?.getRow(10).height).toBe(28.5);

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
