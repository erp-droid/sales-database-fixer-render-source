import type { BusinessAccountRow } from "@/types/business-account";

const CSV_COLUMNS: Array<{
  header: string;
  read: (row: BusinessAccountRow) => string | number | null | undefined;
}> = [
  { header: "Account Record ID", read: (row) => row.accountRecordId ?? row.id },
  { header: "Row ID", read: (row) => row.id },
  { header: "Row Key", read: (row) => row.rowKey ?? null },
  { header: "Business Account ID", read: (row) => row.businessAccountId },
  { header: "Company Name", read: (row) => row.companyName },
  { header: "Company Description", read: (row) => row.companyDescription ?? null },
  { header: "Address", read: (row) => row.address },
  { header: "Address Line 1", read: (row) => row.addressLine1 },
  { header: "Address Line 2", read: (row) => row.addressLine2 },
  { header: "City", read: (row) => row.city },
  { header: "Province/State", read: (row) => row.state },
  { header: "Postal Code", read: (row) => row.postalCode },
  { header: "Country", read: (row) => row.country },
  { header: "Company Phone", read: (row) => row.companyPhone ?? null },
  { header: "Company Phone Source", read: (row) => row.companyPhoneSource ?? null },
  { header: "Phone Number", read: (row) => row.phoneNumber ?? null },
  { header: "Sales Rep ID", read: (row) => row.salesRepId ?? null },
  { header: "Sales Rep Name", read: (row) => row.salesRepName ?? null },
  { header: "Industry Type", read: (row) => row.industryType ?? null },
  { header: "Sub-Category", read: (row) => row.subCategory ?? null },
  { header: "Company Region", read: (row) => row.companyRegion ?? null },
  { header: "Week", read: (row) => row.week ?? null },
  { header: "Contact ID", read: (row) => row.contactId ?? null },
  {
    header: "Is Primary Contact",
    read: (row) => (row.isPrimaryContact ? "Yes" : "No"),
  },
  { header: "Primary Contact ID", read: (row) => row.primaryContactId ?? null },
  { header: "Primary Contact Name", read: (row) => row.primaryContactName ?? null },
  {
    header: "Primary Contact Job Title",
    read: (row) => row.primaryContactJobTitle ?? null,
  },
  { header: "Primary Contact Phone", read: (row) => row.primaryContactPhone ?? null },
  {
    header: "Primary Contact Extension",
    read: (row) => row.primaryContactExtension ?? null,
  },
  {
    header: "Primary Contact Email",
    read: (row) => row.primaryContactEmail ?? null,
  },
  { header: "Category", read: (row) => row.category ?? null },
  { header: "Notes", read: (row) => row.notes ?? null },
  { header: "Last Emailed At", read: (row) => row.lastEmailedAt ?? null },
  { header: "Last Modified ISO", read: (row) => row.lastModifiedIso ?? null },
];

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).replace(/\r?\n/g, "\r\n");
  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function buildBusinessAccountsCsv(rows: readonly BusinessAccountRow[]): string {
  const headerLine = CSV_COLUMNS.map((column) => escapeCsvCell(column.header)).join(",");
  const dataLines = rows.map((row) =>
    CSV_COLUMNS.map((column) => escapeCsvCell(column.read(row))).join(","),
  );

  return `\uFEFF${[headerLine, ...dataLines].join("\r\n")}`;
}

export function buildBusinessAccountsCsvFilename(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `accounts-export-${year}-${month}-${day}.csv`;
}

export function canExportBusinessAccountsCsv(loginName: string | null | undefined): boolean {
  return loginName?.trim().toLowerCase() === "jserrano";
}
