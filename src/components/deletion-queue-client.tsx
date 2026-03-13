"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AppChrome } from "@/components/app-chrome";
import type {
  DeferredActionBulkResponse,
  DeferredActionListResponse,
  DeferredActionStatus,
  DeferredActionSummary,
} from "@/types/deferred-action";

import styles from "./deletion-queue-client.module.css";

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
  degraded?: boolean;
};

type ErrorPayload = {
  error?: string;
};

const STATUS_LABELS: Record<DeferredActionStatus, string> = {
  pending_review: "Pending Review",
  approved: "Approved",
  cancelled: "Cancelled",
  executing: "Executing",
  executed: "Executed",
  failed: "Failed",
};

const STATUS_PRIORITY: Record<DeferredActionStatus, number> = {
  pending_review: 0,
  approved: 1,
  failed: 2,
  executing: 3,
  executed: 4,
  cancelled: 5,
};

const SURFACE_LABELS: Record<string, string> = {
  accounts: "Accounts",
  map: "Map",
  quality: "Data Quality",
  tasks: "Tasks",
  merge: "Merge",
};

function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return Promise.resolve(null);
  }

  return response.json().catch(() => null) as Promise<T | null>;
}

function parseError(payload: ErrorPayload | null): string {
  if (!payload?.error || !payload.error.trim()) {
    return "Request failed.";
  }

  return payload.error;
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

function formatDateTimeInTimeZone(
  value: string | null | undefined,
  timeZone: string | null | undefined,
): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timeZone ?? "America/Toronto",
    }).format(parsed);
  } catch {
    return formatDateTime(value);
  }
}

function formatRequestedBy(item: DeferredActionSummary): string {
  return item.requestedByName?.trim() || item.requestedByLoginName?.trim() || "Unknown";
}

function formatActionTitle(item: DeferredActionSummary): string {
  if (item.actionType === "deleteContact") {
    return item.contactName?.trim() || (item.contactId ? `Delete Contact ${item.contactId}` : "Delete Contact");
  }

  return item.keptContactName?.trim() || (item.keptContactId ? `Merge Into ${item.keptContactId}` : "Merge Contacts");
}

function formatActionDetail(item: DeferredActionSummary): string {
  if (item.actionType === "deleteContact") {
    return "Delete contact";
  }

  return `Merge ${item.loserContactIds.length} contact${item.loserContactIds.length === 1 ? "" : "s"} into kept contact`;
}

function canApprove(item: DeferredActionSummary): boolean {
  return item.status === "pending_review";
}

function canCancel(item: DeferredActionSummary): boolean {
  return item.status === "pending_review" || item.status === "approved" || item.status === "failed";
}

