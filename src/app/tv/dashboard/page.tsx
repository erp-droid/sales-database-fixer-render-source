import Link from "next/link";

import {
  formatDashboardDateInputValue,
  parseDashboardFilters,
} from "@/lib/call-analytics/filter-params";
import { getDashboardSnapshot } from "@/lib/call-analytics/dashboard-snapshot";
import { requireTvAccess } from "@/lib/tv-access";

import { TvChrome } from "../tv-chrome";
import styles from "../tv.module.css";

export const dynamic = "force-dynamic";

type TvDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type MetricIconName = "calls" | "meetings" | "connection" | "talkTime" | "emails";
type ZonedDateParts = {
  day: number;
  hour: number;
  millisecond: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

const DASHBOARD_TIME_ZONE = "America/Toronto";
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const zonedFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: DASHBOARD_TIME_ZONE,
  year: "numeric",
});

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
    year: "numeric",
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

function formatCallCountLabel(value: number): string {
  return value === 1 ? "1 call" : `${value.toLocaleString()} calls`;
}

function formatLowestCallerMeta(items: Array<{ totalCalls: number }>): string {
  if (items.length === 0) {
    return "No low-call reps";
  }

  const count = items[0]?.totalCalls ?? 0;
  const repLabel = items.length === 1 ? "1 rep" : `${items.length.toLocaleString()} reps`;
  return `${formatCallCountLabel(count)} each · ${repLabel} tied`;
}

function readZonedDateParts(value: Date): ZonedDateParts {
  const parts = Object.fromEntries(
    zonedFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, number>>;

  return {
    day: parts.day ?? 1,
    hour: parts.hour === 24 ? 0 : parts.hour ?? 0,
    millisecond: value.getUTCMilliseconds(),
    minute: parts.minute ?? 0,
    month: parts.month ?? 1,
    second: parts.second ?? 0,
    year: parts.year ?? 1970,
  };
}

function fromZonedDateParts(parts: ZonedDateParts): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const zonedAtGuess = readZonedDateParts(new Date(utcGuess));
  const zonedAsUtc = Date.UTC(
    zonedAtGuess.year,
    zonedAtGuess.month - 1,
    zonedAtGuess.day,
    zonedAtGuess.hour,
    zonedAtGuess.minute,
    zonedAtGuess.second,
    zonedAtGuess.millisecond,
  );
  return new Date(utcGuess - (zonedAsUtc - utcGuess));
}

function shiftCalendarDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
}

function parseDateOnly(value: string): { day: number; month: number; year: number } | null {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return { day, month, year };
}

function normalizeDateOnlyParams(params: URLSearchParams): URLSearchParams {
  const normalized = new URLSearchParams(params.toString());
  const start = normalized.get("start");
  const end = normalized.get("end");
  const startParts = start ? parseDateOnly(start) : null;
  const endParts = end ? parseDateOnly(end) : null;

  if (startParts) {
    normalized.set(
      "start",
      fromZonedDateParts({
        ...startParts,
        hour: 0,
        millisecond: 0,
        minute: 0,
        second: 0,
      }).toISOString(),
    );
  }

  if (endParts) {
    normalized.set(
      "end",
      fromZonedDateParts({
        ...endParts,
        hour: 23,
        millisecond: 999,
        minute: 59,
        second: 59,
      }).toISOString(),
    );
  }

  return normalized;
}

function buildRangeHref(start: Date, end: Date): string {
  const params = new URLSearchParams();
  params.set("start", start.toISOString());
  params.set("end", end.toISOString());
  return `/tv/dashboard?${params.toString()}`;
}

function startOfTorontoDay(parts: Pick<ZonedDateParts, "day" | "month" | "year">): Date {
  return fromZonedDateParts({
    ...parts,
    hour: 0,
    millisecond: 0,
    minute: 0,
    second: 0,
  });
}

function endOfTorontoDay(parts: Pick<ZonedDateParts, "day" | "month" | "year">): Date {
  return fromZonedDateParts({
    ...parts,
    hour: 23,
    millisecond: 999,
    minute: 59,
    second: 59,
  });
}

