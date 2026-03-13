import { readCachedDashboardSnapshot, readDashboardSnapshotInFlight, writeCachedDashboardSnapshot, writeDashboardSnapshotInFlight } from "@/lib/call-analytics/dashboard-cache";
import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { filterCallSessions, buildSummaryStats } from "@/lib/call-analytics/queries";
import { readCallSessions } from "@/lib/call-analytics/sessionize";
import type {
  CallSessionRecord,
  DashboardActivityGapItem,
  DashboardBreakdownItem,
  DashboardEmailActivityItem,
  DashboardEmailSummaryStats,
  DashboardEmailTrendPoint,
  DashboardFilters,
  DashboardRecentCall,
  DashboardRecentEmail,
  DashboardSnapshotResponse,
  DashboardTrendPoint,
  DashboardEmployeeActivityItem,
  CallSummaryStats,
} from "@/lib/call-analytics/types";
import { getEnv } from "@/lib/env";
import { getReadModelDb } from "@/lib/read-model/db";

const TREND_BUCKET = "day";
const MAX_TREND_BUCKETS = 18;
const MAX_LEADERBOARD_ITEMS = 8;
const MAX_ACTIVITY_GAP_ITEMS = 8;
const MAX_DRILLDOWN_ITEMS = 5;
const MAX_DRILLDOWN_CALLS = 6;
const MAX_RECENT_CALLS = 8;
const MAX_RECENT_EMAILS = 6;
const MAX_EMAIL_LEADERBOARD_ITEMS = 6;

type EmployeeDirectoryOption = {
  loginName: string;
  displayName: string;
  email: string | null;
};

type BreakdownAggregate = {
  key: string;
  label: string;
  totalCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  talkSeconds: number;
};

type StoredEmailAuditRow = {
  id: string;
  occurred_at: string;
  actor_login_name: string | null;
  actor_name: string | null;
  company_name: string | null;
  contact_name: string | null;
  email_subject: string | null;
  result_code: string;
  source_surface: string | null;
};

type EmailSenderAggregate = {
  key: string;
  loginName: string | null;
  displayName: string;
  email: string | null;
  sentCount: number;
  lastSentAt: string | null;
};

type EmployeeAggregate = {
  loginName: string;
  displayName: string;
  totalCalls: number;
  outboundCalls: number;
  inboundCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  talkSeconds: number;
  lastCallAt: string | null;
};

function buildSnapshotCacheKey(filters: DashboardFilters): string {
  return JSON.stringify(filters);
}

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatBucketLabel(startMs: number): string {
  return new Date(startMs).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });
}

function toRecentCall(session: CallSessionRecord): DashboardRecentCall {
  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    employeeDisplayName: session.employeeDisplayName ?? session.recipientEmployeeDisplayName,
    employeeLoginName: session.employeeLoginName ?? session.recipientEmployeeLoginName,
    direction: session.direction,
    source: session.source,
    outcome: session.outcome,
    answered: session.answered,
    talkDurationSeconds: session.talkDurationSeconds,
    ringDurationSeconds: session.ringDurationSeconds,
    contactName: session.matchedContactName,
    companyName: session.matchedCompanyName,
    phoneNumber: session.counterpartyPhone ?? session.targetPhone,
  };
}

function compareByDisplayName(left: { displayName: string }, right: { displayName: string }): number {
  return left.displayName.localeCompare(right.displayName, undefined, {
    sensitivity: "base",
  });
}

function buildEmailWhereClause(filters: DashboardFilters): {
  clause: string;
  params: Array<string>;
} {
  const where = [
    `item_type = 'email'`,
    `action_group = 'email_send'`,
    `result_code IN ('succeeded', 'partial')`,
    `occurred_at >= ?`,
    `occurred_at <= ?`,
  ];
  const params: Array<string> = [filters.start, filters.end];

  if (filters.employees.length > 0) {
    where.push(`actor_login_name IN (${filters.employees.map(() => "?").join(", ")})`);
    params.push(...filters.employees);
  }

  if (filters.search.trim()) {
    where.push(`search_text LIKE ?`);
    params.push(`%${filters.search.trim().toLowerCase()}%`);
  }

  return {
    clause: where.join(" AND "),
    params,
  };
}

