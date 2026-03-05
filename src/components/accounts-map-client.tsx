"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type {
  BusinessAccountDetailResponse,
  BusinessAccountMapPoint,
  BusinessAccountMapResponse,
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
  Category,
  PostalRegion,
  PostalRegionsResponse,
} from "@/types/business-account";
import { enforceSinglePrimaryPerAccountRows } from "@/lib/business-accounts";
import { formatPhoneDraftValue, normalizePhoneForSave } from "@/lib/phone";

import styles from "./accounts-map-client.module.css";

type LeafletModule = typeof import("leaflet");

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
};

const DEFAULT_CENTER: [number, number] = [43.6532, -79.3832];
const DEFAULT_LIMIT = 600;
const MAX_LIMIT = 5000;
const DATASET_STORAGE_KEYS = [
  "businessAccounts.dataset.v3",
  "businessAccounts.dataset.v2",
  "businessAccounts.dataset.v1",
] as const;
const MAP_CACHE_STORAGE_KEY = "businessAccounts.mapCache.v3";
const MAP_PANEL_PREFERENCES_STORAGE_KEY = "businessAccounts.mapPanelPrefs.v1";
const GEOCODE_CACHE_STORAGE_KEY = "businessAccounts.geocodeCache.v1";
const GEOCODE_TIMEOUT_MS = 3500;
const GEOCODE_CONCURRENCY = 8;
const GEOCODE_CACHE_MAX_ENTRIES = 20000;

const MAP_DETAIL_FIELD_KEYS = [
  "fullAddress",
  "contactsCount",
  "category",
  "businessAccountId",
  "coordinates",
  "geocodeSource",
  "lastModified",
  "notes",
] as const;

type MapDetailFieldKey = (typeof MAP_DETAIL_FIELD_KEYS)[number];

type MapPanelPreferences = Record<MapDetailFieldKey, boolean> & {
  hideEmptyFields: boolean;
  summaryStats: boolean;
};

const DEFAULT_MAP_PANEL_PREFERENCES: MapPanelPreferences = {
  summaryStats: true,
  hideEmptyFields: true,
  fullAddress: true,
  contactsCount: false,
  category: false,
  businessAccountId: true,
  coordinates: false,
  geocodeSource: false,
  lastModified: false,
  notes: false,
};

type CachedDataset = {
  rows?: BusinessAccountRow[];
  lastSyncedAt?: string | null;
};

type CachedMapResponse = {
  cacheKey: string;
  payload: BusinessAccountMapResponse;
};

type GeocodeProvider = "nominatim" | "arcgis";

type CachedGeocodeEntry = {
  latitude: number;
  longitude: number;
  provider: GeocodeProvider;
};

type CachedGeocodeStore = Record<string, CachedGeocodeEntry>;

type MapContactSummary = {
  rowKey: string;
  contactId: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
};

type MapContactDraft = {
  name: string;
  phone: string;
  email: string;
  notes: string;
};

type AccountGroupCandidate = {
  accountKey: string;
  representativeRow: BusinessAccountRow;
  contacts: MapContactSummary[];
};

type DetailFieldDefinition = {
  key: MapDetailFieldKey;
  label: string;
};

const DETAIL_FIELD_DEFINITIONS: DetailFieldDefinition[] = [
  {
    key: "fullAddress",
    label: "Full Address",
  },
  {
    key: "contactsCount",
    label: "Contacts",
  },
  {
    key: "category",
    label: "Category",
  },
  {
    key: "businessAccountId",
    label: "Business Account ID",
  },
  {
    key: "coordinates",
    label: "Coordinates",
  },
  {
    key: "geocodeSource",
    label: "Geocode Source",
  },
  {
    key: "lastModified",
    label: "Last Modified",
  },
  {
    key: "notes",
    label: "Notes",
  },
];

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const value = (payload as Record<string, unknown>).error;
  return typeof value === "string" && value.trim() ? value : "Request failed.";
}

function renderText(value: string | null): string {
  if (!value || !value.trim()) {
    return "-";
  }
  return value;
}

function formatLastModified(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function normalizeComparableText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase();
}

function hasText(value: string | null | undefined): value is string {
  return Boolean(value && value.trim());
}

function readRowAccountKey(row: BusinessAccountRow): string {
  return (
    row.accountRecordId?.trim() ||
    row.id.trim() ||
    row.businessAccountId.trim() ||
    row.companyName.trim()
  );
}

function buildContactsFromRows(rows: BusinessAccountRow[]): MapContactSummary[] {
  const normalizedRows = enforceSinglePrimaryPerAccountRows(rows);
  const deduped = new Map<string, MapContactSummary>();

  normalizedRows.forEach((row, index) => {
    const contactKey = [
      row.contactId !== null && row.contactId !== undefined ? `id:${row.contactId}` : "",
      normalizeComparableText(row.primaryContactName),
      normalizeComparableText(row.primaryContactEmail),
      normalizeComparableText(row.primaryContactPhone),
      `row:${row.rowKey ?? index}`,
    ]
      .filter(Boolean)
      .join("|");

    const nextContact: MapContactSummary = {
      rowKey: row.rowKey ?? `${readRowAccountKey(row)}:contact:${row.contactId ?? index}`,
      contactId: row.contactId ?? null,
      name: row.primaryContactName,
      phone: row.primaryContactPhone,
      email: row.primaryContactEmail,
      isPrimary: Boolean(row.isPrimaryContact),
      notes: row.notes ?? null,
    };

    const existing = deduped.get(contactKey);
    if (!existing) {
      deduped.set(contactKey, nextContact);
      return;
    }

    deduped.set(contactKey, {
      rowKey: existing.rowKey || nextContact.rowKey,
      contactId: existing.contactId ?? nextContact.contactId,
      name: hasText(existing.name) ? existing.name : nextContact.name,
      phone: hasText(existing.phone) ? existing.phone : nextContact.phone,
      email: hasText(existing.email) ? existing.email : nextContact.email,
      isPrimary: existing.isPrimary || nextContact.isPrimary,
      notes: hasText(existing.notes) ? existing.notes : nextContact.notes,
    });
  });

  return [...deduped.values()]
    .filter(
      (contact) =>
        hasText(contact.name) || hasText(contact.email) || hasText(contact.phone),
    )
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }

      return (left.name ?? "").localeCompare(right.name ?? "", undefined, {
        sensitivity: "base",
      });
    });
}

function buildContactDraft(contact: MapContactSummary): MapContactDraft {
  return {
    name: contact.name ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    notes: contact.notes ?? "",
  };
}

function pickRepresentativeRow(rows: BusinessAccountRow[]): BusinessAccountRow {
  const withAddress = rows.find(
    (row) => hasText(row.addressLine1) && hasText(row.city),
  );
  return withAddress ?? rows[0];
}