function buildQuickRanges(now = new Date()): Array<{ href: string; label: string }> {
  const todayParts = readZonedDateParts(now);
  const todayEnd = endOfTorontoDay(todayParts);
  const sevenStart = startOfTorontoDay(shiftCalendarDays(todayParts, -6));
  const thirtyStart = startOfTorontoDay(shiftCalendarDays(todayParts, -29));
  const quarterStart = startOfTorontoDay({
    day: 1,
    month: Math.floor((todayParts.month - 1) / 3) * 3 + 1,
    year: todayParts.year,
  });

  return [
    { href: buildRangeHref(startOfTorontoDay(todayParts), todayEnd), label: "Today" },
    { href: buildRangeHref(sevenStart, todayEnd), label: "Last 7 days" },
    { href: buildRangeHref(thirtyStart, todayEnd), label: "Last 30 days" },
    { href: buildRangeHref(quarterStart, todayEnd), label: "Quarter to date" },
  ];
}

function MetricIcon({ icon }: { icon: MetricIconName }) {
  if (icon === "meetings") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <rect height="15" rx="2" stroke="currentColor" strokeWidth="1.9" width="17" x="3.5" y="5" />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
      </svg>
    );
  }

  if (icon === "connection") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1.9" />
        <path d="M3.5 20c.8-3.5 2.3-5 4.5-5s3.7 1.5 4.5 5M15.5 11.5a3 3 0 1 0 0-6M15.5 15c2.3.2 3.9 1.8 5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
      </svg>
    );
  }

  if (icon === "talkTime") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.9" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
      </svg>
    );
  }

  if (icon === "emails") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <rect height="13" rx="2" stroke="currentColor" strokeWidth="1.9" width="17" x="3.5" y="5.5" />
        <path d="m5.25 8 6.75 5 6.75-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M7.5 5.5c1.5 5.6 5.4 9.5 11 11l-2.2 3.1c-.4.6-1.2.8-1.9.5C9.1 17.8 6.2 14.9 3.9 9.6c-.3-.7-.1-1.5.5-1.9l3.1-2.2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
    </svg>
  );
}