function listEmailAuditRows(filters: DashboardFilters): StoredEmailAuditRow[] {
  const db = getReadModelDb();
  const { clause, params } = buildEmailWhereClause(filters);

  return db.prepare(
    `
    SELECT
      id,
      occurred_at,
      actor_login_name,
      actor_name,
      company_name,
      contact_name,
      email_subject,
      result_code,
      source_surface
    FROM audit_events
    WHERE ${clause}
    ORDER BY occurred_at DESC, id DESC
    `,
  ).all(...params) as StoredEmailAuditRow[];
}

function resolveEmailSenderDisplayName(
  row: Pick<StoredEmailAuditRow, "actor_login_name" | "actor_name">,
  employeesByLogin: Map<string, EmployeeDirectoryOption>,
): {
  loginName: string | null;
  displayName: string;
  email: string | null;
  key: string;
} {
  const loginName = row.actor_login_name?.trim().toLowerCase() || null;
  if (loginName) {
    const employee = employeesByLogin.get(loginName);
    return {
      loginName,
      displayName: employee?.displayName ?? row.actor_name?.trim() ?? loginName,
      email: employee?.email ?? null,
      key: `login:${loginName}`,
    };
  }

  const actorName = row.actor_name?.trim() || "Unknown sender";
  return {
    loginName: null,
    displayName: actorName,
    email: null,
    key: `name:${actorName.toLowerCase()}`,
  };
}

function compareEmailLeaderboard(
  left: DashboardEmailActivityItem,
  right: DashboardEmailActivityItem,
): number {
  if (right.sentCount !== left.sentCount) {
    return right.sentCount - left.sentCount;
  }

  const leftTime = left.lastSentAt ? Date.parse(left.lastSentAt) : Number.NEGATIVE_INFINITY;
  const rightTime = right.lastSentAt ? Date.parse(right.lastSentAt) : Number.NEGATIVE_INFINITY;
  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return left.displayName.localeCompare(right.displayName, undefined, {
    sensitivity: "base",
  });
}

function buildEmailAnalytics(
  filters: DashboardFilters,
  employees: EmployeeDirectoryOption[],
  rowsOverride?: StoredEmailAuditRow[],
): {
  stats: DashboardEmailSummaryStats;
  trendItems: DashboardEmailTrendPoint[];
  leaderboard: DashboardEmailActivityItem[];
  recentEmails: DashboardRecentEmail[];
} {
  const rows = rowsOverride ?? listEmailAuditRows(filters);
  const employeesByLogin = new Map(employees.map((employee) => [employee.loginName, employee]));
  const trendGroups = new Map<string, DashboardEmailTrendPoint>();
  const senderAggregates = new Map<string, EmailSenderAggregate>();

  for (const row of rows) {
    const occurredAtMs = Date.parse(row.occurred_at);
    if (Number.isFinite(occurredAtMs)) {
      const bucketStartMs = startOfDay(occurredAtMs);
      const bucketStart = new Date(bucketStartMs).toISOString();
      const point = trendGroups.get(bucketStart) ?? {
        bucketLabel: formatBucketLabel(bucketStartMs),
        bucketStart,
        sentCount: 0,
      };
      point.sentCount += 1;
      trendGroups.set(bucketStart, point);
    }

    const sender = resolveEmailSenderDisplayName(row, employeesByLogin);
    const aggregate = senderAggregates.get(sender.key) ?? {
      key: sender.key,
      loginName: sender.loginName,
      displayName: sender.displayName,
      email: sender.email,
      sentCount: 0,
      lastSentAt: null,
    };

    aggregate.sentCount += 1;
    if (
      !aggregate.lastSentAt ||
      Date.parse(row.occurred_at) > Date.parse(aggregate.lastSentAt)
    ) {
      aggregate.lastSentAt = row.occurred_at;
    }
    senderAggregates.set(sender.key, aggregate);
  }

  const leaderboard = [...senderAggregates.values()]
    .map((item) => ({
      loginName: item.loginName,
      displayName: item.displayName,
      email: item.email,
      sentCount: item.sentCount,
      lastSentAt: item.lastSentAt,
    }))
    .sort(compareEmailLeaderboard)
    .slice(0, MAX_EMAIL_LEADERBOARD_ITEMS);

  const busiestSender = leaderboard[0] ?? null;
  const recentEmails = rows.slice(0, MAX_RECENT_EMAILS).map((row) => {
    const sender = resolveEmailSenderDisplayName(row, employeesByLogin);
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      actorLoginName: sender.loginName,
      actorName: row.actor_name,
      displayName: sender.displayName,
      companyName: row.company_name,
      contactName: row.contact_name,
      subject: row.email_subject,
      resultCode: row.result_code,
      sourceSurface: row.source_surface,
    } satisfies DashboardRecentEmail;
  });

  return {
    stats: {
      totalSent: rows.length,
      uniqueSenders: senderAggregates.size,
      averagePerSender:
        senderAggregates.size > 0 ? rows.length / senderAggregates.size : 0,
      busiestSenderLoginName: busiestSender?.loginName ?? null,
      busiestSenderDisplayName: busiestSender?.displayName ?? null,
      busiestSenderCount: busiestSender?.sentCount ?? 0,
    },
    trendItems: [...trendGroups.values()]
      .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart))
      .slice(-MAX_TREND_BUCKETS),
    leaderboard,
    recentEmails,
  };
}

