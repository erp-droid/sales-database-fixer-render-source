import type { BusinessAccountRow } from "@/types/business-account";

const INVALID_CONTACT_IDENTITIES = new Set([
  "unknown",
  "n a",
  "na",
  "none",
  "null",
]);

export function normalizeContactIdentityPart(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildContactIdentityKey(input: {
  companyName: string | null | undefined;
  contactName: string | null | undefined;
}): string | null {
  const companyName = normalizeContactIdentityPart(input.companyName);
  const contactName = normalizeContactIdentityPart(input.contactName);
  if (!companyName || !contactName) {
    return null;
  }

  if (companyName === contactName || INVALID_CONTACT_IDENTITIES.has(contactName)) {
    return null;
  }

  return `${companyName}|${contactName}`;
}

export function buildContactIdentityKeyForRow(row: BusinessAccountRow): string | null {
  return buildContactIdentityKey({
    companyName: row.companyName,
    contactName: row.primaryContactName,
  });
}
