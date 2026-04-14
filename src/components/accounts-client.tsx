"use client";

import {
  type ComponentProps,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import type {
  BusinessAccountDetailResponse,
  BusinessAccountLiveEvent,
  BusinessAccountRow,
  BusinessAccountsResponse,
  BusinessAccountUpdateRequest,
  Category,
  SortBy,
  SortDir,
} from "@/types/business-account";
import type {
  BusinessAccountCallHistoryItem,
  BusinessAccountCallHistoryResponse,
} from "@/types/business-account-call-history";
import type {
  BusinessAccountCreateResponse,
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import {
  buildCanonicalCompanyPhoneGroupKey,
  enforceSinglePrimaryPerAccountRows,
  queryBusinessAccounts,
  resolveCompanyPhone,
} from "@/lib/business-accounts";
import {
  buildBusinessAccountConcurrencySnapshot,
  collectUpdatedConcurrencyFields,
} from "@/lib/business-account-concurrency";
import {
  buildAcumaticaBusinessAccountUrl,
  buildAcumaticaContactUrl,
} from "@/lib/acumatica-links";
import {
  BUSINESS_ACCOUNT_REGION_VALUES,
  normalizeBusinessAccountRegionValue,
} from "@/lib/business-account-region-values";
import {
  type CachedDataset,
  readCachedDatasetFromStorage,
  readCachedSyncMeta,
  writeCachedDatasetToStorage,
} from "@/lib/client-dataset-cache";
import {
  formatPhoneDraftValue,
  normalizeExtensionForSave,
  normalizePhoneForSave,
  parsePhoneWithExtension,
} from "@/lib/phone";
import { CallPhoneButton } from "@/components/call-phone-button";
import { CreateBusinessAccountDrawer } from "@/components/create-business-account-drawer";
import {
  CreateContactDrawer,
  type CreateContactAccountOption,
} from "@/components/create-contact-drawer";
import {
  GmailComposeModal,
  type GmailComposeInitialState,
} from "@/components/gmail-compose-modal";
import { CreateOpportunityDrawer } from "@/components/create-opportunity-drawer";
import { CreateMeetingDrawer } from "@/components/create-meeting-drawer";
import { ContactMergeModal } from "@/components/contact-merge-modal";
import {
  QueueDeleteContactsModal,
  type QueueDeleteContactTarget,
} from "@/components/queue-delete-contacts-modal";
import {
  buildMailContactSuggestions,
  createLinkedContactFromRow,
} from "@/lib/mail-ui";
import {
  buildBusinessAccountSaveErrorFeedback,
  parseApiErrorMessage,
  type BusinessAccountSaveErrorField,
} from "@/lib/business-account-save-errors";
import {
  collectOptionalSaveWarningFields,
  formatOptionalSaveWarningMessage,
} from "@/lib/business-account-save-warnings";
import type {
  ContactMergeResponse,
  MergeableContactCandidate,
} from "@/types/contact-merge";
import type { MailSessionResponse } from "@/types/mail";
import type { MailLastEmailedResponse } from "@/types/mail";
import type { MailContactSuggestion, MailSendResponse } from "@/types/mail-compose";
import type { OpportunityCreateResponse } from "@/types/opportunity-create";
import type {
  MeetingCategory,
  MeetingCreateOptionsResponse,
  MeetingCreateResponse,
  MeetingSourceContext,
} from "@/types/meeting-create";
import type {
  ContactEnhanceCandidate,
  ContactEnhanceRequest,
  ContactEnhanceResponse,
  ContactEnhanceSuggestion,
} from "@/types/contact-enhance";
import type {
  CompanyAttributeSuggestion,
  CompanyAttributeSuggestionRequest,
  CompanyAttributeSuggestionResponse,
} from "@/types/company-attribute-suggestion";
import {
  buildMeetingCreateOptionsFromRows,
  DEFAULT_MEETING_TIME_ZONE,
  mergeMeetingCreateOptions,
} from "@/lib/meeting-create";
import type { AuditLogResponse, AuditLogRow } from "@/lib/audit-log-types";

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
  fetchedAccounts: number;
  totalAccounts: number | null;
  fetchedContacts: number;
  totalContacts: number | null;
  snapshotRows: number;
};

type OpportunityDrawerContext = {
  initialAccountRecordId: string | null;
  initialContactId: number | null;
  initialOwnerId: string | null;
  initialOwnerName: string | null;
};

type RowMenuPosition = {
  left: number;
  top: number;
};

type EmailComposerState = {
  initialState: GmailComposeInitialState | null;
  isOpen: boolean;
};

type MailLastEmailedLookupAccount = {
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
};

const MAIL_SESSION_FOLDERS: MailSessionResponse["folders"] = [
  "inbox",
  "sent",
  "drafts",
  "starred",
];

function NoteIcon({ active }: { active: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 18 18">
      <path
        d="M4.25 1.5h6.7L14.5 5.05v11.2a.75.75 0 0 1-.75.75h-9.5a.75.75 0 0 1-.75-.75v-14a.75.75 0 0 1 .75-.75Z"
        fill={active ? "#fff0b8" : "#ffffff"}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M10.9 1.75V5.1h3.35"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      {active ? (
        <>
          <path d="M6 8h5.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.1" />
          <path d="M6 10.4h5.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.1" />
          <path d="M6 12.8h3.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.1" />
        </>
      ) : null}
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M20 7V2.75h-4.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M4 17v4.25h4.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M19.3 12a7.3 7.3 0 0 0-12.46-5.16L4.95 8.73"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M4.7 12a7.3 7.3 0 0 0 12.46 5.16l1.89-1.89"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function DragHandleIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <circle cx="5" cy="4" fill="currentColor" r="1.1" />
      <circle cx="5" cy="8" fill="currentColor" r="1.1" />
      <circle cx="5" cy="12" fill="currentColor" r="1.1" />
      <circle cx="11" cy="4" fill="currentColor" r="1.1" />
      <circle cx="11" cy="8" fill="currentColor" r="1.1" />
      <circle cx="11" cy="12" fill="currentColor" r="1.1" />
    </svg>
  );
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

function FilterIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M3 5.25h14M5.5 10h9M8.5 14.75h3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function HeaderSortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDir;
}) {
  const stroke = active ? "currentColor" : "#98a2b3";

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
      <path
        d="M5 12V4M5 4 3.5 5.5M5 4l1.5 1.5"
        opacity={active && direction === "desc" ? 0.35 : 1}
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
      <path
        d="M11 4v8M11 12 9.5 10.5M11 12l1.5-1.5"
        opacity={active && direction === "asc" ? 0.35 : 1}
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="16" cy="10" r="1.5" />
    </svg>
  );
}

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
  accountType: string;
  opportunityCount: string;
  salesRepName: string;
  industryType: string;
  subCategory: string;
  companyRegion: string;
  week: string;
  address: string;
  companyPhone: string;
  primaryContactName: string;
  primaryContactJobTitle: string;
  primaryContactPhone: string;
  primaryContactExtension: string;
  primaryContactEmail: string;
  notes: string;
  category: Category | "";
  lastCalled: string;
  lastEmailed: string;
  lastModified: string;
};

const DEFAULT_HEADER_FILTERS: HeaderFilters = {
  companyName: "",
  accountType: "",
  opportunityCount: "",
  salesRepName: "",
  industryType: "",
  subCategory: "",
  companyRegion: "",
  week: "",
  address: "",
  companyPhone: "",
  primaryContactName: "",
  primaryContactJobTitle: "",
  primaryContactPhone: "",
  primaryContactExtension: "",
  primaryContactEmail: "",
  notes: "",
  category: "",
  lastCalled: "",
  lastEmailed: "",
  lastModified: "",
};

function buildAccountsCsvExportHref(input: {
  q: string;
  headerFilters: HeaderFilters;
  sortBy: SortBy;
  sortDir: SortDir;
}): string {
  const params = new URLSearchParams();

  const append = (key: string, value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) {
      params.set(key, trimmed);
    }
  };

  append("q", input.q);
  append("filterCompanyName", input.headerFilters.companyName);
  append("filterAccountType", input.headerFilters.accountType);
  append("filterOpportunityCount", input.headerFilters.opportunityCount);
  append("filterSalesRep", input.headerFilters.salesRepName);
  append("filterIndustryType", input.headerFilters.industryType);
  append("filterSubCategory", input.headerFilters.subCategory);
  append("filterCompanyRegion", input.headerFilters.companyRegion);
  append("filterWeek", input.headerFilters.week);
  append("filterAddress", input.headerFilters.address);
  append("filterCompanyPhone", input.headerFilters.companyPhone);
  append("filterPrimaryContactName", input.headerFilters.primaryContactName);
  append("filterPrimaryContactJobTitle", input.headerFilters.primaryContactJobTitle);
  append("filterPrimaryContactPhone", input.headerFilters.primaryContactPhone);
  append("filterPrimaryContactExtension", input.headerFilters.primaryContactExtension);
  append("filterPrimaryContactEmail", input.headerFilters.primaryContactEmail);
  append("filterNotes", input.headerFilters.notes);
  if (input.headerFilters.category) {
    params.set("filterCategory", input.headerFilters.category);
  }
  append("filterLastCalled", input.headerFilters.lastCalled);
  append("filterLastEmailed", input.headerFilters.lastEmailed);
  append("filterLastModified", input.headerFilters.lastModified);
  params.set("sortBy", input.sortBy);
  params.set("sortDir", input.sortDir);
  params.set("page", "1");
  params.set("pageSize", "1");

  return `/api/business-accounts/export?${params.toString()}`;
}

const COLUMN_STORAGE_KEY = "businessAccounts.columnOrder.v2";
const LEGACY_COLUMN_STORAGE_KEYS = ["businessAccounts.columnOrder.v1"] as const;
const COLUMN_VISIBILITY_STORAGE_KEY = "businessAccounts.visibleColumns.v2";
const LEGACY_COLUMN_VISIBILITY_STORAGE_KEYS = [
  "businessAccounts.visibleColumns.v1",
] as const;
const COLUMN_PREF_RESET_STORAGE_KEY = "businessAccounts.resetColumnsOnNextLoad.v1";

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

const COLUMN_CONFIGS: ColumnConfig[] = [
  {
    id: "companyName",
    label: "Company Name",
    filterKey: "companyName",
    filterPlaceholder: "Filter company",
  },
  {
    id: "accountType",
    label: "Account Type",
    filterKey: "accountType",
    filterPlaceholder: "Filter customer or lead",
  },
  {
    id: "opportunityCount",
    label: "Opportunities",
    filterKey: "opportunityCount",
    filterPlaceholder: "Filter opportunity count",
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
    label: "Subcategory",
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
    label: "Primary Contact",
    filterKey: "primaryContactName",
    filterPlaceholder: "Filter contact",
  },
  {
    id: "primaryContactJobTitle",
    label: "Job Title",
    filterKey: "primaryContactJobTitle",
    filterPlaceholder: "Filter job title",
  },
  {
    id: "primaryContactPhone",
    label: "Contact Phone",
    filterKey: "primaryContactPhone",
    filterPlaceholder: "Filter phone number",
  },
  {
    id: "primaryContactExtension",
    label: "Extension",
    filterKey: "primaryContactExtension",
    filterPlaceholder: "Filter extension",
  },
  {
    id: "primaryContactEmail",
    label: "Primary Email",
    filterKey: "primaryContactEmail",
    filterPlaceholder: "Filter email",
  },
  {
    id: "lastCalledAt",
    label: "Last Called",
    filterKey: "lastCalled",
    filterPlaceholder: "Filter last called",
  },
  {
    id: "lastEmailedAt",
    label: "Last Emailed",
    filterKey: "lastEmailed",
    filterPlaceholder: "Filter last emailed",
  },
  {
    id: "category",
    label: "Category",
    filterKey: "category",
    filterPlaceholder: "Filter category",
  },
  {
    id: "lastModifiedIso",
    label: "Updated",
    filterKey: "lastModified",
    filterPlaceholder: "Filter last modified",
  },
];

const DEFAULT_VISIBLE_COLUMNS: SortBy[] = [
  "companyName",
  "accountType",
  "opportunityCount",
  "address",
  "companyPhone",
  "primaryContactName",
  "primaryContactJobTitle",
  "primaryContactPhone",
  "primaryContactExtension",
  "primaryContactEmail",
  "lastCalledAt",
  "lastEmailedAt",
  "category",
];

const DEFAULT_COLUMN_ORDER: SortBy[] = [
  ...DEFAULT_VISIBLE_COLUMNS,
  ...COLUMN_CONFIGS.map((column) => column.id).filter(
    (columnId) => !DEFAULT_VISIBLE_COLUMNS.includes(columnId),
  ),
];

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
  ...BUSINESS_ACCOUNT_REGION_VALUES.map((value) => ({
    value,
    label: value,
  })),
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
  return normalizeBusinessAccountRegionValue(value);
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

function mergeStoredColumnList(
  storedColumns: SortBy[],
  requiredColumns: readonly SortBy[],
): SortBy[] {
  const next = [...storedColumns.filter((column) => DEFAULT_COLUMN_ORDER.includes(column))];

  for (const column of requiredColumns) {
    if (next.includes(column)) {
      continue;
    }

    const defaultIndex = DEFAULT_COLUMN_ORDER.indexOf(column);
    const nextKnownColumn = DEFAULT_COLUMN_ORDER.slice(defaultIndex + 1).find((candidate) =>
      next.includes(candidate),
    );

    if (!nextKnownColumn) {
      next.push(column);
      continue;
    }

    next.splice(next.indexOf(nextKnownColumn), 0, column);
  }

  return next;
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
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function formatLastEmailed(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString();
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

function formatCallDuration(seconds: number | null | undefined): string | null {
  if (!Number.isFinite(seconds) || (seconds ?? 0) <= 0) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.trunc(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function truncateLongText(value: string | null | undefined, maxChars: number): string | null {
  const text = value?.trim() ?? "";
  if (!text) {
    return null;
  }

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trimEnd()}...`;
}

function buildCallHistoryMeta(item: BusinessAccountCallHistoryItem): string {
  const parts = [formatLastCalled(item.startedAt)];

  if (item.employeeDisplayName) {
    parts.push(item.employeeDisplayName);
  }

  const phoneNumber = item.phoneNumber?.trim();
  if (phoneNumber) {
    parts.push(phoneNumber);
  }

  const callDuration = formatCallDuration(item.talkDurationSeconds);
  if (callDuration) {
    parts.push(callDuration);
  }

  return parts.filter(Boolean).join(" • ");
}

function formatRelativeTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const diffMs = timestamp - Date.now();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
    ["second", 1000],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, unitMs] of units) {
    if (Math.abs(diffMs) >= unitMs || unit === "second") {
      return formatter.format(Math.round(diffMs / unitMs), unit);
    }
  }

  return null;
}

function buildLastEmailedLookupKey(
  kind: "record" | "account",
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? `${kind}:${normalized}` : null;
}

function buildLastEmailedLookupAccounts(
  rows: BusinessAccountRow[],
): MailLastEmailedLookupAccount[] {
  const seen = new Set<string>();
  return rows
    .map((row) => ({
      businessAccountRecordId: resolveRowBusinessAccountRecordId(row),
      businessAccountId: row.businessAccountId.trim() || null,
    }))
    .filter((account) => account.businessAccountRecordId || account.businessAccountId)
    .filter((account) => {
      const key = `${account.businessAccountRecordId ?? ""}::${account.businessAccountId ?? ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
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
  const rawPhone = row.primaryContactRawPhone ?? row.primaryContactPhone ?? "";
  const parsedPhone = parsePhoneWithExtension(rawPhone);

  return {
    companyName: row.companyName,
    companyDescription: row.companyDescription ?? null,
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
    companyPhone: resolveCompanyPhone(row),
    primaryContactName: row.primaryContactName,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone:
      parsedPhone.kind === "phone_with_extension"
        ? parsedPhone.phone
        : row.primaryContactPhone,
    primaryContactExtension:
      parsedPhone.kind === "phone_with_extension"
        ? parsedPhone.extension
        : row.primaryContactExtension ?? null,
    primaryContactEmail: row.primaryContactEmail,
    category: row.category,
    notes: row.notes,
    expectedLastModified: row.lastModifiedIso,
    baseSnapshot: buildBusinessAccountConcurrencySnapshot(row),
  };
}

function isDraftDirty(draft: BusinessAccountUpdateRequest | null): boolean {
  if (!draft) {
    return false;
  }

  return (
    collectUpdatedConcurrencyFields(draft).size > 0 ||
    draft.setAsPrimaryContact === true
  );
}

function rowMatchesLiveAccountEvent(
  row: BusinessAccountRow | null,
  event: BusinessAccountLiveEvent,
): boolean {
  if (!row) {
    return false;
  }

  const accountRecordId = row.accountRecordId ?? row.id;
  if (accountRecordId === event.accountRecordId) {
    return true;
  }

  return Boolean(event.businessAccountId && row.businessAccountId === event.businessAccountId);
}

function readTextValue(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  return value.trim();
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
    accountType: incoming.accountType ?? existing.accountType ?? null,
    opportunityCount: incoming.opportunityCount ?? existing.opportunityCount ?? null,
    industryType: pickPreferredText(existing.industryType, incoming.industryType),
    subCategory: pickPreferredText(existing.subCategory, incoming.subCategory),
    companyRegion: pickPreferredText(existing.companyRegion, incoming.companyRegion),
    week: pickPreferredText(existing.week, incoming.week),
    companyDescription: pickPreferredText(
      existing.companyDescription,
      incoming.companyDescription,
    ),
    primaryContactName: pickPreferredContactName(
      existing.primaryContactName,
      incoming.primaryContactName,
      companyName,
    ),
    primaryContactJobTitle: pickPreferredText(
      existing.primaryContactJobTitle,
      incoming.primaryContactJobTitle,
    ),
    primaryContactPhone: pickPreferredText(
      existing.primaryContactPhone,
      incoming.primaryContactPhone,
    ),
    primaryContactExtension: pickPreferredText(
      existing.primaryContactExtension,
      incoming.primaryContactExtension,
    ),
    primaryContactEmail: pickPreferredText(
      existing.primaryContactEmail,
      incoming.primaryContactEmail,
    ),
    companyPhone: pickPreferredText(existing.companyPhone, incoming.companyPhone),
    companyPhoneSource: incoming.companyPhoneSource ?? existing.companyPhoneSource ?? null,
    phoneNumber: pickPreferredText(existing.phoneNumber, incoming.phoneNumber),
    notes: pickPreferredText(existing.notes, incoming.notes),
    category: incoming.category ?? existing.category,
    lastCalledAt: pickPreferredText(existing.lastCalledAt, incoming.lastCalledAt),
    lastModifiedIso: pickPreferredText(existing.lastModifiedIso, incoming.lastModifiedIso),
  };
}

function sharesCompanyPhoneGroup(
  left: BusinessAccountRow,
  right: BusinessAccountRow,
): boolean {
  return (
    buildCanonicalCompanyPhoneGroupKey(left) ===
    buildCanonicalCompanyPhoneGroupKey(right)
  );
}

function parseError(payload: unknown): string {
  return parseApiErrorMessage(payload);
}

type SaveFieldErrors = Partial<Record<BusinessAccountSaveErrorField, string>>;

class SaveDraftError extends Error {
  fieldErrors: SaveFieldErrors;

  constructor(message: string, fieldErrors: SaveFieldErrors = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
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

function isContactEnhanceCandidate(value: unknown): value is ContactEnhanceCandidate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    (record.name === null || typeof record.name === "string") &&
    (record.currentTitle === null || typeof record.currentTitle === "string") &&
    (record.currentEmployer === null || typeof record.currentEmployer === "string") &&
    (record.location === null || typeof record.location === "string") &&
    (record.linkedinUrl === null || typeof record.linkedinUrl === "string")
  );
}

function isContactEnhanceSuggestion(value: unknown): value is ContactEnhanceSuggestion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.name === null || typeof record.name === "string") &&
    (record.jobTitle === null || typeof record.jobTitle === "string") &&
    (record.email === null || typeof record.email === "string") &&
    (record.phone === null || typeof record.phone === "string")
  );
}

