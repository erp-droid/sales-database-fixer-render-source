"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
  formatDateTime,
  formatDuration,
  formatOutcomeLabel,
  formatPercent,
  readJsonResponse,
} from "./dashboard-ui";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVE_REFRESH_INTERVAL_MS = 2_000;

type ErrorPayload = {
  error?: string;
};

function formatCountWithTotalShare(count: number, total: number): string {
  const share = total > 0 ? count / total : 0;
  return `${count.toLocaleString()} · ${formatPercent(share)}`;
}

function buildPriorityCards(
  stats: DashboardSnapshotResponse["teamStats"],
  meetingStats: DashboardSnapshotResponse["meetingStats"],
  emailStats: DashboardSnapshotResponse["emailStats"],
): Array<{ label: string; value: string; meta?: string }> {
  return [
    {
      label: "Calls",
      value: stats.totalCalls.toLocaleString(),
      meta: `${stats.outboundCalls.toLocaleString()} outbound • ${stats.inboundCalls.toLocaleString()} inbound`,
    },
    {
      label: "Meetings booked",
      value: meetingStats.totalMeetings.toLocaleString(),
      meta: `${meetingStats.uniqueBookers.toLocaleString()} creators in the current range`,
    },
    { label: "Connection rate", value: formatPercent(stats.answerRate) },
    {
      label: "Talk time",
      value: formatDuration(stats.totalTalkSeconds),
      meta: `${formatDuration(stats.averageTalkSeconds)} avg connected`,
    },
    {
      label: "Emails sent",
      value: emailStats.totalSent.toLocaleString(),
      meta:
        emailStats.busiestSenderDisplayName && emailStats.busiestSenderCount > 0
          ? `${emailStats.busiestSenderDisplayName} leads with ${emailStats.busiestSenderCount.toLocaleString()}`
          : `${emailStats.uniqueSenders.toLocaleString()} active senders`,
    },
  ];
}

function buildSelectedEmployeeCards(
  employee: DashboardSnapshotResponse["employeeLeaderboard"][number],
  emailCount: number,
): Array<{ label: string; value: string; meta?: string }> {
  return [
    { label: "Total calls", value: employee.totalCalls.toLocaleString() },
    { label: "Connected", value: employee.answeredCalls.toLocaleString() },
    { label: "Talk time", value: formatDuration(employee.talkSeconds) },
    {
      label: "Emails sent",
      value: emailCount.toLocaleString(),
      meta: `${formatPercent(employee.answerRate)} connection rate`,
    },
  ];
}

function buildSelectedMeetingCards(
  employee: DashboardSnapshotResponse["meetingLeaderboard"][number],
  totalMeetings: number,
  category: MeetingCategory,
): Array<{ label: string; value: string; meta?: string }> {
  const shareOfTotal = totalMeetings > 0 ? employee.totalMeetings / totalMeetings : 0;
  const categoryLowerLabel = formatMeetingCategoryLowerLabel(category);
  const inviteeValue =
    employee.meetingsWithUnknownAttendeeCount > 0 && employee.totalAttendees === 0
      ? "Unknown"
      : employee.totalAttendees.toLocaleString();
  const inviteeMeta =
    employee.meetingsWithUnknownAttendeeCount > 0
      ? `${employee.meetingsWithUnknownAttendeeCount.toLocaleString()} imported ${categoryLowerLabel}${
          employee.meetingsWithUnknownAttendeeCount === 1 ? "" : "s"
        } with unknown attendee counts`
      : `${employee.averageAttendees.toFixed(1)} avg invitees`;

  return [
    {
      label: category === "Drop Off" ? "Drop offs booked" : "Meetings booked",
      value: employee.totalMeetings.toLocaleString(),
      meta: `${formatPercent(shareOfTotal)} of total`,
    },
    {
      label: "Invitees",
      value: inviteeValue,
      meta: inviteeMeta,
    },
    {
      label: "Last booked",
      value: employee.lastMeetingAt ? formatDateTime(employee.lastMeetingAt) : "No meetings",
    },
  ];
}

