"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { getAppBranding } from "@/lib/app-variant";
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
import {
  buildAcumaticaBusinessAccountUrl,
  buildAcumaticaContactUrl,
} from "@/lib/acumatica-links";
import { enforceSinglePrimaryPerAccountRows } from "@/lib/business-accounts";
import { buildBusinessAccountConcurrencySnapshot } from "@/lib/business-account-concurrency";
import {
  readCachedDatasetFromStorage,
  readCachedSyncMeta,
  writeCachedDatasetToStorage,
} from "@/lib/client-dataset-cache";
import { formatPhoneDraftValue, normalizePhoneForSave } from "@/lib/phone";
import { CallPhoneButton } from "@/components/call-phone-button";
import {
  QueueDeleteContactsModal,
  type QueueDeleteContactTarget,
} from "@/components/queue-delete-contacts-modal";

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
const appBranding = getAppBranding();
const MAP_CACHE_STORAGE_KEY = `businessAccounts.mapCache.v5.${appBranding.storageNamespace}`;
const MAP_PANEL_PREFERENCES_STORAGE_KEY =
  `businessAccounts.mapPanelPrefs.v2.${appBranding.storageNamespace}`;

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

type SalesRepFilterOption = {
  key: string;
  label: string;
  count: number;
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

function normalizeTextToken(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase();
}

function buildSalesRepFilterKey(point: Pick<BusinessAccountMapPoint, "salesRepId" | "salesRepName">): string {
  if (hasText(point.salesRepId)) {
    return `id:${normalizeTextToken(point.salesRepId)}`;
  }

  if (hasText(point.salesRepName)) {
    return `name:${normalizeTextToken(point.salesRepName)}`;
  }

  return "unassigned";
}

function renderSalesRepLabel(value: string | null | undefined): string {
  return hasText(value) ? value.trim() : "Unassigned";
}

function buildSalesRepFilterSummary(
  selectedKeys: string[],
  options: SalesRepFilterOption[],
): string {
  if (selectedKeys.length === 0) {
    return "All";
  }

  if (selectedKeys.length === 1) {
    return options.find((option) => option.key === selectedKeys[0])?.label ?? "1 selected";
  }

  return `${selectedKeys.length} selected`;
}

function buildSalesRepFilterOptionsFromRows(
  rows: BusinessAccountRow[],
): SalesRepFilterOption[] {
  const grouped = new Map<
    string,
    SalesRepFilterOption & {
      accountKeys: Set<string>;
    }
  >();

  for (const row of rows) {
    const key = buildSalesRepFilterKey(row);
    const accountKey = readRowAccountKey(row);
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.accountKeys.has(accountKey)) {
        existing.accountKeys.add(accountKey);
        existing.count += 1;
      }
      continue;
    }

    grouped.set(key, {
      key,
      label: renderSalesRepLabel(row.salesRepName ?? row.salesRepId),
      count: 1,
      accountKeys: new Set([accountKey]),
    });
  }

  return [...grouped.values()]
    .map(({ accountKeys: _accountKeys, ...option }) => option)
    .sort((left, right) => {
      if (left.label === "Unassigned" && right.label !== "Unassigned") {
        return 1;
      }

      if (right.label === "Unassigned" && left.label !== "Unassigned") {
        return -1;
      }

      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    });
}

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

