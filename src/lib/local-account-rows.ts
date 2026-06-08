import { randomUUID } from "node:crypto";

import type { BusinessAccountRow, BusinessAccountUpdateRequest } from "@/types/business-account";
import type {
  BusinessAccountClassCode,
  BusinessAccountContactCreateRequest,
  BusinessAccountCreateRequest,
} from "@/types/business-account-create";

function nowIso(): string {
  return new Date().toISOString();
}

function generateLocalAccountId(): string {
  return `local-account-${randomUUID()}`;
}

function generateLocalBusinessAccountId(): string {
  return `LOCAL-${randomUUID().slice(0, 12).toUpperCase()}`;
}

function generateLocalContactId(): number {
  const value = Number.parseInt(randomUUID().slice(0, 8), 16);
  return -Math.max(1, value);
}

function toAccountType(classId: BusinessAccountClassCode): "Customer" | "Lead" {
  return classId === "CUSTOMER" ? "Customer" : "Lead";
}

function formatAddress(input: {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}): string {
  return [
    [input.addressLine1, input.addressLine2].filter(Boolean).join(" ").trim(),
    [input.city, input.state, input.postalCode].filter(Boolean).join(" ").trim(),
    input.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildLocalBusinessAccountRows(
  request: BusinessAccountCreateRequest,
): {
  businessAccountRecordId: string;
  businessAccountId: string;
  createdRow: BusinessAccountRow;
  accountRows: BusinessAccountRow[];
} {
  const businessAccountRecordId = generateLocalAccountId();
  const businessAccountId = generateLocalBusinessAccountId();
  const createdAt = nowIso();
  const row: BusinessAccountRow = {
    id: businessAccountRecordId,
    accountRecordId: businessAccountRecordId,
    rowKey: `${businessAccountRecordId}:contact:row`,
    contactId: null,
    isPrimaryContact: false,
    companyPhone: request.companyPhone?.trim() || null,
    companyPhoneSource: request.companyPhone?.trim() ? "account" : null,
    phoneNumber: request.companyPhone?.trim() || null,
    salesRepId: request.salesRepId?.trim() || null,
    salesRepName: request.salesRepName?.trim() || null,
    accountType: toAccountType(request.classId),
    opportunityCount: null,
    industryType: request.industryType.trim(),
    subCategory: request.subCategory.trim(),
    companyRegion: request.companyRegion.trim(),
    week: request.week?.trim() || null,
    businessAccountId,
    companyName: request.companyName.trim(),
    companyDescription: request.companyDescription?.trim() || null,
    address: formatAddress(request),
    addressLine1: request.addressLine1,
    addressLine2: request.addressLine2,
    city: request.city,
    state: request.state,
    postalCode: request.postalCode,
    country: request.country,
    primaryContactName: null,
    primaryContactJobTitle: null,
    primaryContactPhone: null,
    primaryContactExtension: null,
    primaryContactRawPhone: null,
    primaryContactEmail: null,
    primaryContactId: null,
    category: request.category,
    notes: null,
    lastCalledAt: null,
    lastCalendarInvitedAt: null,
    lastEmailedAt: null,
    lastModifiedIso: createdAt,
  };

  return {
    businessAccountRecordId,
    businessAccountId,
    createdRow: row,
    accountRows: [row],
  };
}

export function applyLocalBusinessAccountUpdate(
  rows: BusinessAccountRow[],
  update: BusinessAccountUpdateRequest,
): BusinessAccountRow[] {
  const modifiedAt = nowIso();
  const normalizedTargetContactId = update.targetContactId ?? null;

  return rows.map((row) => {
    const rowContactId = row.contactId ?? row.primaryContactId ?? null;
    const matchesTargetContact =
      normalizedTargetContactId !== null && rowContactId === normalizedTargetContactId;
    const shouldUpdateContactFields =
      normalizedTargetContactId === null ||
      matchesTargetContact ||
      (update.setAsPrimaryContact && normalizedTargetContactId !== null);

    return {
      ...row,
      companyName: update.companyName.trim(),
      salesRepId: update.salesRepId?.trim() || null,
      salesRepName: update.salesRepName?.trim() || null,
      industryType: update.industryType?.trim() || null,
      subCategory: update.subCategory?.trim() || null,
      companyRegion: update.companyRegion?.trim() || null,
      week: update.week?.trim() || null,
      companyPhone: update.companyPhone?.trim() || null,
      companyPhoneSource: update.companyPhone?.trim() ? "account" : row.companyPhoneSource ?? null,
      phoneNumber: update.companyPhone?.trim() || row.phoneNumber || null,
      addressLine1: update.addressLine1,
      addressLine2: update.addressLine2,
      city: update.city,
      state: update.state,
      postalCode: update.postalCode,
      country: update.country,
      address: formatAddress(update),
      primaryContactName: shouldUpdateContactFields
        ? update.primaryContactName
        : row.primaryContactName,
      primaryContactJobTitle: shouldUpdateContactFields
        ? update.primaryContactJobTitle ?? null
        : row.primaryContactJobTitle ?? null,
      primaryContactPhone: shouldUpdateContactFields
        ? update.primaryContactPhone
        : row.primaryContactPhone,
      primaryContactExtension: shouldUpdateContactFields
        ? update.primaryContactExtension ?? null
        : row.primaryContactExtension ?? null,
      primaryContactRawPhone: shouldUpdateContactFields
        ? update.primaryContactPhone
        : row.primaryContactRawPhone ?? row.primaryContactPhone,
      primaryContactEmail: shouldUpdateContactFields
        ? update.primaryContactEmail
        : row.primaryContactEmail,
      primaryContactId: shouldUpdateContactFields
        ? normalizedTargetContactId ?? row.primaryContactId ?? null
        : row.primaryContactId ?? null,
      contactId: row.contactId ?? null,
      isPrimaryContact:
        update.setAsPrimaryContact && normalizedTargetContactId !== null
          ? rowContactId === normalizedTargetContactId
          : row.isPrimaryContact,
      category: update.category,
      notes: update.notes,
      lastModifiedIso: modifiedAt,
    };
  });
}

export function appendLocalContactRow(
  rows: BusinessAccountRow[],
  request: BusinessAccountContactCreateRequest,
): {
  contactId: number;
  rows: BusinessAccountRow[];
  createdRow: BusinessAccountRow;
} {
  const contactId = generateLocalContactId();
  const anchor = rows[0];
  if (!anchor) {
    throw new Error("Cannot append a local contact row without an existing account row.");
  }

  const primaryName = request.displayName.trim();
  const primaryPhone = request.phone1.trim() || null;
  const primaryEmail = request.email.trim() || null;
  const modifiedAt = nowIso();

  const existingContactRows = rows.filter(
    (row) => row.contactId !== null && row.contactId !== undefined,
  );
  const updatedRows = existingContactRows.map((row) => ({
    ...row,
    isPrimaryContact: false,
    primaryContactId: contactId,
    lastModifiedIso: modifiedAt,
  }));

  const createdRow: BusinessAccountRow = {
    ...anchor,
    rowKey: `${anchor.accountRecordId ?? anchor.id}:contact:${contactId}`,
    contactId,
    isPrimaryContact: true,
    primaryContactName: primaryName,
    primaryContactJobTitle: request.jobTitle.trim() || null,
    primaryContactPhone: primaryPhone,
    primaryContactExtension: request.extension?.trim() || null,
    primaryContactRawPhone: primaryPhone,
    primaryContactEmail: primaryEmail,
    primaryContactId: contactId,
    lastModifiedIso: modifiedAt,
  };

  return {
    contactId,
    rows: [...updatedRows, createdRow],
    createdRow,
  };
}
