import path from "node:path";

import ExcelJS, { type Fill, type PaperSize } from "exceljs";

import type {
  JeffSpecialReportPlan,
} from "@/lib/jeff-special-report";

const COLUMN_HEADERS = [
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
] as const;

const BRAND_BLUE = "FF163A63";
const BRAND_GREEN = "FF78A22F";
const PALE_GREEN = "FFF1F7E8";
const BORDER_BLUE = "FF9FB2C8";
const TEXT_DARK = "FF172033";
const WHITE = "FFFFFFFF";
const PALE_AMBER = "FFFFF2CC";
const PALE_RED = "FFFDE9E7";
const TEXT_GREEN = "FF3D6B12";
const TEXT_AMBER = "FF8A5700";
const TEXT_RED = "FF9B2C22";
const SOURCE_TITLE_FILL = "FFDBE8F4";
const SOURCE_HEADER_FILL = "FFEFF2F4";
const SOURCE_NOTES_FILL = "FFF7F9FC";
const SOURCE_TEXT = "FF1E1E1E";
const SOURCE_MUTED = "FF59606B";
const SOURCE_BORDER = "FFD6DBE2";
const SOURCE_HEADER_BORDER = "FFADB2B7";

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER_BLUE } },
  left: { style: "thin", color: { argb: BORDER_BLUE } },
  bottom: { style: "thin", color: { argb: BORDER_BLUE } },
  right: { style: "thin", color: { argb: BORDER_BLUE } },
};

const SOURCE_THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: SOURCE_BORDER } },
  left: { style: "thin", color: { argb: SOURCE_BORDER } },
  bottom: { style: "thin", color: { argb: SOURCE_BORDER } },
  right: { style: "thin", color: { argb: SOURCE_BORDER } },
};

function solidFill(argb: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

export function buildJeffSpecialWorkbookFilename(date: Date = new Date()): string {
  return `jeff-special-report-${date.toISOString().slice(0, 10)}.xlsx`;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 30;
  row.eachCell((cell) => {
    cell.fill = solidFill(BRAND_BLUE);
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = THIN_BORDER;
  });
}

function styleRouteHeaderRow(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = solidFill(SOURCE_HEADER_FILL);
    cell.font = { bold: true, color: { argb: SOURCE_TEXT }, size: 10, name: "Arial" };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    cell.border = {
      bottom: { style: "medium", color: { argb: SOURCE_HEADER_BORDER } },
    };
  });
}

function styleRouteVisitRow(row: ExcelJS.Row, height: number): void {
  row.height = height;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { color: { argb: SOURCE_TEXT }, size: 10, name: "Arial" };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = SOURCE_THIN_BORDER;
  });
  row.getCell(1).font = { color: { argb: SOURCE_TEXT }, size: 9, name: "Arial" };
  row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
}

function routeSheetDetails(weekNumber: number): {
  name: string;
  title: string;
  visitRowHeight: number;
} {
  return weekNumber === 1
    ? {
        name: "Today — Jul 14",
        title: "Tuesday, July 14, 2026 - Customer Visit Route",
        visitRowHeight: 28.5,
      }
    : {
        name: "Tomorrow — Jul 15",
        title: "Wednesday, July 15, 2026 - Customer Visit Route",
        visitRowHeight: 36,
      };
}

function routeNotesRowHeight(weekNumber: number, visitIndex: number): number {
  if (weekNumber === 1 && visitIndex === 0) {
    return 39;
  }
  if (weekNumber === 1 && visitIndex === 3) {
    return 33;
  }
  if (weekNumber === 2 && visitIndex < 2) {
    return 39;
  }
  return 28.5;
}

