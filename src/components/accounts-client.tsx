"use client";

import { type DragEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type {
  BusinessAccountDetailResponse,
  BusinessAccountRow,
  BusinessAccountsResponse,
  BusinessAccountUpdateRequest,
  Category,
  SortBy,
  SortDir,
} from "@/types/business-account";
import type {
  BusinessAccountCreateResponse,
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import {
  enforceSinglePrimaryPerAccountRows,
  queryBusinessAccounts,
  resolveCompanyPhone,
} from "@/lib/business-accounts";
import {
  buildAcumaticaBusinessAccountUrl,
  buildAcumaticaContactUrl,
} from "@/lib/acumatica-links";
import {
  type CachedDataset,
  readCachedDatasetFromStorage,
  readCachedSyncMeta,
  writeCachedDatasetToStorage,
} from "@/lib/client-dataset-cache";
import { formatPhoneDraftValue, normalizePhoneForSave } from "@/lib/phone";
import { CreateBusinessAccountDrawer } from "@/components/create-business-account-drawer";
import {
  CreateContactDrawer,
  type CreateContactAccountOption,
} from "@/components/create-contact-drawer";

import styles from "./accounts-client.module.css";
import type { SyncStatusResponse } from "@/types/sync";

const PAGE_SIZE = 25;

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
};

type AddressLookupSuggestion = {
  id: string;
  type: string;
  text: string;
  description: string;
};

type AddressLookupResponse = {
  items: AddressLookupSuggestion[];
};

type AddressRetrieveResponse = {
  address: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
};

type EmployeeOption = {
  id: string;
  name: string;
};

type EmployeeLookupResponse = {
  items: EmployeeOption[];
};

type SyncProgress = {
  fetchedPages: number;
  totalPages: number | null;
  fetchedRows: number;
  totalRows: number | null;
};

function isSyncStatusResponse(value: unknown): value is SyncStatusResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.status === "idle" ||
      record.status === "running" ||
      record.status === "failed") &&
    (record.phase === null || typeof record.phase === "string") &&
    (record.lastSuccessfulSyncAt === null ||
      typeof record.lastSuccessfulSyncAt === "string")
  );
}

type HeaderFilters = {
  companyName: string;
  salesRepName: string;
  industryType: string;
  subCategory: string;
  companyRegion: string;
  week: string;
  address: string;
  companyPhone: string;
  primaryContactName: string;
  primaryContactPhone: string;
  primaryContactEmail: string;
  notes: string;
  category: Category | "";
  lastModified: string;
};

const DEFAULT_HEADER_FILTERS: HeaderFilters = {
  companyName: "",
  salesRepName: "",
  industryType: "",
  subCategory: "",
  companyRegion: "",
  week: "",
  address: "",
  companyPhone: "",
  primaryContactName: "",
  primaryContactPhone: "",
  primaryContactEmail: "",
  notes: "",
  category: "",
  lastModified: "",
};

const COLUMN_STORAGE_KEY = "businessAccounts.columnOrder.v2";
const LEGACY_COLUMN_STORAGE_KEYS = ["businessAccounts.columnOrder.v1"] as const;
const COLUMN_VISIBILITY_STORAGE_KEY = "businessAccounts.visibleColumns.v2";
const LEGACY_COLUMN_VISIBILITY_STORAGE_KEYS = [
  "businessAccounts.visibleColumns.v1",
] as const;

type AttributeOption = {
  value: string;
  label: string;
  aliases?: string[];
};

type ColumnConfig = {
  id: SortBy;
  label: string;
  filterKey: keyof HeaderFilters;
  filterPlaceholder: string;
};

type InlineEditableColumn =
  | "industryType"
  | "subCategory"
  | "companyRegion"
  | "week"
  | "category";

const COLUMN_CONFIGS: ColumnConfig[] = [
  {
    id: "companyName",
    label: "Company Name",
    filterKey: "companyName",
    filterPlaceholder: "Filter company",
  },
  {
    id: "salesRepName",
    label: "Sales Rep",
    filterKey: "salesRepName",
    filterPlaceholder: "Filter sales rep",
  },
  {
    id: "industryType",
    label: "Industry Type",
    filterKey: "industryType",
    filterPlaceholder: "Filter industry type",
  },
  {
    id: "subCategory",
    label: "Sub-Category",
    filterKey: "subCategory",
    filterPlaceholder: "Filter sub-category",
  },
  {
    id: "companyRegion",
    label: "Company Region",
    filterKey: "companyRegion",
    filterPlaceholder: "Filter company region",
  },
  {
    id: "week",
    label: "Week",
    filterKey: "week",
    filterPlaceholder: "Filter week",
  },
  {
    id: "address",
    label: "Address",
    filterKey: "address",
    filterPlaceholder: "Filter address",
  },
  {
    id: "companyPhone",
    label: "Company Phone",
    filterKey: "companyPhone",
    filterPlaceholder: "Filter company phone",
  },
  {
    id: "primaryContactName",
    label: "Contact",
    filterKey: "primaryContactName",
    filterPlaceholder: "Filter contact",
  },
  {
    id: "primaryContactPhone",
    label: "Phone Number",
    filterKey: "primaryContactPhone",
    filterPlaceholder: "Filter phone number",
  },
  {
    id: "primaryContactEmail",
    label: "Primary Contact Email",
    filterKey: "primaryContactEmail",
    filterPlaceholder: "Filter email",
  },
  {
    id: "notes",
    label: "Notes",
    filterKey: "notes",
    filterPlaceholder: "Filter notes",
  },
  {
    id: "category",
    label: "Category",
    filterKey: "category",
    filterPlaceholder: "Filter category",
  },
  {
    id: "lastModifiedIso",
    label: "Last Modified",
    filterKey: "lastModified",
    filterPlaceholder: "Filter last modified",
  },
];

const DEFAULT_COLUMN_ORDER = COLUMN_CONFIGS.map((column) => column.id);

const CATEGORY_OPTIONS: AttributeOption[] = [
  { value: "A", label: "A - Type Customers", aliases: ["A - Type Clients"] },
  { value: "B", label: "B - Type Customers", aliases: ["B - Type Clients"] },
  { value: "C", label: "C - Type Customers", aliases: ["C - Type Clients"] },
  { value: "D", label: "D - Type Customers", aliases: ["D - Type Clients"] },
];

const INDUSTRY_TYPE_OPTIONS: AttributeOption[] = [
  { value: "Distributi", label: "Distribution", aliases: ["Distributi"] },
  { value: "Manufactur", label: "Manufacturing", aliases: ["Manufactur"] },
  { value: "Recreation", label: "Recreation" },
  { value: "Service", label: "Service" },
];

const SUB_CATEGORY_OPTIONS: AttributeOption[] = [
  { value: "Automotive", label: "Automotive" },
  { value: "Distributi", label: "Food & Beverage", aliases: ["Distribution"] },
  { value: "Electronic", label: "Electronics", aliases: ["Electronic"] },
  { value: "Fabric", label: "Fabrication" },
  { value: "General", label: "General" },
  { value: "Manufactur", label: "Pharmaceuticals", aliases: ["Manufacturing"] },
  { value: "Package", label: "Packaging" },
  { value: "Plastics", label: "Plastics" },
  { value: "Recreation", label: "Aerospace & Defense" },
  { value: "Service", label: "Chemical" },
];

const COMPANY_REGION_DEFAULT_OPTIONS: AttributeOption[] = [
  { value: "Region 1", label: "Region 1" },
  { value: "Region 2", label: "Region 2" },
  { value: "Region 3", label: "Region 3" },
  { value: "Region 4", label: "Region 4" },
  { value: "Region 5", label: "Region 5" },
];

const WEEK_OPTIONS: AttributeOption[] = Array.from({ length: 15 }, (_, index) => {
  const value = `Week ${index + 1}`;
  return {
    value,
    label: value,
  };
});

function normalizeOptionComparable(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionValue(
  options: AttributeOption[],
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const comparable = normalizeOptionComparable(value);
  for (const option of options) {
    if (normalizeOptionComparable(option.value) === comparable) {
      return option.value;
    }
    if (normalizeOptionComparable(option.label) === comparable) {
      return option.value;
    }
    if (
      option.aliases &&
      option.aliases.some(
        (alias) => normalizeOptionComparable(alias) === comparable,
      )
    ) {
      return option.value;
    }
  }

  return value.trim() || null;
}

function normalizeRegionValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^region\s*(\d+)$/i);
  if (match) {
    return `Region ${match[1]}`;
  }

  return trimmed;
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
    return `Week ${match[1]}`;
  }

  return trimmed;
}

function withCurrentOption(
  options: AttributeOption[],
  currentValue: string | null | undefined,
): AttributeOption[] {
  if (!currentValue || !currentValue.trim()) {
    return options;
  }

  const comparable = normalizeOptionComparable(currentValue);
  const exists = options.some(
    (option) =>
      normalizeOptionComparable(option.value) === comparable ||
      normalizeOptionComparable(option.label) === comparable,
  );
  if (exists) {
    return options;
  }

  return [{ value: currentValue.trim(), label: currentValue.trim() }, ...options];
}

function isValidColumnOrder(value: unknown): value is SortBy[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_COLUMN_ORDER.length) {
    return false;
  }

  const unique = new Set(value);
  if (unique.size !== DEFAULT_COLUMN_ORDER.length) {
    return false;
  }

  return DEFAULT_COLUMN_ORDER.every((column) => unique.has(column));
}

function isKnownColumnList(value: unknown): value is SortBy[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const unique = new Set(value);
  if (unique.size !== value.length) {
    return false;
  }

  return value.every((column) => DEFAULT_COLUMN_ORDER.includes(column));
}

function getColumnConfig(columnId: SortBy): ColumnConfig {
  const config = COLUMN_CONFIGS.find((item) => item.id === columnId);
  if (!config) {
    throw new Error(`Unknown column '${columnId}'`);
  }

  return config;
}

function reorderColumns(order: SortBy[], source: SortBy, target: SortBy): SortBy[] {
  if (source === target) {
    return order;
  }

  const sourceIndex = order.indexOf(source);
  const targetIndex = order.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) {
    return order;
  }

  const result = [...order];
  result.splice(sourceIndex, 1);
  result.splice(targetIndex, 0, source);
  return result;
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

function formatElapsedDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${minutes}:${pad(seconds)}`;
}

function buildAddressLookupSearchTerm(draft: BusinessAccountUpdateRequest | null): string {
  if (!draft) {
    return "";
  }

  return [draft.addressLine1, draft.city, draft.state, draft.postalCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizeCountryDraftValue(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!normalized || normalized === "CA" || normalized === "CAN") {
    return "CA";
  }

  return normalized;
}

function buildDraft(row: BusinessAccountRow): BusinessAccountUpdateRequest {
  return {
    companyName: row.companyName,
    assignedBusinessAccountRecordId:
      row.businessAccountId.trim().length > 0
        ? (row.accountRecordId ?? row.id)
        : null,
    assignedBusinessAccountId: row.businessAccountId.trim() || null,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: normalizeCountryDraftValue(row.country),
    targetContactId: row.contactId ?? row.primaryContactId ?? null,
    setAsPrimaryContact: false,
    primaryOnlyIntent: false,
    salesRepId: row.salesRepId ?? null,
    salesRepName: row.salesRepName ?? null,
    industryType: normalizeOptionValue(INDUSTRY_TYPE_OPTIONS, row.industryType),
    subCategory: normalizeOptionValue(SUB_CATEGORY_OPTIONS, row.subCategory),
    companyRegion: normalizeRegionValue(row.companyRegion),
    week: normalizeWeekValue(row.week),
    primaryContactName: row.primaryContactName,
    primaryContactPhone: row.primaryContactPhone,
    primaryContactEmail: row.primaryContactEmail,
    category: row.category,
    notes: row.notes,
    expectedLastModified: row.lastModifiedIso,
  };
}

function renderCell(value: string | null | undefined): string {
  if (!value || value.trim().length === 0) {
    return "-";
  }

  return value;
}

function normalizeComparable(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase();
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickPreferredText(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  if (hasText(incoming)) {
    return incoming;
  }

  if (hasText(existing)) {
    return existing;
  }

  return null;
}

function pickPreferredContactName(
  existing: string | null | undefined,
  incoming: string | null | undefined,
  companyName: string,
): string | null {
  const existingIsValid =
    hasText(existing) &&
    normalizeComparable(existing) !== normalizeComparable(companyName);
  const incomingIsValid =
    hasText(incoming) &&
    normalizeComparable(incoming) !== normalizeComparable(companyName);

  if (incomingIsValid) {
    return incoming;
  }

  if (existingIsValid) {
    return existing;
  }

  return null;
}

function mergeSyncedRows(
  existing: BusinessAccountRow,
  incoming: BusinessAccountRow,
): BusinessAccountRow {
  const mergedIsPrimary =
    incoming.isPrimaryContact !== undefined
      ? incoming.isPrimaryContact
      : existing.isPrimaryContact;

  const merged: BusinessAccountRow = {
    ...existing,
    ...incoming,
  };
  const companyName = incoming.companyName || existing.companyName;

  return {
    ...merged,
    contactId: incoming.contactId ?? existing.contactId,
    primaryContactId: incoming.primaryContactId ?? existing.primaryContactId,
    isPrimaryContact: mergedIsPrimary,
    salesRepId: pickPreferredText(existing.salesRepId, incoming.salesRepId),
    salesRepName: pickPreferredText(existing.salesRepName, incoming.salesRepName),
    industryType: pickPreferredText(existing.industryType, incoming.industryType),
    subCategory: pickPreferredText(existing.subCategory, incoming.subCategory),
    companyRegion: pickPreferredText(existing.companyRegion, incoming.companyRegion),
    week: pickPreferredText(existing.week, incoming.week),
    primaryContactName: pickPreferredContactName(
      existing.primaryContactName,
      incoming.primaryContactName,
      companyName,
    ),
    primaryContactPhone: pickPreferredText(
      existing.primaryContactPhone,
      incoming.primaryContactPhone,
    ),
    primaryContactEmail: pickPreferredText(
      existing.primaryContactEmail,
      incoming.primaryContactEmail,
    ),
    companyPhone: pickPreferredText(existing.companyPhone, incoming.companyPhone),
    phoneNumber: pickPreferredText(existing.phoneNumber, incoming.phoneNumber),
    notes: pickPreferredText(existing.notes, incoming.notes),
    category: incoming.category ?? existing.category,
    lastModifiedIso: pickPreferredText(existing.lastModifiedIso, incoming.lastModifiedIso),
  };
}

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  function readText(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function readDetailsMessage(details: unknown): string | null {
    if (!details || typeof details !== "object") {
      return null;
    }

    const record = details as Record<string, unknown>;
    const direct = [
      record.message,
      record.Message,
      record.exceptionMessage,
      record.ExceptionMessage,
      record.detail,
      record.Detail,
      record.title,
      record.Title,
    ]
      .map(readText)
      .find((value) => Boolean(value));
    if (direct) {
      return direct;
    }

    const modelState = record.modelState;
    if (modelState && typeof modelState === "object") {
      const entries = Object.entries(modelState as Record<string, unknown>);
      for (const [field, value] of entries) {
        if (Array.isArray(value)) {
          const first = value.map(readText).find((item) => Boolean(item));
          if (first) {
            return `${field}: ${first}`;
          }
        } else {
          const single = readText(value);
          if (single) {
            return `${field}: ${single}`;
          }
        }
      }
    }

    const nestedError = record.error;
    if (nestedError && typeof nestedError === "object") {
      return readDetailsMessage(nestedError);
    }

    return null;
  }

  const record = payload as Record<string, unknown>;
  const errorValue = readText(record.error);
  const detailsValue = readDetailsMessage(record.details);
  const isGenericError =
    (errorValue ?? "").toLowerCase() === "an error has occurred." ||
    (errorValue ?? "").toLowerCase() === "an error has occurred";

  if (errorValue && detailsValue && isGenericError) {
    return detailsValue;
  }

  if (errorValue) {
    return errorValue;
  }

  if (detailsValue) {
    return detailsValue;
  }

  return "Request failed.";
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function isBusinessAccountsResponse(payload: unknown): payload is BusinessAccountsResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    Array.isArray(record.items) &&
    typeof record.total === "number" &&
    typeof record.page === "number" &&
    typeof record.pageSize === "number"
  );
}

function isBusinessAccountRow(payload: unknown): payload is BusinessAccountRow {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return typeof record.id === "string";
}

function isBusinessAccountRows(payload: unknown): payload is BusinessAccountRow[] {
  return Array.isArray(payload) && payload.every((item) => isBusinessAccountRow(item));
}

function isAddressLookupSuggestion(payload: unknown): payload is AddressLookupSuggestion {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    typeof record.text === "string" &&
    typeof record.description === "string"
  );
}

function isAddressLookupResponse(payload: unknown): payload is AddressLookupResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.every((item) => isAddressLookupSuggestion(item));
}

function isAddressRetrieveResponse(payload: unknown): payload is AddressRetrieveResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (!record.address || typeof record.address !== "object") {
    return false;
  }

  const address = record.address as Record<string, unknown>;
  return (
    typeof address.addressLine1 === "string" &&
    typeof address.addressLine2 === "string" &&
    typeof address.city === "string" &&
    typeof address.state === "string" &&
    typeof address.postalCode === "string" &&
    typeof address.country === "string"
  );
}

function isEmployeeOption(payload: unknown): payload is EmployeeOption {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string";
}

function isEmployeeLookupResponse(payload: unknown): payload is EmployeeLookupResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.every((item) => isEmployeeOption(item));
}

function matchEmployeeByName(
  employees: EmployeeOption[],
  name: string | null | undefined,
): EmployeeOption | null {
  const normalizedName = normalizeComparable(name);
  if (!normalizedName) {
    return null;
  }

  return (
    employees.find((employee) => normalizeComparable(employee.name) === normalizedName) ?? null
  );
}

function findEmployeeById(
  employees: EmployeeOption[],
  id: string | null | undefined,
): EmployeeOption | null {
  if (!id) {
    return null;
  }

  const normalizedId = id.trim();
  if (!normalizedId) {
    return null;
  }

  return employees.find((employee) => employee.id === normalizedId) ?? null;
}

function collectEmployeeOptionsFromRows(rows: BusinessAccountRow[]): EmployeeOption[] {
  const byId = new Map<string, EmployeeOption>();

  rows.forEach((row) => {
    const id = row.salesRepId?.trim() ?? "";
    const name = row.salesRepName?.trim() ?? "";
    if (!id || !name) {
      return;
    }

    if (!byId.has(id)) {
      byId.set(id, { id, name });
    }
  });

  return [...byId.values()];
}

function mergeEmployeeOptions(
  primary: EmployeeOption[],
  secondary: EmployeeOption[],
): EmployeeOption[] {
  const byId = new Map<string, EmployeeOption>();

  [...primary, ...secondary].forEach((item) => {
    const id = item.id.trim();
    const name = item.name.trim();
    if (!id || !name) {
      return;
    }

    if (!byId.has(id)) {
      byId.set(id, { id, name });
    }
  });

  return [...byId.values()];
}

function formatCreateContactAccountAddress(row: BusinessAccountRow): string {
  if (hasText(row.address)) {
    return row.address;
  }

  return [row.addressLine1, row.addressLine2, row.city, row.state, row.postalCode, row.country]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

function buildCreateContactAccountOptions(
  rows: BusinessAccountRow[],
): CreateContactAccountOption[] {
  const byAccount = new Map<string, CreateContactAccountOption>();

  rows.forEach((row) => {
    const businessAccountRecordId = (row.accountRecordId ?? row.id ?? "").trim();
    const businessAccountId = row.businessAccountId.trim();
    const companyName = row.companyName.trim();
    if (!businessAccountRecordId || !businessAccountId || !companyName) {
      return;
    }

    const key = businessAccountRecordId || businessAccountId;
    if (byAccount.has(key)) {
      return;
    }

    byAccount.set(key, {
      businessAccountRecordId,
      businessAccountId,
      companyName,
      address: formatCreateContactAccountAddress(row),
    });
  });

  return [...byAccount.values()].sort((left, right) => {
    const companyCompare = left.companyName.localeCompare(right.companyName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (companyCompare !== 0) {
      return companyCompare;
    }

    return left.address.localeCompare(right.address, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

function findCreateContactAccountOption(
  options: CreateContactAccountOption[],
  draft: BusinessAccountUpdateRequest | null,
): CreateContactAccountOption | null {
  if (!draft) {
    return null;
  }

  const assignedRecordId = draft.assignedBusinessAccountRecordId?.trim() ?? "";
  if (assignedRecordId) {
    const byRecordId =
      options.find((option) => option.businessAccountRecordId === assignedRecordId) ?? null;
    if (byRecordId) {
      return byRecordId;
    }
  }

  const assignedBusinessAccountId = draft.assignedBusinessAccountId?.trim() ?? "";
  if (assignedBusinessAccountId) {
    const byBusinessAccountId =
      options.find((option) => option.businessAccountId === assignedBusinessAccountId) ?? null;
    if (byBusinessAccountId) {
      return byBusinessAccountId;
    }
  }

  return null;
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

  if ("rows" in record && record.rows !== undefined && !isBusinessAccountRows(record.rows)) {
    return false;
  }

  return true;
}

function readDetailResponseRows(payload: unknown): BusinessAccountRow[] | null {
  if (!isBusinessAccountDetailResponse(payload)) {
    return null;
  }

  if (Array.isArray(payload.rows) && payload.rows.length > 0) {
    return payload.rows;
  }

  return null;
}

function readDetailResponseRow(payload: unknown): BusinessAccountRow | null {
  if (isBusinessAccountDetailResponse(payload)) {
    return payload.row;
  }

  if (isBusinessAccountRow(payload)) {
    return payload;
  }

  return null;
}

function findMatchingAccountRow(
  rows: BusinessAccountRow[],
  sourceRow: BusinessAccountRow,
): BusinessAccountRow | null {
  if (rows.length === 0) {
    return null;
  }

  if (sourceRow.rowKey) {
    const byRowKey = rows.find((row) => row.rowKey === sourceRow.rowKey);
    if (byRowKey) {
      return byRowKey;
    }
  }

  if (sourceRow.contactId !== null && sourceRow.contactId !== undefined) {
    const byContactId = rows.find(
      (row) =>
        row.contactId !== null &&
        row.contactId !== undefined &&
        row.contactId === sourceRow.contactId,
    );
    if (byContactId) {
      return byContactId;
    }
  }

  if (sourceRow.isPrimaryContact) {
    const primaryRow = rows.find((row) => row.isPrimaryContact);
    if (primaryRow) {
      return primaryRow;
    }
  }

  return rows[0] ?? null;
}

function removeDeletedContactFromAccountRows(
  rows: BusinessAccountRow[],
  targetContactId: number,
  targetRowKey: string | null,
): BusinessAccountRow[] {
  const deletedWasPrimary = rows.some((row) => {
    const matchesRowKey = targetRowKey ? getRowKey(row) === targetRowKey : false;
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
    if (targetRowKey && getRowKey(row) === targetRowKey) {
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

function renderColumnValue(row: BusinessAccountRow, columnId: SortBy): string {
  switch (columnId) {
    case "companyName":
      return renderCell(row.companyName);
    case "salesRepName":
      return renderCell(row.salesRepName);
    case "industryType":
      return renderCell(row.industryType);
    case "subCategory":
      return renderCell(row.subCategory);
    case "companyRegion":
      return renderCell(row.companyRegion);
    case "week":
      return renderCell(row.week);
    case "address":
      return renderCell(row.address);
    case "companyPhone":
      return renderCell(resolveCompanyPhone(row));
    case "primaryContactName":
      return row.primaryContactName?.trim() ?? "";
    case "primaryContactPhone":
      return renderCell(row.primaryContactPhone);
    case "primaryContactEmail":
      return renderCell(row.primaryContactEmail);
    case "notes":
      return renderCell(row.notes);
    case "category":
      return renderCell(row.category);
    case "lastModifiedIso":
      return formatLastModified(row.lastModifiedIso);
    default:
      return "-";
  }
}

function isInlineEditableColumn(columnId: SortBy): columnId is InlineEditableColumn {
  return (
    columnId === "industryType" ||
    columnId === "subCategory" ||
    columnId === "companyRegion" ||
    columnId === "week" ||
    columnId === "category"
  );
}

function getRowKey(row: BusinessAccountRow, index = 0): string {
  return (
    row.rowKey ??
    `${row.accountRecordId ?? row.id}:${row.contactId ?? "contact"}:${index}`
  );
}

function clearCachedMapData() {
  try {
    window.localStorage.removeItem("businessAccounts.mapCache.v3");
  } catch {
    // Ignore storage failures while updating client caches.
  }
}

function replaceRowsForAccount(
  currentRows: BusinessAccountRow[],
  incomingRows: BusinessAccountRow[],
  businessAccountRecordId: string,
  businessAccountId: string,
): BusinessAccountRow[] {
  const nextRows = currentRows.filter((row) => {
    const rowAccountRecordId = row.accountRecordId ?? row.id;
    if (rowAccountRecordId === businessAccountRecordId) {
      return false;
    }

    if (businessAccountId && row.businessAccountId === businessAccountId) {
      return false;
    }

    return true;
  });

  return enforceSinglePrimaryPerAccountRows([...incomingRows, ...nextRows]);
}

function buildPaginationNumbers(
  currentPage: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  pages.add(currentPage);
  pages.add(Math.max(1, currentPage - 2));
  pages.add(Math.max(1, currentPage - 1));
  pages.add(Math.min(totalPages, currentPage + 1));
  pages.add(Math.min(totalPages, currentPage + 2));

  const ordered = [...pages].sort((left, right) => left - right);
  const result: Array<number | "ellipsis"> = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const page = ordered[index];
    const previous = ordered[index - 1];
    if (previous !== undefined && page - previous > 1) {
      result.push("ellipsis");
    }
    result.push(page);
  }

  return result;
}

function SortHeader({
  label,
  column,
  activeSort,
  onSort,
}: {
  label: string;
  column: SortBy;
  activeSort: {
    sortBy: SortBy;
    sortDir: SortDir;
  };
  onSort: (column: SortBy) => void;
}) {
  const indicator =
    activeSort.sortBy === column
      ? activeSort.sortDir === "asc"
        ? "↑"
        : "↓"
      : "";

  return (
    <button className={styles.sortButton} onClick={() => onSort(column)} type="button">
      {label} {indicator}
    </button>
  );
}

export function AccountsClient({
  acumaticaBaseUrl,
  acumaticaCompanyId,
}: {
  acumaticaBaseUrl: string;
  acumaticaCompanyId: string;
}) {
  const router = useRouter();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [allRows, setAllRows] = useState<BusinessAccountRow[]>([]);
  const allRowsRef = useRef<BusinessAccountRow[]>([]);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [q, setQ] = useState("");
  const [headerFilters, setHeaderFilters] = useState<HeaderFilters>(
    DEFAULT_HEADER_FILTERS,
  );
  const [columnOrder, setColumnOrder] = useState<SortBy[]>(DEFAULT_COLUMN_ORDER);
  const [visibleColumns, setVisibleColumns] = useState<SortBy[]>(DEFAULT_COLUMN_ORDER);
  const [columnPrefsHydrated, setColumnPrefsHydrated] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<SortBy | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("companyName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const [syncElapsedMs, setSyncElapsedMs] = useState(0);
  const [lastSyncDurationMs, setLastSyncDurationMs] = useState<number | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<BusinessAccountRow | null>(null);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isCreateContactDrawerOpen, setIsCreateContactDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<BusinessAccountUpdateRequest | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingContact, setIsDeletingContact] = useState(false);
  const [inlineSavingRowKey, setInlineSavingRowKey] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlinePhoneDrafts, setInlinePhoneDrafts] = useState<Record<string, string>>({});
  const [inlineNotesDrafts, setInlineNotesDrafts] = useState<Record<string, string>>({});
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [isEmployeesLoading, setIsEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressLookupSuggestion[]>(
    [],
  );
  const [isAddressLookupLoading, setIsAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState<string | null>(null);
  const [addressLookupArmed, setAddressLookupArmed] = useState(false);
  const [isApplyingAddress, setIsApplyingAddress] = useState(false);
  const hydratingContactRowKeysRef = useRef(new Set<string>());
  const hydratedContactRowKeysRef = useRef(new Set<string>());
  const resolvingPrimaryAccountIdsRef = useRef(new Set<string>());
  const resolvedPrimaryAccountIdsRef = useRef(new Set<string>());
  const resolvingSalesRepAccountIdsRef = useRef(new Set<string>());
  const resolvedSalesRepAccountIdsRef = useRef(new Set<string>());
  const employeesFetchAttemptedRef = useRef(false);

  const debouncedQ = useDebouncedValue(q, 180);
  const debouncedHeaderFilters = useDebouncedValue(headerFilters, 180);
  const addressLookupSearchTerm = useMemo(
    () => buildAddressLookupSearchTerm(draft),
    [draft],
  );
  const debouncedAddressLookupSearchTerm = useDebouncedValue(addressLookupSearchTerm, 250);
  const addressLookupCountry = normalizeCountryDraftValue(draft?.country);
  const allRowsCountRef = useRef(0);

  async function loadSnapshotRows(signal?: AbortSignal) {
    const params = new URLSearchParams({
      sortBy: "companyName",
      sortDir: "asc",
      page: "1",
      pageSize: String(PAGE_SIZE),
      full: "1",
    });

    const [rowsResponse, statusResponse] = await Promise.all([
      fetch(`/api/business-accounts?${params.toString()}`, {
        cache: "no-store",
        signal,
      }),
      fetch("/api/sync/status", {
        cache: "no-store",
        signal,
      }),
    ]);

    const rowsPayload = await readJsonResponse<BusinessAccountsResponse | { error?: string }>(
      rowsResponse,
    );
    const statusPayload = await readJsonResponse<SyncStatusResponse | { error?: string }>(
      statusResponse,
    );

    if (!rowsResponse.ok) {
      throw new Error(parseError(rowsPayload));
    }
    if (!isBusinessAccountsResponse(rowsPayload)) {
      throw new Error("Unexpected response while loading account snapshot.");
    }

    if (statusResponse.ok && isSyncStatusResponse(statusPayload)) {
      setLastSyncedAt(statusPayload.lastSuccessfulSyncAt);
      if (!statusPayload.lastSuccessfulSyncAt && rowsPayload.items.length === 0) {
        setError("No local snapshot yet. Click Sync records to build the first snapshot.");
      }
    }

    return rowsPayload.items;
  }

  useEffect(() => {
    allRowsRef.current = allRows;
    allRowsCountRef.current = allRows.length;
  }, [allRows]);

  const deferredAllRows = useDeferredValue(allRows);

  const queryResult = useMemo(
    () =>
      queryBusinessAccounts(deferredAllRows, {
        q: debouncedQ,
        filterCompanyName: debouncedHeaderFilters.companyName,
        filterSalesRep: debouncedHeaderFilters.salesRepName,
        filterIndustryType: debouncedHeaderFilters.industryType,
        filterSubCategory: debouncedHeaderFilters.subCategory,
        filterCompanyRegion: debouncedHeaderFilters.companyRegion,
        filterWeek: debouncedHeaderFilters.week,
        filterAddress: debouncedHeaderFilters.address,
        filterCompanyPhone: debouncedHeaderFilters.companyPhone,
        filterPrimaryContactName: debouncedHeaderFilters.primaryContactName,
        filterPrimaryContactPhone: debouncedHeaderFilters.primaryContactPhone,
        filterPrimaryContactEmail: debouncedHeaderFilters.primaryContactEmail,
        filterNotes: debouncedHeaderFilters.notes,
        filterCategory: debouncedHeaderFilters.category || undefined,
        filterLastModified: debouncedHeaderFilters.lastModified,
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      }),
    [debouncedHeaderFilters, debouncedQ, deferredAllRows, page, sortBy, sortDir],
  );

  const rows = queryResult.items;
  const total = queryResult.total;
  const inlineSaveInProgress = inlineSavingRowKey !== null;
  const visibleColumnOrder = useMemo(
    () => columnOrder.filter((columnId) => visibleColumns.includes(columnId)),
    [columnOrder, visibleColumns],
  );
  const companyRegionOptions = useMemo(() => {
    const byValue = new Map<string, AttributeOption>();
    COMPANY_REGION_DEFAULT_OPTIONS.forEach((option) => {
      byValue.set(normalizeOptionComparable(option.value), option);
    });

    allRows.forEach((row) => {
      const normalized = normalizeRegionValue(row.companyRegion);
      if (!normalized) {
        return;
      }

      const key = normalizeOptionComparable(normalized);
      if (!byValue.has(key)) {
        byValue.set(key, { value: normalized, label: normalized });
      }
    });

    const draftValue = normalizeRegionValue(draft?.companyRegion);
    if (draftValue) {
      const key = normalizeOptionComparable(draftValue);
      if (!byValue.has(key)) {
        byValue.set(key, { value: draftValue, label: draftValue });
      }
    }

    return [...byValue.values()];
  }, [allRows, draft?.companyRegion]);
  const industryTypeOptions = useMemo(
    () => withCurrentOption(INDUSTRY_TYPE_OPTIONS, draft?.industryType),
    [draft?.industryType],
  );
  const subCategoryOptions = useMemo(
    () => withCurrentOption(SUB_CATEGORY_OPTIONS, draft?.subCategory),
    [draft?.subCategory],
  );
  const weekOptions = useMemo(
    () => withCurrentOption(WEEK_OPTIONS, draft?.week),
    [draft?.week],
  );
  const sortedEmployeeOptions = useMemo(() => {
    const fromRows = collectEmployeeOptionsFromRows(allRows);
    const merged = mergeEmployeeOptions(employeeOptions, fromRows);
    return merged.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
  }, [allRows, employeeOptions]);
  const createContactAccountOptions = useMemo(
    () => buildCreateContactAccountOptions(allRows),
    [allRows],
  );
  const selectedDrawerCompanyOption = useMemo(
    () => findCreateContactAccountOption(createContactAccountOptions, draft),
    [createContactAccountOptions, draft],
  );
  const filteredDrawerCompanyOptions = useMemo(() => {
    if (selectedDrawerCompanyOption) {
      return [];
    }

    const normalizedQuery = draft?.companyName.trim().toLowerCase() ?? "";
    if (!normalizedQuery) {
      return [];
    }

    return createContactAccountOptions
      .filter((option) =>
        [option.companyName, option.businessAccountId, option.address]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 12);
  }, [createContactAccountOptions, draft?.companyName, selectedDrawerCompanyOption]);
  const selectedSalesRepOption = useMemo(() => {
    if (!draft?.salesRepId) {
      return null;
    }

    return (
      findEmployeeById(sortedEmployeeOptions, draft.salesRepId) ?? {
        id: draft.salesRepId,
        name: draft.salesRepName ?? draft.salesRepId,
      }
    );
  }, [draft?.salesRepId, draft?.salesRepName, sortedEmployeeOptions]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [total]);
  const drawerNeedsCompanyAssignment = Boolean(
    selected &&
      !selected.businessAccountId.trim() &&
      (selected.contactId !== null ||
        (selected.primaryContactId !== null && selected.primaryContactId !== undefined)),
  );

  const paginationNumbers = useMemo(
    () => buildPaginationNumbers(page, totalPages),
    [page, totalPages],
  );
  const syncPercent = useMemo(() => {
    if (!syncProgress || !syncProgress.totalPages || syncProgress.totalPages <= 0) {
      return null;
    }

    return Math.min(
      100,
      Math.round((syncProgress.fetchedPages / syncProgress.totalPages) * 100),
    );
  }, [syncProgress]);

  useEffect(() => {
    if (!isSyncing || syncStartedAt === null) {
      return;
    }

    setSyncElapsedMs(Math.max(0, Date.now() - syncStartedAt));
    const interval = window.setInterval(() => {
      setSyncElapsedMs(Math.max(0, Date.now() - syncStartedAt));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isSyncing, syncStartedAt]);

  useEffect(() => {
    const columnStorageCandidates = [COLUMN_STORAGE_KEY, ...LEGACY_COLUMN_STORAGE_KEYS];
    for (const key of columnStorageCandidates) {
      try {
        const storedColumnOrder = window.localStorage.getItem(key);
        if (!storedColumnOrder) {
          continue;
        }
        const parsedColumnOrder = JSON.parse(storedColumnOrder) as unknown;
        if (isValidColumnOrder(parsedColumnOrder)) {
          setColumnOrder(parsedColumnOrder);
          break;
        }

        if (!isKnownColumnList(parsedColumnOrder)) {
          continue;
        }

        const migratedColumnOrder = [
          ...parsedColumnOrder,
          ...DEFAULT_COLUMN_ORDER.filter((column) => !parsedColumnOrder.includes(column)),
        ];
        setColumnOrder(migratedColumnOrder);
        break;
      } catch {
        // Ignore malformed localStorage values.
      }
    }

    const columnVisibilityCandidates = [
      COLUMN_VISIBILITY_STORAGE_KEY,
      ...LEGACY_COLUMN_VISIBILITY_STORAGE_KEYS,
    ];
    for (const key of columnVisibilityCandidates) {
      try {
        const storedVisibleColumns = window.localStorage.getItem(key);
        if (!storedVisibleColumns) {
          continue;
        }
        const parsedVisibleColumns = JSON.parse(storedVisibleColumns) as unknown;
        if (!isKnownColumnList(parsedVisibleColumns)) {
          continue;
        }

        const migratedVisibleColumns = [
          ...parsedVisibleColumns,
          ...DEFAULT_COLUMN_ORDER.filter((column) => !parsedVisibleColumns.includes(column)),
        ];
        setVisibleColumns(migratedVisibleColumns);
        break;
      } catch {
        // Ignore malformed localStorage values.
      }
    }

    setColumnPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!columnPrefsHydrated) {
      return;
    }

    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnOrder));
  }, [columnOrder, columnPrefsHydrated]);

  useEffect(() => {
    if (!columnPrefsHydrated) {
      return;
    }

    window.localStorage.setItem(
      COLUMN_VISIBILITY_STORAGE_KEY,
      JSON.stringify(visibleColumns),
    );
  }, [columnPrefsHydrated, visibleColumns]);

  useEffect(() => {
    if (!visibleColumns.includes(sortBy) && visibleColumnOrder.length > 0) {
      setSortBy(visibleColumnOrder[0]);
      setSortDir("asc");
    }
  }, [sortBy, visibleColumnOrder, visibleColumns]);

  useEffect(() => {
    const cachedDataset = readCachedDatasetFromStorage();
    if (cachedDataset && isBusinessAccountRows(cachedDataset.rows)) {
      allRowsCountRef.current = cachedDataset.rows.length;
      setAllRows(enforceSinglePrimaryPerAccountRows(cachedDataset.rows));
      setLastSyncedAt(cachedDataset.lastSyncedAt);
    } else {
      setLastSyncedAt(readCachedSyncMeta().lastSyncedAt);
    }

    setCacheHydrated(true);
  }, []);

  useEffect(() => {
    if (!cacheHydrated) {
      return;
    }

    if (isSyncing) {
      return;
    }

    const payload: CachedDataset = {
      rows: allRows,
      lastSyncedAt,
    };

    writeCachedDatasetToStorage(payload);
  }, [allRows, cacheHydrated, isSyncing, lastSyncedAt]);

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
          "Your Acumatica session has expired. Sign in again to refresh data or run sync.",
        );
        return;
      }

      // Avoid forcing a re-login on temporary auth probe failures (e.g. upstream 5xx).
      setSession({ authenticated: true, user: null });
      setError(
        "Acumatica session check is temporarily unavailable. You are still signed in with your existing cookie. Click 'Sync records' to retry; only sign in again if this keeps failing for a few minutes.",
      );
    }

    fetchSession().catch(() => {
      setSession({ authenticated: true, user: null });
      setError(
        "Acumatica session check is temporarily unavailable. You are still signed in with your existing cookie. Click 'Sync records' to retry; only sign in again if this keeps failing for a few minutes.",
      );
    });
  }, [router]);

  useEffect(() => {
    if (
      (!selected && !isCreateDrawerOpen) ||
      employeeOptions.length > 0 ||
      isEmployeesLoading ||
      employeesFetchAttemptedRef.current
    ) {
      return;
    }

    const controller = new AbortController();

    async function fetchEmployees() {
      employeesFetchAttemptedRef.current = true;
      setEmployeesError(null);
      setIsEmployeesLoading(true);

      try {
        const response = await fetch("/api/employees", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<EmployeeLookupResponse | { error?: string }>(
          response,
        );

        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        if (!isEmployeeLookupResponse(payload)) {
          throw new Error("Unexpected response while loading sales reps.");
        }

        if (controller.signal.aborted) {
          return;
        }

        setEmployeeOptions(payload.items);
      } catch (employeesRequestError) {
        if (controller.signal.aborted) {
          return;
        }

        setEmployeesError(
          employeesRequestError instanceof Error
            ? employeesRequestError.message
            : "Unable to load sales reps.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsEmployeesLoading(false);
        }
      }
    }

    void fetchEmployees();

    return () => controller.abort();
  }, [employeeOptions.length, isCreateDrawerOpen, isEmployeesLoading, selected]);

  useEffect(() => {
    if (!draft || draft.salesRepId || !draft.salesRepName || sortedEmployeeOptions.length === 0) {
      return;
    }

    const matchedEmployee = matchEmployeeByName(sortedEmployeeOptions, draft.salesRepName);
    if (!matchedEmployee) {
      return;
    }

    setDraft((current) =>
      current && !current.salesRepId
        ? {
            ...current,
            salesRepId: matchedEmployee.id,
            salesRepName: matchedEmployee.name,
          }
        : current,
    );
  }, [draft, sortedEmployeeOptions]);

  useEffect(() => {
    if (!session?.authenticated || !cacheHydrated) {
      return;
    }

    const controller = new AbortController();

    async function loadRows() {
      const startedAt = Date.now();
      setLoading(true);

      try {
        const nextRows = await loadSnapshotRows(controller.signal);
        if (controller.signal.aborted) {
          return;
        }

        setAllRows(enforceSinglePrimaryPerAccountRows(nextRows));
        setLastSyncDurationMs(Date.now() - startedAt);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load account snapshot.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadRows().catch(() => {
      setError("Failed to load account snapshot.");
      setLoading(false);
    });

    return () => controller.abort();
  }, [cacheHydrated, session?.authenticated, syncVersion]);

  useEffect(() => {
    if (!selected || !draft) {
      setAddressSuggestions([]);
      setAddressLookupError(null);
      setIsAddressLookupLoading(false);
      return;
    }

    if (!addressLookupArmed) {
      setIsAddressLookupLoading(false);
      return;
    }

    if (isApplyingAddress) {
      return;
    }

    if (debouncedAddressLookupSearchTerm.length < 3) {
      setAddressSuggestions([]);
      setAddressLookupError(null);
      setIsAddressLookupLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsAddressLookupLoading(true);
    setAddressLookupError(null);

    const params = new URLSearchParams({
      q: debouncedAddressLookupSearchTerm,
      country: addressLookupCountry,
    });

    fetch(`/api/address-complete?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readJsonResponse<AddressLookupResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isAddressLookupResponse(payload)) {
          throw new Error("Unexpected address lookup response.");
        }
        if (!controller.signal.aborted) {
          setAddressSuggestions(payload.items);
        }
      })
      .catch((lookupError) => {
        if (controller.signal.aborted) {
          return;
        }
        setAddressSuggestions([]);
        setAddressLookupError(
          lookupError instanceof Error ? lookupError.message : "Address lookup failed.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsAddressLookupLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    addressLookupArmed,
    addressLookupCountry,
    debouncedAddressLookupSearchTerm,
    draft,
    isApplyingAddress,
    selected,
  ]);

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }

    const controller = new AbortController();
    const pending = rows
      .filter((row) => {
        if (row.isPrimaryContact === false) {
          return false;
        }

        const rowKey = getRowKey(row);
        if (hydratingContactRowKeysRef.current.has(rowKey)) {
          return false;
        }
        if (hydratedContactRowKeysRef.current.has(rowKey)) {
          return false;
        }

        const missingName = !row.primaryContactName?.trim();
        const missingEmail = !row.primaryContactEmail?.trim();
        return missingName || missingEmail;
      })
      .slice(0, 8);

    if (pending.length === 0) {
      return;
    }

    pending.forEach((row) => {
      hydratingContactRowKeysRef.current.add(getRowKey(row));
    });

    async function hydrateVisibleContacts() {
      const queue = [...pending];
      const concurrency = 3;

      async function worker() {
        while (queue.length > 0) {
          const row = queue.shift();
          if (!row) {
            return;
          }

          const rowKey = getRowKey(row);
          const accountRecordId = row.accountRecordId ?? row.id;

          try {
            const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const payload = await readJsonResponse<
              BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
            >(response);
            if (!response.ok) {
              continue;
            }

            const refreshedRow = isBusinessAccountDetailResponse(payload)
              ? payload.row
              : isBusinessAccountRow(payload)
                ? payload
                : null;
            if (!refreshedRow) {
              continue;
            }

            if (controller.signal.aborted) {
              return;
            }

            setAllRows((currentRows) =>
              enforceSinglePrimaryPerAccountRows(
                currentRows.map((currentRow) =>
                  getRowKey(currentRow) === rowKey
                    ? mergeSyncedRows(currentRow, refreshedRow)
                    : currentRow,
                ),
              ),
            );
          } catch {
            // Ignore per-row hydration errors.
          } finally {
            hydratingContactRowKeysRef.current.delete(rowKey);
            // Mark as attempted to avoid repeatedly hammering the same row.
            // A full re-sync clears this set and retries again from fresh data.
            hydratedContactRowKeysRef.current.add(rowKey);
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, pending.length) },
          () => worker(),
        ),
      );
    }

    void hydrateVisibleContacts();

    return () => {
      controller.abort();
    };
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }

    const rowsByAccount = new Map<string, BusinessAccountRow[]>();
    rows.forEach((row) => {
      const accountRecordId = row.accountRecordId ?? row.id;
      const existing = rowsByAccount.get(accountRecordId);
      if (existing) {
        existing.push(row);
      } else {
        rowsByAccount.set(accountRecordId, [row]);
      }
    });

    const pendingAccountIds = [...rowsByAccount.entries()]
      .filter(([accountRecordId, accountRows]) => {
        const hasPrimaryContact = accountRows.some((row) => row.isPrimaryContact);

        if (
          resolvedPrimaryAccountIdsRef.current.has(accountRecordId) &&
          !hasPrimaryContact
        ) {
          resolvedPrimaryAccountIdsRef.current.delete(accountRecordId);
        }

        if (resolvingPrimaryAccountIdsRef.current.has(accountRecordId)) {
          return false;
        }

        if (resolvedPrimaryAccountIdsRef.current.has(accountRecordId)) {
          return false;
        }

        if (hasPrimaryContact) {
          resolvedPrimaryAccountIdsRef.current.add(accountRecordId);
          return false;
        }

        return accountRows.some((row) => row.contactId !== null && row.contactId !== undefined);
      })
      .slice(0, 6)
      .map(([accountRecordId]) => accountRecordId);

    if (pendingAccountIds.length === 0) {
      return;
    }

    pendingAccountIds.forEach((accountRecordId) => {
      resolvingPrimaryAccountIdsRef.current.add(accountRecordId);
    });

    const controller = new AbortController();

    async function resolveVisiblePrimaryContacts() {
      const queue = [...pendingAccountIds];
      const concurrency = 3;

      async function worker() {
        while (queue.length > 0) {
          const accountRecordId = queue.shift();
          if (!accountRecordId) {
            return;
          }

          try {
            const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const payload = await readJsonResponse<
              BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
            >(response);
            if (!response.ok) {
              continue;
            }

            const refreshedRow = isBusinessAccountDetailResponse(payload)
              ? payload.row
              : isBusinessAccountRow(payload)
                ? payload
                : null;
            if (!refreshedRow) {
              continue;
            }

            const normalizedTargetName = normalizeComparable(refreshedRow.primaryContactName);
            const normalizedTargetEmail = normalizeComparable(refreshedRow.primaryContactEmail);

            setAllRows((currentRows) => {
              const accountRows = currentRows.filter(
                (row) => (row.accountRecordId ?? row.id) === accountRecordId,
              );
              if (accountRows.length === 0) {
                return currentRows;
              }

              if (accountRows.some((row) => row.isPrimaryContact)) {
                return currentRows;
              }

              const byIdMatch =
                refreshedRow.primaryContactId !== null
                  ? accountRows.find(
                      (row) =>
                        row.contactId !== null &&
                        row.contactId !== undefined &&
                        row.contactId === refreshedRow.primaryContactId,
                    )
                  : undefined;
              const byEmailMatch =
                !byIdMatch && normalizedTargetEmail
                  ? accountRows.find(
                      (row) =>
                        normalizeComparable(row.primaryContactEmail) === normalizedTargetEmail,
                    )
                  : undefined;
              const byNameMatch =
                !byIdMatch && !byEmailMatch && normalizedTargetName
                  ? accountRows.find(
                      (row) =>
                        normalizeComparable(row.primaryContactName) === normalizedTargetName,
                    )
                  : undefined;

              const targetRow = byIdMatch ?? byEmailMatch ?? byNameMatch;
              if (!targetRow) {
                return currentRows;
              }

              const targetRowKey = getRowKey(targetRow);

              return enforceSinglePrimaryPerAccountRows(
                currentRows.map((row) => {
                  if ((row.accountRecordId ?? row.id) !== accountRecordId) {
                    return row;
                  }

                  const isPrimaryContact = getRowKey(row) === targetRowKey;
                  return {
                    ...row,
                    isPrimaryContact,
                    ...(isPrimaryContact
                      ? {
                          primaryContactId:
                            refreshedRow.primaryContactId ?? row.primaryContactId,
                          primaryContactName: pickPreferredContactName(
                            row.primaryContactName,
                            refreshedRow.primaryContactName,
                            row.companyName,
                          ),
                          primaryContactPhone: pickPreferredText(
                            row.primaryContactPhone,
                            refreshedRow.primaryContactPhone,
                          ),
                          primaryContactEmail: pickPreferredText(
                            row.primaryContactEmail,
                            refreshedRow.primaryContactEmail,
                          ),
                        }
                      : {}),
                  };
                }),
              );
            });
          } catch {
            // Ignore per-account primary resolution errors.
          } finally {
            resolvingPrimaryAccountIdsRef.current.delete(accountRecordId);
            resolvedPrimaryAccountIdsRef.current.add(accountRecordId);
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, pendingAccountIds.length) },
          () => worker(),
        ),
      );
    }

    void resolveVisiblePrimaryContacts();

    return () => {
      controller.abort();
    };
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }

    const pendingAccountIds = [
      ...new Set(
        rows
          .filter((row) => {
            const accountRecordId = row.accountRecordId ?? row.id;
            if (!accountRecordId) {
              return false;
            }

            if (hasText(row.salesRepName)) {
              resolvedSalesRepAccountIdsRef.current.add(accountRecordId);
              return false;
            }

            if (resolvingSalesRepAccountIdsRef.current.has(accountRecordId)) {
              return false;
            }

            if (resolvedSalesRepAccountIdsRef.current.has(accountRecordId)) {
              return false;
            }

            return true;
          })
          .map((row) => row.accountRecordId ?? row.id)
          .filter((accountRecordId): accountRecordId is string => Boolean(accountRecordId)),
      ),
    ].slice(0, 6);

    if (pendingAccountIds.length === 0) {
      return;
    }

    pendingAccountIds.forEach((accountRecordId) => {
      resolvingSalesRepAccountIdsRef.current.add(accountRecordId);
    });

    const controller = new AbortController();

    async function hydrateVisibleSalesReps() {
      const queue = [...pendingAccountIds];
      const concurrency = 3;

      async function worker() {
        while (queue.length > 0) {
          const accountRecordId = queue.shift();
          if (!accountRecordId) {
            return;
          }

          try {
            const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const payload = await readJsonResponse<
              BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
            >(response);
            if (!response.ok) {
              continue;
            }

            const refreshedRow = isBusinessAccountDetailResponse(payload)
              ? payload.row
              : isBusinessAccountRow(payload)
                ? payload
                : null;
            if (!refreshedRow) {
              continue;
            }

            if (controller.signal.aborted) {
              return;
            }

            setAllRows((currentRows) =>
              enforceSinglePrimaryPerAccountRows(
                currentRows.map((row) => {
                  if ((row.accountRecordId ?? row.id) !== accountRecordId) {
                    return row;
                  }

                  return {
                    ...row,
                    salesRepId: pickPreferredText(row.salesRepId, refreshedRow.salesRepId),
                    salesRepName: pickPreferredText(row.salesRepName, refreshedRow.salesRepName),
                  };
                }),
              ),
            );
          } catch {
            // Ignore per-account sales rep hydration errors.
          } finally {
            resolvingSalesRepAccountIdsRef.current.delete(accountRecordId);
            resolvedSalesRepAccountIdsRef.current.add(accountRecordId);
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, pendingAccountIds.length) },
          () => worker(),
        ),
      );
    }

    void hydrateVisibleSalesReps();

    return () => {
      controller.abort();
    };
  }, [rows]);

  useEffect(() => {
    setPage((currentPage) => Math.min(Math.max(1, currentPage), totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  function handleSort(column: SortBy) {
    setPage(1);
    if (sortBy === column) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(column);
    setSortDir("asc");
  }

  function updateHeaderFilter<K extends keyof HeaderFilters>(
    key: K,
    value: HeaderFilters[K],
  ) {
    setPage(1);
    setHeaderFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function clearAllFilters() {
    setPage(1);
    setQ("");
    setHeaderFilters(DEFAULT_HEADER_FILTERS);
  }

  async function handleSyncRecords() {
    hydratingContactRowKeysRef.current.clear();
    hydratedContactRowKeysRef.current.clear();
    resolvingPrimaryAccountIdsRef.current.clear();
    resolvedPrimaryAccountIdsRef.current.clear();
    resolvingSalesRepAccountIdsRef.current.clear();
    resolvedSalesRepAccountIdsRef.current.clear();
    setInlineNotesDrafts({});

    const startedAt = Date.now();
    setError(null);
    setIsSyncing(true);
    setSyncStartedAt(startedAt);
    setSyncElapsedMs(0);
    setSyncProgress({
      fetchedPages: 0,
      totalPages: null,
      fetchedRows: 0,
      totalRows: null,
    });

    try {
      const runResponse = await fetch("/api/sync/run", {
        method: "POST",
        cache: "no-store",
      });
      const runPayload = await readJsonResponse<{ error?: string }>(runResponse);
      if (!runResponse.ok) {
        throw new Error(parseError(runPayload));
      }

      while (true) {
        const statusResponse = await fetch("/api/sync/status", {
          cache: "no-store",
        });
        const statusPayload = await readJsonResponse<SyncStatusResponse | { error?: string }>(
          statusResponse,
        );

        if (!statusResponse.ok) {
          throw new Error(parseError(statusPayload));
        }
        if (!isSyncStatusResponse(statusPayload)) {
          throw new Error("Unexpected sync status response.");
        }

        setSyncProgress({
          fetchedPages: statusPayload.progress?.fetchedAccounts ?? 0,
          totalPages: statusPayload.progress?.totalAccounts ?? null,
          fetchedRows: statusPayload.rowsCount,
          totalRows: statusPayload.progress?.totalContacts ?? statusPayload.contactsCount,
        });

        if (statusPayload.status !== "running") {
          if (statusPayload.status === "failed") {
            throw new Error(statusPayload.lastError ?? "Sync failed.");
          }
          setLastSyncedAt(statusPayload.lastSuccessfulSyncAt);
          break;
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, 1000);
        });
      }

      setLastSyncDurationMs(Date.now() - startedAt);
      setSyncVersion((current) => current + 1);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Failed to sync records.");
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
      setSyncStartedAt(null);
      setSyncElapsedMs(0);
    }
  }

  function jumpToPage(nextPage: number) {
    setPage(Math.min(totalPages, Math.max(1, nextPage)));
  }

  function handlePageJump() {
    const parsed = Number(pageInput);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(page));
      return;
    }

    jumpToPage(Math.trunc(parsed));
  }

  function handleHeaderDragStart(event: DragEvent<HTMLTableCellElement>, column: SortBy) {
    setDraggedColumn(column);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", column);
  }

  function handleHeaderDragOver(event: DragEvent<HTMLTableCellElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleHeaderDrop(event: DragEvent<HTMLTableCellElement>, target: SortBy) {
    event.preventDefault();
    const sourceFromEvent = event.dataTransfer.getData("text/plain") as SortBy;
    const source = sourceFromEvent || draggedColumn;
    if (!source || !DEFAULT_COLUMN_ORDER.includes(source)) {
      return;
    }

    setColumnOrder((current) => reorderColumns(current, source, target));
  }

  function handleHeaderDragEnd() {
    setDraggedColumn(null);
  }

  function handleToggleColumn(column: SortBy) {
    setVisibleColumns((current) => {
      const isVisible = current.includes(column);
      if (isVisible) {
        if (current.length <= 1) {
          return current;
        }

        return current.filter((item) => item !== column);
      }

      return [...current, column];
    });
  }

  function handleShowAllColumns() {
    setVisibleColumns(DEFAULT_COLUMN_ORDER);
  }

  function openCreateDrawer() {
    setIsCreateContactDrawerOpen(false);
    closeDrawer();
    setEmployeesError(null);
    setIsCreateDrawerOpen(true);
  }

  function closeCreateDrawer() {
    setIsCreateDrawerOpen(false);
    if (employeeOptions.length === 0) {
      employeesFetchAttemptedRef.current = false;
    }
  }

  function openCreateContactDrawer() {
    setIsCreateDrawerOpen(false);
    closeDrawer();
    setIsCreateContactDrawerOpen(true);
  }

  function closeCreateContactDrawer() {
    setIsCreateContactDrawerOpen(false);
  }

  function handleAccountCreated(result: BusinessAccountCreateResponse) {
    setAllRows((currentRows) =>
      replaceRowsForAccount(
        currentRows,
        result.accountRows,
        result.businessAccountRecordId,
        result.businessAccountId,
      ),
    );
    setLastSyncedAt(new Date().toISOString());
    clearCachedMapData();
  }

  function handleContactCreated(
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) {
    setAllRows((currentRows) =>
      replaceRowsForAccount(
        currentRows,
        result.accountRows,
        result.businessAccountRecordId,
        result.businessAccountId,
      ),
    );
    setLastSyncedAt(new Date().toISOString());
    clearCachedMapData();
  }

  function closeDrawer() {
    setSelected(null);
    setDraft(null);
    setSaveError(null);
    setSaveNotice(null);
    setIsDeletingContact(false);
    setAddressSuggestions([]);
    setAddressLookupError(null);
    setIsAddressLookupLoading(false);
    setAddressLookupArmed(false);
    setIsApplyingAddress(false);
    if (employeeOptions.length === 0) {
      employeesFetchAttemptedRef.current = false;
    }
  }

  async function openDrawer(row: BusinessAccountRow) {
    setIsCreateDrawerOpen(false);
    setIsCreateContactDrawerOpen(false);
    setSelected(row);
    setDraft(buildDraft(row));
    setSaveError(null);
    setSaveNotice(null);
    setIsDeletingContact(false);
    setAddressSuggestions([]);
    setAddressLookupError(null);
    setIsAddressLookupLoading(false);
    setAddressLookupArmed(false);
    setIsApplyingAddress(false);
    setEmployeesError(null);

    try {
      const accountRecordId = row.accountRecordId ?? row.id;
      const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<
        BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
      >(response);

      if (response.status === 401) {
        setSaveError(
          "Your Acumatica session expired while loading this record. Sign in again and retry.",
        );
        return;
      }

      if (!response.ok) {
        setSaveError(parseError(payload));
        return;
      }

      const refreshedRow = isBusinessAccountDetailResponse(payload)
        ? (readDetailResponseRows(payload)
            ? findMatchingAccountRow(readDetailResponseRows(payload) ?? [], row) ?? payload.row
            : payload.row)
        : isBusinessAccountRow(payload)
          ? payload
          : null;

      if (!refreshedRow) {
        return;
      }

      const refreshedRows = readDetailResponseRows(payload);
      const canonicalAccountRecordId =
        refreshedRow.accountRecordId ?? refreshedRow.id ?? accountRecordId;
      const mergedRow =
        row.isPrimaryContact === false
          ? {
              ...row,
              ...refreshedRow,
              accountRecordId: canonicalAccountRecordId,
              rowKey: refreshedRow.rowKey ?? row.rowKey,
              contactId: refreshedRow.contactId ?? row.contactId,
              isPrimaryContact:
                refreshedRow.isPrimaryContact ?? row.isPrimaryContact,
              companyPhone: refreshedRow.companyPhone ?? row.companyPhone,
              phoneNumber: refreshedRow.phoneNumber ?? row.phoneNumber,
            }
          : {
              ...refreshedRow,
              accountRecordId: canonicalAccountRecordId,
            };

      if (refreshedRows && refreshedRows.length > 0) {
        setAllRows((currentRows) =>
          replaceRowsForAccount(
            currentRows,
            refreshedRows,
            canonicalAccountRecordId,
            refreshedRow.businessAccountId,
          ),
        );
      } else {
        setAllRows((currentRows) =>
          enforceSinglePrimaryPerAccountRows(
            currentRows.map((currentRow) =>
              getRowKey(currentRow) === getRowKey(row) ? mergedRow : currentRow,
            ),
          ),
        );
      }
      setSelected(mergedRow);
      setDraft(buildDraft(mergedRow));
    } catch {
      // Keep base row loaded in drawer if detail fetch fails.
    }
  }

  function handleSelectDrawerCompany(option: CreateContactAccountOption) {
    setDraft((current) =>
      current
        ? {
            ...current,
            companyName: option.companyName,
            assignedBusinessAccountRecordId: option.businessAccountRecordId,
            assignedBusinessAccountId: option.businessAccountId,
          }
        : current,
    );
    setSaveError(null);
    setSaveNotice(null);
  }

  function handleClearDrawerCompanySelection() {
    setDraft((current) =>
      current
        ? {
            ...current,
            companyName: "",
            assignedBusinessAccountRecordId: null,
            assignedBusinessAccountId: null,
          }
        : current,
    );
    setSaveError(null);
    setSaveNotice(null);
  }

  async function applyAddressSuggestion(suggestionId: string) {
    if (!selected || !draft || !suggestionId) {
      return;
    }

    setIsApplyingAddress(true);
    setAddressLookupArmed(false);
    setAddressLookupError(null);
    setSaveNotice(null);
    try {
      const params = new URLSearchParams({
        id: suggestionId,
        country: draft.country || "CA",
        addressLine1: draft.addressLine1,
        addressLine2: draft.addressLine2,
        city: draft.city,
        state: draft.state,
        postalCode: draft.postalCode,
      });

      const response = await fetch(`/api/address-complete?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<AddressRetrieveResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isAddressRetrieveResponse(payload)) {
        throw new Error("Unexpected address lookup response.");
      }

      setDraft((current) =>
        current
          ? {
              ...current,
              addressLine1: payload.address.addressLine1,
              addressLine2: payload.address.addressLine2,
              city: payload.address.city,
              state: payload.address.state,
              postalCode: payload.address.postalCode,
              country: normalizeCountryDraftValue(payload.address.country),
            }
          : current,
      );
      setAddressSuggestions([]);
      setSaveNotice(
        "Address autofill applied. Click Save to update this account in Acumatica.",
      );
    } catch (lookupError) {
      setAddressLookupError(
        lookupError instanceof Error ? lookupError.message : "Address lookup failed.",
      );
    } finally {
      setIsApplyingAddress(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/signin");
    router.refresh();
  }

  async function saveRowDraft(
    sourceRow: BusinessAccountRow,
    sourceDraft: BusinessAccountUpdateRequest,
    mode: "drawer" | "inline",
  ): Promise<boolean> {
    const sourceRowKey = getRowKey(sourceRow);
    const isInline = mode === "inline";

    if (isInline) {
      setInlineSavingRowKey(sourceRowKey);
      setInlineError(null);
      setSaveNotice(null);
    } else {
      setIsSaving(true);
      setSaveError(null);
      setSaveNotice(null);
    }

    let saved = false;
    try {
      const salesRepName = sourceDraft.salesRepName?.trim() ?? "";
      let effectiveDraft: BusinessAccountUpdateRequest = {
        ...sourceDraft,
        country: normalizeCountryDraftValue(sourceDraft.country),
      };

      if (!salesRepName) {
        effectiveDraft = {
          ...effectiveDraft,
          salesRepName: null,
          salesRepId: null,
        };
      } else if (!effectiveDraft.salesRepId) {
        const matchedEmployee = matchEmployeeByName(employeeOptions, salesRepName);
        if (!matchedEmployee) {
          throw new Error(
            "Select a valid Sales Rep from the list so Acumatica receives the correct employee ID.",
          );
        }

        effectiveDraft = {
          ...effectiveDraft,
          salesRepName: matchedEmployee.name,
          salesRepId: matchedEmployee.id,
        };
      }

      const accountRecordId = sourceRow.accountRecordId ?? sourceRow.id;
      const selectedBusinessAccountId = sourceRow.businessAccountId;
      const selectedContactId = sourceRow.contactId ?? sourceRow.primaryContactId ?? null;
      const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...effectiveDraft,
          targetContactId: effectiveDraft.targetContactId ?? selectedContactId,
        }),
      });

      const payload = await readJsonResponse<BusinessAccountRow | { error?: string }>(
        response,
      );

      if (response.status === 401) {
        throw new Error(
          "Your Acumatica session expired while saving. Sign in again, then retry the save.",
        );
      }

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!payload || typeof payload !== "object" || !("id" in payload)) {
        throw new Error("Unexpected response while saving.");
      }

      const updatedRow = payload as BusinessAccountRow;
      const updatedAccountRecordId =
        updatedRow.accountRecordId ?? updatedRow.id ?? accountRecordId;
      const updatedContactId = updatedRow.contactId ?? selectedContactId;
      const updatedPrimaryContactId = updatedRow.primaryContactId;
      const accountWasReassigned = updatedAccountRecordId !== accountRecordId;
      let reassignedAccountRows: BusinessAccountRow[] | null = null;

      if (accountWasReassigned) {
        try {
          const refreshResponse = await fetch(
            `/api/business-accounts/${encodeURIComponent(updatedAccountRecordId)}`,
            {
              cache: "no-store",
            },
          );
          const refreshPayload = await readJsonResponse<
            BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
          >(refreshResponse);

          if (!refreshResponse.ok) {
            throw new Error(parseError(refreshPayload));
          }

          reassignedAccountRows =
            readDetailResponseRows(refreshPayload) ??
            (() => {
              const refreshedRow = readDetailResponseRow(refreshPayload);
              return refreshedRow ? [refreshedRow] : null;
            })();
        } catch {
          reassignedAccountRows = null;
        }
      }

      if (accountWasReassigned) {
        setAllRows((currentRows) => {
          const withoutSourceAccount = currentRows.filter((row) => {
            const rowAccountRecordId = row.accountRecordId ?? row.id;
            if (rowAccountRecordId === accountRecordId) {
              return false;
            }

            return getRowKey(row) !== sourceRowKey;
          });

          if (reassignedAccountRows && reassignedAccountRows.length > 0) {
            return replaceRowsForAccount(
              withoutSourceAccount,
              reassignedAccountRows,
              updatedAccountRecordId,
              updatedRow.businessAccountId,
            );
          }

          const withoutTargetAccount = withoutSourceAccount.filter((row) => {
            const rowAccountRecordId = row.accountRecordId ?? row.id;
            if (rowAccountRecordId === updatedAccountRecordId) {
              return false;
            }

            return row.businessAccountId !== updatedRow.businessAccountId;
          });

          return enforceSinglePrimaryPerAccountRows([updatedRow, ...withoutTargetAccount]);
        });

        const selectedAfterSave =
          (reassignedAccountRows &&
            findMatchingAccountRow(reassignedAccountRows, {
              ...sourceRow,
              accountRecordId: updatedAccountRecordId,
              businessAccountId: updatedRow.businessAccountId,
              contactId: updatedContactId,
              primaryContactId: updatedPrimaryContactId,
            })) ??
          updatedRow;

        if (selected && getRowKey(selected) === sourceRowKey) {
          setSelected(selectedAfterSave);
          setAddressLookupArmed(false);
          setDraft(buildDraft(selectedAfterSave));
        }

        setLastSyncedAt(new Date().toISOString());
        clearCachedMapData();
        if (!isInline) {
          setSaveNotice("Saved to Acumatica.");
        }
        saved = true;
        return saved;
      }

      setAllRows((currentRows) =>
        enforceSinglePrimaryPerAccountRows(
          currentRows.map((row) => {
            const rowAccountRecordId = row.accountRecordId ?? row.id;
            const sameAccount =
              rowAccountRecordId === accountRecordId ||
            rowAccountRecordId === updatedAccountRecordId ||
            row.businessAccountId === selectedBusinessAccountId;
          if (!sameAccount) {
            return row;
          }

          const updatedCommon: BusinessAccountRow = {
            ...row,
            accountRecordId: updatedAccountRecordId,
            companyName: updatedRow.companyName,
            salesRepId: updatedRow.salesRepId,
            salesRepName: updatedRow.salesRepName,
            industryType: updatedRow.industryType,
            subCategory: updatedRow.subCategory,
            companyRegion: updatedRow.companyRegion,
            week: updatedRow.week,
            address: updatedRow.address,
            addressLine1: updatedRow.addressLine1,
            addressLine2: updatedRow.addressLine2,
            city: updatedRow.city,
            state: updatedRow.state,
            postalCode: updatedRow.postalCode,
            country: updatedRow.country,
            category: updatedRow.category,
            lastModifiedIso: updatedRow.lastModifiedIso,
            companyPhone: updatedRow.companyPhone ?? row.companyPhone,
            primaryContactId: updatedPrimaryContactId,
            isPrimaryContact:
              updatedPrimaryContactId !== null &&
              row.contactId !== null &&
              row.contactId !== undefined
                ? row.contactId === updatedPrimaryContactId
                : row.isPrimaryContact,
          };

          if (
            updatedContactId !== null &&
            row.contactId !== null &&
            row.contactId !== undefined &&
            row.contactId === updatedContactId
          ) {
            return {
              ...updatedCommon,
              contactId: updatedContactId,
              primaryContactName: updatedRow.primaryContactName,
              primaryContactPhone: updatedRow.primaryContactPhone,
              primaryContactEmail: updatedRow.primaryContactEmail,
              notes: updatedRow.notes,
            };
          }

            return updatedCommon;
          }),
        ),
      );

      const selectedMatchesSource =
        selected && getRowKey(selected) === sourceRowKey;
      if (selectedMatchesSource) {
        const selectedAfterSave: BusinessAccountRow = {
          ...sourceRow,
          accountRecordId: updatedAccountRecordId,
          contactId: updatedContactId,
          primaryContactId: updatedPrimaryContactId,
          isPrimaryContact:
            updatedPrimaryContactId !== null && updatedContactId !== null
              ? updatedPrimaryContactId === updatedContactId
              : sourceRow.isPrimaryContact,
          companyName: updatedRow.companyName,
          salesRepId: updatedRow.salesRepId,
          salesRepName: updatedRow.salesRepName,
          industryType: updatedRow.industryType,
          subCategory: updatedRow.subCategory,
          companyRegion: updatedRow.companyRegion,
          week: updatedRow.week,
          address: updatedRow.address,
          addressLine1: updatedRow.addressLine1,
          addressLine2: updatedRow.addressLine2,
          city: updatedRow.city,
          state: updatedRow.state,
          postalCode: updatedRow.postalCode,
          country: updatedRow.country,
          category: updatedRow.category,
          lastModifiedIso: updatedRow.lastModifiedIso,
          companyPhone: updatedRow.companyPhone ?? sourceRow.companyPhone,
          primaryContactName: updatedRow.primaryContactName,
          primaryContactPhone: updatedRow.primaryContactPhone,
          primaryContactEmail: updatedRow.primaryContactEmail,
          notes: updatedRow.notes,
        };

        setSelected(selectedAfterSave);
        setAddressLookupArmed(false);
        setDraft(buildDraft(selectedAfterSave));
      }

      if (!isInline) {
        setSaveNotice("Saved to Acumatica.");
      }
      setLastSyncedAt(new Date().toISOString());
      clearCachedMapData();
      saved = true;
    } catch (saveRequestError) {
      const message =
        saveRequestError instanceof Error
          ? saveRequestError.message
          : "Failed to save changes.";
      if (isInline) {
        setInlineError(message);
      } else {
        setSaveError(message);
      }
    } finally {
      if (isInline) {
        setInlineSavingRowKey((current) => (current === sourceRowKey ? null : current));
      } else {
        setIsSaving(false);
      }
    }

    return saved;
  }

  async function handleInlineSelectChange(
    row: BusinessAccountRow,
    columnId: InlineEditableColumn,
    rawValue: string,
  ) {
    const normalizedValue = rawValue.trim();
    const baseDraft = buildDraft(row);
    let patch: Partial<BusinessAccountUpdateRequest> = {};

    if (columnId === "industryType") {
      patch = {
        industryType:
          normalizedValue.length > 0
            ? normalizeOptionValue(INDUSTRY_TYPE_OPTIONS, normalizedValue)
            : null,
      };
    } else if (columnId === "subCategory") {
      patch = {
        subCategory:
          normalizedValue.length > 0
            ? normalizeOptionValue(SUB_CATEGORY_OPTIONS, normalizedValue)
            : null,
      };
    } else if (columnId === "companyRegion") {
      patch = {
        companyRegion:
          normalizedValue.length > 0 ? normalizeRegionValue(normalizedValue) : null,
      };
    } else if (columnId === "week") {
      patch = {
        week: normalizedValue.length > 0 ? normalizeWeekValue(normalizedValue) : null,
      };
    } else if (columnId === "category") {
      patch = {
        category: (normalizedValue || null) as Category | null,
      };
    }

    const nextDraft: BusinessAccountUpdateRequest = {
      ...baseDraft,
      ...patch,
      expectedLastModified: row.lastModifiedIso,
    };

    await saveRowDraft(row, nextDraft, "inline");
  }

  async function handleInlineMakePrimary(row: BusinessAccountRow) {
    const targetContactId = row.contactId ?? row.primaryContactId ?? null;
    if (targetContactId === null) {
      setInlineError("Contact must have ContactID to set as primary.");
      return;
    }

    const nextDraft: BusinessAccountUpdateRequest = {
      ...buildDraft(row),
      targetContactId,
      setAsPrimaryContact: true,
      primaryOnlyIntent: true,
      expectedLastModified: row.lastModifiedIso,
    };

    await saveRowDraft(row, nextDraft, "inline");
  }

  function handleInlinePhoneChange(rowKey: string, value: string) {
    setInlinePhoneDrafts((current) => ({
      ...current,
      [rowKey]: formatPhoneDraftValue(value),
    }));
  }

  async function handleInlinePhoneCommit(row: BusinessAccountRow, rowKey: string) {
    const draftValue = inlinePhoneDrafts[rowKey];
    if (draftValue === undefined) {
      return;
    }

    const currentValue = row.primaryContactPhone ?? "";
    if (draftValue === currentValue) {
      setInlinePhoneDrafts((current) => {
        const next = { ...current };
        delete next[rowKey];
        return next;
      });
      return;
    }

    const targetContactId = row.contactId ?? row.primaryContactId ?? null;
    if (targetContactId === null) {
      setInlineError("Contact ID is missing on this row. Phone cannot be saved.");
      return;
    }

    if (draftValue.trim().length > 0 && normalizePhoneForSave(draftValue) === null) {
      setInlineError("Phone number must use the format ###-###-####.");
      return;
    }

    const nextDraft: BusinessAccountUpdateRequest = {
      ...buildDraft(row),
      targetContactId,
      primaryContactPhone: draftValue,
      expectedLastModified: row.lastModifiedIso,
    };
    const saved = await saveRowDraft(row, nextDraft, "inline");
    if (!saved) {
      return;
    }

    setInlinePhoneDrafts((current) => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
  }

  function handleInlineNotesChange(rowKey: string, value: string) {
    setInlineNotesDrafts((current) => ({
      ...current,
      [rowKey]: value,
    }));
  }

  async function handleInlineNotesCommit(row: BusinessAccountRow, rowKey: string) {
    const draftValue = inlineNotesDrafts[rowKey];
    if (draftValue === undefined) {
      return;
    }

    const currentValue = row.notes ?? "";
    if (draftValue === currentValue) {
      setInlineNotesDrafts((current) => {
        const next = { ...current };
        delete next[rowKey];
        return next;
      });
      return;
    }

    const nextDraft: BusinessAccountUpdateRequest = {
      ...buildDraft(row),
      notes: draftValue,
      expectedLastModified: row.lastModifiedIso,
    };
    const saved = await saveRowDraft(row, nextDraft, "inline");
    if (!saved) {
      return;
    }

    setInlineNotesDrafts((current) => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
  }

  async function handleSave() {
    if (!selected || !draft) {
      return;
    }

    if (
      drawerNeedsCompanyAssignment &&
      draft.companyName.trim().length > 0 &&
      !draft.assignedBusinessAccountId
    ) {
      setSaveError("Select a business account from the list before saving.");
      return;
    }

    if (
      draft.primaryContactPhone !== null &&
      draft.primaryContactPhone.trim().length > 0 &&
      normalizePhoneForSave(draft.primaryContactPhone) === null
    ) {
      setSaveError("Phone number must use the format ###-###-####.");
      return;
    }

    await saveRowDraft(selected, draft, "drawer");
  }

  async function handleDeleteSelectedContact() {
    if (!selected) {
      return;
    }

    const contactId = selected.contactId ?? selected.primaryContactId ?? null;
    if (contactId === null) {
      setSaveError("This row has no contact ID, so it cannot be deleted.");
      return;
    }

    const contactLabel = selected.primaryContactName?.trim() || `Contact ${contactId}`;
    const confirmed = window.confirm(
      `Delete ${contactLabel} from Acumatica? This permanently removes the contact.`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingContact(true);
    setSaveError(null);
    setSaveNotice(null);

    try {
      const deleteResponse = await fetch(`/api/contacts/${contactId}`, {
        method: "DELETE",
      });
      const deletePayload = await readJsonResponse<{ error?: string }>(deleteResponse);
      if (!deleteResponse.ok) {
        throw new Error(parseError(deletePayload));
      }

      const accountRecordId = selected.accountRecordId ?? selected.id;
      let nextAccountRows: BusinessAccountRow[] | null = null;
      let deleteNotice = "Contact deleted from Acumatica.";

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
          readDetailResponseRows(refreshPayload) ??
          (() => {
            const refreshedRow = readDetailResponseRow(refreshPayload);
            return refreshedRow ? [refreshedRow] : null;
          })();
      } catch {
        const currentAccountRows = allRowsRef.current.filter((row) => {
          const rowAccountRecordId = row.accountRecordId ?? row.id;
          return (
            rowAccountRecordId === accountRecordId ||
            row.businessAccountId === selected.businessAccountId
          );
        });
        nextAccountRows = removeDeletedContactFromAccountRows(
          currentAccountRows,
          contactId,
          selected.rowKey ?? null,
        );
        deleteNotice =
          "Contact deleted from Acumatica. The account refresh failed, so the local view was updated conservatively.";
      }

      setAllRows((currentRows) =>
        replaceRowsForAccount(
          currentRows,
          nextAccountRows ?? [],
          accountRecordId,
          selected.businessAccountId,
        ),
      );
      setLastSyncedAt(new Date().toISOString());
      clearCachedMapData();

      const nextSelected =
        (nextAccountRows && findMatchingAccountRow(nextAccountRows, selected)) ??
        nextAccountRows?.[0] ??
        null;

      if (!nextSelected) {
        closeDrawer();
      } else {
        setSelected(nextSelected);
        setDraft(buildDraft(nextSelected));
        setSaveNotice(deleteNotice);
      }
    } catch (deleteError) {
      setSaveError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete contact.",
      );
    } finally {
      setIsDeletingContact(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <Image
            alt="MeadowBrook"
            className={styles.brandLogo}
            height={202}
            priority
            src="/mb-logo.png"
            width={712}
          />
          <p className={styles.kicker}>Sales Database Fixer</p>
          <h1 className={styles.title}>Business Accounts & Contacts</h1>
          <p className={styles.subtitle}>
            Company data synced live with Acumatica. Edit fields in the drawer and save.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.mapViewButton} href="/map">
            Map view
          </Link>
          <Link className={styles.mapViewButton} href="/quality">
            Data quality
          </Link>
          <span className={styles.userName}>{session?.user?.name ?? "Signed in"}</span>
          <button className={styles.logoutButton} onClick={handleLogout} type="button">
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.controls}>
        <label className={styles.controlField}>
          Global Search
          <input
            className={styles.controlInput}
            onChange={(event) => {
              setPage(1);
              setQ(event.target.value);
            }}
            placeholder="Company, sales rep, industry, region, address, contact, email, notes"
            value={q}
          />
        </label>

        <div className={styles.controlActions}>
          <button className={styles.newAccountButton} onClick={openCreateDrawer} type="button">
            New account
          </button>
          <button
            className={styles.newContactButton}
            onClick={openCreateContactDrawer}
            type="button"
          >
            New contact
          </button>
          <details className={styles.columnPicker}>
            <summary className={styles.columnPickerSummary}>Columns</summary>
            <div className={styles.columnPickerMenu}>
              <div className={styles.columnPickerHeader}>
                <strong>Show columns</strong>
                <button onClick={handleShowAllColumns} type="button">
                  Show all
                </button>
              </div>
              <div className={styles.columnPickerList}>
                {COLUMN_CONFIGS.map((column) => (
                  <label className={styles.columnPickerItem} key={column.id}>
                    <input
                      checked={visibleColumns.includes(column.id)}
                      disabled={
                        visibleColumns.length <= 1 && visibleColumns.includes(column.id)
                      }
                      onChange={() => handleToggleColumn(column.id)}
                      type="checkbox"
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
          <button
            className={styles.syncButton}
            disabled={isSyncing}
            onClick={handleSyncRecords}
            type="button"
          >
            {isSyncing ? "Syncing..." : "Sync records"}
          </button>
          <button className={styles.clearFiltersButton} onClick={clearAllFilters} type="button">
            Clear all filters
          </button>
        </div>
      </section>
      {syncProgress ? (
        <section className={styles.syncProgressSection}>
          <div className={styles.syncProgressHeader}>
            <strong>
              Syncing records
              {syncPercent === null ? "..." : `... ${syncPercent}%`}
            </strong>
            <span>
              {(syncProgress.totalPages
                ? `${syncProgress.fetchedPages} / ${syncProgress.totalPages} accounts`
                : "Preparing snapshot...") + ` • ${formatElapsedDuration(syncElapsedMs)}`}
            </span>
          </div>
          <div
            aria-label="Sync progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={syncPercent ?? undefined}
            className={styles.syncProgressBar}
            role="progressbar"
          >
            <div
              className={
                syncPercent === null
                  ? `${styles.syncProgressFill} ${styles.syncProgressFillIndeterminate}`
                  : styles.syncProgressFill
              }
              style={syncPercent === null ? undefined : { width: `${syncPercent}%` }}
            />
          </div>
          <p className={styles.syncProgressMeta}>
            Loaded {syncProgress.fetchedRows.toLocaleString()}
            {syncProgress.totalRows !== null
              ? ` of ${syncProgress.totalRows.toLocaleString()} records`
              : " records"}
          </p>
        </section>
      ) : null}

      <section className={styles.tableWrap}>
        {error ? <p className={styles.tableError}>{error}</p> : null}
        {inlineError ? <p className={styles.tableError}>{inlineError}</p> : null}
        <table className={styles.table}>
          <thead>
            <tr>
              {visibleColumnOrder.map((columnId) => {
                const config = getColumnConfig(columnId);
                const headerClass =
                  draggedColumn === columnId
                    ? `${styles.draggableHeader} ${styles.draggingHeader}`
                    : styles.draggableHeader;

                return (
                  <th
                    className={headerClass}
                    draggable
                    key={`header-${columnId}`}
                    onDragEnd={handleHeaderDragEnd}
                    onDragOver={handleHeaderDragOver}
                    onDragStart={(event) => handleHeaderDragStart(event, columnId)}
                    onDrop={(event) => handleHeaderDrop(event, columnId)}
                    title="Drag to reorder column"
                  >
                    <div className={styles.headerCell}>
                      <SortHeader
                        activeSort={{ sortBy, sortDir }}
                        column={columnId}
                        label={config.label}
                        onSort={handleSort}
                      />
                      <span className={styles.dragHandle} aria-hidden>
                        ⋮⋮
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
            <tr className={styles.filterRow}>
              {visibleColumnOrder.map((columnId) => {
                const config = getColumnConfig(columnId);
                const filterKey = config.filterKey;

                if (filterKey === "category") {
                  return (
                    <th key={`filter-${columnId}`}>
                      <select
                        className={styles.filterInput}
                        onChange={(event) =>
                          updateHeaderFilter(
                            "category",
                            (event.target.value as Category | "") || "",
                          )
                        }
                        value={headerFilters.category}
                      >
                        <option value="">All</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                      </select>
                    </th>
                  );
                }

                const filterValue = headerFilters[filterKey];
                return (
                  <th key={`filter-${columnId}`}>
                    <input
                      className={styles.filterInput}
                      onChange={(event) =>
                        updateHeaderFilter(
                          filterKey,
                          event.target.value as HeaderFilters[typeof filterKey],
                        )
                      }
                      placeholder={config.filterPlaceholder}
                      value={typeof filterValue === "string" ? filterValue : ""}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={styles.loadingCell} colSpan={visibleColumnOrder.length}>
                  Loading contacts...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className={styles.loadingCell} colSpan={visibleColumnOrder.length}>
                  No contacts found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const rowKey = getRowKey(row);
                const selectedClass =
                  selected && getRowKey(selected) === rowKey ? styles.selectedRow : "";

                return (
                  <tr
                    className={`${styles.dataRow} ${selectedClass}`.trim()}
                    key={rowKey}
                    onClick={() => {
                      void openDrawer(row);
                    }}
                  >
                    {visibleColumnOrder.map((columnId) => {
                      if (columnId === "primaryContactPhone") {
                        const inlinePhoneValue =
                          inlinePhoneDrafts[rowKey] ??
                          row.primaryContactPhone ??
                          "";
                        const canEditPhone =
                          (row.contactId ?? row.primaryContactId ?? null) !== null;
                        return (
                          <td
                            key={`${rowKey}-${columnId}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className={styles.inlineSelectWrap}>
                              <input
                                className={styles.inlineTextInput}
                                disabled={inlineSaveInProgress || !canEditPhone}
                                inputMode="numeric"
                                maxLength={12}
                                onBlur={() => {
                                  void handleInlinePhoneCommit(row, rowKey);
                                }}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  handleInlinePhoneChange(rowKey, event.target.value);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void handleInlinePhoneCommit(row, rowKey);
                                  }
                                }}
                                placeholder={
                                  canEditPhone ? "123-456-7890" : "No contact ID"
                                }
                                title="Phone number must use the format ###-###-####."
                                type="text"
                                value={inlinePhoneValue}
                              />
                              {inlineSavingRowKey === rowKey ? (
                                <span className={styles.inlineSavingText}>Saving...</span>
                              ) : null}
                            </div>
                          </td>
                        );
                      }

                      if (columnId === "notes") {
                        const inlineNotesValue = inlineNotesDrafts[rowKey] ?? (row.notes ?? "");
                        return (
                          <td
                            key={`${rowKey}-${columnId}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className={styles.inlineSelectWrap}>
                              <input
                                className={styles.inlineTextInput}
                                disabled={inlineSaveInProgress}
                                onBlur={() => {
                                  void handleInlineNotesCommit(row, rowKey);
                                }}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  handleInlineNotesChange(rowKey, event.target.value);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void handleInlineNotesCommit(row, rowKey);
                                  }
                                }}
                                placeholder="Add note and press Enter"
                                type="text"
                                value={inlineNotesValue}
                              />
                              {inlineSavingRowKey === rowKey ? (
                                <span className={styles.inlineSavingText}>Saving...</span>
                              ) : null}
                            </div>
                          </td>
                        );
                      }

                      if (isInlineEditableColumn(columnId)) {
                        let inlineOptions: AttributeOption[] = [];
                        let inlineValue = "";

                        if (columnId === "industryType") {
                          inlineOptions = withCurrentOption(
                            INDUSTRY_TYPE_OPTIONS,
                            row.industryType,
                          );
                          inlineValue =
                            normalizeOptionValue(INDUSTRY_TYPE_OPTIONS, row.industryType) ?? "";
                        } else if (columnId === "subCategory") {
                          inlineOptions = withCurrentOption(
                            SUB_CATEGORY_OPTIONS,
                            row.subCategory,
                          );
                          inlineValue =
                            normalizeOptionValue(SUB_CATEGORY_OPTIONS, row.subCategory) ?? "";
                        } else if (columnId === "companyRegion") {
                          inlineOptions = withCurrentOption(
                            companyRegionOptions,
                            row.companyRegion,
                          );
                          inlineValue = normalizeRegionValue(row.companyRegion) ?? "";
                        } else if (columnId === "week") {
                          inlineOptions = withCurrentOption(WEEK_OPTIONS, row.week);
                          inlineValue = normalizeWeekValue(row.week) ?? "";
                        } else if (columnId === "category") {
                          inlineOptions = CATEGORY_OPTIONS;
                          inlineValue = row.category ?? "";
                        }

                        return (
                          <td key={`${rowKey}-${columnId}`} onClick={(event) => event.stopPropagation()}>
                            <div className={styles.inlineSelectWrap}>
                              <select
                                className={styles.inlineSelect}
                                disabled={inlineSaveInProgress}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  void handleInlineSelectChange(
                                    row,
                                    columnId,
                                    event.target.value,
                                  );
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                value={inlineValue}
                              >
                                <option value="">Unassigned</option>
                                {inlineOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              {inlineSavingRowKey === rowKey ? (
                                <span className={styles.inlineSavingText}>Saving...</span>
                              ) : null}
                            </div>
                          </td>
                        );
                      }

                      if (columnId === "primaryContactName") {
                        const nameValue = row.primaryContactName?.trim() ?? "";
                        const contactUrl = buildAcumaticaContactUrl(
                          acumaticaBaseUrl,
                          row.contactId ?? row.primaryContactId ?? null,
                          acumaticaCompanyId,
                        );
                        const canMakePrimary =
                          row.isPrimaryContact !== true &&
                          row.contactId !== null &&
                          row.contactId !== undefined;
                        return (
                          <td
                            key={`${rowKey}-${columnId}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className={styles.contactCellWrap}>
                              <span className={styles.contactNameCell}>
                                {contactUrl && nameValue ? (
                                  <a
                                    className={styles.recordLink}
                                    href={contactUrl}
                                    onClick={(event) => event.stopPropagation()}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {nameValue}
                                  </a>
                                ) : (
                                  nameValue
                                )}
                                {row.isPrimaryContact ? (
                                  <span className={styles.primaryBadge}>(Primary)</span>
                                ) : null}
                              </span>
                              {canMakePrimary ? (
                                <button
                                  className={styles.makePrimaryButton}
                                  disabled={inlineSaveInProgress}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleInlineMakePrimary(row);
                                  }}
                                  type="button"
                                >
                                  {inlineSavingRowKey === rowKey ? "Saving..." : "Make Primary"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        );
                      }

                      if (columnId === "companyName") {
                        const companyUrl = buildAcumaticaBusinessAccountUrl(
                          acumaticaBaseUrl,
                          row.businessAccountId,
                          acumaticaCompanyId,
                        );
                        const companyLabel = renderColumnValue(row, columnId);

                        return (
                          <td
                            key={`${rowKey}-${columnId}`}
                            onClick={companyUrl ? (event) => event.stopPropagation() : undefined}
                          >
                            {companyUrl ? (
                              <a
                                className={styles.recordLink}
                                href={companyUrl}
                                onClick={(event) => event.stopPropagation()}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {companyLabel}
                              </a>
                            ) : (
                              companyLabel
                            )}
                          </td>
                        );
                      }

                      return (
                        <td key={`${rowKey}-${columnId}`}>{renderColumnValue(row, columnId)}</td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <footer className={styles.pagination}>
        <span className={styles.paginationSummary}>
          Page {page} of {totalPages} ({total} matching contacts, {allRows.length} loaded)
          {lastSyncedAt
            ? ` • Last sync ${new Date(lastSyncedAt).toLocaleTimeString()}`
            : ""}
          {lastSyncedAt && lastSyncDurationMs !== null
            ? ` • Duration ${formatElapsedDuration(lastSyncDurationMs)}`
            : ""}
        </span>
        <div className={styles.paginationButtons}>
          <button
            disabled={page <= 1}
            onClick={() => jumpToPage(1)}
            type="button"
          >
            First
          </button>
          <button
            disabled={page <= 1}
            onClick={() => jumpToPage(page - 1)}
            type="button"
          >
            Previous
          </button>
          {paginationNumbers.map((value, index) =>
            value === "ellipsis" ? (
              <span className={styles.pageEllipsis} key={`ellipsis-${index}`}>
                ...
              </span>
            ) : (
              <button
                className={value === page ? styles.activePageButton : ""}
                key={`page-${value}`}
                onClick={() => jumpToPage(value)}
                type="button"
              >
                {value}
              </button>
            ),
          )}
          <button
            disabled={page >= totalPages}
            onClick={() => jumpToPage(page + 1)}
            type="button"
          >
            Next
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => jumpToPage(totalPages)}
            type="button"
          >
            Last
          </button>
          <label className={styles.jumpToPage}>
            Go to
            <input
              max={totalPages}
              min={1}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handlePageJump();
                }
              }}
              type="number"
              value={pageInput}
            />
          </label>
          <button onClick={handlePageJump} type="button">
            Go
          </button>
        </div>
      </footer>

      <CreateBusinessAccountDrawer
        employeeOptions={sortedEmployeeOptions}
        isOpen={isCreateDrawerOpen}
        onAccountCreated={handleAccountCreated}
        onClose={closeCreateDrawer}
        onContactCreated={handleContactCreated}
      />
      <CreateContactDrawer
        accountOptions={createContactAccountOptions}
        isOpen={isCreateContactDrawerOpen}
        onClose={closeCreateContactDrawer}
        onContactCreated={handleContactCreated}
      />

      <aside className={`${styles.drawer} ${selected ? styles.drawerOpen : ""}`}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderContent}>
            <h2>{selected ? selected.companyName : "Account details"}</h2>
            {selected ? (
              <p className={styles.drawerRecordLinks}>
                {(() => {
                  const companyUrl = buildAcumaticaBusinessAccountUrl(
                    acumaticaBaseUrl,
                    selected.businessAccountId,
                    acumaticaCompanyId,
                  );
                  const contactUrl = buildAcumaticaContactUrl(
                    acumaticaBaseUrl,
                    selected.contactId ?? selected.primaryContactId ?? null,
                    acumaticaCompanyId,
                  );
                  const contactLabel = selected.primaryContactName?.trim();

                  return (
                    <>
                      {companyUrl ? (
                        <a
                          className={styles.recordLink}
                          href={companyUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open account in Acumatica
                        </a>
                      ) : null}
                      {contactUrl && contactLabel ? (
                        <>
                          {companyUrl ? <span>•</span> : null}
                          <a
                            className={styles.recordLink}
                            href={contactUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open contact in Acumatica
                          </a>
                        </>
                      ) : null}
                    </>
                  );
                })()}
              </p>
            ) : null}
          </div>
          <button
            className={styles.closeButton}
            onClick={closeDrawer}
            type="button"
          >
            Close
          </button>
        </div>

        {selected && draft ? (
          <div className={styles.drawerBody}>
            <label>
              Company Name
              {drawerNeedsCompanyAssignment ? (
                <>
                  <input
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, companyName: event.target.value } : current,
                      )
                    }
                    placeholder="Search company, account ID, or address"
                    value={draft.companyName}
                  />
                  <span className={styles.lookupHint}>
                    Choose the business account this contact should belong to before saving.
                  </span>
                  {selectedDrawerCompanyOption ? (
                    <div className={styles.selectedAccountCard}>
                      <strong>{selectedDrawerCompanyOption.companyName}</strong>
                      <span>Account ID {selectedDrawerCompanyOption.businessAccountId}</span>
                      <span>{selectedDrawerCompanyOption.address}</span>
                      <button
                        className={styles.secondaryButton}
                        onClick={handleClearDrawerCompanySelection}
                        type="button"
                      >
                        Change account
                      </button>
                    </div>
                  ) : filteredDrawerCompanyOptions.length > 0 ? (
                    <div className={styles.lookupSuggestions}>
                      {filteredDrawerCompanyOptions.map((option) => (
                        <button
                          className={styles.lookupSuggestionItem}
                          key={option.businessAccountRecordId}
                          onClick={() => {
                            handleSelectDrawerCompany(option);
                          }}
                          type="button"
                        >
                          <span className={styles.lookupSuggestionTitle}>
                            {option.companyName}
                          </span>
                          <span className={styles.lookupSuggestionMeta}>
                            {option.businessAccountId}
                          </span>
                          <span className={styles.lookupSuggestionMeta}>{option.address}</span>
                        </button>
                      ))}
                    </div>
                  ) : draft.companyName.trim().length > 0 ? (
                    <span className={styles.lookupHint}>
                      No matching business accounts were found.
                    </span>
                  ) : null}
                  {createContactAccountOptions.length === 0 ? (
                    <span className={styles.lookupHint}>
                      No business accounts are loaded yet. Sync records first.
                    </span>
                  ) : null}
                </>
              ) : (
                <input
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, companyName: event.target.value } : current,
                    )
                  }
                  value={draft.companyName}
                />
              )}
            </label>

            <h3>Sales Rep</h3>
            <label>
              Sales Rep
              <select
                onChange={(event) =>
                  setDraft((current) => {
                    if (!current) {
                      return current;
                    }

                    const nextSalesRepId = event.target.value.trim();
                    const matchedEmployee = findEmployeeById(
                      sortedEmployeeOptions,
                      nextSalesRepId,
                    );

                    return {
                      ...current,
                      salesRepId: matchedEmployee?.id ?? null,
                      salesRepName: matchedEmployee?.name ?? null,
                    };
                  })
                }
                value={draft.salesRepId ?? ""}
              >
                <option value="">Unassigned</option>
                {selectedSalesRepOption &&
                !findEmployeeById(sortedEmployeeOptions, selectedSalesRepOption.id) ? (
                  <option value={selectedSalesRepOption.id}>{selectedSalesRepOption.name}</option>
                ) : null}
                {sortedEmployeeOptions.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
              {isEmployeesLoading ? (
                <span className={styles.lookupLoading}>Loading sales reps...</span>
              ) : null}
              {employeesError ? <span className={styles.lookupError}>{employeesError}</span> : null}
              {draft.salesRepId ? (
                <span className={styles.lookupHint}>Employee ID: {draft.salesRepId}</span>
              ) : null}
              {!isEmployeesLoading && !employeesError ? (
                <span className={styles.lookupHint}>
                  Choose a Sales Rep from the employee list to update Acumatica owner.
                </span>
              ) : null}
            </label>

            <h3>Address</h3>
            <label>
              Address Line 1
              <input
                onChange={(event) => {
                  setAddressLookupArmed(true);
                  setDraft((current) =>
                    current ? { ...current, addressLine1: event.target.value } : current,
                  );
                }}
                value={draft.addressLine1}
              />
              <span className={styles.lookupHint}>
                Type address and select a suggestion. Save writes the address to Acumatica.
              </span>
              {isAddressLookupLoading ? (
                <span className={styles.lookupLoading}>Looking up suggestions...</span>
              ) : null}
              {addressLookupError ? (
                <span className={styles.lookupError}>{addressLookupError}</span>
              ) : null}
              {addressSuggestions.length > 0 ? (
                <div className={styles.lookupSuggestions}>
                  {addressSuggestions.map((suggestion) => (
                    <button
                      className={styles.lookupSuggestionItem}
                      key={suggestion.id}
                      onClick={() => {
                        void applyAddressSuggestion(suggestion.id);
                      }}
                      type="button"
                    >
                      <span className={styles.lookupSuggestionTitle}>{suggestion.text}</span>
                      <span className={styles.lookupSuggestionMeta}>
                        {suggestion.description}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
            <label>
              Unit Number
              <input
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, addressLine2: event.target.value } : current,
                  )
                }
                value={draft.addressLine2}
              />
            </label>
            <label>
              City
              <input
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, city: event.target.value } : current,
                  )
                }
                value={draft.city}
              />
            </label>
            <label>
              Province/State
              <input
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, state: event.target.value } : current,
                  )
                }
                value={draft.state}
              />
            </label>
            <label>
              Postal Code
              <input
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, postalCode: event.target.value } : current,
                  )
                }
                value={draft.postalCode}
              />
            </label>
            <h3>Contact</h3>
            {!selected.contactId ? (
              <p className={styles.readOnlyNotice}>
                This row is not linked to a contact ID yet, so contact fields cannot be saved.
              </p>
            ) : null}
            <label>
              Name
              <input
                disabled={!selected.contactId}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, primaryContactName: event.target.value }
                      : current,
                  )
                }
                value={draft.primaryContactName ?? ""}
              />
            </label>
            <label>
              Phone
              <input
                disabled={!selected.contactId}
                inputMode="numeric"
                maxLength={12}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          primaryContactPhone: formatPhoneDraftValue(event.target.value),
                        }
                      : current,
                  )
                }
                placeholder="123-456-7890"
                title="Phone number must use the format ###-###-####."
                value={draft.primaryContactPhone ?? ""}
              />
            </label>
            <label>
              Email
              <input
                disabled={!selected.contactId}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, primaryContactEmail: event.target.value }
                      : current,
                  )
                }
                value={draft.primaryContactEmail ?? ""}
              />
            </label>
            <label className={styles.inlineCheckbox}>
              <input
                checked={
                  selected.isPrimaryContact === true
                    ? true
                    : Boolean(draft.setAsPrimaryContact)
                }
                disabled={!selected.contactId || selected.isPrimaryContact === true}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          setAsPrimaryContact: event.target.checked,
                        }
                      : current,
                  )
                }
                type="checkbox"
              />
              {selected.isPrimaryContact
                ? "This contact is currently the primary contact."
                : "Set this contact as primary contact"}
            </label>

            <h3>Attributes</h3>
            <label>
              Industry Type
              <select
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          industryType: event.target.value || null,
                        }
                      : current,
                  )
                }
                value={draft.industryType ?? ""}
              >
                <option value="">Unassigned</option>
                {industryTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Sub-Category
              <select
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          subCategory: event.target.value || null,
                        }
                      : current,
                  )
                }
                value={draft.subCategory ?? ""}
              >
                <option value="">Unassigned</option>
                {subCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Company Region
              <select
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          companyRegion: event.target.value || null,
                        }
                      : current,
                  )
                }
                value={draft.companyRegion ?? ""}
              >
                <option value="">Unassigned</option>
                {companyRegionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Week
              <select
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          week: event.target.value || null,
                        }
                      : current,
                  )
                }
                value={draft.week ?? ""}
              >
                <option value="">Unassigned</option>
                {weekOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Category
              <select
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          category: (event.target.value || null) as Category | null,
                        }
                      : current,
                  )
                }
                value={draft.category ?? ""}
              >
                <option value="">Unassigned</option>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Contact Notes
              <textarea
                disabled={!selected.contactId}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, notes: event.target.value } : current,
                  )
                }
                rows={5}
                value={draft.notes ?? ""}
              />
            </label>

            <p className={styles.lastModified}>Last modified: {formatLastModified(selected.lastModifiedIso)}</p>

            {saveError ? <p className={styles.saveError}>{saveError}</p> : null}
            {saveNotice ? <p className={styles.saveNotice}>{saveNotice}</p> : null}

            <div className={styles.drawerActions}>
              <button
                className={styles.saveButton}
                disabled={isSaving || isDeletingContact}
                onClick={handleSave}
                type="button"
              >
                {isSaving ? "Saving..." : "Save changes"}
              </button>
              <button
                className={styles.deleteContactButton}
                disabled={
                  isSaving ||
                  isDeletingContact ||
                  (selected.contactId ?? selected.primaryContactId ?? null) === null
                }
                onClick={handleDeleteSelectedContact}
                type="button"
              >
                {isDeletingContact ? "Deleting..." : "Delete contact"}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.drawerBody}>
            <p>Select a row to view or edit details.</p>
          </div>
        )}
      </aside>

      {selected ? <button className={styles.backdrop} onClick={closeDrawer} type="button" /> : null}
    </main>
  );
}
