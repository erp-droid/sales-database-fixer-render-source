"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type {
  BusinessAccountDetailResponse,
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
  Category,
} from "@/types/business-account";
import {
  DATA_QUALITY_BASIS_VALUES,
  DATA_QUALITY_METRIC_KEYS,
  type DataQualityBasis,
  type DataQualityContributorsResponse,
  type DataQualityExpandedSummaryResponse,
  type DataQualityIssueRow,
  type DataQualityIssuesResponse,
  type DataQualityLeaderboardResponse,
  type DataQualityMetric,
  type DataQualityMetricKey,
  type DataQualityMetricScoreRow,
  type DataQualityThroughputResponse,
  type DataQualityTrendsResponse,
} from "@/types/data-quality";
import {
  buildDataQualityIssueKey,
  buildDataQualitySnapshot,
  paginateDataQualityIssues,
  toDataQualitySummaryResponse,
} from "@/lib/data-quality";
import { enforceSinglePrimaryPerAccountRows } from "@/lib/business-accounts";
import {
  type CachedDataset,
  DATASET_STORAGE_KEYS,
  getMemoryCachedDataset,
  isBusinessAccountRow,
  readCachedDatasetFromStorage,
  writeCachedDatasetToStorage,
} from "@/lib/client-dataset-cache";
import { prefetchContactMergePreview } from "@/lib/contact-merge-preview-client";
import { ContactMergeModal } from "@/components/contact-merge-modal";
import type { ContactMergeResponse } from "@/types/contact-merge";

import styles from "./data-quality-client.module.css";
const REVIEWED_ISSUES_STORAGE_KEY = "dataQuality.reviewedIssues.v1";
const LIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ISSUES_PAGE_SIZE = 25;
const DUPLICATE_METRICS = new Set<DataQualityMetricKey>([
  "duplicateBusinessAccount",
  "duplicateContact",
]);

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
  { value: "Region 1", label: "Region 1" },
  { value: "Region 2", label: "Region 2" },
  { value: "Region 3", label: "Region 3" },
  { value: "Region 4", label: "Region 4" },
  { value: "Region 5", label: "Region 5" },
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

function readCachedRows(): BusinessAccountRow[] {
  return readCachedDatasetFromStorage()?.rows ?? [];
}

function readCachedLastSyncedAt(): string | null {
  return getMemoryCachedDataset()?.lastSyncedAt ?? readCachedDatasetFromStorage()?.lastSyncedAt ?? null;
}

function normalizeIssueIdentity(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  item: DataQualityIssueRow,
): string {
  if (basis === "account") {
    return (
      item.accountRecordId?.trim() ||
      item.accountKey.trim() ||
      item.businessAccountId.trim() ||
      item.companyName.trim().toLowerCase()
    );
  }

  return (
    (item.contactId !== null ? `${item.accountKey}:contact:${item.contactId}` : "") ||
    item.rowKey?.trim() ||
    `${item.accountKey}:${item.contactName?.trim().toLowerCase() ?? "contact"}:${metric}`
  );
}

function makeReviewedItemKey(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  item: DataQualityIssueRow,
): string {
  return `${metric}|${basis}|${normalizeIssueIdentity(metric, basis, item)}`;
}