function sortBreakdownItems(items: DashboardBreakdownItem[]): DashboardBreakdownItem[] {
  return items.sort((left, right) => {
    if (right.totalCalls !== left.totalCalls) {
      return right.totalCalls - left.totalCalls;
    }
    if (right.talkSeconds !== left.talkSeconds) {
      return right.talkSeconds - left.talkSeconds;
    }
    return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  });
}

function toBreakdownItems(aggregates: Map<string, BreakdownAggregate>): DashboardBreakdownItem[] {
  return sortBreakdownItems(
    [...aggregates.values()].map((item) => ({
      key: item.key,
      label: item.label,
      totalCalls: item.totalCalls,
      answeredCalls: item.answeredCalls,
      unansweredCalls: item.unansweredCalls,
      answerRate: item.totalCalls > 0 ? item.answeredCalls / item.totalCalls : 0,
      talkSeconds: item.talkSeconds,
    })),
  );
}

function upsertBreakdownAggregate(
  aggregates: Map<string, BreakdownAggregate>,
  key: string,
  label: string,
  session: CallSessionRecord,
): void {
  const aggregate = aggregates.get(key) ?? {
    key,
    label,
    totalCalls: 0,
    answeredCalls: 0,
    unansweredCalls: 0,
    talkSeconds: 0,
  };

  aggregate.totalCalls += 1;
  if (session.answered) {
    aggregate.answeredCalls += 1;
  } else if (session.direction === "outbound") {
    aggregate.unansweredCalls += 1;
  }
  aggregate.talkSeconds += Math.max(0, session.talkDurationSeconds ?? 0);
  aggregates.set(key, aggregate);
}

function buildBreakdownsForSessions(sessions: CallSessionRecord[]): {
  outcomes: DashboardBreakdownItem[];
  sources: DashboardBreakdownItem[];
  companies: DashboardBreakdownItem[];
} {
  const outcomes = new Map<string, BreakdownAggregate>();
  const sources = new Map<string, BreakdownAggregate>();
  const companies = new Map<string, BreakdownAggregate>();

  for (const session of sessions) {
    upsertBreakdownAggregate(
      outcomes,
      session.outcome,
      session.outcome.replace(/_/g, " "),
      session,
    );
    upsertBreakdownAggregate(
      sources,
      session.source,
      session.source === "app_bridge"
        ? "App bridge"
        : session.source === "twilio_direct"
          ? "Twilio direct"
          : session.source === "inbound"
            ? "Inbound"
            : "Unknown",
      session,
    );
    upsertBreakdownAggregate(
      companies,
      session.matchedBusinessAccountId ?? session.matchedCompanyName ?? "unknown",
      session.matchedCompanyName ?? "Unknown company",
      session,
    );
  }

  return {
    outcomes: toBreakdownItems(outcomes),
    sources: toBreakdownItems(sources),
    companies: toBreakdownItems(companies),
  };
}

function normalizeEmployeeAggregate(
  aggregate: EmployeeAggregate,
): DashboardEmployeeActivityItem {
  return {
    loginName: aggregate.loginName,
    displayName: aggregate.displayName,
    totalCalls: aggregate.totalCalls,
    outboundCalls: aggregate.outboundCalls,
    inboundCalls: aggregate.inboundCalls,
    answeredCalls: aggregate.answeredCalls,
    unansweredCalls: aggregate.unansweredCalls,
    answerRate: aggregate.outboundCalls > 0 ? aggregate.answeredCalls / aggregate.outboundCalls : 0,
    talkSeconds: aggregate.talkSeconds,
    averageTalkSeconds: aggregate.answeredCalls > 0 ? aggregate.talkSeconds / aggregate.answeredCalls : 0,
    lastCallAt: aggregate.lastCallAt,
  };
}