function addWeekWorksheet(
  workbook: ExcelJS.Workbook,
  week: JeffSpecialReportPlan["weeks"][number],
  logoImageId: number,
): void {
  const sheetDetails = routeSheetDetails(week.week);
  const worksheet = workbook.addWorksheet(sheetDetails.name, {
    properties: { defaultRowHeight: 15 },
    pageSetup: {
      // OOXML paper size 3 is Tabloid / Ledger (11 x 17 inches).
      paperSize: 3 as PaperSize,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      verticalCentered: false,
      showGridLines: true,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.75,
        bottom: 0.75,
        header: 0,
        footer: 0,
      },
    },
    views: [{ state: "frozen", ySplit: 4, activeCell: "A5", showGridLines: true }],
  });

  worksheet.columns = [
    { key: "time", width: 9.5 },
    { key: "company", width: 22 },
    { key: "address", width: 27 },
    { key: "city", width: 11.38 },
    { key: "companyPhone", width: 14.5 },
    { key: "contactName", width: 16.38 },
    { key: "jobTitle", width: 33.88 },
    { key: "contactPhone", width: 14.5 },
    { key: "extension", width: 9.5 },
    { key: "email", width: 33.88 },
  ];

  worksheet.mergeCells("A1:I1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = sheetDetails.title;
  titleCell.fill = solidFill(SOURCE_TITLE_FILL);
  titleCell.font = { bold: true, color: { argb: SOURCE_TEXT }, size: 14, name: "Arial" };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getRow(1).height = 39;

  worksheet.addImage(logoImageId, {
    tl: { col: 9.1, row: 0.04 },
    ext: { width: 134, height: 38 },
  });

  worksheet.mergeCells("A2:J2");
  const instructionCell = worksheet.getCell("A2");
  instructionCell.value =
    `${week.visits.length} customer visits • Details from the MeadowBrook sales website • Notes are copied from the calendar invitations • Print 11x17 landscape.`;
  instructionCell.fill = solidFill(WHITE);
  instructionCell.font = { italic: true, color: { argb: "FF595959" }, size: 10, name: "Arial" };
  instructionCell.alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getRow(2).height = 18;

  worksheet.getRow(3).height = 6;

  const headerRow = worksheet.getRow(4);
  COLUMN_HEADERS.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  styleRouteHeaderRow(headerRow);

  let nextRowNumber = 5;
  week.visits.forEach((visit, index) => {
    const visitRow = worksheet.getRow(nextRowNumber);
    visitRow.values = [
      visit.time,
      visit.companyName,
      visit.address || "CRM record not found",
      visit.city,
      visit.companyPhone,
      visit.contactName || (visit.matched ? "Contact needed" : "CRM record not found"),
      visit.contactJobTitle,
      visit.contactPhone,
      visit.contactExtension,
      visit.contactEmail,
    ];
    styleRouteVisitRow(visitRow, sheetDetails.visitRowHeight);
    nextRowNumber += 1;

    const notesRow = worksheet.getRow(nextRowNumber);
    const notesLabel = notesRow.getCell(1);
    notesLabel.value = "Notes:";
    for (let column = 1; column <= 10; column += 1) {
      const cell = notesRow.getCell(column);
      cell.fill = solidFill(SOURCE_NOTES_FILL);
      cell.font = { italic: true, color: { argb: SOURCE_MUTED }, size: 10, name: "Arial" };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      cell.border = SOURCE_THIN_BORDER;
    }
    worksheet.mergeCells(`B${nextRowNumber}:J${nextRowNumber}`);
    const notesCell = notesRow.getCell(2);
    notesCell.value = visit.matched
      ? visit.notes
      : `CRM record not found for this fixed report company. ${visit.notes}`;
    notesRow.height = routeNotesRowHeight(week.week, index);
    nextRowNumber += 1;
  });

  worksheet.pageSetup.printArea = `A1:J${nextRowNumber - 1}`;
  worksheet.pageSetup.printTitlesRow = "1:4";
}