function matchesCandidateQuery(
  candidate: AccountGroupCandidate,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const contactSearchText = candidate.contacts
    .map((contact) => [contact.name, contact.email, contact.phone].filter(Boolean).join(" "))
    .join(" ");
  const haystack = [
    candidate.representativeRow.companyName,
    candidate.representativeRow.businessAccountId,
    candidate.representativeRow.address,
    contactSearchText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function buildAccountCandidates(rows: BusinessAccountRow[]): AccountGroupCandidate[] {
  const grouped = new Map<string, BusinessAccountRow[]>();

  rows.forEach((row) => {
    const key = readRowAccountKey(row);
    if (!key) {
      return;
    }
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
    }
  });

  const candidates: AccountGroupCandidate[] = [];

  grouped.forEach((accountRows, accountKey) => {
    const representativeRow = pickRepresentativeRow(accountRows);
    const contacts = buildContactsFromRows(accountRows);

    candidates.push({
      accountKey,
      representativeRow,
      contacts,
    });
  });

  return candidates;
}

function rowBelongsToPoint(row: BusinessAccountRow, point: BusinessAccountMapPoint): boolean {
  const rowAccountRecordId = row.accountRecordId ?? row.id;
  if (
    point.accountRecordId &&
    rowAccountRecordId &&
    rowAccountRecordId === point.accountRecordId
  ) {
    return true;
  }

  if (rowAccountRecordId && rowAccountRecordId === point.id) {
    return true;
  }

  if (row.businessAccountId && row.businessAccountId === point.businessAccountId) {
    return true;
  }

  return false;
}

function updateRowsAfterContactSave(
  rows: BusinessAccountRow[],
  point: BusinessAccountMapPoint,
  updatedRow: BusinessAccountRow,
  targetContactId: number | null,
): BusinessAccountRow[] {
  const updatedAccountRecordId =
    updatedRow.accountRecordId ??
    updatedRow.id ??
    point.accountRecordId ??
    point.id;
  const updatedPrimaryContactId = updatedRow.primaryContactId;
  const updatedTargetContactId =
    updatedRow.contactId ?? targetContactId ?? updatedPrimaryContactId ?? null;

  const nextRows = rows.map((row) => {
    if (!rowBelongsToPoint(row, point)) {
      return row;
    }

    const rowAccountRecordId = row.accountRecordId ?? row.id;
    const isTargetRow =
      updatedTargetContactId !== null &&
      row.contactId !== null &&
      row.contactId !== undefined &&
      row.contactId === updatedTargetContactId;

    const nextRow: BusinessAccountRow = {
      ...row,
      accountRecordId: updatedAccountRecordId || rowAccountRecordId,
      companyName: updatedRow.companyName || row.companyName,
      address: updatedRow.address || row.address,
      addressLine1: updatedRow.addressLine1 || row.addressLine1,
      addressLine2: updatedRow.addressLine2 || row.addressLine2,
      city: updatedRow.city || row.city,
      state: updatedRow.state || row.state,
      postalCode: updatedRow.postalCode || row.postalCode,
      country: updatedRow.country || row.country,
      category: updatedRow.category ?? row.category,
      phoneNumber: updatedRow.phoneNumber ?? row.phoneNumber,
      primaryContactId: updatedPrimaryContactId ?? row.primaryContactId,
      isPrimaryContact:
        updatedPrimaryContactId !== null &&
        row.contactId !== null &&
        row.contactId !== undefined
          ? row.contactId === updatedPrimaryContactId
          : row.isPrimaryContact,
      lastModifiedIso: updatedRow.lastModifiedIso ?? row.lastModifiedIso,
    };

    if (isTargetRow) {
      return {
        ...nextRow,
        contactId: updatedTargetContactId,
        primaryContactName: updatedRow.primaryContactName ?? row.primaryContactName,
        primaryContactPhone: updatedRow.primaryContactPhone ?? row.primaryContactPhone,
        primaryContactEmail: updatedRow.primaryContactEmail ?? row.primaryContactEmail,
        notes: updatedRow.notes ?? row.notes,
      };
    }

    return nextRow;
  });

  return enforceSinglePrimaryPerAccountRows(nextRows);
}

function replaceRowsForPoint(
  rows: BusinessAccountRow[],
  point: BusinessAccountMapPoint,
  incomingRows: BusinessAccountRow[],
): BusinessAccountRow[] {
  const nextRows = rows.filter((row) => !rowBelongsToPoint(row, point));
  return enforceSinglePrimaryPerAccountRows([...incomingRows, ...nextRows]);
}

function removeDeletedContactFromAccountRows(
  rows: BusinessAccountRow[],
  targetContactId: number,
  targetRowKey: string | null,
): BusinessAccountRow[] {
  const deletedWasPrimary = rows.some((row) => {
    const matchesRowKey = targetRowKey ? row.rowKey === targetRowKey : false;
    const matchesContactId =
      row.contactId !== null &&
      row.contactId !== undefined &&
      row.contactId === targetContactId;

    if (!matchesRowKey && !matchesContactId) {
      return false;
    }

    return row.isPrimaryContact === true || row.primaryContactId === targetContactId;
  });

  const remainingRows = rows.filter((row) => {
    if (targetRowKey && row.rowKey === targetRowKey) {
      return false;
    }

    return !(
      row.contactId !== null &&
      row.contactId !== undefined &&
      row.contactId === targetContactId
    );
  });

  if (remainingRows.length === 0) {
    const fallbackRow = rows[0];
    if (!fallbackRow) {
      return [];
    }

    return [
      {
        ...fallbackRow,
        rowKey: `${fallbackRow.accountRecordId ?? fallbackRow.id}:primary`,
        contactId: null,
        isPrimaryContact: false,
        primaryContactId: null,
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactEmail: null,
        notes: null,
      },
    ];
  }

  if (!deletedWasPrimary) {
    return enforceSinglePrimaryPerAccountRows(remainingRows);
  }

  return enforceSinglePrimaryPerAccountRows(
    remainingRows.map((row) => ({
      ...row,
      primaryContactId:
        row.primaryContactId === targetContactId ? null : row.primaryContactId,
      isPrimaryContact: false,
    })),
  );
}

function buildPointFromRows(
  point: BusinessAccountMapPoint,
  rows: BusinessAccountRow[],
): BusinessAccountMapPoint {
  if (rows.length === 0) {
    return {
      ...point,
      primaryContactName: null,
      primaryContactPhone: null,
      primaryContactEmail: null,
      notes: null,
      contacts: [],
    };
  }

  const representativeRow = pickRepresentativeRow(rows);
  const primaryRow = rows.find((row) => row.isPrimaryContact) ?? representativeRow;

  return {
    ...point,
    accountRecordId:
      representativeRow.accountRecordId ?? representativeRow.id ?? point.accountRecordId,
    businessAccountId: representativeRow.businessAccountId || point.businessAccountId,
    companyName: representativeRow.companyName || point.companyName,
    fullAddress: representativeRow.address || point.fullAddress,
    addressLine1: representativeRow.addressLine1 || point.addressLine1,
    addressLine2: representativeRow.addressLine2 || point.addressLine2,
    city: representativeRow.city || point.city,
    state: representativeRow.state || point.state,
    postalCode: representativeRow.postalCode || point.postalCode,
    country: representativeRow.country || point.country,
    primaryContactName: primaryRow.primaryContactName,
    primaryContactPhone: primaryRow.primaryContactPhone,
    primaryContactEmail: primaryRow.primaryContactEmail,
    category: representativeRow.category ?? point.category,
    notes: primaryRow.notes ?? representativeRow.notes ?? null,
    lastModifiedIso: representativeRow.lastModifiedIso ?? point.lastModifiedIso,
    contacts: buildContactsFromRows(rows).map((contact) => ({
      rowKey: contact.rowKey,
      contactId: contact.contactId,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      isPrimary: contact.isPrimary,
      notes: contact.notes,
    })),
  };
}

function clearMapCache() {
  try {
    window.localStorage.removeItem(MAP_CACHE_STORAGE_KEY);
  } catch {
    // Ignore storage failures while updating client caches.
  }
}

function isMapDetailFieldKey(value: string): value is MapDetailFieldKey {
  return (MAP_DETAIL_FIELD_KEYS as readonly string[]).includes(value);
}

function readMapPanelPreferences(): MapPanelPreferences {
  try {
    const raw = window.localStorage.getItem(MAP_PANEL_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_MAP_PANEL_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: MapPanelPreferences = {
      ...DEFAULT_MAP_PANEL_PREFERENCES,
    };

    if (typeof parsed.summaryStats === "boolean") {
      next.summaryStats = parsed.summaryStats;
    }

    if (typeof parsed.hideEmptyFields === "boolean") {
      next.hideEmptyFields = parsed.hideEmptyFields;
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (isMapDetailFieldKey(key) && typeof value === "boolean") {
        next[key] = value;
      }
    }

    return next;
  } catch {
    return DEFAULT_MAP_PANEL_PREFERENCES;
  }
}

function writeMapPanelPreferences(preferences: MapPanelPreferences) {
  try {
    window.localStorage.setItem(
      MAP_PANEL_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // Ignore storage failures.
  }
}

function buildFocusedDetailPreferences(
  current: MapPanelPreferences,
): MapPanelPreferences {
  return {
    ...current,
    fullAddress: true,
    contactsCount: false,
    category: false,
    businessAccountId: true,
    coordinates: false,
    geocodeSource: false,
    lastModified: false,
    notes: false,
  };
}

function buildAllDetailPreferences(
  current: MapPanelPreferences,
): MapPanelPreferences {
  return {
    ...current,
    fullAddress: true,
    contactsCount: true,
    category: true,
    businessAccountId: true,
    coordinates: true,
    geocodeSource: true,
    lastModified: true,
    notes: true,
  };
}

function isBusinessAccountDetailResponse(
  payload: unknown,
): payload is BusinessAccountDetailResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (!record.row || typeof record.row !== "object") {
    return false;
  }

  const rowRecord = record.row as Record<string, unknown>;
  if (typeof rowRecord.id !== "string") {
    return false;
  }

  if ("rows" in record && record.rows !== undefined && !Array.isArray(record.rows)) {
    return false;
  }

  return true;
}

function readDetailRows(payload: unknown): BusinessAccountRow[] | null {
  if (!isBusinessAccountDetailResponse(payload)) {
    return null;
  }

  if (Array.isArray(payload.rows)) {
    return payload.rows.filter((row): row is BusinessAccountRow => isBusinessAccountRow(row));
  }

  return null;
}

function buildMapContactUpdateRequest(
  targetRow: BusinessAccountRow,
  point: BusinessAccountMapPoint,
  overrides: Partial<BusinessAccountUpdateRequest>,
): BusinessAccountUpdateRequest {
  const targetContactId =
    overrides.targetContactId ??
    targetRow.contactId ??
    targetRow.primaryContactId ??
    null;

  return {
    companyName: targetRow.companyName,
    addressLine1: targetRow.addressLine1,
    addressLine2: targetRow.addressLine2,
    city: targetRow.city,
    state: targetRow.state,
    postalCode: targetRow.postalCode,
    country: targetRow.country,
    targetContactId,
    setAsPrimaryContact: false,
    salesRepId: targetRow.salesRepId,
    salesRepName: targetRow.salesRepName,
    industryType: targetRow.industryType,
    subCategory: targetRow.subCategory,
    companyRegion: targetRow.companyRegion,
    week: targetRow.week,
    primaryContactName: targetRow.primaryContactName,
    primaryContactPhone: targetRow.primaryContactPhone,
    primaryContactEmail: targetRow.primaryContactEmail,
    category: targetRow.category,
    notes: targetRow.notes,
    expectedLastModified: targetRow.lastModifiedIso ?? point.lastModifiedIso,
    ...overrides,
  };
}

function markerColor(category: Category | null): string {
  switch (category) {
    case "A":
      return "#0f9d58";
    case "B":
      return "#f4b400";
    case "C":
      return "#db4437";
    case "D":
      return "#7e57c2";
    default:
      return "#1e88e5";
  }
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function isMapResponse(payload: unknown): payload is BusinessAccountMapResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    Array.isArray(record.items) &&
    typeof record.totalCandidates === "number" &&
    typeof record.geocodedCount === "number" &&
    typeof record.unmappedCount === "number"
  );
}

function isPostalRegionsResponse(payload: unknown): payload is PostalRegionsResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    Array.isArray(record.items) &&
    typeof record.total === "number" &&
    typeof record.sourceUrl === "string" &&
    typeof record.generatedAtIso === "string"
  );
}

