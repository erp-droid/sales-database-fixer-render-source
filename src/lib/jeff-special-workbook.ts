import path from "node:path";

import ExcelJS, { type Fill, type PaperSize } from "exceljs";

import type {
  JeffSpecialReportPlan,
  JeffSpecialResolvedVisit,
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
const PALE_BLUE = "FFEAF1F8";
const PALE_GREEN = "FFF1F7E8";
const BORDER_BLUE = "FF9FB2C8";
const TEXT_DARK = "FF172033";
const TEXT_MUTED = "FF536176";
const WHITE = "FFFFFFFF";
const PALE_AMBER = "FFFFF2CC";
const PALE_RED = "FFFDE9E7";
const TEXT_GREEN = "FF3D6B12";
const TEXT_AMBER = "FF8A5700";
const TEXT_RED = "FF9B2C22";

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER_BLUE } },
  left: { style: "thin", color: { argb: BORDER_BLUE } },
  bottom: { style: "thin", color: { argb: BORDER_BLUE } },
  right: { style: "thin", color: { argb: BORDER_BLUE } },
};

function solidFill(argb: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function mapUrl(visit: JeffSpecialResolvedVisit): string {
  const query = visit.address || [visit.companyName, visit.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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

function styleVisitRow(row: ExcelJS.Row, isAlternate: boolean): void {
  row.height = 32;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = solidFill(isAlternate ? "FFF7FAFD" : WHITE);
    cell.font = { color: { argb: TEXT_DARK }, size: 9 };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = THIN_BORDER;
  });
  row.getCell(1).font = { bold: true, color: { argb: BRAND_BLUE }, size: 9 };
  row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  row.getCell(2).font = { bold: true, color: { argb: TEXT_DARK }, size: 9 };
  row.getCell(3).font = { color: { argb: "FF1155A3" }, underline: true, size: 9 };
}

function addWeekWorksheet(
  workbook: ExcelJS.Workbook,
  week: JeffSpecialReportPlan["weeks"][number],
  logoImageId: number,
): void {
  const worksheet = workbook.addWorksheet(`Week ${week.week}`, {
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
      showGridLines: false,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.35,
        bottom: 0.35,
        header: 0.15,
        footer: 0.15,
      },
    },
    views: [{ state: "frozen", ySplit: 3, activeCell: "A4", showGridLines: false }],
  });

  worksheet.columns = [
    { key: "time", width: 14 },
    { key: "company", width: 23 },
    { key: "address", width: 29 },
    { key: "city", width: 15 },
    { key: "companyPhone", width: 16 },
    { key: "contactName", width: 19 },
    { key: "jobTitle", width: 18 },
    { key: "contactPhone", width: 16 },
    { key: "extension", width: 9 },
    { key: "email", width: 27 },
  ];

  worksheet.mergeCells("A1:H1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = `Jeff Special Report — Week ${week.week}`;
  titleCell.fill = solidFill(BRAND_BLUE);
  titleCell.font = { bold: true, color: { argb: WHITE }, size: 18 };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getRow(1).height = 38;
  for (let column = 1; column <= 8; column += 1) {
    worksheet.getRow(1).getCell(column).fill = solidFill(BRAND_BLUE);
  }

  worksheet.mergeCells("I1:J1");
  worksheet.getCell("I1").fill = solidFill(WHITE);
  worksheet.addImage(logoImageId, {
    tl: { col: 8.14, row: 0.08 },
    ext: { width: 135, height: 38 },
  });

  worksheet.mergeCells("A2:J2");
  const instructionCell = worksheet.getCell("A2");
  instructionCell.value =
    `${week.visits.length} customer visits • Current CRM details • Fixed special route order and visit notes • Print 11×17 landscape`;
  instructionCell.fill = solidFill(PALE_GREEN);
  instructionCell.font = { bold: true, color: { argb: BRAND_GREEN }, size: 10 };
  instructionCell.alignment = { vertical: "middle", horizontal: "left" };
  worksheet.getRow(2).height = 22;

  const headerRow = worksheet.getRow(3);
  COLUMN_HEADERS.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  styleHeaderRow(headerRow);

  let nextRowNumber = 4;
  week.visits.forEach((visit, index) => {
    const visitRow = worksheet.getRow(nextRowNumber);
    visitRow.values = [
      visit.time,
      visit.companyName,
      visit.address
        ? { text: visit.address, hyperlink: mapUrl(visit), tooltip: "Open in Google Maps" }
        : "CRM record not found",
      visit.city,
      visit.companyPhone,
      visit.contactName || (visit.matched ? "Contact needed" : "CRM record not found"),
      visit.contactJobTitle,
      visit.contactPhone,
      visit.contactExtension,
      visit.contactEmail,
    ];
    styleVisitRow(visitRow, index % 2 === 1);
    nextRowNumber += 1;

    const notesRow = worksheet.getRow(nextRowNumber);
    const notesLabel = notesRow.getCell(1);
    notesLabel.value = "Notes:";
    notesLabel.fill = solidFill(PALE_BLUE);
    notesLabel.font = { bold: true, italic: true, color: { argb: TEXT_MUTED }, size: 9 };
    notesLabel.alignment = { vertical: "top", horizontal: "center" };
    notesLabel.border = THIN_BORDER;
    worksheet.mergeCells(`B${nextRowNumber}:J${nextRowNumber}`);
    const notesCell = notesRow.getCell(2);
    notesCell.value = visit.matched
      ? visit.notes
      : `CRM record not found for this fixed report company. ${visit.notes}`;
    notesCell.fill = solidFill(PALE_BLUE);
    notesCell.font = { color: { argb: TEXT_MUTED }, size: 9 };
    notesCell.alignment = { vertical: "top", wrapText: true };
    notesCell.border = THIN_BORDER;
    notesRow.height = Math.min(58, 20 + Math.ceil(notesCell.text.length / 120) * 12);
    nextRowNumber += 1;
  });

  worksheet.pageSetup.printArea = `A1:J${nextRowNumber - 1}`;
  worksheet.pageSetup.printTitlesRow = "1:3";
  worksheet.headerFooter.oddFooter = "&LMeadowBrook&CJeff Special Report&RPage &P of &N";
  worksheet.headerFooter.evenFooter = worksheet.headerFooter.oddFooter;
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