function makeReviewedGroupKey(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  groupKey: string,
): string {
  return `${metric}|${basis}|group|${groupKey.trim()}`;
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

function prefetchMergeGroupPreview(items: DataQualityIssueRow[]) {
  if (items.length !== 2 || items.some((item) => item.contactId === null)) {
    return;
  }

  const keepContactId = pickDefaultMergeKeepContactId(items);
  if (keepContactId === null) {
    return;
  }

  const deleteContactId =
    items.find((item) => item.contactId !== keepContactId)?.contactId ?? null;
  const businessAccountRecordId = items[0]?.accountRecordId ?? items[0]?.accountKey ?? "";

  if (deleteContactId === null || !businessAccountRecordId) {
    return;
  }

  prefetchContactMergePreview({
    businessAccountRecordId,
    keepContactId,
    deleteContactId,
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

function toPercent(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((part / total) * 1000) / 10;
}

function buildLocalExpandedSummary(
  rows: BusinessAccountRow[],
  basis: DataQualityBasis,
): DataQualityExpandedSummaryResponse | null {
  if (!rows.length) {
    return null;
  }

  const snapshot = buildDataQualitySnapshot(rows);
  const base = toDataQualitySummaryResponse(snapshot);
  const totalChecked = basis === "account" ? snapshot.totals.accounts : snapshot.totals.rows;
  const affectedRecords =
    basis === "account"
      ? snapshot.issueTotals.accountsWithIssues
      : snapshot.issueTotals.rowsWithIssues;
  const openIssues = snapshot.metrics.reduce((sum, metric) => {
    return sum + (basis === "account" ? metric.missingAccounts : metric.missingRows);
  }, 0);
  const cleanRecords = Math.max(0, totalChecked - affectedRecords);
  const percentComplete = toPercent(cleanRecords, totalChecked);

  const scoreboard: DataQualityMetricScoreRow[] = snapshot.metrics.map((metric) => {
    const open = basis === "account" ? metric.missingAccounts : metric.missingRows;
    const total = totalChecked;
    const complete = Math.max(0, total - open);
    return {
      key: metric.key,
      label: metric.label,
      open,
      reviewed: 0,
      totalChecked: total,
      percentComplete: toPercent(complete, total),
      fixedToday: 0,
      fixedWeek: 0,
      fixedMonth: 0,
      delta7d: 0,
    };
  });

  return {
    ...base,
    kpis: {
      timezone: "America/Toronto",
      basis,
      openIssues,
      affectedRecords,
      reviewedExceptions: 0,
      cleanRecords,
      totalChecked,
      percentComplete,
    },
    scoreboard,
  };
}

function renderText(value: string | null | undefined): string {
  if (!value || !value.trim()) {
    return "-";
  }
  return value;
}

function metricBarValue(metric: DataQualityMetric, basis: DataQualityBasis): number {
  return basis === "account" ? metric.accountMissingPct : metric.rowMissingPct;
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

export function DataQualityClient() {
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
  const [savingFixKeys, setSavingFixKeys] = useState<Record<string, boolean>>({});
  const [rowFixDrafts, setRowFixDrafts] = useState<Record<string, RowFixDraft>>({});
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [reviewedItemKeys, setReviewedItemKeys] = useState<string[]>([]);
  const [reviewedGroupKeys, setReviewedGroupKeys] = useState<string[]>([]);
  const [liveIssues, setLiveIssues] = useState<DataQualityIssuesResponse | null>(null);
  const [liveIssuesKey, setLiveIssuesKey] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<DataQualityMetricKey>("missingCompany");
  const [selectedBasis, setSelectedBasis] = useState<DataQualityBasis>("row");
  const [issuesPage, setIssuesPage] = useState(1);
  const [mergeGroup, setMergeGroup] = useState<MergeGroupState | null>(null);
  const [hoveredActivityDay, setHoveredActivityDay] = useState<string | null>(null);

  const issuesPageSize = isDuplicateMetric(selectedMetric) ? 200 : ISSUES_PAGE_SIZE;
  const currentIssuesKey = `${selectedMetric}|${selectedBasis}|${issuesPage}|${issuesPageSize}`;
  const reviewedItemKeySet = useMemo(() => new Set(reviewedItemKeys), [reviewedItemKeys]);
  const reviewedGroupKeySet = useMemo(() => new Set(reviewedGroupKeys), [reviewedGroupKeys]);

  const localIssues = useMemo(() => {
    if (!cachedRows.length) {
      return null;
    }
    const snapshot = buildDataQualitySnapshot(cachedRows);
    return paginateDataQualityIssues(
      snapshot,
      selectedMetric,
      selectedBasis,
      issuesPage,
      issuesPageSize,
    );
  }, [cachedRows, issuesPage, issuesPageSize, selectedBasis, selectedMetric]);

  const localSummary = useMemo(
    () => buildLocalExpandedSummary(cachedRows, selectedBasis),
    [cachedRows, selectedBasis],
  );
  const activeSummary = liveSummary ?? localSummary;
  const liveSummaryComputedAtIso = liveSummary?.computedAtIso ?? null;
  const liveIssuesMatchSelection =
    liveIssuesKey === currentIssuesKey && liveIssues !== null;
  const liveIssuesMatchSummary =
    !liveSummaryComputedAtIso ||
    (liveIssuesMatchSelection && liveIssues?.computedAtIso === liveSummaryComputedAtIso);
  const shouldUseLiveIssues =
    liveIssuesMatchSelection && liveIssuesMatchSummary && liveIssues !== null;
  const drilldownWaitingForFreshLiveIssues =
    Boolean(liveSummaryComputedAtIso) && !shouldUseLiveIssues && !issuesError;
  const rawDisplayedIssues = shouldUseLiveIssues
    ? liveIssues
    : liveSummaryComputedAtIso
      ? null
      : localIssues;
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
  const usingLiveSummary = Boolean(liveSummary);

  const summaryMetricMap = useMemo(() => {
    const next = new Map<DataQualityMetricKey, DataQualityMetric>();
    (activeSummary?.metrics ?? []).forEach((metric) => {
      next.set(metric.key, metric);
    });
    return next;
  }, [activeSummary]);

  const selectedMetricStats = summaryMetricMap.get(selectedMetric) ?? null;
  const activeKpis = activeSummary?.kpis ?? null;
  const openIssues = activeKpis?.openIssues ?? 0;
  const affectedRecords = activeKpis?.affectedRecords ?? 0;
  const reviewedExceptions = activeKpis?.reviewedExceptions ?? 0;
  const cleanRecords = activeKpis?.cleanRecords ?? 0;
  const totalChecked = activeKpis?.totalChecked ?? 0;
  const percentComplete = activeKpis?.percentComplete ?? 0;
  const completionDegrees = Math.max(0, Math.min(360, (percentComplete / 100) * 360));

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
  const leaderboardRows = liveLeaderboard?.items ?? [];
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

  useEffect(() => {
    if (selectedMetric !== "duplicateContact" || duplicateIssueGroups.length === 0) {
      return;
    }

    duplicateIssueGroups.forEach((group) => {
      prefetchMergeGroupPreview(group.items);
    });
  }, [duplicateIssueGroups, selectedMetric]);

  const localVisibleIssueTotal = useMemo(() => {
    if (!cachedRows.length) {
      return 0;
    }

    const snapshot = buildDataQualitySnapshot(cachedRows);
    const sourceRows =
      selectedBasis === "account"
        ? snapshot.issues[selectedMetric].account
        : snapshot.issues[selectedMetric].row;

    return sourceRows.filter((item, index) => {
      return !isIssueReviewed(
        selectedMetric,
        selectedBasis,
        item,
        reviewedItemKeySet,
        reviewedGroupKeySet,
        `row-${index}`,
      );
    }).length;
  }, [
    cachedRows,
    reviewedGroupKeySet,
    reviewedItemKeySet,
    selectedBasis,
    selectedMetric,
  ]);

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

    return {
      companyName: item.companyName || "",
      salesRepId: matchedSalesRep?.id ?? "",
      category: normalizeOptionValue(CATEGORY_OPTIONS, item.category),
      companyRegion: normalizeOptionValue(COMPANY_REGION_OPTIONS, item.companyRegion),
      subCategory: normalizeOptionValue(SUB_CATEGORY_OPTIONS, item.subCategory),
      industryType: normalizeOptionValue(INDUSTRY_TYPE_OPTIONS, item.industryType),
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
        return;
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

        setSession({ authenticated: true, user: null });
        setSessionWarning(
          "Acumatica session validation is temporarily unavailable. You can still use cached data and retry refresh.",
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
        const [
          summaryResponse,
          trendsResponse,
          throughputResponse,
          leaderboardResponse,
          contributorsResponse,
        ] =
          await Promise.all([
            fetch(`/api/data-quality/summary?${query}`, { cache: "no-store" }),
            fetch(`/api/data-quality/trends?${query}`, { cache: "no-store" }),
            fetch(`/api/data-quality/throughput?${query}`, { cache: "no-store" }),
            fetch(`/api/data-quality/leaderboard?${query}`, { cache: "no-store" }),
            fetch(`/api/data-quality/contributors?${query}`, { cache: "no-store" }),
          ]);

        const summaryPayload = await readJsonResponse<
          DataQualityExpandedSummaryResponse | { error?: string }
        >(summaryResponse);
        const trendsPayload = await readJsonResponse<
          DataQualityTrendsResponse | { error?: string }
        >(trendsResponse);
        const throughputPayload = await readJsonResponse<
          DataQualityThroughputResponse | { error?: string }
        >(throughputResponse);
        const leaderboardPayload = await readJsonResponse<
          DataQualityLeaderboardResponse | { error?: string }
        >(leaderboardResponse);
        const contributorsPayload = await readJsonResponse<
          DataQualityContributorsResponse | { error?: string }
        >(contributorsResponse);

        if (!summaryResponse.ok) {
          throw new Error(parseError(summaryPayload));
        }
        if (!trendsResponse.ok) {
          throw new Error(parseError(trendsPayload));
        }
        if (!throughputResponse.ok) {
          throw new Error(parseError(throughputPayload));
        }
        if (!leaderboardResponse.ok) {
          throw new Error(parseError(leaderboardPayload));
        }
        if (!contributorsResponse.ok) {
          throw new Error(parseError(contributorsPayload));
        }

        if (!isDataQualityExpandedSummaryResponse(summaryPayload)) {
          throw new Error("Unexpected response while loading data quality summary.");
        }
        if (!isDataQualityTrendsResponse(trendsPayload)) {
          throw new Error("Unexpected response while loading data quality trends.");
        }
        if (!isDataQualityThroughputResponse(throughputPayload)) {
          throw new Error("Unexpected response while loading quality throughput.");
        }
        if (!isDataQualityLeaderboardResponse(leaderboardPayload)) {
          throw new Error("Unexpected response while loading leaderboard.");
        }
        if (!isDataQualityContributorsResponse(contributorsPayload)) {
          throw new Error("Unexpected response while loading contributor leaderboard.");
        }

        if (cancelled) {
          return;
        }
        setLiveSummary(summaryPayload);
        setLiveTrends(trendsPayload);
        setLiveThroughput(throughputPayload);
        setLiveLeaderboard(leaderboardPayload);
        setLiveContributors(contributorsPayload);
        setSummaryError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSummaryError(error instanceof Error ? error.message : "Failed to load live data quality.");
      } finally {
        if (!cancelled) {
          setIsRefreshingSummary(false);
        }
      }
    }

    void fetchLiveDashboard(false);
    const intervalId = window.setInterval(() => {
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

    const controller = new AbortController();
    setIsLoadingIssues(true);

    async function fetchIssues() {
      try {
        const params = new URLSearchParams({
          metric: selectedMetric,
          basis: selectedBasis,
          page: String(issuesPage),
          pageSize: String(issuesPageSize),
        });
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
        if (controller.signal.aborted) {
          return;
        }
        setLiveIssues(payload);
        setLiveIssuesKey(currentIssuesKey);
        setIssuesError(null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setIssuesError(error instanceof Error ? error.message : "Failed to load live issue details.");
      } finally {
        if (!controller.signal.aborted) {
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
    setLiveSummary(null);
    setLiveTrends(null);
    setLiveThroughput(null);
    setLiveLeaderboard(null);
    setLiveContributors(null);
    setLiveIssues(null);
    setLiveIssuesKey(null);
    setIssuesPage(1);
  }, [selectedBasis]);

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
  ) {
    if (!issueKeys.length) {
      return;
    }

    const response = await fetch("/api/data-quality/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        issueKeys,
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
      await syncReviewedStatus([issueKey], "review");
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
      await syncReviewedStatus(issueKeys, "review");
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
      addressLine1: sourceRow.addressLine1,
      addressLine2: sourceRow.addressLine2,
      city: sourceRow.city,
      state: sourceRow.state,
      postalCode: sourceRow.postalCode,
      country: sourceRow.country,
      targetContactId: sourceRow.contactId ?? sourceRow.primaryContactId ?? null,
      setAsPrimaryContact: false,
      salesRepId: sourceRow.salesRepId ?? null,
      salesRepName: sourceRow.salesRepName ?? null,
      industryType: sourceRow.industryType ?? null,
      subCategory: sourceRow.subCategory ?? null,
      companyRegion: sourceRow.companyRegion ?? null,
      week: sourceRow.week ?? null,
      primaryContactName: sourceRow.primaryContactName ?? null,
      primaryContactPhone: sourceRow.primaryContactPhone ?? null,
      primaryContactEmail: sourceRow.primaryContactEmail ?? null,
      category: sourceRow.category ?? null,
      notes: sourceRow.notes ?? null,
      expectedLastModified: sourceRow.lastModifiedIso ?? null,
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

    const response = await fetch(
      `/api/business-accounts/${encodeURIComponent(identifier)}`,
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
      const latestRow = await fetchIssueAccountRow(item);
      const updatePayload = buildUpdatePayloadFromRow(latestRow, {
        ...payloadOverrides,
        targetContactId: item.contactId ?? latestRow.contactId ?? latestRow.primaryContactId ?? null,
      });

      const identifier = resolveAccountIdentifier(item);
      const response = await fetch(
        `/api/business-accounts/${encodeURIComponent(identifier)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updatePayload),
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
      setLiveSummary(null);
      setLiveContributors(null);
      setLiveIssues(null);
      setLiveIssuesKey(null);
      setIssuesError(attributionError);
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

    const contactId = row.contactId;
    const name = renderText(row.contactName);
    const confirmed = window.confirm(
      `Delete contact '${name}' from Acumatica? This action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingContactIds((current) => ({
      ...current,
      [contactId]: true,
    }));

    try {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: "DELETE",
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
            : "Deleted the contact but failed to attribute it.";
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
      void handleRefreshNow();
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : "Failed to delete contact.");
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

    setIsRefreshingSummary(true);
    setIsLoadingIssues(true);
    setSummaryError(null);
    setIssuesError(null);

    try {
      const baseParams = new URLSearchParams({
        basis: selectedBasis,
        refresh: "1",
      });
      const baseQuery = baseParams.toString();
      const [
        summaryResponse,
        trendsResponse,
        throughputResponse,
        leaderboardResponse,
        contributorsResponse,
      ] =
        await Promise.all([
          fetch(`/api/data-quality/summary?${baseQuery}`, { cache: "no-store" }),
          fetch(`/api/data-quality/trends?${baseQuery}`, { cache: "no-store" }),
          fetch(`/api/data-quality/throughput?${baseQuery}`, { cache: "no-store" }),
          fetch(`/api/data-quality/leaderboard?${baseQuery}`, { cache: "no-store" }),
          fetch(`/api/data-quality/contributors?${baseQuery}`, { cache: "no-store" }),
        ]);

      const summaryPayload = await readJsonResponse<
        DataQualityExpandedSummaryResponse | { error?: string }
      >(summaryResponse);
      const trendsPayload = await readJsonResponse<
        DataQualityTrendsResponse | { error?: string }
      >(trendsResponse);
      const throughputPayload = await readJsonResponse<
        DataQualityThroughputResponse | { error?: string }
      >(throughputResponse);
      const leaderboardPayload = await readJsonResponse<
        DataQualityLeaderboardResponse | { error?: string }
      >(leaderboardResponse);
      const contributorsPayload = await readJsonResponse<
        DataQualityContributorsResponse | { error?: string }
      >(contributorsResponse);

      if (!summaryResponse.ok) {
        throw new Error(parseError(summaryPayload));
      }
      if (!trendsResponse.ok) {
        throw new Error(parseError(trendsPayload));
      }
      if (!throughputResponse.ok) {
        throw new Error(parseError(throughputPayload));
      }
      if (!leaderboardResponse.ok) {
        throw new Error(parseError(leaderboardPayload));
      }
      if (!contributorsResponse.ok) {
        throw new Error(parseError(contributorsPayload));
      }
      if (!isDataQualityExpandedSummaryResponse(summaryPayload)) {
        throw new Error("Unexpected response while refreshing data quality summary.");
      }
      if (!isDataQualityTrendsResponse(trendsPayload)) {
        throw new Error("Unexpected response while refreshing trends.");
      }
      if (!isDataQualityThroughputResponse(throughputPayload)) {
        throw new Error("Unexpected response while refreshing throughput.");
      }
      if (!isDataQualityLeaderboardResponse(leaderboardPayload)) {
        throw new Error("Unexpected response while refreshing leaderboard.");
      }
      if (!isDataQualityContributorsResponse(contributorsPayload)) {
        throw new Error("Unexpected response while refreshing contributor leaderboard.");
      }

      setLiveSummary(summaryPayload);
      setLiveTrends(trendsPayload);
      setLiveThroughput(throughputPayload);
      setLiveLeaderboard(leaderboardPayload);
      setLiveContributors(contributorsPayload);

      const issuesParams = new URLSearchParams({
        metric: selectedMetric,
        basis: selectedBasis,
        page: String(issuesPage),
        pageSize: String(issuesPageSize),
        refresh: "1",
      });
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
      setLiveIssues(issuesPayload);
      setLiveIssuesKey(currentIssuesKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed.";
      setSummaryError(message);
      setIssuesError(message);
    } finally {
      setIsRefreshingSummary(false);
      setIsLoadingIssues(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/signin");
    router.refresh();
  }

  function handleMergeCompleted(result: ContactMergeResponse) {
    const activeMergeGroup = mergeGroup;
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
    const deletedContactName =
      activeMergeGroup?.items.find((item) => item.contactId === result.deletedContactId)?.contactName ??
      "Deleted contact";
    const issueKeys = activeMergeGroup
      ? activeMergeGroup.items
          .map((item) => item.issueKey ?? buildDataQualityIssueKey(selectedMetric, selectedBasis, item))
          .filter((value): value is string => Boolean(value && value.trim()))
      : [];

    persistCachedRows(nextRows);
    setLiveSummary(null);
    setLiveContributors(null);
    setLiveIssues(null);
    setLiveIssuesKey(null);
    setIssuesError(null);
    setMergeSuccessMessage(
      `${renderText(keptContactName)} was kept and ${renderText(deletedContactName)} was deleted${
        result.setKeptAsPrimary ? ". Primary contact updated." : "."
      }`,
    );
    setMergeGroup(null);
    void (async () => {
      try {
        await recordFixedIssues(issueKeys);
      } catch (error) {
        setIssuesError(error instanceof Error ? error.message : "Failed to attribute fix history.");
      }
      await handleRefreshNow();
    })();
  }

  const summaryIssuesTotal = selectedMetricStats
    ? selectedBasis === "account"
      ? selectedMetricStats.missingAccounts
      : selectedMetricStats.missingRows
    : 0;
  const derivedIssuesTotal =
    summaryIssuesTotal > 0
      ? Math.max(
          summaryIssuesTotal,
          displayedIssues?.total ?? 0,
          !liveSummaryComputedAtIso && cachedRows.length > 0 ? localVisibleIssueTotal : 0,
        )
      : displayedIssues
        ? Math.max(
            displayedIssues.items.length,
            displayedIssues.total,
            cachedRows.length > 0 ? localVisibleIssueTotal : 0,
          )
        : cachedRows.length > 0
          ? localVisibleIssueTotal
          : 0;
  const issuesTotalPages = Math.max(1, Math.ceil(derivedIssuesTotal / issuesPageSize));

  useEffect(() => {
    if (issuesPage <= issuesTotalPages) {
      return;
    }

    setIssuesPage(issuesTotalPages);
  }, [issuesPage, issuesTotalPages]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <Image alt="MeadowBrook" className={styles.brandLogo} height={202} priority src="/mb-logo.png" width={712} />
          <p className={styles.kicker}>Sales Database Fixer</p>
          <h1 className={styles.title}>Data Quality Check</h1>
          <p className={styles.subtitle}>
            Fast cached snapshot + live Acumatica verification for missing fields, duplicates, and sales rep coverage.
          </p>
        </div>

        <div className={styles.headerActions}>
          <Link className={styles.navButton} href="/accounts">
            Back to Accounts
          </Link>
          <Link className={styles.navButton} href="/map">
            Map view
          </Link>
          <button
            className={styles.navButton}
            disabled={isRefreshingSummary}
            onClick={handleRefreshNow}
            type="button"
          >
            {isRefreshingSummary ? "Refreshing..." : "Refresh now"}
          </button>
          <button className={styles.logoutButton} onClick={handleLogout} type="button">
            Sign out
          </button>
          <span className={styles.userName}>{session?.user?.name ?? "Signed in"}</span>
        </div>
      </header>

      {sessionWarning ? <p className={styles.warning}>{sessionWarning}</p> : null}
      {summaryError ? <p className={styles.warning}>{summaryError}</p> : null}
      {issuesError ? <p className={styles.warning}>{issuesError}</p> : null}
      {mergeSuccessMessage ? <p className={styles.success}>{mergeSuccessMessage}</p> : null}

      <section className={styles.statusBar}>
        <span className={styles.stateTag}>{usingLiveSummary ? "Live verified" : "Cached snapshot"}</span>
        <span>Last computed: {formatDateTime(activeSummary?.computedAtIso)}</span>
        <span>Rows cached: {cachedRows.length.toLocaleString()}</span>
      </section>

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
              <small>Total Checked</small>
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
          <h2>Quality Metrics</h2>
          <div className={styles.metricGrid}>
            {activeSummary?.metrics.map((metric) => {
              const missing = selectedBasis === "account" ? metric.missingAccounts : metric.missingRows;
              const percent = metricBarValue(metric, selectedBasis);
              const isSelected = metric.key === selectedMetric;

              return (
                <button
                  className={`${styles.metricButton} ${isSelected ? styles.metricButtonActive : ""}`}
                  key={metric.key}
                  onClick={() => {
                    setSelectedMetric(metric.key);
                    setIssuesPage(1);
                  }}
                  type="button"
                >
                  <div className={styles.metricHeader}>
                    <strong>{metric.label}</strong>
                    <span>{missing.toLocaleString()} issues</span>
                  </div>
                  <div className={styles.metricBarTrack}>
                    <div className={styles.metricBarFill} style={{ width: `${Math.min(100, percent)}%` }} />
                  </div>
                  <small>{formatPercent(percent)} issues ({selectedBasis})</small>
                </button>
              );
            })}
          </div>
        </article>
      </section>

      <section className={styles.analyticsGrid}>
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
          <p className={styles.chartExplanation}>
            Use this chart to see whether the backlog is shrinking. Orange bars are new issues
            created on that day, and green bars are issues fixed on that day.
          </p>
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

      <section className={styles.drilldownSection}>
        <div className={styles.drilldownHeader}>
          <h2>Issue Drilldown</h2>
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
              setSelectedMetric(event.target.value as DataQualityMetricKey);
              setIssuesPage(1);
            }}
            value={selectedMetric}
          >
            {DATA_QUALITY_METRIC_KEYS.map((metricKey) => (
              <option key={metricKey} value={metricKey}>
                {summaryMetricMap.get(metricKey)?.label ?? metricKey}
              </option>
            ))}
          </select>
        </div>

        {selectedMetricStats ? (
          <p className={styles.drilldownMeta}>
            Issues ({selectedBasis}):{" "}
            {selectedBasis === "account"
              ? selectedMetricStats.missingAccounts.toLocaleString()
              : selectedMetricStats.missingRows.toLocaleString()}
          </p>
        ) : null}

        {isLoadingIssues || drilldownWaitingForFreshLiveIssues ? (
          <p className={styles.loading}>Loading issue details...</p>
        ) : null}

        {isDuplicateMetric(selectedMetric) ? (
          <div className={styles.duplicateGroups}>
            {drilldownWaitingForFreshLiveIssues ? null : duplicateIssueGroups.length ? (
              duplicateIssueGroups.map((group) => (
                <article className={styles.duplicateGroup} key={group.key}>
                  <header className={styles.duplicateGroupHeader}>
                    <strong>
                      {selectedMetric === "duplicateBusinessAccount"
                        ? `Possible duplicate business account: ${renderText(group.items[0]?.companyName)}`
                        : `Possible duplicate contact: ${renderText(group.items[0]?.contactName)} (${renderText(
                            group.items[0]?.companyName,
                          )})`}
                    </strong>
                    <div className={styles.groupHeaderActions}>
                      <span>{group.items.length} records</span>
                      {selectedMetric === "duplicateContact" ? (
                        <button
                          className={styles.mergeButton}
                          disabled={
                            group.items.length !== 2 ||
                            group.items.some((item) => item.contactId === null)
                          }
                          onFocus={() => {
                            prefetchMergeGroupPreview(group.items);
                          }}
                          onMouseEnter={() => {
                            prefetchMergeGroupPreview(group.items);
                          }}
                          onClick={() => {
                            setMergeSuccessMessage(null);
                            setMergeGroup(group);
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
                  </header>
                  {selectedMetric === "duplicateContact" && group.items.length > 2 ? (
                    <p className={styles.groupHint}>
                      This group has more than 2 duplicates. Resolve with pairwise merges.
                    </p>
                  ) : null}
                  <div className={styles.duplicateCards}>
                    {group.items.map((item, index) => {
                      const deleting = item.contactId !== null && Boolean(deletingContactIds[item.contactId]);
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
                          <p className={styles.duplicateCardTitle}>{renderText(item.companyName)}</p>
                          <p>{renderText(item.contactName)}</p>
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
                </article>
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
                  <th>Company Name</th>
                  <th>Contact</th>
                  <th>Sales Rep</th>
                  <th>Address</th>
                  <th>Category</th>
                  <th>Region</th>
                  <th>Sub-Category</th>
                  <th>Industry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {drilldownWaitingForFreshLiveIssues ? (
                  <tr>
                    <td className={styles.emptyRow} colSpan={9}>
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
                        <td>{renderText(item.companyName)}</td>
                        <td>
                          {renderText(item.contactName)}
                          {item.isPrimaryContact ? <span className={styles.primaryBadge}>PRIMARY</span> : null}
                        </td>
                        <td>{renderText(item.salesRepName)}</td>
                        <td>{renderText(item.address)}</td>
                        <td>{renderText(item.category)}</td>
                        <td>{renderText(item.companyRegion)}</td>
                        <td>{renderText(item.subCategory)}</td>
                        <td>{renderText(item.industryType)}</td>
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
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className={styles.emptyRow} colSpan={9}>
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

      {mergeGroup ? (
        <ContactMergeModal
          businessAccountId={mergeGroup.items[0]?.businessAccountId ?? ""}
          businessAccountRecordId={
            mergeGroup.items[0]?.accountRecordId ?? mergeGroup.items[0]?.accountKey ?? ""
          }
          companyName={mergeGroup.items[0]?.companyName ?? ""}
          contacts={mergeGroup.items}
          isOpen={Boolean(mergeGroup)}
          onClose={() => {
            setMergeGroup(null);
          }}
          onMerged={handleMergeCompleted}
        />
      ) : null}
    </main>
  );
}