function readDatasetSyncStamp(): string | null {
  for (const key of DATASET_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as CachedDataset;
      if (typeof parsed.lastSyncedAt === "string") {
        return parsed.lastSyncedAt;
      }
      if (parsed.lastSyncedAt === null) {
        return null;
      }
    } catch {
      // Ignore malformed cache.
    }
  }

  return null;
}

function hasString(value: unknown): value is string {
  return typeof value === "string";
}

function hasNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isBusinessAccountRow(value: unknown): value is BusinessAccountRow {
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

function readDatasetRows(): BusinessAccountRow[] {
  for (const key of DATASET_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as CachedDataset;
      if (!Array.isArray(parsed.rows)) {
        continue;
      }

      const rows = parsed.rows.filter((row): row is BusinessAccountRow =>
        isBusinessAccountRow(row),
      );
      if (rows.length > 0) {
        return rows;
      }
    } catch {
      // Ignore malformed cache.
    }
  }

  return [];
}

function readDatasetEntry(): { storageKey: string; dataset: CachedDataset } | null {
  for (const key of DATASET_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as CachedDataset;
      if (!Array.isArray(parsed.rows)) {
        continue;
      }

      const rows = parsed.rows.filter((row): row is BusinessAccountRow =>
        isBusinessAccountRow(row),
      );
      return {
        storageKey: key,
        dataset: {
          rows,
          lastSyncedAt: typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
        },
      };
    } catch {
      // Ignore malformed cache.
    }
  }

  return null;
}

function writeDatasetRows(rows: BusinessAccountRow[], lastSyncedAt: string | null) {
  try {
    const payload: CachedDataset = {
      rows,
      lastSyncedAt,
    };
    window.localStorage.setItem(DATASET_STORAGE_KEYS[0], JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("businessAccounts:dataset-updated"));
  } catch {
    // Ignore storage failures.
  }
}