export default async function TvDashboardPage({ searchParams }: TvDashboardPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const params = normalizeDateOnlyParams(toSearchParams(resolvedParams));
  const nextPath = `/tv/dashboard${params.toString() ? `?${params.toString()}` : ""}`;
  const { loginName } = await requireTvAccess(nextPath);

  const filters = parseDashboardFilters(params);
  const snapshot = await getDashboardSnapshot(filters);
  const leaders = snapshot.employeeLeaderboard;
  const topCaller = leaders[0] ?? null;
  const lowCandidates = topCaller
    ? leaders.filter((item) => item.loginName !== topCaller.loginName)
    : leaders;
  const lowestCallCount = lowCandidates.length
    ? Math.min(...lowCandidates.map((item) => item.totalCalls))
    : undefined;
  const lowestCallers =
    lowestCallCount === undefined
      ? []
      : lowCandidates.filter((item) => item.totalCalls === lowestCallCount);
  const maxCalls = Math.max(1, ...leaders.map((item) => item.totalCalls));
  const chartTicks = [maxCalls, Math.ceil(maxCalls / 2), 0];
  const quickRanges = buildQuickRanges();
  const meetingLeaders = snapshot.meetingLeaderboard.slice(0, 3);
  const dropOffLeaders = snapshot.meetingCategoryAnalytics.dropOffs.leaderboard.slice(0, 3);

  return (
    <TvChrome
      active="dashboard"
      headerActions={<Link className={styles.primaryActionLink} href="/dashboard/explorer">Open Explorer</Link>}
      subtitle="Real-time overview of sales outreach and engagement."
      title="Sales Dashboard"
      userName={loginName}
    >
      <script
        dangerouslySetInnerHTML={{
          __html: "setTimeout(function(){ window.location.reload(); }, 60000);",
        }}
      />

      <section className={styles.dashboardControls} aria-label="Dashboard filters">
        <div className={styles.quickLinks}>
          {quickRanges.map((range) => (
            <Link className={styles.quickLink} href={range.href} key={range.label}>
              {range.label}
            </Link>
          ))}
        </div>

        <form action="/tv/dashboard" className={styles.dateForm} method="get">
          <label className={styles.dateField}>
            <span>Start</span>
            <input
              className={styles.input}
              defaultValue={formatDashboardDateInputValue(snapshot.filters.start)}
              name="start"
              type="date"
            />
          </label>
          <label className={styles.dateField}>
            <span>End</span>
            <input
              className={styles.input}
              defaultValue={formatDashboardDateInputValue(snapshot.filters.end)}
              name="end"
              type="date"
            />
          </label>
          <button className={styles.button} type="submit">Refresh</button>
        </form>
      </section>

      <section className={styles.statsGrid} aria-label="Sales summary">
        <article className={styles.statCard}>
          <span className={styles.priorityIcon}><MetricIcon icon="calls" /></span>
          <span className={styles.statCopy}>
            <small>Calls</small>
            <strong>{snapshot.teamStats.totalCalls.toLocaleString()}</strong>
            <span>
              {snapshot.teamStats.outboundCalls.toLocaleString()} outbound · {snapshot.teamStats.inboundCalls.toLocaleString()} inbound
            </span>
          </span>
        </article>
        <article className={styles.statCard}>
          <span className={styles.priorityIcon}><MetricIcon icon="meetings" /></span>
          <span className={styles.statCopy}>
            <small>Meetings booked</small>
            <strong>{snapshot.meetingStats.totalMeetings.toLocaleString()}</strong>
            <span>{snapshot.meetingLeaderboard.length.toLocaleString()} creators in range</span>
          </span>
        </article>
        <article className={styles.statCard}>
          <span className={styles.priorityIcon}><MetricIcon icon="connection" /></span>
          <span className={styles.statCopy}>
            <small>Connection rate</small>
            <strong>{formatPercent(snapshot.teamStats.answerRate)}</strong>
            <span>{formatPercent(snapshot.teamStats.answerRate)} of calls connected</span>
          </span>
        </article>
        <article className={styles.statCard}>
          <span className={styles.priorityIcon}><MetricIcon icon="talkTime" /></span>
          <span className={styles.statCopy}>
            <small>Talk time</small>
            <strong>{formatDuration(snapshot.teamStats.totalTalkSeconds)}</strong>
            <span>{formatDuration(snapshot.teamStats.averageTalkSeconds)} avg connected</span>
          </span>
        </article>
        <article className={styles.statCard}>
          <span className={styles.priorityIcon}><MetricIcon icon="emails" /></span>
          <span className={styles.statCopy}>
            <small>Emails sent</small>
            <strong>{snapshot.emailStats.totalSent.toLocaleString()}</strong>
            <span>{snapshot.emailStats.uniqueSenders.toLocaleString()} active senders</span>
          </span>
        </article>
      </section>

      <section className={styles.statusBar}>
        <span className={styles.statusPill}>Refreshing calls</span>
        <span>Last updated: {formatDateTime(snapshot.importState.updatedAt)}</span>
        <span>Last webhook: {formatDateTime(snapshot.importState.lastWebhookAt)}</span>
        <span>{formatDateTime(snapshot.filters.start)} to {formatDateTime(snapshot.filters.end)}</span>
      </section>

      <section className={styles.heroGrid}>
        <article className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIcon}><MetricIcon icon="calls" /></span>
              <h2 className={styles.sectionTitle}>Call activity</h2>
            </div>
            <span className={styles.sectionMeta}>All reps</span>
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

          {topCaller || lowestCallers.length ? (
            <div className={styles.highlightGrid} aria-label="Call highlights">
              {topCaller ? (
                <div className={styles.highlightWin}>
                  <span className={styles.highlightLabel}>Most calls</span>
                  <strong className={styles.highlightName}>{topCaller.displayName}</strong>
                  <span className={styles.highlightMeta}>
                    {formatCallCountLabel(topCaller.totalCalls)} · {topCaller.answeredCalls.toLocaleString()} connected
                  </span>
                </div>
              ) : null}
              {lowestCallers.length ? (
                <div className={styles.highlightLow}>
                  <span className={styles.highlightLabel}>Fewest calls</span>
                  <strong className={styles.highlightName}>
                    {formatNameList(lowestCallers.map((item) => item.displayName))}
                  </strong>
                  <span className={styles.highlightMeta}>{formatLowestCallerMeta(lowestCallers)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {leaders.length ? (
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
                  {leaders.map((item) => (
                    <div className={styles.trendColumn} key={item.loginName}>
                      <span className={styles.trendValue}>{item.totalCalls.toLocaleString()}</span>
                      <div className={styles.trendBarTrack} aria-hidden="true">
                        <div
                          className={styles.trendBarTotal}
                          style={{ height: `${(item.totalCalls / maxCalls) * 100}%` }}
                        />
                        <div
                          className={styles.trendBarAnswered}
                          style={{ height: `${(item.answeredCalls / maxCalls) * 100}%` }}
                        />
                      </div>
                      <div className={styles.trendFooter}>
                        <span className={styles.trendLabel}>{item.displayName}</span>
                        <span className={styles.trendMeta}>{item.answeredCalls.toLocaleString()} connected</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className={styles.empty}>No employee activity matched these filters.</p>
          )}
        </article>

        <article className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIcon}><MetricIcon icon="emails" /></span>
              <div>
                <h2 className={styles.sectionTitle}>Email activity</h2>
                <p className={styles.sectionMeta}>Email activity by sender for the current range.</p>
              </div>
            </div>
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
            <ul className={styles.compactList}>
              {snapshot.emailLeaderboard.map((item) => (
                <li className={styles.compactListItem} key={item.loginName ?? item.displayName}>
                  <div>
                    <strong>{item.displayName}</strong>
                    <span>{item.email ?? "No email linked"}</span>
                  </div>
                  <span className={styles.softBadge}>{item.sentCount.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><MetricIcon icon="emails" /></span>
              <p>No sent emails matched the current range.</p>
            </div>
          )}
        </article>
      </section>

      <section className={styles.lowerGrid}>
        <article className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIcon}><MetricIcon icon="meetings" /></span>
              <h2 className={styles.sectionTitle}>Meetings booked</h2>
            </div>
          </div>
          {meetingLeaders.length ? (
            <ul className={styles.compactList}>
              {meetingLeaders.map((item, index) => (
                <li className={styles.compactListItem} key={item.loginName}>
                  <div>
                    <strong>{index + 1}. {item.displayName}</strong>
                    <span>{item.totalMeetings.toLocaleString()} meetings</span>
                  </div>
                  <span className={styles.softBadge}>{item.totalAttendees.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No meetings were booked in the current range.</p>
          )}
          <Link className={styles.footerLink} href="/calendar">View all meetings</Link>
        </article>

        <article className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIcon}><MetricIcon icon="meetings" /></span>
              <h2 className={styles.sectionTitle}>Drop-offs booked</h2>
            </div>
          </div>
          {dropOffLeaders.length ? (
            <ul className={styles.compactList}>
              {dropOffLeaders.map((item, index) => (
                <li className={styles.compactListItem} key={item.loginName}>
                  <div>
                    <strong>{index + 1}. {item.displayName}</strong>
                    <span>{item.totalMeetings.toLocaleString()} drop-offs</span>
                  </div>
                  <span className={styles.softBadge}>{item.totalAttendees.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No drop-offs were booked in the current range.</p>
          )}
          <Link className={styles.footerLink} href="/calendar">View all drop-offs</Link>
        </article>
      </section>
    </TvChrome>
  );
}
