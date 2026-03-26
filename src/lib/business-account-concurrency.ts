import type {
  BusinessAccountConcurrencySnapshot,
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
} from "@/types/business-account";
import { resolveCompanyPhone, sanitizeNullableInput } from "@/lib/business-accounts";
import {
  normalizeExtensionForSave,
  normalizePhoneForSave,
  phoneValuesEquivalent,
} from "@/lib/phone";

const TRACKED_CONCURRENCY_FIELDS = [
  "companyName",
  "companyDescription",
  "assignedBusinessAccountRecordId",
  "assignedBusinessAccountId",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "salesRepId",
  "salesRepName",
  "industryType",
  "subCategory",
  "companyRegion",
  "week",
  "companyPhone",
  "primaryContactName",
  "primaryContactJobTitle",
  "primaryContactPhone",
  "primaryContactExtension",
  "primaryContactEmail",
  "category",
  "notes",
  "targetContactId",
] as const;

type BusinessAccountConcurrencyField = (typeof TRACKED_CONCURRENCY_FIELDS)[number];

const CONFLICT_LABELS: Record<BusinessAccountConcurrencyField, string> = {
  companyName: "Company Name",
  companyDescription: "Company Description",
  assignedBusinessAccountRecordId: "Assigned Account",
  assignedBusinessAccountId: "Assigned Account",
  addressLine1: "Address",
  addressLine2: "Address",
  city: "Address",
  state: "Address",
  postalCode: "Address",
  country: "Address",
  salesRepId: "Sales Rep",
  salesRepName: "Sales Rep",
  industryType: "Industry Type",
  subCategory: "Sub-Category",
  companyRegion: "Company Region",
  week: "Week",
  companyPhone: "Company Phone",
  primaryContactName: "Primary Contact Name",
  primaryContactJobTitle: "Primary Contact Job Title",
  primaryContactPhone: "Primary Contact Phone",
  primaryContactExtension: "Primary Contact Extension",
  primaryContactEmail: "Primary Contact Email",
  category: "Category",
  notes: "Notes",
  targetContactId: "Contact",
};

function normalizeRequiredText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeCountryCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeSnapshotPhone(value: string | null | undefined): string | null {
  const sanitized = sanitizeNullableInput(value);
  if (!sanitized) {
    return null;
  }

  return normalizePhoneForSave(sanitized);
}

function sanitizeSnapshotExtension(value: string | null | undefined): string | null {
  const sanitized = sanitizeNullableInput(value);
  if (!sanitized) {
    return null;
  }

  return normalizeExtensionForSave(sanitized);
}

function sanitizeSnapshotEmail(value: string | null | undefined): string | null {
  const sanitized = sanitizeNullableInput(value);
  if (!sanitized) {
    return null;
  }

  return SIMPLE_EMAIL_PATTERN.test(sanitized) ? sanitized : null;
}

function valuesEquivalent(
  field: BusinessAccountConcurrencyField,
  left: unknown,
  right: unknown,
): boolean {
  if (field === "category" || field === "targetContactId") {
    return left === right;
  }

  if (field === "companyPhone" || field === "primaryContactPhone") {
    return phoneValuesEquivalent(
      typeof left === "string" || left === null ? left : null,
      typeof right === "string" || right === null ? right : null,
    );
  }

  if (field === "country") {
    return normalizeCountryCode(
      typeof left === "string" || left === null ? left : null,
    ) === normalizeCountryCode(typeof right === "string" || right === null ? right : null);
  }

  if (
    field === "companyName" ||
    field === "addressLine1" ||
    field === "addressLine2" ||
    field === "city" ||
    field === "state" ||
    field === "postalCode"
  ) {
    return normalizeRequiredText(
      typeof left === "string" || left === null ? left : null,
    ) ===
      normalizeRequiredText(typeof right === "string" || right === null ? right : null);
  }

  return sanitizeNullableInput(
    typeof left === "string" || left === null ? left : null,
  ) === sanitizeNullableInput(typeof right === "string" || right === null ? right : null);
}

