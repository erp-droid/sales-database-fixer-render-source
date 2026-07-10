import type { BusinessAccountRow, SortBy } from "@/types/business-account";

type CsvColumn = {
  header: string;
  read: (row: BusinessAccountRow) => string | number | null | undefined;
};

const VISIBLE_CSV_COLUMNS: Record<SortBy, CsvColumn> = {
  companyName: { header: "Company Name", read: (row) => row.companyName },
  accountType: { header: "Account Type", read: (row) => row.accountType ?? null },
  opportunityCount: { header: "Opportunities", read: (row) => row.opportunityCount ?? null },
  salesRepName: { header: "Sales Rep", read: (row) => row.salesRepName ?? null },
  industryType: { header: "Industry Type", read: (row) => row.industryType ?? null },
  subCategory: { header: "Subcategory", read: (row) => row.subCategory ?? null },
  companyRegion: { header: "Company Region", read: (row) => row.companyRegion ?? null },
  week: { header: "Week", read: (row) => row.week ?? null },
  address: { header: "Address", read: (row) => row.address },
  companyPhone: { header: "Company Phone", read: (row) => row.companyPhone ?? null },
  primaryContactName: { header: "Contact", read: (row) => row.primaryContactName ?? null },
  primaryContactJobTitle: { header: "Job Title", read: (row) => row.primaryContactJobTitle ?? null },
  primaryContactPhone: { header: "Contact Phone", read: (row) => row.primaryContactPhone ?? null },
  primaryContactExtension: { header: "Extension", read: (row) => row.primaryContactExtension ?? null },
  primaryContactEmail: { header: "Email", read: (row) => row.primaryContactEmail ?? null },
  notes: { header: "Notes", read: (row) => row.notes ?? null },
  category: { header: "Category", read: (row) => row.category ?? null },
  lastCalledAt: { header: "Last Called", read: (row) => row.lastCalledAt ?? null },
  lastCalendarInvitedAt: {
    header: "Last Invited",
    read: (row) => row.lastCalendarInvitedAt ?? null,
  },
  lastEmailedAt: { header: "Last Emailed", read: (row) => row.lastEmailedAt ?? null },
  lastModifiedIso: { header: "Updated", read: (row) => row.lastModifiedIso ?? null },
};

const CSV_COLUMNS: CsvColumn[] = [
  { header: "Account Record ID", read: (row) => row.accountRecordId ?? row.id },
  { header: "Row ID", read: (row) => row.id },
  { header: "Row Key", read: (row) => row.rowKey ?? null },
  { header: "Business Account ID", read: (row) => row.businessAccountId },
  { header: "Company Name", read: (row) => row.companyName },
  { header: "Account Type", read: (row) => row.accountType ?? null },
  { header: "Opportunity Count", read: (row) => row.opportunityCount ?? null },
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
  { header: "Last Called At", read: (row) => row.lastCalledAt ?? null },
  { header: "Last Calendar Invited At", read: (row) => row.lastCalendarInvitedAt ?? null },
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

export function buildBusinessAccountsCsv(
  rows: readonly BusinessAccountRow[],
  visibleColumns?: readonly SortBy[],
): string {
  const columns =
    visibleColumns && visibleColumns.length > 0
      ? visibleColumns.map((columnId) => VISIBLE_CSV_COLUMNS[columnId])
      : CSV_COLUMNS;
  const headerLine = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const dataLines = rows.map((row) =>
    columns.map((column) => escapeCsvCell(column.read(row))).join(","),
  );

  return `\uFEFF${[headerLine, ...dataLines].join("\r\n")}`;
}

function normalizeContactPhoneKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 ? digits : trimmed.toLowerCase();
}

/**
 * Expands the filtered account rows into the exact distinct phone-number set
 * represented by the Contact phones KPI. A contact can contribute more than
 * one number, while duplicate numbers are exported only once.
 */
export function buildDistinctContactPhoneExportRows(
  rows: readonly BusinessAccountRow[],
): BusinessAccountRow[] {
  const seenPhoneKeys = new Set<string>();
  const exportRows: BusinessAccountRow[] = [];

  for (const row of rows) {
    for (const value of [row.primaryContactPhone, row.phoneNumber]) {
      const phone = value?.trim() ?? "";
      const key = normalizeContactPhoneKey(phone);
      if (!key || seenPhoneKeys.has(key)) {
        continue;
      }

      seenPhoneKeys.add(key);
      exportRows.push({
        ...row,
        primaryContactPhone: phone,
        phoneNumber: phone,
      });
    }
  }

  return exportRows;
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
