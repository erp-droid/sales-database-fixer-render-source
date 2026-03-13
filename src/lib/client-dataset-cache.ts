"use client";

import type { BusinessAccountRow } from "@/types/business-account";

export const DATASET_STORAGE_KEYS = [
  "businessAccounts.dataset.v4",
  "businessAccounts.dataset.v3",
  "businessAccounts.dataset.v2",
  "businessAccounts.dataset.v1",
] as const;

const CURRENT_DATASET_STORAGE_KEY = DATASET_STORAGE_KEYS[0];
const SYNC_META_STORAGE_KEY = "businessAccounts.syncMeta.v1";

export type CachedDataset = {
  rows: BusinessAccountRow[];
  lastSyncedAt: string | null;
};

export type CachedSyncMeta = {
  lastSyncedAt: string | null;
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

function clearLegacyDatasetStorage(): void {
  for (const key of DATASET_STORAGE_KEYS.slice(1)) {
    window.localStorage.removeItem(key);
  }
}

export function emitDatasetUpdated(): void {
  window.dispatchEvent(new CustomEvent("businessAccounts:dataset-updated"));
}

export function getMemoryCachedDataset(): CachedDataset | null {
  return memoryDataset;
}

export function setMemoryCachedDataset(dataset: CachedDataset): void {
  memoryDataset = dataset;
}

export function readCachedDatasetFromStorage(): CachedDataset | null {
  for (const key of DATASET_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as {
        rows?: unknown;
        lastSyncedAt?: unknown;
      };
      if (!Array.isArray(parsed.rows) || !parsed.rows.every((row) => isBusinessAccountRow(row))) {
        continue;
      }

      const dataset: CachedDataset = {
        rows: parsed.rows,
        lastSyncedAt:
          typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
      };

      memoryDataset = dataset;
      if (key !== CURRENT_DATASET_STORAGE_KEY) {
        try {
          window.localStorage.setItem(
            CURRENT_DATASET_STORAGE_KEY,
            JSON.stringify(dataset),
          );
          clearLegacyDatasetStorage();
        } catch {
          // Ignore migration failures.
        }
      }

      return dataset;
    } catch {
      // Ignore malformed storage values.
    }
  }

  return memoryDataset;
}

export function readCachedSyncMeta(): CachedSyncMeta {
  try {
    const raw = window.localStorage.getItem(SYNC_META_STORAGE_KEY);
    if (!raw) {
      return { lastSyncedAt: null };
    }

    const parsed = JSON.parse(raw) as { lastSyncedAt?: unknown };
    return {
      lastSyncedAt: typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
    };
  } catch {
    return { lastSyncedAt: null };
  }
}

export function writeCachedSyncMeta(meta: CachedSyncMeta): void {
  try {
    clearLegacyDatasetStorage();
    window.localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage failures.
  }
}

export function writeCachedDatasetToStorage(dataset: CachedDataset): void {
  memoryDataset = dataset;
  try {
    window.localStorage.setItem(
      CURRENT_DATASET_STORAGE_KEY,
      JSON.stringify(dataset),
    );
    clearLegacyDatasetStorage();
  } catch {
    // Ignore storage failures.
  }
  writeCachedSyncMeta({ lastSyncedAt: dataset.lastSyncedAt });
  emitDatasetUpdated();
}