function compareLeaderboard(left: DashboardEmployeeActivityItem, right: DashboardEmployeeActivityItem): number {
  if (right.totalCalls !== left.totalCalls) {
    return right.totalCalls - left.totalCalls;
  }
  if (right.talkSeconds !== left.talkSeconds) {
    return right.talkSeconds - left.talkSeconds;
  }
  return compareByDisplayName(left, right);
}

function compareActivityGap(left: DashboardActivityGapItem, right: DashboardActivityGapItem): number {
  if (left.totalCalls !== right.totalCalls) {
    return left.totalCalls - right.totalCalls;
  }

  const leftTime = left.lastCallAt ? Date.parse(left.lastCallAt) : Number.NEGATIVE_INFINITY;
  const rightTime = right.lastCallAt ? Date.parse(right.lastCallAt) : Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (left.talkSeconds !== right.talkSeconds) {
    return left.talkSeconds - right.talkSeconds;
  }

  return left.displayName.localeCompare(right.displayName, undefined, {
    sensitivity: "base",
  });
}

function createEmptyEmployeeActivity(
  employee: EmployeeDirectoryOption,
): DashboardEmployeeActivityItem {
  return {
    loginName: employee.loginName,
    displayName: employee.displayName,
    totalCalls: 0,
    outboundCalls: 0,
    inboundCalls: 0,
    answeredCalls: 0,
    unansweredCalls: 0,
    answerRate: 0,
    talkSeconds: 0,
    averageTalkSeconds: 0,
    lastCallAt: null,
  };
}

function toActivityGapItem(activity: DashboardEmployeeActivityItem): DashboardActivityGapItem {
  return {
    loginName: activity.loginName,
    displayName: activity.displayName,
    totalCalls: activity.totalCalls,
    outboundCalls: activity.outboundCalls,
    unansweredCalls: activity.unansweredCalls,
    answerRate: activity.answerRate,
    talkSeconds: activity.talkSeconds,
    lastCallAt: activity.lastCallAt,
  };
}

function buildCandidateEmployees(
  filters: DashboardFilters,
  employees: EmployeeDirectoryOption[],
): EmployeeDirectoryOption[] {
  if (filters.employees.length === 0) {
    return employees;
  }

  const byLogin = new Map(employees.map((employee) => [employee.loginName, employee]));
  return filters.employees
    .map((loginName) => {
      return (
        byLogin.get(loginName) ?? {
          loginName,
          displayName: loginName,
          email: null,
        }
      );
    })
    .sort(compareByDisplayName);
}

function buildEmployeeAnalytics(
  filters: DashboardFilters,
  sessions: CallSessionRecord[],
  employees: EmployeeDirectoryOption[],
): {
  leaderboard: DashboardEmployeeActivityItem[];
  activityGaps: DashboardActivityGapItem[];
} {
  const aggregates = new Map<string, EmployeeAggregate>();

  for (const session of sessions) {
    const loginName = session.employeeLoginName ?? session.recipientEmployeeLoginName ?? "unattributed";
    const displayName =
      session.employeeDisplayName ??
      session.recipientEmployeeDisplayName ??
      session.employeeLoginName ??
      session.recipientEmployeeLoginName ??
      "Unattributed";
    const aggregate = aggregates.get(loginName) ?? {
      loginName,
      displayName,
      totalCalls: 0,
      outboundCalls: 0,
      inboundCalls: 0,
      answeredCalls: 0,
      unansweredCalls: 0,
      talkSeconds: 0,
      lastCallAt: null,
    };

    aggregate.totalCalls += 1;
    if (session.direction === "outbound") {
      aggregate.outboundCalls += 1;
    }
    if (session.direction === "inbound") {
      aggregate.inboundCalls += 1;
    }
    if (session.answered) {
      aggregate.answeredCalls += 1;
    } else if (session.direction === "outbound") {
      aggregate.unansweredCalls += 1;
    }
    aggregate.talkSeconds += Math.max(0, session.talkDurationSeconds ?? 0);

    const sessionTimestamp = session.startedAt ?? session.updatedAt;
    if (sessionTimestamp) {
      const currentTime = aggregate.lastCallAt ? Date.parse(aggregate.lastCallAt) : Number.NEGATIVE_INFINITY;
      const nextTime = Date.parse(sessionTimestamp);
      if (Number.isFinite(nextTime) && nextTime > currentTime) {
        aggregate.lastCallAt = sessionTimestamp;
      }
    }

    aggregates.set(loginName, aggregate);
  }

  const leaderboard = [...aggregates.values()]
    .map(normalizeEmployeeAggregate)
    .filter((item) => item.loginName !== "unattributed" || item.totalCalls > 0)
    .sort(compareLeaderboard)
    .slice(0, MAX_LEADERBOARD_ITEMS);

  const activityCandidates = buildCandidateEmployees(filters, employees)
    .map((employee) => normalizeEmployeeAggregate(
      aggregates.get(employee.loginName) ?? {
        loginName: employee.loginName,
        displayName: employee.displayName,
        totalCalls: 0,
        outboundCalls: 0,
        inboundCalls: 0,
        answeredCalls: 0,
        unansweredCalls: 0,
        talkSeconds: 0,
        lastCallAt: null,
      },
    ))
    .sort((left, right) => compareActivityGap(toActivityGapItem(left), toActivityGapItem(right)))
    .slice(0, MAX_ACTIVITY_GAP_ITEMS)
    .map(toActivityGapItem);

  return {
    leaderboard,
    activityGaps: activityCandidates,
  };
}

