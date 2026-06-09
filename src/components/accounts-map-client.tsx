"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import {
  CATEGORY_VALUES,
  type BusinessAccountDetailResponse,
  type BusinessAccountMapMetricSummary,
  type BusinessAccountMapPoint,
  type BusinessAccountMapResponse,
  type BusinessAccountRow,
  type BusinessAccountUpdateRequest,
  type Category,
  type PostalRegion,
  type PostalRegionsResponse,
} from "@/types/business-account";
import {
  buildAcumaticaBusinessAccountUrl,
  buildAcumaticaContactUrl,
} from "@/lib/acumatica-links";
import { enforceSinglePrimaryPerAccountRows, resolveCompanyPhone } from "@/lib/business-accounts";
import { buildBusinessAccountConcurrencySnapshot } from "@/lib/business-account-concurrency";
import {
  readCachedDatasetFromStorage,
  readCachedSyncMeta,
  writeCachedDatasetToStorage,
} from "@/lib/client-dataset-cache";
import {
  formatPhoneDraftValue,
  normalizeExtensionForSave,
  normalizePhoneForSave,
} from "@/lib/phone";
import { CallPhoneButton } from "@/components/call-phone-button";
import {
  QueueDeleteContactsModal,
  type QueueDeleteContactTarget,
} from "@/components/queue-delete-contacts-modal";

import accountStyles from "./accounts-client.module.css";
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
const MAP_CACHE_STORAGE_KEY = "businessAccounts.mapCache.v10";
const MAP_PANEL_PREFERENCES_STORAGE_KEY = "businessAccounts.mapPanelPrefs.v1";
const SALES_REP_FILTER_VISIBLE_SELECTION_LIMIT = 5;
const WEEK_OPTIONS = Array.from({ length: 15 }, (_, index) => `Week ${index + 1}`);

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
  snapshotVersion?: string | null;
  deferredVisibilityVersion?: string | null;
};

type CachedMapResponse = {
  cacheKey: string;
  payload: BusinessAccountMapResponse;
};

type MapContactSummary = {
  rowKey: string;
  contactId: number | null;
  name: string | null;
  jobTitle?: string | null;
  phone: string | null;
  extension: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
};

type MapContactDraft = {
  name: string;
  phone: string;
  extension: string;
  email: string;
  notes: string;
};

type SalesRepFilterOption = {
  key: string;
  label: string;
  count: number;
};

type AccountsFilterView = "allCompanies" | "marketingOnly";
type MapViewMetricIcon = "building" | "contacts" | "phone" | "email" | "call" | "database";
type MapViewMetricTone = "green" | "blue" | "purple" | "teal" | "amber" | "cyan";

type MapViewMetric = {
  id: string;
  label: string;
  value: string;
  meta: string;
  icon: MapViewMetricIcon;
  tone: MapViewMetricTone;
  badge?: {
    label: string;
    tone: "good" | "review" | "attention";
  };
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
    .map((option) => ({
      key: option.key,
      label: option.label,
      count: option.count,
    }))
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

function normalizeOptionComparable(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeWeekValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^week\s*(\d+)$/i);
  if (match) {
    const weekNumber = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(weekNumber)) {
      return `Week ${weekNumber}`;
    }
  }

  return trimmed;
}

function compareWeekFilterValues(left: string, right: string): number {
  const leftMatch = left.match(/^week\s*(\d+)$/i);
  const rightMatch = right.match(/^week\s*(\d+)$/i);
  const leftNumber = leftMatch ? Number.parseInt(leftMatch[1] ?? "", 10) : Number.NaN;
  const rightNumber = rightMatch ? Number.parseInt(rightMatch[1] ?? "", 10) : Number.NaN;

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  if (Number.isFinite(leftNumber)) {
    return -1;
  }
  if (Number.isFinite(rightNumber)) {
    return 1;
  }

  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function buildSalesRepInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }

  const initials =
    parts.length === 1
      ? parts[0]?.slice(0, 2)
      : `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`;

  return initials.toUpperCase();
}

