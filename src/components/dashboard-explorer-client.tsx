"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { buildDashboardQueryString, formatDashboardDateInputValue, parseDashboardFilters } from "@/lib/call-analytics/filter-params";
import type {
  DashboardCallDetailResponse,
  DashboardCallListResponse,
  DashboardFilters,
} from "@/lib/call-analytics/types";

import styles from "./dashboard-page.module.css";
import {
  CallDetailDrawer,
  DashboardShell,
  DashboardStatusBar,
  extractErrorMessage,
  formatDateTime,
  formatDuration,
  formatOutcomeLabel,
  formatSourceLabel,
  readJsonResponse,
} from "./dashboard-ui";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type ErrorPayload = {
  error?: string;
};

function parsePositiveInteger(value: string | null, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function readStatusLabel(callList: DashboardCallListResponse | null): string {
  const status = callList?.importState.status;
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

function mergeFilters(filters: DashboardFilters, next: Partial<DashboardFilters>): DashboardFilters {
  return {
    ...filters,
    ...next,
  };
}

export function DashboardExplorerClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseDashboardFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const currentQuery = searchParams.toString();
  const page = parsePositiveInteger(searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"), 25);

  const [callList, setCallList] = useState<DashboardCallListResponse | null>(null);
  const [detail, setDetail] = useState<DashboardCallDetailResponse | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState(filters.search);

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  function replaceUrl(nextFilters: DashboardFilters, nextPage = 1): void {
    const nextQuery = buildDashboardQueryString(nextFilters, {
      page: nextPage,
      pageSize,
    });
    if (nextQuery === currentQuery) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  function updateFilters(next: Partial<DashboardFilters>): void {
    replaceUrl(mergeFilters(filters, next), 1);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (searchDraft.trim() !== filters.search.trim()) {
        const nextFilters = mergeFilters(filters, { search: searchDraft.trim() });
        const nextQuery = buildDashboardQueryString(nextFilters, {
          page: 1,
          pageSize,
        });
        if (nextQuery !== currentQuery) {
          router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentQuery, filters, pageSize, pathname, router, searchDraft]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadCallList() {
      setError(null);
      setLoading(true);

      try {
        const query = buildDashboardQueryString(filters, {
          page,
          pageSize,
        });
        const response = await fetch(`/api/dashboard/calls/list?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<DashboardCallListResponse | ErrorPayload>(response);
        if (!response.ok) {
          throw new Error(extractErrorMessage(payload) ?? "Unable to load calls.");
        }
        if (cancelled) {
          return;
        }
        setCallList(payload as DashboardCallListResponse);
      } catch (loadError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load calls.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadCallList();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentQuery, filters, page, pageSize, pathname, router]);

  useEffect(() => {
    let cancelled = false;

    async function refreshCallListInPlace() {
      try {
        const query = buildDashboardQueryString(filters, {
          page,
          pageSize,
        });
        const response = await fetch(`/api/dashboard/calls/list?${query}`, {
          cache: "no-store",
        });
        const payload = await readJsonResponse<DashboardCallListResponse | ErrorPayload>(response);
        if (!response.ok || cancelled) {
          return;
        }
        setCallList(payload as DashboardCallListResponse);
      } catch {
        // Keep previous data visible if a background refetch fails.
      }
    }

    const intervalId = window.setInterval(() => {
      void refreshCallListInPlace();
    }, REFRESH_INTERVAL_MS);

    function handleFocus() {
      void refreshCallListInPlace();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [filters, page, pageSize]);

  useEffect(() => {
    if (!selectedSessionId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const sessionId = selectedSessionId;

    async function loadDetail() {
      setDetailLoading(true);
      setDetailError(null);

      try {
        const response = await fetch(`/api/dashboard/calls/${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonResponse<DashboardCallDetailResponse | ErrorPayload>(response);
        if (!response.ok) {
          throw new Error(extractErrorMessage(payload) ?? "Unable to load call detail.");
        }
        if (cancelled) {
          return;
        }
        setDetail(payload as DashboardCallDetailResponse);
      } catch (detailLoadError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setDetailError(
          detailLoadError instanceof Error ? detailLoadError.message : "Unable to load call detail.",
        );
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedSessionId]);

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

      const query = buildDashboardQueryString(filters, {
        page,
        pageSize,
      });
      const listResponse = await fetch(`/api/dashboard/calls/list?${query}`, {
        cache: "no-store",
      });
      const listPayload = await readJsonResponse<DashboardCallListResponse | ErrorPayload>(listResponse);
      if (!listResponse.ok) {
        throw new Error(extractErrorMessage(listPayload) ?? "Unable to reload calls.");
      }
      setCallList(listPayload as DashboardCallListResponse);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh call history.");
    } finally {
      setRefreshing(false);
    }
  }

  const employeeOptions = useMemo(() => {
    const items = callList?.employees ?? [];
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
  }, [callList?.employees, employeeSearch]);

  const exportHref = useMemo(() => {
    const query = buildDashboardQueryString(filters);
    return `/api/dashboard/calls/export?${query}`;
  }, [filters]);

  function toggleEmployee(loginName: string, checked: boolean): void {
    const nextEmployees = checked
      ? [...new Set([...filters.employees, loginName])]
      : filters.employees.filter((value) => value !== loginName);
    updateFilters({ employees: nextEmployees });
  }

  function changePage(nextPage: number): void {
    replaceUrl(filters, Math.max(1, nextPage));
  }

  return (
    <DashboardShell
      activeTab="explorer"
      exportHref={exportHref}
      onRefresh={handleManualRefresh}
      refreshing={refreshing}
      subtitle="Full filters, fast cached call sessions, and click-through call detail."
      title="Call Explorer"
    >
      <DashboardStatusBar
        backgroundRefreshTriggered={callList?.backgroundRefreshTriggered ?? false}
        importLabel={readStatusLabel(callList)}
        lastUpdatedAt={callList?.importState.updatedAt}
        lastWebhookAt={callList?.importState.lastWebhookAt}
      />

      <section className={styles.filtersCard}>
        <div className={styles.filterHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Filters</h2>
            <p className={styles.sectionSubtle}>All detail filters live here so the main dashboard stays simple.</p>
          </div>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.filterField}>
            Start date
            <input
              className={styles.filterInput}
              onChange={(event) =>
                updateFilters({ start: new Date(`${event.target.value}T00:00:00`).toISOString() })
              }
              type="date"
              value={formatDashboardDateInputValue(filters.start)}
            />
          </label>
          <label className={styles.filterField}>
            End date
            <input
              className={styles.filterInput}
              onChange={(event) =>
                updateFilters({ end: new Date(`${event.target.value}T23:59:59`).toISOString() })
              }
              type="date"
              value={formatDashboardDateInputValue(filters.end)}
            />
          </label>
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

        <div className={styles.employeePicker}>
          <div className={styles.employeeHeader}>
            <strong>Employees</strong>
            <div className={styles.employeeQuickActions}>
              <button className={styles.ghostButton} onClick={() => updateFilters({ employees: [] })} type="button">
                Everyone
              </button>
              {callList?.viewer.loginName ? (
                <button
                  className={styles.ghostButton}
                  onClick={() => updateFilters({ employees: [callList.viewer.loginName as string] })}
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
        </div>
      </section>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading && !callList ? <p className={styles.loadingText}>Loading call sessions...</p> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <div>
            <p className={styles.sectionKicker}>Recent calls</p>
            <h2 className={styles.tableTitle}>Call Explorer</h2>
          </div>
          <span className={styles.tableMeta}>
            {callList?.total.toLocaleString() ?? "0"} matching sessions
          </span>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Employee</th>
                <th>Direction</th>
                <th>Who</th>
                <th>Company</th>
                <th>Phone</th>
                <th>Outcome</th>
                <th>Talk</th>
                <th>Ring</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {callList?.items.length ? (
                callList.items.map((call) => (
                  <tr
                    className={styles.tableRow}
                    key={call.sessionId}
                    onClick={() => setSelectedSessionId(call.sessionId)}
                  >
                    <td>{formatDateTime(call.startedAt)}</td>
                    <td>{call.employeeDisplayName ?? call.employeeLoginName ?? "Unattributed"}</td>
                    <td>{call.direction}</td>
                    <td>{call.contactName ?? "Unknown contact"}</td>
                    <td>{call.companyName ?? "Unknown company"}</td>
                    <td>{call.phoneNumber ?? "Unknown"}</td>
                    <td>
                      <span className={styles.badge}>{formatOutcomeLabel(call.outcome)}</span>
                    </td>
                    <td>{formatDuration(call.talkDurationSeconds)}</td>
                    <td>{formatDuration(call.ringDurationSeconds)}</td>
                    <td>{formatSourceLabel(call.source)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className={styles.emptyState} colSpan={10}>
                    No calls matched these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <button
            className={styles.ghostButton}
            disabled={page <= 1}
            onClick={() => changePage(page - 1)}
            type="button"
          >
            Previous
          </button>
          <span>
            Page {callList?.page ?? page}
          </span>
          <button
            className={styles.ghostButton}
            disabled={!callList || page * callList.pageSize >= callList.total}
            onClick={() => changePage(page + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </section>

      <CallDetailDrawer
        detail={detail}
        error={detailError}
        loading={detailLoading}
        onClose={() => setSelectedSessionId(null)}
        selectedSessionId={selectedSessionId}
      />
    </DashboardShell>
  );
}