export function DeletionQueueClient() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [response, setResponse] = useState<DeferredActionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DeferredActionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);
  const liveReloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    async function fetchSession() {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
      const sessionPayload = await readJsonResponse<SessionResponse | ErrorPayload>(sessionResponse);
      if (sessionPayload && "authenticated" in sessionPayload) {
        setSession(sessionPayload);
        if (!sessionPayload.authenticated) {
          setError("Your Acumatica session has expired. Sign in again to review queued deletions.");
        }
      }
    }

    void fetchSession();
  }, []);

  async function loadQueue(showLoading = false): Promise<void> {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const queueResponse = await fetch("/api/deletions", { cache: "no-store" });
      const queuePayload = await readJsonResponse<DeferredActionListResponse | ErrorPayload>(
        queueResponse,
      );
      if (!queueResponse.ok) {
        throw new Error(parseError(queuePayload as ErrorPayload | null));
      }
      if (!queuePayload || !("items" in queuePayload)) {
        throw new Error("Unexpected response while loading the deletion queue.");
      }

      setResponse(queuePayload);
      setSelectedIds((current) =>
        current.filter((id) => queuePayload.items.some((item) => item.id === id)),
      );
      if (queuePayload.executedNowCount > 0 || queuePayload.failedNowCount > 0) {
        setNotice(
          `Runner processed ${queuePayload.executedNowCount} action${
            queuePayload.executedNowCount === 1 ? "" : "s"
          } and flagged ${queuePayload.failedNowCount} failure${
            queuePayload.failedNowCount === 1 ? "" : "s"
          }.`,
        );
      }
      setError(null);
    } catch (queueError) {
      setError(
        queueError instanceof Error
          ? queueError.message
          : "Unable to load the deletion queue.",
      );
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!session?.authenticated) {
      setLoading(false);
      return;
    }

    void loadQueue(true);
    const interval = window.setInterval(() => {
      void loadQueue(false);
    }, 120_000);

    const scheduleReload = () => {
      if (liveReloadTimerRef.current !== null) {
        window.clearTimeout(liveReloadTimerRef.current);
      }

      liveReloadTimerRef.current = window.setTimeout(() => {
        liveReloadTimerRef.current = null;
        void loadQueue(false);
      }, 250);
    };

    const eventSource = new EventSource("/api/deletions/stream");
    eventSource.addEventListener("changed", scheduleReload);
    eventSource.addEventListener("ready", scheduleReload);
    eventSource.onerror = () => {
      // EventSource will retry automatically. Keep the fallback polling interval active.
    };

    return () => {
      window.clearInterval(interval);
      if (liveReloadTimerRef.current !== null) {
        window.clearTimeout(liveReloadTimerRef.current);
        liveReloadTimerRef.current = null;
      }
      eventSource.close();
    };
  }, [session?.authenticated]);

  const filteredItems = useMemo(() => {
    const searchValue = search.trim().toLowerCase();
    return [...(response?.items ?? [])]
      .filter((item) => (statusFilter === "all" ? true : item.status === statusFilter))
      .filter((item) => {
        if (!searchValue) {
          return true;
        }

        const haystack = [
          item.companyName,
          item.contactName,
          item.keptContactName,
          item.loserContactNames.join(" "),
          item.affectedFields.join(" "),
          item.reason,
          formatRequestedBy(item),
          SURFACE_LABELS[item.sourceSurface] ?? item.sourceSurface,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(searchValue);
      })
      .sort((left, right) => {
        const statusDelta = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
        if (statusDelta !== 0) {
          return statusDelta;
        }

        return right.requestedAt.localeCompare(left.requestedAt);
      });
  }, [response?.items, search, statusFilter]);

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedIds.includes(item.id)),
    [filteredItems, selectedIds],
  );
  const approveCount = selectedItems.filter((item) => canApprove(item)).length;
  const cancelCount = selectedItems.filter((item) => canCancel(item)).length;
  const nextApprovedExecuteAfterAt = useMemo(() => {
    const approvedItems = (response?.items ?? [])
      .filter((item) => item.status === "approved")
      .sort((left, right) => left.executeAfterAt.localeCompare(right.executeAfterAt));

    return approvedItems[0]?.executeAfterAt ?? null;
  }, [response?.items]);
  const nextApprovedExecuteAfterLabel = useMemo(
    () => formatDateTimeInTimeZone(nextApprovedExecuteAfterAt, response?.executeTimeZone),
    [nextApprovedExecuteAfterAt, response?.executeTimeZone],
  );
  const allVisibleSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.includes(item.id));

  async function handleBulkAction(action: "approve" | "cancel") {
    if (selectedIds.length === 0) {
      return;
    }

    setIsApplyingBulk(true);
    setNotice(null);
    setError(null);

    try {
      const bulkResponse = await fetch("/api/deletions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          actionIds: selectedIds,
        }),
      });
      const payload = await readJsonResponse<DeferredActionBulkResponse | ErrorPayload>(
        bulkResponse,
      );
      if (!bulkResponse.ok) {
        throw new Error(parseError(payload as ErrorPayload | null));
      }
      if (!payload || !("items" in payload)) {
        throw new Error("Unexpected response while updating queued deletions.");
      }

      setResponse(payload);
      setSelectedIds([]);
      setNotice(
        action === "approve"
          ? `Approved ${payload.updatedCount} queued action${payload.updatedCount === 1 ? "" : "s"}.`
          : `Cancelled ${payload.updatedCount} queued action${payload.updatedCount === 1 ? "" : "s"}.`,
      );
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Unable to update the selected queued actions.",
      );
    } finally {
      setIsApplyingBulk(false);
    }
  }

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      subtitle="Review queued deletes and contact merges. Approved actions execute automatically every Friday at 5:00 PM Toronto."
      title="Deletion Queue"
      userName={session?.user?.name ?? "Signed in"}
    >

      {error ? <p className={styles.warning}>{error}</p> : null}
      {notice ? <p className={styles.success}>{notice}</p> : null}

      <section className={styles.statusBar}>
        <span className={styles.stateTag}>{loading ? "Loading queue" : "Queued actions"}</span>
        <span>Pending review: {response?.counts.pending_review ?? 0}</span>
        <span>Approved: {response?.counts.approved ?? 0}</span>
        <span>Failed: {response?.counts.failed ?? 0}</span>
        <span>
          {response?.counts.approved
            ? `Next automatic run: ${nextApprovedExecuteAfterLabel}`
            : "No approved actions are waiting for the weekly run"}
        </span>
        <span>
          Scheduled timezone: {response?.executeTimeZone ?? "America/Toronto"}
        </span>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <small>Pending Review</small>
          <strong>{response?.counts.pending_review ?? 0}</strong>
        </article>
        <article className={styles.summaryCard}>
          <small>Approved</small>
          <strong>{response?.counts.approved ?? 0}</strong>
        </article>
        <article className={styles.summaryCard}>
          <small>Executed</small>
          <strong>{response?.counts.executed ?? 0}</strong>
        </article>
        <article className={styles.summaryCard}>
          <small>Failed</small>
          <strong>{response?.counts.failed ?? 0}</strong>
        </article>
      </section>

      <section className={styles.controls}>
        <label className={styles.controlField}>
          Search
          <input
            className={styles.controlInput}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Company, contact, requester, reason, or field"
            value={search}
          />
        </label>

        <div className={styles.controlField}>
          <span>Filter</span>
          <div className={styles.filterChips} role="tablist" aria-label="Deletion queue filters">
            <button
              aria-pressed={statusFilter === "all"}
              className={`${styles.filterChip} ${
                statusFilter === "all" ? styles.filterChipActive : ""
              }`.trim()}
              onClick={() => setStatusFilter("all")}
              type="button"
            >
              All ({response?.items.length ?? 0})
            </button>
            <button
              aria-pressed={statusFilter === "pending_review"}
              className={`${styles.filterChip} ${
                statusFilter === "pending_review" ? styles.filterChipActive : ""
              }`.trim()}
              onClick={() => setStatusFilter("pending_review")}
              type="button"
            >
              Needs Approval ({response?.counts.pending_review ?? 0})
            </button>
            <button
              aria-pressed={statusFilter === "approved"}
              className={`${styles.filterChip} ${
                statusFilter === "approved" ? styles.filterChipActive : ""
              }`.trim()}
              onClick={() => setStatusFilter("approved")}
              type="button"
            >
              Approved ({response?.counts.approved ?? 0})
            </button>
            <button
              aria-pressed={statusFilter === "failed"}
              className={`${styles.filterChip} ${
                statusFilter === "failed" ? styles.filterChipActive : ""
              }`.trim()}
              onClick={() => setStatusFilter("failed")}
              type="button"
            >
              Failed ({response?.counts.failed ?? 0})
            </button>
            <button
              aria-pressed={statusFilter === "executed"}
              className={`${styles.filterChip} ${
                statusFilter === "executed" ? styles.filterChipActive : ""
              }`.trim()}
              onClick={() => setStatusFilter("executed")}
              type="button"
            >
              Executed ({response?.counts.executed ?? 0})
            </button>
            <button
              aria-pressed={statusFilter === "cancelled"}
              className={`${styles.filterChip} ${
                statusFilter === "cancelled" ? styles.filterChipActive : ""
              }`.trim()}
              onClick={() => setStatusFilter("cancelled")}
              type="button"
            >
              Cancelled ({response?.counts.cancelled ?? 0})
            </button>
          </div>
        </div>

        <div className={styles.controlActions}>
          <button
            className={styles.primaryButton}
            disabled={isApplyingBulk || approveCount === 0}
            onClick={() => {
              void handleBulkAction("approve");
            }}
            type="button"
          >
            {isApplyingBulk ? "Working..." : `Approve Selected (${approveCount})`}
          </button>
          <button
            className={styles.dangerButton}
            disabled={isApplyingBulk || cancelCount === 0}
            onClick={() => {
              void handleBulkAction("cancel");
            }}
            type="button"
          >
            {isApplyingBulk ? "Working..." : `Cancel Selected (${cancelCount})`}
          </button>
        </div>

        <p className={styles.controlHint}>
          Approved items are executed automatically once a week on Friday at 5:00 PM Toronto.
          {response?.counts.approved
            ? ` ${response.counts.approved} item${
                response.counts.approved === 1 ? " is" : "s are"
              } currently waiting for the next run on ${nextApprovedExecuteAfterLabel}.`
            : " No approved items are currently waiting for the next run."}
        </p>
      </section>

      <section className={styles.tableShell}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <input
                  aria-label="Select all visible actions"
                  checked={allVisibleSelected}
                  onChange={() => {
                    if (allVisibleSelected) {
                      setSelectedIds([]);
                      return;
                    }

                    setSelectedIds(filteredItems.map((item) => item.id));
                  }}
                  type="checkbox"
                />
              </th>
              <th>Action</th>
              <th>Company</th>
              <th>Affected Fields</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Requested By</th>
              <th>Scheduled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={styles.loadingCell} colSpan={9}>
                  Loading queued actions...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td className={styles.loadingCell} colSpan={9}>
                  No queued actions match the current filter.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const selected = selectedIds.includes(item.id);
                return (
                  <tr className={styles.row} key={item.id}>
                    <td>
                      <input
                        aria-label={`Select queued action ${item.id}`}
                        checked={selected}
                        onChange={() => {
                          setSelectedIds((current) =>
                            current.includes(item.id)
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id],
                          );
                        }}
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <div className={styles.actionCell}>
                        <strong>{formatActionTitle(item)}</strong>
                        <span>{formatActionDetail(item)}</span>
                        <span className={styles.metaText}>
                          {SURFACE_LABELS[item.sourceSurface] ?? item.sourceSurface}
                        </span>
                      </div>
                    </td>
                    <td>{item.companyName?.trim() || "-"}</td>
                    <td>{item.affectedFields.length ? item.affectedFields.join(", ") : "-"}</td>
                    <td className={styles.reasonCell}>{item.reason?.trim() || "-"}</td>
                    <td>{formatDateTime(item.requestedAt)}</td>
                    <td>{formatRequestedBy(item)}</td>
                    <td>{formatDateTime(item.executeAfterAt)}</td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`.trim()}
                      >
                        {STATUS_LABELS[item.status]}
                      </span>
                      {item.failureMessage ? (
                        <p className={styles.failureText}>{item.failureMessage}</p>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </AppChrome>
  );
}
