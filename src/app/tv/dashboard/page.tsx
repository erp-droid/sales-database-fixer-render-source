import Link from "next/link";

import {
  formatDashboardDateInputValue,
  parseDashboardFilters,
} from "@/lib/call-analytics/filter-params";
import { getDashboardSnapshot } from "@/lib/call-analytics/dashboard-snapshot";
import { requireTvAccess } from "@/lib/tv-access";

import styles from "../tv.module.css";

export const dynamic = "force-dynamic";

type TvDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function toSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      search.set(key, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        search.append(key, item);
      }
    }
  }
  return search;
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
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) {
    return "0m";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatNameList(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default async function TvDashboardPage({ searchParams }: TvDashboardPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const params = toSearchParams(resolvedParams);
  const nextPath = `/tv/dashboard${params.toString() ? `?${params.toString()}` : ""}`;
  await requireTvAccess(nextPath);

  const filters = parseDashboardFilters(params);
  const snapshot = await getDashboardSnapshot(filters);
  const leaders = snapshot.employeeLeaderboard;
  const topCaller = leaders[0] ?? null;
  const lowCandidates = snapshot.activityGaps.filter((item) => item.loginName !== topCaller?.loginName);
  const lowestCallCount = lowCandidates[0]?.totalCalls;
  const lowestCallers =
    lowestCallCount === undefined
      ? []
      : lowCandidates.filter((item) => item.totalCalls === lowestCallCount);
  const maxCalls = Math.max(1, ...leaders.map((item) => item.totalCalls));

  return (
    <main className={styles.page}>
      <script
        dangerouslySetInnerHTML={{
          __html: "setTimeout(function(){ window.location.reload(); }, 60000);",
        }}
      />
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>Private TV View</span>
            <h1 className={styles.title}>Sales Dashboard</h1>
            <p className={styles.subtitle}>Generated {formatDateTime(snapshot.generatedAt)}</p>
          </div>
          <nav className={styles.nav} aria-label="TV navigation">
            <Link href="/tv/dashboard" aria-current="page">Dashboard</Link>
            <Link href="/tv/accounts">Accounts</Link>
            <Link href="/dashboard?basic=1">Basic</Link>
          </nav>
        </header>

        <div className={styles.statusBar}>
          <span className={styles.statusPill}>Auto-refresh 60s</span>
          <span>{formatDateTime(snapshot.filters.start)} to {formatDateTime(snapshot.filters.end)}</span>
        </div>

        <section className={styles.statsGrid} aria-label="Call summary">
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Calls</span>
            <strong className={styles.statValue}>{snapshot.teamStats.totalCalls.toLocaleString()}</strong>
            <span className={styles.statNote}>{snapshot.teamStats.answeredCalls.toLocaleString()} connected</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Connection rate</span>
            <strong className={styles.statValue}>{formatPercent(snapshot.teamStats.answerRate)}</strong>
            <span className={styles.statNote}>Outbound answered</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Talk time</span>
            <strong className={styles.statValue}>{formatDuration(snapshot.teamStats.totalTalkSeconds)}</strong>
            <span className={styles.statNote}>{formatDuration(snapshot.teamStats.averageTalkSeconds)} average</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Meetings</span>
            <strong className={styles.statValue}>{snapshot.meetingStats.totalMeetings.toLocaleString()}</strong>
            <span className={styles.statNote}>Booked in range</span>
          </div>
        </section>

        <div className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Call Race</h2>
              <span className={styles.sectionMeta}>{leaders.length.toLocaleString()} reps</span>
            </div>
            <ol className={styles.leaderList}>
              {leaders.map((item, index) => (
                <li className={styles.leaderRow} key={item.loginName}>
                  <span className={styles.rank}>#{index + 1}</span>
                  <div>
                    <div className={styles.personName}>{item.displayName}</div>
                    <div className={styles.barTrack} aria-hidden="true">
                      <div
                        className={styles.barFill}
                        style={{ width: `${Math.max(3, (item.totalCalls / maxCalls) * 100)}%` }}
                      />
                    </div>
                    <div className={styles.muted}>
                      {item.answeredCalls.toLocaleString()} connected · {formatDuration(item.talkSeconds)}
                    </div>
                  </div>
                  <strong className={styles.callCount}>{item.totalCalls.toLocaleString()}</strong>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.highlightGrid} aria-label="Call highlights">
            {topCaller ? (
              <div className={styles.highlightWin}>
                <span className={styles.highlightLabel}>Most calls</span>
                <strong className={styles.highlightName}>{topCaller.displayName}</strong>
                <span className={styles.highlightMeta}>{topCaller.totalCalls.toLocaleString()} calls</span>
              </div>
            ) : null}
            {lowestCallers.length ? (
              <div className={styles.highlightLow}>
                <span className={styles.highlightLabel}>Fewest calls</span>
                <strong className={styles.highlightName}>
                  {formatNameList(lowestCallers.map((item) => item.displayName))}
                </strong>
                <span className={styles.highlightMeta}>
                  {lowestCallers[0]?.totalCalls.toLocaleString()} calls each
                </span>
              </div>
            ) : null}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Recent Calls</h2>
              <span className={styles.sectionMeta}>Latest sessions</span>
            </div>
            {snapshot.recentCalls.length === 0 ? (
              <p className={styles.empty}>No recent calls.</p>
            ) : (
              <ul className={styles.recentList}>
                {snapshot.recentCalls.map((call) => (
                  <li className={styles.recentRow} key={call.sessionId}>
                    <div className={styles.recentPrimary}>
                      <strong className={styles.companyName}>
                        {call.companyName?.trim() ||
                          call.contactName?.trim() ||
                          call.phoneNumber?.trim() ||
                          "Unknown caller"}
                      </strong>
                      <span className={styles.muted}>
                        {call.employeeDisplayName?.trim() || "No rep linked"} · {call.direction} ·{" "}
                        {formatDateTime(call.startedAt)}
                      </span>
                    </div>
                    <span className={styles.badge}>{call.outcome.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Date Range</h2>
              <span className={styles.sectionMeta}>Server-rendered controls</span>
            </div>
            <form action="/tv/dashboard" className={styles.toolbar} method="get">
              <label className={styles.field}>
                Start
                <input
                  className={styles.input}
                  defaultValue={formatDashboardDateInputValue(snapshot.filters.start)}
                  name="start"
                  type="date"
                />
              </label>
              <label className={styles.field}>
                End
                <input
                  className={styles.input}
                  defaultValue={formatDashboardDateInputValue(snapshot.filters.end)}
                  name="end"
                  type="date"
                />
              </label>
              <button className={`${styles.button} ${styles.buttonPrimary}`} type="submit">Apply</button>
              <Link className={styles.button} href="/tv/dashboard">Reset</Link>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
