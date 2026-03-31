import type {
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
  CompanyPhoneSource,
} from "@/types/business-account";
import {
  enforceSinglePrimaryPerAccountRows,
  hasBusinessAccountChanges,
  hasPrimaryContactChanges,
  sanitizeNullableInput,
} from "@/lib/business-accounts";

function formatAddressFromUpdate(update: BusinessAccountUpdateRequest): string {
  const line = [update.addressLine1, update.addressLine2]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
  const cityLine = [update.city, update.state, update.postalCode]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");

  return [line, cityLine, update.country.trim().toUpperCase()]
    .filter(Boolean)
    .join(", ");
}

function resolveOptimisticCompanyPhoneSource(
  existingSource: CompanyPhoneSource | null | undefined,
  companyPhone: string | null,
): CompanyPhoneSource | null {
  if (!companyPhone) {
    return existingSource ?? null;
  }

  return existingSource ?? "account";
}

export function buildVerificationUpdateRequest(
  currentAccountRow: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
): BusinessAccountUpdateRequest {
  return {
    ...updateRequest,
    week: sanitizeNullableInput(updateRequest.week) ?? currentAccountRow.week,
    category: updateRequest.category ?? currentAccountRow.category,
  };
}

export function responseRowMatchesSavedUpdate(
  responseRow: BusinessAccountRow,
  currentAccountRow: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
  effectiveTargetContactId: number | null,
): boolean {
  const verificationUpdate = buildVerificationUpdateRequest(currentAccountRow, updateRequest);

  if (hasBusinessAccountChanges(responseRow, verificationUpdate)) {
    return false;
  }

  if (hasPrimaryContactChanges(responseRow, verificationUpdate)) {
    return false;
  }

  if (effectiveTargetContactId !== null && responseRow.contactId !== effectiveTargetContactId) {
    return false;
  }

  if (
    verificationUpdate.setAsPrimaryContact &&
    effectiveTargetContactId !== null &&
    responseRow.primaryContactId !== effectiveTargetContactId
  ) {
    return false;
  }

  return true;
}

export function applyOptimisticSavedUpdateToRow(
  row: BusinessAccountRow,
  currentAccountRow: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
  effectiveTargetContactId: number | null,
): BusinessAccountRow {
  const optimisticUpdate = buildVerificationUpdateRequest(currentAccountRow, updateRequest);
  const companyPhone = sanitizeNullableInput(optimisticUpdate.companyPhone);
  const primaryContactId =
    optimisticUpdate.setAsPrimaryContact && effectiveTargetContactId !== null
      ? effectiveTargetContactId
      : row.primaryContactId;

  const nextRow: BusinessAccountRow = {
    ...row,
    companyName: optimisticUpdate.companyName.trim(),
    salesRepId: sanitizeNullableInput(optimisticUpdate.salesRepId),
    salesRepName: sanitizeNullableInput(optimisticUpdate.salesRepName),
    industryType: sanitizeNullableInput(optimisticUpdate.industryType),
    subCategory: sanitizeNullableInput(optimisticUpdate.subCategory),
    companyRegion: sanitizeNullableInput(optimisticUpdate.companyRegion),
    week: sanitizeNullableInput(optimisticUpdate.week),
    address: formatAddressFromUpdate(optimisticUpdate),
    addressLine1: optimisticUpdate.addressLine1,
    addressLine2: optimisticUpdate.addressLine2,
    city: optimisticUpdate.city,
    state: optimisticUpdate.state,
    postalCode: optimisticUpdate.postalCode,
    country: optimisticUpdate.country.trim().toUpperCase(),
    companyPhone,
    companyPhoneSource: resolveOptimisticCompanyPhoneSource(
      row.companyPhoneSource,
      companyPhone,
    ),
    primaryContactId,
    category: optimisticUpdate.category,
    isPrimaryContact:
      optimisticUpdate.setAsPrimaryContact &&
      effectiveTargetContactId !== null &&
      row.contactId !== null &&
      row.contactId !== undefined
        ? row.contactId === effectiveTargetContactId
        : row.isPrimaryContact,
  };

  if (effectiveTargetContactId === null || row.contactId !== effectiveTargetContactId) {
    return nextRow;
  }

  return {
    ...nextRow,
    contactId: effectiveTargetContactId,
    primaryContactName: sanitizeNullableInput(optimisticUpdate.primaryContactName),
    primaryContactJobTitle: sanitizeNullableInput(optimisticUpdate.primaryContactJobTitle),
    primaryContactPhone: sanitizeNullableInput(optimisticUpdate.primaryContactPhone),
    primaryContactExtension: sanitizeNullableInput(optimisticUpdate.primaryContactExtension),
    primaryContactEmail: sanitizeNullableInput(optimisticUpdate.primaryContactEmail),
    notes: sanitizeNullableInput(optimisticUpdate.notes),
  };
}

export function applyOptimisticSavedUpdateToRows(
  rows: BusinessAccountRow[],
  currentAccountRow: BusinessAccountRow,
  updateRequest: BusinessAccountUpdateRequest,
  effectiveTargetContactId: number | null,
): BusinessAccountRow[] {
  return rows.map((row) =>
    applyOptimisticSavedUpdateToRow(
      row,
      currentAccountRow,
      updateRequest,
      effectiveTargetContactId,
    ),
  );
}

export function mergeSavedResponseRowIntoRows(
  rows: BusinessAccountRow[],
  responseRow: BusinessAccountRow,
): BusinessAccountRow[] {
  const responseContactId = responseRow.contactId ?? null;
  const responsePrimaryContactId = responseRow.primaryContactId ?? null;
  let matched = false;

  const nextRows = rows.map((row) => {
    const nextPrimaryContactId =
      responsePrimaryContactId !== null ? responsePrimaryContactId : row.primaryContactId;
    const nextIsPrimaryContact =
      responsePrimaryContactId !== null &&
      row.contactId !== null &&
      row.contactId !== undefined
        ? row.contactId === responsePrimaryContactId
        : row.isPrimaryContact;

    if (responseContactId === null || row.contactId !== responseContactId) {
      if (
        nextPrimaryContactId === row.primaryContactId &&
        nextIsPrimaryContact === row.isPrimaryContact
      ) {
        return row;
      }

      return {
        ...row,
        primaryContactId: nextPrimaryContactId,
        isPrimaryContact: nextIsPrimaryContact,
      };
    }

    matched = true;
    return {
      ...row,
      ...responseRow,
      id: row.id,
      accountRecordId: row.accountRecordId ?? responseRow.accountRecordId ?? responseRow.id,
      rowKey:
        responseRow.rowKey ??
        row.rowKey ??
        `${row.accountRecordId ?? responseRow.accountRecordId ?? row.id}:contact:${responseContactId}`,
      primaryContactId: nextPrimaryContactId,
      isPrimaryContact:
        responsePrimaryContactId !== null
          ? responseContactId === responsePrimaryContactId
          : responseRow.isPrimaryContact,
    };
  });

  const mergedRows =
    matched || responseContactId === null
      ? nextRows
      : [
          ...nextRows,
          {
            ...responseRow,
            primaryContactId: responsePrimaryContactId ?? responseRow.primaryContactId,
            isPrimaryContact:
              responsePrimaryContactId !== null
                ? responseContactId === responsePrimaryContactId
                : responseRow.isPrimaryContact,
          },
        ];

  return enforceSinglePrimaryPerAccountRows(mergedRows);
}
