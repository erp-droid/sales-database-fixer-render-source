"use client";

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { queryBusinessAccounts } from "@/lib/business-accounts";

import styles from "./accounts-client.module.css";

const PAGE_SIZE = 25;
const DATASET_STORAGE_KEY = "businessAccounts.dataset.v3";
const LEGACY_DATASET_STORAGE_KEYS = [
  "businessAccounts.dataset.v2",
  "businessAccounts.dataset.v1",
] as const;

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
};

type CachedDataset = {
  rows: BusinessAccountRow[];
  lastSyncedAt: string | null;
};

type SyncBatchResponse = BusinessAccountsResponse & {
  hasMore?: boolean;
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

type HeaderFilters = {
  companyName: string;
  salesRepName: string;
  industryType: string;
  subCategory: string;
  companyRegion: string;
  week: string;
  address: string;
  primaryContactName: string;
  primaryContactPhone: string;
  primaryContactEmail: string;
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
  primaryContactName: "",
  primaryContactPhone: "",
  primaryContactEmail: "",
  category: "",
  lastModified: "",
};

const COLUMN_STORAGE_KEY = "businessAccounts.columnOrder.v1";
const COLUMN_VISIBILITY_STORAGE_KEY = "businessAccounts.visibleColumns.v1";

type ColumnConfig = {
  id: SortBy;
  label: string;
  filterKey: keyof HeaderFilters;
  filterPlaceholder: string;
};

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

function isValidVisibleColumns(value: unknown): value is SortBy[] {
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

function buildDraft(row: BusinessAccountRow): BusinessAccountUpdateRequest {
  return {
    companyName: row.companyName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    salesRepId: row.salesRepId ?? null,
    salesRepName: row.salesRepName ?? null,
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
  const incomingIsPrimary = incoming.isPrimaryContact === true;
  const incomingExplicitlyNotPrimary = incoming.isPrimaryContact === false;
  const existingIsPrimary = existing.isPrimaryContact === true;
  const mergedIsPrimary =
    incomingIsPrimary ||
    (existingIsPrimary && incomingExplicitlyNotPrimary)
      ? true
      : incoming.isPrimaryContact ?? existing.isPrimaryContact;

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
  return typeof rowRecord.id === "string";
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
    case "primaryContactName":
      return row.primaryContactName?.trim() ?? "";
    case "primaryContactPhone":
      return renderCell(row.phoneNumber ?? row.primaryContactPhone);
    case "primaryContactEmail":
      return renderCell(row.primaryContactEmail);
    case "category":
      return renderCell(row.category);
    case "lastModifiedIso":
      return formatLastModified(row.lastModifiedIso);
    default:
      return "-";
  }
}

function getRowKey(row: BusinessAccountRow, index = 0): string {
  return (
    row.rowKey ??
    `${row.accountRecordId ?? row.id}:${row.contactId ?? "contact"}:${index}`
  );
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

export function AccountsClient() {
  const router = useRouter();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [allRows, setAllRows] = useState<BusinessAccountRow[]>([]);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [q, setQ] = useState("");
  const [headerFilters, setHeaderFilters] = useState<HeaderFilters>(
    DEFAULT_HEADER_FILTERS,
  );
  const [columnOrder, setColumnOrder] = useState<SortBy[]>(DEFAULT_COLUMN_ORDER);
  const [visibleColumns, setVisibleColumns] = useState<SortBy[]>(DEFAULT_COLUMN_ORDER);
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
  const [draft, setDraft] = useState<BusinessAccountUpdateRequest | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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
  const addressLookupCountry = draft?.country || "CA";
  const allRowsCountRef = useRef(0);

  const queryResult = useMemo(
    () =>
      queryBusinessAccounts(allRows, {
        q: debouncedQ,
        filterCompanyName: debouncedHeaderFilters.companyName,
        filterSalesRep: debouncedHeaderFilters.salesRepName,
        filterIndustryType: debouncedHeaderFilters.industryType,
        filterSubCategory: debouncedHeaderFilters.subCategory,
        filterCompanyRegion: debouncedHeaderFilters.companyRegion,
        filterWeek: debouncedHeaderFilters.week,
        filterAddress: debouncedHeaderFilters.address,
        filterPrimaryContactName: debouncedHeaderFilters.primaryContactName,
        filterPrimaryContactPhone: debouncedHeaderFilters.primaryContactPhone,
        filterPrimaryContactEmail: debouncedHeaderFilters.primaryContactEmail,
        filterCategory: debouncedHeaderFilters.category || undefined,
        filterLastModified: debouncedHeaderFilters.lastModified,
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      }),
    [allRows, debouncedHeaderFilters, debouncedQ, page, sortBy, sortDir],
  );

  const rows = queryResult.items;
  const total = queryResult.total;
  const visibleColumnOrder = useMemo(
    () => columnOrder.filter((columnId) => visibleColumns.includes(columnId)),
    [columnOrder, visibleColumns],
  );

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [total]);

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
    try {
      const stored = window.localStorage.getItem(COLUMN_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as unknown;
      if (isValidColumnOrder(parsed)) {
        setColumnOrder(parsed);
      }
    } catch {
      // Ignore malformed localStorage values.
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as unknown;
      if (isValidVisibleColumns(parsed)) {
        setVisibleColumns(parsed);
      }
    } catch {
      // Ignore malformed localStorage values.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    window.localStorage.setItem(
      COLUMN_VISIBILITY_STORAGE_KEY,
      JSON.stringify(visibleColumns),
    );
  }, [visibleColumns]);

  useEffect(() => {
    if (!visibleColumns.includes(sortBy) && visibleColumnOrder.length > 0) {
      setSortBy(visibleColumnOrder[0]);
      setSortDir("asc");
    }
  }, [sortBy, visibleColumnOrder, visibleColumns]);

  useEffect(() => {
    const candidateKeys = [DATASET_STORAGE_KEY, ...LEGACY_DATASET_STORAGE_KEYS];
    for (const key of candidateKeys) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
          continue;
        }

        const parsed = JSON.parse(raw) as Partial<CachedDataset>;
        if (!isBusinessAccountRows(parsed.rows)) {
          continue;
        }

        allRowsCountRef.current = parsed.rows.length;
        setAllRows(parsed.rows);
        setLastSyncedAt(
          typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
        );
        break;
      } catch {
        // Ignore malformed cached dataset and try next key.
      }
    }

    setCacheHydrated(true);
  }, []);

  useEffect(() => {
    if (!cacheHydrated) {
      return;
    }

    const payload: CachedDataset = {
      rows: allRows,
      lastSyncedAt,
    };

    try {
      window.localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore cache write failures (e.g. quota exceeded).
    }
  }, [allRows, cacheHydrated, lastSyncedAt]);

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
          "Unable to validate your Acumatica session right now. Your cookie is still present; try refreshing data again.",
        );
        return;
      }

      // Avoid forcing a re-login on temporary auth probe failures (e.g. upstream 5xx).
      setSession({ authenticated: true, user: null });
      setError(
        "Session check is temporarily unavailable. Continuing with your existing session.",
      );
    }

    fetchSession().catch(() => {
      setSession({ authenticated: true, user: null });
      setError(
        "Session check is temporarily unavailable. Continuing with your existing session.",
      );
    });
  }, [router]);

  useEffect(() => {
    if (
      !selected ||
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
  }, [employeeOptions.length, isEmployeesLoading, selected]);

  useEffect(() => {
    if (!session?.authenticated || !cacheHydrated) {
      return;
    }

    const isInitialSync = syncVersion === 0;
    if (isInitialSync && allRowsCountRef.current > 0) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function syncRows() {
      const startedAt = Date.now();
      if (isInitialSync) {
        setLoading(true);
      }
      setIsSyncing(true);
      setSyncStartedAt(startedAt);
      setSyncElapsedMs(0);
      setSyncProgress({
        fetchedPages: 0,
        totalPages: null,
        fetchedRows: 0,
        totalRows: null,
      });
      setError(null);

      try {
        const deduped = new Map<string, BusinessAccountRow>();
        const pageSize = 120;
        const pageDelayMs = 120;
        let currentPage = 1;
        let hasMore = true;

        while (hasMore) {
          const params = new URLSearchParams({
            sortBy: "companyName",
            sortDir: "asc",
            page: String(currentPage),
            pageSize: String(pageSize),
            sync: "1",
          });

          const response = await fetch(`/api/business-accounts?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          });

          const payload = await readJsonResponse<SyncBatchResponse | { error?: string }>(
            response,
          );

          if (response.status === 401) {
            throw new Error(
              "Acumatica rejected the sync request. Click Sync records to try again.",
            );
          }

          if (!response.ok) {
            throw new Error(parseError(payload));
          }

          if (!isBusinessAccountsResponse(payload)) {
            throw new Error("Unexpected response while syncing records.");
          }

          const syncPayload = payload as SyncBatchResponse;
          syncPayload.items.forEach((row, index) => {
            const rowKey = getRowKey(row, index);
            const existing = deduped.get(rowKey);
            deduped.set(rowKey, existing ? mergeSyncedRows(existing, row) : row);
          });

          if (!controller.signal.aborted) {
            const nextRows = Array.from(deduped.values());
            setAllRows((currentRows) => {
              const currentByKey = new Map<string, BusinessAccountRow>();
              currentRows.forEach((row, index) => {
                currentByKey.set(getRowKey(row, index), row);
              });

              return nextRows.map((row, index) => {
                const current = currentByKey.get(getRowKey(row, index));
                return current ? mergeSyncedRows(current, row) : row;
              });
            });
            setLoading(false);
            setSyncProgress({
              fetchedPages: currentPage,
              totalPages: syncPayload.hasMore ? null : currentPage,
              fetchedRows: deduped.size,
              totalRows: syncPayload.hasMore ? null : deduped.size,
            });
          }

          const hasMoreFlag =
            typeof syncPayload.hasMore === "boolean"
              ? syncPayload.hasMore
              : syncPayload.items.length >= pageSize;
          hasMore = hasMoreFlag && syncPayload.items.length > 0;
          if (hasMore) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, pageDelayMs);
            });
          }
          currentPage += 1;
        }

        if (!controller.signal.aborted) {
          const nextRows = Array.from(deduped.values());
          setAllRows((currentRows) => {
            const currentByKey = new Map<string, BusinessAccountRow>();
            currentRows.forEach((row, index) => {
              currentByKey.set(getRowKey(row, index), row);
            });

            return nextRows.map((row, index) => {
              const current = currentByKey.get(getRowKey(row, index));
              return current ? mergeSyncedRows(current, row) : row;
            });
          });
          setLastSyncedAt(new Date().toISOString());
          setLastSyncDurationMs(Date.now() - startedAt);
        }
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Failed to sync data.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setIsSyncing(false);
          setSyncProgress(null);
          setSyncStartedAt(null);
          setSyncElapsedMs(0);
        }
      }
    }

    syncRows().catch(() => {
      setError("Failed to sync data.");
      setLoading(false);
      setIsSyncing(false);
      setSyncProgress(null);
      setSyncStartedAt(null);
      setSyncElapsedMs(0);
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
              currentRows.map((currentRow) =>
                getRowKey(currentRow) === rowKey
                  ? mergeSyncedRows(currentRow, refreshedRow)
                  : currentRow,
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

              return currentRows.map((row) => {
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
              });
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

  function handleSyncRecords() {
    hydratingContactRowKeysRef.current.clear();
    hydratedContactRowKeysRef.current.clear();
    resolvingPrimaryAccountIdsRef.current.clear();
    resolvedPrimaryAccountIdsRef.current.clear();
    resolvingSalesRepAccountIdsRef.current.clear();
    resolvedSalesRepAccountIdsRef.current.clear();
    setSyncVersion((current) => current + 1);
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

  function closeDrawer() {
    setSelected(null);
    setDraft(null);
    setSaveError(null);
    setSaveNotice(null);
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
    setSelected(row);
    setDraft(buildDraft(row));
    setSaveError(null);
    setSaveNotice(null);
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
          "Acumatica rejected this request. Your session cookie is still kept; please retry.",
        );
        return;
      }

      if (!response.ok) {
        setSaveError(parseError(payload));
        return;
      }

      const refreshedRow = isBusinessAccountDetailResponse(payload)
        ? payload.row
        : isBusinessAccountRow(payload)
          ? payload
          : null;

      if (!refreshedRow) {
        return;
      }

      const canonicalAccountRecordId =
        refreshedRow.accountRecordId ?? refreshedRow.id ?? accountRecordId;
      const preserveMetadata = {
        accountRecordId: canonicalAccountRecordId,
        rowKey: row.rowKey,
        contactId: row.contactId,
        isPrimaryContact: row.isPrimaryContact,
        phoneNumber: row.phoneNumber,
      };

      const mergedRow =
        row.isPrimaryContact === false
          ? {
              ...row,
              accountRecordId: canonicalAccountRecordId,
              companyName: refreshedRow.companyName,
              salesRepId: refreshedRow.salesRepId,
              salesRepName: refreshedRow.salesRepName,
              industryType: refreshedRow.industryType,
              subCategory: refreshedRow.subCategory,
              companyRegion: refreshedRow.companyRegion,
              week: refreshedRow.week,
              address: refreshedRow.address,
              addressLine1: refreshedRow.addressLine1,
              addressLine2: refreshedRow.addressLine2,
              city: refreshedRow.city,
              state: refreshedRow.state,
              postalCode: refreshedRow.postalCode,
              country: refreshedRow.country,
              category: refreshedRow.category,
              lastModifiedIso: refreshedRow.lastModifiedIso,
            }
          : {
              ...refreshedRow,
              ...preserveMetadata,
            };

      setAllRows((currentRows) =>
        currentRows.map((currentRow) =>
          getRowKey(currentRow) === getRowKey(row) ? mergedRow : currentRow,
        ),
      );
      setSelected(mergedRow);
      setDraft(buildDraft(mergedRow));
    } catch {
      // Keep base row loaded in drawer if detail fetch fails.
    }
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
              country: payload.address.country,
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

  async function handleSave() {
    if (!selected || !draft) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);

    try {
      const salesRepName = draft.salesRepName?.trim() ?? "";
      let effectiveDraft = draft;

      if (!salesRepName) {
        effectiveDraft = {
          ...draft,
          salesRepName: null,
          salesRepId: null,
        };
      } else if (!draft.salesRepId) {
        const matchedEmployee = matchEmployeeByName(employeeOptions, salesRepName);
        if (!matchedEmployee) {
          setSaveError(
            "Select a valid Sales Rep from the list so Acumatica receives the correct employee ID.",
          );
          return;
        }

        effectiveDraft = {
          ...draft,
          salesRepName: matchedEmployee.name,
          salesRepId: matchedEmployee.id,
        };
      }

      const accountRecordId = selected.accountRecordId ?? selected.id;
      const selectedBusinessAccountId = selected.businessAccountId;
      const response = await fetch(`/api/business-accounts/${accountRecordId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(effectiveDraft),
      });

      const payload = await readJsonResponse<BusinessAccountRow | { error?: string }>(
        response,
      );

      if (response.status === 401) {
        setSaveError(
          "Acumatica rejected save due session state. Please retry without signing in again.",
        );
        return;
      }

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!payload || typeof payload !== "object" || !("id" in payload)) {
        throw new Error("Unexpected response while saving.");
      }

      const updatedRow = payload as BusinessAccountRow;
      const updatedAccountRecordId = updatedRow.accountRecordId ?? updatedRow.id ?? accountRecordId;
      setAllRows((currentRows) =>
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
          };

          if (row.isPrimaryContact) {
            return {
              ...updatedCommon,
              primaryContactId: updatedRow.primaryContactId,
              primaryContactName: updatedRow.primaryContactName,
              primaryContactPhone: updatedRow.primaryContactPhone,
              primaryContactEmail: updatedRow.primaryContactEmail,
              notes: updatedRow.notes,
            };
          }

          return updatedCommon;
        }),
      );

      const selectedAfterSave: BusinessAccountRow = {
        ...selected,
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
        ...(selected.isPrimaryContact
          ? {
              primaryContactId: updatedRow.primaryContactId,
              primaryContactName: updatedRow.primaryContactName,
              primaryContactPhone: updatedRow.primaryContactPhone,
              primaryContactEmail: updatedRow.primaryContactEmail,
              notes: updatedRow.notes,
            }
          : {}),
      };

      setSelected(selectedAfterSave);
      setAddressLookupArmed(false);
      setDraft(buildDraft(selectedAfterSave));
      setSaveNotice("Saved to Acumatica.");
    } catch (saveRequestError) {
      setSaveError(
        saveRequestError instanceof Error
          ? saveRequestError.message
          : "Failed to save changes.",
      );
    } finally {
      setIsSaving(false);
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
            placeholder="Company, sales rep, industry, region, address, contact, email"
            value={q}
          />
        </label>

        <div className={styles.controlActions}>
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
                ? `${syncProgress.fetchedPages} / ${syncProgress.totalPages} pages`
                : "Preparing dataset...") + ` • ${formatElapsedDuration(syncElapsedMs)}`}
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
                      if (columnId === "primaryContactName") {
                        const nameValue = row.primaryContactName?.trim() ?? "";
                        return (
                          <td key={`${rowKey}-${columnId}`}>
                            <span className={styles.contactNameCell}>
                              {nameValue}
                              {row.isPrimaryContact ? (
                                <span className={styles.primaryBadge}>(Primary)</span>
                              ) : null}
                            </span>
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

      <aside className={`${styles.drawer} ${selected ? styles.drawerOpen : ""}`}>
        <div className={styles.drawerHeader}>
          <h2>{selected ? selected.companyName : "Account details"}</h2>
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
              <input
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, companyName: event.target.value } : current,
                  )
                }
                value={draft.companyName}
              />
            </label>

            <h3>Sales Rep</h3>
            <label>
              Sales Rep
              <input
                list="sales-rep-options"
                onChange={(event) =>
                  setDraft((current) => {
                    if (!current) {
                      return current;
                    }

                    const nextName = event.target.value;
                    const matchedEmployee = matchEmployeeByName(employeeOptions, nextName);
                    const selectedMatchesInput =
                      normalizeComparable(nextName) ===
                      normalizeComparable(selected?.salesRepName);
                    return {
                      ...current,
                      salesRepName: nextName.trim().length > 0 ? nextName : null,
                      salesRepId: matchedEmployee
                        ? matchedEmployee.id
                        : selectedMatchesInput
                          ? selected?.salesRepId ?? null
                          : null,
                    };
                  })
                }
                placeholder="Type and choose sales rep"
                value={draft.salesRepName ?? ""}
              />
              <datalist id="sales-rep-options">
                {employeeOptions.map((employee) => (
                  <option key={employee.id} label={employee.id} value={employee.name} />
                ))}
              </datalist>
              {isEmployeesLoading ? (
                <span className={styles.lookupLoading}>Loading sales reps...</span>
              ) : null}
              {employeesError ? <span className={styles.lookupError}>{employeesError}</span> : null}
              {draft.salesRepId ? (
                <span className={styles.lookupHint}>Employee ID: {draft.salesRepId}</span>
              ) : null}
              {!isEmployeesLoading &&
              !employeesError &&
              draft.salesRepName &&
              !draft.salesRepId ? (
                <span className={styles.lookupHint}>
                  Pick a value from the list to map the correct employee ID.
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
              Address Line 2
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
            <label>
              Country
              <input
                maxLength={3}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, country: event.target.value.toUpperCase() }
                      : current,
                  )
                }
                value={draft.country}
              />
            </label>

            <h3>Primary Contact</h3>
            {!selected.primaryContactId ? (
              <p className={styles.readOnlyNotice}>
                This account does not have a primary contact in Acumatica. Contact fields are
                read-only.
              </p>
            ) : selected.isPrimaryContact === false ? (
              <p className={styles.readOnlyNotice}>
                This row is not the primary contact. Contact fields are read-only here; use the
                row marked Primary.
              </p>
            ) : null}
            <label>
              Name
              <input
                disabled={!selected.primaryContactId || selected.isPrimaryContact === false}
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
                disabled={!selected.primaryContactId || selected.isPrimaryContact === false}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, primaryContactPhone: event.target.value }
                      : current,
                  )
                }
                value={draft.primaryContactPhone ?? ""}
              />
            </label>
            <label>
              Email
              <input
                disabled={!selected.primaryContactId || selected.isPrimaryContact === false}
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
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
              </select>
            </label>

            <label>
              Primary Contact Notes
              <textarea
                disabled={!selected.primaryContactId || selected.isPrimaryContact === false}
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

            <button className={styles.saveButton} disabled={isSaving} onClick={handleSave} type="button">
              {isSaving ? "Saving..." : "Save changes"}
            </button>
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