function buildMeetingActivityLabel(meeting: DashboardSnapshotResponse["recentMeetings"][number]): string {
  return (
    meeting.meetingSummary.trim() ||
    meeting.companyName?.trim() ||
    meeting.contactName?.trim() ||
    "Meeting created"
  );
}

function buildMeetingRecordLabel(meeting: DashboardSnapshotResponse["recentMeetings"][number]): string {
  if (meeting.companyName && meeting.contactName) {
    return `${meeting.companyName} / ${meeting.contactName}`;
  }
  return meeting.companyName ?? meeting.contactName ?? "No linked company or contact";
}

function buildMeetingSourceLabel(meeting: DashboardSnapshotResponse["recentMeetings"][number]): string {
  return meeting.inviteAuthority === null && meeting.calendarInviteStatus === null
    ? "Imported history"
    : "App meeting";
}

function buildMeetingInviteeLabel(meeting: DashboardSnapshotResponse["recentMeetings"][number]): string {
  if (meeting.attendeeCount === 0 && meeting.inviteAuthority === null && meeting.calendarInviteStatus === null) {
    return "Invitees unknown";
  }

  return `${meeting.attendeeCount.toLocaleString()} invitee${meeting.attendeeCount === 1 ? "" : "s"}`;
}

function formatMeetingCategoryTitle(category: MeetingCategory): string {
  return category === "Drop Off" ? "Drop Offs booked" : "Meetings booked";
}

function formatMeetingCategoryLegend(category: MeetingCategory): string {
  return category === "Drop Off" ? "Total drop offs" : "Total meetings";
}

function formatMeetingCategoryMeta(category: MeetingCategory): string {
  return category === "Drop Off"
    ? "Drop offs attributed to known users for the current range, grouped by creator."
    : "Meetings and all other non-drop-off categories attributed to known users for the current range, grouped by creator.";
}

