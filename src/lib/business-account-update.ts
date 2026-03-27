import type {
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
} from "@/types/business-account";
import { resolveCompanyPhone, sanitizeNullableInput } from "@/lib/business-accounts";

function normalizeRequiredText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeCountryCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function sameRequiredText(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return normalizeRequiredText(left) === normalizeRequiredText(right);
}

function sameNullableText(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return sanitizeNullableInput(left) === sanitizeNullableInput(right);
}

export function isPrimaryOnlyConflictRetryAllowed(
  updateRequest: BusinessAccountUpdateRequest,
  effectiveTargetContactId: number | null,
): boolean {
  return (
    updateRequest.primaryOnlyIntent === true &&
    updateRequest.setAsPrimaryContact === true &&
    effectiveTargetContactId !== null
  );
}

export function isContactOnlyUpdate(
  currentAccountRow: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
): boolean {
  if (updateRequest.targetContactId === null || updateRequest.setAsPrimaryContact) {
    return false;
  }

  if (updateRequest.contactOnlyIntent === true) {
    return true;
  }

  return (
    sameRequiredText(currentAccountRow.companyName, updateRequest.companyName) &&
    sameNullableText(
      currentAccountRow.accountRecordId ?? currentAccountRow.id,
      updateRequest.assignedBusinessAccountRecordId,
    ) &&
    sameNullableText(
      currentAccountRow.businessAccountId,
      updateRequest.assignedBusinessAccountId,
    ) &&
    sameRequiredText(currentAccountRow.addressLine1, updateRequest.addressLine1) &&
    sameRequiredText(currentAccountRow.addressLine2, updateRequest.addressLine2) &&
    sameRequiredText(currentAccountRow.city, updateRequest.city) &&
    sameRequiredText(currentAccountRow.state, updateRequest.state) &&
    sameRequiredText(currentAccountRow.postalCode, updateRequest.postalCode) &&
    normalizeCountryCode(currentAccountRow.country) ===
      normalizeCountryCode(updateRequest.country) &&
    sameNullableText(currentAccountRow.salesRepId, updateRequest.salesRepId) &&
    sameNullableText(currentAccountRow.salesRepName, updateRequest.salesRepName) &&
    sameNullableText(currentAccountRow.industryType, updateRequest.industryType) &&
    sameNullableText(currentAccountRow.subCategory, updateRequest.subCategory) &&
    sameNullableText(currentAccountRow.companyRegion, updateRequest.companyRegion) &&
    sameNullableText(currentAccountRow.week, updateRequest.week) &&
    currentAccountRow.category === updateRequest.category &&
    sameNullableText(resolveCompanyPhone(currentAccountRow), updateRequest.companyPhone)
  );
}

export function isPrimaryOnlyUpdate(
  currentAccountRow: BusinessAccountRow,
  currentRowForContactComparison: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
): boolean {
  if (!updateRequest.setAsPrimaryContact || updateRequest.targetContactId === null) {
    return false;
  }

  if (updateRequest.primaryOnlyIntent === true) {
    return true;
  }

  return (
    sameRequiredText(currentAccountRow.companyName, updateRequest.companyName) &&
    sameNullableText(
      currentAccountRow.accountRecordId ?? currentAccountRow.id,
      updateRequest.assignedBusinessAccountRecordId,
    ) &&
    sameNullableText(
      currentAccountRow.businessAccountId,
      updateRequest.assignedBusinessAccountId,
    ) &&
    sameRequiredText(currentAccountRow.addressLine1, updateRequest.addressLine1) &&
    sameRequiredText(currentAccountRow.addressLine2, updateRequest.addressLine2) &&
    sameRequiredText(currentAccountRow.city, updateRequest.city) &&
    sameRequiredText(currentAccountRow.state, updateRequest.state) &&
    sameRequiredText(currentAccountRow.postalCode, updateRequest.postalCode) &&
    normalizeCountryCode(currentAccountRow.country) ===
      normalizeCountryCode(updateRequest.country) &&
    sameNullableText(currentAccountRow.salesRepId, updateRequest.salesRepId) &&
    sameNullableText(currentAccountRow.salesRepName, updateRequest.salesRepName) &&
    sameNullableText(currentAccountRow.industryType, updateRequest.industryType) &&
    sameNullableText(currentAccountRow.subCategory, updateRequest.subCategory) &&
    sameNullableText(currentAccountRow.companyRegion, updateRequest.companyRegion) &&
    sameNullableText(currentAccountRow.week, updateRequest.week) &&
    currentAccountRow.category === updateRequest.category &&
    sameNullableText(resolveCompanyPhone(currentAccountRow), updateRequest.companyPhone) &&
    sameNullableText(
      currentRowForContactComparison.primaryContactName,
      updateRequest.primaryContactName,
    ) &&
    sameNullableText(
      currentRowForContactComparison.primaryContactJobTitle,
      updateRequest.primaryContactJobTitle,
    ) &&
    sameNullableText(
      currentRowForContactComparison.primaryContactPhone,
      updateRequest.primaryContactPhone,
    ) &&
    sameNullableText(
      currentRowForContactComparison.primaryContactExtension,
      updateRequest.primaryContactExtension,
    ) &&
    sameNullableText(
      currentRowForContactComparison.primaryContactEmail,
      updateRequest.primaryContactEmail,
    ) &&
    sameNullableText(currentRowForContactComparison.notes, updateRequest.notes)
  );
}

export function buildPrimaryOnlyUpdateRequest(
  currentAccountRow: BusinessAccountRow,
  currentRowForContactComparison: BusinessAccountRow,
  effectiveTargetContactId: number,
): BusinessAccountUpdateRequest {
  return {
    companyName: currentAccountRow.companyName,
    assignedBusinessAccountRecordId:
      currentAccountRow.accountRecordId ?? currentAccountRow.id,
    assignedBusinessAccountId: currentAccountRow.businessAccountId,
    addressLine1: currentAccountRow.addressLine1,
    addressLine2: currentAccountRow.addressLine2,
    city: currentAccountRow.city,
    state: currentAccountRow.state,
    postalCode: currentAccountRow.postalCode,
    country: currentAccountRow.country,
    targetContactId: effectiveTargetContactId,
    setAsPrimaryContact: true,
    primaryOnlyIntent: true,
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
  };
}