function readSnapshotValue(
  snapshot: BusinessAccountConcurrencySnapshot,
  field: BusinessAccountConcurrencyField,
): string | number | null {
  return snapshot[field] ?? null;
}

function readUpdateValue(
  updateRequest: BusinessAccountUpdateRequest,
  field: BusinessAccountConcurrencyField,
): string | number | null {
  return updateRequest[field] ?? null;
}

function readCurrentValue(
  currentAccountRow: BusinessAccountRow,
  currentRowForContactComparison: BusinessAccountRow,
  field: BusinessAccountConcurrencyField,
): string | number | null {
  switch (field) {
    case "companyName":
      return currentAccountRow.companyName;
    case "companyDescription":
      return currentAccountRow.companyDescription ?? null;
    case "assignedBusinessAccountRecordId":
      return currentAccountRow.businessAccountId.trim().length > 0
        ? (currentAccountRow.accountRecordId ?? currentAccountRow.id)
        : null;
    case "assignedBusinessAccountId":
      return currentAccountRow.businessAccountId.trim() || null;
    case "addressLine1":
      return currentAccountRow.addressLine1;
    case "addressLine2":
      return currentAccountRow.addressLine2;
    case "city":
      return currentAccountRow.city;
    case "state":
      return currentAccountRow.state;
    case "postalCode":
      return currentAccountRow.postalCode;
    case "country":
      return currentAccountRow.country;
    case "salesRepId":
      return currentAccountRow.salesRepId;
    case "salesRepName":
      return currentAccountRow.salesRepName;
    case "industryType":
      return currentAccountRow.industryType;
    case "subCategory":
      return currentAccountRow.subCategory;
    case "companyRegion":
      return currentAccountRow.companyRegion;
    case "week":
      return currentAccountRow.week;
    case "companyPhone":
      return resolveCompanyPhone(currentAccountRow);
    case "primaryContactName":
      return currentRowForContactComparison.primaryContactName;
    case "primaryContactJobTitle":
      return currentRowForContactComparison.primaryContactJobTitle ?? null;
    case "primaryContactPhone":
      return currentRowForContactComparison.primaryContactPhone;
    case "primaryContactExtension":
      return currentRowForContactComparison.primaryContactExtension ?? null;
    case "primaryContactEmail":
      return currentRowForContactComparison.primaryContactEmail;
    case "category":
      return currentAccountRow.category;
    case "notes":
      return currentRowForContactComparison.notes;
    case "targetContactId":
      return currentRowForContactComparison.contactId ?? currentAccountRow.primaryContactId ?? null;
  }
}

export function buildBusinessAccountConcurrencySnapshot(
  row: BusinessAccountRow,
): BusinessAccountConcurrencySnapshot {
  return {
    companyName: row.companyName,
    companyDescription: row.companyDescription ?? null,
    assignedBusinessAccountRecordId:
      row.businessAccountId.trim().length > 0 ? (row.accountRecordId ?? row.id) : null,
    assignedBusinessAccountId: row.businessAccountId.trim() || null,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    targetContactId: row.contactId ?? row.primaryContactId ?? null,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName,
    industryType: row.industryType,
    subCategory: row.subCategory,
    companyRegion: row.companyRegion,
    week: row.week,
    companyPhone: sanitizeSnapshotPhone(resolveCompanyPhone(row)),
    primaryContactName: row.primaryContactName,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone: sanitizeSnapshotPhone(row.primaryContactPhone),
    primaryContactExtension: sanitizeSnapshotExtension(row.primaryContactExtension ?? null),
    primaryContactEmail: sanitizeSnapshotEmail(row.primaryContactEmail),
    category: row.category,
    notes: row.notes,
    primaryContactId: row.primaryContactId,
    lastModifiedIso: row.lastModifiedIso,
  };
}

