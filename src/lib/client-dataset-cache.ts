"use client";

import type { BusinessAccountRow } from "@/types/business-account";

export const DATASET_STORAGE_KEYS = [
  "businessAccounts.dataset.v3",
  "businessAccounts.dataset.v2",
  "businessAccounts.dataset.v1",
] as const;

export type CachedDataset = {
  rows: BusinessAccountRow[];
  lastSyncedAt: string | null;
};

type CachedDatasetPayload = {
  rows?: unknown;
  lastSyncedAt?: unknown;
};

let memoryDataset: CachedDataset | null = null;

function hasString(value: unknown): value is string {
  return typeof value === "string";
}

function hasNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

export function isBusinessAccountRow(value: unknown): value is BusinessAccountRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    hasString(record.id) &&
    hasString(record.businessAccountId) &&
    hasString(record.companyName) &&
    hasString(record.address) &&
    hasString(record.addressLine1) &&
    hasString(record.addressLine2) &&
    hasString(record.city) &&
    hasString(record.state) &&
    hasString(record.postalCode) &&
    hasString(record.country) &&
    hasNullableString(record.primaryContactName) &&
    hasNullableString(record.primaryContactPhone) &&
    hasNullableString(record.primaryContactEmail) &&
    hasNullableString(record.salesRepId) &&
    hasNullableString(record.salesRepName) &&
    hasNullableString(record.industryType) &&
    hasNullableString(record.subCategory) &&
    hasNullableString(record.companyRegion) &&
    hasNullableString(record.week) &&
    hasNullableNumber(record.primaryContactId) &&
    hasNullableString(record.notes) &&
    hasNullableString(record.lastModifiedIso)
  );
}

function normalizeCachedDatasetPayload(payload: CachedDatasetPayload): CachedDataset | null {
  if (!Array.isArray(payload.rows)) {
    return null;
  }

  const rows = payload.rows.filter((row): row is BusinessAccountRow => isBusinessAccountRow(row));
  return {
    rows,
    lastSyncedAt: typeof payload.lastSyncedAt === "string" ? payload.lastSyncedAt : null,
  };
}

export function getMemoryCachedDataset(): CachedDataset | null {
  return memoryDataset;
}

export function setMemoryCachedDataset(dataset: CachedDataset): void {
  memoryDataset = dataset;
}

export function readCachedDatasetFromStorage(): CachedDataset | null {
  if (memoryDataset) {
    return memoryDataset;
  }

  for (const key of DATASET_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as CachedDatasetPayload;
      const normalized = normalizeCachedDatasetPayload(parsed);
      if (!normalized) {
        continue;
      }

      memoryDataset = normalized;
      return normalized;
    } catch {
      // Ignore malformed cached dataset and try next key.
    }
  }

  return null;
}

export function writeCachedDatasetToStorage(dataset: CachedDataset): void {
  memoryDataset = dataset;

  try {
    window.localStorage.setItem(DATASET_STORAGE_KEYS[0], JSON.stringify(dataset));
    window.dispatchEvent(new CustomEvent("businessAccounts:dataset-updated"));
  } catch {
    // Ignore cache write failures (e.g. quota exceeded).
  }
}
