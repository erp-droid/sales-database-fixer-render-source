"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { CallPhoneButton } from "@/components/call-phone-button";
import {
  CreateContactDrawer,
  type CreateContactAccountOption,
} from "@/components/create-contact-drawer";
import type {
  BusinessAccountDetailResponse,
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
  Category,
} from "@/types/business-account";
import type {
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import {
  DATA_QUALITY_BASIS_VALUES,
  type DataQualityBasis,
  type DataQualityContributorsResponse,
  type DataQualityExpandedSummaryResponse,
  type DataQualityIssueRow,
  type DataQualityIssuesResponse,
  type DataQualityLeaderboardResponse,
  type DataQualityMetric,
  type DataQualityMetricKey,
  type DataQualityThroughputResponse,
  type DataQualityTrendsResponse,
} from "@/types/data-quality";
import {
  buildDataQualityReviewedGroupKey,
  buildDataQualityIssueKey,
  buildDataQualityReviewedItemKey,
} from "@/lib/data-quality";
import {
  buildAcumaticaBusinessAccountUrl,
  buildAcumaticaContactUrl,
} from "@/lib/acumatica-links";
import { buildBusinessAccountConcurrencySnapshot } from "@/lib/business-account-concurrency";
import { BUSINESS_ACCOUNT_REGION_VALUES } from "@/lib/business-account-region-values";
import { enforceSinglePrimaryPerAccountRows } from "@/lib/business-accounts";
import {
  formatPhoneDraftValue,
  normalizeExtensionForSave,
  normalizePhoneForSave,
  parsePhoneWithExtension,
} from "@/lib/phone";
import {
  type CachedDataset,
  DATASET_STORAGE_KEYS,
  getMemoryCachedDataset,
  isBusinessAccountRow,
  readCachedDatasetFromStorage,
  readCachedSyncMeta,
  writeCachedDatasetToStorage,
} from "@/lib/client-dataset-cache";
import { prefetchContactMergePreview } from "@/lib/contact-merge-preview-client";
import { ContactMergeModal } from "@/components/contact-merge-modal";
import {
  QueueDeleteContactsModal,
  type QueueDeleteContactTarget,
} from "@/components/queue-delete-contacts-modal";
import type {
  ContactMergeResponse,
  MergeableContactCandidate,
} from "@/types/contact-merge";

import styles from "./data-quality-client.module.css";
const REVIEWED_ISSUES_STORAGE_KEY = "dataQuality.reviewedIssues.v1";
const LIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const LIVE_EVENT_REFRESH_DEBOUNCE_MS = 1_500;
const ISSUES_PAGE_SIZE = 25;
const ALL_SALES_REP_FILTER = "__all__";
const UNASSIGNED_SALES_REP_FILTER = "__unassigned__";
const DUPLICATE_METRICS = new Set<DataQualityMetricKey>([
  "duplicateBusinessAccount",
  "duplicateContact",
]);
const HIDDEN_QUALITY_METRIC_KEYS = new Set<DataQualityMetricKey>([
  "duplicateBusinessAccount",
  "missingCategory",
  "missingCompany",
  "missingIndustry",
  "missingRegion",
  "missingSubCategory",
]);
const DEFAULT_VISIBLE_QUALITY_METRIC: DataQualityMetricKey = "missingContact";

type DashboardView = "issues" | "trends" | "ownership";

const DASHBOARD_VIEWS: Array<{ key: DashboardView; label: string }> = [
  { key: "issues", label: "Issues" },
  { key: "trends", label: "Trends" },
  { key: "ownership", label: "Ownership" },
];

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
};

type EmployeeOption = {
  id: string;
  name: string;
};

type EmployeeLookupResponse = {
  items: EmployeeOption[];
};

type ReviewedIssueState = {
  itemKeys: string[];
  groupKeys: string[];
};

type AttributeOption = {
  value: string;
  label: string;
  aliases?: string[];
};

type RowFixDraft = {
  companyName: string;
  salesRepId: string;
  category: string;
  companyRegion: string;
  subCategory: string;
  industryType: string;
  primaryContactPhone: string;
  primaryContactExtension: string;
  primaryContactEmail: string;
};

type MergeGroupState = {
  key: string;
  items: DataQualityIssueRow[];
};

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

const COMPANY_REGION_OPTIONS: AttributeOption[] = [
  ...BUSINESS_ACCOUNT_REGION_VALUES.map((value) => ({
    value,
    label: value,
  })),
];

