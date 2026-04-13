import type { BusinessAccountRow } from "@/types/business-account";

export const INTERNAL_EMPLOYEE_EMAIL_DOMAINS = [
  "meadowb.com",
  "meadowbrookconstruction.ca",
] as const;

const EXCLUDED_EMAIL_DOMAINS = new Set([
  "meadowb.com",
  "meadowbrookconstruction.ca",
]);

const ALWAYS_EXCLUDED_ASSOCIATED_NAMES = [
  "travis rumney",
  "travis justin rumney",
] as const;

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function splitEmailAddresses(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[;,]/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function readEmailDomain(email: string): string {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) {
    return "";
  }

  return email.slice(atIndex + 1);
}

export function isExcludedInternalContactEmail(value: string | null | undefined): boolean {
  return splitEmailAddresses(value).some((email) =>
    EXCLUDED_EMAIL_DOMAINS.has(readEmailDomain(email)),
  );
}

export function isExcludedInternalCompanyName(value: string | null | undefined): boolean {
  return normalizeText(value).includes("meadowbrook");
}

function isAlwaysExcludedAssociatedName(value: string | null | undefined): boolean {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (!normalized) {
    return false;
  }

  return ALWAYS_EXCLUDED_ASSOCIATED_NAMES.some(
    (candidate) => normalized === candidate || normalized.includes(candidate),
  );
}

export function isAlwaysExcludedBusinessAccountRow(
  row: Pick<BusinessAccountRow, "primaryContactName" | "salesRepName">,
): boolean {
  return (
    isAlwaysExcludedAssociatedName(row.primaryContactName) ||
    isAlwaysExcludedAssociatedName(row.salesRepName)
  );
}

export function isExcludedInternalBusinessAccountRow(
  row: Pick<BusinessAccountRow, "companyName" | "primaryContactEmail">,
): boolean {
  return (
    isExcludedInternalCompanyName(row.companyName) ||
    isExcludedInternalContactEmail(row.primaryContactEmail)
  );
}