function getSalesRepToneClass(name: string): string {
  const tones = [
    accountStyles.salesRepFilterChipGreen,
    accountStyles.salesRepFilterChipPurple,
    accountStyles.salesRepFilterChipBlue,
    accountStyles.salesRepFilterChipOrange,
    accountStyles.salesRepFilterChipTeal,
  ];
  const hash = Array.from(name).reduce((total, character) => {
    return total + character.charCodeAt(0);
  }, 0);

  return tones[hash % tones.length] ?? accountStyles.salesRepFilterChipGreen;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="8.75" cy="8.75" r="5.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m12.85 12.85 4.15 4.15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5 21V5.5L14 3v18" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M14 9h5v12" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M8 8h2M8 12h2M8 16h2M16.5 12h1M16.5 16h1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function MarketingIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M4 10.75h2.75l6.75 3.75v-9L6.75 9.25H4a1.5 1.5 0 0 0-1.5 1.5v0A1.5 1.5 0 0 0 4 12.25Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M6.75 12.25 7.6 16h2.15l-.75-2.55"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M15.25 9h2M15.25 11.5h1.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function ResetFilterIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M5.4 6.15A6 6 0 1 1 4 10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <path
        d="M5.4 3.4v2.75h2.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function MapViewMetricIcon({ icon }: { icon: MapViewMetricIcon }) {
  if (icon === "building") {
    return <BuildingIcon />;
  }

  if (icon === "contacts") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3.75 19c.65-3.1 2.45-4.65 5.25-4.65S13.6 15.9 14.25 19" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
        <path d="M15.5 5.6a2.6 2.6 0 0 1 0 5.05M16.6 14.2c2.05.35 3.25 1.75 3.65 4.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      </svg>
    );
  }

  if (icon === "phone") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M8.2 4.5 6.45 6.25c-.7.7-.82 1.78-.28 2.62a27.9 27.9 0 0 0 8.96 8.96c.84.54 1.92.42 2.62-.28l1.75-1.75a1.5 1.5 0 0 0 0-2.12l-2.18-2.18a1.5 1.5 0 0 0-2.12 0l-.82.82a18.2 18.2 0 0 1-3.2-3.2l.82-.82a1.5 1.5 0 0 0 0-2.12L10.32 4.5a1.5 1.5 0 0 0-2.12 0Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }

  if (icon === "email") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <rect height="13" rx="2" stroke="currentColor" strokeWidth="1.7" width="17" x="3.5" y="5.5" />
        <path d="m5.25 8 6.75 5 6.75-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }

  if (icon === "call") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M12 6v6l4 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
        <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
        <path d="M20 5.5v4h-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M12 3.5c4.25 0 7.5 1.25 7.5 2.8v11.4c0 1.55-3.25 2.8-7.5 2.8s-7.5-1.25-7.5-2.8V6.3c0-1.55 3.25-2.8 7.5-2.8Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 6.3c0 1.55 3.25 2.8 7.5 2.8s7.5-1.25 7.5-2.8M4.5 12c0 1.55 3.25 2.8 7.5 2.8s7.5-1.25 7.5-2.8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function formatPhoneWithExtension(
  phone: string | null | undefined,
  extension: string | null | undefined,
): string {
  const trimmedPhone = phone?.trim() ?? "";
  const trimmedExtension = extension?.trim() ?? "";

  if (!trimmedPhone) {
    return "-";
  }

  return trimmedExtension ? `${trimmedPhone} Ext. ${trimmedExtension}` : trimmedPhone;
}

function readRowAccountKey(row: BusinessAccountRow): string {
  return (
    row.accountRecordId?.trim() ||
    row.id.trim() ||
    row.businessAccountId.trim() ||
    row.companyName.trim()
  );
}

function appendNormalizedKey(target: Set<string>, value: string | null | undefined) {
  const normalized = normalizeComparableText(value);
  if (normalized) {
    target.add(normalized);
  }
}

function buildRowLookupKeys(row: BusinessAccountRow): Set<string> {
  const keys = new Set<string>();
  appendNormalizedKey(keys, readRowAccountKey(row));
  appendNormalizedKey(keys, row.accountRecordId);
  appendNormalizedKey(keys, row.id);
  appendNormalizedKey(keys, row.businessAccountId);
  appendNormalizedKey(keys, row.companyName);
  return keys;
}

function pointMatchesAccountKeys(
  point: BusinessAccountMapPoint,
  allowedAccountKeys: Set<string>,
): boolean {
  const keys = new Set<string>();
  appendNormalizedKey(keys, point.accountRecordId);
  appendNormalizedKey(keys, point.id);
  appendNormalizedKey(keys, point.businessAccountId);
  appendNormalizedKey(keys, point.companyName);

  for (const key of keys) {
    if (allowedAccountKeys.has(key)) {
      return true;
    }
  }

  return false;
}

function rowMatchesMapSearch(row: BusinessAccountRow, normalizedSearch: string): boolean {
  if (!normalizedSearch) {
    return true;
  }

  return [
    row.companyName,
    row.accountType,
    row.businessAccountId,
    row.salesRepName,
    row.industryType,
    row.subCategory,
    row.companyRegion,
    row.week,
    row.address,
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    resolveCompanyPhone(row),
    row.primaryContactName,
    row.primaryContactJobTitle,
    row.primaryContactPhone,
    row.primaryContactExtension,
    row.primaryContactEmail,
    row.notes,
    row.category,
    row.companyDescription,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedSearch);
}

function buildMetricCompanyKey(row: BusinessAccountRow): string {
  const keys = buildRowLookupKeys(row);
  return [...keys][0] ?? "";
}

function countDistinctMetricCompanies(rows: BusinessAccountRow[]): number {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = buildMetricCompanyKey(row);
    if (key) {
      keys.add(key);
    }
  }

  return keys.size;
}

function rowHasMetricAddress(row: BusinessAccountRow): boolean {
  return (
    [row.addressLine1, row.city, row.state, row.postalCode].every((value) =>
      hasText(value),
    ) || hasText(row.address)
  );
}

function resolveRowContactId(row: BusinessAccountRow): number | null {
  return row.contactId ?? row.primaryContactId ?? null;
}

function rowHasMetricContact(row: BusinessAccountRow): boolean {
  return resolveRowContactId(row) !== null || hasText(row.primaryContactName);
}

function rowHasMetricSalesRep(row: BusinessAccountRow): boolean {
  return hasText(row.salesRepName) || hasText(row.salesRepId);
}

function buildMetricPointCompanyKey(point: BusinessAccountMapPoint): string {
  const keys = new Set<string>();
  appendNormalizedKey(keys, point.accountRecordId);
  appendNormalizedKey(keys, point.id);
  appendNormalizedKey(keys, point.businessAccountId);
  appendNormalizedKey(keys, point.companyName);
  return [...keys][0] ?? "";
}

function pointHasMetricAddress(point: BusinessAccountMapPoint): boolean {
  return (
    [point.addressLine1, point.city, point.state, point.postalCode].every((value) =>
      hasText(value),
    ) || hasText(point.fullAddress)
  );
}

function pointHasMetricSalesRep(point: BusinessAccountMapPoint): boolean {
  return hasText(point.salesRepName) || hasText(point.salesRepId);
}