export function collectUpdatedConcurrencyFields(
  updateRequest: BusinessAccountUpdateRequest,
): Set<BusinessAccountConcurrencyField> {
  const updatedFields = new Set<BusinessAccountConcurrencyField>();
  const baseSnapshot = updateRequest.baseSnapshot;
  if (!baseSnapshot) {
    return updatedFields;
  }

  for (const field of TRACKED_CONCURRENCY_FIELDS) {
    if (
      !valuesEquivalent(
        field,
        readSnapshotValue(baseSnapshot, field),
        readUpdateValue(updateRequest, field),
      )
    ) {
      updatedFields.add(field);
    }
  }

  return updatedFields;
}

export function collectConflictingConcurrencyFields(
  currentAccountRow: BusinessAccountRow,
  currentRowForContactComparison: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
): BusinessAccountConcurrencyField[] {
  const baseSnapshot = updateRequest.baseSnapshot;
  if (!baseSnapshot) {
    return [];
  }

  const conflicts: BusinessAccountConcurrencyField[] = [];
  for (const field of collectUpdatedConcurrencyFields(updateRequest)) {
    if (
      !valuesEquivalent(
        field,
        readSnapshotValue(baseSnapshot, field),
        readCurrentValue(currentAccountRow, currentRowForContactComparison, field),
      )
    ) {
      conflicts.push(field);
    }
  }

  return conflicts;
}

export function buildRebasedUpdateRequest(
  currentAccountRow: BusinessAccountRow,
  currentRowForContactComparison: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
  effectiveTargetContactId: number | null,
): BusinessAccountUpdateRequest {
  const updatedFields = collectUpdatedConcurrencyFields(updateRequest);
  const rebasedRequest: BusinessAccountUpdateRequest = {
    companyName: currentAccountRow.companyName,
    companyDescription: currentAccountRow.companyDescription ?? null,
    assignedBusinessAccountRecordId:
      currentAccountRow.businessAccountId.trim().length > 0
        ? (currentAccountRow.accountRecordId ?? currentAccountRow.id)
        : null,
    assignedBusinessAccountId: currentAccountRow.businessAccountId.trim() || null,
    addressLine1: currentAccountRow.addressLine1,
    addressLine2: currentAccountRow.addressLine2,
    city: currentAccountRow.city,
    state: currentAccountRow.state,
    postalCode: currentAccountRow.postalCode,
    country: currentAccountRow.country,
    targetContactId: effectiveTargetContactId,
    setAsPrimaryContact: updateRequest.setAsPrimaryContact,
    primaryOnlyIntent: updateRequest.primaryOnlyIntent,
    contactOnlyIntent: updateRequest.contactOnlyIntent,
    salesRepId: currentAccountRow.salesRepId,
    salesRepName: currentAccountRow.salesRepName,
    industryType: currentAccountRow.industryType,
    subCategory: currentAccountRow.subCategory,
    companyRegion: currentAccountRow.companyRegion,
    week: currentAccountRow.week,
    companyPhone: resolveCompanyPhone(currentAccountRow),
    primaryContactName: currentRowForContactComparison.primaryContactName,
    primaryContactJobTitle: currentRowForContactComparison.primaryContactJobTitle ?? null,
    primaryContactPhone: currentRowForContactComparison.primaryContactPhone,
    primaryContactExtension: currentRowForContactComparison.primaryContactExtension ?? null,
    primaryContactEmail: currentRowForContactComparison.primaryContactEmail,
    category: currentAccountRow.category,
    notes: currentRowForContactComparison.notes,
    expectedLastModified: currentAccountRow.lastModifiedIso,
    baseSnapshot: updateRequest.baseSnapshot ?? null,
  };

  for (const field of updatedFields) {
    rebasedRequest[field] = updateRequest[field] as never;
  }

  return rebasedRequest;
}

export function formatConcurrencyConflictFields(
  fields: BusinessAccountConcurrencyField[],
): string[] {
  return [...new Set(fields.map((field) => CONFLICT_LABELS[field]))];
}
