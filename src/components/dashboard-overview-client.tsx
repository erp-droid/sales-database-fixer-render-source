"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { buildDashboardQueryString, formatDashboardDateInputValue, parseDashboardFilters } from "@/lib/call-analytics/filter-params";
import type {
  DashboardFilters,
  DashboardSnapshotResponse,
} from "@/lib/call-analytics/types";

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

type ErrorPayload = {
  error?: string;
};

function buildPriorityCards(
  stats: DashboardSnapshotResponse["teamStats"],
  emailStats: DashboardSnapshotResponse["emailStats"],
): Array<{ label: string; value: string; meta?: string }> {
  return [
    {
      label: "Calls",
      value: stats.totalCalls.toLocaleString(),
      meta: `${stats.outboundCalls.toLocaleString()} outbound • ${stats.inboundCalls.toLocaleString()} inbound`,
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

export function DashboardOverviewClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseDashboardFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const currentQuery = searchParams.toString();
  const [snapshot, setSnapshot] = useState<DashboardSnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmployeeLoginName, setSelectedEmployeeLoginName] = useState<string | null>(null);
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
    let cancelled = false;

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
    }, REFRESH_INTERVAL_MS);

    function handleFocus() {
      void refreshSnapshotInPlace();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentQuery, filters]);

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

  return (
    <DashboardShell
      activeTab="overview"
      onRefresh={handleManualRefresh}
      refreshing={refreshing}
      subtitle="A quieter view of calls and sent-email activity for the current range."
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
            {buildPriorityCards(snapshot.teamStats, snapshot.emailStats).map((card) => (
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
        </>
      ) : null}
    </DashboardShell>
  );
}