function getPointMetricContacts(point: BusinessAccountMapPoint): MapContactSummary[] {
  const contacts = Array.isArray(point.contacts)
    ? point.contacts
        .map((contact, index) => ({
          rowKey: contact.rowKey ?? `${point.id}:contact:${contact.contactId ?? index}`,
          contactId: contact.contactId ?? null,
          name: contact.name,
          jobTitle: contact.jobTitle ?? null,
          phone: contact.phone,
          extension: contact.extension ?? null,
          email: contact.email,
          isPrimary: Boolean(contact.isPrimary),
          notes: contact.notes,
        }))
        .filter(
          (contact) =>
            hasText(contact.name) ||
            hasText(contact.jobTitle) ||
            hasText(contact.phone) ||
            hasText(contact.extension) ||
            hasText(contact.email),
        )
    : [];

  if (contacts.length > 0) {
    return contacts;
  }

  if (
    !point.primaryContactName &&
    !point.primaryContactJobTitle &&
    !point.primaryContactEmail &&
    !point.primaryContactPhone
  ) {
    return [];
  }

  return [
    {
      rowKey: `${point.id}:primary`,
      contactId: null,
      name: point.primaryContactName,
      jobTitle: point.primaryContactJobTitle ?? null,
      phone: point.primaryContactPhone,
      extension: point.primaryContactExtension ?? null,
      email: point.primaryContactEmail,
      isPrimary: true,
      notes: point.notes,
    },
  ];
}

function normalizeMetricPhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length >= 7) {
    return digits;
  }

  const fallback = value?.trim().toLowerCase() ?? "";
  return fallback || null;
}

function readLatestIso(values: Array<string | null | undefined>): string | null {
  let latestValue: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= latestTime) {
      continue;
    }

    latestTime = timestamp;
    latestValue = value;
  }

  return latestValue;
}

