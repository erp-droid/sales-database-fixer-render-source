"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";

import { buildDashboardQueryString, formatDashboardDateInputValue, parseDashboardFilters } from "@/lib/call-analytics/filter-params";
import type {
  DashboardFilters,
  DashboardSnapshotResponse,
} from "@/lib/call-analytics/types";
import type { MeetingCategory } from "@/types/meeting-create";

import styles from "./dashboard-page.module.css";
import {
  DashboardShell,
  DashboardStatusBar,
  extractErrorMessage,
  formatDuration,
  formatPercent,
  readJsonResponse,
} from "./dashboard-ui";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVE_REFRESH_INTERVAL_MS = 30_000;
const REFRESH_RANGE_BUCKET_MS = 5 * 60 * 1000;
const MULTIPLE_EMPLOYEE_FILTER_VALUE = "__multiple_employees__";

type ErrorPayload = {
  error?: string;
};

type PriorityCardIcon = "calls" | "meetings" | "connection" | "talkTime" | "emails";
type DashboardPreset = "today" | "last7" | "last30" | "quarter";
type ActivitySegmentKey = "calls" | "meetings" | "dropOffs" | "emails" | "notes";
type ActivityMetricKey = "all" | ActivitySegmentKey | "connectedCalls";

const ACTIVITY_SEGMENTS: Array<{ key: ActivitySegmentKey; label: string }> = [
  { key: "calls", label: "Total calls" },
  { key: "meetings", label: "Meetings" },
  { key: "dropOffs", label: "Drop-offs" },
  { key: "emails", label: "Emails" },
  { key: "notes", label: "Notes" },
];

const ACTIVITY_FILTER_OPTIONS: Array<{ key: ActivityMetricKey; label: string }> = [
  { key: "all", label: "All activities" },
  { key: "calls", label: "Total calls" },
  { key: "connectedCalls", label: "Connected calls" },
  { key: "meetings", label: "Meetings" },
  { key: "dropOffs", label: "Drop-offs" },
  { key: "emails", label: "Emails" },
  { key: "notes", label: "Notes" },
];

const DASHBOARD_PRESETS: Array<{ key: DashboardPreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "quarter", label: "Quarter to date" },
];

function buildPriorityCards(
  stats: DashboardSnapshotResponse["teamStats"],
  meetingStats: DashboardSnapshotResponse["meetingStats"],
  emailStats: DashboardSnapshotResponse["emailStats"],
): Array<{ icon: PriorityCardIcon; label: string; value: string; meta?: string }> {
  return [
    {
      icon: "calls",
      label: "Calls",
      value: stats.totalCalls.toLocaleString(),
      meta: `${stats.outboundCalls.toLocaleString()} outbound • ${stats.inboundCalls.toLocaleString()} inbound`,
    },
    {
      icon: "meetings",
      label: "Meetings booked",
      value: meetingStats.totalMeetings.toLocaleString(),
      meta: `${meetingStats.uniqueBookers.toLocaleString()} creators in range`,
    },
    {
      icon: "connection",
      label: "Connection rate",
      value: formatPercent(stats.answerRate),
      meta: `${formatPercent(stats.answerRate)} of calls connected`,
    },
    {
      icon: "talkTime",
      label: "Talk time",
      value: formatDuration(stats.totalTalkSeconds),
      meta: `${formatDuration(stats.averageTalkSeconds)} avg connected`,
    },
    {
      icon: "emails",
      label: "Emails sent",
      value: emailStats.totalSent.toLocaleString(),
      meta:
        emailStats.busiestSenderDisplayName && emailStats.busiestSenderCount > 0
          ? `${emailStats.busiestSenderDisplayName} leads with ${emailStats.busiestSenderCount.toLocaleString()}`
          : `${emailStats.uniqueSenders.toLocaleString()} active senders`,
    },
  ];
}

function PriorityCardIconGraphic({ icon }: { icon: PriorityCardIcon }) {
  const commonProps = {
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
  };

  switch (icon) {
    case "calls":
      return (
        <svg {...commonProps}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.32 1.8.59 2.65a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6.27 6.27l1.25-1.25a2 2 0 0 1 2.11-.45c.85.27 1.74.47 2.65.59A2 2 0 0 1 22 16.92Z" />
        </svg>
      );
    case "meetings":
      return (
        <svg {...commonProps}>
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <rect height="18" rx="2" width="18" x="3" y="4" />
          <path d="M3 10h18" />
          <path d="M8 14h.01" />
          <path d="M12 14h.01" />
          <path d="M16 14h.01" />
        </svg>
      );
    case "connection":
      return (
        <svg {...commonProps}>
          <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
          <circle cx="12" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "talkTime":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "emails":
      return (
        <svg {...commonProps}>
          <rect height="16" rx="2" width="20" x="2" y="4" />
          <path d="m22 7-8.97 5.7a2 2 0 0 1-2.06 0L2 7" />
        </svg>
      );
  }
}

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M3 5h18" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M21 12a9 9 0 0 1-15.5 6.2" />
      <path d="M3 12A9 9 0 0 1 18.5 5.8" />
      <path d="M18 2v4h4" />
      <path d="M6 22v-4H2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function DropOffIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function formatMeetingCategoryTitle(category: MeetingCategory): string {
  return category === "Drop Off" ? "Drop-offs booked" : "Meetings booked";
}

function formatMeetingCategoryLowerLabel(category: MeetingCategory): string {
  return category === "Drop Off" ? "drop-off" : "meeting";
}

function buildMeetingCategoryAuditHref(loginName: string, category: MeetingCategory): string {
  const params = new URLSearchParams({
    actionGroup: "meeting_create",
    actor: loginName,
  });
  if (category === "Drop Off") {
    params.set("q", category);
  }
  return `/audit?${params.toString()}`;
}

function buildMeetingCategoryAllAuditHref(category: MeetingCategory): string {
  const params = new URLSearchParams({
    actionGroup: "meeting_create",
  });
  if (category === "Drop Off") {
    params.set("q", category);
  }
  return `/audit?${params.toString()}`;
}

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "MB";
  }
  if (parts.length === 1) {
    return parts[0]?.slice(0, 2).toUpperCase() ?? "MB";
  }
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase() || "MB";
}