function formatMeetingCategoryLowerLabel(category: MeetingCategory): string {
  return category === "Drop Off" ? "drop off" : "meeting";
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

function buildEmailActivityLabel(email: DashboardSnapshotResponse["recentEmails"][number]): string {
  return (
    email.subject?.trim() ||
    email.companyName?.trim() ||
    email.contactName?.trim() ||
    "Sent email"
  );
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

function mergeFilters(filters: DashboardFilters, next: Partial<DashboardFilters>): DashboardFilters {
  return {
    ...filters,
    ...next,
  };
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
  const [selectedEmployeeLoginName, setSelectedEmployeeLoginName] = useState<string | null>(null);
  const [selectedMeetingEmployeeLoginName, setSelectedMeetingEmployeeLoginName] = useState<string | null>(null);
  const [selectedDropOffEmployeeLoginName, setSelectedDropOffEmployeeLoginName] = useState<string | null>(null);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState(filters.search);

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

  function applyPreset(days: number): void {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    replaceFilters({
      ...filters,
      start: start.toISOString(),
      end: end.toISOString(),
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
    if (!snapshot?.employeeLeaderboard.length) {
      setSelectedEmployeeLoginName(null);
      return;
    }

    const hasSelectedEmployee = snapshot.employeeLeaderboard.some(
      (item) => item.loginName === selectedEmployeeLoginName,
    );
    if (!hasSelectedEmployee) {
      setSelectedEmployeeLoginName(snapshot.employeeLeaderboard[0]?.loginName ?? null);
    }
  }, [selectedEmployeeLoginName, snapshot]);

  useEffect(() => {
    const leaderboard = snapshot?.meetingCategoryAnalytics.meetings.leaderboard ?? [];
    if (!leaderboard.length) {
      setSelectedMeetingEmployeeLoginName(null);
      return;
    }

    const hasSelectedEmployee = leaderboard.some(
      (item) => item.loginName === selectedMeetingEmployeeLoginName,
    );
    if (!hasSelectedEmployee) {
      setSelectedMeetingEmployeeLoginName(leaderboard[0]?.loginName ?? null);
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
    if (!hasSelectedEmployee) {
      setSelectedDropOffEmployeeLoginName(leaderboard[0]?.loginName ?? null);
    }
  }, [selectedDropOffEmployeeLoginName, snapshot?.meetingCategoryAnalytics.dropOffs.leaderboard]);

  const useActiveRefresh = shouldUseActiveRefresh(snapshot);

  useEffect(() => {
    let cancelled = false;
    const intervalMs = useActiveRefresh ? ACTIVE_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;

    async function refreshSnapshotInPlace() {
      try {
        const query = buildDashboardQueryString(filters);
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

    function handleFocus() {
      void refreshSnapshotInPlace();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentQuery, filters, useActiveRefresh]);

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

      const query = buildDashboardQueryString(filters);
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

  const chartEmployees = useMemo(() => snapshot?.employeeLeaderboard ?? [], [snapshot?.employeeLeaderboard]);
  const maxEmployeeCalls = useMemo(
    () => Math.max(1, ...chartEmployees.map((item) => item.totalCalls)),
    [chartEmployees],
  );
  const chartTicks = useMemo(() => {
    const midpoint = Math.max(0, Math.ceil(maxEmployeeCalls / 2));
    return [...new Set([maxEmployeeCalls, midpoint, 0])].sort((left, right) => right - left);
  }, [maxEmployeeCalls]);
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
  const selectedEmployee =
    snapshot?.employeeLeaderboard.find((item) => item.loginName === selectedEmployeeLoginName) ?? null;
  const selectedEmployeeRecentCalls = useMemo(() => {
    if (!snapshot || !selectedEmployee) {
      return [];
    }

    return snapshot.recentCalls
      .filter((call) => call.employeeLoginName === selectedEmployee.loginName)
      .slice(0, 5);
  }, [selectedEmployee, snapshot]);
  const selectedEmployeeEmailActivity = useMemo(() => {
    if (!snapshot || !selectedEmployee) {
      return null;
    }

    return (
      snapshot.emailLeaderboard.find((item) => item.loginName === selectedEmployee.loginName) ?? null
    );
  }, [selectedEmployee, snapshot]);
  const latestSelectedEmail = useMemo(() => {
    if (!snapshot || !selectedEmployee) {
      return null;
    }

    return (
      snapshot.recentEmails.find((email) => email.actorLoginName === selectedEmployee.loginName) ?? null
    );
  }, [selectedEmployee, snapshot]);
  const maxEmailVolume = useMemo(
    () => Math.max(1, ...(snapshot?.emailLeaderboard.map((item) => item.sentCount) ?? [1])),
    [snapshot?.emailLeaderboard],
  );
  const emailChartTicks = useMemo(() => {
    const midpoint = Math.max(0, Math.ceil(maxEmailVolume / 2));
    return [...new Set([maxEmailVolume, midpoint, 0])].sort((left, right) => right - left);
  }, [maxEmailVolume]);
  const latestSelectedCall = selectedEmployeeRecentCalls[0] ?? null;
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

  function openExplorerForEmployee(loginName: string): void {
    const nextFilters = {
      ...filters,
      employees: loginName ? [loginName] : [],
    };
    router.push(buildExplorerHref(nextFilters));
  }

  function toggleEmployee(loginName: string, checked: boolean): void {
    const nextEmployees = checked
      ? [...new Set([...filters.employees, loginName])]
      : filters.employees.filter((value) => value !== loginName);
    updateFilters({ employees: nextEmployees });
  }

  function selectEmployee(loginName: string): void {
    setSelectedEmployeeLoginName(loginName);
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

    return (
      <article className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <div>
            <h2 className={styles.chartTitle}>{formatMeetingCategoryTitle(input.category)}</h2>
            <p className={styles.chartMeta}>{formatMeetingCategoryMeta(input.category)}</p>
          </div>
          {input.selectedEmployee ? (
            <span className={styles.softBadge}>{input.selectedEmployee.displayName}</span>
          ) : null}
        </div>

        <div className={styles.chartLegend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} />
            {formatMeetingCategoryLegend(input.category)}
          </span>
        </div>

        {input.chartEmployees.length ? (
          <div className={styles.chartFrame}>
            <div aria-hidden="true" className={styles.chartYAxis}>
              {input.chartTicks.map((tick) => (
                <span className={styles.chartYAxisValue} key={`${input.category}-${tick}`}>
                  {tick.toLocaleString()}
                </span>
              ))}
            </div>

            <div className={styles.chartViewport}>
              <div className={styles.trendChart}>
                {input.chartEmployees.map((item) => {
                  const isActive = item.loginName === input.selectedEmployee?.loginName;
                  const shareOfMeetings = input.stats.totalMeetings > 0
                    ? item.totalMeetings / input.stats.totalMeetings
                    : 0;

                  return (
                    <div className={styles.trendColumn} key={`${input.category}-${item.loginName}`}>
                      <button
                        className={`${styles.trendButton} ${isActive ? styles.trendButtonActive : ""}`}
                        onClick={() => input.onSelectEmployee(item.loginName)}
                        title={`${item.displayName}: ${formatCountWithTotalShare(
                          item.totalMeetings,
                          input.stats.totalMeetings,
                        )} ${categoryLowerLabel}s booked`}
                        type="button"
                      >
                        <span className={styles.trendValue}>
                          {formatCountWithTotalShare(
                            item.totalMeetings,
                            input.stats.totalMeetings,
                          )}
                        </span>
                        <div className={styles.trendBarTrack}>
                          <div
                            className={styles.trendBarTotal}
                            style={{ height: `${(item.totalMeetings / input.maxValue) * 100}%` }}
                          />
                        </div>
                        <div className={styles.trendFooter}>
                          <span className={styles.trendLabel}>{item.displayName}</span>
                          <span className={styles.trendMeta}>
                            {item.meetingsWithUnknownAttendeeCount > 0 && item.totalAttendees === 0
                              ? `Invitees unknown · ${formatPercent(shareOfMeetings)}`
                              : `${item.totalAttendees.toLocaleString()} invitees · ${formatPercent(shareOfMeetings)}`}
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className={styles.emptyState}>
            No {input.category === "Drop Off" ? "drop offs" : "meetings"} were booked in the current range.
          </p>
        )}

        {input.selectedEmployee ? (
          <div className={styles.selectionPanel}>
            <div className={styles.selectionHeader}>
              <div>
                <p className={styles.sectionKicker}>Selected</p>
                <h3 className={styles.selectionTitle}>{input.selectedEmployee.displayName}</h3>
              </div>
              <div className={styles.selectionFeed}>
                <a
                  className={styles.summaryLink}
                  href={buildMeetingCategoryAuditHref(input.selectedEmployee.loginName, input.category)}
                >
                  Open {categoryLowerLabel} audit
                </a>
              </div>
            </div>

            <div className={styles.selectionStats}>
              {buildSelectedMeetingCards(
                input.selectedEmployee,
                input.stats.totalMeetings,
                input.category,
              ).map((card) => (
                <div
                  className={styles.selectionStat}
                  key={`${input.category}-${input.selectedEmployee?.loginName}-${card.label}`}
                >
                  <small>{card.label}</small>
                  <strong>{card.value}</strong>
                  {card.meta ? <span>{card.meta}</span> : null}
                </div>
              ))}
            </div>

            <div className={styles.selectionFeed}>
              <div className={styles.selectionFeedItem}>
                <span className={styles.selectionFeedLabel}>
                  Latest {categoryLowerLabel}
                </span>
                <span>
                  {input.latestSelectedMeeting
                    ? `${buildMeetingActivityLabel(input.latestSelectedMeeting)} · ${
                        input.latestSelectedMeeting.companyName ??
                        input.latestSelectedMeeting.contactName ??
                        "Unknown account"
                      } · ${formatDateTime(input.latestSelectedMeeting.occurredAt)}`
                    : `No recent ${categoryLowerLabel}s in the current range.`}
                </span>
              </div>
              <div className={styles.selectionFeedItem}>
                <span className={styles.selectionFeedLabel}>Linked record</span>
                <span>
                  {input.latestSelectedMeeting
                    ? buildMeetingRecordLabel(input.latestSelectedMeeting)
                    : `No recent ${categoryLowerLabel}s in the current range.`}
                </span>
              </div>
            </div>

            {input.recentMeetings.length ? (
              <ul className={styles.summaryList}>
                {input.recentMeetings.map((meeting) => (
                  <li key={`${input.category}-${meeting.id}`}>
                    <div className={styles.summaryRow}>
                      <div className={styles.summaryCopy}>
                        <strong>{buildMeetingActivityLabel(meeting)}</strong>
                        <span>
                          {buildMeetingRecordLabel(meeting)} • {buildMeetingSourceLabel(meeting)} • {buildMeetingInviteeLabel(meeting)}
                        </span>
                      </div>
                      <div className={styles.summaryMeta}>
                        <span>{formatDateTime(meeting.occurredAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <DashboardShell
      activeTab="overview"
      onRefresh={handleManualRefresh}
      refreshing={refreshing}
      subtitle="A quieter view of calls, meetings, drop offs, and sent-email activity for the current range."
      title="Dashboard"
    >
      <DashboardStatusBar
        backgroundRefreshTriggered={snapshot?.backgroundRefreshTriggered ?? false}
        importLabel={readStatusLabel(snapshot)}
        lastUpdatedAt={snapshot?.importState.updatedAt}
        lastWebhookAt={snapshot?.importState.lastWebhookAt}
      />

      <section className={styles.controlBar}>
        <div className={styles.controlRow}>
          <div className={styles.quickRanges}>
            <button className={styles.quickButton} onClick={() => applyPreset(1)} type="button">
              Today
            </button>
            <button className={styles.quickButton} onClick={() => applyPreset(7)} type="button">
              Last 7 days
            </button>
            <button className={styles.quickButton} onClick={() => applyPreset(30)} type="button">
              Last 30 days
            </button>
            <button className={styles.quickButton} onClick={() => applyPreset(90)} type="button">
              Quarter to date
            </button>
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
              {showFiltersPanel ? "Hide filters" : `Filters${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
            </button>
            <a className={styles.summaryLink} href={buildExplorerHref(filters)}>
              Open Explorer
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
                <small>{card.label}</small>
                <strong>{card.value}</strong>
                {card.meta ? <span>{card.meta}</span> : null}
              </article>
            ))}
          </section>

          <section className={styles.heroGrid}>
            <article className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <div>
                  <h2 className={styles.chartTitle}>Call activity</h2>
                  <p className={styles.chartMeta}>The team chart stays, but the rest of the page gets out of its way.</p>
                </div>
                {selectedEmployee ? <span className={styles.softBadge}>{selectedEmployee.displayName}</span> : null}
              </div>

              <div className={styles.chartLegend}>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatch} />
                  Total calls
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatchConnected} />
                  Connected calls
                </span>
              </div>

              {chartEmployees.length ? (
                <div className={styles.chartFrame}>
                  <div aria-hidden="true" className={styles.chartYAxis}>
                    {chartTicks.map((tick) => (
                      <span className={styles.chartYAxisValue} key={tick}>
                        {tick.toLocaleString()}
                      </span>
                    ))}
                  </div>

                  <div className={styles.chartViewport}>
                    <div className={styles.trendChart}>
                      {chartEmployees.map((item) => {
                        const isActive = item.loginName === selectedEmployeeLoginName;

                        return (
                          <div className={styles.trendColumn} key={item.loginName}>
                            <button
                              className={`${styles.trendButton} ${isActive ? styles.trendButtonActive : ""}`}
                              onClick={() => selectEmployee(item.loginName)}
                              title={`${item.displayName}: ${item.answeredCalls.toLocaleString()} connected of ${item.totalCalls.toLocaleString()} calls`}
                              type="button"
                            >
                              <span className={styles.trendValue}>{item.totalCalls.toLocaleString()}</span>
                              <div className={styles.trendBarTrack}>
                                <div
                                  className={styles.trendBarTotal}
                                  style={{ height: `${(item.totalCalls / maxEmployeeCalls) * 100}%` }}
                                />
                                <div
                                  className={styles.trendBarAnswered}
                                  style={{ height: `${(item.answeredCalls / maxEmployeeCalls) * 100}%` }}
                                />
                              </div>
                              <div className={styles.trendFooter}>
                                <span className={styles.trendLabel}>{item.displayName}</span>
                                <span className={styles.trendMeta}>
                                  {item.answeredCalls.toLocaleString()} connected
                                </span>
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

              {selectedEmployee ? (
                <div className={styles.selectionPanel}>
                  <div className={styles.selectionHeader}>
                    <div>
                      <p className={styles.sectionKicker}>Selected</p>
                      <h3 className={styles.selectionTitle}>{selectedEmployee.displayName}</h3>
                    </div>
                    <button
                      className={styles.primaryButton}
                      onClick={() => openExplorerForEmployee(selectedEmployee.loginName)}
                      type="button"
                    >
                      Open in Explorer
                    </button>
                  </div>

                  <div className={styles.selectionStats}>
                    {buildSelectedEmployeeCards(
                      selectedEmployee,
                      selectedEmployeeEmailActivity?.sentCount ?? 0,
                    ).map((card) => (
                      <div className={styles.selectionStat} key={`${selectedEmployee.loginName}-${card.label}`}>
                        <small>{card.label}</small>
                        <strong>{card.value}</strong>
                        {card.meta ? <span>{card.meta}</span> : null}
                      </div>
                    ))}
                  </div>

                  <div className={styles.selectionFeed}>
                    <div className={styles.selectionFeedItem}>
                      <span className={styles.selectionFeedLabel}>Latest call</span>
                      <span>
                        {latestSelectedCall
                          ? `${formatOutcomeLabel(latestSelectedCall.outcome)} · ${
                              latestSelectedCall.companyName ??
                              latestSelectedCall.contactName ??
                              latestSelectedCall.phoneNumber ??
                              "Unknown target"
                            } · ${formatDateTime(latestSelectedCall.startedAt)}`
                          : "No recent calls in the current range."}
                      </span>
                    </div>
                    <div className={styles.selectionFeedItem}>
                      <span className={styles.selectionFeedLabel}>Latest email</span>
                      <span>
                        {latestSelectedEmail
                          ? `${buildEmailActivityLabel(latestSelectedEmail)} · ${formatDateTime(latestSelectedEmail.occurredAt)}`
                          : "No sent emails from this rep in the current range."}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>

            <article className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <div>
                  <h2 className={styles.chartTitle}>Emails sent</h2>
                  <p className={styles.chartMeta}>Email activity by sender for the current range.</p>
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
                          chartEmployees.some((employee) => employee.loginName === item.loginName),
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
                <p className={styles.emptyState}>No sent emails matched the current range.</p>
              )}

              <div className={styles.summarySection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h3 className={styles.sectionTitle}>Recent sends</h3>
                    <p className={styles.sectionSubtle}>Latest successful or partially synced emails.</p>
                  </div>
                </div>
                {snapshot.recentEmails.length ? (
                  <ul className={styles.summaryList}>
                    {snapshot.recentEmails.map((email) => {
                      const canSelect = Boolean(
                        email.actorLoginName &&
                        chartEmployees.some((item) => item.loginName === email.actorLoginName),
                      );
                      const row = (
                        <div className={styles.summaryRow}>
                          <div className={styles.summaryCopy}>
                            <strong>{buildEmailActivityLabel(email)}</strong>
                            <span>
                              {email.displayName}
                              {email.companyName ? ` • ${email.companyName}` : ""}
                              {!email.companyName && email.contactName ? ` • ${email.contactName}` : ""}
                            </span>
                          </div>
                          <div className={styles.summaryMeta}>
                            <span>{formatDateTime(email.occurredAt)}</span>
                            <span>{email.sourceSurface ?? "mail"}</span>
                          </div>
                        </div>
                      );

                      return (
                        <li key={email.id}>
                          {canSelect ? (
                            <button
                              className={styles.clickRow}
                              onClick={() => selectEmployee(email.actorLoginName as string)}
                              type="button"
                            >
                              {row}
                            </button>
                          ) : (
                            row
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className={styles.emptyState}>No email activity has been recorded for this range yet.</p>
                )}
              </div>
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
