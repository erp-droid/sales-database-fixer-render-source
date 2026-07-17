import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildAddressKeyFromRow } from "@/lib/read-model/geocodes";
import { buildVisitationRoutePlan } from "@/lib/visitation-route-report";
import { buildVisitationRouteWorkbook } from "@/lib/visitation-route-workbook";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(): BusinessAccountRow {
  return {
    id: "account-1",
    accountRecordId: "account-1",
    rowKey: "account-1:contact:1",
    contactId: 1,
    isPrimaryContact: true,
    companyPhone: "905-555-0100",
    salesRepId: "rep-1",
    salesRepName: "Jeffery Ye",
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: "B0001",
    companyName: "Example Company",
    address: "1 Test Street, Toronto ON M1A 1A1, CA",
    addressLine1: "1 Test Street",
    addressLine2: "",
    city: "Toronto",
    state: "ON",
    postalCode: "M1A 1A1",
    country: "CA",
    primaryContactName: "Primary Contact",
    primaryContactJobTitle: "Operations Manager",
    primaryContactPhone: "416-555-0100",
    primaryContactExtension: "123",
    primaryContactEmail: "contact@example.com",
    primaryContactId: 1,
    category: "A",
    notes: null,
    lastModifiedIso: null,
  };
}

describe("visitation route workbook", () => {
  it("creates a 60-tab, print-ready 11x17 Excel workbook", async () => {
    const row = buildRow();
    const plan = buildVisitationRoutePlan({
      rows: [row],
      geocodes: new Map([
        [buildAddressKeyFromRow(row), { latitude: 43.7, longitude: -79.4 }],
      ]),
      salesRepName: "Jeffery Ye",
      generatedAt: new Date("2026-07-17T12:00:00.000Z"),
    });
    const output = await buildVisitationRouteWorkbook(plan);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output);

    expect(workbook.worksheets).toHaveLength(60);
    expect(workbook.worksheets[0].name).toBe("W1 D1");
    expect(workbook.worksheets[59].name).toBe("W12 D5");

    for (const worksheet of workbook.worksheets) {
      expect(worksheet.pageSetup.paperSize).toBe(3);
      expect(worksheet.pageSetup.orientation).toBe("landscape");
      expect(worksheet.pageSetup.fitToPage).toBe(true);
      expect(worksheet.pageSetup.fitToWidth).toBe(1);
      expect(worksheet.pageSetup.fitToHeight).toBe(1);
      expect(worksheet.pageSetup.printTitlesRow).toBe("1:3");
    }

    const populatedSheet = workbook.worksheets.find((worksheet) =>
      worksheet.getCell("B4").text.includes("Example Company"),
    );
    expect(populatedSheet).toBeDefined();
    expect(populatedSheet?.getRow(3).values).toEqual([
      undefined,
      "Stop",
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
    expect(populatedSheet?.getCell("C4").hyperlink).toContain("google.com/maps/search");
    expect(populatedSheet?.getCell("A5").text).toBe("Notes:");
    const headerText = (populatedSheet?.getRow(3).values ?? []).join("|");
    expect(headerText).not.toContain("Sales Rep");
    expect(headerText).not.toContain("Category");
  });
});