function addChangesWorksheet(
  workbook: ExcelJS.Workbook,
  plan: JeffSpecialReportPlan,
  logoImageId: number,
): void {
  const worksheet = workbook.addWorksheet("Changes Since Original", {
    properties: { defaultRowHeight: 18 },
    pageSetup: {
      paperSize: 3 as PaperSize,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      verticalCentered: false,
      showGridLines: false,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.35,
        bottom: 0.35,
        header: 0.15,
        footer: 0.15,
      },
    },
    views: [{ state: "frozen", ySplit: 3, activeCell: "A4", showGridLines: false }],
  });

  worksheet.columns = [
    { key: "week", width: 10 },
    { key: "time", width: 14 },
    { key: "company", width: 25 },
    { key: "field", width: 18 },
    { key: "original", width: 31 },
    { key: "current", width: 31 },
    { key: "result", width: 18 },
  ];

  worksheet.mergeCells("A1:E1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "Jeff Special Report — Changes Since Original";
  titleCell.font = { bold: true, color: { argb: WHITE }, size: 17 };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getRow(1).height = 38;
  for (let column = 1; column <= 5; column += 1) {
    worksheet.getRow(1).getCell(column).fill = solidFill(BRAND_BLUE);
  }

  worksheet.mergeCells("F1:G1");
  worksheet.getCell("F1").fill = solidFill(WHITE);
  worksheet.addImage(logoImageId, {
    tl: { col: 5.2, row: 0.08 },
    ext: { width: 135, height: 38 },
  });

  worksheet.mergeCells("A2:G2");
  const subtitleCell = worksheet.getCell("A2");
  subtitleCell.value =
    `${plan.differences.length} field differences • Original July 14–15 report compared with current Sales MeadowBrook data`;
  subtitleCell.fill = solidFill(PALE_GREEN);
  subtitleCell.font = { bold: true, color: { argb: BRAND_GREEN }, size: 10 };
  subtitleCell.alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getRow(2).height = 22;

  const headers = [
    "Week",
    "Time",
    "Company",
    "Field",
    "Original Report",
    "Current CRM",
    "Result",
  ];
  const headerRow = worksheet.getRow(3);
  headers.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  styleHeaderRow(headerRow);

  if (plan.differences.length === 0) {
    worksheet.mergeCells("A4:G6");
    const noChangesCell = worksheet.getCell("A4");
    noChangesCell.value = "No differences found between the original report and the current CRM data.";
    noChangesCell.fill = solidFill(PALE_GREEN);
    noChangesCell.font = { bold: true, color: { argb: TEXT_GREEN }, size: 12 };
    noChangesCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    noChangesCell.border = THIN_BORDER;
  } else {
    plan.differences.forEach((difference, index) => {
      const row = worksheet.getRow(index + 4);
      row.values = [
        `Week ${difference.week}`,
        difference.time,
        difference.companyName,
        difference.field,
        difference.originalValue || "—",
        difference.currentValue || "—",
        difference.result,
      ];
      row.height = 28;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = solidFill(index % 2 === 1 ? "FFF7FAFD" : WHITE);
        cell.font = { color: { argb: TEXT_DARK }, size: 9 };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = THIN_BORDER;
      });
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(3).font = { bold: true, color: { argb: TEXT_DARK }, size: 9 };
      row.getCell(4).font = { bold: true, color: { argb: BRAND_BLUE }, size: 9 };

      const resultCell = row.getCell(7);
      const isAdded = difference.result === "Added";
      const isChanged = difference.result === "Changed";
      resultCell.fill = solidFill(isAdded ? PALE_GREEN : isChanged ? PALE_AMBER : PALE_RED);
      resultCell.font = {
        bold: true,
        color: { argb: isAdded ? TEXT_GREEN : isChanged ? TEXT_AMBER : TEXT_RED },
        size: 9,
      };
      resultCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
  }

  const finalRow = plan.differences.length > 0 ? plan.differences.length + 3 : 6;
  worksheet.autoFilter = `A3:G${Math.max(3, finalRow)}`;
  worksheet.pageSetup.printArea = `A1:G${finalRow}`;
  worksheet.pageSetup.printTitlesRow = "1:3";
  worksheet.headerFooter.oddFooter = "&LMeadowBrook&CChanges Since Original&RPage &P of &N";
  worksheet.headerFooter.evenFooter = worksheet.headerFooter.oddFooter;
}

export async function buildJeffSpecialWorkbook(plan: JeffSpecialReportPlan): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const generatedAt = new Date(plan.generatedAt);
  workbook.creator = "Sales MeadowBrook";
  workbook.lastModifiedBy = "Sales MeadowBrook";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.title = "Jeff Special Report";
  workbook.subject =
    "Fixed two-week Jeff customer visit report and original-to-current CRM comparison";
  workbook.company = "MeadowBrook";
  workbook.calcProperties.fullCalcOnLoad = true;

  const logoImageId = workbook.addImage({
    filename: path.join(process.cwd(), "public", "mb-logo.png"),
    extension: "png",
  });
  for (const week of plan.weeks) {
    addWeekWorksheet(workbook, week, logoImageId);
  }
  addChangesWorksheet(workbook, plan, logoImageId);

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}