function isContactEnhanceResponse(value: unknown): value is ContactEnhanceResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.status === "ready") {
    return (
      isContactEnhanceSuggestion(record.suggestion) &&
      Array.isArray(record.filledFieldKeys)
    );
  }

  if (record.status === "needs_selection") {
    return (
      Array.isArray(record.candidates) &&
      record.candidates.every((candidate) => isContactEnhanceCandidate(candidate))
    );
  }

  if (record.status === "no_match" || record.status === "need_more_context") {
    return typeof record.message === "string";
  }

  return false;
}

function hasMissingContactEnhanceField(draft: BusinessAccountUpdateRequest | null): boolean {
  if (!draft) {
    return false;
  }

  return (
    readTextValue(draft.primaryContactName) === null ||
    readTextValue(draft.primaryContactJobTitle) === null ||
    readTextValue(draft.primaryContactEmail) === null ||
    readTextValue(draft.primaryContactPhone) === null
  );
}

function buildContactEnhanceRequest(
  row: BusinessAccountRow,
  draft: BusinessAccountUpdateRequest,
  candidate: Pick<ContactEnhanceCandidate, "id" | "currentTitle"> | null = null,
): ContactEnhanceRequest {
  return {
    companyName: readTextValue(draft.companyName),
    businessAccountId:
      readTextValue(draft.assignedBusinessAccountId) ??
      readTextValue(row.businessAccountId),
    contactName: readTextValue(draft.primaryContactName),
    contactJobTitle: readTextValue(draft.primaryContactJobTitle),
    candidateCurrentTitle: candidate?.currentTitle ?? null,
    contactEmail: readTextValue(draft.primaryContactEmail),
    contactPhone: readTextValue(draft.primaryContactPhone),
    city: readTextValue(draft.city),
    state: readTextValue(draft.state),
    country: readTextValue(draft.country),
    candidatePersonId: candidate?.id ?? null,
  };
}

function buildContactEnhanceFingerprint(request: ContactEnhanceRequest | null): string | null {
  if (!request) {
    return null;
  }

  return JSON.stringify({
    companyName: request.companyName,
    businessAccountId: request.businessAccountId,
    contactName: request.contactName,
    contactJobTitle: request.contactJobTitle,
    candidateCurrentTitle: request.candidateCurrentTitle,
    contactEmail: request.contactEmail,
    contactPhone: request.contactPhone,
    city: request.city,
    state: request.state,
    country: request.country,
  });
}

function applyContactEnhanceSuggestion(
  draft: BusinessAccountUpdateRequest,
  suggestion: ContactEnhanceSuggestion,
): {
  draft: BusinessAccountUpdateRequest;
  appliedCount: number;
} {
  let appliedCount = 0;
  let nextDraft = draft;

  if (readTextValue(draft.primaryContactName) === null && readTextValue(suggestion.name) !== null) {
    nextDraft = {
      ...nextDraft,
      primaryContactName: suggestion.name,
    };
    appliedCount += 1;
  }

  if (
    readTextValue(draft.primaryContactJobTitle) === null &&
    readTextValue(suggestion.jobTitle) !== null
  ) {
    nextDraft = {
      ...nextDraft,
      primaryContactJobTitle: suggestion.jobTitle,
    };
    appliedCount += 1;
  }

  if (readTextValue(draft.primaryContactEmail) === null && readTextValue(suggestion.email) !== null) {
    nextDraft = {
      ...nextDraft,
      primaryContactEmail: suggestion.email,
    };
    appliedCount += 1;
  }

  if (readTextValue(draft.primaryContactPhone) === null && readTextValue(suggestion.phone) !== null) {
    nextDraft = {
      ...nextDraft,
      primaryContactPhone: suggestion.phone,
    };
    appliedCount += 1;
  }

  return {
    draft: nextDraft,
    appliedCount,
  };
}

function isCompanyAttributeSuggestionSource(
  value: unknown,
): value is CompanyAttributeSuggestion["sources"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.title === "string" &&
    typeof record.url === "string" &&
    (record.domain === null || typeof record.domain === "string")
  );
}

function isCompanyAttributeSuggestion(value: unknown): value is CompanyAttributeSuggestion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.companyRegion === null || typeof record.companyRegion === "string") &&
    (record.companyRegionLabel === null || typeof record.companyRegionLabel === "string") &&
    (record.category === null || typeof record.category === "string") &&
    (record.categoryLabel === null || typeof record.categoryLabel === "string") &&
    (record.industryType === null || typeof record.industryType === "string") &&
    (record.industryTypeLabel === null || typeof record.industryTypeLabel === "string") &&
    (record.subCategory === null || typeof record.subCategory === "string") &&
    (record.subCategoryLabel === null || typeof record.subCategoryLabel === "string") &&
    (record.companyDescription === null || typeof record.companyDescription === "string") &&
    (record.confidence === "low" ||
      record.confidence === "medium" ||
      record.confidence === "high") &&
    typeof record.reasoning === "string" &&
    Array.isArray(record.sources) &&
    record.sources.every((source) => isCompanyAttributeSuggestionSource(source))
  );
}

function isCompanyAttributeSuggestionResponse(
  value: unknown,
): value is CompanyAttributeSuggestionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.status === "ready") {
    return (
      isCompanyAttributeSuggestion(record.suggestion) &&
      Array.isArray(record.filledFieldKeys)
    );
  }

  if (record.status === "no_match" || record.status === "need_more_context") {
    return typeof record.message === "string";
  }

  return false;
}

function hasMissingCompanyAttributeSuggestionField(
  draft: BusinessAccountUpdateRequest | null,
): boolean {
  if (!draft) {
    return false;
  }

  return (
    readTextValue(draft.companyRegion) === null ||
    readTextValue(draft.category) === null ||
    readTextValue(draft.industryType) === null ||
    readTextValue(draft.subCategory) === null ||
    readTextValue(draft.companyDescription) === null
  );
}

function buildCompanyAttributeSuggestionRequest(
  row: BusinessAccountRow,
  draft: BusinessAccountUpdateRequest,
): CompanyAttributeSuggestionRequest {
  return {
    companyName: readTextValue(draft.companyName),
    companyDescription: readTextValue(draft.companyDescription),
    businessAccountId:
      readTextValue(draft.assignedBusinessAccountId) ??
      readTextValue(row.businessAccountId),
    addressLine1: readTextValue(draft.addressLine1),
    city: readTextValue(draft.city),
    state: readTextValue(draft.state),
    postalCode: readTextValue(draft.postalCode),
    country: readTextValue(draft.country),
    contactEmail: readTextValue(draft.primaryContactEmail),
    companyRegion: readTextValue(draft.companyRegion),
    industryType: readTextValue(draft.industryType),
    subCategory: readTextValue(draft.subCategory),
    category: readTextValue(draft.category),
  };
}

function buildCompanyAttributeSuggestionFingerprint(
  request: CompanyAttributeSuggestionRequest | null,
): string | null {
  if (!request) {
    return null;
  }

  return JSON.stringify(request);
}

function applyCompanyAttributeSuggestion(
  draft: BusinessAccountUpdateRequest,
  suggestion: CompanyAttributeSuggestion,
): {
  draft: BusinessAccountUpdateRequest;
  appliedCount: number;
} {
  let appliedCount = 0;
  let nextDraft = draft;

  if (
    readTextValue(draft.companyRegion) === null &&
    readTextValue(suggestion.companyRegion) !== null
  ) {
    nextDraft = {
      ...nextDraft,
      companyRegion: suggestion.companyRegion,
    };
    appliedCount += 1;
  }

  if (readTextValue(draft.category) === null && readTextValue(suggestion.category) !== null) {
    nextDraft = {
      ...nextDraft,
      category: suggestion.category as Category,
    };
    appliedCount += 1;
  }

  if (readTextValue(draft.industryType) === null && readTextValue(suggestion.industryType) !== null) {
    nextDraft = {
      ...nextDraft,
      industryType: suggestion.industryType,
    };
    appliedCount += 1;
  }

  if (readTextValue(draft.subCategory) === null && readTextValue(suggestion.subCategory) !== null) {
    nextDraft = {
      ...nextDraft,
      subCategory: suggestion.subCategory,
    };
    appliedCount += 1;
  }

  if (
    readTextValue(draft.companyDescription) === null &&
    readTextValue(suggestion.companyDescription) !== null
  ) {
    nextDraft = {
      ...nextDraft,
      companyDescription: suggestion.companyDescription,
    };
    appliedCount += 1;
  }

  return {
    draft: nextDraft,
    appliedCount,
  };
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

function normalizeCachedSyncTimestamp(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function canUseCachedSnapshot(
  cachedDataset: CachedDataset | null,
  status: SyncStatusResponse,
): cachedDataset is CachedDataset {
  if (!cachedDataset || !isBusinessAccountRows(cachedDataset.rows) || cachedDataset.rows.length === 0) {
    return false;
  }

  if (status.status === "running") {
    return true;
  }

  const cachedLastSyncedAt = normalizeCachedSyncTimestamp(cachedDataset.lastSyncedAt);
  const remoteLastSyncedAt = normalizeCachedSyncTimestamp(status.lastSuccessfulSyncAt);
  if (!remoteLastSyncedAt) {
    return true;
  }

  return cachedLastSyncedAt === remoteLastSyncedAt;
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

function isMailSessionResponse(payload: unknown): payload is MailSessionResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    (record.status === "connected" ||
      record.status === "disconnected" ||
      record.status === "needs_setup") &&
    Array.isArray(record.folders)
  );
}

function isMeetingCreateOptionsResponse(
  payload: MeetingCreateOptionsResponse | { error?: string } | null,
): payload is MeetingCreateOptionsResponse {
  return Boolean(
    payload &&
      Array.isArray((payload as MeetingCreateOptionsResponse).contacts) &&
      Array.isArray((payload as MeetingCreateOptionsResponse).employees) &&
      Array.isArray((payload as MeetingCreateOptionsResponse).accounts) &&
      typeof (payload as MeetingCreateOptionsResponse).defaultTimeZone === "string",
  );
}

function isMailLastEmailedResponse(payload: unknown): payload is MailLastEmailedResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items);
}

function buildFallbackMailSession(
  status: MailSessionResponse["status"],
  connectionError: string,
): MailSessionResponse {
  return {
    status,
    senderEmail: null,
    senderDisplayName: null,
    expectedGoogleEmail: null,
    connectedGoogleEmail: null,
    connectionError,
    folders: MAIL_SESSION_FOLDERS,
  };
}

function hasRowContactEmail(row: BusinessAccountRow): boolean {
  return resolveRowContactEmail(row) !== null;
}

function hasRowNote(row: BusinessAccountRow): boolean {
  return Boolean(row.notes?.trim());
}

function canEditRowNote(row: BusinessAccountRow): boolean {
  return resolveRowContactId(row) !== null;
}

function canDeleteRowContact(row: BusinessAccountRow): boolean {
  return resolveRowContactId(row) !== null;
}