function formatLastCalled(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function getMetricIconToneClass(tone: MapViewMetricTone): string {
  if (tone === "green") {
    return accountStyles.viewMetricIconGreen;
  }
  if (tone === "blue") {
    return accountStyles.viewMetricIconBlue;
  }
  if (tone === "purple") {
    return accountStyles.viewMetricIconPurple;
  }
  if (tone === "teal") {
    return accountStyles.viewMetricIconTeal;
  }
  if (tone === "amber") {
    return accountStyles.viewMetricIconAmber;
  }

  return accountStyles.viewMetricIconCyan;
}

function getMetricBadgeToneClass(tone: NonNullable<MapViewMetric["badge"]>["tone"]): string {
  if (tone === "good") {
    return accountStyles.viewMetricBadgeGood;
  }
  if (tone === "review") {
    return accountStyles.viewMetricBadgeReview;
  }

  return accountStyles.viewMetricBadgeAttention;
}

type MapMetricSummary = BusinessAccountMapMetricSummary;

function buildMapMetricCards(summary: MapMetricSummary): MapViewMetric[] {
  const databaseHealthScore =
    summary.totalDatabaseHealthFields > 0
      ? Math.round((summary.filledDatabaseHealthFields / summary.totalDatabaseHealthFields) * 100)
      : null;
  const databaseHealthTone =
    databaseHealthScore === null || databaseHealthScore >= 85
      ? "good"
      : databaseHealthScore >= 70
        ? "review"
        : "attention";
  const databaseHealthLabel =
    databaseHealthTone === "good"
      ? "Good"
      : databaseHealthTone === "review"
        ? "Review"
        : "Needs work";

  return [
    {
      id: "companies",
      label: "Companies in view",
      value: summary.companyCount.toLocaleString(),
      meta: "Distinct company accounts",
      icon: "building",
      tone: "green",
    },
    {
      id: "company-phones",
      label: "Company phones",
      value: summary.companyPhoneCount.toLocaleString(),
      meta: "Company phone numbers",
      icon: "phone",
      tone: "purple",
    },
    {
      id: "contacts",
      label: "Contacts in view",
      value: summary.contactCount.toLocaleString(),
      meta: "Rows with a contact",
      icon: "contacts",
      tone: "blue",
    },
    {
      id: "contact-phones",
      label: "Contact phones",
      value: summary.contactPhoneCount.toLocaleString(),
      meta: "Contact phone numbers",
      icon: "phone",
      tone: "cyan",
    },
    {
      id: "emails",
      label: "Email addresses",
      value: summary.emailCount.toLocaleString(),
      meta: "Primary contact emails",
      icon: "email",
      tone: "teal",
    },
    {
      id: "last-called",
      label: "Last called",
      value: summary.latestCalledAt ? formatLastCalled(summary.latestCalledAt) : "--",
      meta: summary.latestCalledAt ? "Most recent call in view" : "No calls in view",
      icon: "call",
      tone: "amber",
    },
    {
      id: "database-health",
      label: "Database health",
      value: databaseHealthScore === null ? "--" : `${databaseHealthScore}%`,
      meta:
        summary.totalDatabaseHealthFields > 0
          ? `${summary.filledDatabaseHealthFields.toLocaleString()} of ${summary.totalDatabaseHealthFields.toLocaleString()} fields filled`
          : "No rows in view",
      icon: "database",
      tone: "cyan",
      badge: {
        label: databaseHealthLabel,
        tone: databaseHealthTone,
      },
    },
  ];
}

function buildMapViewMetrics(rows: BusinessAccountRow[], fallbackCompanyCount: number): MapViewMetric[] {
  const companyKeys = new Set<string>();
  const contactCount = rows.filter(rowHasMetricContact).length;
  const companyPhoneValues = new Set<string>();
  const contactPhoneValues = new Set<string>();
  const emailValues = new Set<string>();
  let filledDatabaseHealthFields = 0;
  let totalDatabaseHealthFields = 0;

  for (const row of rows) {
    const companyKey = buildMetricCompanyKey(row);
    if (companyKey) {
      companyKeys.add(companyKey);
    }

    const companyPhone = normalizeMetricPhone(resolveCompanyPhone(row));
    if (companyPhone) {
      companyPhoneValues.add(companyPhone);
    }

    [row.primaryContactPhone, row.phoneNumber].forEach((value) => {
      const normalized = normalizeMetricPhone(value);
      if (normalized) {
        contactPhoneValues.add(normalized);
      }
    });

    const email = row.primaryContactEmail?.trim().toLowerCase();
    if (email) {
      emailValues.add(email);
    }

    const databaseHealthChecks = [
      rowHasMetricAddress(row),
      hasText(resolveCompanyPhone(row)),
      hasText(row.primaryContactName),
      hasText(row.primaryContactJobTitle),
      hasText(row.primaryContactPhone),
      hasText(row.week),
      rowHasMetricSalesRep(row),
      hasText(row.primaryContactEmail),
    ];
    totalDatabaseHealthFields += databaseHealthChecks.length;
    filledDatabaseHealthFields += databaseHealthChecks.filter(Boolean).length;
  }

  return buildMapMetricCards({
    companyCount: companyKeys.size || fallbackCompanyCount,
    contactCount,
    companyPhoneCount: companyPhoneValues.size,
    contactPhoneCount: contactPhoneValues.size,
    emailCount: emailValues.size,
    latestCalledAt: readLatestIso(rows.map((row) => row.lastCalledAt)),
    filledDatabaseHealthFields,
    totalDatabaseHealthFields,
  });
}

function buildMapPointViewMetrics(points: BusinessAccountMapPoint[]): MapViewMetric[] {
  const companyKeys = new Set<string>();
  let contactCount = 0;
  const companyPhoneValues = new Set<string>();
  const contactPhoneValues = new Set<string>();
  const emailValues = new Set<string>();
  const latestCalledValues: Array<string | null | undefined> = [];
  let filledDatabaseHealthFields = 0;
  let totalDatabaseHealthFields = 0;

  for (const point of points) {
    const companyKey = buildMetricPointCompanyKey(point);
    if (companyKey) {
      companyKeys.add(companyKey);
    }

    const companyPhone = normalizeMetricPhone(point.companyPhone);
    if (companyPhone) {
      companyPhoneValues.add(companyPhone);
    }

    const contacts = getPointMetricContacts(point);
    contactCount += contacts.length;
    for (const contact of contacts) {
      const phone = normalizeMetricPhone(contact.phone);
      if (phone) {
        contactPhoneValues.add(phone);
      }

      const email = contact.email?.trim().toLowerCase();
      if (email) {
        emailValues.add(email);
      }
    }

    const primaryContact = contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
    const databaseHealthChecks = [
      pointHasMetricAddress(point),
      hasText(point.companyPhone),
      hasText(primaryContact?.name ?? point.primaryContactName),
      hasText(primaryContact?.jobTitle ?? point.primaryContactJobTitle),
      hasText(primaryContact?.phone ?? point.primaryContactPhone),
      hasText(point.week),
      pointHasMetricSalesRep(point),
      hasText(primaryContact?.email ?? point.primaryContactEmail),
    ];
    totalDatabaseHealthFields += databaseHealthChecks.length;
    filledDatabaseHealthFields += databaseHealthChecks.filter(Boolean).length;
    latestCalledValues.push(point.lastCalledAt);
  }

  return buildMapMetricCards({
    companyCount: companyKeys.size || points.length,
    contactCount,
    companyPhoneCount: companyPhoneValues.size,
    contactPhoneCount: contactPhoneValues.size,
    emailCount: emailValues.size,
    latestCalledAt: readLatestIso(latestCalledValues),
    filledDatabaseHealthFields,
    totalDatabaseHealthFields,
  });
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
      jobTitle: row.primaryContactJobTitle ?? null,
      phone: row.primaryContactPhone,
      extension: row.primaryContactExtension ?? null,
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
      extension: hasText(existing.extension) ? existing.extension : nextContact.extension,
      email: hasText(existing.email) ? existing.email : nextContact.email,
      isPrimary: existing.isPrimary || nextContact.isPrimary,
      notes: hasText(existing.notes) ? existing.notes : nextContact.notes,
    });
  });

  return [...deduped.values()]
    .filter(
      (contact) =>
        hasText(contact.name) ||
        hasText(contact.email) ||
        hasText(contact.phone) ||
        hasText(contact.extension),
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
    extension: contact.extension ?? "",
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
        primaryContactExtension:
          updatedRow.primaryContactExtension ?? row.primaryContactExtension ?? null,
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
        primaryContactExtension: null,
        primaryContactRawPhone: null,
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
      primaryContactExtension: null,
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
    primaryContactExtension: primaryRow.primaryContactExtension ?? null,
    primaryContactEmail: primaryRow.primaryContactEmail,
    category: representativeRow.category ?? point.category,
    notes: primaryRow.notes ?? representativeRow.notes ?? null,
    lastModifiedIso: representativeRow.lastModifiedIso ?? point.lastModifiedIso,
    contacts: buildContactsFromRows(rows).map((contact) => ({
      rowKey: contact.rowKey,
      contactId: contact.contactId,
      name: contact.name,
      phone: contact.phone,
      extension: contact.extension,
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
    primaryContactExtension: targetRow.primaryContactExtension ?? null,
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
  const metricSummary = record.metricSummary;
  return (
    Array.isArray(record.items) &&
    typeof record.totalCandidates === "number" &&
    typeof record.geocodedCount === "number" &&
    typeof record.unmappedCount === "number" &&
    (metricSummary === undefined ||
      (metricSummary !== null &&
        typeof metricSummary === "object" &&
        typeof (metricSummary as Record<string, unknown>).companyCount === "number" &&
        typeof (metricSummary as Record<string, unknown>).contactCount === "number" &&
        typeof (metricSummary as Record<string, unknown>).companyPhoneCount === "number" &&
        typeof (metricSummary as Record<string, unknown>).contactPhoneCount === "number" &&
        typeof (metricSummary as Record<string, unknown>).emailCount === "number" &&
        ((metricSummary as Record<string, unknown>).latestCalledAt === null ||
          typeof (metricSummary as Record<string, unknown>).latestCalledAt === "string") &&
        typeof (metricSummary as Record<string, unknown>).filledDatabaseHealthFields === "number" &&
        typeof (metricSummary as Record<string, unknown>).totalDatabaseHealthFields === "number"))
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
  const cachedSyncMeta = readCachedSyncMeta();
  writeCachedDatasetToStorage({
    rows,
    lastSyncedAt,
    snapshotVersion: cachedSyncMeta.snapshotVersion ?? null,
    deferredVisibilityVersion: cachedSyncMeta.deferredVisibilityVersion ?? null,
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

    if (!parsed.payload.metricSummary) {
      return null;
    }

    if (parsed.payload.totalCandidates > 0 && parsed.payload.unmappedCount > 0) {
      return null;
    }

    return parsed.payload;
  } catch {
    return null;
  }
}

function writeMapCache(cacheKey: string, payload: BusinessAccountMapResponse) {
  if (payload.totalCandidates > 0 && payload.unmappedCount > 0) {
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
  const [activeFilterView, setActiveFilterView] = useState<AccountsFilterView>("allCompanies");
  const [selectedCategoryFilters, setSelectedCategoryFilters] = useState<Category[]>([]);
  const [selectedWeekFilters, setSelectedWeekFilters] = useState<string[]>([]);
  const [salesRepFilterOpen, setSalesRepFilterOpen] = useState(false);
  const [selectedSalesRepKeys, setSelectedSalesRepKeys] = useState<string[]>([]);
  const [points, setPoints] = useState<BusinessAccountMapPoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [geocodedCount, setGeocodedCount] = useState(0);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [serverMetricSummary, setServerMetricSummary] =
    useState<BusinessAccountMapMetricSummary | null>(null);
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

  const selectedCategoryFilterSet = useMemo(
    () => new Set(selectedCategoryFilters),
    [selectedCategoryFilters],
  );
  const selectedWeekFilterSet = useMemo(
    () => new Set(selectedWeekFilters.map((week) => normalizeOptionComparable(week))),
    [selectedWeekFilters],
  );
  const selectedSalesRepKeySet = useMemo(
    () => new Set(selectedSalesRepKeys),
    [selectedSalesRepKeys],
  );
  const normalizedMapSearch = q.trim().toLowerCase();
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
  const salesRepFilterOptionByKey = useMemo(
    () => new Map(salesRepOptions.map((option) => [option.key, option])),
    [salesRepOptions],
  );
  const salesRepFilterPreviewItems = useMemo(() => {
    return selectedSalesRepKeys
      .map((key) => salesRepFilterOptionByKey.get(key))
      .filter((option): option is SalesRepFilterOption => Boolean(option))
      .slice(0, SALES_REP_FILTER_VISIBLE_SELECTION_LIMIT);
  }, [salesRepFilterOptionByKey, selectedSalesRepKeys]);
  const hiddenSelectedSalesRepFilterCount = Math.max(
    selectedSalesRepKeys.length - salesRepFilterPreviewItems.length,
    0,
  );
  const allSalesRepFiltersSelected =
    salesRepOptions.length > 0 &&
    salesRepOptions.every((option) => selectedSalesRepKeySet.has(option.key));
  const availableWeekFilters = useMemo(() => {
    const byValue = new Map<string, string>();
    WEEK_OPTIONS.forEach((week) => {
      byValue.set(normalizeOptionComparable(week), week);
    });

    cachedDatasetRows.forEach((row) => {
      const normalizedWeek = normalizeWeekValue(row.week);
      if (!normalizedWeek) {
        return;
      }
      byValue.set(normalizeOptionComparable(normalizedWeek), normalizedWeek);
    });

    return [...byValue.values()].sort(compareWeekFilterValues);
  }, [cachedDatasetRows]);
  const filteredDatasetRows = useMemo(() => {
    let nextRows =
      activeFilterView === "marketingOnly"
        ? cachedDatasetRows.filter((row) => row.marketingEligible !== false)
        : cachedDatasetRows;

    if (normalizedMapSearch) {
      nextRows = nextRows.filter((row) => rowMatchesMapSearch(row, normalizedMapSearch));
    }

    if (selectedCategoryFilterSet.size > 0) {
      nextRows = nextRows.filter(
        (row) => row.category !== null && selectedCategoryFilterSet.has(row.category),
      );
    }

    if (selectedWeekFilterSet.size > 0) {
      nextRows = nextRows.filter((row) => {
        const week = normalizeWeekValue(row.week);
        return week ? selectedWeekFilterSet.has(normalizeOptionComparable(week)) : false;
      });
    }

    if (selectedSalesRepKeySet.size > 0) {
      nextRows = nextRows.filter((row) => selectedSalesRepKeySet.has(buildSalesRepFilterKey(row)));
    }

    return nextRows;
  }, [
    activeFilterView,
    cachedDatasetRows,
    normalizedMapSearch,
    selectedCategoryFilterSet,
    selectedSalesRepKeySet,
    selectedWeekFilterSet,
  ]);
  const filteredDatasetAccountKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of filteredDatasetRows) {
      for (const key of buildRowLookupKeys(row)) {
        keys.add(key);
      }
    }
    return keys;
  }, [filteredDatasetRows]);
  const hasStructuredMapFilters =
    activeFilterView !== "allCompanies" ||
    selectedCategoryFilters.length > 0 ||
    selectedWeekFilters.length > 0 ||
    selectedSalesRepKeys.length > 0;
  const filteredPoints = useMemo(() => {
    if (!hasStructuredMapFilters) {
      return points;
    }

    if (cachedDatasetRows.length > 0) {
      return points.filter((point) => pointMatchesAccountKeys(point, filteredDatasetAccountKeys));
    }

    return points.filter((point) => {
      if (selectedCategoryFilterSet.size > 0) {
        if (!point.category || !selectedCategoryFilterSet.has(point.category)) {
          return false;
        }
      }

      if (selectedSalesRepKeySet.size > 0 && !selectedSalesRepKeySet.has(buildSalesRepFilterKey(point))) {
        return false;
      }

      return true;
    });
  }, [
    cachedDatasetRows.length,
    filteredDatasetAccountKeys,
    hasStructuredMapFilters,
    points,
    selectedCategoryFilterSet,
    selectedSalesRepKeySet,
  ]);
  const mapViewMetrics = useMemo(
    () => {
      if (!hasStructuredMapFilters && serverMetricSummary) {
        return buildMapMetricCards(serverMetricSummary);
      }

      if (cachedDatasetRows.length > 0) {
        return buildMapViewMetrics(filteredDatasetRows, filteredPoints.length);
      }

      return buildMapPointViewMetrics(filteredPoints);
    },
    [
      cachedDatasetRows.length,
      filteredDatasetRows,
      filteredPoints,
      hasStructuredMapFilters,
      serverMetricSummary,
    ],
  );
  const shouldUseServerMapSummary = !hasStructuredMapFilters && serverMetricSummary !== null;
  const effectiveTotalCandidates =
    cachedDatasetRows.length > 0 && !shouldUseServerMapSummary
      ? countDistinctMetricCompanies(filteredDatasetRows)
      : totalCandidates;
  const effectiveGeocodedCount =
    cachedDatasetRows.length > 0 && !shouldUseServerMapSummary ? filteredPoints.length : geocodedCount;
  const effectiveUnmappedCount =
    cachedDatasetRows.length > 0 && !shouldUseServerMapSummary
      ? Math.max(0, effectiveTotalCandidates - filteredPoints.length)
      : unmappedCount;
  const hasActiveMapFilters =
    q.trim().length > 0 ||
    activeFilterView !== "allCompanies" ||
    selectedCategoryFilters.length > 0 ||
    selectedWeekFilters.length > 0 ||
    selectedSalesRepKeys.length > 0;
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
        jobTitle: contact.jobTitle ?? null,
        phone: contact.phone,
        extension: contact.extension ?? null,
        email: contact.email,
        isPrimary: contact.isPrimary,
        notes: contact.notes,
      }));
    }

    if (
      !selectedPoint.primaryContactName &&
      !selectedPoint.primaryContactJobTitle &&
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
        jobTitle: selectedPoint.primaryContactJobTitle ?? null,
        phone: selectedPoint.primaryContactPhone,
        extension: selectedPoint.primaryContactExtension ?? null,
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
    setSelectedSalesRepKeys((current) => {
      const next = current.filter((key) => optionKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [salesRepOptions]);

  useEffect(() => {
    if (!salesRepFilterOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-map-sales-rep-filter="true"]')
      ) {
        return;
      }

      setSalesRepFilterOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSalesRepFilterOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [salesRepFilterOpen]);

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
      setError(null);

      try {
        const normalizedQuery = q.trim().toLowerCase();
        const lastSyncedAt = readDatasetSyncStamp() ?? "unsynced";
        const cacheKey = `${lastSyncedAt}|scope:all|${normalizedQuery}`;
        const cached = readMapCache(cacheKey);
        if (cached) {
          setPoints(cached.items);
          setTotalCandidates(cached.totalCandidates);
          setGeocodedCount(cached.geocodedCount);
          setUnmappedCount(cached.unmappedCount);
          setServerMetricSummary(cached.metricSummary ?? null);
          setSelectedId((current) =>
            cached.items.some((item) => item.id === current)
              ? current
              : cached.items[0]?.id ?? null,
          );
          setLoading(false);
          return;
        }

        setLoading(true);
        const params = new URLSearchParams();
        if (normalizedQuery) {
          params.set("q", normalizedQuery);
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
        setServerMetricSummary(payload.metricSummary ?? null);
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
        setServerMetricSummary(null);
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
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);

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
        extension: "",
        email: "",
        notes: "",
      };

      return {
        ...current,
        [rowKey]: {
          ...existing,
          [field]:
            field === "phone"
              ? formatPhoneDraftValue(value)
              : field === "extension"
                ? value.replace(/\D/g, "").slice(0, 5)
                : value,
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

  function toggleCategoryFilter(category: Category) {
    setSelectedCategoryFilters((current) => {
      if (current.includes(category)) {
        return current.filter((currentCategory) => currentCategory !== category);
      }
      return [...current, category];
    });
  }

  function toggleWeekFilter(week: string) {
    const normalizedWeek = normalizeWeekValue(week);
    if (!normalizedWeek) {
      return;
    }

    setSelectedWeekFilters((current) => {
      if (current.includes(normalizedWeek)) {
        return current.filter((currentWeek) => currentWeek !== normalizedWeek);
      }
      return [...current, normalizedWeek].sort(compareWeekFilterValues);
    });
  }

  function clearSalesRepFilters() {
    setSelectedSalesRepKeys([]);
  }

  function selectAllSalesRepFilters() {
    setSelectedSalesRepKeys(salesRepOptions.map((option) => option.key));
  }

  function clearAllFilters() {
    setQ("");
    setActiveFilterView("allCompanies");
    setSelectedCategoryFilters([]);
    setSelectedWeekFilters([]);
    setSelectedSalesRepKeys([]);
    setSalesRepFilterOpen(false);
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

    const trimmedPhone = contactDraft.phone.trim();
    const trimmedExtension = contactDraft.extension.trim();

    if (trimmedPhone.length > 0 && normalizePhoneForSave(trimmedPhone) === null) {
      setContactActionError("Phone number must use the format ###-###-####.");
      return;
    }

    if (!trimmedPhone && trimmedExtension) {
      setContactActionError("Extension requires a phone number.");
      return;
    }

    const normalizedExtension = trimmedExtension
      ? normalizeExtensionForSave(trimmedExtension)
      : null;
    if (trimmedExtension && (!normalizedExtension || normalizedExtension.length > 5)) {
      setContactActionError("Extension must use 1 to 5 digits.");
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
            primaryContactPhone: trimmedPhone || null,
            primaryContactExtension: normalizedExtension,
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
            primaryContactExtension:
              contact.extension ?? targetRow.primaryContactExtension ?? null,
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
      contentClassName={`${styles.pageContent} ${accountStyles.pageContent}`}
      hidePageHeaderCopy
      subtitle="Sales MeadowBrook Map"
      title="Contacts Location View"
      topBarSearch={
        <label className={accountStyles.searchField}>
          <SearchIcon />
          <input
            aria-label="Map search"
            className={accountStyles.searchInput}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search companies, contacts, addresses, emails, or notes"
            value={q}
          />
        </label>
      }
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

      <section aria-label="Map view metrics" className={accountStyles.viewMetricsGrid}>
        {mapViewMetrics.map((metric) => (
          <article className={accountStyles.viewMetricCard} key={metric.id}>
            <span
              className={`${accountStyles.viewMetricIcon} ${getMetricIconToneClass(metric.tone)}`}
            >
              <MapViewMetricIcon icon={metric.icon} />
            </span>
            <div className={accountStyles.viewMetricBody}>
              <div className={accountStyles.viewMetricHeader}>
                <span className={accountStyles.viewMetricLabel}>{metric.label}</span>
                {metric.badge ? (
                  <span
                    className={`${accountStyles.viewMetricBadge} ${getMetricBadgeToneClass(
                      metric.badge.tone,
                    )}`}
                  >
                    {metric.badge.label}
                  </span>
                ) : null}
              </div>
              <strong className={accountStyles.viewMetricValue}>{metric.value}</strong>
              <span className={accountStyles.viewMetricMeta}>{metric.meta}</span>
            </div>
          </article>
        ))}
      </section>

      <section
        className={`${accountStyles.toolbar} ${accountStyles.tableControlsToolbar} ${styles.filterToolbar}`}
      >
        <div className={accountStyles.toolbarFilterControls}>
          <div className={`${accountStyles.filterRailGroup} ${accountStyles.filterRailGroupViews}`}>
            <span className={accountStyles.filterRailLabel}>Filter views</span>
            <div className={accountStyles.filterSegment}>
              <button
                className={`${accountStyles.filterSegmentButton} ${
                  activeFilterView === "allCompanies" ? accountStyles.filterSegmentButtonActive : ""
                }`}
                onClick={() => {
                  if (activeFilterView === "allCompanies") {
                    return;
                  }
                  setActiveFilterView("allCompanies");
                }}
                type="button"
              >
                <span className={accountStyles.filterButtonIcon}>
                  <BuildingIcon />
                </span>
                <span>All Companies</span>
              </button>
              <button
                className={`${accountStyles.filterSegmentButton} ${
                  activeFilterView === "marketingOnly"
                    ? accountStyles.filterSegmentButtonActive
                    : ""
                }`}
                onClick={() => {
                  if (activeFilterView === "marketingOnly") {
                    return;
                  }
                  setActiveFilterView("marketingOnly");
                }}
                type="button"
              >
                <span className={accountStyles.filterButtonIcon}>
                  <MarketingIcon />
                </span>
                <span>Marketing Only</span>
              </button>
            </div>
          </div>

          <div className={accountStyles.filterRailGroup}>
            <span className={accountStyles.filterRailLabel}>Category</span>
            <div className={accountStyles.compactFilterGroup}>
              {CATEGORY_VALUES.map((category) => {
                const isActive = selectedCategoryFilterSet.has(category);
                return (
                  <button
                    aria-pressed={isActive}
                    className={`${accountStyles.compactFilterChip} ${accountStyles.categoryFilterChip} ${
                      isActive ? accountStyles.compactFilterChipActive : ""
                    }`}
                    key={category}
                    onClick={() => toggleCategoryFilter(category)}
                    type="button"
                  >
                    {category}
                  </button>
                );
              })}
              <button
                aria-label="Clear categories"
                className={accountStyles.filterResetButton}
                disabled={selectedCategoryFilters.length === 0}
                onClick={() => setSelectedCategoryFilters([])}
                title="Clear categories"
                type="button"
              >
                <ResetFilterIcon />
              </button>
            </div>
          </div>

          <div
            className={`${accountStyles.filterRailGroup} ${accountStyles.filterRailGroupSalesReps}`}
          >
            <span className={accountStyles.filterRailLabel}>Sales reps</span>
            <div
              className={accountStyles.salesRepFilterCluster}
              data-map-sales-rep-filter="true"
            >
              {salesRepFilterPreviewItems.length > 0 ? (
                salesRepFilterPreviewItems.map((option) => {
                  const isActive = selectedSalesRepKeySet.has(option.key);
                  return (
                    <button
                      aria-label={`${isActive ? "Remove" : "Add"} ${option.label}`}
                      aria-pressed={isActive}
                      className={`${accountStyles.salesRepFilterChip} ${getSalesRepToneClass(
                        option.label,
                      )} ${isActive ? accountStyles.salesRepFilterChipActive : ""}`}
                      key={option.key}
                      onClick={() => toggleSalesRepFilter(option.key)}
                      title={`${option.label} (${option.count})`}
                      type="button"
                    >
                      {buildSalesRepInitials(option.label)}
                    </button>
                  );
                })
              ) : (
                <span className={accountStyles.salesRepFilterEmpty}>All reps</span>
              )}
              <button
                aria-expanded={salesRepFilterOpen}
                aria-haspopup="listbox"
                className={accountStyles.salesRepMoreButton}
                onClick={(event) => {
                  event.stopPropagation();
                  setSalesRepFilterOpen((current) => !current);
                }}
                type="button"
              >
                <span>
                  {hiddenSelectedSalesRepFilterCount > 0
                    ? `+${hiddenSelectedSalesRepFilterCount} selected`
                    : allSalesRepFiltersSelected
                      ? "All selected"
                      : selectedSalesRepKeys.length > 0
                        ? "Edit reps"
                        : "Select reps"}
                </span>
                <ChevronDownIcon />
              </button>
              {salesRepFilterOpen ? (
                <div
                  className={`${accountStyles.salesRepFilterDropdown} ${styles.salesRepFilterDropdown}`}
                  role="listbox"
                >
                  <div className={accountStyles.salesRepFilterDropdownHeader}>
                    <strong>Sales reps</strong>
                    <div className={accountStyles.salesRepFilterDropdownActions}>
                      <button
                        disabled={allSalesRepFiltersSelected || salesRepOptions.length === 0}
                        onClick={selectAllSalesRepFilters}
                        type="button"
                      >
                        Select all
                      </button>
                      <button
                        disabled={selectedSalesRepKeys.length === 0}
                        onClick={clearSalesRepFilters}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className={accountStyles.salesRepFilterDropdownList}>
                    {salesRepOptions.map((option) => {
                      const isActive = selectedSalesRepKeySet.has(option.key);
                      return (
                        <button
                          aria-selected={isActive}
                          className={`${accountStyles.salesRepFilterOption} ${
                            isActive ? accountStyles.salesRepFilterOptionActive : ""
                          }`}
                          key={option.key}
                          onClick={() => toggleSalesRepFilter(option.key)}
                          role="option"
                          type="button"
                        >
                          <span
                            className={`${accountStyles.salesRepFilterChip} ${getSalesRepToneClass(
                              option.label,
                            )} ${isActive ? accountStyles.salesRepFilterChipActive : ""}`}
                          >
                            {buildSalesRepInitials(option.label)}
                          </span>
                          <span>
                            {option.label} ({option.count})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className={accountStyles.toolbarActions}>
          <button
            className={accountStyles.clearFiltersButton}
            disabled={!hasActiveMapFilters}
            onClick={clearAllFilters}
            type="button"
          >
            Clear search and filters
          </button>
        </div>
      </section>

      <section
        aria-label="Map week filters"
        className={`${accountStyles.filterRail} ${accountStyles.weekRail} ${styles.weekToolbar}`}
      >
        <div className={`${accountStyles.filterRailGroup} ${accountStyles.filterRailGroupWeeks}`}>
          <span className={accountStyles.filterRailLabel}>Weeks</span>
          <div className={`${accountStyles.compactFilterGroup} ${accountStyles.weekFilterGroup}`}>
            {availableWeekFilters.map((week) => {
              const isActive = selectedWeekFilterSet.has(normalizeOptionComparable(week));
              return (
                <button
                  aria-pressed={isActive}
                  className={`${accountStyles.compactFilterChip} ${
                    isActive ? accountStyles.compactFilterChipActive : ""
                  }`}
                  key={week}
                  onClick={() => toggleWeekFilter(week)}
                  type="button"
                >
                  {week}
                </button>
              );
            })}
          </div>
          <button
            className={accountStyles.filterTextButton}
            disabled={selectedWeekFilters.length === 0}
            onClick={() => setSelectedWeekFilters([])}
            type="button"
          >
            Clear weeks
          </button>
        </div>
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
              <span>Account Candidates: {effectiveTotalCandidates}</span>
              <span>Geocoded Accounts: {effectiveGeocodedCount}</span>
              <span>Visible Pins: {filteredPoints.length}</span>
              <span>Unmapped Accounts: {effectiveUnmappedCount}</span>
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
                                Extension
                                <input
                                  disabled={updatingContactRowKey !== null}
                                  inputMode="numeric"
                                  maxLength={5}
                                  onChange={(event) =>
                                    updateContactDraft(
                                      contact.rowKey,
                                      "extension",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Extension"
                                  title="Extension must use 1 to 5 digits."
                                  value={draft.extension}
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
                                <p>{formatPhoneWithExtension(contact.phone, contact.extension)}</p>
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