function pickSalesRepRow(rows: BusinessAccountRow[]): BusinessAccountRow {
  return rows.find((row) => hasText(row.salesRepId) || hasText(row.salesRepName)) ?? rows[0];
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
      companyPhone: updatedRow.companyPhone ?? row.companyPhone,
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
  const salesRepRow = pickSalesRepRow(rows);
  const primaryRow = rows.find((row) => row.isPrimaryContact) ?? representativeRow;

  return {
    ...point,
    accountRecordId:
      representativeRow.accountRecordId ?? representativeRow.id ?? point.accountRecordId,
    businessAccountId: representativeRow.businessAccountId || point.businessAccountId,
    companyName: representativeRow.companyName || point.companyName,
    salesRepId: salesRepRow.salesRepId ?? point.salesRepId,
    salesRepName: salesRepRow.salesRepName ?? point.salesRepName,
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
    assignedBusinessAccountRecordId:
      targetRow.businessAccountId.trim().length > 0
        ? (targetRow.accountRecordId ?? targetRow.id)
        : null,
    assignedBusinessAccountId: targetRow.businessAccountId.trim() || null,
    addressLine1: targetRow.addressLine1,
    addressLine2: targetRow.addressLine2,
    city: targetRow.city,
    state: targetRow.state,
    postalCode: targetRow.postalCode,
    country: targetRow.country,
    targetContactId,
    setAsPrimaryContact: false,
    primaryOnlyIntent: false,
    salesRepId: targetRow.salesRepId,
    salesRepName: targetRow.salesRepName,
    industryType: targetRow.industryType,
    subCategory: targetRow.subCategory,
    companyRegion: targetRow.companyRegion,
    week: targetRow.week,
    companyPhone: targetRow.companyPhone ?? null,
    primaryContactName: targetRow.primaryContactName,
    primaryContactPhone: targetRow.primaryContactPhone,
    primaryContactEmail: targetRow.primaryContactEmail,
    category: targetRow.category,
    notes: targetRow.notes,
    expectedLastModified: targetRow.lastModifiedIso ?? point.lastModifiedIso,
    baseSnapshot: buildBusinessAccountConcurrencySnapshot(targetRow),
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
  return readCachedSyncMeta().lastSyncedAt;
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

function readDatasetEntry(): { storageKey: string; dataset: CachedDataset } | null {
  const dataset = readCachedDatasetFromStorage();
  if (!dataset) {
    return null;
  }

  return {
    storageKey: "memory",
    dataset,
  };
}

function writeDatasetRows(rows: BusinessAccountRow[], lastSyncedAt: string | null) {
  writeCachedDatasetToStorage({
    rows,
    lastSyncedAt,
  });
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

export function AccountsMapClient({
  acumaticaBaseUrl,
  acumaticaCompanyId,
}: {
  acumaticaBaseUrl: string;
  acumaticaCompanyId: string;
}) {
  const router = useRouter();

  const [cachedDatasetRows, setCachedDatasetRows] = useState<BusinessAccountRow[]>([]);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [q, setQ] = useState("");
  const [salesRepFilterOpen, setSalesRepFilterOpen] = useState(false);
  const [salesRepFilterQuery, setSalesRepFilterQuery] = useState("");
  const [selectedSalesRepKeys, setSelectedSalesRepKeys] = useState<string[]>([]);
  const [points, setPoints] = useState<BusinessAccountMapPoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [geocodedCount, setGeocodedCount] = useState(0);
  const [unmappedCount, setUnmappedCount] = useState(0);
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
  const [deleteQueueContact, setDeleteQueueContact] = useState<MapContactSummary | null>(null);
  const [panelPreferences, setPanelPreferences] = useState<MapPanelPreferences>(
    DEFAULT_MAP_PANEL_PREFERENCES,
  );
  const [panelPreferencesHydrated, setPanelPreferencesHydrated] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const regionsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const markersLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const viewportFitSignatureRef = useRef<string | null>(null);

  const selectedSalesRepFilterKeys = useMemo(
    () => [...selectedSalesRepKeys].sort(),
    [selectedSalesRepKeys],
  );
  const salesRepOptions = useMemo(() => {
    if (cachedDatasetRows.length > 0) {
      return buildSalesRepFilterOptionsFromRows(cachedDatasetRows);
    }

    const grouped = new Map<string, SalesRepFilterOption>();

    for (const point of points) {
      const key = buildSalesRepFilterKey(point);
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }

      grouped.set(key, {
        key,
        label: renderSalesRepLabel(point.salesRepName ?? point.salesRepId),
        count: 1,
      });
    }

    return [...grouped.values()].sort((left, right) => {
      if (left.label === "Unassigned" && right.label !== "Unassigned") {
        return 1;
      }

      if (right.label === "Unassigned" && left.label !== "Unassigned") {
        return -1;
      }

      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    });
  }, [cachedDatasetRows, points]);
  const visibleSalesRepOptions = useMemo(() => {
    const normalizedQuery = normalizeTextToken(salesRepFilterQuery);
    if (!normalizedQuery) {
      return salesRepOptions;
    }

    return salesRepOptions.filter((option) =>
      option.label.toLowerCase().includes(normalizedQuery),
    );
  }, [salesRepFilterQuery, salesRepOptions]);
  const filteredPoints = useMemo(() => {
    if (selectedSalesRepKeys.length === 0) {
      return points;
    }

    const selectedKeys = new Set(selectedSalesRepKeys);
    return points.filter((point) => selectedKeys.has(buildSalesRepFilterKey(point)));
  }, [points, selectedSalesRepKeys]);
  const salesRepFilterSummary = useMemo(
    () => buildSalesRepFilterSummary(selectedSalesRepKeys, salesRepOptions),
    [salesRepOptions, selectedSalesRepKeys],
  );
  const hasActiveSalesRepFilters = selectedSalesRepKeys.length > 0;
  const selectedPoint = useMemo(
    () => filteredPoints.find((point) => point.id === selectedId) ?? filteredPoints[0] ?? null,
    [filteredPoints, selectedId],
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
    function syncCachedDatasetRows() {
      setCachedDatasetRows(readDatasetEntry()?.dataset.rows ?? []);
    }

    syncCachedDatasetRows();
    window.addEventListener("businessAccounts:dataset-updated", syncCachedDatasetRows);

    return () => {
      window.removeEventListener("businessAccounts:dataset-updated", syncCachedDatasetRows);
    };
  }, []);

  useEffect(() => {
    setUpdatingContactRowKey(null);
    setContactActionMode(null);
    setEditingContactRowKey(null);
    setContactDrafts({});
    setContactActionError(null);
  }, [selectedPoint?.id]);

  useEffect(() => {
    const optionKeys = new Set(salesRepOptions.map((option) => option.key));
    setSelectedSalesRepKeys((current) => current.filter((key) => optionKeys.has(key)));
  }, [salesRepOptions]);

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
          setError(null);
          return;
        }

        setSession(payload);
        setError(
          "Your Acumatica session has expired. Sign in again to refresh map data.",
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
        const normalizedQuery = q.trim().toLowerCase();
        const lastSyncedAt = readDatasetSyncStamp() ?? "unsynced";
        const salesRepCacheToken = selectedSalesRepFilterKeys.join(",");
        const cacheKey = `${lastSyncedAt}|scope:all|${normalizedQuery}|sales-reps:${salesRepCacheToken}`;
        const cached = readMapCache(cacheKey);
        if (cached) {
          setPoints(cached.items);
          setTotalCandidates(cached.totalCandidates);
          setGeocodedCount(cached.geocodedCount);
          setUnmappedCount(cached.unmappedCount);
          setSelectedId((current) =>
            cached.items.some((item) => item.id === current)
              ? current
              : cached.items[0]?.id ?? null,
          );
          return;
        }

        const params = new URLSearchParams();
        if (normalizedQuery) {
          params.set("q", normalizedQuery);
        }
        for (const salesRepKey of selectedSalesRepFilterKeys) {
          params.append("salesRep", salesRepKey);
        }
        if (lastSyncedAt !== "unsynced") {
          params.set("syncedAt", lastSyncedAt);
        }

        const response = await fetch(`/api/business-accounts/map?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<BusinessAccountMapResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isMapResponse(payload)) {
          throw new Error("Unexpected response while loading map data.");
        }

        setPoints(payload.items);
        setTotalCandidates(payload.totalCandidates);
        setGeocodedCount(payload.geocodedCount);
        setUnmappedCount(payload.unmappedCount);
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
  }, [q, selectedSalesRepFilterKeys, session]);

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
      viewportFitSignatureRef.current = null;
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

    if (filteredPoints.length === 0) {
      return;
    }

    for (const point of filteredPoints) {
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
  }, [filteredPoints, selectedPoint]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) {
      return;
    }

    const nextViewportSignature =
      filteredPoints.length > 0
        ? filteredPoints
            .map((point) => `${point.id}:${point.latitude}:${point.longitude}`)
            .join("|")
        : `regions:${postalRegions
            .map((region) => `${region.id}:${region.polygons.length}`)
            .join("|")}`;

    if (viewportFitSignatureRef.current === nextViewportSignature) {
      return;
    }

    viewportFitSignatureRef.current = nextViewportSignature;

    if (filteredPoints.length === 0) {
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

    for (const point of filteredPoints) {
      bounds.extend([point.latitude, point.longitude]);
    }

    if (filteredPoints.length === 1) {
      map.setView([filteredPoints[0].latitude, filteredPoints[0].longitude], 12);
    } else {
      map.fitBounds(bounds.pad(0.18));
    }
  }, [filteredPoints, postalRegions]);

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

  function toggleSalesRepFilter(key: string) {
    setSelectedSalesRepKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function clearSalesRepFilters() {
    setSelectedSalesRepKeys([]);
  }

  function selectAllVisibleSalesRepFilters() {
    setSelectedSalesRepKeys(visibleSalesRepOptions.map((option) => option.key));
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
    setDeleteQueueContact(contact);
  }

  async function handleConfirmDeleteContact(reason: string) {
    if (!selectedPoint || !deleteQueueContact) {
      return;
    }

    const contact = deleteQueueContact;
    const contactId = contact.contactId;
    if (contactId === null || contactId === undefined) {
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
      const deleteResponse = await fetch(`/api/contacts/${contactId}?source=map`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason }),
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
          contactId,
          contact.rowKey,
        );
        setContactActionError(
          "Contact queued for deletion. The account refresh failed, so the local view was updated conservatively.",
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
      setDeleteQueueContact(null);
    } catch (requestError) {
      setContactActionError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to queue contact deletion.",
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
    <AppChrome
      contentClassName={styles.pageContent}
      subtitle={appBranding.mapSubtitle}
      title="Contacts Location View"
      userName={session?.user?.name ?? "Signed in"}
    >

      <QueueDeleteContactsModal
        isOpen={Boolean(deleteQueueContact)}
        isSubmitting={
          contactActionMode === "delete" &&
          deleteQueueContact !== null &&
          updatingContactRowKey === deleteQueueContact.rowKey
        }
        onClose={() => {
          if (contactActionMode === "delete") {
            return;
          }
          setDeleteQueueContact(null);
        }}
        onConfirm={handleConfirmDeleteContact}
        targets={
          deleteQueueContact
            ? [
                {
                  key: deleteQueueContact.rowKey,
                  contactName: deleteQueueContact.name,
                  companyName: selectedPoint?.companyName ?? null,
                } satisfies QueueDeleteContactTarget,
              ]
            : []
        }
      />

      <section className={styles.filtersBar}>
        <div className={styles.filtersToolbar}>
          <input
            className={styles.searchInput}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search company, contact, address"
            value={q}
          />
          <div className={styles.headerFilters}>
            <button
              className={styles.salesRepToggle}
              onClick={() => setSalesRepFilterOpen((current) => !current)}
              type="button"
            >
              Sales reps: {salesRepFilterSummary}
            </button>
            {hasActiveSalesRepFilters ? (
              <button
                className={styles.clearInlineButton}
                onClick={clearSalesRepFilters}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {salesRepFilterOpen ? (
          <div className={styles.salesRepFilterCard}>
            <div className={styles.salesRepFilterCardHeader}>
              <div className={styles.salesRepFilterCardCopy}>
                <strong>Sales reps</strong>
                <span>{salesRepFilterSummary}</span>
              </div>
              <div className={styles.salesRepFilterActions}>
                <button onClick={selectAllVisibleSalesRepFilters} type="button">
                  All visible
                </button>
                <button onClick={clearSalesRepFilters} type="button">
                  Clear
                </button>
              </div>
            </div>
            <input
              className={styles.salesRepFilterSearch}
              onChange={(event) => setSalesRepFilterQuery(event.target.value)}
              placeholder="Filter sales reps"
              value={salesRepFilterQuery}
            />
            <div className={styles.salesRepFilterList}>
              {visibleSalesRepOptions.length > 0 ? (
                visibleSalesRepOptions.map((option) => (
                  <label className={styles.viewOptionItem} key={option.key}>
                    <input
                      checked={selectedSalesRepKeys.includes(option.key)}
                      onChange={() => toggleSalesRepFilter(option.key)}
                      type="checkbox"
                    />
                    <span>
                      {option.label} ({option.count})
                    </span>
                  </label>
                ))
              ) : (
                <p className={styles.salesRepFilterEmpty}>No sales reps match this search.</p>
              )}
            </div>
          </div>
        ) : null}
      </section>

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
              <span>Account Candidates: {totalCandidates}</span>
              <span>Mapped Accounts: {geocodedCount}</span>
              <span>Visible Pins: {filteredPoints.length}</span>
              <span>Unmapped Accounts: {unmappedCount}</span>
              <span>Postal Regions: {postalRegions.length}</span>
            </div>
          ) : null}

          {loading ? <p className={styles.loadingText}>Loading map data...</p> : null}
          {error ? <p className={styles.errorText}>{error}</p> : null}
          {postalRegionsError ? <p className={styles.errorText}>{postalRegionsError}</p> : null}

          {!loading && !error && !selectedPoint ? (
            <p className={styles.loadingText}>
              {points.length > 0 && selectedSalesRepKeys.length > 0
                ? "No mapped business accounts match the selected sales rep filter."
                : "No mapped business accounts found for this filter."}
            </p>
          ) : null}

          {selectedPoint ? (
            <div className={styles.card}>
              {(() => {
                const companyUrl = buildAcumaticaBusinessAccountUrl(
                  acumaticaBaseUrl,
                  selectedPoint.businessAccountId,
                  acumaticaCompanyId,
                );

                return (
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleBlock}>
                  <h2>
                    {companyUrl ? (
                      <a
                        className={styles.recordLink}
                        href={companyUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {selectedPoint.companyName || selectedPoint.businessAccountId}
                      </a>
                    ) : (
                      selectedPoint.companyName || selectedPoint.businessAccountId
                    )}
                  </h2>
                  <p className={styles.cardSubtitle}>
                    Focus this panel on the fields you need for contact cleanup.
                  </p>
                </div>
              </div>
                );
              })()}

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
                      const contactUrl = buildAcumaticaContactUrl(
                        acumaticaBaseUrl,
                        contact.contactId,
                        acumaticaCompanyId,
                      );

                      return (
                        <li
                          className={styles.contactItem}
                          key={contact.rowKey || `${contact.contactId ?? "row"}-${index}`}
                        >
                          <div className={styles.contactHeader}>
                            <strong>
                              {contactUrl && renderText(contact.name) !== "-" ? (
                                <a
                                  className={styles.recordLink}
                                  href={contactUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {renderText(contact.name)}
                                </a>
                              ) : (
                                renderText(contact.name)
                              )}
                            </strong>
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
                              <div className={styles.contactPhoneRow}>
                                <p>{renderText(contact.phone)}</p>
                                <CallPhoneButton
                                  label={`${contact.name ?? selectedPoint?.companyName ?? "Contact"} phone`}
                                  phone={contact.phone}
                                  context={{
                                    sourcePage: "map",
                                    linkedBusinessAccountId: selectedPoint?.businessAccountId ?? null,
                                    linkedAccountRowKey: contact.rowKey ?? null,
                                    linkedContactId: contact.contactId,
                                    linkedCompanyName: selectedPoint?.companyName ?? null,
                                    linkedContactName: contact.name,
                                  }}
                                />
                              </div>
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
    </AppChrome>
  );
}