function normalizeOptionComparable(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionValue(
  options: AttributeOption[],
  value: string | null | undefined,
): string {
  if (!value || !value.trim()) {
    return "";
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

  return value.trim();
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

function isEmployeeOption(value: unknown): value is EmployeeOption {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string";
}

function isEmployeeLookupResponse(value: unknown): value is EmployeeLookupResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.every((item) => isEmployeeOption(item));
}

function parseRequestError(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage;
}

function formatCreateContactAccountAddress(row: BusinessAccountRow): string {
  if (row.address.trim()) {
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

function buildCreateContactAccountOptionFromIssue(
  issue: DataQualityIssueRow | null,
): CreateContactAccountOption | null {
  if (!issue) {
    return null;
  }

  const businessAccountRecordId = issue.accountRecordId?.trim() ?? "";
  const businessAccountId = issue.businessAccountId.trim();
  const companyName = issue.companyName.trim();
  if (!businessAccountRecordId || !businessAccountId || !companyName) {
    return null;
  }

  return {
    businessAccountRecordId,
    businessAccountId,
    companyName,
    address: issue.address.trim(),
  };
}

function readCachedRows(): BusinessAccountRow[] {
  return readCachedDatasetFromStorage()?.rows ?? [];
}

function readCachedLastSyncedAt(): string | null {
  return (
    getMemoryCachedDataset()?.lastSyncedAt ??
    readCachedDatasetFromStorage()?.lastSyncedAt ??
    readCachedSyncMeta().lastSyncedAt
  );
}

function makeReviewedItemKey(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  item: DataQualityIssueRow,
): string {
  return buildDataQualityReviewedItemKey(metric, basis, item);
}

function makeReviewedGroupKey(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  groupKey: string,
): string {
  return buildDataQualityReviewedGroupKey(metric, basis, groupKey);
}

function pickDefaultMergeKeepContactId(contacts: DataQualityIssueRow[]): number | null {
  if (contacts.length < 2) {
    return contacts[0]?.contactId ?? null;
  }

  const primary = contacts.find((contact) => contact.isPrimaryContact && contact.contactId !== null);
  if (primary?.contactId !== null && primary?.contactId !== undefined) {
    return primary.contactId;
  }

  return contacts[0]?.contactId ?? null;
}

function toMergeableContactCandidate(item: DataQualityIssueRow): MergeableContactCandidate {
  return {
    contactId: item.contactId,
    rowKey: item.rowKey ?? null,
    businessAccountRecordId: item.accountRecordId ?? item.accountKey,
    businessAccountId: item.businessAccountId,
    companyName: item.companyName,
    contactName: item.contactName,
    contactEmail: item.contactEmail,
    contactPhone: item.contactPhone,
    isPrimaryContact: item.isPrimaryContact,
    salesRepName: item.salesRepName,
    lastModifiedIso: null,
  };
}

function prefetchMergeGroupPreview(items: DataQualityIssueRow[]) {
  if (items.length < 2 || items.some((item) => item.contactId === null)) {
    return;
  }

  const keepContactId = pickDefaultMergeKeepContactId(items);
  if (keepContactId === null) {
    return;
  }

  const businessAccountRecordId = items[0]?.accountRecordId ?? items[0]?.accountKey ?? "";

  if (!businessAccountRecordId) {
    return;
  }

  prefetchContactMergePreview({
    businessAccountRecordId,
    keepContactId,
    contactIds: [
      keepContactId,
      ...items
        .map((item) => item.contactId)
        .filter((contactId): contactId is number => contactId !== null)
        .filter((contactId) => contactId !== keepContactId),
    ],
  });
}

function resolveIssueGroupKey(
  metric: DataQualityMetricKey,
  item: DataQualityIssueRow,
  fallbackSuffix: string,
): string | null {
  if (!isDuplicateMetric(metric)) {
    return null;
  }

  return (
    item.duplicateGroupKey?.trim() ||
    `${item.companyName.trim().toLowerCase()}|${item.contactName?.trim().toLowerCase() ?? fallbackSuffix}`
  );
}

function isIssueReviewed(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  item: DataQualityIssueRow,
  reviewedItemKeySet: Set<string>,
  reviewedGroupKeySet: Set<string>,
  fallbackSuffix: string,
): boolean {
  const itemKey = makeReviewedItemKey(metric, basis, item);
  if (reviewedItemKeySet.has(itemKey)) {
    return true;
  }

  const groupKey = resolveIssueGroupKey(metric, item, fallbackSuffix);
  if (!groupKey) {
    return false;
  }

  return reviewedGroupKeySet.has(makeReviewedGroupKey(metric, basis, groupKey));
}

function parseReviewedIssueState(raw: string | null): ReviewedIssueState {
  if (!raw) {
    return {
      itemKeys: [],
      groupKeys: [],
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReviewedIssueState>;
    const itemKeys = Array.isArray(parsed.itemKeys)
      ? parsed.itemKeys.filter((value): value is string => typeof value === "string")
      : [];
    const groupKeys = Array.isArray(parsed.groupKeys)
      ? parsed.groupKeys.filter((value): value is string => typeof value === "string")
      : [];

    return {
      itemKeys: [...new Set(itemKeys)],
      groupKeys: [...new Set(groupKeys)],
    };
  } catch {
    return {
      itemKeys: [],
      groupKeys: [],
    };
  }
}

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }
  const value = (payload as Record<string, unknown>).error;
  return typeof value === "string" && value.trim() ? value : "Request failed.";
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }
  return (await response.json().catch(() => null)) as T | null;
}

function isDataQualityExpandedSummaryResponse(
  payload: DataQualityExpandedSummaryResponse | { error?: string } | null,
): payload is DataQualityExpandedSummaryResponse {
  return Boolean(
    payload &&
      Array.isArray((payload as DataQualityExpandedSummaryResponse).metrics) &&
      (payload as DataQualityExpandedSummaryResponse).kpis &&
      Array.isArray((payload as DataQualityExpandedSummaryResponse).scoreboard),
  );
}

function isDataQualityIssuesResponse(
  payload: DataQualityIssuesResponse | { error?: string } | null,
): payload is DataQualityIssuesResponse {
  return Boolean(payload && Array.isArray((payload as DataQualityIssuesResponse).items));
}

function isDataQualityTrendsResponse(
  payload: DataQualityTrendsResponse | { error?: string } | null,
): payload is DataQualityTrendsResponse {
  return Boolean(payload && Array.isArray((payload as DataQualityTrendsResponse).points));
}

function isDataQualityThroughputResponse(
  payload: DataQualityThroughputResponse | { error?: string } | null,
): payload is DataQualityThroughputResponse {
  return Boolean(
    payload &&
      typeof (payload as DataQualityThroughputResponse).timezone === "string" &&
      Boolean((payload as DataQualityThroughputResponse).today),
  );
}

function isDataQualityLeaderboardResponse(
  payload: DataQualityLeaderboardResponse | { error?: string } | null,
): payload is DataQualityLeaderboardResponse {
  return Boolean(payload && Array.isArray((payload as DataQualityLeaderboardResponse).items));
}

function isDataQualityContributorsResponse(
  payload: DataQualityContributorsResponse | { error?: string } | null,
): payload is DataQualityContributorsResponse {
  return Boolean(payload && Array.isArray((payload as DataQualityContributorsResponse).items));
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
}

function formatSigned(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
}

function renderText(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return "-";
  }
  return value;
}

function renderRecordLink(
  label: string | null | undefined,
  url: string | null,
  className: string,
): ReactNode {
  const text = renderText(label);
  if (!url || text === "-") {
    return text;
  }

  return (
    <a className={className} href={url} rel="noreferrer" target="_blank">
      {text}
    </a>
  );
}

function hasUsableContactLabel(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/^[.\s]+$/.test(value);
}

function getIssueContactLabel(
  metric: DataQualityMetricKey,
  item: DataQualityIssueRow,
): string | null {
  if (hasUsableContactLabel(item.contactName)) {
    return item.contactName;
  }

  if (metric === "missingContact") {
    return "No associated contact";
  }

  if (item.contactId !== null) {
    return `Unresolved contact ${item.contactId}`;
  }

  return null;
}

function getIssuePhoneDisplay(item: DataQualityIssueRow): string {
  if (item.contactPhone && item.contactPhone.trim()) {
    const extension = item.contactExtension?.trim();
    return extension ? `${item.contactPhone} x${extension}` : item.contactPhone;
  }

  return renderText(item.rawContactPhone);
}

function getMetricValueLabel(metric: DataQualityMetricKey): string {
  switch (metric) {
    case "missingSalesRep":
      return "Sales rep";
    case "missingCategory":
      return "Category";
    case "missingRegion":
      return "Region";
    case "missingSubCategory":
      return "Sub-category";
    case "missingIndustry":
      return "Industry";
    case "invalidPhone":
      return "Phone";
    case "missingContactEmail":
      return "Email";
    case "missingContact":
      return "Contact";
    case "missingCompany":
    case "duplicateBusinessAccount":
      return "Company";
    default:
      return "Current value";
  }
}

function getMetricValue(metric: DataQualityMetricKey, item: DataQualityIssueRow): string {
  switch (metric) {
    case "missingSalesRep":
      return renderText(item.salesRepName);
    case "missingCategory":
      return renderText(item.category);
    case "missingRegion":
      return renderText(item.companyRegion);
    case "missingSubCategory":
      return renderText(item.subCategory);
    case "missingIndustry":
      return renderText(item.industryType);
    case "invalidPhone":
      return renderText(item.rawContactPhone ?? item.contactPhone);
    case "missingContactEmail":
      return renderText(item.contactEmail);
    case "missingContact":
      return renderText(getIssueContactLabel(metric, item));
    case "missingCompany":
    case "duplicateBusinessAccount":
      return renderText(item.companyName);
    default:
      return "-";
  }
}

function getIssueContextLines(item: DataQualityIssueRow): string[] {
  return [renderText(item.address), `Sales rep: ${renderText(item.salesRepName)}`];
}

function getMetricMissingCount(metric: DataQualityMetric, basis: DataQualityBasis): number {
  return basis === "account" ? metric.missingAccounts : metric.missingRows;
}

function getMetricSeverityPercent(metric: DataQualityMetric, basis: DataQualityBasis): number {
  return basis === "account" ? metric.accountMissingPct : metric.rowMissingPct;
}

function getMetricSeverityRank(
  tone: "calm" | "watch" | "priority" | "critical",
): number {
  switch (tone) {
    case "critical":
      return 4;
    case "priority":
      return 3;
    case "watch":
      return 2;
    case "calm":
    default:
      return 1;
  }
}

function getMetricSeverityTone(
  metricKey: DataQualityMetricKey,
  percent: number,
): "calm" | "watch" | "priority" | "critical" {
  switch (metricKey) {
    case "duplicateBusinessAccount":
    case "duplicateContact":
    case "invalidPhone":
    case "missingContactEmail":
    case "missingContact":
    case "missingSalesRep":
      return "critical";
    case "missingCategory":
    case "missingIndustry":
    case "missingSubCategory":
      return "watch";
    default:
      break;
  }

  if (percent < 5) {
    return "calm";
  }

  if (percent < 15) {
    return "watch";
  }

  if (percent < 40) {
    return "priority";
  }

  return "critical";
}

function getMetricSeverityLabel(
  metricKey: DataQualityMetricKey,
  percent: number,
): string {
  const tone = getMetricSeverityTone(metricKey, percent);
  switch (tone) {
    case "calm":
      return "Calm";
    case "watch":
      return "Watch";
    case "priority":
      return "Priority";
    case "critical":
      return "Critical";
    default:
      return "Watch";
  }
}

function getMetricAffectedLabel(percent: number): string {
  return `${formatPercent(percent)} affected`;
}

function isDuplicateMetric(metric: DataQualityMetricKey): boolean {
  return DUPLICATE_METRICS.has(metric);
}

function formatDateLabel(day: string): string {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return day;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatDetailedDateLabel(day: string): string {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return day;
  }

  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function describeActivityTrend(created: number, fixed: number): string {
  const net = fixed - created;
  if (net > 0) {
    return `Backlog shrank by ${net.toLocaleString()} over this 14-day window because fixes outpaced new issues.`;
  }

  if (net < 0) {
    return `Backlog grew by ${Math.abs(net).toLocaleString()} over this 14-day window because new issues outpaced fixes.`;
  }

  return "Backlog was flat over this 14-day window because fixes matched new issues.";
}

export function DataQualityClient({
  acumaticaBaseUrl,
  acumaticaCompanyId,
}: {
  acumaticaBaseUrl: string;
  acumaticaCompanyId: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);

  const [cachedRows, setCachedRows] = useState<BusinessAccountRow[]>([]);
  const [liveSummary, setLiveSummary] = useState<DataQualityExpandedSummaryResponse | null>(
    null,
  );
  const [liveTrends, setLiveTrends] = useState<DataQualityTrendsResponse | null>(null);
  const [liveThroughput, setLiveThroughput] = useState<DataQualityThroughputResponse | null>(
    null,
  );
  const [liveLeaderboard, setLiveLeaderboard] =
    useState<DataQualityLeaderboardResponse | null>(null);
  const [liveContributors, setLiveContributors] =
    useState<DataQualityContributorsResponse | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [mergeSuccessMessage, setMergeSuccessMessage] = useState<string | null>(null);
  const [isRefreshingSummary, setIsRefreshingSummary] = useState(false);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [deletingContactIds, setDeletingContactIds] = useState<Record<number, boolean>>(
    {},
  );
  const [deleteQueueRow, setDeleteQueueRow] = useState<DataQualityIssueRow | null>(null);
  const [savingFixKeys, setSavingFixKeys] = useState<Record<string, boolean>>({});
  const [rowFixDrafts, setRowFixDrafts] = useState<Record<string, RowFixDraft>>({});
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [reviewedItemKeys, setReviewedItemKeys] = useState<string[]>([]);
  const [reviewedGroupKeys, setReviewedGroupKeys] = useState<string[]>([]);
  const [liveIssues, setLiveIssues] = useState<DataQualityIssuesResponse | null>(null);
  const [liveIssuesKey, setLiveIssuesKey] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<DataQualityMetricKey>(
    DEFAULT_VISIBLE_QUALITY_METRIC,
  );
  const [selectedBasis, setSelectedBasis] = useState<DataQualityBasis>("row");
  const [selectedIssueSalesRep, setSelectedIssueSalesRep] = useState(ALL_SALES_REP_FILTER);
  const [activeView, setActiveView] = useState<DashboardView>("issues");
  const [loadedViews, setLoadedViews] = useState<Record<DashboardView, boolean>>({
    issues: true,
    trends: false,
    ownership: false,
  });
  const [isLoadingTrendsView, setIsLoadingTrendsView] = useState(false);
  const [isLoadingOwnershipView, setIsLoadingOwnershipView] = useState(false);
  const [issuesPage, setIssuesPage] = useState(1);
  const [mergeGroup, setMergeGroup] = useState<MergeGroupState | null>(null);
  const [createContactIssue, setCreateContactIssue] = useState<DataQualityIssueRow | null>(null);
  const [hoveredActivityDay, setHoveredActivityDay] = useState<string | null>(null);
  const issuesRequestSequenceRef = useRef(0);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const liveRefreshPendingWhileHiddenRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  const issuesPageSize = isDuplicateMetric(selectedMetric) ? 200 : ISSUES_PAGE_SIZE;
  const currentIssuesKey = `${selectedMetric}|${selectedBasis}|${selectedIssueSalesRep}|${issuesPage}|${issuesPageSize}`;
  const reviewedItemKeySet = useMemo(() => new Set(reviewedItemKeys), [reviewedItemKeys]);
  const reviewedGroupKeySet = useMemo(() => new Set(reviewedGroupKeys), [reviewedGroupKeys]);

  const activeSummary = liveSummary;
  const liveSummaryComputedAtIso = liveSummary?.computedAtIso ?? null;
  const liveIssuesMatchSelection =
    liveIssuesKey === currentIssuesKey && liveIssues !== null;
  const hasLiveIssuesForSelection = liveIssuesMatchSelection && liveIssues !== null;
  const liveIssuesMatchSummary =
    !liveSummaryComputedAtIso ||
    (hasLiveIssuesForSelection && liveIssues?.computedAtIso === liveSummaryComputedAtIso);
  const drilldownWaitingForFreshLiveIssues =
    Boolean(liveSummaryComputedAtIso) &&
    hasLiveIssuesForSelection &&
    !liveIssuesMatchSummary &&
    !issuesError;
  const rawDisplayedIssues = hasLiveIssuesForSelection
    ? liveIssues
    : null;
  const isIssueTableLoading = !rawDisplayedIssues && (isLoadingIssues || drilldownWaitingForFreshLiveIssues);
  const displayedIssues = useMemo(() => {
    if (!rawDisplayedIssues) {
      return rawDisplayedIssues;
    }

    const filteredItems = rawDisplayedIssues.items.filter((item, index) => {
      return !isIssueReviewed(
        selectedMetric,
        selectedBasis,
        item,
        reviewedItemKeySet,
        reviewedGroupKeySet,
        `row-${index}`,
      );
    });

    return {
      ...rawDisplayedIssues,
      items: filteredItems,
    };
  }, [
    rawDisplayedIssues,
    reviewedGroupKeySet,
    reviewedItemKeySet,
    selectedBasis,
    selectedMetric,
  ]);

  const summaryMetricMap = useMemo(() => {
    const next = new Map<DataQualityMetricKey, DataQualityMetric>();
    (activeSummary?.metrics ?? []).forEach((metric) => {
      next.set(metric.key, metric);
    });
    return next;
  }, [activeSummary]);
  const sortedMetrics = useMemo(() => {
    const metrics = [...(activeSummary?.metrics ?? [])];
    metrics.sort((left, right) => {
      const leftTone = getMetricSeverityTone(
        left.key,
        getMetricSeverityPercent(left, selectedBasis),
      );
      const rightTone = getMetricSeverityTone(
        right.key,
        getMetricSeverityPercent(right, selectedBasis),
      );
      const toneDiff = getMetricSeverityRank(rightTone) - getMetricSeverityRank(leftTone);
      if (toneDiff !== 0) {
        return toneDiff;
      }

      const percentDiff =
        getMetricSeverityPercent(right, selectedBasis) -
        getMetricSeverityPercent(left, selectedBasis);
      if (percentDiff !== 0) {
        return percentDiff;
      }

      const missingDiff =
        getMetricMissingCount(right, selectedBasis) -
        getMetricMissingCount(left, selectedBasis);
      if (missingDiff !== 0) {
        return missingDiff;
      }

      return left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    return metrics;
  }, [activeSummary?.metrics, selectedBasis]);
  const visibleSortedMetrics = useMemo(
    () => sortedMetrics.filter((metric) => !HIDDEN_QUALITY_METRIC_KEYS.has(metric.key)),
    [sortedMetrics],
  );

  useEffect(() => {
    if (!HIDDEN_QUALITY_METRIC_KEYS.has(selectedMetric)) {
      return;
    }

    const fallbackMetric = visibleSortedMetrics[0]?.key ?? DEFAULT_VISIBLE_QUALITY_METRIC;
    if (fallbackMetric !== selectedMetric) {
      setSelectedMetric(fallbackMetric);
      setIssuesPage(1);
    }
  }, [selectedMetric, visibleSortedMetrics]);

  const accountOptions = useMemo(() => {
    const options = buildCreateContactAccountOptions(cachedRows);
    const activeIssueOption = buildCreateContactAccountOptionFromIssue(createContactIssue);
    if (!activeIssueOption) {
      return options;
    }

    if (
      options.some(
        (option) => option.businessAccountRecordId === activeIssueOption.businessAccountRecordId,
      )
    ) {
      return options;
    }

    return [activeIssueOption, ...options];
  }, [cachedRows, createContactIssue]);

  const selectedMetricStats = summaryMetricMap.get(selectedMetric) ?? null;
  const selectedMetricLabel =
    summaryMetricMap.get(selectedMetric)?.label ?? "Issue Drilldown";
  const selectedIssueSalesRepLabel =
    selectedIssueSalesRep === ALL_SALES_REP_FILTER
      ? ""
      : ` · ${
          selectedIssueSalesRep === UNASSIGNED_SALES_REP_FILTER
            ? "Unassigned"
            : selectedIssueSalesRep
        }`;
  const activeKpis = activeSummary?.kpis ?? null;
  const openIssues = activeKpis?.openIssues ?? 0;
  const affectedRecords = activeKpis?.affectedRecords ?? 0;
  const reviewedExceptions = activeKpis?.reviewedExceptions ?? 0;
  const cleanRecords = activeKpis?.cleanRecords ?? 0;
  const totalChecked = activeKpis?.totalChecked ?? 0;
  const percentComplete = activeKpis?.percentComplete ?? 0;
  const completionDegrees = Math.max(0, Math.min(360, (percentComplete / 100) * 360));

  async function loadTrendsAnalytics(
    query: string,
    options?: {
      cancelled?: () => boolean;
      errorTarget?: "summary" | "issues";
    },
  ) {
    setIsLoadingTrendsView(true);

    const results = await Promise.allSettled([
      (async () => {
        const response = await fetch(`/api/data-quality/trends?${query}`, { cache: "no-store" });
        const payload = await readJsonResponse<DataQualityTrendsResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isDataQualityTrendsResponse(payload)) {
          throw new Error("Unexpected response while loading data quality trends.");
        }
        return { key: "trends" as const, payload };
      })(),
      (async () => {
        const response = await fetch(`/api/data-quality/throughput?${query}`, {
          cache: "no-store",
        });
        const payload = await readJsonResponse<DataQualityThroughputResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isDataQualityThroughputResponse(payload)) {
          throw new Error("Unexpected response while loading quality throughput.");
        }
        return { key: "throughput" as const, payload };
      })(),
    ]);

    if (options?.cancelled?.()) {
      setIsLoadingTrendsView(false);
      return;
    }

    let firstError: string | null = null;
    for (const result of results) {
      if (result.status === "rejected") {
        firstError ??=
          result.reason instanceof Error
            ? result.reason.message
            : "Some data quality analytics failed to load.";
        continue;
      }

      switch (result.value.key) {
        case "trends":
          setLiveTrends(result.value.payload);
          break;
        case "throughput":
          setLiveThroughput(result.value.payload);
          break;
      }
    }

    if (!firstError) {
      setLoadedViews((current) => ({ ...current, trends: true }));
    }

    if (firstError) {
      if (options?.errorTarget === "issues") {
        setIssuesError(firstError);
      } else {
        setSummaryError(firstError);
      }
    }

    setIsLoadingTrendsView(false);
  }

  async function loadOwnershipAnalytics(
    query: string,
    options?: {
      cancelled?: () => boolean;
      errorTarget?: "summary" | "issues";
    },
  ) {
    setIsLoadingOwnershipView(true);

    const results = await Promise.allSettled([
      (async () => {
        const response = await fetch(`/api/data-quality/leaderboard?${query}`, {
          cache: "no-store",
        });
        const payload = await readJsonResponse<DataQualityLeaderboardResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isDataQualityLeaderboardResponse(payload)) {
          throw new Error("Unexpected response while loading leaderboard.");
        }
        return { key: "leaderboard" as const, payload };
      })(),
      (async () => {
        const response = await fetch(`/api/data-quality/contributors?${query}`, {
          cache: "no-store",
        });
        const payload = await readJsonResponse<
          DataQualityContributorsResponse | { error?: string }
        >(response);
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isDataQualityContributorsResponse(payload)) {
          throw new Error("Unexpected response while loading contributor leaderboard.");
        }
        return { key: "contributors" as const, payload };
      })(),
    ]);

    if (options?.cancelled?.()) {
      setIsLoadingOwnershipView(false);
      return;
    }

    let firstError: string | null = null;
    for (const result of results) {
      if (result.status === "rejected") {
        firstError ??=
          result.reason instanceof Error
            ? result.reason.message
            : "Some data quality analytics failed to load.";
        continue;
      }

      switch (result.value.key) {
        case "leaderboard":
          setLiveLeaderboard(result.value.payload);
          break;
        case "contributors":
          setLiveContributors(result.value.payload);
          break;
      }
    }

    if (!firstError) {
      setLoadedViews((current) => ({ ...current, ownership: true }));
    }

    if (firstError) {
      if (options?.errorTarget === "issues") {
        setIssuesError(firstError);
      } else {
        setSummaryError(firstError);
      }
    }

    setIsLoadingOwnershipView(false);
  }

  const throughput = liveThroughput ?? {
    timezone: "America/Toronto",
    basis: selectedBasis,
    today: { fixed: 0, created: 0, netChange: 0 },
    week: { fixed: 0, created: 0, netChange: 0 },
    month: { fixed: 0, created: 0, netChange: 0 },
  };

  const trendsPoints = liveTrends?.points ?? [];
  const openTrendMax = Math.max(
    1,
    ...trendsPoints.map((point) => point.openIssues),
  );
  const openIssuesPath = trendsPoints
    .map((point, index) => {
      const x =
        trendsPoints.length <= 1
          ? 0
          : (index / (trendsPoints.length - 1)) * 100;
      const y = 100 - (point.openIssues / openTrendMax) * 100;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const recentActivityPoints = trendsPoints.slice(-14);
  const activityMax = Math.max(
    1,
    ...recentActivityPoints.map((point) => point.created + point.fixed),
  );
  const recentActivityTotals = useMemo(() => {
    return recentActivityPoints.reduce(
      (totals, point) => {
        totals.created += point.created;
        totals.fixed += point.fixed;
        return totals;
      },
      { created: 0, fixed: 0 },
    );
  }, [recentActivityPoints]);
  const activeActivityPoint = useMemo(() => {
    if (recentActivityPoints.length === 0) {
      return null;
    }

    if (hoveredActivityDay) {
      const hoveredPoint = recentActivityPoints.find((point) => point.day === hoveredActivityDay);
      if (hoveredPoint) {
        return hoveredPoint;
      }
    }

    return recentActivityPoints[recentActivityPoints.length - 1] ?? null;
  }, [hoveredActivityDay, recentActivityPoints]);
  const recentActivityNarrative = describeActivityTrend(
    recentActivityTotals.created,
    recentActivityTotals.fixed,
  );
  const burndownRemaining = liveTrends?.burndown.remainingOpenIssues ?? 0;
  const burndownVelocity = liveTrends?.burndown.avgNetFixPerDay14d ?? 0;
  const burndownEta =
    liveTrends?.burndown.etaDaysToZero === null || liveTrends?.burndown.etaDaysToZero === undefined
      ? "No forecast yet"
      : `${liveTrends.burndown.etaDaysToZero} days`;

  const scoreboardRows = activeSummary?.scoreboard ?? [];
  const leaderboardRows = useMemo(() => liveLeaderboard?.items ?? [], [liveLeaderboard]);
  const contributorRows = useMemo(() => liveContributors?.items ?? [], [liveContributors]);
  const displayedContributorRows = useMemo(() => {
    if (!session?.user) {
      return contributorRows;
    }

    const alreadyIncluded = contributorRows.some(
      (row) =>
        row.userId.trim().toLowerCase() === session.user?.id.trim().toLowerCase() ||
        row.userName.trim().toLowerCase() === session.user?.name.trim().toLowerCase(),
    );
    if (alreadyIncluded) {
      return contributorRows;
    }

    return [
      ...contributorRows,
      {
        userId: session.user.id,
        userName: session.user.name,
        fixedTotal: 0,
        fixedToday: 0,
        fixedWeek: 0,
        fixedMonth: 0,
        rank: contributorRows.length + 1,
      },
    ];
  }, [contributorRows, session]);
  const visibleContributorRows = useMemo(() => {
    if (!session?.user) {
      return displayedContributorRows.slice(0, 8);
    }

    const topRows = displayedContributorRows.slice(0, 8);
    const currentIndex = displayedContributorRows.findIndex(
      (row) =>
        row.userId.trim().toLowerCase() === session.user?.id.trim().toLowerCase() ||
        row.userName.trim().toLowerCase() === session.user?.name.trim().toLowerCase(),
    );
    if (currentIndex < 0 || currentIndex < 8) {
      return topRows;
    }

    const currentRow = displayedContributorRows[currentIndex];
    return [...topRows.slice(0, 7), currentRow];
  }, [displayedContributorRows, session]);

  const duplicateIssueGroups = useMemo(() => {
    if (!displayedIssues || !isDuplicateMetric(selectedMetric)) {
      return [] as Array<{ key: string; items: DataQualityIssueRow[] }>;
    }

    const grouped = new Map<string, DataQualityIssueRow[]>();
    displayedIssues.items.forEach((item, index) => {
      const key = resolveIssueGroupKey(selectedMetric, item, `row-${index}`);
      if (!key) {
        return;
      }
      const existing = grouped.get(key);
      if (existing) {
        existing.push(item);
      } else {
        grouped.set(key, [item]);
      }
    });

    return [...grouped.entries()].map(([key, items]) => ({ key, items }));
  }, [displayedIssues, selectedMetric]);

  const categoryOptionsForSelect = useMemo(
    () => withCurrentOption(CATEGORY_OPTIONS, null),
    [],
  );

  const salesRepOptions = useMemo(() => {
    const unique = new Map<string, EmployeeOption>();
    employeeOptions.forEach((option) => {
      const trimmedId = option.id.trim();
      const trimmedName = option.name.trim();
      if (!trimmedId || !trimmedName) {
        return;
      }

      if (!unique.has(trimmedId)) {
        unique.set(trimmedId, {
          id: trimmedId,
          name: trimmedName,
        });
      }
    });

    return [...unique.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
  }, [employeeOptions]);
  const issueSalesRepOptions = useMemo(() => {
    const names = new Set<string>();

    cachedRows.forEach((row) => {
      const name = row.salesRepName?.trim();
      if (name) {
        names.add(name);
      }
    });

    leaderboardRows.forEach((row) => {
      const name = row.salesRepName?.trim();
      if (name && normalizeOptionComparable(name) !== normalizeOptionComparable("Unassigned")) {
        names.add(name);
      }
    });

    displayedIssues?.items.forEach((item) => {
      const name = item.salesRepName?.trim();
      if (name) {
        names.add(name);
      }
    });

    const items = [...names].sort((left, right) =>
      left.localeCompare(right, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );

    if (
      selectedIssueSalesRep !== ALL_SALES_REP_FILTER &&
      selectedIssueSalesRep !== UNASSIGNED_SALES_REP_FILTER &&
      !items.some(
        (item) => normalizeOptionComparable(item) === normalizeOptionComparable(selectedIssueSalesRep),
      )
    ) {
      items.unshift(selectedIssueSalesRep);
    }

    return items;
  }, [cachedRows, displayedIssues?.items, leaderboardRows, selectedIssueSalesRep]);

  function getIssueFixKey(item: DataQualityIssueRow): string {
    return makeReviewedItemKey(selectedMetric, selectedBasis, item);
  }

  function resolveAccountIdentifier(item: DataQualityIssueRow): string {
    return (
      item.accountRecordId?.trim() ||
      item.accountKey.trim() ||
      item.businessAccountId.trim()
    );
  }

  function updateRowFixDraft(
    key: string,
    updater: (current: RowFixDraft) => RowFixDraft,
    seed: RowFixDraft,
  ) {
    setRowFixDrafts((current) => {
      const base = current[key] ?? seed;
      return {
        ...current,
        [key]: updater(base),
      };
    });
  }

  function getRowFixDraft(item: DataQualityIssueRow): RowFixDraft {
    const key = getIssueFixKey(item);
    const existing = rowFixDrafts[key];
    if (existing) {
      return existing;
    }

    const matchedSalesRep =
      salesRepOptions.find(
        (option) => normalizeOptionComparable(option.name) === normalizeOptionComparable(item.salesRepName ?? ""),
      ) ?? null;

    const rawPhone = item.rawContactPhone ?? item.contactPhone ?? "";
    const parsedPhone = parsePhoneWithExtension(rawPhone);
    const seededPhone =
      parsedPhone.kind === "phone_with_extension"
        ? parsedPhone.phone
        : item.contactPhone ?? rawPhone;
    const seededExtension =
      parsedPhone.kind === "phone_with_extension"
        ? parsedPhone.extension
        : item.contactExtension ?? "";

    return {
      companyName: item.companyName || "",
      salesRepId: matchedSalesRep?.id ?? "",
      category: normalizeOptionValue(CATEGORY_OPTIONS, item.category),
      companyRegion: normalizeOptionValue(COMPANY_REGION_OPTIONS, item.companyRegion),
      subCategory: normalizeOptionValue(SUB_CATEGORY_OPTIONS, item.subCategory),
      industryType: normalizeOptionValue(INDUSTRY_TYPE_OPTIONS, item.industryType),
      primaryContactPhone: seededPhone ?? "",
      primaryContactExtension: seededExtension,
      primaryContactEmail: item.contactEmail ?? "",
    };
  }

  useEffect(() => {
    function hydrateFromCache() {
      const rows = readCachedRows();
      setCachedRows(rows);
    }

    function hydrateReviewedState() {
      const parsed = parseReviewedIssueState(
        window.localStorage.getItem(REVIEWED_ISSUES_STORAGE_KEY),
      );
      setReviewedItemKeys(parsed.itemKeys);
      setReviewedGroupKeys(parsed.groupKeys);
    }

    hydrateFromCache();
    hydrateReviewedState();

    function onStorage(event: StorageEvent) {
      if (event.key === REVIEWED_ISSUES_STORAGE_KEY) {
        hydrateReviewedState();
        return;
      }

      if (!event.key || !DATASET_STORAGE_KEYS.includes(event.key as (typeof DATASET_STORAGE_KEYS)[number])) {
        if (event.key !== "businessAccounts.syncMeta.v1") {
          return;
        }
      }
      hydrateFromCache();
    }

    function onDatasetUpdated() {
      hydrateFromCache();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(
      "businessAccounts:dataset-updated",
      onDatasetUpdated as EventListener,
    );

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "businessAccounts:dataset-updated",
        onDatasetUpdated as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    async function fetchSession() {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const payload = await readJsonResponse<SessionResponse | { error?: string }>(response);

      if (payload && "authenticated" in payload) {
        if (payload.authenticated) {
          setSession(payload);
          setSessionWarning(null);
          return;
        }

        setSession(payload);
        setSessionWarning(
          "Your Acumatica session has expired. Sign in again to refresh quality data.",
        );
        return;
      }

      setSession({ authenticated: true, user: null });
      setSessionWarning(
        "Acumatica session validation is temporarily unavailable. You can still use cached data and retry refresh.",
      );
    }

    fetchSession().catch(() => {
      setSession({ authenticated: true, user: null });
      setSessionWarning(
        "Acumatica session validation is temporarily unavailable. You can still use cached data and retry refresh.",
      );
    });
  }, [router]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    let cancelled = false;

    async function fetchEmployeesForFixes() {
      setIsLoadingEmployees(true);
      try {
        const response = await fetch("/api/employees", { cache: "no-store" });
        const payload = await readJsonResponse<EmployeeLookupResponse | { error?: string }>(
          response,
        );

        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        if (!isEmployeeLookupResponse(payload)) {
          throw new Error("Unexpected employee list response.");
        }

        if (cancelled) {
          return;
        }

        setEmployeeOptions(payload.items);
      } catch {
        if (cancelled) {
          return;
        }

        const fallbackById = new Map<string, EmployeeOption>();
        cachedRows.forEach((row) => {
          const id = row.salesRepId?.trim() ?? "";
          const name = row.salesRepName?.trim() ?? "";
          if (!id || !name) {
            return;
          }

          if (!fallbackById.has(id)) {
            fallbackById.set(id, { id, name });
          }
        });
        setEmployeeOptions([...fallbackById.values()]);
      } finally {
        if (!cancelled) {
          setIsLoadingEmployees(false);
        }
      }
    }

    void fetchEmployeesForFixes();

    return () => {
      cancelled = true;
    };
  }, [cachedRows, session]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    let cancelled = false;

    async function fetchLiveDashboard(forceRefresh: boolean) {
      setIsRefreshingSummary(true);
      if (forceRefresh) {
        setSummaryError(null);
      }

      try {
        const params = new URLSearchParams();
        params.set("basis", selectedBasis);
        if (forceRefresh) {
          params.set("refresh", "1");
        }

        const query = params.toString();
        const summaryResponse = await fetch(`/api/data-quality/summary?${query}`, {
          cache: "no-store",
        });
        const summaryPayload = await readJsonResponse<
          DataQualityExpandedSummaryResponse | { error?: string }
        >(summaryResponse);

        if (!summaryResponse.ok) {
          throw new Error(parseError(summaryPayload));
        }
        if (!isDataQualityExpandedSummaryResponse(summaryPayload)) {
          throw new Error("Unexpected response while loading data quality summary.");
        }

        if (cancelled) {
          return;
        }
        setLiveSummary(summaryPayload);
        setSummaryError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSummaryError(parseRequestError(error, "Failed to load live data quality."));
      } finally {
        if (!cancelled) {
          setIsRefreshingSummary(false);
        }
      }
    }

    void fetchLiveDashboard(false);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void fetchLiveDashboard(false);
    }, LIVE_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedBasis, session]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    if (activeView === "issues") {
      return;
    }

    if (activeView === "trends" && loadedViews.trends) {
      return;
    }

    if (activeView === "ownership" && loadedViews.ownership) {
      return;
    }

    let cancelled = false;
    const query = new URLSearchParams({
      basis: selectedBasis,
    }).toString();

    if (activeView === "trends") {
      void loadTrendsAnalytics(query, {
        cancelled: () => cancelled,
        errorTarget: "summary",
      });
    } else {
      void loadOwnershipAnalytics(query, {
        cancelled: () => cancelled,
        errorTarget: "summary",
      });
    }

    return () => {
      cancelled = true;
    };
  }, [activeView, loadedViews.ownership, loadedViews.trends, selectedBasis, session]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const controller = new AbortController();
    setIsLoadingIssues(true);

    async function fetchIssues() {
      const requestId = ++issuesRequestSequenceRef.current;

      try {
        const params = new URLSearchParams({
          metric: selectedMetric,
          basis: selectedBasis,
          page: String(issuesPage),
          pageSize: String(issuesPageSize),
          refresh: "1",
        });
        if (selectedIssueSalesRep !== ALL_SALES_REP_FILTER) {
          params.set("salesRep", selectedIssueSalesRep);
        }
        const response = await fetch(`/api/data-quality/issues?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<DataQualityIssuesResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isDataQualityIssuesResponse(payload)) {
          throw new Error("Unexpected response while loading issue drilldown.");
        }
        if (controller.signal.aborted || requestId !== issuesRequestSequenceRef.current) {
          return;
        }
        setLiveIssues(payload);
        setLiveIssuesKey(currentIssuesKey);
        setIssuesError(null);
      } catch (error) {
        if (controller.signal.aborted || requestId !== issuesRequestSequenceRef.current) {
          return;
        }
        setIssuesError(error instanceof Error ? error.message : "Failed to load live issue details.");
      } finally {
        if (!controller.signal.aborted && requestId === issuesRequestSequenceRef.current) {
          setIsLoadingIssues(false);
        }
      }
    }

    void fetchIssues();

    return () => {
      controller.abort();
    };
  }, [
    currentIssuesKey,
    issuesPage,
    issuesPageSize,
    liveSummaryComputedAtIso,
    selectedBasis,
    selectedMetric,
    selectedIssueSalesRep,
    session,
  ]);

  useEffect(() => {
    if (!isDuplicateMetric(selectedMetric) || selectedBasis === "row") {
      return;
    }

    setSelectedBasis("row");
    setIssuesPage(1);
  }, [selectedBasis, selectedMetric]);

  useEffect(() => {
    setIssuesPage(1);
  }, [selectedIssueSalesRep]);

  useEffect(() => {
    setLiveSummary(null);
    setLiveTrends(null);
    setLiveThroughput(null);
    setLiveLeaderboard(null);
    setLiveContributors(null);
    setLiveIssues(null);
    setLiveIssuesKey(null);
    setLoadedViews({
      issues: true,
      trends: false,
      ownership: false,
    });
    setIssuesPage(1);
  }, [selectedBasis]);

  const refreshFromBusinessAccountLive = useEffectEvent(() => {
    if (!session?.authenticated) {
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      liveRefreshPendingWhileHiddenRef.current = true;
      return;
    }

    if (liveRefreshTimerRef.current !== null) {
      return;
    }

    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      void handleRefreshNow();
    }, LIVE_EVENT_REFRESH_DEBOUNCE_MS);
  });

  const flushPendingBusinessAccountLiveRefresh = useEffectEvent(() => {
    liveRefreshPendingWhileHiddenRef.current = false;
    if (liveRefreshTimerRef.current !== null) {
      clearTimeout(liveRefreshTimerRef.current);
      liveRefreshTimerRef.current = null;
    }
    void handleRefreshNow();
  });

  const rerunQueuedDataQualityRefresh = useEffectEvent(() => {
    void handleRefreshNow();
  });

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const eventSource = new EventSource("/api/business-accounts/stream");
    const handleChanged = () => {
      refreshFromBusinessAccountLive();
    };

    eventSource.addEventListener("changed", handleChanged as EventListener);

    return () => {
      eventSource.removeEventListener("changed", handleChanged as EventListener);
      eventSource.close();
    };
  }, [refreshFromBusinessAccountLive, session?.authenticated]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !liveRefreshPendingWhileHiddenRef.current) {
        return;
      }

      flushPendingBusinessAccountLiveRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (liveRefreshTimerRef.current !== null) {
        clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
      liveRefreshPendingWhileHiddenRef.current = false;
    };
  }, [flushPendingBusinessAccountLiveRefresh, session?.authenticated]);

  function persistCachedRows(nextRows: BusinessAccountRow[]) {
    setCachedRows(nextRows);

    const payload: CachedDataset = {
      rows: nextRows,
      lastSyncedAt: readCachedLastSyncedAt(),
    };
    writeCachedDatasetToStorage(payload);
  }

  function readRowAccountKey(row: BusinessAccountRow): string {
    return row.accountRecordId?.trim() || row.id.trim() || row.businessAccountId.trim();
  }

  function replaceAccountRowsInCache(
    rows: BusinessAccountRow[],
    nextAccountRows: BusinessAccountRow[],
    fallbackAccountKey: string,
  ): BusinessAccountRow[] {
    const targetAccountKey =
      nextAccountRows[0] ? readRowAccountKey(nextAccountRows[0]) : fallbackAccountKey.trim();
    const nextRows: BusinessAccountRow[] = [];
    let inserted = false;

    rows.forEach((row) => {
      if (readRowAccountKey(row) !== targetAccountKey) {
        nextRows.push(row);
        return;
      }

      if (!inserted) {
        nextRows.push(...nextAccountRows);
        inserted = true;
      }
    });

    if (!inserted) {
      nextRows.push(...nextAccountRows);
    }

    return enforceSinglePrimaryPerAccountRows(nextRows);
  }

  function persistReviewedState(nextItemKeys: string[], nextGroupKeys: string[]) {
    const dedupedItemKeys = [...new Set(nextItemKeys)];
    const dedupedGroupKeys = [...new Set(nextGroupKeys)];
    setReviewedItemKeys(dedupedItemKeys);
    setReviewedGroupKeys(dedupedGroupKeys);

    try {
      const payload: ReviewedIssueState = {
        itemKeys: dedupedItemKeys,
        groupKeys: dedupedGroupKeys,
      };
      window.localStorage.setItem(REVIEWED_ISSUES_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore local storage write failures
    }
  }

  async function syncReviewedStatus(
    issueKeys: string[],
    action: "review" | "unreview" = "review",
    reviewKeys: string[] = [],
  ) {
    const filteredIssueKeys = [...new Set(issueKeys.map((value) => value.trim()).filter(Boolean))];
    const filteredReviewKeys = [...new Set(reviewKeys.map((value) => value.trim()).filter(Boolean))];
    if (!filteredIssueKeys.length && !filteredReviewKeys.length) {
      return;
    }

    const response = await fetch("/api/data-quality/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        issueKeys: filteredIssueKeys,
        reviewKeys: filteredReviewKeys,
      }),
    });
    const payload = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(parseError(payload));
    }
  }

  async function recordFixedIssues(issueKeys: string[]) {
    const filtered = [...new Set(issueKeys.map((value) => value.trim()).filter(Boolean))];
    if (!filtered.length) {
      return;
    }

    const response = await fetch("/api/data-quality/fixes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        issueKeys: filtered,
      }),
    });
    const payload = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(parseError(payload));
    }
  }

  async function handleMarkIssueReviewed(item: DataQualityIssueRow) {
    const reviewedKey = makeReviewedItemKey(selectedMetric, selectedBasis, item);
    if (reviewedItemKeySet.has(reviewedKey)) {
      return;
    }

    const issueKey =
      item.issueKey ??
      buildDataQualityIssueKey(selectedMetric, selectedBasis, item);

    try {
      await syncReviewedStatus([issueKey], "review", [reviewedKey]);
      persistReviewedState([...reviewedItemKeys, reviewedKey], reviewedGroupKeys);
      setIssuesPage(1);
      await handleRefreshNow();
    } catch (error) {
      setIssuesError(
        error instanceof Error ? error.message : "Failed to mark issue as reviewed.",
      );
    }
  }

  async function handleMarkGroupReviewed(groupKey: string, rows: DataQualityIssueRow[]) {
    const reviewedKey = makeReviewedGroupKey(selectedMetric, selectedBasis, groupKey);
    if (reviewedGroupKeySet.has(reviewedKey)) {
      return;
    }

    const issueKeys = rows
      .map((item) => item.issueKey ?? buildDataQualityIssueKey(selectedMetric, selectedBasis, item))
      .filter((value): value is string => Boolean(value && value.trim()));

    try {
      await syncReviewedStatus(issueKeys, "review", [reviewedKey]);
      persistReviewedState(reviewedItemKeys, [...reviewedGroupKeys, reviewedKey]);
      setIssuesPage(1);
      await handleRefreshNow();
    } catch (error) {
      setIssuesError(
        error instanceof Error
          ? error.message
          : "Failed to mark duplicate group as reviewed.",
      );
    }
  }

  function buildUpdatePayloadFromRow(
    sourceRow: BusinessAccountRow,
    overrides: Partial<BusinessAccountUpdateRequest>,
  ): BusinessAccountUpdateRequest {
    return {
      companyName: sourceRow.companyName,
      assignedBusinessAccountRecordId:
        sourceRow.businessAccountId.trim().length > 0
          ? (sourceRow.accountRecordId ?? sourceRow.id)
          : null,
      assignedBusinessAccountId: sourceRow.businessAccountId.trim() || null,
      addressLine1: sourceRow.addressLine1,
      addressLine2: sourceRow.addressLine2,
      city: sourceRow.city,
      state: sourceRow.state,
      postalCode: sourceRow.postalCode,
      country: sourceRow.country,
      targetContactId: sourceRow.contactId ?? sourceRow.primaryContactId ?? null,
      setAsPrimaryContact: false,
      primaryOnlyIntent: false,
      contactOnlyIntent: false,
      salesRepId: sourceRow.salesRepId ?? null,
      salesRepName: sourceRow.salesRepName ?? null,
      industryType: sourceRow.industryType ?? null,
      subCategory: sourceRow.subCategory ?? null,
      companyRegion: sourceRow.companyRegion ?? null,
      week: sourceRow.week ?? null,
      companyPhone: sourceRow.companyPhone ?? null,
      primaryContactName: sourceRow.primaryContactName ?? null,
      primaryContactPhone: sourceRow.primaryContactPhone ?? null,
      primaryContactExtension: sourceRow.primaryContactExtension ?? null,
      primaryContactEmail: sourceRow.primaryContactEmail ?? null,
      category: sourceRow.category ?? null,
      notes: sourceRow.notes ?? null,
      expectedLastModified: sourceRow.lastModifiedIso ?? null,
      baseSnapshot: buildBusinessAccountConcurrencySnapshot(sourceRow),
      ...overrides,
    };
  }

  function mergeUpdatedRowIntoCache(
    rows: BusinessAccountRow[],
    updatedRow: BusinessAccountRow,
  ): BusinessAccountRow[] {
    const updatedAccountKey =
      updatedRow.accountRecordId?.trim() ||
      updatedRow.id.trim() ||
      updatedRow.businessAccountId.trim();
    const updatedContactId = updatedRow.contactId ?? null;

    const nextRows = rows.map((row) => {
      const rowAccountKey =
        row.accountRecordId?.trim() || row.id.trim() || row.businessAccountId.trim();
      if (rowAccountKey !== updatedAccountKey) {
        return row;
      }

      const next: BusinessAccountRow = {
        ...row,
        companyName: updatedRow.companyName,
        salesRepId: updatedRow.salesRepId ?? null,
        salesRepName: updatedRow.salesRepName ?? null,
        industryType: updatedRow.industryType ?? null,
        subCategory: updatedRow.subCategory ?? null,
        companyRegion: updatedRow.companyRegion ?? null,
        week: updatedRow.week ?? null,
        category: updatedRow.category ?? null,
        lastModifiedIso: updatedRow.lastModifiedIso ?? row.lastModifiedIso ?? null,
      };

      if (updatedContactId !== null && row.contactId === updatedContactId) {
        return {
          ...next,
          primaryContactName: updatedRow.primaryContactName ?? row.primaryContactName,
          primaryContactPhone: updatedRow.primaryContactPhone ?? row.primaryContactPhone,
          primaryContactExtension:
            updatedRow.primaryContactExtension ?? row.primaryContactExtension ?? null,
          primaryContactRawPhone:
            updatedRow.primaryContactRawPhone ??
            updatedRow.primaryContactPhone ??
            row.primaryContactRawPhone ??
            row.primaryContactPhone,
          primaryContactEmail: updatedRow.primaryContactEmail ?? row.primaryContactEmail,
          notes: updatedRow.notes ?? row.notes,
          isPrimaryContact: updatedRow.isPrimaryContact ?? row.isPrimaryContact,
          primaryContactId: updatedRow.primaryContactId ?? row.primaryContactId,
        };
      }

      if (updatedRow.primaryContactId !== null && row.contactId === updatedRow.primaryContactId) {
        return {
          ...next,
          isPrimaryContact: true,
        };
      }

      return next;
    });

    return enforceSinglePrimaryPerAccountRows(nextRows);
  }

  async function fetchIssueAccountRow(item: DataQualityIssueRow): Promise<BusinessAccountRow> {
    const identifier = resolveAccountIdentifier(item);
    if (!identifier) {
      throw new Error("Missing account identifier.");
    }

    const detailUrl = new URL(
      `/api/business-accounts/${encodeURIComponent(identifier)}`,
      window.location.origin,
    );
    if (item.contactId !== null) {
      detailUrl.searchParams.set("contactId", String(item.contactId));
    }

    const response = await fetch(
      `${detailUrl.pathname}${detailUrl.search}`,
      { cache: "no-store" },
    );
    const payload = await readJsonResponse<
      BusinessAccountDetailResponse | { row?: BusinessAccountRow; error?: string }
    >(response);

    if (!response.ok) {
      throw new Error(parseError(payload));
    }

    const row = payload && "row" in payload ? payload.row : null;
    if (!row || !isBusinessAccountRow(row)) {
      throw new Error("Unable to load latest account details for update.");
    }

    return row;
  }

  function getSaveButtonLabel(metric: DataQualityMetricKey): string {
    switch (metric) {
      case "invalidPhone":
        return "Save phone";
      case "missingContactEmail":
        return "Save email";
      case "missingSalesRep":
        return "Save sales rep";
      case "missingCategory":
        return "Save category";
      case "missingRegion":
        return "Save region";
      case "missingSubCategory":
        return "Save sub-category";
      case "missingIndustry":
        return "Save industry";
      case "missingCompany":
      case "duplicateBusinessAccount":
        return "Save company";
      default:
        return "Save changes";
    }
  }

  async function handleSaveIssueFix(item: DataQualityIssueRow) {
    const fixKey = getIssueFixKey(item);
    if (savingFixKeys[fixKey]) {
      return;
    }

      const draft = getRowFixDraft(item);
      const metric = selectedMetric;
      const payloadOverrides: Partial<BusinessAccountUpdateRequest> = {};

    if (metric === "missingSalesRep") {
      const selectedEmployee = salesRepOptions.find(
        (option) => option.id === draft.salesRepId,
      );
      if (!selectedEmployee) {
        setIssuesError("Select a valid sales rep before saving.");
        return;
      }

      payloadOverrides.salesRepId = selectedEmployee.id;
      payloadOverrides.salesRepName = selectedEmployee.name;
    } else if (metric === "missingCategory") {
      payloadOverrides.category = (draft.category || null) as Category | null;
    } else if (metric === "missingRegion") {
      payloadOverrides.companyRegion = draft.companyRegion || null;
    } else if (metric === "missingSubCategory") {
      payloadOverrides.subCategory = draft.subCategory || null;
    } else if (metric === "missingIndustry") {
      payloadOverrides.industryType = draft.industryType || null;
    } else if (metric === "invalidPhone") {
      if (item.contactId === null || item.businessAccountId.trim().length === 0) {
        setIssuesError("This phone number must be fixed from the contact record in Acumatica.");
        return;
      }

      payloadOverrides.contactOnlyIntent = true;

      const trimmedPhone = draft.primaryContactPhone.trim();
      const trimmedExtension = draft.primaryContactExtension.trim();
      if (trimmedPhone.length === 0) {
        payloadOverrides.primaryContactPhone = null;
        payloadOverrides.primaryContactExtension = null;
      } else {
        const normalizedPhone = normalizePhoneForSave(trimmedPhone);
        if (normalizedPhone === null) {
          setIssuesError("Phone number must use the format ###-###-####.");
          return;
        }
        if (normalizedPhone.startsWith("111-")) {
          setIssuesError("Phone numbers starting with 111 are not allowed.");
          return;
        }
        payloadOverrides.primaryContactPhone = normalizedPhone;

        if (!trimmedExtension) {
          payloadOverrides.primaryContactExtension = null;
        } else {
          const normalizedExtension = normalizeExtensionForSave(trimmedExtension);
          if (!normalizedExtension || normalizedExtension.length > 5) {
            setIssuesError("Extension must use 1 to 5 digits.");
            return;
          }
          payloadOverrides.primaryContactExtension = normalizedExtension;
        }
      }
    } else if (metric === "missingContactEmail") {
      if (item.contactId === null || item.businessAccountId.trim().length === 0) {
        setIssuesError("This email must be fixed from the contact record in Acumatica.");
        return;
      }

      payloadOverrides.contactOnlyIntent = true;

      const email = draft.primaryContactEmail.trim();
      if (!email) {
        setIssuesError("Email address is required.");
        return;
      }
      payloadOverrides.primaryContactEmail = email;
    } else if (metric === "missingCompany" || metric === "duplicateBusinessAccount") {
      const companyName = draft.companyName.trim();
      if (companyName.length <= 2) {
        setIssuesError("Company name must be longer than 2 characters.");
        return;
      }
      payloadOverrides.companyName = companyName;
    } else {
      return;
    }

    setSavingFixKeys((current) => ({
      ...current,
      [fixKey]: true,
    }));

    try {
      const identifier = resolveAccountIdentifier(item);
      const isContactOnlyMetric =
        metric === "invalidPhone" || metric === "missingContactEmail";
      const updatePayload = isContactOnlyMetric
        ? {
            targetContactId: item.contactId,
            contactOnlyIntent: true,
            ...(Object.prototype.hasOwnProperty.call(payloadOverrides, "primaryContactPhone")
              ? { primaryContactPhone: payloadOverrides.primaryContactPhone ?? null }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(payloadOverrides, "primaryContactExtension")
              ? { primaryContactExtension: payloadOverrides.primaryContactExtension ?? null }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(payloadOverrides, "primaryContactEmail")
              ? { primaryContactEmail: payloadOverrides.primaryContactEmail ?? null }
              : {}),
          }
        : (() => {
            const latestRowPromise = fetchIssueAccountRow(item);
            return latestRowPromise.then((latestRow) =>
              buildUpdatePayloadFromRow(latestRow, {
                ...payloadOverrides,
                targetContactId:
                  item.contactId ?? latestRow.contactId ?? latestRow.primaryContactId ?? null,
              }),
            );
          })();

      const response = await fetch(
        `/api/business-accounts/${encodeURIComponent(identifier)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(await updatePayload),
        },
      );
      const payload = await readJsonResponse<BusinessAccountRow | { error?: string }>(
        response,
      );

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!isBusinessAccountRow(payload)) {
        throw new Error("Unexpected save response.");
      }

      const mergedRows = mergeUpdatedRowIntoCache(cachedRows, payload);
      persistCachedRows(mergedRows);
      let attributionError: string | null = null;
      try {
        await recordFixedIssues([
          item.issueKey ?? buildDataQualityIssueKey(selectedMetric, selectedBasis, item),
        ]);
      } catch (error) {
        attributionError =
          error instanceof Error ? error.message : "Saved the fix but failed to attribute it.";
      }
      setLiveIssues((current) => {
        if (!current) {
          return current;
        }

        const issueKeyToRemove =
          item.issueKey ?? buildDataQualityIssueKey(selectedMetric, selectedBasis, item);
        const nextItems = current.items.filter((entry) => {
          const entryIssueKey =
            entry.issueKey ?? buildDataQualityIssueKey(selectedMetric, selectedBasis, entry);
          return entryIssueKey !== issueKeyToRemove;
        });
        const removedCount = current.items.length - nextItems.length;

        if (removedCount === 0) {
          return current;
        }

        return {
          ...current,
          items: nextItems,
          total: Math.max(0, current.total - removedCount),
        };
      });
      setIssuesError(attributionError);
      void handleRefreshNow();
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : "Failed to save issue fix.");
    } finally {
      setSavingFixKeys((current) => {
        const next = { ...current };
        delete next[fixKey];
        return next;
      });
    }
  }

  async function handleDeleteContact(row: DataQualityIssueRow) {
    if (row.contactId === null) {
      return;
    }
    setDeleteQueueRow(row);
  }

  function handleContactCreated(
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) {
    const activeIssue = createContactIssue;
    const fallbackAccountKey = activeIssue?.accountRecordId ?? activeIssue?.accountKey ?? "";

    if (result.accountRows.length > 0) {
      const nextRows = replaceAccountRowsInCache(cachedRows, result.accountRows, fallbackAccountKey);
      persistCachedRows(nextRows);
    }

    if (result.created === true) {
      setMergeSuccessMessage("Primary contact created.");
      setIssuesError(null);
    }

    void (async () => {
      try {
        if (activeIssue && result.created === true) {
          await recordFixedIssues([
            activeIssue.issueKey ??
              buildDataQualityIssueKey("missingContact", selectedBasis, activeIssue),
          ]);
        }
      } catch (error) {
        setIssuesError(
          error instanceof Error
            ? error.message
            : "Contact was created but fix history failed.",
        );
      }

      await handleRefreshNow();
    })();
  }

  async function handleConfirmDeleteContact(reason: string) {
    if (!deleteQueueRow?.contactId) {
      return;
    }

    const row = deleteQueueRow;
    const contactId = deleteQueueRow.contactId;

    setDeletingContactIds((current) => ({
      ...current,
      [contactId]: true,
    }));

    try {
      const response = await fetch(`/api/contacts/${contactId}?source=quality`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      const nextRows = cachedRows.filter((cachedRow) => cachedRow.contactId !== contactId);
      persistCachedRows(nextRows);
      let attributionError: string | null = null;
      try {
        await recordFixedIssues([
          row.issueKey ?? buildDataQualityIssueKey(selectedMetric, selectedBasis, row),
        ]);
      } catch (error) {
        attributionError =
          error instanceof Error
            ? error.message
            : "Queued the contact deletion but failed to attribute it.";
      }

      setLiveIssues((current) => {
        if (!current) {
          return current;
        }
        const nextItems = current.items.filter((item) => item.contactId !== contactId);
        const removedCount = current.items.length - nextItems.length;
        return {
          ...current,
          items: nextItems,
          total: Math.max(0, current.total - removedCount),
        };
      });

      setIssuesError(attributionError);
      setMergeSuccessMessage(null);
      setLiveContributors(null);
      setDeleteQueueRow(null);
      void handleRefreshNow();
    } catch (error) {
      setIssuesError(
        error instanceof Error ? error.message : "Failed to queue contact deletion.",
      );
    } finally {
      setDeletingContactIds((current) => {
        const next = { ...current };
        delete next[contactId];
        return next;
      });
    }
  }

  async function handleRefreshNow() {
    if (!session?.authenticated) {
      return;
    }

    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;

    let issuesRequestId: number | null = null;
    setIsRefreshingSummary(true);
    if (activeView === "issues") {
      setIsLoadingIssues(true);
    }
    setSummaryError(null);
    setIssuesError(null);

    try {
      const refreshedSummaryParams = new URLSearchParams({
        basis: selectedBasis,
        refresh: "1",
      });
      const refreshedSummaryQuery = refreshedSummaryParams.toString();
      const sharedSnapshotQuery = new URLSearchParams({
        basis: selectedBasis,
      }).toString();
      const summaryResponse = await fetch(`/api/data-quality/summary?${refreshedSummaryQuery}`, {
        cache: "no-store",
      });
      const summaryPayload = await readJsonResponse<
        DataQualityExpandedSummaryResponse | { error?: string }
      >(summaryResponse);

      if (!summaryResponse.ok) {
        throw new Error(parseError(summaryPayload));
      }
      if (!isDataQualityExpandedSummaryResponse(summaryPayload)) {
        throw new Error("Unexpected response while refreshing data quality summary.");
      }

      setLiveSummary(summaryPayload);
      setSummaryError(null);

      if (activeView === "issues") {
        issuesRequestId = ++issuesRequestSequenceRef.current;
        setLoadedViews({
          issues: true,
          trends: false,
          ownership: false,
        });
        const issuesParams = new URLSearchParams({
          metric: selectedMetric,
          basis: selectedBasis,
          page: String(issuesPage),
          pageSize: String(issuesPageSize),
          refresh: "1",
        });
        if (selectedIssueSalesRep !== ALL_SALES_REP_FILTER) {
          issuesParams.set("salesRep", selectedIssueSalesRep);
        }
        const issuesResponse = await fetch(`/api/data-quality/issues?${issuesParams.toString()}`, {
          cache: "no-store",
        });
        const issuesPayload = await readJsonResponse<DataQualityIssuesResponse | { error?: string }>(
          issuesResponse,
        );
        if (!issuesResponse.ok) {
          throw new Error(parseError(issuesPayload));
        }
        if (!isDataQualityIssuesResponse(issuesPayload)) {
          throw new Error("Unexpected response while refreshing issue drilldown.");
        }
        if (issuesRequestId === issuesRequestSequenceRef.current) {
          setLiveIssues(issuesPayload);
          setLiveIssuesKey(currentIssuesKey);
        }
      } else if (activeView === "trends") {
        setLoadedViews({
          issues: true,
          trends: false,
          ownership: false,
        });
        await loadTrendsAnalytics(sharedSnapshotQuery, {
          errorTarget: "summary",
        });
      } else {
        setLoadedViews({
          issues: true,
          trends: false,
          ownership: false,
        });
        await loadOwnershipAnalytics(sharedSnapshotQuery, {
          errorTarget: "summary",
        });
      }
    } catch (error) {
      const message = parseRequestError(error, "Refresh failed.");
      setSummaryError(message);
      setIssuesError(message);
    } finally {
      setIsRefreshingSummary(false);
      if (activeView === "issues") {
        if (
          issuesRequestId === null ||
          issuesRequestId === issuesRequestSequenceRef.current
        ) {
          setIsLoadingIssues(false);
        }
      }
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        window.setTimeout(() => {
          rerunQueuedDataQualityRefresh();
        }, 0);
      }
    }
  }

  function handleMergeCompleted(result: ContactMergeResponse) {
    const activeMergeGroup = mergeGroup;
    const reviewedGroupKey = activeMergeGroup
      ? makeReviewedGroupKey(selectedMetric, selectedBasis, activeMergeGroup.key)
      : null;
    const accountKey =
      activeMergeGroup?.items[0]?.accountRecordId ??
      activeMergeGroup?.items[0]?.accountKey ??
      result.businessAccountRecordId;
    const nextRows = replaceAccountRowsInCache(
      cachedRows,
      result.accountRows,
      accountKey,
    );
    const keptContactName =
      activeMergeGroup?.items.find((item) => item.contactId === result.keptContactId)?.contactName ??
      result.updatedRow.primaryContactName ??
      "Kept contact";
    const deletedContacts = activeMergeGroup
      ? activeMergeGroup.items.filter((item) =>
          result.deletedContactIds.includes(item.contactId ?? Number.NaN),
        )
      : [];
    const issueKeys = activeMergeGroup
      ? activeMergeGroup.items
          .map((item) => item.issueKey ?? buildDataQualityIssueKey(selectedMetric, selectedBasis, item))
          .filter((value): value is string => Boolean(value && value.trim()))
      : [];
    const reviewedItemKeysForMerge = activeMergeGroup
      ? activeMergeGroup.items.map((item) => makeReviewedItemKey(selectedMetric, selectedBasis, item))
      : [];

    persistCachedRows(nextRows);
    if (reviewedGroupKey) {
      persistReviewedState(reviewedItemKeys, [...reviewedGroupKeys, reviewedGroupKey]);
    } else if (reviewedItemKeysForMerge.length) {
      persistReviewedState([...reviewedItemKeys, ...reviewedItemKeysForMerge], reviewedGroupKeys);
    }
    setLiveSummary(null);
    setLiveContributors(null);
    setLiveIssues(null);
    setLiveIssuesKey(null);
    setIssuesError(null);
    const deletedCount = deletedContacts.length || result.deletedContactIds.length;
    const deletedDetail =
      deletedContacts.length === 1 ? ` (${renderText(deletedContacts[0]?.contactName)})` : "";
    const deletedVerb = deletedCount === 1 ? "was" : "were";

    setMergeSuccessMessage(
      "queued" in result
        ? `${renderText(keptContactName)} was kept locally and ${deletedCount} contact${
            deletedCount === 1 ? "" : "s"
          }${deletedDetail} ${deletedVerb} hidden until the queued merge runs${
            result.setKeptAsPrimary ? ". Primary contact will update when it executes." : "."
          }`
        : `${renderText(keptContactName)} was kept and ${deletedCount} contact${
            deletedCount === 1 ? "" : "s"
          }${deletedDetail} ${deletedVerb} deleted${
            result.setKeptAsPrimary ? ". Primary contact updated." : "."
          }`,
    );
    setMergeGroup(null);
    void (async () => {
      if (issueKeys.length) {
        try {
          await syncReviewedStatus(
            issueKeys,
            "review",
            reviewedGroupKey
              ? [reviewedGroupKey]
              : reviewedItemKeysForMerge,
          );
        } catch (error) {
          setIssuesError(
            error instanceof Error
              ? error.message
              : "Merged the duplicate contact, but failed to update review status.",
          );
        }
      }

      try {
        await recordFixedIssues(issueKeys);
      } catch (error) {
        setIssuesError(error instanceof Error ? error.message : "Failed to attribute fix history.");
      }
      await handleRefreshNow();
    })();
  }

  const summaryIssuesTotal =
    selectedIssueSalesRep === ALL_SALES_REP_FILTER && selectedMetricStats
      ? selectedBasis === "account"
        ? selectedMetricStats.missingAccounts
        : selectedMetricStats.missingRows
      : 0;
  const derivedIssuesTotal =
    summaryIssuesTotal > 0
      ? Math.max(
          summaryIssuesTotal,
          displayedIssues?.total ?? 0,
        )
      : displayedIssues
        ? Math.max(
            displayedIssues.items.length,
            displayedIssues.total,
          )
        : 0;
  const issuesTotalPages = Math.max(1, Math.ceil(derivedIssuesTotal / issuesPageSize));

  useEffect(() => {
    if (issuesPage <= issuesTotalPages) {
      return;
    }

    setIssuesPage(issuesTotalPages);
  }, [issuesPage, issuesTotalPages]);

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      headerActions={
        <button
          className={styles.secondaryButton}
          disabled={isRefreshingSummary}
          onClick={handleRefreshNow}
          type="button"
        >
          {isRefreshingSummary ? "Refreshing..." : "Refresh now"}
        </button>
      }
      subtitle="Fast cached snapshot + live Acumatica verification for missing fields, duplicates, and sales rep coverage."
      title="Data Quality Check"
      userName={session?.user?.name ?? "Signed in"}
    >

      {sessionWarning ? <p className={styles.warning}>{sessionWarning}</p> : null}
      {summaryError ? <p className={styles.warning}>{summaryError}</p> : null}
      {issuesError ? <p className={styles.warning}>{issuesError}</p> : null}
      {mergeSuccessMessage ? <p className={styles.success}>{mergeSuccessMessage}</p> : null}

      <section className={styles.statusBar}>
        <span className={styles.stateTag}>{activeSummary ? "SQLite snapshot" : "Loading snapshot"}</span>
        <span>Last computed: {formatDateTime(activeSummary?.computedAtIso)}</span>
        <span>Rows cached: {cachedRows.length.toLocaleString()}</span>
      </section>

      <nav aria-label="Dashboard sections" className={styles.pageTabs}>
        {DASHBOARD_VIEWS.map((view) => (
          <button
            className={`${styles.pageTab} ${activeView === view.key ? styles.pageTabActive : ""}`}
            key={view.key}
            onClick={() => {
              setActiveView(view.key);
            }}
            type="button"
          >
            {view.label}
          </button>
        ))}
      </nav>

      <section className={styles.summaryGrid}>
        <article className={styles.scoreCard}>
          <h2>Overall Progress</h2>
          <div
            className={styles.scoreRing}
            style={
              {
                "--score-deg": `${completionDegrees}deg`,
              } as CSSProperties
            }
          >
            <div className={styles.scoreInner}>{formatPercent(percentComplete)}</div>
          </div>
          <div className={styles.kpiGrid}>
            <div className={styles.kpiTile}>
              <small>Open Issue Instances</small>
              <strong>{openIssues.toLocaleString()}</strong>
            </div>
            <div className={styles.kpiTile}>
              <small>Affected Records</small>
              <strong>{affectedRecords.toLocaleString()}</strong>
            </div>
            <div className={styles.kpiTile}>
              <small>Total Records</small>
              <strong>{totalChecked.toLocaleString()}</strong>
            </div>
            <div className={styles.kpiTile}>
              <small>% Complete</small>
              <strong>{formatPercent(percentComplete)}</strong>
            </div>
          </div>
          <p className={styles.kpiFootnote}>
            Clean records: {cleanRecords.toLocaleString()} • Reviewed exceptions:{" "}
            {reviewedExceptions.toLocaleString()} • Basis: {selectedBasis}
          </p>
        </article>

        <article className={styles.metricsCard}>
          <div className={styles.metricsHeader}>
            <div className={styles.metricsIntro}>
              <h2>Quality Metrics</h2>
              <p>Worst metrics surface first. Percent shows the share affected, not completion.</p>
            </div>
            <span className={styles.metricsBasisBadge}>
              {selectedBasis === "account" ? "Account basis" : "Row basis"}
            </span>
          </div>
          <div className={styles.metricGrid}>
            {visibleSortedMetrics.map((metric) => {
              const missing = getMetricMissingCount(metric, selectedBasis);
              const percent = getMetricSeverityPercent(metric, selectedBasis);
              const isSelected = metric.key === selectedMetric;
              const severityTone = getMetricSeverityTone(metric.key, percent);
              const severityLabel = getMetricSeverityLabel(metric.key, percent);
              const severityToneClass =
                severityTone === "calm"
                  ? styles.metricToneCalm
                  : severityTone === "watch"
                    ? styles.metricToneWatch
                    : severityTone === "priority"
                      ? styles.metricTonePriority
                      : styles.metricToneCritical;

              return (
                <button
                  className={`${styles.metricButton} ${isSelected ? styles.metricButtonActive : ""}`}
                  key={metric.key}
                  onClick={() => {
                    setActiveView("issues");
                    setSelectedMetric(metric.key);
                    setIssuesPage(1);
                  }}
                  type="button"
                >
                  <div className={styles.metricButtonTop}>
                    <strong>{metric.label}</strong>
                    <span className={`${styles.metricSeverityBadge} ${severityToneClass}`}>
                      {severityLabel}
                    </span>
                  </div>
                  <div className={styles.metricCountRow}>
                    <span className={styles.metricCount}>{missing.toLocaleString()}</span>
                    <span className={styles.metricUnit}>issues</span>
                  </div>
                  <div className={styles.metricBarTrack}>
                    <div className={styles.metricBarFill} style={{ width: `${Math.min(100, percent)}%` }} />
                  </div>
                  <div className={styles.metricMetaRow}>
                    <span className={styles.metricPercent}>{getMetricAffectedLabel(percent)}</span>
                    <span className={styles.metricsBasisBadge}>
                      {selectedBasis === "account" ? "Account basis" : "Row basis"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </article>
      </section>

      {activeView === "issues" ? (
        <section className={styles.drilldownSection}>
          <div className={styles.drilldownHeader}>
            <div className={styles.sectionIntro}>
              <h2>{selectedMetricLabel}</h2>
              <p className={styles.drilldownMeta}>
                {derivedIssuesTotal.toLocaleString()} issues
                {selectedIssueSalesRepLabel}
              </p>
            </div>
            <div className={styles.basisToggle}>
              {DATA_QUALITY_BASIS_VALUES.map((basis) => (
                <button
                  className={`${styles.basisButton} ${selectedBasis === basis ? styles.basisButtonActive : ""}`}
                  key={basis}
                  onClick={() => {
                    setSelectedBasis(basis);
                    setIssuesPage(1);
                  }}
                  type="button"
                >
                  {basis === "account" ? "Account basis" : "Row basis"}
                </button>
              ))}
            </div>
            <select
              className={styles.metricSelect}
              onChange={(event) => {
                setSelectedIssueSalesRep(event.target.value);
                setIssuesPage(1);
              }}
              value={selectedIssueSalesRep}
            >
              <option value={ALL_SALES_REP_FILTER}>All sales reps</option>
              <option value={UNASSIGNED_SALES_REP_FILTER}>Unassigned</option>
              {issueSalesRepOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {isIssueTableLoading ? (
            <p className={styles.loading}>Loading issue details...</p>
          ) : null}

          {isDuplicateMetric(selectedMetric) ? (
            <div className={styles.duplicateGroups}>
              {isIssueTableLoading ? null : duplicateIssueGroups.length ? (
                duplicateIssueGroups.map((group) => (
                  <section className={styles.duplicateGroup} key={group.key}>
                    <div className={styles.duplicateSummary}>
                      <div className={styles.duplicateSummaryText}>
                        <strong>
                          {selectedMetric === "duplicateBusinessAccount"
                            ? `Possible duplicate business account: ${renderText(group.items[0]?.companyName)}`
                            : `Possible duplicate contact: ${renderText(group.items[0]?.contactName)} (${renderText(
                                group.items[0]?.companyName,
                              )})`}
                        </strong>
                        <span>{group.items.length} records</span>
                      </div>
                      <div className={styles.groupHeaderActions}>
                        {selectedMetric === "duplicateContact" ? (
                          <button
                            className={styles.mergeButton}
                            disabled={
                              group.items.length < 2 ||
                              group.items.some((item) => item.contactId === null)
                            }
                            onClick={() => {
                              setMergeSuccessMessage(null);
                              setMergeGroup(group);
                            }}
                            onFocus={() => {
                              prefetchMergeGroupPreview(group.items);
                            }}
                            onMouseEnter={() => {
                              prefetchMergeGroupPreview(group.items);
                            }}
                            type="button"
                          >
                            Merge contacts
                          </button>
                        ) : null}
                        <button
                          className={styles.reviewButton}
                          onClick={() => {
                            void handleMarkGroupReviewed(group.key, group.items);
                          }}
                          type="button"
                        >
                          Mark as reviewed
                        </button>
                      </div>
                    </div>
                    <div className={styles.duplicateCards}>
                      {group.items.map((item, index) => {
                        const deleting =
                          item.contactId !== null && Boolean(deletingContactIds[item.contactId]);
                        const fixKey = getIssueFixKey(item);
                        const draft = getRowFixDraft(item);
                        const savingFix = Boolean(savingFixKeys[fixKey]);
                        const canEditDuplicateBusiness =
                          selectedMetric === "duplicateBusinessAccount";

                        return (
                          <article
                            className={styles.duplicateCard}
                            key={`${group.key}:${item.rowKey ?? index}`}
                          >
                            <p className={styles.duplicateCardTitle}>
                              {renderRecordLink(
                                item.companyName,
                                buildAcumaticaBusinessAccountUrl(
                                  acumaticaBaseUrl,
                                  item.businessAccountId,
                                  acumaticaCompanyId,
                                ),
                                styles.recordLink,
                              )}
                            </p>
                            <p>
                              {renderRecordLink(
                                getIssueContactLabel(selectedMetric, item),
                                hasUsableContactLabel(item.contactName)
                                  ? buildAcumaticaContactUrl(
                                      acumaticaBaseUrl,
                                      item.contactId,
                                      acumaticaCompanyId,
                                    )
                                  : null,
                                styles.recordLink,
                              )}
                            </p>
                            <p>{renderText(item.contactPhone)}</p>
                            <p>{renderText(item.contactEmail)}</p>
                            <p>{renderText(item.address)}</p>
                            <p>Sales Rep: {renderText(item.salesRepName)}</p>
                            {canEditDuplicateBusiness ? (
                              <div className={styles.inlineFixBlock}>
                                <label className={styles.inlineFixLabel}>Company name</label>
                                <input
                                  className={styles.inlineFixInput}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        companyName: event.target.value,
                                      }),
                                      draft,
                                    );
                                  }}
                                  value={draft.companyName}
                                />
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            <button
                              className={styles.reviewButton}
                              onClick={() => {
                                void handleMarkIssueReviewed(item);
                              }}
                              type="button"
                            >
                              Mark as reviewed
                            </button>
                            {item.contactId !== null ? (
                              <button
                                className={styles.deleteButton}
                                disabled={deleting}
                                onClick={() => {
                                  void handleDeleteContact(item);
                                }}
                                type="button"
                              >
                                {deleting ? "Deleting..." : "Delete contact"}
                              </button>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))
              ) : (
                <p className={styles.emptyRow}>No records for this metric.</p>
              )}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>
                      {selectedMetric === "invalidPhone" ||
                      selectedMetric === "missingContactEmail"
                        ? "Person"
                        : "Record"}
                    </th>
                    {selectedMetric === "invalidPhone" ? null : <th>Context</th>}
                    {selectedMetric === "missingContactEmail" ? <th>Phone</th> : null}
                    <th>{getMetricValueLabel(selectedMetric)}</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isIssueTableLoading ? (
                    <tr>
                      <td
                        className={styles.emptyRow}
                        colSpan={
                          selectedMetric === "missingContactEmail"
                            ? 5
                            : selectedMetric === "invalidPhone"
                              ? 3
                              : 4
                        }
                      >
                        Loading live issue details...
                      </td>
                    </tr>
                  ) : displayedIssues?.items.length ? (
                    displayedIssues.items.map((item, index) => {
                      const deleting =
                        item.contactId !== null && Boolean(deletingContactIds[item.contactId]);
                      const fixKey = getIssueFixKey(item);
                      const draft = getRowFixDraft(item);
                      const savingFix = Boolean(savingFixKeys[fixKey]);
                      const companyRegionOptions = withCurrentOption(
                        COMPANY_REGION_OPTIONS,
                        draft.companyRegion || item.companyRegion,
                      );
                      const subCategoryOptions = withCurrentOption(
                        SUB_CATEGORY_OPTIONS,
                        draft.subCategory || item.subCategory,
                      );
                      const industryTypeOptions = withCurrentOption(
                        INDUSTRY_TYPE_OPTIONS,
                        draft.industryType || item.industryType,
                      );

                      return (
                        <tr key={`${item.accountKey}:${item.rowKey ?? index}`}>
                          <td className={styles.recordCell}>
                            <strong className={styles.rowTitle}>
                              {selectedMetric === "invalidPhone" ||
                              selectedMetric === "missingContactEmail"
                                ? renderRecordLink(
                                    getIssueContactLabel(selectedMetric, item),
                                    hasUsableContactLabel(item.contactName)
                                      ? buildAcumaticaContactUrl(
                                          acumaticaBaseUrl,
                                          item.contactId,
                                          acumaticaCompanyId,
                                        )
                                      : null,
                                    styles.recordLink,
                                  )
                                : renderRecordLink(
                                    item.companyName,
                                    buildAcumaticaBusinessAccountUrl(
                                      acumaticaBaseUrl,
                                      item.businessAccountId,
                                      acumaticaCompanyId,
                                    ),
                                    styles.recordLink,
                                  )}
                            </strong>
                            <div className={styles.rowSubline}>
                              {selectedMetric === "invalidPhone" ||
                              selectedMetric === "missingContactEmail" ? (
                                <span>
                                  {renderRecordLink(
                                    item.companyName,
                                    buildAcumaticaBusinessAccountUrl(
                                      acumaticaBaseUrl,
                                      item.businessAccountId,
                                      acumaticaCompanyId,
                                    ),
                                    styles.recordLink,
                                  )}
                                </span>
                              ) : (
                                <span>
                                  {renderRecordLink(
                                    getIssueContactLabel(selectedMetric, item),
                                    hasUsableContactLabel(item.contactName)
                                      ? buildAcumaticaContactUrl(
                                          acumaticaBaseUrl,
                                          item.contactId,
                                          acumaticaCompanyId,
                                        )
                                      : null,
                                    styles.recordLink,
                                  )}
                                </span>
                              )}
                              {item.isPrimaryContact ? (
                                <span className={styles.primaryBadge}>Primary</span>
                              ) : null}
                            </div>
                          </td>
                          {selectedMetric === "invalidPhone" ? null : (
                            <td>
                              <div className={styles.contextStack}>
                                {getIssueContextLines(item).map((line) => (
                                  <span key={`${item.accountKey}:${item.rowKey ?? index}:${line}`}>
                                    {line}
                                  </span>
                                ))}
                              </div>
                            </td>
                          )}
                          {selectedMetric === "missingContactEmail" ? (
                            <td>
                              <div className={styles.issuePhoneCell}>
                                <span className={styles.valuePill}>{getIssuePhoneDisplay(item)}</span>
                                <CallPhoneButton
                                  context={{
                                    sourcePage: "quality",
                                    linkedBusinessAccountId: item.businessAccountId,
                                    linkedAccountRowKey: item.rowKey,
                                    linkedContactId: item.contactId,
                                    linkedCompanyName: item.companyName,
                                    linkedContactName: item.contactName,
                                  }}
                                  label={`${item.contactName ?? item.companyName ?? "Contact"} phone`}
                                  phone={item.contactPhone}
                                />
                              </div>
                            </td>
                          ) : null}
                          <td>
                            <span className={styles.valuePill}>
                              {getMetricValue(selectedMetric, item)}
                            </span>
                          </td>
                          <td className={styles.issueActionsCell}>
                            {selectedMetric === "missingCompany" ? (
                              <div className={styles.inlineFixBlock}>
                                <input
                                  className={styles.inlineFixInput}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        companyName: event.target.value,
                                      }),
                                      draft,
                                    );
                                  }}
                                  placeholder="Company name"
                                  value={draft.companyName}
                                />
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "missingSalesRep" ? (
                              <div className={styles.inlineFixBlock}>
                                <select
                                  className={styles.inlineFixSelect}
                                  onChange={(event) => {
                                    const selectedId = event.target.value;
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        salesRepId: selectedId,
                                      }),
                                      draft,
                                    );
                                  }}
                                  value={draft.salesRepId}
                                >
                                  <option value="">
                                    {isLoadingEmployees ? "Loading sales reps..." : "Select sales rep"}
                                  </option>
                                  {salesRepOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix || !draft.salesRepId || isLoadingEmployees}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "missingCategory" ? (
                              <div className={styles.inlineFixBlock}>
                                <select
                                  className={styles.inlineFixSelect}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        category: event.target.value,
                                      }),
                                      draft,
                                    );
                                  }}
                                  value={draft.category}
                                >
                                  <option value="">Unassigned</option>
                                  {categoryOptionsForSelect.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "missingRegion" ? (
                              <div className={styles.inlineFixBlock}>
                                <select
                                  className={styles.inlineFixSelect}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        companyRegion: event.target.value,
                                      }),
                                      draft,
                                    );
                                  }}
                                  value={draft.companyRegion}
                                >
                                  <option value="">Unassigned</option>
                                  {companyRegionOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "missingSubCategory" ? (
                              <div className={styles.inlineFixBlock}>
                                <select
                                  className={styles.inlineFixSelect}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        subCategory: event.target.value,
                                      }),
                                      draft,
                                    );
                                  }}
                                  value={draft.subCategory}
                                >
                                  <option value="">Unassigned</option>
                                  {subCategoryOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "missingIndustry" ? (
                              <div className={styles.inlineFixBlock}>
                                <select
                                  className={styles.inlineFixSelect}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        industryType: event.target.value,
                                      }),
                                      draft,
                                    );
                                  }}
                                  value={draft.industryType}
                                >
                                  <option value="">Unassigned</option>
                                  {industryTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "invalidPhone" ? (
                              <div className={styles.inlineFixBlock}>
                                <input
                                  className={styles.inlineFixInput}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        primaryContactPhone: formatPhoneDraftValue(event.target.value),
                                      }),
                                      draft,
                                    );
                                  }}
                                  placeholder="###-###-####"
                                  value={draft.primaryContactPhone}
                                />
                                <input
                                  className={styles.inlineFixInput}
                                  inputMode="numeric"
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        primaryContactExtension: event.target.value.replace(/\D/g, "").slice(0, 5),
                                      }),
                                      draft,
                                    );
                                  }}
                                  placeholder="Extension"
                                  value={draft.primaryContactExtension}
                                />
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={savingFix || item.contactId === null || !item.businessAccountId.trim()}
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "missingContactEmail" ? (
                              <div className={styles.inlineFixBlock}>
                                <input
                                  className={styles.inlineFixInput}
                                  onChange={(event) => {
                                    updateRowFixDraft(
                                      fixKey,
                                      (current) => ({
                                        ...current,
                                        primaryContactEmail: event.target.value,
                                      }),
                                      draft,
                                    );
                                  }}
                                  placeholder="Email address"
                                  type="email"
                                  value={draft.primaryContactEmail}
                                />
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={
                                    savingFix ||
                                    item.contactId === null ||
                                    !item.businessAccountId.trim() ||
                                    !draft.primaryContactEmail.trim()
                                  }
                                  onClick={() => {
                                    void handleSaveIssueFix(item);
                                  }}
                                  type="button"
                                >
                                  {savingFix ? "Saving..." : getSaveButtonLabel(selectedMetric)}
                                </button>
                              </div>
                            ) : null}
                            {selectedMetric === "missingContact" ? (
                              <div className={styles.inlineFixBlock}>
                                <button
                                  className={styles.inlineSaveButton}
                                  disabled={!item.accountRecordId?.trim()}
                                  onClick={() => {
                                    setIssuesError(null);
                                    setMergeSuccessMessage(null);
                                    setCreateContactIssue(item);
                                  }}
                                  type="button"
                                >
                                  Create contact
                                </button>
                              </div>
                            ) : (
                              <button
                                className={styles.reviewButton}
                                onClick={() => {
                                  void handleMarkIssueReviewed(item);
                                }}
                                type="button"
                              >
                                Mark as reviewed
                              </button>
                            )}
                            {item.contactId !== null ? (
                              <button
                                className={styles.deleteButton}
                                disabled={deleting}
                                onClick={() => {
                                  void handleDeleteContact(item);
                                }}
                                type="button"
                              >
                                {deleting ? "Deleting..." : "Delete contact"}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        className={styles.emptyRow}
                        colSpan={
                          selectedMetric === "missingContactEmail"
                            ? 5
                            : selectedMetric === "invalidPhone"
                              ? 3
                              : 4
                        }
                      >
                        No records for this metric.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.pagination}>
            <button
              className={styles.pageButton}
              disabled={issuesPage <= 1}
              onClick={() => setIssuesPage(1)}
              type="button"
            >
              First
            </button>
            <button
              className={styles.pageButton}
              disabled={issuesPage <= 1}
              onClick={() => setIssuesPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              Previous
            </button>
            <span>
              Page {issuesPage} of {issuesTotalPages}
            </span>
            <button
              className={styles.pageButton}
              disabled={issuesPage >= issuesTotalPages}
              onClick={() =>
                setIssuesPage((current) => Math.min(issuesTotalPages, current + 1))
              }
              type="button"
            >
              Next
            </button>
            <button
              className={styles.pageButton}
              disabled={issuesPage >= issuesTotalPages}
              onClick={() => setIssuesPage(issuesTotalPages)}
              type="button"
            >
              Last
            </button>
          </div>
        </section>
      ) : null}

      {activeView === "trends" ? (
        <section className={styles.analyticsGrid}>
          {isLoadingTrendsView ? (
            <p className={styles.loading}>Loading trend analytics...</p>
          ) : null}
          <article className={styles.analyticsCard}>
            <h3>Fix Throughput</h3>
            <div className={styles.throughputGrid}>
              <div className={styles.throughputTile}>
                <strong>Today</strong>
                <span>Fixed: {throughput.today.fixed.toLocaleString()}</span>
                <span>New: {throughput.today.created.toLocaleString()}</span>
                <span
                  className={
                    throughput.today.netChange >= 0 ? styles.netPositive : styles.netNegative
                  }
                >
                  Net: {formatSigned(throughput.today.netChange)}
                </span>
              </div>
              <div className={styles.throughputTile}>
                <strong>This Week</strong>
                <span>Fixed: {throughput.week.fixed.toLocaleString()}</span>
                <span>New: {throughput.week.created.toLocaleString()}</span>
                <span
                  className={
                    throughput.week.netChange >= 0 ? styles.netPositive : styles.netNegative
                  }
                >
                  Net: {formatSigned(throughput.week.netChange)}
                </span>
              </div>
              <div className={styles.throughputTile}>
                <strong>This Month</strong>
                <span>Fixed: {throughput.month.fixed.toLocaleString()}</span>
                <span>New: {throughput.month.created.toLocaleString()}</span>
                <span
                  className={
                    throughput.month.netChange >= 0 ? styles.netPositive : styles.netNegative
                  }
                >
                  Net: {formatSigned(throughput.month.netChange)}
                </span>
              </div>
            </div>
          </article>

          <article className={styles.analyticsCard}>
            <h3>Open Issue Instances Trend (30 Days)</h3>
            {trendsPoints.length > 1 ? (
              <div className={styles.lineChartWrap}>
                <svg
                  aria-label="Open issues trend"
                  className={styles.lineChart}
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                >
                  <path className={styles.lineChartPath} d={openIssuesPath} />
                </svg>
                <div className={styles.lineChartLabels}>
                  <span>{formatDateLabel(trendsPoints[0].day)}</span>
                  <span>{formatDateLabel(trendsPoints[trendsPoints.length - 1].day)}</span>
                </div>
              </div>
            ) : (
              <p className={styles.loading}>Trend data will appear after live snapshots are collected.</p>
            )}
            <div className={styles.burndownMeta}>
              <span>Remaining: {burndownRemaining.toLocaleString()}</span>
              <span>Avg net/day (14d): {burndownVelocity}</span>
              <span>ETA to zero: {burndownEta}</span>
            </div>
          </article>

          <article className={styles.analyticsCard}>
            <h3>Created vs Fixed (Last 14 Days)</h3>
            {recentActivityPoints.length ? (
              <div className={styles.activityHeader}>
                <div className={styles.activityHoverCard}>
                  <strong>
                    {activeActivityPoint
                      ? formatDetailedDateLabel(activeActivityPoint.day)
                      : "Last 14 days"}
                  </strong>
                  <span>
                    Created: {(activeActivityPoint?.created ?? recentActivityTotals.created).toLocaleString()}
                  </span>
                  <span>
                    Fixed: {(activeActivityPoint?.fixed ?? recentActivityTotals.fixed).toLocaleString()}
                  </span>
                  <span>
                    Net:{" "}
                    {formatSigned(
                      (activeActivityPoint?.fixed ?? recentActivityTotals.fixed) -
                        (activeActivityPoint?.created ?? recentActivityTotals.created),
                    )}
                  </span>
                </div>
                <div className={styles.activityLegend}>
                  <span className={styles.legendItem}>
                    <span className={`${styles.legendSwatch} ${styles.legendSwatchCreated}`} />
                    Orange = created
                  </span>
                  <span className={styles.legendItem}>
                    <span className={`${styles.legendSwatch} ${styles.legendSwatchFixed}`} />
                    Green = fixed
                  </span>
                </div>
              </div>
            ) : null}
            {recentActivityPoints.length ? (
              <p className={styles.activityNarrative}>
                {recentActivityNarrative} Hover or focus a day to inspect exact counts.
              </p>
            ) : null}
            {recentActivityPoints.length ? (
              <div className={styles.activityBars}>
                {recentActivityPoints.map((point) => {
                  const createdHeight =
                    point.created > 0 ? Math.max((point.created / activityMax) * 100, 6) : 0;
                  const fixedHeight =
                    point.fixed > 0 ? Math.max((point.fixed / activityMax) * 100, 6) : 0;
                  const isActive = activeActivityPoint?.day === point.day;
                  return (
                    <button
                      aria-label={`${formatDetailedDateLabel(point.day)}. Created ${point.created}. Fixed ${point.fixed}. Net ${formatSigned(point.fixed - point.created)}.`}
                      className={`${styles.activityDay} ${isActive ? styles.activityDayActive : ""}`}
                      key={point.day}
                      onBlur={() => {
                        setHoveredActivityDay((current) => (current === point.day ? null : current));
                      }}
                      onFocus={() => {
                        setHoveredActivityDay(point.day);
                      }}
                      onMouseEnter={() => {
                        setHoveredActivityDay(point.day);
                      }}
                      onMouseLeave={() => {
                        setHoveredActivityDay((current) => (current === point.day ? null : current));
                      }}
                      title={`${formatDetailedDateLabel(point.day)}: ${point.created} created, ${point.fixed} fixed, net ${formatSigned(point.fixed - point.created)}`}
                      type="button"
                    >
                      <div className={styles.activityStacks}>
                        <span
                          className={styles.createdBar}
                          style={{ height: `${createdHeight}%` }}
                          title={`Created: ${point.created}`}
                        />
                        <span
                          className={styles.fixedBar}
                          style={{ height: `${fixedHeight}%` }}
                          title={`Fixed: ${point.fixed}`}
                        />
                      </div>
                      <small>{formatDateLabel(point.day)}</small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className={styles.loading}>
                Activity data will appear after live snapshots are collected.
              </p>
            )}
          </article>

          <article className={styles.analyticsCardWide}>
            <h3>Metric Scoreboard</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Open</th>
                    <th>Reviewed</th>
                    <th>Total</th>
                    <th>% Complete</th>
                    <th>Fixed Today</th>
                    <th>Fixed Week</th>
                    <th>Fixed Month</th>
                    <th>7-Day Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreboardRows.length ? (
                    scoreboardRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{row.open.toLocaleString()}</td>
                        <td>{row.reviewed.toLocaleString()}</td>
                        <td>{row.totalChecked.toLocaleString()}</td>
                        <td>{formatPercent(row.percentComplete)}</td>
                        <td>{row.fixedToday.toLocaleString()}</td>
                        <td>{row.fixedWeek.toLocaleString()}</td>
                        <td>{row.fixedMonth.toLocaleString()}</td>
                        <td className={row.delta7d <= 0 ? styles.netPositive : styles.netNegative}>
                          {formatSigned(row.delta7d)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className={styles.emptyRow} colSpan={9}>
                        Scoreboard is not available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {activeView === "ownership" ? (
        <section className={styles.analyticsGrid}>
          {isLoadingOwnershipView ? (
            <p className={styles.loading}>Loading ownership analytics...</p>
          ) : null}
          <article className={styles.analyticsCard}>
            <h3>Sales Rep Accountability</h3>
            {leaderboardRows.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Sales Rep</th>
                      <th>Open</th>
                      <th>Fixed Today</th>
                      <th>Fixed Week</th>
                      <th>Fixed Month</th>
                      <th>Closure Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardRows.map((row) => (
                      <tr key={`${row.rank}-${row.salesRepName}`}>
                        <td>#{row.rank}</td>
                        <td>{row.salesRepName}</td>
                        <td>{row.assignedOpenIssues.toLocaleString()}</td>
                        <td>{row.fixedToday.toLocaleString()}</td>
                        <td>{row.fixedWeek.toLocaleString()}</td>
                        <td>{row.fixedMonth.toLocaleString()}</td>
                        <td>{formatPercent(row.closureRatePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.loading}>Leaderboard will populate after live snapshots are collected.</p>
            )}
          </article>

          <article className={styles.analyticsCard}>
            <h3>Fixed By App User</h3>
            {visibleContributorRows.length ? (
              <div className={styles.contributorChart}>
                {visibleContributorRows.map((row) => {
                  const maxFixed = Math.max(
                    1,
                    ...displayedContributorRows.map((item) => item.fixedTotal),
                  );
                  const width = maxFixed > 0 ? (row.fixedTotal / maxFixed) * 100 : 0;
                  const isCurrentUser =
                    Boolean(session?.user) &&
                    (session?.user?.id.trim().toLowerCase() === row.userId.trim().toLowerCase() ||
                      session?.user?.name.trim().toLowerCase() === row.userName.trim().toLowerCase());

                  return (
                    <div
                      className={`${styles.contributorRow} ${isCurrentUser ? styles.contributorRowCurrent : ""}`}
                      key={`${row.userId}-${row.rank}`}
                    >
                      <div className={styles.contributorMeta}>
                        <strong>{row.userName}</strong>
                        <span>
                          Total fixed: {row.fixedTotal.toLocaleString()} • Today:{" "}
                          {row.fixedToday.toLocaleString()} • Week: {row.fixedWeek.toLocaleString()}
                        </span>
                      </div>
                      <div className={styles.contributorBarTrack}>
                        <div
                          className={styles.contributorBarFill}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.loading}>
                Contributor stats appear after issues are fixed from the app.
              </p>
            )}
          </article>
        </section>
      ) : null}

      <QueueDeleteContactsModal
        isOpen={Boolean(deleteQueueRow)}
        isSubmitting={
          deleteQueueRow?.contactId !== null &&
          deleteQueueRow?.contactId !== undefined &&
          Boolean(deletingContactIds[deleteQueueRow.contactId])
        }
        onClose={() => {
          if (deleteQueueRow?.contactId && deletingContactIds[deleteQueueRow.contactId]) {
            return;
          }
          setDeleteQueueRow(null);
        }}
        onConfirm={handleConfirmDeleteContact}
        targets={
          deleteQueueRow
            ? [
                {
                  key: deleteQueueRow.issueKey ?? String(deleteQueueRow.contactId ?? "delete"),
                  contactName: deleteQueueRow.contactName ?? null,
                  companyName: deleteQueueRow.companyName ?? null,
                } satisfies QueueDeleteContactTarget,
              ]
            : []
        }
      />

      <CreateContactDrawer
        accountOptions={accountOptions}
        initialAccountRecordId={createContactIssue?.accountRecordId ?? null}
        isOpen={createContactIssue !== null}
        onClose={() => {
          setCreateContactIssue(null);
        }}
        onContactCreated={handleContactCreated}
      />

      {mergeGroup ? (
        <ContactMergeModal
          businessAccountId={mergeGroup.items[0]?.businessAccountId ?? ""}
          businessAccountRecordId={
            mergeGroup.items[0]?.accountRecordId ?? mergeGroup.items[0]?.accountKey ?? ""
          }
          companyName={mergeGroup.items[0]?.companyName ?? ""}
          contacts={mergeGroup.items.map((item) => toMergeableContactCandidate(item))}
          isOpen={Boolean(mergeGroup)}
          onClose={() => {
            setMergeGroup(null);
          }}
          onMerged={handleMergeCompleted}
        />
      ) : null}
    </AppChrome>
  );
}
