"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppChrome } from "@/components/app-chrome";
import type { DashboardCallDetailResponse } from "@/lib/call-analytics/types";

import styles from "./dashboard-page.module.css";

type ErrorPayload = {
  error?: string;
};

type SessionPayload = {
  authenticated?: boolean;
  degraded?: boolean;
  user?: {
    id?: string;
    name?: string;
  } | null;
};

export type DashboardSessionState = {
  userName: string;
  warning: string | null;
};

export async function readJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as ErrorPayload).error;
  return typeof error === "string" && error.trim() ? error : null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) {
    return "0m";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0 && remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const numeric = Date.parse(value);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }

  return new Date(numeric).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "no_answer":
      return "No answer";
    case "in_progress":
      return "In progress";
    default:
      return outcome.replace(/_/g, " ");
  }
}

export function formatSourceLabel(source: string): string {
  switch (source) {
    case "app_bridge":
      return "App bridge";
    case "twilio_direct":
      return "Twilio direct";
    case "inbound":
      return "Inbound";
    default:
      return "Unknown";
  }
}

export function useDashboardSession(): DashboardSessionState {
  const [state, setState] = useState<DashboardSessionState>({
    userName: "Signed in",
    warning: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });
        const payload = await readJsonResponse<SessionPayload | ErrorPayload>(response);
        if (cancelled) {
          return;
        }

        if ("authenticated" in (payload as SessionPayload)) {
          const session = payload as SessionPayload;
          if (session.authenticated === false) {
            setState({
              userName: "Signed out",
              warning: "Your Acumatica session has expired. Sign in again to refresh call data.",
            });
            return;
          }

          setState({
            userName: session.user?.name?.trim() || "Signed in",
            warning: session.degraded
              ? "Acumatica session validation is temporarily unavailable. Cached call data is still available."
              : null,
          });
          return;
        }

        setState({
          userName: "Signed in",
          warning: "Acumatica session validation is temporarily unavailable. Cached call data is still available.",
        });
      } catch {
        if (cancelled) {
          return;
        }

        setState({
          userName: "Signed in",
          warning: "Acumatica session validation is temporarily unavailable. Cached call data is still available.",
        });
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function DashboardShell({
  title,
  subtitle,
  activeTab,
  exportHref,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  subtitle: string;
  activeTab: "overview" | "explorer";
  exportHref?: string;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const session = useDashboardSession();

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      headerActions={
        <>
          <button className={styles.navButton} onClick={() => void onRefresh()} type="button">
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          {exportHref ? (
            <a className={styles.navButton} href={exportHref}>
              Export CSV
            </a>
          ) : null}
        </>
      }
      subtitle={subtitle}
      title={title}
      userName={session.userName}
    >

      <nav className={styles.subnav} aria-label="Dashboard sections">
        <Link
          className={activeTab === "overview" ? styles.subnavLinkActive : styles.subnavLink}
          href="/dashboard"
        >
          Overview
        </Link>
        <Link
          className={activeTab === "explorer" ? styles.subnavLinkActive : styles.subnavLink}
          href="/dashboard/explorer"
        >
          Explorer
        </Link>
      </nav>

      {session.warning ? <p className={styles.warning}>{session.warning}</p> : null}

      {children}
    </AppChrome>
  );
}

export function DashboardStatusBar({
  importLabel,
  lastUpdatedAt,
  lastWebhookAt,
  backgroundRefreshTriggered,
}: {
  importLabel: string;
  lastUpdatedAt: string | null | undefined;
  lastWebhookAt: string | null | undefined;
  backgroundRefreshTriggered: boolean;
}) {
  return (
    <section className={styles.statusBar}>
      <span className={styles.stateTag}>{importLabel}</span>
      <span>Last updated: {formatDateTime(lastUpdatedAt)}</span>
      <span>Last webhook: {formatDateTime(lastWebhookAt)}</span>
      {backgroundRefreshTriggered ? (
        <span className={styles.statusNote}>Refreshing in background</span>
      ) : null}
    </section>
  );
}

export function CallDetailDrawer({
  detail,
  selectedSessionId,
  loading,
  error,
  onClose,
}: {
  detail: DashboardCallDetailResponse | null;
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  if (!selectedSessionId) {
    return null;
  }

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} onClick={(event) => event.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.sectionKicker}>Call detail</p>
            <h2>
              {detail
                ? detail.session.matchedContactName ??
                  detail.session.matchedCompanyName ??
                  "Unknown target"
                : "Loading call"}
            </h2>
          </div>
          <button className={styles.navButton} onClick={onClose} type="button">
            Close
          </button>
        </div>

        {loading ? <p className={styles.loadingText}>Loading call detail...</p> : null}
        {error ? <p className={styles.warning}>{error}</p> : null}

        {detail ? (
          <>
            <dl className={styles.detailGrid}>
              <div>
                <dt>Employee</dt>
                <dd>
                  {detail.session.employeeDisplayName ??
                    detail.session.recipientEmployeeDisplayName ??
                    "Unattributed"}
                </dd>
              </div>
              <div>
                <dt>Login</dt>
                <dd>
                  {detail.session.employeeLoginName ??
                    detail.session.recipientEmployeeLoginName ??
                    "-"}
                </dd>
              </div>
              <div>
                <dt>Direction</dt>
                <dd>{detail.session.direction}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{formatSourceLabel(detail.session.source)}</dd>
              </div>
              <div>
                <dt>Outcome</dt>
                <dd>{formatOutcomeLabel(detail.session.outcome)}</dd>
              </div>
              <div>
                <dt>Caller ID</dt>
                <dd>{detail.session.presentedCallerId ?? "-"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{detail.session.counterpartyPhone ?? detail.session.targetPhone ?? "-"}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDateTime(detail.session.startedAt)}</dd>
              </div>
              <div>
                <dt>Answered</dt>
                <dd>{formatDateTime(detail.session.answeredAt)}</dd>
              </div>
              <div>
                <dt>Ended</dt>
                <dd>{formatDateTime(detail.session.endedAt)}</dd>
              </div>
              <div>
                <dt>Talk duration</dt>
                <dd>{formatDuration(detail.session.talkDurationSeconds)}</dd>
              </div>
              <div>
                <dt>Ring duration</dt>
                <dd>{formatDuration(detail.session.ringDurationSeconds)}</dd>
              </div>
              <div>
                <dt>Root SID</dt>
                <dd>{detail.session.rootCallSid}</dd>
              </div>
              <div>
                <dt>Primary leg SID</dt>
                <dd>{detail.session.primaryLegSid ?? "-"}</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>{detail.session.matchedCompanyName ?? "-"}</dd>
              </div>
              <div>
                <dt>Surface</dt>
                <dd>{detail.session.initiatedFromSurface}</dd>
              </div>
            </dl>

            <section className={styles.timelineSection}>
              <h3 className={styles.sectionTitle}>Status timeline</h3>
              <ul className={styles.timelineList}>
                {detail.timeline.length ? (
                  detail.timeline.map((entry, index) => (
                    <li key={`${entry.legSid ?? "leg"}-${index}`} className={styles.timelineItem}>
                      <strong>{entry.label}</strong>
                      <span>{entry.status}</span>
                      <span>{formatDateTime(entry.occurredAt)}</span>
                    </li>
                  ))
                ) : (
                  <li className={styles.timelineItem}>
                    <strong>No timeline events</strong>
                    <span>Twilio has not posted any status events for this call yet.</span>
                  </li>
                )}
              </ul>
            </section>

            <section className={styles.timelineSection}>
              <h3 className={styles.sectionTitle}>Activity sync</h3>
              <ul className={styles.timelineList}>
                <li className={styles.timelineItem}>
                  <strong>Status</strong>
                  <span>{detail.activitySync?.status ?? "Not queued"}</span>
                  <span>
                    {detail.activitySync?.updatedAt
                      ? formatDateTime(detail.activitySync.updatedAt)
                      : "No sync updates yet"}
                  </span>
                </li>
                {detail.activitySync?.activityId ? (
                  <li className={styles.timelineItem}>
                    <strong>Activity ID</strong>
                    <span>{detail.activitySync.activityId}</span>
                    <span>Created in Acumatica</span>
                  </li>
                ) : null}
                {detail.activitySync?.error ? (
                  <li className={styles.timelineItem}>
                    <strong>Last error</strong>
                    <span>{detail.activitySync.error}</span>
                    <span>Retry from the post-call sync route after fixing config.</span>
                  </li>
                ) : null}
              </ul>
            </section>
          </>
        ) : null}
      </aside>
    </div>
  );
}