function buildBucketDrilldowns(
  bucketItems: DashboardTrendPoint[],
  bucketSessions: Map<string, CallSessionRecord[]>,
): DashboardSnapshotResponse["bucketDrilldowns"] {
  return bucketItems.map((bucket) => {
    const sessions = bucketSessions.get(bucket.bucketStart) ?? [];
    const employeeDirectory = new Map<string, EmployeeDirectoryOption>();
    for (const session of sessions) {
      const loginName = session.employeeLoginName ?? session.recipientEmployeeLoginName;
      const displayName =
        session.employeeDisplayName ??
        session.recipientEmployeeDisplayName ??
        loginName;
      if (!loginName || !displayName || employeeDirectory.has(loginName)) {
        continue;
      }
      employeeDirectory.set(loginName, {
        loginName,
        displayName,
        email: null,
      });
    }

    const employeeAnalytics = buildEmployeeAnalytics(
      {
        start: bucket.bucketStart,
        end: bucket.bucketStart,
        employees: [],
        direction: "all",
        outcome: "all",
        source: "all",
        search: "",
      },
      sessions,
      [...employeeDirectory.values()],
    );
    const breakdowns = buildBreakdownsForSessions(sessions);
    const bucketStartMs = Date.parse(bucket.bucketStart);
    const bucketEndMs = bucketStartMs + 24 * 60 * 60 * 1000;

    return {
      bucket,
      bucketEnd: new Date(bucketEndMs).toISOString(),
      stats: buildSummaryStats(sessions),
      employees: employeeAnalytics.leaderboard.slice(0, MAX_DRILLDOWN_ITEMS),
      outcomes: breakdowns.outcomes.slice(0, MAX_DRILLDOWN_ITEMS),
      sources: breakdowns.sources.slice(0, MAX_DRILLDOWN_ITEMS),
      companies: breakdowns.companies.slice(0, MAX_DRILLDOWN_ITEMS),
      calls: sessions.slice(0, MAX_DRILLDOWN_CALLS).map(toRecentCall),
    };
  });
}

