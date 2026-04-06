import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { parseDashboardFilters } from "@/lib/call-analytics/filter-params";
import { getDashboardSnapshot } from "@/lib/call-analytics/dashboard-snapshot";
import { getAuthCookieNameForMiddleware } from "@/lib/env";

import styles from "./dashboard-page.module.css";

type DashboardBasicViewProps = {
  searchParams: URLSearchParams;
};

function formatDuration(seconds: number | null | undefined): string {
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

function formatDateTime(value: string | null | undefined): string {
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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function buildSignInUrl(search: string): string {
  const target = search ? `/dashboard?${search}` : "/dashboard";
  return `/signin?next=${encodeURIComponent(target)}`;
}

export async function DashboardBasicView({ searchParams }: DashboardBasicViewProps) {
  const cookieStore = await cookies();
  const hasSessionCookie = Boolean(
    cookieStore.get(getAuthCookieNameForMiddleware())?.value,
  );
  const loginName = cookieStore.get("mb_login_name")?.value?.trim() || "Signed in";

  const params = new URLSearchParams(searchParams.toString());
  params.delete("basic");
  const query = params.toString();

  if (!hasSessionCookie) {
    redirect(buildSignInUrl(query));
  }

  const filters = parseDashboardFilters(params);
  const snapshot = await getDashboardSnapshot(filters);
  const interactiveHref = query ? `/dashboard?${query}` : "/dashboard";
  const explorerHref = query ? `/dashboard/explorer?${query}` : "/dashboard/explorer";

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      headerActions={
        <>
          <Link className={styles.navButton} href={interactiveHref}>
            Interactive view
          </Link>
          <Link className={styles.navButton} href={explorerHref}>
            Explorer
          </Link>
        </>
      }
      subtitle="Browser-safe phone call snapshot for machines that cannot load the interactive dashboard."
      title="Dashboard"
      userName={loginName}
    >
      <section className={styles.statusBar}>
        <span className={styles.stateTag}>Basic view</span>
        <span>Generated: {formatDateTime(snapshot.generatedAt)}</span>
        <span>Range: {formatDateTime(snapshot.filters.start)} to {formatDateTime(snapshot.filters.end)}</span>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Phone calls</h2>
            <p className={styles.sectionSubtle}>
              Basic call visibility that works without the full dashboard bundle.
            </p>
          </div>
          <Link className={styles.summaryLink} href={interactiveHref}>
            Try full dashboard
          </Link>
        </div>
        <div className={styles.priorityGrid}>
          <div className={styles.priorityCard}>
            <small>Total calls</small>
            <strong>{snapshot.teamStats.totalCalls.toLocaleString()}</strong>
            <span>{snapshot.teamStats.answeredCalls.toLocaleString()} connected</span>
          </div>
          <div className={styles.priorityCard}>
            <small>Outbound</small>
            <strong>{snapshot.teamStats.outboundCalls.toLocaleString()}</strong>
            <span>{snapshot.teamStats.unansweredCalls.toLocaleString()} unanswered</span>
          </div>
          <div className={styles.priorityCard}>
            <small>Inbound</small>
            <strong>{snapshot.teamStats.inboundCalls.toLocaleString()}</strong>
            <span>{snapshot.teamStats.missedInboundCalls.toLocaleString()} missed inbound</span>
          </div>
          <div className={styles.priorityCard}>
            <small>Connection rate</small>
            <strong>{formatPercent(snapshot.teamStats.answerRate)}</strong>
            <span>{formatDuration(snapshot.teamStats.totalTalkSeconds)} talk time</span>
          </div>
        </div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Top callers</h2>
            <p className={styles.sectionSubtle}>Most active employees in the current range.</p>
          </div>
        </div>
        {snapshot.employeeLeaderboard.length === 0 ? (
          <p className={styles.basicEmpty}>No call activity found for this range.</p>
        ) : (
          <ul className={styles.basicList}>
            {snapshot.employeeLeaderboard.slice(0, 8).map((item) => (
              <li className={styles.basicListItem} key={item.loginName}>
                <div>
                  <strong>{item.displayName}</strong>
                  <p className={styles.basicMeta}>
                    {item.totalCalls.toLocaleString()} calls · {formatPercent(item.answerRate)} connection rate
                  </p>
                </div>
                <span className={styles.softBadge}>{formatDuration(item.talkSeconds)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.tableCard}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Recent phone calls</h2>
            <p className={styles.sectionSubtle}>Latest matched call sessions from the current snapshot.</p>
          </div>
        </div>
        {snapshot.recentCalls.length === 0 ? (
          <p className={styles.basicEmpty}>No recent calls available.</p>
        ) : (
          <ul className={styles.basicList}>
            {snapshot.recentCalls.slice(0, 12).map((call) => (
              <li className={styles.basicListItem} key={call.sessionId}>
                <div>
                  <strong>
                    {call.companyName?.trim() ||
                      call.contactName?.trim() ||
                      call.phoneNumber?.trim() ||
                      "Unknown caller"}
                  </strong>
                  <p className={styles.basicMeta}>
                    {call.employeeDisplayName?.trim() || "Unassigned"} · {call.direction} · {call.outcome.replace(/_/g, " ")}
                  </p>
                  <p className={styles.basicMeta}>
                    {call.phoneNumber?.trim() || "No phone number"} · {formatDateTime(call.startedAt)}
                  </p>
                </div>
                <span className={styles.softBadge}>{formatDuration(call.talkDurationSeconds)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <p className={styles.sectionSubtle}>
          Tip: bookmark <code>/dashboard?basic=1</code> on this computer if the full dashboard keeps failing to load.
        </p>
      </section>
    </AppChrome>
  );
}