function buildBookingSparklineValues(total: number, rowIndex: number): number[] {
  const patterns = [
    [0.35, 0.48, 0.42, 0.62, 0.5, 0.84, 0.46, 0.66],
    [0.28, 0.46, 0.44, 0.52, 0.76, 0.38, 0.58, 0.49],
    [0.42, 0.3, 0.56, 0.5, 0.68, 0.44, 0.72, 0.36],
  ];
  const pattern = patterns[rowIndex % patterns.length] ?? patterns[0];
  const volumeFactor = Math.min(1, Math.max(0.35, total / Math.max(1, total + 4)));
  return pattern.map((value) => Math.round(8 + value * 30 * volumeFactor));
}

function formatBookingRowMeta(
  employee: DashboardSnapshotResponse["meetingLeaderboard"][number],
  totalMeetings: number,
  category: MeetingCategory,
): string {
  const noun = formatMeetingCategoryLowerLabel(category);
  const shareOfTotal = totalMeetings > 0 ? employee.totalMeetings / totalMeetings : 0;
  return `${employee.totalMeetings.toLocaleString()} ${noun}${
    employee.totalMeetings === 1 ? "" : "s"
  } • ${formatPercent(shareOfTotal)}`;
}

function formatNameList(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function formatActivityShare(count: number, total: number): string {
  if (total <= 0) {
    return "0% of team";
  }
  return `${formatPercent(count / total)} of team`;
}

function readActivityMetricValue(
  activity: DashboardSnapshotResponse["activityLeaderboard"][number],
  metric: ActivityMetricKey,
): number {
  return metric === "all" ? activity.totalActivities : activity[metric];
}

function formatActivityMetricCount(count: number, metric: ActivityMetricKey): string {
  const value = count.toLocaleString();
  if (metric === "all") {
    return `${value} ${count === 1 ? "activity" : "activities"}`;
  }
  if (metric === "calls") {
    return `${value} total ${count === 1 ? "call" : "calls"}`;
  }
  if (metric === "connectedCalls") {
    return `${value} connected ${count === 1 ? "call" : "calls"}`;
  }
  if (metric === "meetings") {
    return `${value} ${count === 1 ? "meeting" : "meetings"}`;
  }
  if (metric === "dropOffs") {
    return `${value} ${count === 1 ? "drop-off" : "drop-offs"}`;
  }
  if (metric === "emails") {
    return `${value} ${count === 1 ? "email" : "emails"}`;
  }
  return `${value} ${count === 1 ? "note" : "notes"}`;
}

function readActivityMetricLabel(metric: ActivityMetricKey): string {
  return ACTIVITY_FILTER_OPTIONS.find((option) => option.key === metric)?.label ?? "Activities";
}

function formatActivityChartFooter(
  activity: DashboardSnapshotResponse["activityLeaderboard"][number],
  metric: ActivityMetricKey,
): string {
  if (metric === "all") {
    return `${activity.calls.toLocaleString()} total · ${activity.connectedCalls.toLocaleString()} connected · ${(activity.totalActivities - activity.calls).toLocaleString()} other`;
  }
  if (metric === "calls") {
    return `${activity.calls.toLocaleString()} total · ${activity.connectedCalls.toLocaleString()} connected`;
  }
  if (metric === "connectedCalls") {
    return `${activity.connectedCalls.toLocaleString()} connected of ${activity.calls.toLocaleString()} calls`;
  }
  return formatActivityMetricCount(readActivityMetricValue(activity, metric), metric);
}

function formatActivityBreakdown(
  activity: DashboardSnapshotResponse["activityLeaderboard"][number],
): string {
  return [
    `${activity.totalActivities.toLocaleString()} total`,
    `${activity.calls.toLocaleString()} total calls`,
    `${activity.connectedCalls.toLocaleString()} connected calls (included in total calls)`,
    `${activity.meetings.toLocaleString()} meetings`,
    `${activity.dropOffs.toLocaleString()} drop-offs`,
    `${activity.emails.toLocaleString()} emails`,
    `${activity.notes.toLocaleString()} notes`,
  ].join(" · ");
}

function formatLowestActivityMeta(
  activities: DashboardSnapshotResponse["activityLeaderboard"],
  metric: ActivityMetricKey,
): string {
  const firstActivity = activities[0] ?? null;
  if (!firstActivity) {
    return "";
  }

  if (activities.length === 1) {
    return metric === "all"
      ? formatActivityBreakdown(firstActivity)
      : formatActivityMetricCount(readActivityMetricValue(firstActivity, metric), metric);
  }

  return `${formatActivityMetricCount(readActivityMetricValue(firstActivity, metric), metric)} each · ${activities.length.toLocaleString()} reps tied`;
}

function buildActivityAriaLabel(
  activity: DashboardSnapshotResponse["activityLeaderboard"][number],
): string {
  return `${activity.displayName}: ${formatActivityBreakdown(activity)}`;
}

function getActivitySegmentClassName(key: ActivitySegmentKey): string {
  if (key === "calls") {
    return styles.activitySegmentCalls;
  }
  if (key === "meetings") {
    return styles.activitySegmentMeetings;
  }
  if (key === "dropOffs") {
    return styles.activitySegmentDropOffs;
  }
  if (key === "emails") {
    return styles.activitySegmentEmails;
  }
  return styles.activitySegmentNotes;
}

function getActivityLegendClassName(key: ActivitySegmentKey): string {
  if (key === "calls") {
    return styles.legendSwatchCalls;
  }
  if (key === "meetings") {
    return styles.legendSwatchMeetings;
  }
  if (key === "dropOffs") {
    return styles.legendSwatchDropOffs;
  }
  if (key === "emails") {
    return styles.legendSwatchEmails;
  }
  return styles.legendSwatchNotes;
}

function readStatusLabel(snapshot: DashboardSnapshotResponse | null): string {
  const status = snapshot?.importState.status;
  if (status === "complete") {
    return "History loaded";
  }
  if (status === "error") {
    return "Import error";
  }
  if (status === "full_backfill_running") {
    return "Backfilling history";
  }
  if (status === "recent_sync_running") {
    return "Refreshing calls";
  }
  return "SQLite snapshot";
}

function shouldUseActiveRefresh(snapshot: DashboardSnapshotResponse | null): boolean {
  const status = snapshot?.importState.status;
  return (
    snapshot?.backgroundRefreshTriggered === true ||
    status === "recent_sync_running" ||
    status === "full_backfill_running"
  );
}

function buildExplorerHref(filters: DashboardFilters): string {
  const query = buildDashboardQueryString(filters);
  return query ? `/dashboard/explorer?${query}` : "/dashboard/explorer";
}

function parseRefreshFilters(currentQuery: string): DashboardFilters {
  const bucketedNow = Math.floor(Date.now() / REFRESH_RANGE_BUCKET_MS) * REFRESH_RANGE_BUCKET_MS;
  return parseDashboardFilters(new URLSearchParams(currentQuery), {
    now: bucketedNow,
  });
}

function canRefreshInBackground(): boolean {
  return document.visibilityState === "visible";
}

function mergeFilters(filters: DashboardFilters, next: Partial<DashboardFilters>): DashboardFilters {
  return {
    ...filters,
    ...next,
  };
}

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function buildPresetRange(preset: DashboardPreset, nowInput: Date): Pick<DashboardFilters, "start" | "end"> {
  const now = new Date(nowInput);
  const end = endOfLocalDay(now);
  const start = startOfLocalDay(now);

  switch (preset) {
    case "today":
      return { start: start.toISOString(), end: end.toISOString() };
    case "last7":
      start.setDate(start.getDate() - 7);
      return { start: start.toISOString(), end: end.toISOString() };
    case "last30":
      start.setDate(start.getDate() - 30);
      return { start: start.toISOString(), end: end.toISOString() };
    case "quarter":
      start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
      return { start: start.toISOString(), end: end.toISOString() };
  }
}

function getActivePreset(filters: DashboardFilters, nowIso: string): DashboardPreset | null {
  const filterStart = formatDashboardDateInputValue(filters.start);
  const filterEnd = formatDashboardDateInputValue(filters.end);
  const now = new Date(nowIso);

  for (const preset of DASHBOARD_PRESETS) {
    const range = buildPresetRange(preset.key, now);
    if (
      formatDashboardDateInputValue(range.start) === filterStart &&
      formatDashboardDateInputValue(range.end) === filterEnd
    ) {
      return preset.key;
    }
  }

  return null;
}

type DashboardOverviewClientProps = {
  defaultNowIso: string;
};

export function DashboardOverviewClient({ defaultNowIso }: DashboardOverviewClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () =>
      parseDashboardFilters(new URLSearchParams(searchParams.toString()), {
        now: defaultNowIso,
      }),
    [defaultNowIso, searchParams],
  );
  const currentQuery = searchParams.toString();
  const [snapshot, setSnapshot] = useState<DashboardSnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMeetingEmployeeLoginName, setSelectedMeetingEmployeeLoginName] = useState<string | null>(null);
  const [selectedDropOffEmployeeLoginName, setSelectedDropOffEmployeeLoginName] = useState<string | null>(null);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [activityMetric, setActivityMetric] = useState<ActivityMetricKey>("all");
  const appliedEmployeeFilters = snapshot?.filters.employees ?? filters.employees;
  const selectedEmployeeLoginName =
    appliedEmployeeFilters.length === 1 ? appliedEmployeeFilters[0] : null;
  const activityRepFilterValue = appliedEmployeeFilters.length > 1
    ? MULTIPLE_EMPLOYEE_FILTER_VALUE
    : selectedEmployeeLoginName ?? "";

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  function replaceFilters(nextFilters: DashboardFilters): void {
    const nextQuery = buildDashboardQueryString(nextFilters);
    if (nextQuery === currentQuery) {
      return;
    }
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  function updateFilters(next: Partial<DashboardFilters>): void {
    replaceFilters(mergeFilters(filters, next));
  }

  function applyPreset(preset: DashboardPreset): void {
    const range = buildPresetRange(preset, new Date());
    replaceFilters({
      ...filters,
      ...range,
    });
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (searchDraft.trim() !== filters.search.trim()) {
        const nextFilters = mergeFilters(filters, { search: searchDraft.trim() });
        const nextQuery = buildDashboardQueryString(nextFilters);
        if (nextQuery !== currentQuery) {
          router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentQuery, filters, pathname, router, searchDraft]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadSnapshot() {
      setError(null);
      setLoading(true);

      try {
        const query = buildDashboardQueryString(filters);
        const response = await fetch(`/api/dashboard/calls/snapshot?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<DashboardSnapshotResponse | ErrorPayload>(response);
        if (!response.ok) {
          throw new Error(extractErrorMessage(payload) ?? "Unable to load dashboard.");
        }
        if (cancelled) {
          return;
        }
        setSnapshot(payload as DashboardSnapshotResponse);
      } catch (loadError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters, pathname, router]);

  useEffect(() => {
    const leaderboard = snapshot?.meetingCategoryAnalytics.meetings.leaderboard ?? [];
    if (!leaderboard.length) {
      setSelectedMeetingEmployeeLoginName(null);
      return;
    }

    const hasSelectedEmployee = leaderboard.some(
      (item) => item.loginName === selectedMeetingEmployeeLoginName,
    );
    if (selectedMeetingEmployeeLoginName && !hasSelectedEmployee) {
      setSelectedMeetingEmployeeLoginName(null);
    }
  }, [selectedMeetingEmployeeLoginName, snapshot?.meetingCategoryAnalytics.meetings.leaderboard]);

  useEffect(() => {
    const leaderboard = snapshot?.meetingCategoryAnalytics.dropOffs.leaderboard ?? [];
    if (!leaderboard.length) {
      setSelectedDropOffEmployeeLoginName(null);
      return;
    }

    const hasSelectedEmployee = leaderboard.some(
      (item) => item.loginName === selectedDropOffEmployeeLoginName,
    );
    if (selectedDropOffEmployeeLoginName && !hasSelectedEmployee) {
      setSelectedDropOffEmployeeLoginName(null);
    }
  }, [selectedDropOffEmployeeLoginName, snapshot?.meetingCategoryAnalytics.dropOffs.leaderboard]);

  const useActiveRefresh = shouldUseActiveRefresh(snapshot);

  useEffect(() => {
    let cancelled = false;
    const intervalMs = useActiveRefresh ? ACTIVE_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;

    async function refreshSnapshotInPlace() {
      if (!canRefreshInBackground()) {
        return;
      }

      try {
        const query = buildDashboardQueryString(parseRefreshFilters(currentQuery));
        const response = await fetch(`/api/dashboard/calls/snapshot?${query}`, {
          cache: "no-store",
        });
        const payload = await readJsonResponse<DashboardSnapshotResponse | ErrorPayload>(response);
        if (!response.ok || cancelled) {
          return;
        }
        setSnapshot(payload as DashboardSnapshotResponse);
      } catch {
        // Keep existing data visible during background polling failures.
      }
    }

    const intervalId = window.setInterval(() => {
      void refreshSnapshotInPlace();
    }, intervalMs);

    function handleVisibleRefresh() {
      if (canRefreshInBackground()) {
        void refreshSnapshotInPlace();
      }
    }

    window.addEventListener("focus", handleVisibleRefresh);
    document.addEventListener("visibilitychange", handleVisibleRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibleRefresh);
      document.removeEventListener("visibilitychange", handleVisibleRefresh);
    };
  }, [currentQuery, useActiveRefresh]);

  async function handleManualRefresh(): Promise<void> {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/calls/refresh", {
        method: "POST",
      });
      const payload = await readJsonResponse<{ ok?: boolean } | ErrorPayload>(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload) ?? "Unable to refresh call history.");
      }

      const query = buildDashboardQueryString(parseRefreshFilters(currentQuery));
      const snapshotResponse = await fetch(`/api/dashboard/calls/snapshot?${query}`, {
        cache: "no-store",
      });
      const snapshotPayload = await readJsonResponse<DashboardSnapshotResponse | ErrorPayload>(
        snapshotResponse,
      );
      if (!snapshotResponse.ok) {
        throw new Error(extractErrorMessage(snapshotPayload) ?? "Unable to reload dashboard.");
      }

      setSnapshot(snapshotPayload as DashboardSnapshotResponse);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh call history.");
    } finally {
      setRefreshing(false);
    }
  }

  const employeeOptions = useMemo(() => {
    const items = snapshot?.employees ?? [];
    const needle = employeeSearch.trim().toLowerCase();
    if (!needle) {
      return items;
    }

    return items.filter((employee) =>
      [employee.displayName, employee.loginName, employee.email ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [employeeSearch, snapshot?.employees]);

  const activityEmployees = useMemo(
    () => snapshot?.activityLeaderboard ?? [],
    [snapshot?.activityLeaderboard],
  );
  const activityRepOptions = useMemo(
    () => snapshot?.employees ?? [],
    [snapshot?.employees],
  );
  const visibleActivitySegments = useMemo(
    () => activityMetric === "all"
      ? ACTIVITY_SEGMENTS
      : ACTIVITY_SEGMENTS.filter((segment) => segment.key === activityMetric),
    [activityMetric],
  );
  const totalTeamActivities = useMemo(
    () => activityEmployees.reduce(
      (sum, item) => sum + readActivityMetricValue(item, activityMetric),
      0,
    ),
    [activityEmployees, activityMetric],
  );
  const highestActivityTotal = useMemo(
    () => totalTeamActivities > 0
      ? Math.max(...activityEmployees.map((item) => readActivityMetricValue(item, activityMetric)))
      : 0,
    [activityEmployees, activityMetric, totalTeamActivities],
  );
  const topActivities = useMemo(
    () => activityEmployees.filter(
      (item) => readActivityMetricValue(item, activityMetric) === highestActivityTotal,
    ),
    [activityEmployees, activityMetric, highestActivityTotal],
  );
  const topActivity = topActivities[0] ?? null;
  const lowestActivities = useMemo(() => {
    const candidates = activityEmployees.filter(
      (item) => readActivityMetricValue(item, activityMetric) < highestActivityTotal,
    );
    const lowestTotal = candidates.length > 0
      ? Math.min(...candidates.map((item) => readActivityMetricValue(item, activityMetric)))
      : undefined;
    if (lowestTotal === undefined) {
      return [];
    }

    return candidates.filter(
      (item) => readActivityMetricValue(item, activityMetric) === lowestTotal,
    );
  }, [activityEmployees, activityMetric, highestActivityTotal]);
  const maxEmployeeActivities = Math.max(1, highestActivityTotal);
  const activityChartTicks = useMemo(() => {
    const midpoint = Math.max(0, Math.ceil(maxEmployeeActivities / 2));
    return [...new Set([maxEmployeeActivities, midpoint, 0])].sort((left, right) => right - left);
  }, [maxEmployeeActivities]);
  const selectedActivity =
    activityEmployees.find((item) => item.loginName === selectedEmployeeLoginName) ?? null;
  const hasCallSpecificFilters =
    filters.direction !== "all" || filters.outcome !== "all" || filters.source !== "all";
  const activeFilterCount = useMemo(() => {
    let count = filters.employees.length;
    if (filters.direction !== "all") {
      count += 1;
    }
    if (filters.outcome !== "all") {
      count += 1;
    }
    if (filters.source !== "all") {
      count += 1;
    }
    if (filters.search.trim()) {
      count += 1;
    }
    return count;
  }, [filters]);
  const activePreset = useMemo(() => getActivePreset(filters, defaultNowIso), [defaultNowIso, filters]);
  const maxEmailVolume = useMemo(
    () => Math.max(1, ...(snapshot?.emailLeaderboard.map((item) => item.sentCount) ?? [1])),
    [snapshot?.emailLeaderboard],
  );
  const emailChartTicks = useMemo(() => {
    const midpoint = Math.max(0, Math.ceil(maxEmailVolume / 2));
    return [...new Set([maxEmailVolume, midpoint, 0])].sort((left, right) => right - left);
  }, [maxEmailVolume]);
  const meetingAnalytics = snapshot?.meetingCategoryAnalytics.meetings ?? null;
  const dropOffAnalytics = snapshot?.meetingCategoryAnalytics.dropOffs ?? null;
  const meetingChartEmployees = useMemo(
    () => meetingAnalytics?.leaderboard ?? [],
    [meetingAnalytics?.leaderboard],
  );
  const dropOffChartEmployees = useMemo(
    () => dropOffAnalytics?.leaderboard ?? [],
    [dropOffAnalytics?.leaderboard],
  );
  const maxEmployeeMeetings = useMemo(
    () => Math.max(1, ...meetingChartEmployees.map((item) => item.totalMeetings)),
    [meetingChartEmployees],
  );
  const maxEmployeeDropOffs = useMemo(
    () => Math.max(1, ...dropOffChartEmployees.map((item) => item.totalMeetings)),
    [dropOffChartEmployees],
  );
  const meetingChartTicks = useMemo(() => {
    const midpoint = Math.max(0, Math.ceil(maxEmployeeMeetings / 2));
    return [...new Set([maxEmployeeMeetings, midpoint, 0])].sort((left, right) => right - left);
  }, [maxEmployeeMeetings]);
  const dropOffChartTicks = useMemo(() => {
    const midpoint = Math.max(0, Math.ceil(maxEmployeeDropOffs / 2));
    return [...new Set([maxEmployeeDropOffs, midpoint, 0])].sort((left, right) => right - left);
  }, [maxEmployeeDropOffs]);
  const selectedMeetingEmployee =
    meetingAnalytics?.leaderboard.find(
      (item) => item.loginName === selectedMeetingEmployeeLoginName,
    ) ?? null;
  const selectedDropOffEmployee =
    dropOffAnalytics?.leaderboard.find(
      (item) => item.loginName === selectedDropOffEmployeeLoginName,
    ) ?? null;
  const latestSelectedMeeting = useMemo(() => {
    if (!meetingAnalytics || !selectedMeetingEmployee) {
      return null;
    }

    return (
      meetingAnalytics.recentMeetings.find(
        (meeting) => meeting.actorLoginName === selectedMeetingEmployee.loginName,
      ) ?? null
    );
  }, [meetingAnalytics, selectedMeetingEmployee]);
  const latestSelectedDropOff = useMemo(() => {
    if (!dropOffAnalytics || !selectedDropOffEmployee) {
      return null;
    }

    return (
      dropOffAnalytics.recentMeetings.find(
        (meeting) => meeting.actorLoginName === selectedDropOffEmployee.loginName,
      ) ?? null
    );
  }, [dropOffAnalytics, selectedDropOffEmployee]);
  const selectedMeetingEmployeeRecentMeetings = useMemo(() => {
    if (!meetingAnalytics || !selectedMeetingEmployee) {
      return [];
    }

    return meetingAnalytics.recentMeetings
      .filter((meeting) => meeting.actorLoginName === selectedMeetingEmployee.loginName)
      .slice(0, 5);
  }, [meetingAnalytics, selectedMeetingEmployee]);
  const selectedDropOffEmployeeRecentMeetings = useMemo(() => {
    if (!dropOffAnalytics || !selectedDropOffEmployee) {
      return [];
    }

    return dropOffAnalytics.recentMeetings
      .filter((meeting) => meeting.actorLoginName === selectedDropOffEmployee.loginName)
      .slice(0, 5);
  }, [dropOffAnalytics, selectedDropOffEmployee]);

  function toggleEmployee(loginName: string, checked: boolean): void {
    const nextEmployees = checked
      ? [...new Set([...filters.employees, loginName])]
      : filters.employees.filter((value) => value !== loginName);
    updateFilters({ employees: nextEmployees });
  }

  function selectEmployee(loginName: string): void {
    const isOnlySelectedEmployee =
      appliedEmployeeFilters.length === 1 && selectedEmployeeLoginName === loginName;
    updateFilters({ employees: isOnlySelectedEmployee ? [] : [loginName] });
  }

  function selectMeetingEmployee(loginName: string): void {
    setSelectedMeetingEmployeeLoginName(loginName);
  }

  function selectDropOffEmployee(loginName: string): void {
    setSelectedDropOffEmployeeLoginName(loginName);
  }

  function renderMeetingCategoryCard(input: {
    category: MeetingCategory;
    chartEmployees: DashboardSnapshotResponse["meetingLeaderboard"];
    chartTicks: number[];
    maxValue: number;
    stats: DashboardSnapshotResponse["meetingStats"];
    selectedEmployee: DashboardSnapshotResponse["meetingLeaderboard"][number] | null;
    latestSelectedMeeting: DashboardSnapshotResponse["recentMeetings"][number] | null;
    recentMeetings: DashboardSnapshotResponse["recentMeetings"];
    onSelectEmployee: (loginName: string) => void;
  }) {
    const categoryLowerLabel = formatMeetingCategoryLowerLabel(input.category);
    const title = formatMeetingCategoryTitle(input.category);
    const rows = input.chartEmployees.slice(0, 4);
    const panelHref = input.selectedEmployee
      ? buildMeetingCategoryAuditHref(input.selectedEmployee.loginName, input.category)
      : buildMeetingCategoryAllAuditHref(input.category);
    const emptyLabel = input.category === "Drop Off" ? "drop-offs" : "meetings";

    return (
      <article className={styles.bookingCard}>
        <div className={styles.bookingHeader}>
          <div className={styles.bookingTitleGroup}>
            <span className={styles.chartTitleIcon}>
              {input.category === "Drop Off" ? <DropOffIcon /> : <PriorityCardIconGraphic icon="meetings" />}
            </span>
            <h2 className={styles.chartTitle}>{title}</h2>
          </div>
          {input.selectedEmployee ? (
            <span className={styles.softBadge}>{input.selectedEmployee.displayName}</span>
          ) : null}
        </div>

        {rows.length ? (
          <ol className={styles.bookingList}>
            {rows.map((item, index) => {
              const isActive = item.loginName === input.selectedEmployee?.loginName;
              const sparklineValues = buildBookingSparklineValues(item.totalMeetings, index);

              return (
                <li className={styles.bookingListItem} key={`${input.category}-${item.loginName}`}>
                  <button
                    className={`${styles.bookingRow} ${isActive ? styles.bookingRowActive : ""}`}
                    onClick={() => input.onSelectEmployee(item.loginName)}
                    title={`${item.displayName}: ${item.totalMeetings.toLocaleString()} ${categoryLowerLabel}s booked`}
                    type="button"
                  >
                    <span className={styles.bookingRank}>{index + 1}</span>
                    <span className={styles.bookingAvatar}>{getInitials(item.displayName)}</span>
                    <span className={styles.bookingCopy}>
                      <strong>{item.displayName}</strong>
                      <span>{formatBookingRowMeta(item, input.stats.totalMeetings, input.category)}</span>
                    </span>
                    <span aria-hidden="true" className={styles.bookingSparkline}>
                      {sparklineValues.map((value, barIndex) => (
                        <span
                          className={styles.bookingSparklineBar}
                          key={`${input.category}-${item.loginName}-${barIndex}`}
                          style={{ height: `${value}px` }}
                        />
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.emptyState}>No {emptyLabel} were booked in the current range.</p>
        )}

        <a className={styles.bookingFooterLink} href={panelHref}>
          View all {emptyLabel}
          <span className={styles.buttonIcon}>
            <ArrowRightIcon />
          </span>
        </a>
      </article>
    );
  }

  return (
    <DashboardShell
      activeTab="overview"
      onRefresh={handleManualRefresh}
      refreshing={refreshing}
      showPageHeaderCopy
      showSectionNav={false}
      subtitle="Real-time overview of sales outreach and engagement."
      title="Sales Dashboard"
    >
      <section className={styles.controlBar}>
        <div className={styles.controlRow}>
          <div className={styles.quickRanges}>
            {DASHBOARD_PRESETS.map((preset) => {
              const isActive = activePreset === preset.key;

              return (
                <button
                  aria-pressed={isActive}
                  className={[styles.quickButton, isActive ? styles.quickButtonActive : null]
                    .filter(Boolean)
                    .join(" ")}
                  key={preset.key}
                  onClick={() => applyPreset(preset.key)}
                  type="button"
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className={styles.controlInputs}>
            <label className={styles.compactField}>
              <span>Start</span>
              <input
                className={styles.filterInput}
                onChange={(event) =>
                  updateFilters({ start: new Date(`${event.target.value}T00:00:00`).toISOString() })
                }
                type="date"
                value={formatDashboardDateInputValue(filters.start)}
              />
            </label>
            <label className={styles.compactField}>
              <span>End</span>
              <input
                className={styles.filterInput}
                onChange={(event) =>
                  updateFilters({ end: new Date(`${event.target.value}T23:59:59`).toISOString() })
                }
                type="date"
                value={formatDashboardDateInputValue(filters.end)}
              />
            </label>
            <button
              className={styles.filterToggle}
              onClick={() => setShowFiltersPanel((current) => !current)}
              type="button"
            >
              <span className={styles.buttonIcon}>
                <FilterIcon />
              </span>
              {showFiltersPanel ? "Hide filters" : `Filters${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
            </button>
            <button
              className={styles.filterToggle}
              disabled={refreshing}
              onClick={() => void handleManualRefresh()}
              type="button"
            >
              <span className={styles.buttonIcon}>
                <RefreshIcon />
              </span>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <a className={styles.primaryActionLink} href={buildExplorerHref(filters)}>
              Open Explorer
              <span className={styles.buttonIcon}>
                <ExternalLinkIcon />
              </span>
            </a>
          </div>
        </div>

        {showFiltersPanel ? (
          <div className={styles.filtersPanel}>
            <div className={styles.employeeHeader}>
              <strong>Employees</strong>
              <div className={styles.employeeQuickActions}>
                <button className={styles.ghostButton} onClick={() => updateFilters({ employees: [] })} type="button">
                  Everyone
                </button>
                {snapshot?.viewer.loginName ? (
                  <button
                    className={styles.ghostButton}
                    onClick={() => updateFilters({ employees: [snapshot.viewer.loginName as string] })}
                    type="button"
                  >
                    Me
                  </button>
                ) : null}
              </div>
            </div>

            <input
              className={styles.filterInput}
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Search employees"
              value={employeeSearch}
            />
            <div className={styles.employeeGrid}>
              {employeeOptions.map((employee) => (
                <label className={styles.employeePill} key={employee.loginName}>
                  <input
                    checked={filters.employees.includes(employee.loginName)}
                    onChange={(event) => toggleEmployee(employee.loginName, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{employee.displayName}</span>
                  <small>{employee.loginName}</small>
                </label>
              ))}
            </div>

            <div className={styles.filterGrid}>
              <label className={styles.filterField}>
                Direction
                <select
                  className={styles.filterSelect}
                  onChange={(event) =>
                    updateFilters({ direction: event.target.value as DashboardFilters["direction"] })
                  }
                  value={filters.direction}
                >
                  <option value="all">All</option>
                  <option value="outbound">Outbound</option>
                  <option value="inbound">Inbound</option>
                </select>
              </label>
              <label className={styles.filterField}>
                Outcome
                <select
                  className={styles.filterSelect}
                  onChange={(event) =>
                    updateFilters({ outcome: event.target.value as DashboardFilters["outcome"] })
                  }
                  value={filters.outcome}
                >
                  <option value="all">All</option>
                  <option value="answered">Answered</option>
                  <option value="unanswered">Unanswered</option>
                  <option value="busy">Busy</option>
                  <option value="failed">Failed</option>
                  <option value="canceled">Canceled</option>
                </select>
              </label>
              <label className={styles.filterField}>
                Source
                <select
                  className={styles.filterSelect}
                  onChange={(event) =>
                    updateFilters({ source: event.target.value as DashboardFilters["source"] })
                  }
                  value={filters.source}
                >
                  <option value="all">All Twilio</option>
                  <option value="app">App calls</option>
                  <option value="non_app">Non-app Twilio</option>
                </select>
              </label>
              <label className={`${styles.filterField} ${styles.searchSpan}`}>
                Search
                <input
                  className={styles.filterInput}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Company, contact, employee, phone, Twilio SID"
                  value={searchDraft}
                />
              </label>
            </div>
          </div>
        ) : null}
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading && !snapshot ? <p className={styles.loadingText}>Loading dashboard snapshot...</p> : null}

      {snapshot ? (
        <>
          <section className={styles.priorityGrid}>
            {buildPriorityCards(snapshot.teamStats, snapshot.meetingStats, snapshot.emailStats).map((card) => (
              <article className={styles.priorityCard} key={card.label}>
                <span className={styles.priorityIcon}>
                  <PriorityCardIconGraphic icon={card.icon} />
                </span>
                <span className={styles.priorityCopy}>
                  <small>{card.label}</small>
                  <strong>{card.value}</strong>
                  {card.meta ? <span>{card.meta}</span> : null}
                </span>
              </article>
            ))}
          </section>

          <DashboardStatusBar
            backgroundRefreshTriggered={snapshot.backgroundRefreshTriggered}
            importLabel={readStatusLabel(snapshot)}
            lastUpdatedAt={snapshot.importState.updatedAt}
            lastWebhookAt={snapshot.importState.lastWebhookAt}
          />

          <section className={styles.heroGrid}>
            <article aria-busy={loading} className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <div className={styles.bookingTitleGroup}>
                  <span className={styles.chartTitleIcon}>
                    <PriorityCardIconGraphic icon="calls" />
                  </span>
                  <div>
                    <h2 className={styles.chartTitle}>Activity mix</h2>
                    <p className={styles.chartMeta}>
                      Calls, meetings, drop-offs, emails, and notes. Select a rep to filter every KPI.
                    </p>
                  </div>
                </div>
                <div className={styles.chartControls}>
                  <select
                    aria-label="Filter Activity mix by activity type"
                    className={styles.chartSelect}
                    onChange={(event) => setActivityMetric(event.target.value as ActivityMetricKey)}
                    value={activityMetric}
                  >
                    {ACTIVITY_FILTER_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter all dashboard KPIs by sales rep"
                    className={styles.chartSelect}
                    disabled={loading}
                    onChange={(event) =>
                      updateFilters({ employees: event.target.value ? [event.target.value] : [] })
                    }
                    value={activityRepFilterValue}
                  >
                    <option value="">All reps</option>
                    {appliedEmployeeFilters.length > 1 ? (
                      <option disabled value={MULTIPLE_EMPLOYEE_FILTER_VALUE}>
                        {appliedEmployeeFilters.length.toLocaleString()} reps selected
                      </option>
                    ) : null}
                    {activityRepOptions.map((item) => (
                      <option key={item.loginName} value={item.loginName}>
                        {item.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.chartLegend}>
                {ACTIVITY_SEGMENTS.map((segment) => (
                  <Fragment key={segment.key}>
                    <span className={styles.legendItem}>
                      <span className={getActivityLegendClassName(segment.key)} />
                      {segment.label}
                    </span>
                    {segment.key === "calls" ? (
                      <span className={styles.legendItem}>
                        <span className={styles.legendSwatchConnected} />
                        Connected calls
                      </span>
                    ) : null}
                  </Fragment>
                ))}
              </div>
              {hasCallSpecificFilters ? (
                <p className={styles.activityFilterNote}>
                  Direction, outcome, and source filters apply to the Calls segment only.
                </p>
              ) : null}

              {totalTeamActivities > 0 && (topActivity || lowestActivities.length) ? (
                <div className={styles.callerSpotlightGrid}>
                  {topActivity ? (
                    <div className={styles.callerSpotlight}>
                      <span className={styles.callerSpotlightLabel}>
                        Most {activityMetric === "all" ? "activity" : readActivityMetricLabel(activityMetric).toLowerCase()}
                      </span>
                      <strong>{formatNameList(topActivities.map((activity) => activity.displayName))}</strong>
                      <span>
                        {topActivities.length === 1
                          ? `${activityMetric === "all"
                              ? formatActivityBreakdown(topActivity)
                              : formatActivityMetricCount(readActivityMetricValue(topActivity, activityMetric), activityMetric)} · ${formatActivityShare(readActivityMetricValue(topActivity, activityMetric), totalTeamActivities)}`
                          : `${formatActivityMetricCount(readActivityMetricValue(topActivity, activityMetric), activityMetric)} each · ${topActivities.length.toLocaleString()} reps tied for the lead`}
                      </span>
                    </div>
                  ) : null}

                  {lowestActivities.length ? (
                    <div className={`${styles.callerSpotlight} ${styles.callerSpotlightQuiet}`}>
                      <span className={styles.callerSpotlightLabel}>
                        Fewest {activityMetric === "all" ? "activity" : readActivityMetricLabel(activityMetric).toLowerCase()}
                      </span>
                      <strong>{formatNameList(lowestActivities.map((activity) => activity.displayName))}</strong>
                      <span>{formatLowestActivityMeta(lowestActivities, activityMetric)}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activityEmployees.length ? (
                <div className={styles.chartFrame}>
                  <div aria-hidden="true" className={styles.chartYAxis}>
                    {activityChartTicks.map((tick) => (
                      <span className={styles.chartYAxisValue} key={tick}>
                        {tick.toLocaleString()}
                      </span>
                    ))}
                  </div>

                  <div className={styles.chartViewport}>
                    <div className={styles.trendChart}>
                      {activityEmployees.map((item) => {
                        const isActive = item.loginName === selectedEmployeeLoginName;
                        const displayedActivityValue = readActivityMetricValue(item, activityMetric);

                        return (
                          <div className={styles.trendColumn} key={item.loginName}>
                            <button
                              aria-label={buildActivityAriaLabel(item)}
                              aria-pressed={isActive}
                              className={`${styles.trendButton} ${isActive ? styles.trendButtonActive : ""}`}
                              disabled={loading}
                              onClick={() => selectEmployee(item.loginName)}
                              type="button"
                            >
                              <span aria-hidden="true" className={styles.activityTooltip}>
                                <strong>
                                  {item.displayName} · {formatActivityMetricCount(displayedActivityValue, activityMetric)}
                                </strong>
                                {activityMetric !== "all" ? (
                                  <small className={styles.activityTooltipMetricNote}>
                                    {item.totalActivities.toLocaleString()} total activities across all types
                                  </small>
                                ) : null}
                                <span className={styles.activityTooltipList}>
                                  {ACTIVITY_SEGMENTS.map((segment) => (
                                    <Fragment key={segment.key}>
                                      <span className={styles.activityTooltipRow}>
                                        <span className={getActivityLegendClassName(segment.key)} />
                                        <span>{segment.label}</span>
                                        <b>{item[segment.key].toLocaleString()}</b>
                                      </span>
                                      {segment.key === "calls" ? (
                                        <span className={`${styles.activityTooltipRow} ${styles.activityTooltipRowSubset}`}>
                                          <span className={styles.legendSwatchConnected} />
                                          <span>Connected calls (included)</span>
                                          <b>{item.connectedCalls.toLocaleString()}</b>
                                        </span>
                                      ) : null}
                                    </Fragment>
                                  ))}
                                </span>
                              </span>
                              <span className={styles.trendValue}>{displayedActivityValue.toLocaleString()}</span>
                              <div className={styles.trendBarTrack}>
                                <div
                                  className={styles.activityStack}
                                  style={{ height: `${(displayedActivityValue / maxEmployeeActivities) * 100}%` }}
                                >
                                  {activityMetric === "connectedCalls" ? (
                                    item.connectedCalls > 0 ? (
                                      <span
                                        aria-hidden="true"
                                        className={`${styles.activitySegment} ${styles.activitySegmentConnected}`}
                                        style={{ flexGrow: item.connectedCalls }}
                                      />
                                    ) : null
                                  ) : (
                                    visibleActivitySegments.map((segment) => {
                                      const count = item[segment.key];
                                      return count > 0 ? (
                                        <span
                                          aria-hidden="true"
                                          className={`${styles.activitySegment} ${getActivitySegmentClassName(segment.key)}`}
                                          key={segment.key}
                                          style={{ flexGrow: count }}
                                        >
                                          {segment.key === "calls" ? (
                                            <span
                                              className={styles.activityConnectedFill}
                                              style={{ height: `${(item.connectedCalls / item.calls) * 100}%` }}
                                            />
                                          ) : null}
                                        </span>
                                      ) : null;
                                    })
                                  )}
                                </div>
                              </div>
                              <div className={styles.trendFooter}>
                                <span className={styles.trendLabel}>{item.displayName}</span>
                                <span className={styles.trendMeta}>{formatActivityChartFooter(item, activityMetric)}</span>
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <p className={styles.emptyState}>No employee activity matched these filters.</p>
              )}

              {selectedActivity ? (
                <section aria-label={`${selectedActivity.displayName} activity breakdown`} className={styles.activitySelectionPanel}>
                  <div className={styles.activitySelectionHeader}>
                    <div>
                      <span>Selected rep</span>
                      <strong>{selectedActivity.displayName}</strong>
                    </div>
                    <strong>{selectedActivity.totalActivities.toLocaleString()} total activities</strong>
                  </div>
                  <div className={styles.activitySelectionGrid}>
                    {ACTIVITY_SEGMENTS.map((segment) => (
                      <div className={styles.activitySelectionStat} key={segment.key}>
                        <span className={`${styles.activitySelectionSwatch} ${getActivityLegendClassName(segment.key)}`} />
                        <span>{segment.label}</span>
                        <strong>{selectedActivity[segment.key].toLocaleString()}</strong>
                        {segment.key === "calls" ? (
                          <small className={styles.activityConnectedMeta}>
                            <span className={styles.legendSwatchConnected} />
                            {selectedActivity.connectedCalls.toLocaleString()} connected calls
                          </small>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

            </article>

            <article className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <div className={styles.bookingTitleGroup}>
                  <span className={styles.chartTitleIcon}>
                    <PriorityCardIconGraphic icon="emails" />
                  </span>
                  <div>
                    <h2 className={styles.chartTitle}>Email activity</h2>
                    <p className={styles.chartMeta}>Email activity by sender for the current range.</p>
                  </div>
                </div>
                {snapshot.emailStats.busiestSenderDisplayName ? (
                  <span className={styles.softBadge}>
                    Busiest: {snapshot.emailStats.busiestSenderDisplayName} · {snapshot.emailStats.busiestSenderCount.toLocaleString()}
                  </span>
                ) : null}
              </div>

              <div className={styles.emailStatRow}>
                <div className={styles.miniMetric}>
                  <small>Total sent</small>
                  <strong>{snapshot.emailStats.totalSent.toLocaleString()}</strong>
                </div>
                <div className={styles.miniMetric}>
                  <small>Active senders</small>
                  <strong>{snapshot.emailStats.uniqueSenders.toLocaleString()}</strong>
                </div>
                <div className={styles.miniMetric}>
                  <small>Avg per sender</small>
                  <strong>{snapshot.emailStats.averagePerSender.toFixed(1)}</strong>
                </div>
              </div>

              {snapshot.emailLeaderboard.length ? (
                <div className={styles.chartFrame}>
                  <div aria-hidden="true" className={styles.chartYAxis}>
                    {emailChartTicks.map((tick) => (
                      <span className={styles.chartYAxisValue} key={tick}>
                        {tick.toLocaleString()}
                      </span>
                    ))}
                  </div>

                  <div className={styles.chartViewport}>
                    <div className={styles.emailTrendChart}>
                      {snapshot.emailLeaderboard.map((item) => {
                        const canSelectSender = Boolean(
                          item.loginName &&
                          activityEmployees.some((employee) => employee.loginName === item.loginName),
                        );
                        const isActive = Boolean(
                          item.loginName && item.loginName === selectedEmployeeLoginName,
                        );
                        const senderLabel = item.displayName || item.loginName || "Unknown sender";
                        const content = (
                          <>
                            <span className={styles.trendValue}>{item.sentCount.toLocaleString()}</span>
                            <div className={styles.emailTrendBarTrack}>
                              <div
                                className={styles.emailTrendBar}
                                style={{ height: `${(item.sentCount / maxEmailVolume) * 100}%` }}
                              />
                            </div>
                            <div className={styles.trendFooter}>
                              <span className={styles.emailTrendLabel}>{senderLabel}</span>
                              <span className={styles.trendMeta}>
                                {item.sentCount.toLocaleString()} sent
                              </span>
                            </div>
                          </>
                        );

                        return (
                          <div className={styles.emailTrendColumn} key={item.loginName ?? senderLabel}>
                            {canSelectSender ? (
                              <button
                                className={`${styles.emailTrendButton} ${isActive ? styles.emailTrendButtonActive : ""}`}
                                disabled={loading}
                                onClick={() => selectEmployee(item.loginName as string)}
                                title={`${senderLabel}: ${item.sentCount.toLocaleString()} sent`}
                                type="button"
                              >
                                {content}
                              </button>
                            ) : (
                              <div className={styles.emailTrendButton}>{content}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.emailEmptyState}>
                  <span className={styles.emailEmptyIcon}>
                    <PriorityCardIconGraphic icon="emails" />
                  </span>
                  <p>No sent emails matched the current range.</p>
                </div>
              )}
            </article>
          </section>

          <section className={styles.summarySection}>
            <div className={styles.dualChartGrid}>
              {renderMeetingCategoryCard({
                category: "Meeting",
                chartEmployees: meetingChartEmployees,
                chartTicks: meetingChartTicks,
                maxValue: maxEmployeeMeetings,
                stats: meetingAnalytics?.stats ?? snapshot.meetingStats,
                selectedEmployee: selectedMeetingEmployee,
                latestSelectedMeeting,
                recentMeetings: selectedMeetingEmployeeRecentMeetings,
                onSelectEmployee: selectMeetingEmployee,
              })}
              {renderMeetingCategoryCard({
                category: "Drop Off",
                chartEmployees: dropOffChartEmployees,
                chartTicks: dropOffChartTicks,
                maxValue: maxEmployeeDropOffs,
                stats: dropOffAnalytics?.stats ?? snapshot.meetingStats,
                selectedEmployee: selectedDropOffEmployee,
                latestSelectedMeeting: latestSelectedDropOff,
                recentMeetings: selectedDropOffEmployeeRecentMeetings,
                onSelectEmployee: selectDropOffEmployee,
              })}
            </div>
          </section>
        </>
      ) : null}
    </DashboardShell>
  );
}