function buildSnapshotFromSessions(
  filters: DashboardFilters,
  sessions: CallSessionRecord[],
  employees: EmployeeDirectoryOption[],
  generatedAt: string,
  cacheExpiresAt: string,
  emailRows?: StoredEmailAuditRow[],
): DashboardSnapshotResponse {
  const teamStats = buildSummaryStats(sessions);
  const trendGroups = new Map<string, DashboardTrendPoint>();
  const bucketSessions = new Map<string, CallSessionRecord[]>();

  for (const session of sessions) {
    const baseMs = Date.parse(session.startedAt ?? session.updatedAt);
    if (!Number.isFinite(baseMs)) {
      continue;
    }

    const bucketStartMs = startOfDay(baseMs);
    const bucketStart = new Date(bucketStartMs).toISOString();
    const point = trendGroups.get(bucketStart) ?? {
      bucketLabel: formatBucketLabel(bucketStartMs),
      bucketStart,
      totalCalls: 0,
      answeredCalls: 0,
      unansweredCalls: 0,
      talkSeconds: 0,
    };

    point.totalCalls += 1;
    if (session.answered) {
      point.answeredCalls += 1;
    } else if (session.direction === "outbound") {
      point.unansweredCalls += 1;
    }
    point.talkSeconds += Math.max(0, session.talkDurationSeconds ?? 0);
    trendGroups.set(bucketStart, point);

    const sessionsForBucket = bucketSessions.get(bucketStart) ?? [];
    sessionsForBucket.push(session);
    bucketSessions.set(bucketStart, sessionsForBucket);
  }

  const trendItems = [...trendGroups.values()]
    .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart))
    .slice(-MAX_TREND_BUCKETS);
  const visibleBucketSessions = new Map(
    trendItems.map((item) => [item.bucketStart, bucketSessions.get(item.bucketStart) ?? []]),
  );
  const breakdowns = buildBreakdownsForSessions(sessions);
  const employeeAnalytics = buildEmployeeAnalytics(filters, sessions, employees);
  const emailAnalytics = buildEmailAnalytics(filters, employees, emailRows);

  return {
    filters,
    generatedAt,
    cacheExpiresAt,
    importState: {
      scope: "voice",
      status: "idle",
      lastRecentSyncAt: null,
      lastFullBackfillAt: null,
      latestSeenStartTime: null,
      oldestSeenStartTime: null,
      fullHistoryComplete: false,
      lastWebhookAt: null,
      lastError: null,
      progress: null,
      updatedAt: generatedAt,
    },
    backgroundRefreshTriggered: false,
    viewer: {
      loginName: null,
    },
    employees,
    teamStats,
    emailStats: emailAnalytics.stats,
    trend: {
      filters,
      bucket: TREND_BUCKET,
      items: trendItems,
    },
    emailTrend: {
      filters,
      bucket: TREND_BUCKET,
      items: emailAnalytics.trendItems,
    },
    bucketDrilldowns: buildBucketDrilldowns(trendItems, visibleBucketSessions),
    employeeLeaderboard: employeeAnalytics.leaderboard,
    emailLeaderboard: emailAnalytics.leaderboard,
    activityGaps: employeeAnalytics.activityGaps,
    outcomeSummary: breakdowns.outcomes.slice(0, MAX_LEADERBOARD_ITEMS),
    sourceSummary: breakdowns.sources.slice(0, MAX_LEADERBOARD_ITEMS),
    companySummary: breakdowns.companies.slice(0, MAX_LEADERBOARD_ITEMS),
    recentCalls: sessions.slice(0, MAX_RECENT_CALLS).map(toRecentCall),
    recentEmails: emailAnalytics.recentEmails,
  };
}

export async function getDashboardSnapshot(filters: DashboardFilters): Promise<DashboardSnapshotResponse> {
  const cacheKey = buildSnapshotCacheKey(filters);
  const cached = readCachedDashboardSnapshot(cacheKey);
  if (cached) {
    return cached;
  }

  const existingRequest = readDashboardSnapshotInFlight(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = Promise.resolve().then(() => {
    const now = Date.now();
    const generatedAt = new Date(now).toISOString();
    const cacheExpiresAt = new Date(now + getEnv().CALL_ANALYTICS_STALE_AFTER_MS).toISOString();
    const employees = readCallEmployeeDirectory().map((item) => ({
      loginName: item.loginName,
      displayName: item.displayName,
      email: item.email,
    }));
    const sessions = filterCallSessions(readCallSessions(), filters);
    const snapshot = buildSnapshotFromSessions(filters, sessions, employees, generatedAt, cacheExpiresAt);
    writeCachedDashboardSnapshot(cacheKey, snapshot, now + getEnv().CALL_ANALYTICS_STALE_AFTER_MS);
    return snapshot;
  }).finally(() => {
    writeDashboardSnapshotInFlight(cacheKey, null);
  });

  writeDashboardSnapshotInFlight(cacheKey, request);
  return request;
}

export function buildDashboardSnapshotForTests(
  filters: DashboardFilters,
  sessions: CallSessionRecord[],
  employees: EmployeeDirectoryOption[],
  generatedAt = "2026-03-09T00:00:00.000Z",
  cacheExpiresAt = "2026-03-09T00:05:00.000Z",
  emailRows: StoredEmailAuditRow[] = [],
): DashboardSnapshotResponse {
  return buildSnapshotFromSessions(filters, sessions, employees, generatedAt, cacheExpiresAt, emailRows);
}

export function buildEmptyEmployeeActivityForTests(employee: EmployeeDirectoryOption): DashboardEmployeeActivityItem {
  return createEmptyEmployeeActivity(employee);
}

export function buildSummaryStatsForBucketDrilldown(stats: CallSummaryStats): CallSummaryStats {
  return stats;
}
