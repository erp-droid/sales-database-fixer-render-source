import path from "node:path";

import ExcelJS, { type Fill, type PaperSize } from "exceljs";

import type {
  VisitationRouteAccount,
  VisitationRoutePlan,
} from "@/lib/visitation-route-report";

const COLUMN_HEADERS = [
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
] as const;

const BRAND_BLUE = "FF163A63";
const BRAND_GREEN = "FF78A22F";
const PALE_BLUE = "FFEAF1F8";
const PALE_GREEN = "FFF1F7E8";
const BORDER_BLUE = "FF9FB2C8";
const TEXT_DARK = "FF172033";
const TEXT_MUTED = "FF536176";
const WHITE = "FFFFFFFF";

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER_BLUE } },
  left: { style: "thin", color: { argb: BORDER_BLUE } },
  bottom: { style: "thin", color: { argb: BORDER_BLUE } },
  right: { style: "thin", color: { argb: BORDER_BLUE } },
};

function solidFill(argb: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function mapUrl(account: VisitationRouteAccount): string {
  const query = account.address || [account.companyName, account.city, account.state]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function safeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "sales-rep";
}

export function buildVisitationRouteWorkbookFilename(
  salesRepName: string,
  date: Date = new Date(),
): string {
  const datePart = date.toISOString().slice(0, 10);
  return `${safeFilenamePart(salesRepName)}-12-week-visitation-routes-${datePart}.xlsx`;
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

function styleAccountRow(row: ExcelJS.Row, isAlternate: boolean): void {
  row.height = 32;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = solidFill(isAlternate ? "FFF7FAFD" : WHITE);
    cell.font = { color: { argb: TEXT_DARK }, size: 9 };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = THIN_BORDER;
  });
  row.getCell(1).font = { bold: true, color: { argb: BRAND_BLUE }, size: 11 };
  row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  row.getCell(2).font = { bold: true, color: { argb: TEXT_DARK }, size: 9 };
  row.getCell(3).font = { color: { argb: "FF1155A3" }, underline: true, size: 9 };
}

function addDayWorksheet(
  workbook: ExcelJS.Workbook,
  plan: VisitationRoutePlan,
  day: VisitationRoutePlan["days"][number],
  logoImageId: number,
): void {
  const worksheet = workbook.addWorksheet(`W${day.week} D${day.day}`, {
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
    { key: "stop", width: 7 },
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
  titleCell.value = `${plan.salesRepName} — Week ${day.week}, Day ${day.day}`;
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
  instructionCell.value = day.accounts.length > 0
    ? `${day.accounts.length} A/B account${day.accounts.length === 1 ? "" : "s"} • Follow the stops in order • Click any address to open Google Maps`
    : "No A/B accounts are scheduled for this day.";
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
  day.accounts.forEach((account, index) => {
    const accountRow = worksheet.getRow(nextRowNumber);
    accountRow.values = [
      index + 1,
      account.companyName,
      account.address
        ? { text: account.address, hyperlink: mapUrl(account), tooltip: "Open in Google Maps" }
        : "",
      account.city,
      account.companyPhone,
      account.contactName,
      account.contactJobTitle,
      account.contactPhone,
      account.contactExtension,
      account.contactEmail,
    ];
    styleAccountRow(accountRow, index % 2 === 1);
    nextRowNumber += 1;

    worksheet.mergeCells(`A${nextRowNumber}:J${nextRowNumber}`);
    const notesCell = worksheet.getCell(`A${nextRowNumber}`);
    notesCell.value = "Notes:";
    notesCell.fill = solidFill(PALE_BLUE);
    notesCell.font = { bold: true, italic: true, color: { argb: TEXT_MUTED }, size: 9 };
    notesCell.alignment = { vertical: "top", wrapText: true };
    notesCell.border = THIN_BORDER;
    worksheet.getRow(nextRowNumber).height = 18;
    nextRowNumber += 1;
  });

  if (day.accounts.length === 0) {
    worksheet.mergeCells("A4:J6");
    const emptyCell = worksheet.getCell("A4");
    emptyCell.value = "This day is intentionally blank.";
    emptyCell.fill = solidFill("FFF7FAFD");
    emptyCell.font = { italic: true, color: { argb: TEXT_MUTED }, size: 11 };
    emptyCell.alignment = { horizontal: "center", vertical: "middle" };
    emptyCell.border = THIN_BORDER;
    nextRowNumber = 7;
  }

  worksheet.pageSetup.printArea = `A1:J${Math.max(6, nextRowNumber - 1)}`;
  worksheet.pageSetup.printTitlesRow = "1:3";
  worksheet.headerFooter.oddFooter =
    `&LMeadowBrook&C12-Week Visitation Routes&RPage &P of &N`;
  worksheet.headerFooter.evenFooter = worksheet.headerFooter.oddFooter;
}

export async function buildVisitationRouteWorkbook(
  plan: VisitationRoutePlan,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const generatedAt = new Date(plan.generatedAt);
  workbook.creator = "Sales MeadowBrook";
  workbook.lastModifiedBy = "Sales MeadowBrook";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.title = `${plan.salesRepName} 12-Week Visitation Routes`;
  workbook.subject = "A/B account visitation route sheets";
  workbook.company = "MeadowBrook";
  workbook.calcProperties.fullCalcOnLoad = true;

  const logoImageId = workbook.addImage({
    filename: path.join(process.cwd(), "public", "mb-logo.png"),
    extension: "png",
  });
  for (const day of plan.days) {
    addDayWorksheet(workbook, plan, day, logoImageId);
  }

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}