function readMapCache(expectedCacheKey: string): BusinessAccountMapResponse | null {
  try {
    const raw = window.localStorage.getItem(MAP_CACHE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedMapResponse;
    if (parsed.cacheKey !== expectedCacheKey) {
      return null;
    }
    if (!isMapResponse(parsed.payload)) {
      return null;
    }

    if (parsed.payload.totalCandidates > 0 && parsed.payload.geocodedCount === 0) {
      return null;
    }

    return parsed.payload;
  } catch {
    return null;
  }
}

function writeMapCache(cacheKey: string, payload: BusinessAccountMapResponse) {
  if (payload.totalCandidates > 0 && payload.geocodedCount === 0) {
    return;
  }

  try {
    const next: CachedMapResponse = {
      cacheKey,
      payload,
    };
    window.localStorage.setItem(MAP_CACHE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function buildAddressKeyFromRow(row: BusinessAccountRow): string {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((part) => normalizeText(part))
    .join("|");
}

function buildFullAddressFromRow(row: BusinessAccountRow): string {
  if (row.address.trim()) {
    return row.address;
  }

  const street = [row.addressLine1, row.addressLine2].filter(Boolean).join(" ");
  const cityLine = [row.city, row.state, row.postalCode].filter(Boolean).join(" ");
  return [street, cityLine, row.country].filter(Boolean).join(", ");
}

function readGeocodeStore(): CachedGeocodeStore {
  try {
    const raw = window.localStorage.getItem(GEOCODE_CACHE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: CachedGeocodeStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const record = value as Record<string, unknown>;
      const latitude = record.latitude;
      const longitude = record.longitude;
      const provider = record.provider;
      if (
        typeof latitude === "number" &&
        Number.isFinite(latitude) &&
        typeof longitude === "number" &&
        Number.isFinite(longitude) &&
        (provider === "nominatim" || provider === "arcgis")
      ) {
        next[key] = {
          latitude,
          longitude,
          provider,
        };
      }
    }

    return next;
  } catch {
    return {};
  }
}

function writeGeocodeStore(store: CachedGeocodeStore) {
  try {
    const entries = Object.entries(store);
    if (entries.length > GEOCODE_CACHE_MAX_ENTRIES) {
      const trimmed = Object.fromEntries(entries.slice(entries.length - GEOCODE_CACHE_MAX_ENTRIES));
      window.localStorage.setItem(GEOCODE_CACHE_STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }

    window.localStorage.setItem(GEOCODE_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage failures.
  }
}

function buildGeocodeSearchTerm(row: BusinessAccountRow): string {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
}

async function fetchWithTimeout(
  input: string,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

async function geocodeWithArcGis(
  searchTerm: string,
  signal: AbortSignal,
): Promise<CachedGeocodeEntry | null> {
  const url =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates" +
    `?f=json&maxLocations=1&singleLine=${encodeURIComponent(searchTerm)}`;
  const response = await fetchWithTimeout(url, signal, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { candidates?: Array<{ location?: { x?: number; y?: number } }> }
    | null;
  const location = payload?.candidates?.[0]?.location;
  const latitude = location?.y;
  const longitude = location?.x;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
    provider: "arcgis",
  };
}

async function geocodeWithNominatim(
  searchTerm: string,
  signal: AbortSignal,
): Promise<CachedGeocodeEntry | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    searchTerm,
  )}`;
  const response = await fetchWithTimeout(url, signal, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | Array<{ lat?: string; lon?: string }>
    | null;
  const first = payload?.[0];
  const latitude = first?.lat ? Number(first.lat) : NaN;
  const longitude = first?.lon ? Number(first.lon) : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    provider: "nominatim",
  };
}

async function geocodeRowAddress(
  row: BusinessAccountRow,
  signal: AbortSignal,
): Promise<CachedGeocodeEntry | null> {
  const searchTerm = buildGeocodeSearchTerm(row);
  if (!searchTerm || !row.addressLine1.trim() || !row.city.trim()) {
    return null;
  }

  const arcgis = await geocodeWithArcGis(searchTerm, signal).catch(() => null);
  if (arcgis) {
    return arcgis;
  }

  return geocodeWithNominatim(searchTerm, signal).catch(() => null);
}

export function AccountsMapClient() {
  const router = useRouter();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [q, setQ] = useState("");
  const [points, setPoints] = useState<BusinessAccountMapPoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [geocodedCount, setGeocodedCount] = useState(0);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [activeLimit, setActiveLimit] = useState(DEFAULT_LIMIT);
  const [postalRegions, setPostalRegions] = useState<PostalRegion[]>([]);
  const [postalRegionsError, setPostalRegionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingContactRowKey, setUpdatingContactRowKey] = useState<string | null>(null);
  const [contactActionMode, setContactActionMode] = useState<
    "save" | "delete" | "primary" | null
  >(null);
  const [editingContactRowKey, setEditingContactRowKey] = useState<string | null>(null);
  const [contactDrafts, setContactDrafts] = useState<Record<string, MapContactDraft>>({});
  const [contactActionError, setContactActionError] = useState<string | null>(null);
  const [panelPreferences, setPanelPreferences] = useState<MapPanelPreferences>(
    DEFAULT_MAP_PANEL_PREFERENCES,
  );
  const [panelPreferencesHydrated, setPanelPreferencesHydrated] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const regionsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const markersLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);

  const selectedPoint = useMemo(
    () => points.find((point) => point.id === selectedId) ?? points[0] ?? null,
    [points, selectedId],
  );
  const selectedContacts = useMemo(() => {
    if (!selectedPoint) {
      return [];
    }

    if (Array.isArray(selectedPoint.contacts) && selectedPoint.contacts.length > 0) {
      return selectedPoint.contacts.map((contact, index) => ({
        rowKey:
          contact.rowKey ??
          `${selectedPoint.id}:contact:${contact.contactId ?? index}`,
        contactId: contact.contactId,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        isPrimary: contact.isPrimary,
        notes: contact.notes,
      }));
    }

    if (
      !selectedPoint.primaryContactName &&
      !selectedPoint.primaryContactEmail &&
      !selectedPoint.primaryContactPhone
    ) {
      return [];
    }

    return [
      {
        rowKey: `${selectedPoint.id}:primary`,
        contactId: null,
        name: selectedPoint.primaryContactName,
        phone: selectedPoint.primaryContactPhone,
        email: selectedPoint.primaryContactEmail,
        isPrimary: true,
        notes: selectedPoint.notes,
      },
    ];
  }, [selectedPoint]);

  const visibleDetailCount = useMemo(
    () =>
      DETAIL_FIELD_DEFINITIONS.reduce(
        (count, field) => count + (panelPreferences[field.key] ? 1 : 0),
        0,
      ),
    [panelPreferences],
  );
  const selectedDetailItems = useMemo(() => {
    if (!selectedPoint) {
      return [];
    }

    const items = [
      {
        key: "fullAddress" as const,
        label: "Full Address",
        value: renderText(selectedPoint.fullAddress),
      },
      {
        key: "contactsCount" as const,
        label: "Contacts",
        value: String(selectedContacts.length || 0),
      },
      {
        key: "category" as const,
        label: "Category",
        value: renderText(selectedPoint.category),
      },
      {
        key: "businessAccountId" as const,
        label: "Business Account ID",
        value: renderText(selectedPoint.businessAccountId),
      },
      {
        key: "coordinates" as const,
        label: "Coordinates",
        value: `${selectedPoint.latitude.toFixed(6)}, ${selectedPoint.longitude.toFixed(6)}`,
      },
      {
        key: "geocodeSource" as const,
        label: "Geocode Source",
        value: selectedPoint.geocodeProvider,
      },
      {
        key: "lastModified" as const,
        label: "Last Modified",
        value: formatLastModified(selectedPoint.lastModifiedIso),
      },
      {
        key: "notes" as const,
        label: "Notes",
        value: renderText(selectedPoint.notes),
      },
    ];

    return items.filter((item) => {
      if (!panelPreferences[item.key]) {
        return false;
      }

      if (panelPreferences.hideEmptyFields && item.value === "-") {
        return false;
      }

      return true;
    });
  }, [panelPreferences, selectedContacts.length, selectedPoint]);

  useEffect(() => {
    setUpdatingContactRowKey(null);
    setContactActionMode(null);
    setEditingContactRowKey(null);
    setContactDrafts({});
    setContactActionError(null);
  }, [selectedId]);

  useEffect(() => {
    setPanelPreferences(readMapPanelPreferences());
    setPanelPreferencesHydrated(true);
  }, []);

  useEffect(() => {
    if (!panelPreferencesHydrated) {
      return;
    }
    writeMapPanelPreferences(panelPreferences);
  }, [panelPreferences, panelPreferencesHydrated]);

  useEffect(() => {
    async function fetchSession() {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const payload = await readJsonResponse<SessionResponse | { error?: string }>(response);

      if (payload && "authenticated" in payload) {
        if (payload.authenticated) {
          setSession(payload);
          return;
        }

        setSession({ authenticated: true, user: null });
        setError(
          "Acumatica session check is temporarily unavailable. You are still signed in with your existing cookie. Refresh map data first; only sign in again if this keeps failing for a few minutes.",
        );
        return;
      }

      setSession({ authenticated: true, user: null });
      setError(
        "Acumatica session check is temporarily unavailable. You are still signed in with your existing cookie. Refresh map data first; only sign in again if this keeps failing for a few minutes.",
      );
    }

    fetchSession().catch(() => {
      setSession({ authenticated: true, user: null });
      setError(
        "Acumatica session check is temporarily unavailable. You are still signed in with your existing cookie. Refresh map data first; only sign in again if this keeps failing for a few minutes.",
      );
    });
  }, [router]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const controller = new AbortController();

    async function fetchMapData() {
      setLoading(true);
      setError(null);

      try {
        const datasetRows = readDatasetRows();
        const allAccountCandidates = buildAccountCandidates(datasetRows);
        const datasetAccountCount = allAccountCandidates.length;
        const effectiveLimit = datasetAccountCount
          ? Math.max(DEFAULT_LIMIT, Math.min(datasetAccountCount, MAX_LIMIT))
          : DEFAULT_LIMIT;
        const normalizedQuery = q.trim().toLowerCase();
        const lastSyncedAt = readDatasetSyncStamp() ?? "unsynced";
        const cacheKey = `${lastSyncedAt}|accounts:${datasetAccountCount}|limit:${effectiveLimit}|${normalizedQuery}`;
        const cached = readMapCache(cacheKey);
        if (cached) {
          setPoints(cached.items);
          setTotalCandidates(cached.totalCandidates);
          setGeocodedCount(cached.geocodedCount);
          setUnmappedCount(cached.unmappedCount);
          setActiveLimit(effectiveLimit);
          setSelectedId((current) =>
            cached.items.some((item) => item.id === current)
              ? current
              : cached.items[0]?.id ?? null,
          );
          return;
        }

        if (datasetRows.length === 0) {
          setPoints([]);
          setSelectedId(null);
          setTotalCandidates(0);
          setGeocodedCount(0);
          setUnmappedCount(0);
          setActiveLimit(effectiveLimit);
          setError(
            "No cached Accounts dataset found. Open Accounts and click Sync records first.",
          );
          return;
        }

        const filteredCandidates = normalizedQuery
          ? allAccountCandidates.filter((candidate) =>
              matchesCandidateQuery(candidate, normalizedQuery),
            )
          : allAccountCandidates;
        const candidates = filteredCandidates
          .filter((candidate) =>
            Boolean(
              candidate.representativeRow.id &&
                candidate.representativeRow.addressLine1.trim() &&
                candidate.representativeRow.city.trim(),
            ),
          )
          .slice(0, effectiveLimit);
        const geocodeStore = readGeocodeStore();
        const geocodeKeysMissing = [
          ...new Set(
            candidates
              .map((candidate) => buildAddressKeyFromRow(candidate.representativeRow))
              .filter((key) => key && !geocodeStore[key]),
          ),
        ];

        if (geocodeKeysMissing.length > 0) {
          const rowByAddressKey = new Map<string, BusinessAccountRow>();
          for (const candidate of candidates) {
            const key = buildAddressKeyFromRow(candidate.representativeRow);
            if (key && !rowByAddressKey.has(key)) {
              rowByAddressKey.set(key, candidate.representativeRow);
            }
          }

          const queue = [...geocodeKeysMissing];
          let storeChanged = false;

          async function worker() {
            while (queue.length > 0) {
              const key = queue.shift();
              if (!key || controller.signal.aborted) {
                return;
              }

              const row = rowByAddressKey.get(key);
              if (!row) {
                continue;
              }

              const geocode = await geocodeRowAddress(row, controller.signal).catch(
                () => null,
              );
              if (geocode && !controller.signal.aborted) {
                geocodeStore[key] = geocode;
                storeChanged = true;
              }
            }
          }

          await Promise.all(
            Array.from(
              { length: Math.min(GEOCODE_CONCURRENCY, queue.length) },
              () => worker(),
            ),
          );

          if (storeChanged && !controller.signal.aborted) {
            writeGeocodeStore(geocodeStore);
          }
        }

        if (controller.signal.aborted) {
          return;
        }

        const items: BusinessAccountMapPoint[] = [];
        candidates.forEach((candidate, index) => {
          const row = candidate.representativeRow;
          const key = buildAddressKeyFromRow(row);
          if (!key) {
            return;
          }

          const geocode = geocodeStore[key];
          if (!geocode) {
            return;
          }

          items.push({
            id: candidate.accountKey || row.accountRecordId || row.id || `account-${index}`,
            accountRecordId: row.accountRecordId ?? row.id,
            businessAccountId: row.businessAccountId,
            companyName: row.companyName,
            fullAddress: buildFullAddressFromRow(row),
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            city: row.city,
            state: row.state,
            postalCode: row.postalCode,
            country: row.country,
            primaryContactName: row.primaryContactName,
            primaryContactPhone: row.primaryContactPhone,
            primaryContactEmail: row.primaryContactEmail,
            category: row.category,
            notes: row.notes,
            lastModifiedIso: row.lastModifiedIso,
            latitude: geocode.latitude,
            longitude: geocode.longitude,
            geocodeProvider: geocode.provider,
            contacts: candidate.contacts,
          });
        });

        const payload: BusinessAccountMapResponse = {
          items,
          totalCandidates: candidates.length,
          geocodedCount: items.length,
          unmappedCount: candidates.length - items.length,
        };

        setPoints(payload.items);
        setTotalCandidates(payload.totalCandidates);
        setGeocodedCount(payload.geocodedCount);
        setUnmappedCount(payload.unmappedCount);
        setActiveLimit(effectiveLimit);
        writeMapCache(cacheKey, payload);
        setSelectedId((current) =>
          payload.items.some((item) => item.id === current) ? current : payload.items[0]?.id ?? null,
        );
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }

        setPoints([]);
        setSelectedId(null);
        setTotalCandidates(0);
        setGeocodedCount(0);
        setUnmappedCount(0);
        setError(requestError instanceof Error ? requestError.message : "Failed to load map data.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    const timeout = setTimeout(() => {
      void fetchMapData();
    }, 180);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [q, session]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const controller = new AbortController();

    async function fetchPostalRegions() {
      try {
        setPostalRegionsError(null);
        const response = await fetch("/api/business-accounts/map-regions", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<PostalRegionsResponse | { error?: string }>(
          response,
        );

        if (response.status === 401) {
          setPostalRegionsError(
            "Region layer is unavailable until your current session is accepted.",
          );
          return;
        }

        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        if (!isPostalRegionsResponse(payload)) {
          throw new Error("Unexpected response while loading postal regions.");
        }

        setPostalRegions(payload.items);
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }
        setPostalRegions([]);
        setPostalRegionsError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load postal-code regions.",
        );
      }
    }

    void fetchPostalRegions();

    return () => {
      controller.abort();
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      if (mapRef.current || !mapContainerRef.current) {
        return;
      }

      const L = await import("leaflet");
      if (cancelled || !mapContainerRef.current || mapRef.current) {
        return;
      }

      leafletRef.current = L;
      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 6,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const regionLayer = L.layerGroup().addTo(map);
      const markerLayer = L.layerGroup().addTo(map);
      mapRef.current = map;
      regionsLayerRef.current = regionLayer;
      markersLayerRef.current = markerLayer;
      setTimeout(() => map.invalidateSize(), 100);
    }

    void initializeMap();

    return () => {
      cancelled = true;
      regionsLayerRef.current?.clearLayers();
      markersLayerRef.current?.clearLayers();
      mapRef.current?.remove();
      mapRef.current = null;
      regionsLayerRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const regionsLayer = regionsLayerRef.current;
    if (!L || !regionsLayer) {
      return;
    }

    regionsLayer.clearLayers();
    for (const region of postalRegions) {
      const weight = Math.max(0.5, region.strokeWidth || 1);
      const fillOpacity = Math.min(Math.max(region.fillOpacity || 0.15, 0.05), 0.65);
      const strokeOpacity = Math.min(Math.max(region.strokeOpacity || 0.7, 0.1), 1);

      for (const polygon of region.polygons) {
        if (polygon.length < 3) {
          continue;
        }

        L.polygon(polygon, {
          color: region.strokeColor || "#0D47A1",
          weight,
          opacity: strokeOpacity,
          fillColor: region.fillColor || "#42A5F5",
          fillOpacity,
          interactive: false,
        }).addTo(regionsLayer);
      }
    }
  }, [postalRegions]);

  useEffect(() => {
    const L = leafletRef.current;
    const markerLayer = markersLayerRef.current;
    if (!L || !markerLayer) {
      return;
    }

    markerLayer.clearLayers();

    if (points.length === 0) {
      return;
    }

    for (const point of points) {
      const isSelected = selectedPoint?.id === point.id;
      const circle = L.circleMarker([point.latitude, point.longitude], {
        radius: isSelected ? 10 : 8,
        color: "#ffffff",
        weight: 2,
        fillColor: markerColor(point.category),
        fillOpacity: 0.94,
      });

      circle.bindTooltip(point.companyName || point.businessAccountId, {
        direction: "top",
        offset: [0, -8],
      });
      circle.on("click", () => {
        setSelectedId(point.id);
      });
      circle.addTo(markerLayer);
    }
  }, [points, selectedPoint]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) {
      return;
    }

    if (points.length === 0) {
      if (postalRegions.length > 0) {
        const regionBounds = L.latLngBounds([]);
        for (const region of postalRegions) {
          for (const polygon of region.polygons) {
            for (const coordinate of polygon) {
              regionBounds.extend(coordinate);
            }
          }
        }

        if (regionBounds.isValid()) {
          map.fitBounds(regionBounds.pad(0.06));
          return;
        }
      }

      map.setView(DEFAULT_CENTER, 6);
      return;
    }

    const bounds = L.latLngBounds([]);

    for (const point of points) {
      bounds.extend([point.latitude, point.longitude]);
    }

    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 12);
    } else {
      map.fitBounds(bounds.pad(0.18));
    }
  }, [points, postalRegions]);

  function startEditingContact(contact: MapContactSummary) {
    setContactActionError(null);
    setEditingContactRowKey(contact.rowKey);
    setContactDrafts((current) => ({
      ...current,
      [contact.rowKey]: buildContactDraft(contact),
    }));
  }

  function cancelEditingContact(rowKey: string) {
    setEditingContactRowKey((current) => (current === rowKey ? null : current));
    setContactDrafts((current) => {
      if (!(rowKey in current)) {
        return current;
      }

      const next = { ...current };
      delete next[rowKey];
      return next;
    });
  }

  function updateContactDraft(
    rowKey: string,
    field: keyof MapContactDraft,
    value: string,
  ) {
    setContactDrafts((current) => {
      const existing = current[rowKey] ?? {
        name: "",
        phone: "",
        email: "",
        notes: "",
      };

      return {
        ...current,
        [rowKey]: {
          ...existing,
          [field]: field === "phone" ? formatPhoneDraftValue(value) : value,
        },
      };
    });
  }

  function updatePanelPreference(
    key: keyof MapPanelPreferences,
    value: boolean,
  ) {
    setPanelPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function applyFocusedView() {
    setPanelPreferences((current) => buildFocusedDetailPreferences(current));
  }

  function applyAllDetailsView() {
    setPanelPreferences((current) => buildAllDetailPreferences(current));
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/signin");
    router.refresh();
  }

  async function handleSaveContactEdits(contact: MapContactSummary) {
    if (!selectedPoint) {
      return;
    }

    if (contact.contactId === null || contact.contactId === undefined) {
      setContactActionError("Contact must have ContactID before it can be edited.");
      return;
    }

    const contactDraft = contactDrafts[contact.rowKey];
    if (!contactDraft) {
      return;
    }

    if (
      contactDraft.phone.trim().length > 0 &&
      normalizePhoneForSave(contactDraft.phone) === null
    ) {
      setContactActionError("Phone number must use the format ###-###-####.");
      return;
    }

    const datasetEntry = readDatasetEntry();
    const datasetRows = datasetEntry?.dataset.rows ?? [];
    const accountRows = datasetRows.filter((row) => rowBelongsToPoint(row, selectedPoint));
    const targetRow =
      accountRows.find((row) => row.rowKey === contact.rowKey) ??
      accountRows.find(
        (row) =>
          row.contactId !== null &&
          row.contactId !== undefined &&
          row.contactId === contact.contactId,
      ) ??
      null;

    if (!targetRow) {
      setContactActionError(
        "No cached account row found for this contact. Open Accounts and sync records first.",
      );
      return;
    }

    const accountRecordId =
      targetRow.accountRecordId ??
      selectedPoint.accountRecordId ??
      selectedPoint.id;

    setUpdatingContactRowKey(contact.rowKey);
    setContactActionMode("save");
    setContactActionError(null);

    try {
      const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildMapContactUpdateRequest(targetRow, selectedPoint, {
            targetContactId: contact.contactId,
            primaryContactName: contactDraft.name.trim() || null,
            primaryContactPhone: contactDraft.phone.trim() || null,
            primaryContactEmail: contactDraft.email.trim() || null,
            notes: contactDraft.notes.trim() || null,
          }),
        ),
      });
      const payload = await readJsonResponse<BusinessAccountRow | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isBusinessAccountRow(payload)) {
        throw new Error("Unexpected response while updating contact.");
      }

      const updatedRows = updateRowsAfterContactSave(
        datasetRows,
        selectedPoint,
        payload,
        contact.contactId,
      );
      writeDatasetRows(updatedRows, datasetEntry?.dataset.lastSyncedAt ?? null);
      clearMapCache();

      const nextAccountRows = updatedRows.filter((row) => rowBelongsToPoint(row, selectedPoint));
      setPoints((currentPoints) =>
        currentPoints.map((point) =>
          point.id === selectedPoint.id ? buildPointFromRows(point, nextAccountRows) : point,
        ),
      );
      cancelEditingContact(contact.rowKey);
    } catch (requestError) {
      setContactActionError(
        requestError instanceof Error ? requestError.message : "Failed to update contact.",
      );
    } finally {
      setUpdatingContactRowKey(null);
      setContactActionMode(null);
    }
  }

  async function handleDeleteContact(contact: MapContactSummary) {
    if (!selectedPoint) {
      return;
    }

    if (contact.contactId === null || contact.contactId === undefined) {
      setContactActionError("Contact must have ContactID before it can be deleted.");
      return;
    }

    const contactLabel = contact.name?.trim() || `Contact ${contact.contactId}`;
    const confirmed = window.confirm(
      `Delete ${contactLabel} from Acumatica? This permanently removes the contact.`,
    );
    if (!confirmed) {
      return;
    }

    const datasetEntry = readDatasetEntry();
    const datasetRows = datasetEntry?.dataset.rows ?? [];
    const accountRows = datasetRows.filter((row) => rowBelongsToPoint(row, selectedPoint));
    const accountRecordId =
      selectedPoint.accountRecordId ??
      accountRows[0]?.accountRecordId ??
      accountRows[0]?.id ??
      selectedPoint.id;

    setUpdatingContactRowKey(contact.rowKey);
    setContactActionMode("delete");
    setContactActionError(null);

    try {
      const deleteResponse = await fetch(`/api/contacts/${contact.contactId}`, {
        method: "DELETE",
      });
      const deletePayload = await readJsonResponse<{ error?: string }>(deleteResponse);
      if (!deleteResponse.ok) {
        throw new Error(parseError(deletePayload));
      }

      let nextAccountRows: BusinessAccountRow[] | null = null;

      try {
        const refreshResponse = await fetch(`/api/business-accounts/${accountRecordId}`, {
          cache: "no-store",
        });
        const refreshPayload = await readJsonResponse<
          BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
        >(refreshResponse);
        if (!refreshResponse.ok) {
          throw new Error(parseError(refreshPayload));
        }

        nextAccountRows =
          readDetailRows(refreshPayload) ??
          (() => {
            const refreshedRow = isBusinessAccountDetailResponse(refreshPayload)
              ? refreshPayload.row
              : isBusinessAccountRow(refreshPayload)
                ? refreshPayload
                : null;
            return refreshedRow ? [refreshedRow] : null;
          })();
      } catch {
        nextAccountRows = removeDeletedContactFromAccountRows(
          accountRows,
          contact.contactId,
          contact.rowKey,
        );
        setContactActionError(
          "Contact deleted in Acumatica. The account refresh failed, so the local view was updated conservatively.",
        );
      }

      const updatedRows = replaceRowsForPoint(
        datasetRows,
        selectedPoint,
        nextAccountRows ?? [],
      );
      writeDatasetRows(updatedRows, datasetEntry?.dataset.lastSyncedAt ?? null);
      clearMapCache();

      const pointRows =
        nextAccountRows && nextAccountRows.length > 0
          ? nextAccountRows
          : updatedRows.filter((row) => rowBelongsToPoint(row, selectedPoint));
      setPoints((currentPoints) =>
        currentPoints.map((point) =>
          point.id === selectedPoint.id ? buildPointFromRows(point, pointRows) : point,
        ),
      );
      cancelEditingContact(contact.rowKey);
    } catch (requestError) {
      setContactActionError(
        requestError instanceof Error ? requestError.message : "Failed to delete contact.",
      );
    } finally {
      setUpdatingContactRowKey(null);
      setContactActionMode(null);
    }
  }

  async function handleMakePrimaryContact(contact: MapContactSummary) {
    if (!selectedPoint) {
      return;
    }

    if (contact.contactId === null || contact.contactId === undefined) {
      setContactActionError("Contact must have ContactID to set as primary.");
      return;
    }

    const datasetEntry = readDatasetEntry();
    const datasetRows = datasetEntry?.dataset.rows ?? [];
    const accountRows = datasetRows.filter((row) => rowBelongsToPoint(row, selectedPoint));
    const representativeRow = pickRepresentativeRow(accountRows);
    const targetRow =
      accountRows.find((row) => row.rowKey === contact.rowKey) ??
      accountRows.find(
        (row) =>
          row.contactId !== null &&
          row.contactId !== undefined &&
          row.contactId === contact.contactId,
      ) ??
      representativeRow;

    if (!targetRow) {
      setContactActionError(
        "No cached account row found for this contact. Open Accounts and sync records first.",
      );
      return;
    }

    const accountRecordId =
      targetRow.accountRecordId ??
      selectedPoint.accountRecordId ??
      selectedPoint.id;

    setUpdatingContactRowKey(contact.rowKey);
    setContactActionMode("primary");
    setContactActionError(null);

    try {
      const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildMapContactUpdateRequest(targetRow, selectedPoint, {
            targetContactId: contact.contactId,
            setAsPrimaryContact: true,
            primaryContactName: contact.name ?? targetRow.primaryContactName,
            primaryContactPhone: contact.phone ?? targetRow.primaryContactPhone,
            primaryContactEmail: contact.email ?? targetRow.primaryContactEmail,
            notes: contact.notes ?? targetRow.notes,
          }),
        ),
      });
      const payload = await readJsonResponse<BusinessAccountRow | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isBusinessAccountRow(payload)) {
        throw new Error("Unexpected response while updating primary contact.");
      }

      const updatedRows = updateRowsAfterContactSave(
        datasetRows,
        selectedPoint,
        payload,
        contact.contactId,
      );
      writeDatasetRows(updatedRows, datasetEntry?.dataset.lastSyncedAt ?? null);
      clearMapCache();

      const nextAccountRows = updatedRows.filter((row) => rowBelongsToPoint(row, selectedPoint));
      setPoints((currentPoints) =>
        currentPoints.map((point) =>
          point.id === selectedPoint.id ? buildPointFromRows(point, nextAccountRows) : point,
        ),
      );
    } catch (requestError) {
      setContactActionError(
        requestError instanceof Error ? requestError.message : "Failed to update primary contact.",
      );
    } finally {
      setUpdatingContactRowKey(null);
      setContactActionMode(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Image alt="MeadowBrook" className={styles.brandLogo} height={202} priority src="/mb-logo.png" width={712} />
          <div>
            <p className={styles.kicker}>Business Accounts Map</p>
            <h1 className={styles.title}>Contacts Location View</h1>
          </div>
        </div>
        <div className={styles.actions}>
          <input
            className={styles.searchInput}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search company, contact, address"
            value={q}
          />
          <Link className={styles.navButton} href="/accounts">
            Back To Accounts
          </Link>
          <Link className={styles.navButton} href="/quality">
            Data quality
          </Link>
          <button className={styles.navButton} onClick={handleLogout} type="button">
            Sign out
          </button>
          <span className={styles.userName}>{session?.user?.name ?? "Signed in"}</span>
        </div>
      </header>

      <section className={styles.mapShell}>
        <div className={styles.mapCanvas} ref={mapContainerRef} />

        <aside className={styles.infoPanel}>
          <div className={styles.panelToolbar}>
            <div className={styles.panelModeText}>
              <strong>{visibleDetailCount} field{visibleDetailCount === 1 ? "" : "s"} enabled</strong>
              <span>{panelPreferences.hideEmptyFields ? "Empty values hidden" : "Showing empty values"}</span>
            </div>
            <details className={styles.viewOptionsMenu}>
              <summary className={styles.viewOptionsSummary}>View options</summary>
              <div className={styles.viewOptionsPanel}>
                <div className={styles.viewOptionsActions}>
                  <button onClick={applyFocusedView} type="button">
                    Focused
                  </button>
                  <button onClick={applyAllDetailsView} type="button">
                    All details
                  </button>
                </div>
                <label className={styles.viewOptionItem}>
                  <input
                    checked={panelPreferences.summaryStats}
                    onChange={(event) =>
                      updatePanelPreference("summaryStats", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>Show map summary</span>
                </label>
                <label className={styles.viewOptionItem}>
                  <input
                    checked={panelPreferences.hideEmptyFields}
                    onChange={(event) =>
                      updatePanelPreference("hideEmptyFields", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>Hide empty fields</span>
                </label>
                <div className={styles.viewOptionsList}>
                  {DETAIL_FIELD_DEFINITIONS.map((field) => (
                    <label className={styles.viewOptionItem} key={field.key}>
                      <input
                        checked={panelPreferences[field.key]}
                        onChange={(event) =>
                          updatePanelPreference(field.key, event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          </div>

          {panelPreferences.summaryStats ? (
            <div className={styles.stats}>
              <span>Limit: {activeLimit}</span>
              <span>Account Candidates: {totalCandidates}</span>
              <span>Mapped Accounts: {geocodedCount}</span>
              <span>Unmapped Accounts: {unmappedCount}</span>
              <span>Postal Regions: {postalRegions.length}</span>
            </div>
          ) : null}

          {loading ? <p className={styles.loadingText}>Loading map data...</p> : null}
          {error ? <p className={styles.errorText}>{error}</p> : null}
          {postalRegionsError ? <p className={styles.errorText}>{postalRegionsError}</p> : null}

          {!loading && !error && !selectedPoint ? (
            <p className={styles.loadingText}>No mapped business accounts found for this filter.</p>
          ) : null}

          {selectedPoint ? (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleBlock}>
                  <h2>{selectedPoint.companyName || selectedPoint.businessAccountId}</h2>
                  <p className={styles.cardSubtitle}>
                    Focus this panel on the fields you need for contact cleanup.
                  </p>
                </div>
              </div>

              {selectedDetailItems.length > 0 ? (
                <dl className={styles.details}>
                  {selectedDetailItems.map((item) => (
                    <div key={item.key}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className={styles.hiddenDetailsNotice}>
                  All account detail fields are hidden. Use `View options` to show them again.
                </p>
              )}

              <section className={styles.contactsSection}>
                <h3>Account Contacts</h3>
                {contactActionError ? <p className={styles.errorText}>{contactActionError}</p> : null}
                {selectedContacts.length === 0 ? (
                  <p className={styles.noContacts}>No contacts on this business account.</p>
                ) : (
                  <ul className={styles.contactList}>
                    {selectedContacts.map((contact, index) => {
                      const isEditing = editingContactRowKey === contact.rowKey;
                      const draft = contactDrafts[contact.rowKey] ?? buildContactDraft(contact);
                      const canMutateContact =
                        contact.contactId !== null && contact.contactId !== undefined;

                      return (
                        <li
                          className={styles.contactItem}
                          key={contact.rowKey || `${contact.contactId ?? "row"}-${index}`}
                        >
                          <div className={styles.contactHeader}>
                            <strong>{renderText(contact.name)}</strong>
                            {contact.isPrimary ? (
                              <span className={styles.primaryBadge}>PRIMARY</span>
                            ) : null}
                          </div>

                          {isEditing ? (
                            <div className={styles.contactEditor}>
                              <label className={styles.contactField}>
                                Name
                                <input
                                  disabled={updatingContactRowKey !== null}
                                  onChange={(event) =>
                                    updateContactDraft(
                                      contact.rowKey,
                                      "name",
                                      event.target.value,
                                    )
                                  }
                                  value={draft.name}
                                />
                              </label>
                              <label className={styles.contactField}>
                                Phone
                                <input
                                  disabled={updatingContactRowKey !== null}
                                  inputMode="numeric"
                                  maxLength={12}
                                  onChange={(event) =>
                                    updateContactDraft(
                                      contact.rowKey,
                                      "phone",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="123-456-7890"
                                  title="Phone number must use the format ###-###-####."
                                  value={draft.phone}
                                />
                              </label>
                              <label className={styles.contactField}>
                                Email
                                <input
                                  disabled={updatingContactRowKey !== null}
                                  onChange={(event) =>
                                    updateContactDraft(
                                      contact.rowKey,
                                      "email",
                                      event.target.value,
                                    )
                                  }
                                  value={draft.email}
                                />
                              </label>
                              <label className={styles.contactField}>
                                Notes
                                <textarea
                                  disabled={updatingContactRowKey !== null}
                                  onChange={(event) =>
                                    updateContactDraft(
                                      contact.rowKey,
                                      "notes",
                                      event.target.value,
                                    )
                                  }
                                  rows={3}
                                  value={draft.notes}
                                />
                              </label>
                            </div>
                          ) : (
                            <>
                              <p>{renderText(contact.phone)}</p>
                              <p>{renderText(contact.email)}</p>
                              {contact.notes?.trim() ? <p>{contact.notes}</p> : null}
                            </>
                          )}

                          <div className={styles.contactActions}>
                            {isEditing ? (
                              <>
                                <button
                                  className={styles.contactSaveButton}
                                  disabled={updatingContactRowKey !== null}
                                  onClick={() => {
                                    void handleSaveContactEdits(contact);
                                  }}
                                  type="button"
                                >
                                  {updatingContactRowKey === contact.rowKey &&
                                  contactActionMode === "save"
                                    ? "Saving..."
                                    : "Save"}
                                </button>
                                <button
                                  className={styles.contactSecondaryButton}
                                  disabled={updatingContactRowKey !== null}
                                  onClick={() => {
                                    cancelEditingContact(contact.rowKey);
                                  }}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                className={styles.contactSecondaryButton}
                                disabled={updatingContactRowKey !== null || !canMutateContact}
                                onClick={() => {
                                  startEditingContact(contact);
                                }}
                                type="button"
                              >
                                Edit
                              </button>
                            )}

                            {!contact.isPrimary ? (
                              <button
                                className={styles.makePrimaryButton}
                                disabled={updatingContactRowKey !== null || !canMutateContact}
                                onClick={() => {
                                  void handleMakePrimaryContact(contact);
                                }}
                                type="button"
                              >
                                {updatingContactRowKey === contact.rowKey &&
                                contactActionMode === "primary"
                                  ? "Saving..."
                                  : "Make Primary"}
                              </button>
                            ) : null}

                            <button
                              className={styles.contactDeleteButton}
                              disabled={updatingContactRowKey !== null || !canMutateContact}
                              onClick={() => {
                                void handleDeleteContact(contact);
                              }}
                              type="button"
                            >
                              {updatingContactRowKey === contact.rowKey &&
                              contactActionMode === "delete"
                                ? "Deleting..."
                                : "Delete contact"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