function canDeleteBusinessAccountRow(row: BusinessAccountRow): boolean {
  return (
    resolveRowContactId(row) === null &&
    row.businessAccountId.trim().length > 0 &&
    resolveRowBusinessAccountRecordId(row).trim().length > 0
  );
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
  const primaryIds = new Set(
    primary
      .map((item) => item.id.trim())
      .filter((value) => value.length > 0),
  );

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

  const byName = new Map<string, EmployeeOption>();
  [...byId.values()].forEach((item) => {
    const normalizedName = normalizeComparable(item.name);
    const existing = byName.get(normalizedName);
    if (!existing) {
      byName.set(normalizedName, item);
      return;
    }

    const itemIsPrimary = primaryIds.has(item.id);
    const existingIsPrimary = primaryIds.has(existing.id);
    if (itemIsPrimary && !existingIsPrimary) {
      byName.set(normalizedName, item);
      return;
    }

    if (itemIsPrimary === existingIsPrimary) {
      const idComparison = item.id.localeCompare(existing.id, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (idComparison < 0) {
        byName.set(normalizedName, item);
      }
    }
  });

  return [...byName.values()];
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

function isBusinessAccountCallHistoryResponse(
  payload: unknown,
): payload is BusinessAccountCallHistoryResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.items)) {
    return false;
  }

  return record.items.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return typeof (item as Record<string, unknown>).sessionId === "string";
  });
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

  if (sourceRow.rowKey) {
    const byRowKey = rows.find((row) => row.rowKey === sourceRow.rowKey);
    if (byRowKey) {
      return byRowKey;
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
        primaryContactJobTitle: null,
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

function getRowKey(row: BusinessAccountRow, index = 0): string {
  return (
    row.rowKey ??
    `${row.accountRecordId ?? row.id}:${row.contactId ?? "contact"}:${index}`
  );
}

function resolveRowContactId(row: BusinessAccountRow): number | null {
  return row.contactId ?? row.primaryContactId ?? null;
}

function resolveRowContactEmail(row: BusinessAccountRow): string | null {
  const email = row.primaryContactEmail?.trim() ?? "";
  return email || null;
}

function buildEmailInitialStateFromRow(
  row: BusinessAccountRow,
): GmailComposeInitialState | null {
  const email = resolveRowContactEmail(row);
  if (!email) {
    return null;
  }

  return {
    subject: "",
    htmlBody: "<div><br /></div>",
    textBody: "",
    to: [
      {
        email,
        name: row.primaryContactName?.trim() || null,
        contactId: resolveRowContactId(row),
        businessAccountRecordId: resolveRowBusinessAccountRecordId(row),
        businessAccountId: row.businessAccountId.trim() || null,
      },
    ],
    cc: [],
    bcc: [],
    linkedContact: createLinkedContactFromRow(row),
    sourceSurface: "accounts",
  };
}

function isContactSelectableRow(row: BusinessAccountRow): boolean {
  return resolveRowContactId(row) !== null;
}

function resolveRowBusinessAccountRecordId(row: BusinessAccountRow): string {
  return row.accountRecordId?.trim() || row.id.trim() || row.businessAccountId.trim();
}

function buildBusinessAccountDetailUrl(
  accountRecordId: string,
  contactId?: number | null,
  options?: { live?: boolean },
): string {
  const basePath = `/api/business-accounts/${encodeURIComponent(accountRecordId.trim())}`;
  const params = new URLSearchParams();
  if (contactId !== null && contactId !== undefined) {
    params.set("contactId", String(contactId));
  }
  if (options?.live) {
    params.set("live", "1");
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function buildBusinessAccountCallHistoryUrl(
  accountRecordId: string,
  contactId?: number | null,
): string {
  const basePath = `/api/business-accounts/${encodeURIComponent(accountRecordId.trim())}/call-history`;
  const params = new URLSearchParams({
    limit: "10",
  });

  if (contactId !== null && contactId !== undefined) {
    params.set("contactId", String(contactId));
  }

  return `${basePath}?${params.toString()}`;
}

function buildMeetingSourceFromRow(row: BusinessAccountRow): MeetingSourceContext {
  const accountRecordId = resolveRowBusinessAccountRecordId(row);

  return {
    accountKey: accountRecordId,
    accountRecordId,
    businessAccountId: row.businessAccountId,
    companyName: row.companyName,
    contactId: resolveRowContactId(row),
    contactName: row.primaryContactName,
    contactPhone: row.primaryContactPhone,
    contactEmail: resolveRowContactEmail(row),
  };
}

function isBusinessAccountStaleSaveMessage(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("modified in acumatica after you loaded it") ||
    normalized.includes("changed while you were editing it")
  );
}

function toMergeableContactCandidate(row: BusinessAccountRow): MergeableContactCandidate {
  return {
    contactId: resolveRowContactId(row),
    rowKey: row.rowKey ?? null,
    businessAccountRecordId: resolveRowBusinessAccountRecordId(row),
    businessAccountId: row.businessAccountId,
    companyName: row.companyName,
    contactName: row.primaryContactName,
    contactEmail: row.primaryContactEmail,
    contactPhone: row.primaryContactPhone,
    isPrimaryContact: row.isPrimaryContact === true,
    salesRepName: row.salesRepName,
    lastModifiedIso: row.lastModifiedIso,
  };
}

function clearCachedMapData() {
  try {
    window.localStorage.removeItem("businessAccounts.mapCache.v3");
    window.localStorage.removeItem("businessAccounts.mapCache.v4");
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

function canAddContactToRow(row: BusinessAccountRow): boolean {
  return row.businessAccountId.trim().length > 0;
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

export function AccountsClient({
  acumaticaBaseUrl,
  acumaticaCompanyId,
  openAiAttributeSuggestEnabled,
  rocketReachEnabled,
}: {
  acumaticaBaseUrl: string;
  acumaticaCompanyId: string;
  openAiAttributeSuggestEnabled: boolean;
  rocketReachEnabled: boolean;
}) {
  const router = useRouter();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [callHistory, setCallHistory] = useState<BusinessAccountCallHistoryItem[]>([]);
  const [callHistoryLoading, setCallHistoryLoading] = useState(false);
  const [callHistoryError, setCallHistoryError] = useState<string | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditLogRow[]>([]);
  const [auditHistoryLoading, setAuditHistoryLoading] = useState(false);
  const [auditHistoryError, setAuditHistoryError] = useState<string | null>(null);
  const [allRows, setAllRows] = useState<BusinessAccountRow[]>([]);
  const allRowsRef = useRef<BusinessAccountRow[]>([]);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [q, setQ] = useState("");
  const [headerFilters, setHeaderFilters] = useState<HeaderFilters>(
    DEFAULT_HEADER_FILTERS,
  );
  const [columnOrder, setColumnOrder] = useState<SortBy[]>(DEFAULT_COLUMN_ORDER);
  const [visibleColumns, setVisibleColumns] = useState<SortBy[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnPrefsHydrated, setColumnPrefsHydrated] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("companyName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  const [syncElapsedMs, setSyncElapsedMs] = useState(0);
  const [lastSyncDurationMs, setLastSyncDurationMs] = useState<number | null>(null);
  const [syncBlockedReason, setSyncBlockedReason] = useState<string | null>(null);
  const [remoteSyncRunning, setRemoteSyncRunning] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<BusinessAccountRow | null>(null);
  const selectedRef = useRef<BusinessAccountRow | null>(null);
  const [selectedContactRowKeys, setSelectedContactRowKeys] = useState<string[]>([]);
  const [isSelectionMergeOpen, setIsSelectionMergeOpen] = useState(false);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isCreateContactDrawerOpen, setIsCreateContactDrawerOpen] = useState(false);
  const [createContactDrawerInitialAccountRecordId, setCreateContactDrawerInitialAccountRecordId] =
    useState<string | null>(null);
  const [isCreateOpportunityDrawerOpen, setIsCreateOpportunityDrawerOpen] = useState(false);
  const [isCreateMeetingDrawerOpen, setIsCreateMeetingDrawerOpen] = useState(false);
  const [createMeetingCategory, setCreateMeetingCategory] = useState<MeetingCategory>("Meeting");
  const [meetingSource, setMeetingSource] = useState<MeetingSourceContext | null>(null);
  const [meetingOptions, setMeetingOptions] = useState<MeetingCreateOptionsResponse | null>(null);
  const [meetingOptionsError, setMeetingOptionsError] = useState<string | null>(null);
  const [isLoadingMeetingOptions, setIsLoadingMeetingOptions] = useState(false);
  const [emailComposerState, setEmailComposerState] = useState<EmailComposerState>({
    initialState: null,
    isOpen: false,
  });
  const [deleteQueueRows, setDeleteQueueRows] = useState<BusinessAccountRow[]>([]);
  const [deleteBusinessAccountRow, setDeleteBusinessAccountRow] = useState<BusinessAccountRow | null>(
    null,
  );
  const [opportunityDrawerContext, setOpportunityDrawerContext] =
    useState<OpportunityDrawerContext>({
      initialAccountRecordId: null,
      initialContactId: null,
      initialOwnerId: null,
      initialOwnerName: null,
    });
  const [pendingOpportunityResumeAccountRecordId, setPendingOpportunityResumeAccountRecordId] =
    useState<string | null>(null);
  const [resumeOpportunityAfterContactCreate, setResumeOpportunityAfterContactCreate] =
    useState<OpportunityDrawerContext | null>(null);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [createMenuPosition, setCreateMenuPosition] = useState<RowMenuPosition | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [rowMenuRowKey, setRowMenuRowKey] = useState<string | null>(null);
  const [rowMenuPosition, setRowMenuPosition] = useState<RowMenuPosition | null>(null);
  const [draggedColumnId, setDraggedColumnId] = useState<SortBy | null>(null);
  const [columnDropTargetId, setColumnDropTargetId] = useState<SortBy | null>(null);
  const [drawerFocusTarget, setDrawerFocusTarget] = useState<"notes" | null>(null);
  const [draft, setDraft] = useState<BusinessAccountUpdateRequest | null>(null);
  const draftRef = useRef<BusinessAccountUpdateRequest | null>(null);
  const [isEnhancingContact, setIsEnhancingContact] = useState(false);
  const [contactEnhanceError, setContactEnhanceError] = useState<string | null>(null);
  const [contactEnhanceNotice, setContactEnhanceNotice] = useState<string | null>(null);
  const [contactEnhanceCandidates, setContactEnhanceCandidates] = useState<
    ContactEnhanceCandidate[]
  >([]);
  const [contactEnhanceFingerprint, setContactEnhanceFingerprint] = useState<string | null>(
    null,
  );
  const [isSuggestingCompanyAttributes, setIsSuggestingCompanyAttributes] = useState(false);
  const [companyAttributeSuggestionError, setCompanyAttributeSuggestionError] = useState<
    string | null
  >(null);
  const [companyAttributeSuggestionNotice, setCompanyAttributeSuggestionNotice] = useState<
    string | null
  >(null);
  const [companyAttributeSuggestionResult, setCompanyAttributeSuggestionResult] =
    useState<CompanyAttributeSuggestion | null>(null);
  const [companyAttributeSuggestionFingerprint, setCompanyAttributeSuggestionFingerprint] =
    useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFieldErrors, setSaveFieldErrors] = useState<SaveFieldErrors>({});
  const isSavingRef = useRef(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingContact, setIsDeletingContact] = useState(false);
  const [isDeletingBusinessAccount, setIsDeletingBusinessAccount] = useState(false);
  const [isDeletingSelectedContacts, setIsDeletingSelectedContacts] = useState(false);
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
  const [mailSession, setMailSession] = useState<MailSessionResponse | null>(null);
  const [isMailSessionLoading, setIsMailSessionLoading] = useState(false);
  const [lastEmailedByAccountKey, setLastEmailedByAccountKey] = useState<
    Record<string, string | null>
  >({});
  const [lastEmailedRefreshVersion, setLastEmailedRefreshVersion] = useState(0);
  const hydratingContactRowKeysRef = useRef(new Set<string>());
  const hydratedContactRowKeysRef = useRef(new Set<string>());
  const resolvingPrimaryAccountIdsRef = useRef(new Set<string>());
  const resolvedPrimaryAccountIdsRef = useRef(new Set<string>());
  const resolvingSalesRepAccountIdsRef = useRef(new Set<string>());
  const resolvedSalesRepAccountIdsRef = useRef(new Set<string>());
  const meetingOptionsPrefetchKeyRef = useRef<string | null>(null);
  const employeesFetchAttemptedRef = useRef(false);
  const employeesFetchRequestRef = useRef(0);
  const notesFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const createMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentContactEnhanceRequest = useMemo(
    () =>
      selected && draft && selected.contactId
        ? buildContactEnhanceRequest(selected, draft)
        : null,
    [draft, selected],
  );
  const currentContactEnhanceFingerprint = useMemo(
    () => buildContactEnhanceFingerprint(currentContactEnhanceRequest),
    [currentContactEnhanceRequest],
  );
  const currentCompanyAttributeSuggestionRequest = useMemo(
    () => (selected && draft ? buildCompanyAttributeSuggestionRequest(selected, draft) : null),
    [draft, selected],
  );
  const currentCompanyAttributeSuggestionFingerprint = useMemo(
    () => buildCompanyAttributeSuggestionFingerprint(currentCompanyAttributeSuggestionRequest),
    [currentCompanyAttributeSuggestionRequest],
  );

  const displayRows = useMemo(
    () =>
      allRows.map((row) => {
        const recordKey = buildLastEmailedLookupKey(
          "record",
          resolveRowBusinessAccountRecordId(row),
        );
        const accountKey = buildLastEmailedLookupKey("account", row.businessAccountId);
        return {
          ...row,
          lastEmailedAt:
            (recordKey ? lastEmailedByAccountKey[recordKey] : null) ??
            (accountKey ? lastEmailedByAccountKey[accountKey] : null) ??
            row.lastEmailedAt ??
            null,
        };
      }),
    [allRows, lastEmailedByAccountKey],
  );
  const lastEmailedLookupAccounts = useMemo(
    () => buildLastEmailedLookupAccounts(allRows),
    [allRows],
  );
  const lastEmailedLookupSignature = useMemo(
    () => JSON.stringify(lastEmailedLookupAccounts),
    [lastEmailedLookupAccounts],
  );
  const debouncedQ = useDebouncedValue(q, 180);
  const debouncedHeaderFilters = useDebouncedValue(headerFilters, 180);
  const addressLookupSearchTerm = useMemo(
    () => buildAddressLookupSearchTerm(draft),
    [draft],
  );
  const debouncedAddressLookupSearchTerm = useDebouncedValue(addressLookupSearchTerm, 250);
  const addressLookupCountry = normalizeCountryDraftValue(draft?.country);
  const allRowsCountRef = useRef(0);

  async function loadSnapshotRows(
    cachedDataset: CachedDataset | null,
    signal?: AbortSignal,
  ) {
    let statusPayload: SyncStatusResponse | null = null;
    const hasCachedRows =
      Boolean(cachedDataset) &&
      isBusinessAccountRows(cachedDataset?.rows) &&
      cachedDataset.rows.length > 0;

    async function fetchRows(forceLive = false): Promise<BusinessAccountsResponse> {
      const params = new URLSearchParams({
        sortBy: "companyName",
        sortDir: "asc",
        page: "1",
        pageSize: String(PAGE_SIZE),
        full: "1",
        includeInternal: "1",
      });
      if (forceLive) {
        params.set("live", "1");
      }

      const rowsResponse = await fetch(`/api/business-accounts?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const rowsPayload = await readJsonResponse<BusinessAccountsResponse | { error?: string }>(
        rowsResponse,
      );

      if (!rowsResponse.ok) {
        throw new Error(parseError(rowsPayload));
      }
      if (!isBusinessAccountsResponse(rowsPayload)) {
        throw new Error("Unexpected response while loading account snapshot.");
      }

      return rowsPayload;
    }

    try {
      const statusResponse = await fetch("/api/sync/status", {
        cache: "no-store",
        signal,
      });
      const nextStatusPayload = await readJsonResponse<SyncStatusResponse | { error?: string }>(
        statusResponse,
      );

      if (statusResponse.ok && isSyncStatusResponse(nextStatusPayload)) {
        statusPayload = nextStatusPayload;
        setLastSyncedAt(nextStatusPayload.lastSuccessfulSyncAt);
        setSyncBlockedReason(nextStatusPayload.manualSyncBlockedReason ?? null);
        setRemoteSyncRunning(nextStatusPayload.status === "running");

        if (canUseCachedSnapshot(cachedDataset, nextStatusPayload)) {
          return cachedDataset.rows;
        }
      }
    } catch {
      if (cachedDataset && isBusinessAccountRows(cachedDataset.rows) && cachedDataset.rows.length > 0) {
        setLastSyncedAt(cachedDataset.lastSyncedAt);
        return cachedDataset.rows;
      }
    }

    const rowsPayload = await fetchRows();
    const shouldTryLiveFallback =
      rowsPayload.items.length === 0 &&
      !hasCachedRows &&
      (!statusPayload || (!statusPayload.lastSuccessfulSyncAt && statusPayload.rowsCount === 0));

    if (shouldTryLiveFallback) {
      const liveRowsPayload = await fetchRows(true);
      if (liveRowsPayload.items.length > 0) {
        return liveRowsPayload.items;
      }
    }

    if (statusPayload && !statusPayload.lastSuccessfulSyncAt && rowsPayload.items.length === 0) {
      setError("No local snapshot yet. Click Sync records to build the first snapshot.");
    }

    return rowsPayload.items;
  }

  async function loadMailSession(): Promise<MailSessionResponse | null> {
    setIsMailSessionLoading(true);

    try {
      const response = await fetch("/api/mail/session", {
        cache: "no-store",
      });
      const payload = await readJsonResponse<MailSessionResponse | { error?: string }>(
        response,
      );

      if (!response.ok) {
        const message = parseError(payload);
        const nextSession = buildFallbackMailSession(
          response.status === 422 ? "needs_setup" : "disconnected",
          message,
        );
        setMailSession(nextSession);
        return nextSession;
      }

      if (!isMailSessionResponse(payload)) {
        throw new Error("Unexpected mail session response.");
      }

      setMailSession(payload);
      return payload;
    } catch (mailError) {
      const message =
        mailError instanceof Error ? mailError.message : "Unable to load mail session.";
      const nextSession = buildFallbackMailSession("disconnected", message);
      setMailSession(nextSession);
      return nextSession;
    } finally {
      setIsMailSessionLoading(false);
    }
  }

  async function loadMeetingOptions(force = false) {
    if (!force && (meetingOptions || isLoadingMeetingOptions)) {
      return;
    }

    setIsLoadingMeetingOptions(true);
    if (force) {
      setMeetingOptions(null);
      setMeetingOptionsError(null);
    }

    try {
      const response = await fetch("/api/meetings/options", {
        cache: "no-store",
      });
      const payload = await readJsonResponse<MeetingCreateOptionsResponse | { error?: string }>(
        response,
      );

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!isMeetingCreateOptionsResponse(payload)) {
        throw new Error("Unexpected response while loading meeting options.");
      }

      setMeetingOptions(payload);
      setMeetingOptionsError(null);
    } catch (error) {
      setMeetingOptionsError(
        error instanceof Error ? error.message : "Unable to load meeting options.",
      );
    } finally {
      setIsLoadingMeetingOptions(false);
    }
  }

  useEffect(() => {
    if (
      !session?.authenticated ||
      allRows.length === 0 ||
      isCreateMeetingDrawerOpen ||
      isLoadingMeetingOptions
    ) {
      return;
    }

    const prefetchKey = lastSyncedAt ?? "__initial__";
    if (meetingOptionsPrefetchKeyRef.current === prefetchKey) {
      return;
    }

    meetingOptionsPrefetchKeyRef.current = prefetchKey;
    void loadMeetingOptions(Boolean(meetingOptions));
  }, [
    allRows.length,
    isCreateMeetingDrawerOpen,
    isLoadingMeetingOptions,
    lastSyncedAt,
    meetingOptions,
    session?.authenticated,
  ]);

  function openMailComposer(initialState: GmailComposeInitialState | null) {
    closeTransientMenus();
    setIsCreateDrawerOpen(false);
    setIsCreateContactDrawerOpen(false);
    setIsCreateOpportunityDrawerOpen(false);
    setMeetingSource(null);
    closeDrawer();
    setEmailComposerState({
      initialState,
      isOpen: true,
    });
    void loadMailSession();
  }

  function closeMailComposer() {
    setEmailComposerState({
      initialState: null,
      isOpen: false,
    });
  }

  function handleConnectGmailFromAccounts() {
    const popup = window.open(
      "/api/mail/oauth/start?returnTo=/mail/oauth/complete",
      "mail-oauth",
      "popup=yes,width=640,height=780",
    );

    if (!popup) {
      setSaveError("Popup blocked. Allow popups for this app to connect Gmail.");
    }
  }

  useEffect(() => {
    allRowsRef.current = allRows;
    allRowsCountRef.current = allRows.length;
  }, [allRows]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    if (
      contactEnhanceFingerprint !== null &&
      currentContactEnhanceFingerprint !== null &&
      contactEnhanceFingerprint !== currentContactEnhanceFingerprint
    ) {
      setContactEnhanceCandidates([]);
      setContactEnhanceError(null);
      setContactEnhanceNotice(null);
      setContactEnhanceFingerprint(null);
    }
  }, [contactEnhanceFingerprint, currentContactEnhanceFingerprint]);

  useEffect(() => {
    if (
      companyAttributeSuggestionFingerprint !== null &&
      currentCompanyAttributeSuggestionFingerprint !== null &&
      companyAttributeSuggestionFingerprint !== currentCompanyAttributeSuggestionFingerprint
    ) {
      setCompanyAttributeSuggestionError(null);
      setCompanyAttributeSuggestionNotice(null);
      setCompanyAttributeSuggestionResult(null);
      setCompanyAttributeSuggestionFingerprint(null);
    }
  }, [
    companyAttributeSuggestionFingerprint,
    currentCompanyAttributeSuggestionFingerprint,
  ]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    if (lastEmailedLookupAccounts.length === 0) {
      setLastEmailedByAccountKey({});
      return;
    }

    const controller = new AbortController();

    async function loadLastEmailed() {
      try {
        const response = await fetch("/api/mail/last-emailed", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accounts: lastEmailedLookupAccounts,
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<
          MailLastEmailedResponse | { error?: string }
        >(response);

        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        if (!isMailLastEmailedResponse(payload)) {
          throw new Error("Unexpected last emailed response.");
        }

        if (controller.signal.aborted) {
          return;
        }

        const next: Record<string, string | null> = {};
        payload.items.forEach((item) => {
          const recordKey = buildLastEmailedLookupKey(
            "record",
            item.businessAccountRecordId,
          );
          const accountKey = buildLastEmailedLookupKey(
            "account",
            item.businessAccountId,
          );
          if (recordKey) {
            next[recordKey] = item.lastEmailedAt;
          }
          if (accountKey) {
            next[accountKey] = item.lastEmailedAt;
          }
        });

        setLastEmailedByAccountKey(next);
      } catch {
        if (!controller.signal.aborted) {
          setLastEmailedByAccountKey({});
        }
      }
    }

    void loadLastEmailed();

    return () => controller.abort();
  }, [
    lastEmailedLookupAccounts,
    lastEmailedLookupSignature,
    lastEmailedRefreshVersion,
    session?.authenticated,
  ]);

  useEffect(() => {
    setSelectedContactRowKeys((current) => {
      const validRowKeys = new Set(
        allRows.filter((row) => isContactSelectableRow(row)).map((row) => getRowKey(row)),
      );
      const next = current.filter((rowKey) => validRowKeys.has(rowKey));
      return next.length === current.length ? current : next;
    });
  }, [allRows]);

  const deferredDisplayRows = useDeferredValue(displayRows);

  const queryResult = useMemo(
    () =>
      queryBusinessAccounts(deferredDisplayRows, {
        includeInternalRows: true,
        q: debouncedQ,
        filterCompanyName: debouncedHeaderFilters.companyName,
        filterAccountType: debouncedHeaderFilters.accountType,
        filterOpportunityCount: debouncedHeaderFilters.opportunityCount,
        filterSalesRep: debouncedHeaderFilters.salesRepName,
        filterIndustryType: debouncedHeaderFilters.industryType,
        filterSubCategory: debouncedHeaderFilters.subCategory,
        filterCompanyRegion: debouncedHeaderFilters.companyRegion,
        filterWeek: debouncedHeaderFilters.week,
        filterAddress: debouncedHeaderFilters.address,
        filterCompanyPhone: debouncedHeaderFilters.companyPhone,
        filterPrimaryContactName: debouncedHeaderFilters.primaryContactName,
        filterPrimaryContactJobTitle: debouncedHeaderFilters.primaryContactJobTitle,
        filterPrimaryContactPhone: debouncedHeaderFilters.primaryContactPhone,
        filterPrimaryContactExtension: debouncedHeaderFilters.primaryContactExtension,
        filterPrimaryContactEmail: debouncedHeaderFilters.primaryContactEmail,
        filterNotes: debouncedHeaderFilters.notes,
        filterCategory: debouncedHeaderFilters.category || undefined,
        filterLastCalled: debouncedHeaderFilters.lastCalled,
        filterLastEmailed: debouncedHeaderFilters.lastEmailed,
        filterLastModified: debouncedHeaderFilters.lastModified,
        sortBy,
        sortDir,
        page,
        pageSize: PAGE_SIZE,
      }),
    [
      debouncedHeaderFilters,
      debouncedQ,
      deferredDisplayRows,
      page,
      sortBy,
      sortDir,
    ],
  );

  const canExportAccountsCsv =
    session?.authenticated === true &&
    [session.user?.id, session.user?.name].some(
      (value) => value?.trim().toLowerCase() === "jserrano",
    );
  const accountsCsvExportHref = useMemo(
    () =>
      buildAccountsCsvExportHref({
        q: debouncedQ,
        headerFilters: debouncedHeaderFilters,
        sortBy,
        sortDir,
      }),
    [debouncedHeaderFilters, debouncedQ, sortBy, sortDir],
  );
  const rows = queryResult.items;
  const total = queryResult.total;
  const selectedContactRows = useMemo(() => {
    const selectedRowKeySet = new Set(selectedContactRowKeys);
    return displayRows.filter(
      (row) => selectedRowKeySet.has(getRowKey(row)) && isContactSelectableRow(row),
    );
  }, [displayRows, selectedContactRowKeys]);
  const visibleColumnOrder = useMemo(
    () => columnOrder.filter((columnId) => visibleColumns.includes(columnId)),
    [columnOrder, visibleColumns],
  );
  const visibleColumnConfigs = useMemo(
    () =>
      columnOrder.map((columnId) => ({
        ...getColumnConfig(columnId),
        isVisible: visibleColumns.includes(columnId),
      })),
    [columnOrder, visibleColumns],
  );
  const activeFilterCount = useMemo(
    () =>
      Object.values(headerFilters).filter((value) =>
        typeof value === "string" ? value.trim().length > 0 : Boolean(value),
      ).length,
    [headerFilters],
  );
  const hasActiveWorkbenchFilters = q.trim().length > 0 || activeFilterCount > 0;
  const syncUpdatedLabel = useMemo(() => formatRelativeTime(lastSyncedAt), [lastSyncedAt]);
  const hasSnapshot = Boolean(lastSyncedAt) || allRows.length > 0;
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
  const fallbackMeetingOptions = useMemo(
    () =>
      allRows.length > 0
        ? buildMeetingCreateOptionsFromRows(allRows, DEFAULT_MEETING_TIME_ZONE)
        : null,
    [allRows],
  );
  const mailContactSuggestions = useMemo<MailContactSuggestion[]>(
    () => buildMailContactSuggestions(allRows),
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
  const currentPageSelectableRows = useMemo(
    () => rows.filter((row) => isContactSelectableRow(row)),
    [rows],
  );
  const currentPageSelectedCount = useMemo(() => {
    const selectedRowKeySet = new Set(selectedContactRowKeys);
    return currentPageSelectableRows.filter((row) => selectedRowKeySet.has(getRowKey(row))).length;
  }, [currentPageSelectableRows, selectedContactRowKeys]);
  const allCurrentPageSelected =
    currentPageSelectableRows.length > 0 &&
    currentPageSelectedCount === currentPageSelectableRows.length;
  const selectedMergeAccountRecordId = useMemo(() => {
    if (!selectedContactRows.length) {
      return null;
    }

    return resolveRowBusinessAccountRecordId(selectedContactRows[0]);
  }, [selectedContactRows]);
  const selectedMergeBusinessAccountId = selectedContactRows[0]?.businessAccountId ?? null;
  const mergeSelectionEligible = useMemo(() => {
    if (selectedContactRows.length < 2) {
      return false;
    }

    const accountIds = new Set(
      selectedContactRows.map((row) => row.accountRecordId?.trim() || row.businessAccountId.trim()),
    );
    return accountIds.size === 1;
  }, [selectedContactRows]);
  const mergeSelectionDisabledReason = useMemo(() => {
    if (selectedContactRows.length === 0) {
      return null;
    }

    if (selectedContactRows.length < 2) {
      return "Select at least 2 contacts to merge.";
    }

    if (!mergeSelectionEligible) {
      return "Merge requires all selected contacts to belong to the same account.";
    }

    return null;
  }, [mergeSelectionEligible, selectedContactRows.length]);
  const drawerNeedsCompanyAssignment = Boolean(
    selected &&
      !selected.businessAccountId.trim() &&
      (selected.contactId !== null ||
        (selected.primaryContactId !== null && selected.primaryContactId !== undefined)),
  );
  const canEnhanceSelectedContact = Boolean(
    selected &&
      draft &&
      selected.contactId &&
      rocketReachEnabled &&
      hasMissingContactEnhanceField(draft),
  );
  const canSuggestSelectedCompanyAttributes = Boolean(
    selected &&
      draft &&
      openAiAttributeSuggestEnabled &&
      hasMissingCompanyAttributeSuggestionField(draft),
  );

  const paginationNumbers = useMemo(
    () => buildPaginationNumbers(page, totalPages),
    [page, totalPages],
  );
  const syncPercent = useMemo(() => {
    if (!syncProgress || !syncProgress.totalAccounts || syncProgress.totalAccounts <= 0) {
      return null;
    }

    return Math.min(
      100,
      Math.round((syncProgress.fetchedAccounts / syncProgress.totalAccounts) * 100),
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
    const shouldResetColumnPrefs =
      window.sessionStorage.getItem(COLUMN_PREF_RESET_STORAGE_KEY) === "1";
    if (shouldResetColumnPrefs) {
      const columnStorageCandidates = [COLUMN_STORAGE_KEY, ...LEGACY_COLUMN_STORAGE_KEYS];
      for (const key of columnStorageCandidates) {
        window.localStorage.removeItem(key);
      }

      const columnVisibilityCandidates = [
        COLUMN_VISIBILITY_STORAGE_KEY,
        ...LEGACY_COLUMN_VISIBILITY_STORAGE_KEYS,
      ];
      for (const key of columnVisibilityCandidates) {
        window.localStorage.removeItem(key);
      }

      setColumnOrder(DEFAULT_COLUMN_ORDER);
      setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
      window.sessionStorage.removeItem(COLUMN_PREF_RESET_STORAGE_KEY);
      setColumnPrefsHydrated(true);
      return;
    }

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

        const migratedColumnOrder = mergeStoredColumnList(
          parsedColumnOrder,
          DEFAULT_COLUMN_ORDER,
        );
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

        const migratedVisibleColumns = mergeStoredColumnList(
          parsedVisibleColumns,
          DEFAULT_VISIBLE_COLUMNS,
        );
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
    const cachedDataset = readCachedDatasetFromStorage();
    if (cachedDataset && isBusinessAccountRows(cachedDataset.rows)) {
      allRowsCountRef.current = cachedDataset.rows.length;
      setAllRows(enforceSinglePrimaryPerAccountRows(cachedDataset.rows));
      setLastSyncedAt(cachedDataset.lastSyncedAt);
      setLoading(false);
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

  const refreshLiveUpdatedAccount = useEffectEvent(
    async (event: BusinessAccountLiveEvent): Promise<void> => {
      if (!session?.authenticated || isSavingRef.current) {
        return;
      }

      const selectedRow = selectedRef.current;
      const currentRows = allRowsRef.current;
      const shouldRefresh =
        rowMatchesLiveAccountEvent(selectedRow, event) ||
        currentRows.some((row) => rowMatchesLiveAccountEvent(row, event));

      if (!shouldRefresh) {
        return;
      }

      try {
        const preferredContactId =
          selectedRow && rowMatchesLiveAccountEvent(selectedRow, event)
            ? resolveRowContactId(selectedRow)
            : event.targetContactId;
        const response = await fetch(
          buildBusinessAccountDetailUrl(event.accountRecordId, preferredContactId),
          {
            cache: "no-store",
          },
        );
        const payload = await readJsonResponse<
          BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
        >(response);
        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        const refreshedRows =
          readDetailResponseRows(payload) ??
          (() => {
            const refreshedRow = readDetailResponseRow(payload);
            return refreshedRow ? [refreshedRow] : null;
          })();
        if (!refreshedRows || refreshedRows.length === 0) {
          return;
        }

        const responseRow = readDetailResponseRow(payload) ?? refreshedRows[0];
        setAllRows((rows) =>
          replaceRowsForAccount(
            rows,
            refreshedRows,
            event.accountRecordId,
            responseRow.businessAccountId,
          ),
        );
        setLastSyncedAt(event.at);
        clearCachedMapData();

        if (selectedRow && rowMatchesLiveAccountEvent(selectedRow, event)) {
          const nextSelected =
            findMatchingAccountRow(refreshedRows, selectedRow) ?? responseRow;
          if (isDraftDirty(draftRef.current)) {
            setSaveNotice(
              "This record changed in Acumatica while you were editing. Your draft is preserved.",
            );
            return;
          }

          setSelected(nextSelected);
          setDraft(buildDraft(nextSelected));
        }
      } catch {
        // Ignore transient live-refresh failures and keep the local working set.
      }
    },
  );

  const refreshSnapshotFromLive = useEffectEvent(async () => {
    const cachedDataset = readCachedDatasetFromStorage();

    try {
      const nextRows = await loadSnapshotRows(cachedDataset);
      setAllRows(enforceSinglePrimaryPerAccountRows(nextRows));
      setError(null);
    } catch {
      // Ignore transient full-refresh failures and keep the current working set.
    }
  });

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const eventSource = new EventSource("/api/business-accounts/stream");
    const handleChanged = (rawEvent: MessageEvent) => {
      try {
        const parsed = JSON.parse(rawEvent.data) as BusinessAccountLiveEvent;
        if (parsed?.type !== "changed") {
          return;
        }

        if (parsed.reason === "full-sync") {
          void refreshSnapshotFromLive();
          return;
        }

        if (parsed.accountRecordId) {
          void refreshLiveUpdatedAccount(parsed);
        }
      } catch {
        // Ignore malformed live update events.
      }
    };

    eventSource.addEventListener("changed", handleChanged as EventListener);

    return () => {
      eventSource.removeEventListener("changed", handleChanged as EventListener);
      eventSource.close();
    };
  }, [refreshLiveUpdatedAccount, refreshSnapshotFromLive, session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated || !selected) {
      setCallHistory([]);
      setCallHistoryLoading(false);
      setCallHistoryError(null);
      return;
    }

    const businessAccountRecordId =
      selected.accountRecordId?.trim() || selected.id.trim();
    if (businessAccountRecordId.length === 0) {
      setCallHistory([]);
      setCallHistoryLoading(false);
      setCallHistoryError(null);
      return;
    }
    const selectedContactId = selected.contactId ?? null;

    const controller = new AbortController();
    setCallHistoryLoading(true);
    setCallHistoryError(null);

    async function loadCallHistory() {
      try {
        const response = await fetch(
          buildBusinessAccountCallHistoryUrl(
            businessAccountRecordId,
            selectedContactId,
          ),
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = await readJsonResponse<
          BusinessAccountCallHistoryResponse | { error?: string }
        >(response);
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isBusinessAccountCallHistoryResponse(payload)) {
          throw new Error("Unexpected call history response.");
        }

        setCallHistory(payload.items);
      } catch (callHistoryError) {
        if (controller.signal.aborted) {
          return;
        }

        setCallHistory([]);
        setCallHistoryError(
          callHistoryError instanceof Error
            ? callHistoryError.message
            : "Unable to load call history.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setCallHistoryLoading(false);
        }
      }
    }

    void loadCallHistory();

    return () => {
      controller.abort();
    };
  }, [selected, session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated || !selected) {
      setAuditHistory([]);
      setAuditHistoryLoading(false);
      setAuditHistoryError(null);
      return;
    }

    const businessAccountRecordId =
      selected.accountRecordId?.trim() || selected.id.trim() || null;
    if (!businessAccountRecordId) {
      setAuditHistory([]);
      setAuditHistoryLoading(false);
      setAuditHistoryError(null);
      return;
    }

    const params = new URLSearchParams({
      businessAccountRecordId,
      page: "1",
      pageSize: "10",
    });
    if (selected.contactId) {
      params.set("contactId", String(selected.contactId));
    }

    const controller = new AbortController();
    setAuditHistoryLoading(true);
    setAuditHistoryError(null);

    async function loadAuditHistory() {
      try {
        const response = await fetch(`/api/audit?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<AuditLogResponse | { error?: string }>(response);
        if (!response.ok) {
          throw new Error(
            payload && "error" in payload && payload.error
              ? payload.error
              : "Unable to load audit history.",
          );
        }
        if (!payload || !("items" in payload)) {
          throw new Error("Unexpected audit history response.");
        }

        setAuditHistory(payload.items);
      } catch (auditError) {
        if (controller.signal.aborted) {
          return;
        }
        setAuditHistory([]);
        setAuditHistoryError(
          auditError instanceof Error ? auditError.message : "Unable to load audit history.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setAuditHistoryLoading(false);
        }
      }
    }

    void loadAuditHistory();

    return () => {
      controller.abort();
    };
  }, [selected, session?.authenticated]);

  useEffect(() => {
    if (
      !session?.authenticated ||
      employeeOptions.length > 0 ||
      employeesFetchAttemptedRef.current
    ) {
      return;
    }

    const controller = new AbortController();
    const requestId = employeesFetchRequestRef.current + 1;
    let active = true;
    let settled = false;
    employeesFetchRequestRef.current = requestId;

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

        if (controller.signal.aborted || requestId !== employeesFetchRequestRef.current) {
          return;
        }

        settled = true;
        setEmployeeOptions(payload.items);
      } catch (employeesRequestError) {
        if (controller.signal.aborted || requestId !== employeesFetchRequestRef.current) {
          return;
        }

        settled = true;
        setEmployeesError(
          employeesRequestError instanceof Error
            ? employeesRequestError.message
            : "Unable to load sales reps.",
        );
      } finally {
        if (active && requestId === employeesFetchRequestRef.current) {
          setIsEmployeesLoading(false);
        }
      }
    }

    void fetchEmployees();

    return () => {
      active = false;
      controller.abort();
      if (!settled && requestId === employeesFetchRequestRef.current) {
        employeesFetchAttemptedRef.current = false;
      }
    };
  }, [
    employeeOptions.length,
    session?.authenticated,
  ]);

  useEffect(() => {
    if (!draft || !draft.salesRepName || sortedEmployeeOptions.length === 0) {
      return;
    }

    const currentSelection =
      draft.salesRepId ? findEmployeeById(sortedEmployeeOptions, draft.salesRepId) : null;
    if (currentSelection) {
      return;
    }

    const matchedEmployee = matchEmployeeByName(sortedEmployeeOptions, draft.salesRepName);
    if (!matchedEmployee) {
      return;
    }

    setDraft((current) =>
      current &&
      current.salesRepName &&
      normalizeComparable(current.salesRepName) === normalizeComparable(draft.salesRepName)
        ? {
            ...current,
            salesRepId: matchedEmployee.id,
            salesRepName: matchedEmployee.name,
          }
        : current,
    );
  }, [draft, sortedEmployeeOptions]);

  useEffect(() => {
    if (!isCreateMenuOpen && !isFiltersOpen && !rowMenuRowKey) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof HTMLElement)) {
        closeTransientMenus();
        return;
      }

      if (event.target.closest('[data-transient-menu="true"]')) {
        return;
      }

      closeTransientMenus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeTransientMenus();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", closeTransientMenus);
    window.addEventListener("keydown", handleKeyDown);
    if (rowMenuRowKey) {
      window.addEventListener("scroll", closeTransientMenus, true);
    }

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", closeTransientMenus);
      window.removeEventListener("keydown", handleKeyDown);
      if (rowMenuRowKey) {
        window.removeEventListener("scroll", closeTransientMenus, true);
      }
    };
  }, [isCreateMenuOpen, isFiltersOpen, rowMenuRowKey]);

  useEffect(() => {
    if (!selected || drawerFocusTarget !== "notes" || !notesFieldRef.current) {
      return;
    }

    const target = notesFieldRef.current;
    target.focus();
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setDrawerFocusTarget(null);
  }, [drawerFocusTarget, selected]);

  useEffect(() => {
    if (!emailComposerState.isOpen || mailSession || isMailSessionLoading) {
      return;
    }

    void loadMailSession();
  }, [emailComposerState.isOpen, isMailSessionLoading, mailSession]);

  useEffect(() => {
    function handleOauthMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== "object") {
        return;
      }

      const record = event.data as Record<string, unknown>;
      if (record.type !== "mbmail.oauth") {
        return;
      }

      if (record.success === true) {
        void loadMailSession();
        setSaveNotice("Gmail connected. You can send email from the app now.");
        setSaveError(null);
        return;
      }

      if (typeof record.message === "string" && record.message.trim()) {
        setSaveError(record.message.trim());
      }
    }

    window.addEventListener("message", handleOauthMessage);
    return () => {
      window.removeEventListener("message", handleOauthMessage);
    };
  }, []);

  useEffect(() => {
    if (!session?.authenticated || !cacheHydrated) {
      return;
    }

    const controller = new AbortController();

    async function loadRows() {
      const startedAt = Date.now();
      const cachedDataset = readCachedDatasetFromStorage();
      if (!cachedDataset || cachedDataset.rows.length === 0) {
        setLoading(true);
      }

      try {
        const nextRows = await loadSnapshotRows(cachedDataset, controller.signal);
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
          const selectedContactId = resolveRowContactId(row);

          try {
            const response = await fetch(
              buildBusinessAccountDetailUrl(accountRecordId, selectedContactId),
              {
                cache: "no-store",
                signal: controller.signal,
              },
            );
            const payload = await readJsonResponse<
              BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
            >(response);
            if (!response.ok) {
              continue;
            }

            const refreshedRow =
              findMatchingAccountRow(readDetailResponseRows(payload) ?? [], row) ??
              readDetailResponseRow(payload);
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
                          primaryContactJobTitle: pickPreferredText(
                            row.primaryContactJobTitle,
                            refreshedRow.primaryContactJobTitle,
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

  function closeTransientMenus() {
    setIsCreateMenuOpen(false);
    setCreateMenuPosition(null);
    setIsFiltersOpen(false);
    setRowMenuRowKey(null);
    setRowMenuPosition(null);
    setDraggedColumnId(null);
    setColumnDropTargetId(null);
  }

  function openCreateMenu() {
    const trigger = createMenuButtonRef.current;
    if (!trigger) {
      setIsCreateMenuOpen(true);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(220, window.innerWidth - 32);
    const viewportPadding = 16;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );

    setCreateMenuPosition({
      left,
      top: rect.bottom + 10,
    });
    setIsCreateMenuOpen(true);
  }

  function openRowMenu(rowKey: string, trigger: HTMLButtonElement) {
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 196;
    const menuHeight = 176;
    const viewportPadding = 12;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );
    const preferredTop = rect.bottom + 8;
    const top =
      preferredTop + menuHeight <= window.innerHeight - viewportPadding
        ? preferredTop
        : Math.max(viewportPadding, rect.top - menuHeight - 8);

    setRowMenuRowKey(rowKey);
    setRowMenuPosition({ left, top });
  }

  function handleSort(column: SortBy) {
    setPage(1);
    if (sortBy === column) {
      setSortDir((currentSortDir) => (currentSortDir === "asc" ? "desc" : "asc"));
    } else {
      setSortDir("asc");
      setSortBy(column);
    }
    closeTransientMenus();
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
    if (remoteSyncRunning) {
      setError("A full account sync is already running.");
      return;
    }

    if (syncBlockedReason) {
      setError(syncBlockedReason);
      return;
    }

    hydratingContactRowKeysRef.current.clear();
    hydratedContactRowKeysRef.current.clear();
    resolvingPrimaryAccountIdsRef.current.clear();
    resolvedPrimaryAccountIdsRef.current.clear();
    resolvingSalesRepAccountIdsRef.current.clear();
    resolvedSalesRepAccountIdsRef.current.clear();

    const startedAt = Date.now();
    setError(null);
    setIsSyncing(true);
    setSyncStartedAt(startedAt);
    setSyncElapsedMs(0);
    setSyncProgress({
      fetchedAccounts: 0,
      totalAccounts: null,
      fetchedContacts: 0,
      totalContacts: null,
      snapshotRows: 0,
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

        setSyncBlockedReason(statusPayload.manualSyncBlockedReason ?? null);
        setRemoteSyncRunning(statusPayload.status === "running");

        setSyncProgress({
          fetchedAccounts: statusPayload.progress?.fetchedAccounts ?? statusPayload.accountsCount,
          totalAccounts: statusPayload.progress?.totalAccounts ?? statusPayload.accountsCount,
          fetchedContacts: statusPayload.progress?.fetchedContacts ?? statusPayload.contactsCount,
          totalContacts: statusPayload.progress?.totalContacts ?? statusPayload.contactsCount,
          snapshotRows: statusPayload.rowsCount,
        });

        if (statusPayload.status !== "running") {
          if (statusPayload.status === "failed") {
            throw new Error(statusPayload.lastError ?? "Sync failed.");
          }
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

  function handleReorderColumn(source: SortBy, target: SortBy) {
    if (source === target) {
      return;
    }

    setColumnOrder((current) => reorderColumns(current, source, target));
  }

  function handleMoveColumn(column: SortBy, direction: "up" | "down") {
    setColumnOrder((current) => {
      const index = current.indexOf(column);
      if (index < 0) {
        return current;
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      return reorderColumns(current, column, current[targetIndex]);
    });
  }

  function handleColumnDragStart(event: ReactDragEvent<HTMLElement>, columnId: SortBy) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnId);
    setDraggedColumnId(columnId);
    setColumnDropTargetId(columnId);
  }

  function handleColumnDragOver(event: ReactDragEvent<HTMLElement>, columnId: SortBy) {
    if (!draggedColumnId || draggedColumnId === columnId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (columnDropTargetId !== columnId) {
      setColumnDropTargetId(columnId);
    }
  }

  function handleColumnDrop(event: ReactDragEvent<HTMLElement>, targetColumnId: SortBy) {
    event.preventDefault();

    const dataTransferValue = event.dataTransfer.getData("text/plain").trim();
    const sourceColumnId =
      draggedColumnId ??
      (DEFAULT_COLUMN_ORDER.includes(dataTransferValue as SortBy)
        ? (dataTransferValue as SortBy)
        : null);

    if (sourceColumnId) {
      handleReorderColumn(sourceColumnId, targetColumnId);
    }

    setDraggedColumnId(null);
    setColumnDropTargetId(null);
  }

  function handleColumnDragEnd() {
    setDraggedColumnId(null);
    setColumnDropTargetId(null);
  }

  function openCreateDrawer() {
    closeTransientMenus();
    closeMailComposer();
    setIsCreateContactDrawerOpen(false);
    setIsCreateOpportunityDrawerOpen(false);
    setIsCreateMeetingDrawerOpen(false);
    setMeetingSource(null);
    setCreateContactDrawerInitialAccountRecordId(null);
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
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
    closeTransientMenus();
    closeMailComposer();
    setIsCreateDrawerOpen(false);
    setIsCreateMeetingDrawerOpen(false);
    setMeetingSource(null);
    closeDrawer();
    setCreateContactDrawerInitialAccountRecordId(null);
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
    setIsCreateContactDrawerOpen(true);
  }

  function openCreateContactDrawerFromRow(row: BusinessAccountRow) {
    if (!canAddContactToRow(row)) {
      setSaveError(
        "This row is not attached to a business account yet. Assign it to an account before adding another contact.",
      );
      setSaveNotice(null);
      closeTransientMenus();
      return;
    }

    closeTransientMenus();
    closeMailComposer();
    setIsCreateDrawerOpen(false);
    setIsCreateMeetingDrawerOpen(false);
    setIsCreateOpportunityDrawerOpen(false);
    setMeetingSource(null);
    closeDrawer();
    setSaveError(null);
    setSaveNotice(null);
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
    setCreateContactDrawerInitialAccountRecordId(resolveRowBusinessAccountRecordId(row));
    setIsCreateContactDrawerOpen(true);
  }

  function closeCreateContactDrawer() {
    setIsCreateContactDrawerOpen(false);
    setCreateContactDrawerInitialAccountRecordId(null);
    if (resumeOpportunityAfterContactCreate) {
      setOpportunityDrawerContext(resumeOpportunityAfterContactCreate);
      setResumeOpportunityAfterContactCreate(null);
      setPendingOpportunityResumeAccountRecordId(null);
      setIsCreateOpportunityDrawerOpen(true);
      return;
    }

    setPendingOpportunityResumeAccountRecordId(null);
  }

  function openCreateOpportunityDrawer(context?: Partial<OpportunityDrawerContext>) {
    closeTransientMenus();
    closeMailComposer();
    setIsCreateDrawerOpen(false);
    setIsCreateContactDrawerOpen(false);
    setIsCreateMeetingDrawerOpen(false);
    setMeetingSource(null);
    setCreateContactDrawerInitialAccountRecordId(null);
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
    closeDrawer();
    setSaveError(null);
    setSaveNotice(null);
    setOpportunityDrawerContext({
      initialAccountRecordId: context?.initialAccountRecordId ?? null,
      initialContactId: context?.initialContactId ?? null,
      initialOwnerId: context?.initialOwnerId ?? null,
      initialOwnerName: context?.initialOwnerName ?? null,
    });
    setIsCreateOpportunityDrawerOpen(true);
  }

  function closeCreateOpportunityDrawer() {
    setIsCreateOpportunityDrawerOpen(false);
    setOpportunityDrawerContext({
      initialAccountRecordId: null,
      initialContactId: null,
      initialOwnerId: null,
      initialOwnerName: null,
    });
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
  }

  function openCreateMeetingDrawer(category: MeetingCategory) {
    closeTransientMenus();
    closeMailComposer();
    setIsCreateDrawerOpen(false);
    setIsCreateContactDrawerOpen(false);
    setIsCreateOpportunityDrawerOpen(false);
    setCreateContactDrawerInitialAccountRecordId(null);
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
    closeDrawer();
    setSaveError(null);
    setSaveNotice(null);
    setCreateMeetingCategory(category);
    setMeetingSource(null);
    setIsCreateMeetingDrawerOpen(true);
    void loadMeetingOptions(true);
  }

  function openCreateMeetingDrawerFromRow(
    row: BusinessAccountRow,
    category: MeetingCategory,
  ) {
    closeTransientMenus();
    closeMailComposer();
    setIsCreateDrawerOpen(false);
    setIsCreateContactDrawerOpen(false);
    setIsCreateOpportunityDrawerOpen(false);
    setCreateContactDrawerInitialAccountRecordId(null);
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
    closeDrawer();
    setSaveError(null);
    setSaveNotice(null);
    setCreateMeetingCategory(category);
    setMeetingSource(buildMeetingSourceFromRow(row));
    setIsCreateMeetingDrawerOpen(true);
    void loadMeetingOptions(true);
  }

  function closeCreateMeetingDrawer() {
    setIsCreateMeetingDrawerOpen(false);
    setCreateMeetingCategory("Meeting");
    setMeetingSource(null);
  }

  function openCreateOpportunityDrawerFromRow(row: BusinessAccountRow) {
    const targetContactId = resolveRowContactId(row);
    const businessAccountRecordId = resolveRowBusinessAccountRecordId(row);

    if (targetContactId === null) {
      setIsCreateOpportunityDrawerOpen(false);
      setOpportunityDrawerContext({
        initialAccountRecordId: null,
        initialContactId: null,
        initialOwnerId: null,
        initialOwnerName: null,
      });
      setPendingOpportunityResumeAccountRecordId(businessAccountRecordId);
      setResumeOpportunityAfterContactCreate(null);
      setCreateContactDrawerInitialAccountRecordId(businessAccountRecordId);
      setIsCreateDrawerOpen(false);
      closeDrawer();
      setSaveError(null);
      setSaveNotice(
        "Create a contact for this account first. The opportunity form will open after the contact is created.",
      );
      setIsCreateContactDrawerOpen(true);
      return;
    }

    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
    setCreateContactDrawerInitialAccountRecordId(null);
    openCreateOpportunityDrawer({
      initialAccountRecordId: businessAccountRecordId,
      initialContactId: targetContactId,
      initialOwnerId: row.salesRepId,
      initialOwnerName: row.salesRepName,
    });
  }

  function openEmailComposerFromRow(row: BusinessAccountRow) {
    const initialState = buildEmailInitialStateFromRow(row);
    if (!initialState) {
      setSaveError(
        "This contact does not have an email address on file. Add an email first.",
      );
      setSaveNotice(null);
      return;
    }

    closeTransientMenus();
    setSaveError(null);
    setSaveNotice(null);
    openMailComposer(initialState);
  }

  function handleOpportunityDrawerRequestCreateContact(businessAccountRecordId: string) {
    setPendingOpportunityResumeAccountRecordId(businessAccountRecordId);
    setResumeOpportunityAfterContactCreate(null);
    setCreateContactDrawerInitialAccountRecordId(businessAccountRecordId);
    setIsCreateOpportunityDrawerOpen(false);
    setIsCreateContactDrawerOpen(true);
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

    if (pendingOpportunityResumeAccountRecordId) {
      setResumeOpportunityAfterContactCreate({
        initialAccountRecordId: result.businessAccountRecordId,
        initialContactId: result.contactId,
        initialOwnerId: null,
        initialOwnerName: null,
      });
    }
  }

  function handleMeetingContactCreated(
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) {
    handleContactCreated(result);
    setMeetingOptions((current) =>
      current ? mergeMeetingCreateOptions(current, result.accountRows) : current,
    );
  }

  function handleOpportunityCreated(result: OpportunityCreateResponse) {
    setSaveError(null);
    const companyLabel = result.companyName?.trim() || "the selected account";
    const contactLabel = result.contactName?.trim() || `contact ${result.contactId}`;
    setSaveNotice(
      `Opportunity ${result.opportunityId} created in Acumatica for ${companyLabel} (${contactLabel}).`,
    );
    setPendingOpportunityResumeAccountRecordId(null);
    setResumeOpportunityAfterContactCreate(null);
  }

  function handleEmailSent(result: MailSendResponse) {
    setSaveError(null);
    if (result.activitySyncStatus === "synced" && result.activityId) {
      setSaveNotice(
        `Email sent and logged to Acumatica. Gmail thread ${result.threadId}, activity ${result.activityId}.`,
      );
    } else if (result.activitySyncStatus === "failed") {
      setSaveNotice(
        `Email sent, but Acumatica logging failed${result.activityError ? `: ${result.activityError}` : "."}`,
      );
    } else if (result.activitySyncStatus === "pending") {
      setSaveNotice(`Email sent. Gmail thread ${result.threadId} is still syncing to Acumatica.`);
    } else {
      setSaveNotice(`Email sent. Gmail thread ${result.threadId} updated.`);
    }
    setLastEmailedRefreshVersion((current) => current + 1);
    setEmailComposerState({
      initialState: null,
      isOpen: false,
    });
    void loadMailSession();
  }

  function openDrawerForNotes(row: BusinessAccountRow) {
    if (!canEditRowNote(row)) {
      setSaveError("This row has no contact to store a note on.");
      setSaveNotice(null);
      return;
    }

    setSaveError(null);
    setDrawerFocusTarget("notes");
    void openDrawer(row, { focusTarget: "notes" });
  }

  function openDeleteContactQueueModal(rows: BusinessAccountRow[]) {
    const deletableRows = rows.filter((row) => canDeleteRowContact(row));
    if (deletableRows.length === 0) {
      setSaveError("These rows have no contact ID, so they cannot be deleted.");
      setSaveNotice(null);
      return;
    }

    closeTransientMenus();
    setDeleteQueueRows(deletableRows);
    setSaveError(null);
  }

  function openDeleteContactConfirmation(row: BusinessAccountRow) {
    if (!canDeleteRowContact(row)) {
      setSaveError("This row has no contact ID, so it cannot be deleted.");
      setSaveNotice(null);
      return;
    }

    openDeleteContactQueueModal([row]);
  }

  function closeDeleteContactConfirmation() {
    if (isDeletingContact || isDeletingSelectedContacts) {
      return;
    }

    setDeleteQueueRows([]);
  }

  function openDeleteBusinessAccountConfirmation(row: BusinessAccountRow) {
    if (!canDeleteBusinessAccountRow(row)) {
      setSaveError(
        "Delete every contact on this business account before queueing the account deletion.",
      );
      setSaveNotice(null);
      return;
    }

    closeTransientMenus();
    setDeleteBusinessAccountRow(row);
    setSaveError(null);
  }

  function closeDeleteBusinessAccountConfirmation() {
    if (isDeletingBusinessAccount) {
      return;
    }

    setDeleteBusinessAccountRow(null);
  }

  function resetContactEnhanceState() {
    setIsEnhancingContact(false);
    setContactEnhanceError(null);
    setContactEnhanceNotice(null);
    setContactEnhanceCandidates([]);
    setContactEnhanceFingerprint(null);
  }

  function resetCompanyAttributeSuggestionState() {
    setIsSuggestingCompanyAttributes(false);
    setCompanyAttributeSuggestionError(null);
    setCompanyAttributeSuggestionNotice(null);
    setCompanyAttributeSuggestionResult(null);
    setCompanyAttributeSuggestionFingerprint(null);
  }

  function clearSaveFieldError(field: BusinessAccountSaveErrorField) {
    setSaveFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function closeDrawer(options?: { preserveNotice?: boolean }) {
    setSelected(null);
    setDraft(null);
    setDrawerFocusTarget(null);
    setSaveError(null);
    setSaveFieldErrors({});
    if (!options?.preserveNotice) {
      setSaveNotice(null);
    }
    setIsDeletingContact(false);
    setAddressSuggestions([]);
    setAddressLookupError(null);
    setIsAddressLookupLoading(false);
    setAddressLookupArmed(false);
    setIsApplyingAddress(false);
    setDeleteQueueRows([]);
    resetContactEnhanceState();
    resetCompanyAttributeSuggestionState();
    if (employeeOptions.length === 0) {
      employeesFetchAttemptedRef.current = false;
    }
  }

  function handleMeetingCreated(result: MeetingCreateResponse) {
    setIsCreateMeetingDrawerOpen(false);
    setCreateMeetingCategory("Meeting");
    setMeetingSource(null);
    setSaveError(null);
    const categoryLabel = result.category === "Drop Off" ? "Drop off" : "Meeting";
    const messageParts = [`${categoryLabel} "${result.summary}" created in Acumatica.`];
    if (result.inviteAuthority === "google" && (
      result.calendarInviteStatus === "created" || result.calendarInviteStatus === "updated"
    )) {
      messageParts.push(
        `Google Calendar invite ${result.calendarInviteStatus === "updated" ? "updated" : "created"}${result.connectedGoogleEmail ? ` from ${result.connectedGoogleEmail}` : ""}.`,
      );
    } else if (result.inviteAuthority === "acumatica") {
      messageParts.push("Acumatica handled the invite sending.");
    }
    if (result.includeOrganizerInAcumatica) {
      messageParts.push("Your internal contact was included in Acumatica.");
    }
    if (result.warnings.length > 0) {
      messageParts.push(result.warnings.join(" "));
    }
    setSaveNotice(messageParts.join(" "));
  }

  async function openDrawer(
    row: BusinessAccountRow,
    options?: { focusTarget?: "notes" | null },
  ) {
    closeTransientMenus();
    closeMailComposer();
    setIsCreateDrawerOpen(false);
    setIsCreateContactDrawerOpen(false);
    setIsCreateOpportunityDrawerOpen(false);
    setIsCreateMeetingDrawerOpen(false);
    setMeetingSource(null);
    setDrawerFocusTarget(options?.focusTarget ?? null);
    setSelected(row);
    setDraft(buildDraft(row));
    setSaveError(null);
    setSaveFieldErrors({});
    setSaveNotice(null);
    setIsDeletingContact(false);
    setAddressSuggestions([]);
    setAddressLookupError(null);
    setIsAddressLookupLoading(false);
    setAddressLookupArmed(false);
    setIsApplyingAddress(false);
    resetContactEnhanceState();
    resetCompanyAttributeSuggestionState();
    setEmployeesError(null);

    try {
      const reloadedRow = await reloadAccountRow(row, { live: true });
      if (!reloadedRow) {
        return;
      }

      setSelected(reloadedRow);
      setDraft(buildDraft(reloadedRow));
    } catch {
      // Keep base row loaded in drawer if detail fetch fails.
    }
  }

  async function reloadAccountRow(
    row: BusinessAccountRow,
    options?: { live?: boolean },
  ): Promise<BusinessAccountRow | null> {
    const accountRecordId = row.accountRecordId ?? row.id;
    const response = await fetch(
      buildBusinessAccountDetailUrl(accountRecordId, resolveRowContactId(row), {
        live: options?.live,
      }),
      {
        cache: "no-store",
      },
    );
    const payload = await readJsonResponse<
      BusinessAccountDetailResponse | BusinessAccountRow | { error?: string }
    >(response);

    if (response.status === 401) {
      throw new Error(
        "Your Acumatica session expired while loading this record. Sign in again and retry.",
      );
    }

    if (!response.ok) {
      throw new Error(parseError(payload));
    }

    const refreshedRow = isBusinessAccountDetailResponse(payload)
      ? (readDetailResponseRows(payload)
          ? findMatchingAccountRow(readDetailResponseRows(payload) ?? [], row) ?? payload.row
          : payload.row)
      : isBusinessAccountRow(payload)
        ? payload
        : null;

    if (!refreshedRow) {
      return null;
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
            isPrimaryContact: refreshedRow.isPrimaryContact ?? row.isPrimaryContact,
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

    return mergedRow;
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

  async function saveRowDraft(
    sourceRow: BusinessAccountRow,
    sourceDraft: BusinessAccountUpdateRequest,
  ): Promise<boolean> {
    const sourceRowKey = getRowKey(sourceRow);
    setIsSaving(true);
    setSaveError(null);
    setSaveFieldErrors({});
    setSaveNotice(null);

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
        const feedback = buildBusinessAccountSaveErrorFeedback(payload, effectiveDraft);
        throw new SaveDraftError(feedback.message, feedback.fieldErrors);
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
            buildBusinessAccountDetailUrl(updatedAccountRecordId, updatedContactId),
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
        setSaveNotice("Saved to Acumatica.");
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
            const sameCompanyPhoneGroup = sharesCompanyPhoneGroup(row, updatedRow);
            if (!sameAccount && !sameCompanyPhoneGroup) {
              return row;
            }

            const updatedCommon: BusinessAccountRow = {
              ...row,
              accountRecordId: sameAccount ? updatedAccountRecordId : row.accountRecordId,
              companyName: sameAccount ? updatedRow.companyName : row.companyName,
              companyDescription:
                sameAccount ? updatedRow.companyDescription ?? null : row.companyDescription ?? null,
              salesRepId: sameAccount ? updatedRow.salesRepId : row.salesRepId,
              salesRepName: sameAccount ? updatedRow.salesRepName : row.salesRepName,
              industryType: sameAccount ? updatedRow.industryType : row.industryType,
              subCategory: sameAccount ? updatedRow.subCategory : row.subCategory,
              companyRegion: sameAccount ? updatedRow.companyRegion : row.companyRegion,
              week: sameAccount ? updatedRow.week : row.week,
              address: sameAccount ? updatedRow.address : row.address,
              addressLine1: sameAccount ? updatedRow.addressLine1 : row.addressLine1,
              addressLine2: sameAccount ? updatedRow.addressLine2 : row.addressLine2,
              city: sameAccount ? updatedRow.city : row.city,
              state: sameAccount ? updatedRow.state : row.state,
              postalCode: sameAccount ? updatedRow.postalCode : row.postalCode,
              country: sameAccount ? updatedRow.country : row.country,
              category: sameAccount ? updatedRow.category : row.category,
              lastModifiedIso: sameAccount ? updatedRow.lastModifiedIso : row.lastModifiedIso,
              companyPhone:
                sameCompanyPhoneGroup ? updatedRow.companyPhone ?? row.companyPhone : row.companyPhone,
              companyPhoneSource:
                sameCompanyPhoneGroup
                  ? updatedRow.companyPhoneSource ?? row.companyPhoneSource ?? null
                  : row.companyPhoneSource,
              primaryContactId: sameAccount ? updatedPrimaryContactId : row.primaryContactId,
              isPrimaryContact:
                sameAccount &&
                updatedPrimaryContactId !== null &&
                row.contactId !== null &&
                row.contactId !== undefined
                  ? row.contactId === updatedPrimaryContactId
                  : row.isPrimaryContact,
            };

            if (
              sameAccount &&
              updatedContactId !== null &&
              row.contactId !== null &&
              row.contactId !== undefined &&
              row.contactId === updatedContactId
            ) {
              return {
                ...updatedCommon,
                contactId: updatedContactId,
                primaryContactName: updatedRow.primaryContactName,
                primaryContactJobTitle:
                  updatedRow.primaryContactJobTitle ?? row.primaryContactJobTitle ?? null,
                primaryContactPhone: updatedRow.primaryContactPhone,
                primaryContactExtension:
                  updatedRow.primaryContactExtension ?? row.primaryContactExtension ?? null,
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
          companyDescription: updatedRow.companyDescription ?? null,
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
          companyPhoneSource:
            updatedRow.companyPhoneSource ?? sourceRow.companyPhoneSource ?? null,
          primaryContactName: updatedRow.primaryContactName,
          primaryContactJobTitle:
            updatedRow.primaryContactJobTitle ?? sourceRow.primaryContactJobTitle ?? null,
          primaryContactPhone: updatedRow.primaryContactPhone,
          primaryContactExtension:
            updatedRow.primaryContactExtension ?? sourceRow.primaryContactExtension ?? null,
          primaryContactEmail: updatedRow.primaryContactEmail,
          notes: updatedRow.notes,
        };

        setSelected(selectedAfterSave);
        setAddressLookupArmed(false);
        setDraft(buildDraft(selectedAfterSave));
      }

      setSaveNotice("Saved to Acumatica.");
      setLastSyncedAt(new Date().toISOString());
      clearCachedMapData();
      saved = true;
    } catch (saveRequestError) {
      if (
        saveRequestError instanceof SaveDraftError &&
        isBusinessAccountStaleSaveMessage(saveRequestError.message)
      ) {
        try {
          const refreshedRow = await reloadAccountRow(sourceRow, { live: true });
          if (refreshedRow) {
            setSelected(refreshedRow);
            setDraft(buildDraft(refreshedRow));
            setSaveFieldErrors({});
            setSaveError(
              "This record changed in Acumatica. The latest version was loaded. Review it and save again.",
            );
            return saved;
          }
        } catch {
          // Fall through to the original stale-record error when the live reload fails.
        }
      }

      setSaveFieldErrors(
        saveRequestError instanceof SaveDraftError ? saveRequestError.fieldErrors : {},
      );
      setSaveError(
        saveRequestError instanceof Error
          ? saveRequestError.message
          : "Failed to save changes.",
      );
    } finally {
      setIsSaving(false);
    }

    return saved;
  }

  async function handleEnhanceContact(candidate: ContactEnhanceCandidate | null = null) {
    if (!selected || !draft || !selected.contactId) {
      return;
    }

    const requestBody = buildContactEnhanceRequest(selected, draft, candidate);
    const requestFingerprint = buildContactEnhanceFingerprint(requestBody);

    setIsEnhancingContact(true);
    setContactEnhanceError(null);

    try {
      const response = await fetch(`/api/contacts/${selected.contactId}/enhance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await readJsonResponse<ContactEnhanceResponse | { error?: string }>(
        response,
      );

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!isContactEnhanceResponse(payload)) {
        throw new Error("Unexpected response while enhancing contact.");
      }

      setContactEnhanceFingerprint(requestFingerprint);

      if (payload.status === "needs_selection") {
        setContactEnhanceCandidates(payload.candidates);
        setContactEnhanceNotice("RocketReach found multiple matches. Pick the correct contact.");
        return;
      }

      if (payload.status === "need_more_context" || payload.status === "no_match") {
        setContactEnhanceCandidates([]);
        setContactEnhanceNotice(payload.message);
        return;
      }

      setContactEnhanceCandidates([]);
      let appliedCount = 0;
      setDraft((current) => {
        if (!current) {
          return current;
        }

        const result = applyContactEnhanceSuggestion(current, payload.suggestion);
        appliedCount = result.appliedCount;
        return result.draft;
      });

      if (appliedCount > 0) {
        setContactEnhanceNotice(
          `RocketReach filled ${appliedCount} missing field${appliedCount === 1 ? "" : "s"}. Click Save to persist.`,
        );
      } else {
        setContactEnhanceNotice(
          "RocketReach found a match but there was no new name, job title, email, or phone to add.",
        );
      }
    } catch (error) {
      setContactEnhanceCandidates([]);
      setContactEnhanceNotice(null);
      setContactEnhanceError(
        error instanceof Error ? error.message : "Failed to enhance contact.",
      );
    } finally {
      setIsEnhancingContact(false);
    }
  }

  async function handleSuggestCompanyAttributes() {
    if (!selected || !draft) {
      return;
    }

    const requestBody = buildCompanyAttributeSuggestionRequest(selected, draft);
    const requestFingerprint = buildCompanyAttributeSuggestionFingerprint(requestBody);

    setIsSuggestingCompanyAttributes(true);
    setCompanyAttributeSuggestionError(null);

    try {
      const response = await fetch(
        `/api/business-accounts/${encodeURIComponent(selected.id)}/attribute-suggestion`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );
      const payload = await readJsonResponse<
        CompanyAttributeSuggestionResponse | { error?: string }
      >(response);

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!isCompanyAttributeSuggestionResponse(payload)) {
        throw new Error("Unexpected response while suggesting company attributes.");
      }

      setCompanyAttributeSuggestionFingerprint(requestFingerprint);

      if (payload.status === "need_more_context" || payload.status === "no_match") {
        setCompanyAttributeSuggestionResult(null);
        setCompanyAttributeSuggestionNotice(payload.message);
        return;
      }

      setCompanyAttributeSuggestionResult(payload.suggestion);
      let appliedCount = 0;
      setDraft((current) => {
        if (!current) {
          return current;
        }

        const result = applyCompanyAttributeSuggestion(current, payload.suggestion);
        appliedCount = result.appliedCount;
        return result.draft;
      });

      if (appliedCount > 0) {
        const filledLabels = payload.filledFieldKeys
          .map((field) =>
            field === "companyRegion"
              ? "Company Region"
              : field === "companyDescription"
                ? "Company Description"
              : field === "industryType"
                ? "Industry Type"
                : field === "subCategory"
                  ? "Sub-Category"
                  : "Category",
          )
          .join(", ");
        setCompanyAttributeSuggestionNotice(
          `OpenAI filled missing ${filledLabels}. Click Save to persist.`,
        );
      } else {
        setCompanyAttributeSuggestionNotice(
          "OpenAI found suggestions, but there was no new Company Region, Category, Industry Type, Sub-Category, or Company Description to add.",
        );
      }
    } catch (error) {
      setCompanyAttributeSuggestionResult(null);
      setCompanyAttributeSuggestionNotice(null);
      setCompanyAttributeSuggestionError(
        error instanceof Error ? error.message : "Failed to suggest company attributes.",
      );
    } finally {
      setIsSuggestingCompanyAttributes(false);
    }
  }

  async function handleSave() {
    if (!selected || !draft) {
      return;
    }

    setSaveFieldErrors({});

    if (
      drawerNeedsCompanyAssignment &&
      draft.companyName.trim().length > 0 &&
      !draft.assignedBusinessAccountId
    ) {
      setSaveError("Select a business account from the list before saving.");
      return;
    }

    if (
      draft.companyPhone !== null &&
      draft.companyPhone.trim().length > 0 &&
      normalizePhoneForSave(draft.companyPhone) === null
    ) {
      setSaveError("Company phone number must use the format ###-###-####.");
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

    const primaryContactExtension = draft.primaryContactExtension ?? "";
    if (primaryContactExtension.trim().length > 0) {
      const normalizedExtension = normalizeExtensionForSave(primaryContactExtension);
      if (!normalizedExtension || normalizedExtension.length > 5) {
        setSaveError("Extension must use 1 to 5 digits.");
        return;
      }
    }

    const optionalWarningFields = collectOptionalSaveWarningFields(draft);
    const optionalWarningMessage = formatOptionalSaveWarningMessage(optionalWarningFields);
    if (optionalWarningMessage && !window.confirm(optionalWarningMessage)) {
      return;
    }

    const saved = await saveRowDraft(selected, draft);
    if (saved) {
      closeDrawer({ preserveNotice: true });
    }
  }

  function handleToggleSelectedContactRow(row: BusinessAccountRow, forceSelected?: boolean) {
    if (!isContactSelectableRow(row)) {
      return;
    }

    const rowKey = getRowKey(row);
    setSelectedContactRowKeys((current) => {
      const hasRow = current.includes(rowKey);
      const shouldSelect = forceSelected ?? !hasRow;

      if (shouldSelect === hasRow) {
        return current;
      }

      return shouldSelect
        ? [...current, rowKey]
        : current.filter((currentRowKey) => currentRowKey !== rowKey);
    });
  }

  function handleToggleCurrentPageSelection() {
    const pageRowKeys = currentPageSelectableRows.map((row) => getRowKey(row));
    setSelectedContactRowKeys((current) => {
      const next = new Set(current);
      if (allCurrentPageSelected) {
        pageRowKeys.forEach((rowKey) => next.delete(rowKey));
      } else {
        pageRowKeys.forEach((rowKey) => next.add(rowKey));
      }
      return [...next];
    });
  }

  function handleMergeSelectionCompleted(result: ContactMergeResponse) {
    const activeSelectionRowKeys = new Set(
      selectedContactRows.map((row) => getRowKey(row)),
    );

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
    setSelectedContactRowKeys((current) =>
      current.filter((rowKey) => !activeSelectionRowKeys.has(rowKey)),
    );
    setIsSelectionMergeOpen(false);
    setSaveError(null);
    setSaveNotice(
      "queued" in result
        ? `Queued contact merge. ${result.deletedContactIds.length} contact${
            result.deletedContactIds.length === 1 ? "" : "s"
          } hidden until the scheduled action runs${
            result.setKeptAsPrimary ? ". Primary contact will update when it executes." : "."
          }`
        : `Merged contacts. ${result.deletedContactIds.length} contact${
            result.deletedContactIds.length === 1 ? "" : "s"
          } deleted${result.setKeptAsPrimary ? ". Primary contact updated." : "."}`,
    );

    if (selected && selected.businessAccountId === result.businessAccountId) {
      const nextSelected = findMatchingAccountRow(result.accountRows, selected) ?? result.updatedRow;
      setSelected(nextSelected);
      setDraft(buildDraft(nextSelected));
    }
  }

  async function handleDeleteSelectedContacts(reason: string) {
    if (!selectedContactRows.length) {
      return;
    }

    setIsDeletingSelectedContacts(true);
    setSaveError(null);
    setSaveNotice(null);

    try {
      const uniqueSelections = new Map<
        number,
        {
          row: BusinessAccountRow;
          rowKey: string;
          accountRecordId: string;
          businessAccountId: string;
        }
      >();
      selectedContactRows.forEach((row) => {
        const contactId = resolveRowContactId(row);
        if (contactId === null || uniqueSelections.has(contactId)) {
          return;
        }

        uniqueSelections.set(contactId, {
          row,
          rowKey: getRowKey(row),
          accountRecordId: resolveRowBusinessAccountRecordId(row),
          businessAccountId: row.businessAccountId,
        });
      });

      const successfulRowKeys = new Set<string>();
      const failedLabels: string[] = [];
      const affectedAccounts = new Map<
        string,
        {
          businessAccountId: string;
          deletions: Array<{
            contactId: number;
            rowKey: string;
          }>;
        }
      >();

      for (const [contactId, selection] of uniqueSelections.entries()) {
        try {
          const deleteResponse = await fetch(`/api/contacts/${contactId}?source=accounts`, {
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

          successfulRowKeys.add(selection.rowKey);
          const accountEntry = affectedAccounts.get(selection.accountRecordId);
          if (accountEntry) {
            accountEntry.deletions.push({
              contactId,
              rowKey: selection.rowKey,
            });
          } else {
            affectedAccounts.set(selection.accountRecordId, {
              businessAccountId: selection.businessAccountId,
              deletions: [
                {
                  contactId,
                  rowKey: selection.rowKey,
                },
              ],
            });
          }
        } catch (error) {
          failedLabels.push(
            error instanceof Error
              ? `${selection.row.primaryContactName ?? `Contact ${contactId}`}: ${error.message}`
              : selection.row.primaryContactName ?? `Contact ${contactId}`,
          );
        }
      }

      let nextRows = allRowsRef.current;
      for (const [accountRecordId, accountEntry] of affectedAccounts.entries()) {
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

          const refreshedRows =
            readDetailResponseRows(refreshPayload) ??
            (() => {
              const refreshedRow = readDetailResponseRow(refreshPayload);
              return refreshedRow ? [refreshedRow] : [];
            })();
          nextRows = replaceRowsForAccount(
            nextRows,
            refreshedRows,
            accountRecordId,
            accountEntry.businessAccountId,
          );
        } catch {
          const currentAccountRows = nextRows.filter((row) => {
            const rowAccountRecordId = row.accountRecordId ?? row.id;
            return (
              rowAccountRecordId === accountRecordId ||
              row.businessAccountId === accountEntry.businessAccountId
            );
          });

          const fallbackRows = accountEntry.deletions.reduce((rowsForAccount, deletion) => {
            return removeDeletedContactFromAccountRows(
              rowsForAccount,
              deletion.contactId,
              deletion.rowKey,
            );
          }, currentAccountRows);

          nextRows = replaceRowsForAccount(
            nextRows,
            fallbackRows,
            accountRecordId,
            accountEntry.businessAccountId,
          );
        }
      }

      setAllRows(nextRows);
      setLastSyncedAt(new Date().toISOString());
      clearCachedMapData();
      setSelectedContactRowKeys((current) =>
        current.filter((rowKey) => !successfulRowKeys.has(rowKey)),
      );
      setDeleteQueueRows([]);
      setSaveNotice(
        `Queued ${successfulRowKeys.size} contact${successfulRowKeys.size === 1 ? "" : "s"} for deletion.${
          failedLabels.length ? ` ${failedLabels.length} failed.` : ""
        }`,
      );
      setSaveError(
        failedLabels.length ? `Failed to queue: ${failedLabels.join("; ")}` : null,
      );

      if (selected) {
        const selectedRowDeleted = successfulRowKeys.has(getRowKey(selected));
        if (selectedRowDeleted) {
          const selectedAccountRows = nextRows.filter((row) => {
            return resolveRowBusinessAccountRecordId(row) === resolveRowBusinessAccountRecordId(selected);
          });
          const nextSelected = selectedAccountRows[0] ?? null;
          if (!nextSelected) {
            closeDrawer();
          } else {
            setSelected(nextSelected);
            setDraft(buildDraft(nextSelected));
          }
        } else {
          const nextSelected = findMatchingAccountRow(nextRows, selected);
          if (nextSelected) {
            setSelected(nextSelected);
            setDraft(buildDraft(nextSelected));
          }
        }
      }
    } finally {
      setIsDeletingSelectedContacts(false);
    }
  }

  async function deleteContactRow(
    targetRow: BusinessAccountRow,
    reason: string,
  ): Promise<boolean> {
    const contactId = targetRow.contactId ?? targetRow.primaryContactId ?? null;
    if (contactId === null) {
      setSaveError("This row has no contact ID, so it cannot be deleted.");
      return false;
    }

    setIsDeletingContact(true);
    setSaveError(null);
    setSaveNotice(null);

    try {
      const deleteResponse = await fetch(`/api/contacts/${contactId}?source=accounts`, {
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

      const accountRecordId = targetRow.accountRecordId ?? targetRow.id;
      let nextAccountRows: BusinessAccountRow[] | null = null;
      let deleteNotice = "Contact queued for deletion.";

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
            row.businessAccountId === targetRow.businessAccountId
          );
        });
        nextAccountRows = removeDeletedContactFromAccountRows(
          currentAccountRows,
          contactId,
          targetRow.rowKey ?? null,
        );
        deleteNotice =
          "Contact queued for deletion. The account refresh failed, so the local view was updated conservatively.";
      }

      setAllRows((currentRows) =>
        replaceRowsForAccount(
          currentRows,
          nextAccountRows ?? [],
          accountRecordId,
          targetRow.businessAccountId,
        ),
      );
      setLastSyncedAt(new Date().toISOString());
      clearCachedMapData();
      setSelectedContactRowKeys((current) =>
        current.filter((rowKey) => rowKey !== getRowKey(targetRow)),
      );

      const nextSelected =
        selected && getRowKey(selected) === getRowKey(targetRow)
          ? nextAccountRows?.[0] ?? null
          : selected && nextAccountRows
            ? findMatchingAccountRow(nextAccountRows, selected) ?? selected
            : selected;

      if (selected && !nextSelected) {
        closeDrawer();
        setSaveNotice(deleteNotice);
      } else {
        if (nextSelected) {
          setSelected(nextSelected);
          setDraft(buildDraft(nextSelected));
        }
        setSaveNotice(deleteNotice);
      }
      return true;
    } catch (deleteError) {
      setSaveError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to queue contact deletion.",
      );
      return false;
    } finally {
      setIsDeletingContact(false);
    }
  }

  async function deleteBusinessAccountRowAction(
    targetRow: BusinessAccountRow,
    reason: string,
  ): Promise<boolean> {
    const accountRecordId = resolveRowBusinessAccountRecordId(targetRow);
    const businessAccountId = targetRow.businessAccountId.trim();
    if (!accountRecordId) {
      setSaveError("This row has no business account record ID, so it cannot be deleted.");
      return false;
    }

    if (!businessAccountId) {
      setSaveError("This row has no Acumatica business account ID, so it cannot be deleted.");
      return false;
    }

    setIsDeletingBusinessAccount(true);
    setSaveError(null);
    setSaveNotice(null);

    try {
      const deleteResponse = await fetch(
        `/api/business-accounts/${encodeURIComponent(accountRecordId)}?source=accounts`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason }),
        },
      );
      const deletePayload = await readJsonResponse<{ error?: string }>(deleteResponse);
      if (!deleteResponse.ok) {
        throw new Error(parseError(deletePayload));
      }

      const deletedRowKeys = new Set(
        allRowsRef.current
          .filter((row) => resolveRowBusinessAccountRecordId(row) === accountRecordId)
          .map((row) => getRowKey(row)),
      );
      setAllRows((currentRows) =>
        replaceRowsForAccount(currentRows, [], accountRecordId, businessAccountId),
      );
      setLastSyncedAt(new Date().toISOString());
      clearCachedMapData();
      setSelectedContactRowKeys((current) =>
        current.filter((rowKey) => !deletedRowKeys.has(rowKey)),
      );

      const deletedSelectedAccount =
        selected !== null && resolveRowBusinessAccountRecordId(selected) === accountRecordId;
      if (deletedSelectedAccount) {
        closeDrawer({ preserveNotice: true });
      }

      setSaveNotice("Business account queued for deletion.");
      return true;
    } catch (deleteError) {
      setSaveError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to queue business account deletion.",
      );
      return false;
    } finally {
      setIsDeletingBusinessAccount(false);
    }
  }

  function handleDeleteSelectedContact() {
    if (!selected) {
      return;
    }

    openDeleteContactConfirmation(selected);
  }

  async function handleConfirmDeleteContact(reason: string) {
    if (deleteQueueRows.length === 0) {
      return;
    }

    if (deleteQueueRows.length > 1) {
      await handleDeleteSelectedContacts(reason);
      return;
    }

    const deleted = await deleteContactRow(deleteQueueRows[0], reason);
    if (deleted) {
      setDeleteQueueRows([]);
    }
  }

  async function handleConfirmDeleteBusinessAccount(reason: string) {
    if (!deleteBusinessAccountRow) {
      return;
    }

    const deleted = await deleteBusinessAccountRowAction(deleteBusinessAccountRow, reason);
    if (deleted) {
      setDeleteBusinessAccountRow(null);
    }
  }

  function renderBlankCell(label = "No value"): ReactNode {
    return (
      <span aria-label={label} className={styles.emptyCell}>
        {"\u00A0"}
      </span>
    );
  }

  function renderTextCell(
    value: string | null | undefined,
    emptyLabel?: string,
    tone: "default" | "secondary" = "default",
  ): ReactNode {
    const text = readTextValue(value);
    if (!text) {
      return renderBlankCell(emptyLabel);
    }

    return (
      <span className={tone === "secondary" ? styles.secondaryCellText : undefined}>
        {text}
      </span>
    );
  }

  function renderPhoneCell(
    phone: string | null | undefined,
    label: string,
    context: NonNullable<ComponentProps<typeof CallPhoneButton>["context"]>,
  ): ReactNode {
    const text = readTextValue(phone);
    if (!text) {
      return renderBlankCell(label);
    }

    return (
      <div className={styles.phoneValue}>
        <span>{text}</span>
        <CallPhoneButton className={styles.tableCallButton} context={context} label={label} phone={text} />
      </div>
    );
  }

  function renderCellContent(row: BusinessAccountRow, columnId: SortBy): ReactNode {
    if (columnId === "companyName") {
      const companyLabel = readTextValue(row.companyName);
      const companyUrl = buildAcumaticaBusinessAccountUrl(
        acumaticaBaseUrl,
        row.businessAccountId,
        acumaticaCompanyId,
      );

      if (!companyLabel) {
        return renderBlankCell("No company name");
      }

      if (!companyUrl) {
        return companyLabel;
      }

      return (
        <a
          className={styles.recordLink}
          href={companyUrl}
          onClick={(event) => event.stopPropagation()}
          rel="noreferrer"
          target="_blank"
        >
          {companyLabel}
        </a>
      );
    }

    if (columnId === "accountType") {
      return renderTextCell(row.accountType ?? null, "Unknown type", "secondary");
    }

    if (columnId === "opportunityCount") {
      if (typeof row.opportunityCount === "number" && Number.isFinite(row.opportunityCount)) {
        return (
          <span className={row.opportunityCount === 0 ? styles.secondaryCellText : undefined}>
            {row.opportunityCount}
          </span>
        );
      }

      return renderBlankCell("Unknown opportunity count");
    }

    if (columnId === "primaryContactName") {
      const nameValue = readTextValue(row.primaryContactName);
      const contactUrl = buildAcumaticaContactUrl(
        acumaticaBaseUrl,
        row.contactId ?? row.primaryContactId ?? null,
        acumaticaCompanyId,
      );

      return (
        <div className={styles.contactCellWrap}>
          {nameValue ? (
            contactUrl ? (
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
              <span>{nameValue}</span>
            )
          ) : (
            renderBlankCell("No primary contact")
          )}
          {row.isPrimaryContact ? <span className={styles.primaryBadge}>Primary</span> : null}
        </div>
      );
    }

    if (columnId === "primaryContactJobTitle") {
      return renderTextCell(row.primaryContactJobTitle ?? null, "No job title", "secondary");
    }

    if (columnId === "companyPhone") {
      return renderPhoneCell(resolveCompanyPhone(row), `${row.companyName} company phone`, {
        sourcePage: "accounts",
        linkedBusinessAccountId: row.businessAccountId,
        linkedAccountRowKey: row.rowKey ?? row.id,
        linkedContactId: row.contactId ?? row.primaryContactId,
        linkedCompanyName: row.companyName,
        linkedContactName: row.primaryContactName,
      });
    }

    if (columnId === "primaryContactPhone") {
      return renderPhoneCell(
        row.primaryContactPhone,
        `${row.primaryContactName ?? row.companyName} phone`,
        {
          sourcePage: "accounts",
          linkedBusinessAccountId: row.businessAccountId,
          linkedAccountRowKey: row.rowKey ?? row.id,
          linkedContactId: row.contactId ?? row.primaryContactId,
          linkedCompanyName: row.companyName,
          linkedContactName: row.primaryContactName,
        },
      );
    }

    if (columnId === "primaryContactExtension") {
      const extensionValue = readTextValue(row.primaryContactExtension);
      return renderTextCell(
        extensionValue ? `Ext. ${extensionValue}` : null,
        "No extension",
        "secondary",
      );
    }

    if (columnId === "category") {
      const categoryLabel = readTextValue(row.category) ?? "Unassigned";
      const pillClassName =
        readTextValue(row.category) === null
          ? `${styles.categoryPill} ${styles.categoryPillMuted}`
          : styles.categoryPill;
      return <span className={pillClassName}>{categoryLabel}</span>;
    }

    if (columnId === "lastCalledAt") {
      return renderTextCell(formatLastCalled(row.lastCalledAt), "Never called", "secondary");
    }

    if (columnId === "lastEmailedAt") {
      return renderTextCell(formatLastEmailed(row.lastEmailedAt), "Never emailed", "secondary");
    }

    if (columnId === "lastModifiedIso") {
      return renderTextCell(formatLastModified(row.lastModifiedIso), "No update time", "secondary");
    }

    if (columnId === "primaryContactEmail") {
      return renderTextCell(row.primaryContactEmail, "No email");
    }

    if (columnId === "salesRepName") {
      return renderTextCell(row.salesRepName, "No sales rep");
    }

    if (columnId === "industryType") {
      return renderTextCell(row.industryType, "No industry");
    }

    if (columnId === "subCategory") {
      return renderTextCell(row.subCategory, "No subcategory");
    }

    if (columnId === "companyRegion") {
      return renderTextCell(row.companyRegion, "No region");
    }

    if (columnId === "week") {
      return renderTextCell(row.week, "No week");
    }

    if (columnId === "address") {
      return renderTextCell(row.address, "No address");
    }

    if (columnId === "notes") {
      return renderTextCell(row.notes, "No notes");
    }

    return renderBlankCell(`No ${columnId}`);
  }

  function renderHeaderFilterControl(columnId: SortBy): ReactNode {
    const column = getColumnConfig(columnId);
    const filterValue = headerFilters[column.filterKey];
    const isDateFilter =
      columnId === "lastCalledAt" ||
      columnId === "lastEmailedAt" ||
      columnId === "lastModifiedIso";

    if (column.filterKey === "category") {
      return (
        <select
          aria-label={`Filter ${column.label}`}
          className={styles.headerFilterSelect}
          onChange={(event) =>
            updateHeaderFilter("category", (event.target.value as Category | "") || "")
          }
          value={headerFilters.category}
        >
          <option value="">All</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="D">D</option>
        </select>
      );
    }

    return (
      <input
        aria-label={`Filter ${column.label}`}
        className={styles.headerFilterInput}
        onChange={(event) =>
          updateHeaderFilter(
            column.filterKey,
            event.target.value as HeaderFilters[typeof column.filterKey],
          )
        }
        placeholder={column.filterPlaceholder}
        type={isDateFilter ? "date" : "text"}
        value={typeof filterValue === "string" ? filterValue : ""}
      />
    );
  }

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      headerActions={
        <>
          <button
            className={styles.syncNowButton}
            disabled={isSyncing || remoteSyncRunning || Boolean(syncBlockedReason)}
            onClick={handleSyncRecords}
            title={
              syncBlockedReason ??
              (remoteSyncRunning ? "A full account sync is already running." : undefined)
            }
            type="button"
          >
            <SyncIcon />
            <span>{isSyncing || remoteSyncRunning ? "Syncing..." : "Sync now"}</span>
          </button>
          {canExportAccountsCsv ? (
            <a className={styles.toolbarButton} href={accountsCsvExportHref}>
              Export CSV
            </a>
          ) : null}
          <div className={styles.createMenu} data-transient-menu="true">
            <button
              aria-expanded={isCreateMenuOpen}
              aria-haspopup="menu"
              className={styles.createButton}
              ref={createMenuButtonRef}
              onClick={(event) => {
                event.stopPropagation();
                const next = !isCreateMenuOpen;
                closeTransientMenus();
                if (next) {
                  openCreateMenu();
                }
              }}
              type="button"
            >
              <span>Create</span>
              <ChevronDownIcon />
            </button>
            {isCreateMenuOpen && createMenuPosition ? (
              <div
                className={styles.createDropdownMenu}
                role="menu"
                style={createMenuPosition}
              >
                <button className={styles.createDropdownAction} onClick={openCreateDrawer} type="button">
                  Account
                </button>
                <button
                  className={styles.createDropdownAction}
                  onClick={openCreateContactDrawer}
                  type="button"
                >
                  Contact
                </button>
                <button
                  className={styles.createDropdownAction}
                  onClick={() => {
                    openCreateOpportunityDrawer();
                  }}
                  type="button"
                >
                  Opportunity
                </button>
                <button
                  className={styles.createDropdownAction}
                  onClick={() => {
                    openCreateMeetingDrawer("Meeting");
                  }}
                  type="button"
                >
                  Schedule meeting
                </button>
                <button
                  className={styles.createDropdownAction}
                  onClick={() => {
                    openCreateMeetingDrawer("Drop Off");
                  }}
                  type="button"
                >
                  Schedule drop off
                </button>
              </div>
            ) : null}
          </div>
        </>
      }
      statusLine={
        isSyncing ? (
          <>
            <span>Syncing records</span>
            <span>{syncPercent === null ? "Preparing snapshot" : `${syncPercent}% complete`}</span>
            <span>{formatElapsedDuration(syncElapsedMs)}</span>
          </>
        ) : hasSnapshot ? (
          <>
            <span>Synced with Acumatica</span>
            <span>Edit in drawer</span>
            <span>Live sync</span>
            {syncUpdatedLabel ? <span>Updated {syncUpdatedLabel}</span> : null}
          </>
        ) : (
          <>
            <span>Snapshot not built yet</span>
            <span>Manual sync required</span>
          </>
        )
      }
      title="Sales MeadowBrook"
      userName={session?.user?.name ?? "Signed in"}
    >

      <section className={styles.toolbar}>
        <label className={styles.searchField}>
          <SearchIcon />
          <input
            aria-label="Global search"
            className={styles.searchInput}
            onChange={(event) => {
              setPage(1);
              setQ(event.target.value);
            }}
            placeholder="Search company, sales rep, region, address, contact, email, or notes"
            value={q}
          />
        </label>
        <div className={styles.toolbarActions}>
          <div className={styles.columnsMenu} data-transient-menu="true">
            <button
              aria-expanded={isFiltersOpen}
              aria-haspopup="dialog"
              className={styles.toolbarButton}
              onClick={(event) => {
                event.stopPropagation();
                const next = !isFiltersOpen;
                closeTransientMenus();
                setIsFiltersOpen(next);
              }}
              type="button"
            >
              <FilterIcon />
              <span>Columns</span>
            </button>
            {isFiltersOpen ? (
              <div aria-label="Visible columns" className={styles.columnsPopover} role="dialog">
                <div className={styles.columnsPopoverHeader}>
                  <strong>Visible columns</strong>
                  <button
                    className={styles.columnsPopoverAction}
                    onClick={handleShowAllColumns}
                    type="button"
                  >
                    Show all
                  </button>
                </div>
                <div className={styles.columnsPopoverList}>
                  {visibleColumnConfigs.map((column, index) => (
                    <div
                      className={`${styles.columnsPopoverItem} ${
                        draggedColumnId === column.id ? styles.columnsPopoverItemDragging : ""
                      } ${
                        columnDropTargetId === column.id && draggedColumnId !== column.id
                          ? styles.columnsPopoverItemDropTarget
                          : ""
                      }`.trim()}
                      key={column.id}
                      onDragOver={(event) => handleColumnDragOver(event, column.id)}
                      onDrop={(event) => handleColumnDrop(event, column.id)}
                    >
                      <button
                        aria-label={`Drag to reorder ${column.label}`}
                        className={styles.columnsPopoverDragHandle}
                        draggable
                        onClick={(event) => event.preventDefault()}
                        onDragEnd={handleColumnDragEnd}
                        onDragStart={(event) => handleColumnDragStart(event, column.id)}
                        type="button"
                      >
                        <DragHandleIcon />
                      </button>
                      <label className={styles.columnsPopoverToggle}>
                        <input
                          checked={column.isVisible}
                          disabled={visibleColumns.length <= 1 && column.isVisible}
                          onChange={() => handleToggleColumn(column.id)}
                          type="checkbox"
                        />
                        <span>{column.label}</span>
                      </label>
                      <div className={styles.columnsPopoverReorder}>
                        <button
                          aria-label={`Move ${column.label} up`}
                          className={styles.columnsPopoverMoveButton}
                          disabled={index === 0}
                          onClick={() => handleMoveColumn(column.id, "up")}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Move ${column.label} down`}
                          className={styles.columnsPopoverMoveButton}
                          disabled={index === visibleColumnConfigs.length - 1}
                          onClick={() => handleMoveColumn(column.id, "down")}
                          type="button"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className={styles.toolbarClearRow}>
        <button
          className={styles.clearFiltersButton}
          disabled={!hasActiveWorkbenchFilters}
          onClick={clearAllFilters}
          type="button"
        >
          Clear search and filters
        </button>
      </div>

      {selectedContactRows.length ? (
        <section className={styles.selectionBar}>
          <div className={styles.selectionInfo}>
            <strong>
              {selectedContactRows.length} contact{selectedContactRows.length === 1 ? "" : "s"} selected
            </strong>
            {mergeSelectionDisabledReason ? (
              <span className={styles.selectionHint}>{mergeSelectionDisabledReason}</span>
            ) : (
              <span className={styles.selectionSubtext}>Bulk actions stay on the current filtered set.</span>
            )}
          </div>
          <div className={styles.selectionActions}>
            <button
              className={styles.selectionMergeButton}
              disabled={!mergeSelectionEligible || isDeletingSelectedContacts}
              onClick={() => {
                setIsSelectionMergeOpen(true);
                setSaveError(null);
                setSaveNotice(null);
              }}
              type="button"
            >
              Merge contacts
            </button>
            <button
              className={styles.selectionDeleteButton}
              disabled={isDeletingSelectedContacts}
              onClick={() => {
                openDeleteContactQueueModal(selectedContactRows);
              }}
              type="button"
            >
              {isDeletingSelectedContacts ? "Queueing..." : "Delete contacts"}
            </button>
            <button
              className={styles.selectionClearButton}
              disabled={isDeletingSelectedContacts}
              onClick={() => {
                setSelectedContactRowKeys([]);
                setIsSelectionMergeOpen(false);
              }}
              type="button"
            >
              Clear selection
            </button>
          </div>
        </section>
      ) : null}

      <section className={styles.tableCard}>
        {syncProgress ? (
          <section className={styles.syncProgressSection}>
            <div className={styles.syncProgressHeader}>
              <strong>Sync in progress</strong>
              <span>
                {(syncProgress.totalAccounts
                  ? `${syncProgress.fetchedAccounts} / ${syncProgress.totalAccounts} accounts`
                  : "Preparing snapshot") + ` • ${formatElapsedDuration(syncElapsedMs)}`}
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
              Synced {syncProgress.fetchedContacts.toLocaleString()}
              {syncProgress.totalContacts !== null
                ? ` of ${syncProgress.totalContacts.toLocaleString()} contacts`
                : " contacts"}
              {` • ${syncProgress.snapshotRows.toLocaleString()} snapshot rows`}
            </p>
            <p className={styles.syncProgressMeta}>
              Showing the previous table snapshot until sync completes.
            </p>
          </section>
        ) : null}
        {error ? <p className={styles.tableError}>{error}</p> : null}
        {saveError ? <p className={styles.tableError}>{saveError}</p> : null}
        {saveNotice ? <p className={styles.saveNoticeBanner}>{saveNotice}</p> : null}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeaderRow}>
                <th className={styles.selectionCheckboxCell}>
                  <input
                    aria-label="Select current page"
                    checked={allCurrentPageSelected}
                    disabled={!currentPageSelectableRows.length}
                    onChange={() => {
                      handleToggleCurrentPageSelection();
                    }}
                    type="checkbox"
                  />
                </th>
                <th className={styles.actionsHeader}>Actions</th>
                {visibleColumnOrder.map((columnId) => {
                  const column = getColumnConfig(columnId);
                  const isHeaderDragging = draggedColumnId === columnId;
                  const isHeaderDropTarget =
                    columnDropTargetId === columnId && draggedColumnId !== columnId;
                  const isSortedColumn = sortBy === columnId;
                  const ariaSort =
                    isSortedColumn && sortDir === "asc"
                      ? "ascending"
                      : isSortedColumn && sortDir === "desc"
                        ? "descending"
                        : "none";

                  return (
                    <th
                      aria-sort={ariaSort}
                      className={`${isHeaderDragging ? styles.tableHeaderCellDragging : ""} ${
                        isHeaderDropTarget ? styles.tableHeaderCellDropTarget : ""
                      }`.trim()}
                      key={`header-${columnId}`}
                      onDragOver={(event) => handleColumnDragOver(event, columnId)}
                      onDrop={(event) => handleColumnDrop(event, columnId)}
                      title={`${column.label}. Click to sort; drag handle to reorder.`}
                    >
                      <div className={styles.tableHeaderCell}>
                        <button
                          aria-label={`Drag to reorder ${column.label}`}
                          className={styles.tableHeaderDragHandle}
                          draggable
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onDragEnd={handleColumnDragEnd}
                          onDragStart={(event) => handleColumnDragStart(event, columnId)}
                          type="button"
                        >
                          <DragHandleIcon />
                        </button>
                        <button
                          aria-label={`${column.label}: sort ${
                            isSortedColumn && sortDir === "asc" ? "descending" : "ascending"
                          }`}
                          className={`${styles.tableHeaderSortButton} ${
                            isSortedColumn ? styles.tableHeaderSortButtonActive : ""
                          }`.trim()}
                          onClick={() => handleSort(columnId)}
                          type="button"
                        >
                          <span className={styles.tableHeaderLabel}>{column.label}</span>
                          <span className={styles.tableHeaderSortIcon}>
                            <HeaderSortIcon active={isSortedColumn} direction={sortDir} />
                          </span>
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
              <tr className={styles.tableFilterRow}>
                <th
                  aria-hidden="true"
                  className={`${styles.selectionCheckboxCell} ${styles.tableFilterCell} ${styles.filterSpacerCell}`}
                />
                <th
                  aria-hidden="true"
                  className={`${styles.actionsHeader} ${styles.tableFilterCell} ${styles.filterSpacerCell}`}
                />
                {visibleColumnOrder.map((columnId) => (
                  <th className={styles.tableFilterCell} key={`filter-${columnId}`}>
                    {renderHeaderFilterControl(columnId)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className={styles.loadingCell} colSpan={visibleColumnOrder.length + 2}>
                    Loading contacts...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className={styles.loadingCell} colSpan={visibleColumnOrder.length + 2}>
                    No contacts found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const rowKey = getRowKey(row);
                  const rowContactId = resolveRowContactId(row);
                  const rowHasEmail = hasRowContactEmail(row);
                  const rowHasNote = hasRowNote(row);
                  const rowCanEditNote = canEditRowNote(row);
                  const rowCanDelete = canDeleteRowContact(row);
                  const rowCanDeleteBusinessAccount = canDeleteBusinessAccountRow(row);
                  const rowCanAddContact = canAddContactToRow(row);
                  const isRowSelectable = rowContactId !== null;
                  const isRowChecked = selectedContactRowKeys.includes(rowKey);
                  const selectedClass =
                    selected && getRowKey(selected) === rowKey ? styles.selectedRow : "";
                  const isRowMenuOpen = rowMenuRowKey === rowKey;

                  return (
                    <tr
                      className={`${styles.dataRow} ${selectedClass}`.trim()}
                      key={rowKey}
                      onClick={() => {
                        void openDrawer(row);
                      }}
                    >
                      <td
                        className={styles.selectionCheckboxCell}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        {isRowSelectable ? (
                          <input
                            checked={isRowChecked}
                            onChange={(event) => {
                              handleToggleSelectedContactRow(row, event.target.checked);
                            }}
                            type="checkbox"
                          />
                        ) : null}
                      </td>
                      <td
                        className={styles.rowActionsCell}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className={styles.rowActions}>
                          <button
                            className={`${styles.rowActionButton} ${styles.rowActionNote} ${
                              rowHasNote ? styles.rowActionNoteActive : ""
                            }`.trim()}
                            disabled={!rowCanEditNote}
                            onClick={() => {
                              openDrawerForNotes(row);
                            }}
                            title={
                              !rowCanEditNote
                                ? "This row has no contact to store a note on."
                                : rowHasNote
                                  ? "Edit note"
                                  : "Add note"
                            }
                            type="button"
                          >
                            <NoteIcon active={rowHasNote} />
                          </button>
                          <div className={styles.rowMenu} data-transient-menu="true">
                            <button
                              aria-expanded={isRowMenuOpen}
                              aria-haspopup="menu"
                              className={styles.rowMenuTrigger}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (rowMenuRowKey === rowKey) {
                                  closeTransientMenus();
                                  return;
                                }

                                closeTransientMenus();
                                openRowMenu(rowKey, event.currentTarget);
                              }}
                              title="More actions"
                              type="button"
                            >
                              <MoreIcon />
                            </button>
                            {isRowMenuOpen && rowMenuPosition ? (
                              <div
                                className={styles.rowMenuPopover}
                                role="menu"
                                style={rowMenuPosition}
                              >
                                <button
                                  className={styles.rowMenuAction}
                                  disabled={!rowCanAddContact}
                                  onClick={() => {
                                    openCreateContactDrawerFromRow(row);
                                  }}
                                  type="button"
                                >
                                  Add contact
                                </button>
                                <button
                                  className={styles.rowMenuAction}
                                  disabled={!rowHasEmail}
                                  onClick={() => {
                                    openEmailComposerFromRow(row);
                                  }}
                                  type="button"
                                >
                                  Email contact
                                </button>
                                <button
                                  className={styles.rowMenuAction}
                                  onClick={() => {
                                    openCreateMeetingDrawerFromRow(row, "Meeting");
                                  }}
                                  type="button"
                                >
                                  Schedule meeting
                                </button>
                                <button
                                  className={styles.rowMenuAction}
                                  onClick={() => {
                                    openCreateMeetingDrawerFromRow(row, "Drop Off");
                                  }}
                                  type="button"
                                >
                                  Schedule drop off
                                </button>
                                <button
                                  className={styles.rowMenuAction}
                                  onClick={() => {
                                    openCreateOpportunityDrawerFromRow(row);
                                  }}
                                  type="button"
                                >
                                  Create opportunity
                                </button>
                                <button
                                  className={`${styles.rowMenuAction} ${styles.rowMenuActionDanger}`}
                                  disabled={!rowCanDelete}
                                  onClick={() => {
                                    openDeleteContactConfirmation(row);
                                  }}
                                  type="button"
                                >
                                  Delete contact
                                </button>
                                <button
                                  className={`${styles.rowMenuAction} ${styles.rowMenuActionDanger}`}
                                  disabled={!rowCanDeleteBusinessAccount}
                                  onClick={() => {
                                    openDeleteBusinessAccountConfirmation(row);
                                  }}
                                  type="button"
                                >
                                  Delete business account
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      {visibleColumnOrder.map((columnId) => (
                        <td key={`${rowKey}-${columnId}`}>{renderCellContent(row, columnId)}</td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className={styles.pagination}>
          <span className={styles.paginationSummary}>
            Page {page} of {totalPages} • {total.toLocaleString()} matching • {allRows.length.toLocaleString()} loaded
            {lastSyncedAt ? ` • Last sync ${new Date(lastSyncedAt).toLocaleTimeString()}` : ""}
            {lastSyncedAt && lastSyncDurationMs !== null
              ? ` • Duration ${formatElapsedDuration(lastSyncDurationMs)}`
              : ""}
          </span>
          <div className={styles.paginationButtons}>
            <button disabled={page <= 1} onClick={() => jumpToPage(1)} type="button">
              First
            </button>
            <button disabled={page <= 1} onClick={() => jumpToPage(page - 1)} type="button">
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
            <button disabled={page >= totalPages} onClick={() => jumpToPage(page + 1)} type="button">
              Next
            </button>
            <button disabled={page >= totalPages} onClick={() => jumpToPage(totalPages)} type="button">
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
      </section>

      <CreateBusinessAccountDrawer
        employeeOptions={sortedEmployeeOptions}
        isOpen={isCreateDrawerOpen}
        openAiAttributeSuggestEnabled={openAiAttributeSuggestEnabled}
        onAccountCreated={handleAccountCreated}
        onClose={closeCreateDrawer}
        onContactCreated={handleContactCreated}
      />
      <CreateContactDrawer
        accountOptions={createContactAccountOptions}
        initialAccountRecordId={createContactDrawerInitialAccountRecordId}
        isOpen={isCreateContactDrawerOpen}
        onClose={closeCreateContactDrawer}
        onContactCreated={handleContactCreated}
      />
      <CreateOpportunityDrawer
        accountOptions={createContactAccountOptions}
        employeeOptions={sortedEmployeeOptions}
        fallbackRows={allRows}
        initialAccountRecordId={opportunityDrawerContext.initialAccountRecordId}
        initialContactId={opportunityDrawerContext.initialContactId}
        initialOwnerId={opportunityDrawerContext.initialOwnerId}
        initialOwnerName={opportunityDrawerContext.initialOwnerName}
        isOpen={isCreateOpportunityDrawerOpen}
        onClose={closeCreateOpportunityDrawer}
        onOpportunityCreated={handleOpportunityCreated}
        onRequestCreateContact={handleOpportunityDrawerRequestCreateContact}
      />
      <CreateMeetingDrawer
        defaultCategory={createMeetingCategory}
        isLoadingOptions={isLoadingMeetingOptions}
        isOpen={isCreateMeetingDrawerOpen}
        onClose={closeCreateMeetingDrawer}
        onContactCreated={handleMeetingContactCreated}
        onMeetingCreated={handleMeetingCreated}
        onRetryLoadOptions={() => {
          void loadMeetingOptions(true);
        }}
        options={meetingOptions ?? fallbackMeetingOptions}
        optionsError={meetingOptionsError}
        source={meetingSource}
        viewerLoginName={session?.user?.id ?? null}
      />
      <GmailComposeModal
        contactSuggestions={mailContactSuggestions}
        initialState={emailComposerState.initialState}
        isOpen={emailComposerState.isOpen}
        onClose={closeMailComposer}
        onRequestConnectGmail={handleConnectGmailFromAccounts}
        onSendError={(message) => {
          setSaveNotice(null);
          setSaveError(message);
        }}
        onSendQueued={() => {
          setSaveError(null);
          setSaveNotice("Sending email in the background. You can keep working.");
        }}
        onSent={handleEmailSent}
        session={mailSession}
        title="New Message"
      />
      <QueueDeleteContactsModal
        isOpen={deleteQueueRows.length > 0}
        isSubmitting={isDeletingContact || isDeletingSelectedContacts}
        onClose={closeDeleteContactConfirmation}
        onConfirm={handleConfirmDeleteContact}
        targets={deleteQueueRows.map(
          (row): QueueDeleteContactTarget => ({
            key: getRowKey(row),
            contactName: row.primaryContactName ?? null,
            companyName: row.companyName ?? null,
          }),
        )}
      />
      <QueueDeleteContactsModal
        confirmLabel="Queue account deletion"
        description="This request will go to the Deletion Queue for approval and will remove the business account after contacts have already been deleted."
        isOpen={deleteBusinessAccountRow !== null}
        isSubmitting={isDeletingBusinessAccount}
        onClose={closeDeleteBusinessAccountConfirmation}
        onConfirm={handleConfirmDeleteBusinessAccount}
        reasonPlaceholder="Explain why this business account should be deleted."
        targets={
          deleteBusinessAccountRow
            ? [
                {
                  key: resolveRowBusinessAccountRecordId(deleteBusinessAccountRow),
                  contactName: null,
                  companyName: deleteBusinessAccountRow.companyName ?? null,
                },
              ]
            : []
        }
        title="Queue business account deletion"
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
            onClick={() => {
              closeDrawer();
            }}
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

            <label>
              Company Description
              <textarea
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, companyDescription: event.target.value }
                      : current,
                  )
                }
                placeholder="Stored only in this app. Not sent to Acumatica."
                value={draft.companyDescription ?? ""}
              />
              <span className={styles.lookupHint}>
                This description stays in the app only. Save stores it locally and does not push it to Acumatica.
              </span>
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
              Job Title
              <input
                disabled={!selected.contactId}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, primaryContactJobTitle: event.target.value }
                      : current,
                  )
                }
                value={draft.primaryContactJobTitle ?? ""}
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
              Extension
              <input
                disabled={!selected.contactId}
                inputMode="numeric"
                maxLength={5}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          primaryContactExtension: event.target.value.replace(/\D/g, "").slice(0, 5),
                        }
                      : current,
                  )
                }
                placeholder="Extension"
                value={draft.primaryContactExtension ?? ""}
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
            <div className={styles.contactEnhanceSection}>
              <div className={styles.contactEnhanceActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={
                    isSaving ||
                    isDeletingContact ||
                    isEnhancingContact ||
                    !canEnhanceSelectedContact
                  }
                  onClick={() => {
                    void handleEnhanceContact();
                  }}
                  type="button"
                >
                  {isEnhancingContact ? "Enhancing..." : "Enhance with RocketReach"}
                </button>
                {!rocketReachEnabled ? (
                  <p className={styles.lookupHint}>
                    RocketReach enhancement is not configured for this environment.
                  </p>
                ) : !selected.contactId ? null : !hasMissingContactEnhanceField(draft) ? (
                  <p className={styles.lookupHint}>
                    RocketReach only fills missing contact name, job title, email, or phone fields.
                  </p>
                ) : (
                  <p className={styles.lookupHint}>
                    Enhance fills missing contact fields only. Click Save to persist any result.
                  </p>
                )}
              </div>
              {contactEnhanceError ? (
                <p className={styles.lookupError}>{contactEnhanceError}</p>
              ) : null}
              {contactEnhanceNotice ? (
                <p className={styles.lookupHint}>{contactEnhanceNotice}</p>
              ) : null}
              {contactEnhanceCandidates.length > 0 ? (
                <div className={styles.contactEnhanceCandidates}>
                  {contactEnhanceCandidates.map((candidate) => (
                    <article
                      className={styles.contactEnhanceCandidate}
                      key={candidate.id}
                    >
                      <div className={styles.contactEnhanceCandidateText}>
                        <strong>{candidate.name ?? `RocketReach contact ${candidate.id}`}</strong>
                        {candidate.currentTitle ? <p>{candidate.currentTitle}</p> : null}
                        {candidate.currentEmployer ? <p>{candidate.currentEmployer}</p> : null}
                        {candidate.location ? <p>{candidate.location}</p> : null}
                        {candidate.linkedinUrl ? (
                          <a
                            className={styles.recordLink}
                            href={candidate.linkedinUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            LinkedIn profile
                          </a>
                        ) : null}
                      </div>
                      <button
                        className={styles.secondaryButton}
                        disabled={isEnhancingContact}
                        onClick={() => {
                          void handleEnhanceContact(candidate);
                        }}
                        type="button"
                      >
                        Use this match
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
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
            <label
              className={saveFieldErrors.industryType ? styles.fieldErrorLabel : undefined}
            >
              Industry Type
              <select
                aria-invalid={Boolean(saveFieldErrors.industryType)}
                className={saveFieldErrors.industryType ? styles.fieldErrorControl : undefined}
                onChange={(event) => {
                  clearSaveFieldError("industryType");
                  setSaveError(null);
                  setSaveNotice(null);
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          industryType: event.target.value || null,
                        }
                      : current,
                  );
                }}
                value={draft.industryType ?? ""}
              >
                <option value="">Unassigned</option>
                {industryTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {saveFieldErrors.industryType ? (
                <span className={styles.fieldErrorText}>{saveFieldErrors.industryType}</span>
              ) : null}
            </label>

            <label
              className={saveFieldErrors.subCategory ? styles.fieldErrorLabel : undefined}
            >
              Sub-Category
              <select
                aria-invalid={Boolean(saveFieldErrors.subCategory)}
                className={saveFieldErrors.subCategory ? styles.fieldErrorControl : undefined}
                onChange={(event) => {
                  clearSaveFieldError("subCategory");
                  setSaveError(null);
                  setSaveNotice(null);
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          subCategory: event.target.value || null,
                        }
                      : current,
                  );
                }}
                value={draft.subCategory ?? ""}
              >
                <option value="">Unassigned</option>
                {subCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {saveFieldErrors.subCategory ? (
                <span className={styles.fieldErrorText}>{saveFieldErrors.subCategory}</span>
              ) : null}
            </label>

            <label
              className={saveFieldErrors.category ? styles.fieldErrorLabel : undefined}
            >
              Category
              <select
                aria-invalid={Boolean(saveFieldErrors.category)}
                className={saveFieldErrors.category ? styles.fieldErrorControl : undefined}
                onChange={(event) => {
                  clearSaveFieldError("category");
                  setSaveError(null);
                  setSaveNotice(null);
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          category: (event.target.value || null) as Category | null,
                        }
                      : current,
                  );
                }}
                value={draft.category ?? ""}
              >
                <option value="">Unassigned</option>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {saveFieldErrors.category ? (
                <span className={styles.fieldErrorText}>{saveFieldErrors.category}</span>
              ) : null}
            </label>

            <label
              className={saveFieldErrors.companyRegion ? styles.fieldErrorLabel : undefined}
            >
              Company Region
              <select
                aria-invalid={Boolean(saveFieldErrors.companyRegion)}
                className={saveFieldErrors.companyRegion ? styles.fieldErrorControl : undefined}
                onChange={(event) => {
                  clearSaveFieldError("companyRegion");
                  setSaveError(null);
                  setSaveNotice(null);
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          companyRegion: event.target.value || null,
                        }
                      : current,
                  );
                }}
                value={draft.companyRegion ?? ""}
              >
                <option value="">Unassigned</option>
                {companyRegionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {saveFieldErrors.companyRegion ? (
                <span className={styles.fieldErrorText}>{saveFieldErrors.companyRegion}</span>
              ) : null}
            </label>

            <div className={styles.companyAttributeSuggestionSection}>
              <div className={styles.companyAttributeSuggestionActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={
                    isSaving ||
                    isDeletingContact ||
                    isSuggestingCompanyAttributes ||
                    !canSuggestSelectedCompanyAttributes
                  }
                  onClick={() => {
                    void handleSuggestCompanyAttributes();
                  }}
                  type="button"
                >
                  {isSuggestingCompanyAttributes ? "Researching..." : "Suggest with OpenAI"}
                </button>
                {!openAiAttributeSuggestEnabled ? (
                  <p className={styles.lookupHint}>
                    OpenAI attribute suggestions are not configured for this environment.
                  </p>
                ) : !hasMissingCompanyAttributeSuggestionField(draft) ? (
                  <p className={styles.lookupHint}>
                    OpenAI only fills missing Company Region, Category, Industry Type, Sub-Category, or Company Description.
                  </p>
                ) : (
                  <p className={styles.lookupHint}>
                    OpenAI looks online for company evidence, writes a local-only company description, and also uses MeadowBrook&apos;s postal-code region map.
                  </p>
                )}
              </div>
              {companyAttributeSuggestionError ? (
                <p className={styles.lookupError}>{companyAttributeSuggestionError}</p>
              ) : null}
              {companyAttributeSuggestionNotice ? (
                <p className={styles.lookupHint}>{companyAttributeSuggestionNotice}</p>
              ) : null}
              {companyAttributeSuggestionResult ? (
                <div className={styles.companyAttributeSuggestionResult}>
                  <p>
                    Suggested values:
                    {" "}
                    {companyAttributeSuggestionResult.companyRegionLabel ?? "No region"}
                    {" / "}
                    {companyAttributeSuggestionResult.categoryLabel ?? "No category"}
                    {" / "}
                    {companyAttributeSuggestionResult.industryTypeLabel ?? "No industry type"}
                    {" / "}
                    {companyAttributeSuggestionResult.subCategoryLabel ?? "No sub-category"}
                    {" "}
                    ({companyAttributeSuggestionResult.confidence} confidence)
                  </p>
                  {companyAttributeSuggestionResult.companyDescription ? (
                    <p>{companyAttributeSuggestionResult.companyDescription}</p>
                  ) : null}
                  <p>{companyAttributeSuggestionResult.reasoning}</p>
                  {companyAttributeSuggestionResult.sources.length > 0 ? (
                    <div className={styles.companyAttributeSuggestionSources}>
                      {companyAttributeSuggestionResult.sources.map((source) => (
                        <a
                          className={styles.recordLink}
                          href={source.url}
                          key={source.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {source.title}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <label
              className={saveFieldErrors.week ? styles.fieldErrorLabel : undefined}
            >
              Week
              <select
                aria-invalid={Boolean(saveFieldErrors.week)}
                className={saveFieldErrors.week ? styles.fieldErrorControl : undefined}
                onChange={(event) => {
                  clearSaveFieldError("week");
                  setSaveError(null);
                  setSaveNotice(null);
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          week: event.target.value || null,
                        }
                      : current,
                  );
                }}
                value={draft.week ?? ""}
              >
                <option value="">Unassigned</option>
                {weekOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {saveFieldErrors.week ? (
                <span className={styles.fieldErrorText}>{saveFieldErrors.week}</span>
              ) : null}
            </label>

            <label>
              Contact Notes
              <textarea
                disabled={!selected.contactId}
                ref={notesFieldRef}
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

            <section className={styles.callHistorySection}>
              <div className={styles.callHistoryHeader}>
                <h3>Prior Calls</h3>
                <span className={styles.callHistorySummary}>
                  {selected.lastCalledAt ?? callHistory[0]?.startedAt
                    ? `Last called ${formatLastCalled(
                        selected.lastCalledAt ?? callHistory[0]?.startedAt ?? null,
                      )}`
                    : "No Twilio call history yet."}
                </span>
              </div>
              {callHistoryLoading ? (
                <p className={styles.auditHistoryEmpty}>Loading prior calls...</p>
              ) : callHistoryError ? (
                <p className={styles.lookupError}>{callHistoryError}</p>
              ) : callHistory.length === 0 ? (
                <p className={styles.auditHistoryEmpty}>
                  No prior calls are linked to this contact yet.
                </p>
              ) : (
                <div className={styles.callHistoryList}>
                  {callHistory.map((item) => {
                    const callLabel =
                      item.direction === "inbound" ? "Inbound call" : "Outbound call";
                    const outcomeLabel = item.outcome.replace(/_/g, " ");
                    const summaryText =
                      truncateLongText(item.summaryText, 480) ?? item.summaryText;
                    const transcriptText =
                      truncateLongText(item.transcriptText, 1800) ?? item.transcriptText;
                    const recordingLabel = item.recordingSid
                      ? `Recording ${item.recordingStatus ?? "captured"}`
                      : null;
                    const syncLabel = item.activitySyncStatus
                      ? `Post-call ${item.activitySyncStatus.replace(/_/g, " ")}`
                      : null;

                    return (
                      <article className={styles.callHistoryItem} key={item.sessionId}>
                        <div className={styles.callHistoryItemHeader}>
                          <strong>{callLabel}</strong>
                          <span className={styles.callHistoryMeta}>
                            {buildCallHistoryMeta(item)}
                          </span>
                        </div>
                        <div className={styles.callHistoryBadges}>
                          <span className={styles.callHistoryBadge}>{outcomeLabel}</span>
                          {recordingLabel ? (
                            <span className={styles.callHistoryBadge}>{recordingLabel}</span>
                          ) : null}
                          {syncLabel ? (
                            <span className={styles.callHistoryBadge}>{syncLabel}</span>
                          ) : null}
                        </div>
                        {summaryText ? (
                          <div className={styles.callHistoryTextBlock}>
                            <strong>AI summary</strong>
                            <p>{summaryText}</p>
                          </div>
                        ) : null}
                        {transcriptText ? (
                          <details className={styles.callHistoryTranscript}>
                            <summary>Transcript excerpt</summary>
                            <p>{transcriptText}</p>
                          </details>
                        ) : null}
                        {!summaryText && !transcriptText ? (
                          <p className={styles.auditHistoryEmpty}>
                            No ChatGPT summary or transcript has been stored for this call yet.
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={styles.auditHistorySection}>
              <div className={styles.auditHistoryHeader}>
                <h3>Audit History</h3>
                <Link
                  className={styles.recordLink}
                  href={`/audit?${new URLSearchParams({
                    businessAccountRecordId:
                      selected.accountRecordId?.trim() || selected.id.trim(),
                    ...(selected.contactId ? { contactId: String(selected.contactId) } : {}),
                  }).toString()}`}
                >
                  View full audit log
                </Link>
              </div>
              {auditHistoryLoading ? (
                <p className={styles.auditHistoryEmpty}>Loading audit history...</p>
              ) : auditHistoryError ? (
                <p className={styles.lookupError}>{auditHistoryError}</p>
              ) : auditHistory.length === 0 ? (
                <p className={styles.auditHistoryEmpty}>No audit events have been recorded for this record yet.</p>
              ) : (
                <div className={styles.auditHistoryList}>
                  {auditHistory.map((item) => (
                    <article className={styles.auditHistoryItem} key={item.id}>
                      <strong>{item.summary}</strong>
                      <span className={styles.auditHistoryMeta}>
                        {item.actorName ?? item.actorLoginName ?? "Unknown"} • {formatLastModified(item.occurredAt)}
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </section>

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
                className={styles.secondaryButton}
                disabled={isSaving || isDeletingContact}
                onClick={() => openCreateMeetingDrawerFromRow(selected, "Meeting")}
                type="button"
              >
                Schedule meeting
              </button>
              <button
                className={styles.secondaryButton}
                disabled={isSaving || isDeletingContact}
                onClick={() => openCreateMeetingDrawerFromRow(selected, "Drop Off")}
                type="button"
              >
                Schedule drop off
              </button>
              <button
                className={styles.deleteContactButton}
                disabled={
                  isSaving ||
                  isDeletingContact ||
                  isDeletingBusinessAccount ||
                  (selected.contactId ?? selected.primaryContactId ?? null) === null
                }
                onClick={handleDeleteSelectedContact}
                type="button"
              >
                {isDeletingContact ? "Deleting..." : "Delete contact"}
              </button>
              <button
                className={styles.deleteContactButton}
                disabled={
                  isSaving ||
                  isDeletingContact ||
                  isDeletingBusinessAccount ||
                  !canDeleteBusinessAccountRow(selected)
                }
                onClick={() => {
                  openDeleteBusinessAccountConfirmation(selected);
                }}
                type="button"
              >
                {isDeletingBusinessAccount ? "Deleting..." : "Delete business account"}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.drawerBody}>
            <p>Select a row to view or edit details.</p>
          </div>
        )}
      </aside>

      {selected ? (
        <button
          className={styles.backdrop}
          onClick={() => {
            closeDrawer();
          }}
          type="button"
        />
      ) : null}

      {isSelectionMergeOpen && selectedMergeAccountRecordId && selectedMergeBusinessAccountId ? (
        <ContactMergeModal
          businessAccountId={selectedMergeBusinessAccountId}
          businessAccountRecordId={selectedMergeAccountRecordId}
          companyName={selectedContactRows[0]?.companyName ?? ""}
          contacts={selectedContactRows.map((row) => toMergeableContactCandidate(row))}
          isOpen={isSelectionMergeOpen}
          onClose={() => {
            setIsSelectionMergeOpen(false);
          }}
          onMerged={handleMergeSelectionCompleted}
        />
      ) : null}
    </AppChrome>
  );
}
