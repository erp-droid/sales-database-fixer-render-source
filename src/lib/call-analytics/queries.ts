import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { readCallIngestState } from "@/lib/call-analytics/ingest";
import { readCallActivitySyncBySessionId } from "@/lib/call-analytics/postcall-store";
import { readCallLegsBySessionId, readCallSessionById, readCallSessions } from "@/lib/call-analytics/sessionize";
import type {
  CallAnalyticsOutcome,
  CallAnalyticsSource,
  CallBreakdownDimension,
  CallDirectionFilter,
  CallOutcomeFilter,
  CallSessionRecord,
  CallSourceFilter,
  DashboardBreakdownResponse,
  DashboardCallDetailResponse,
  DashboardCallListResponse,
  DashboardFilters,
  DashboardOverviewResponse,
  DashboardRecentCall,
  DashboardTrendResponse,
  CallSummaryStats,
} from "@/lib/call-analytics/types";
export { parseDashboardFilters } from "@/lib/call-analytics/filter-params";

type DashboardCallListPage = Pick<
  DashboardCallListResponse,
  "filters" | "page" | "pageSize" | "total" | "items"
>;

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeek(value: number): number {
  const date = new Date(value);
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatBucketLabel(startMs: number, bucket: "day" | "week"): string {
  const date = new Date(startMs);
  if (bucket === "week") {
    return `Week of ${date.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
  }

  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function matchesSource(source: CallAnalyticsSource, filter: CallSourceFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "app") {
    return source === "app_bridge";
  }

  return source !== "app_bridge";
}

function isUnansweredOutcome(outcome: CallAnalyticsOutcome): boolean {
  return outcome === "no_answer" || outcome === "busy" || outcome === "failed" || outcome === "canceled";
}

function matchesOutcome(outcome: CallAnalyticsOutcome, filter: CallOutcomeFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "unanswered") {
    return isUnansweredOutcome(outcome);
  }

  return outcome === filter;
}

function matchesDirection(direction: string, filter: CallDirectionFilter): boolean {
  return filter === "all" ? true : direction === filter;
}

function matchesSearch(session: CallSessionRecord, search: string): boolean {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const haystack = [
    session.employeeDisplayName,
    session.employeeLoginName,
    session.matchedContactName,
    session.matchedCompanyName,
    session.counterpartyPhone,
    session.targetPhone,
    session.rootCallSid,
    session.primaryLegSid,
    session.presentedCallerId,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalized);
}

function matchesEmployees(session: CallSessionRecord, employees: string[]): boolean {
  if (employees.length === 0) {
    return true;
  }

  const employee = session.employeeLoginName?.toLowerCase() ?? "";
  const recipient = session.recipientEmployeeLoginName?.toLowerCase() ?? "";
  return employees.includes(employee) || employees.includes(recipient);
}

function withinRange(session: CallSessionRecord, startMs: number, endMs: number): boolean {
  const targetMs = Date.parse(session.startedAt ?? session.updatedAt);
  return Number.isFinite(targetMs) && targetMs >= startMs && targetMs <= endMs;
}

export function filterCallSessions(
  sessions: CallSessionRecord[],
  filters: DashboardFilters,
): CallSessionRecord[] {
  const startMs = Date.parse(filters.start);
  const endMs = Date.parse(filters.end);

  return sessions.filter((session) => {
    return (
      withinRange(session, startMs, endMs) &&
      matchesEmployees(session, filters.employees) &&
      matchesDirection(session.direction, filters.direction) &&
      matchesOutcome(session.outcome, filters.outcome) &&
      matchesSource(session.source, filters.source) &&
      matchesSearch(session, filters.search)
    );
  });
}

function buildRecentCall(session: CallSessionRecord): DashboardRecentCall {
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

export function buildSummaryStats(sessions: CallSessionRecord[]): CallSummaryStats {
  const outboundCalls = sessions.filter((session) => session.direction === "outbound");
  const inboundCalls = sessions.filter((session) => session.direction === "inbound");
  const answeredCalls = sessions.filter((session) => session.answered).length;
  const unansweredCalls = sessions.filter((session) => !session.answered && session.direction === "outbound").length;
  const totalTalkSeconds = sessions.reduce(
    (sum, session) => sum + Math.max(0, session.talkDurationSeconds ?? 0),
    0,
  );
  const answeredOutboundCount = outboundCalls.filter((session) => session.answered).length;

  return {
    totalCalls: sessions.length,
    outboundCalls: outboundCalls.length,
    inboundCalls: inboundCalls.length,
    answeredCalls,
    unansweredCalls,
    answerRate: outboundCalls.length > 0 ? answeredOutboundCount / outboundCalls.length : 0,
    totalTalkSeconds,
    averageTalkSeconds: answeredCalls > 0 ? totalTalkSeconds / answeredCalls : 0,
    missedInboundCalls: inboundCalls.filter((session) => !session.answered).length,
  };
}

export function buildDashboardOverview(
  filters: DashboardFilters,
  viewerLoginName: string | null,
  viewerDisplayName: string | null,
): DashboardOverviewResponse {
  const sessions = readCallSessions();
  const filtered = filterCallSessions(sessions, filters);
  const viewerSessions = filterCallSessions(sessions, {
    ...filters,
    employees: viewerLoginName ? [viewerLoginName.toLowerCase()] : [],
    direction: "outbound",
  });

  return {
    filters,
    importState: readCallIngestState(),
    employees: readCallEmployeeDirectory().map((item) => ({
      loginName: item.loginName,
      displayName: item.displayName,
      email: item.email,
    })),
    viewer: {
      loginName: viewerLoginName,
      displayName: viewerDisplayName,
    },
    myStats: buildSummaryStats(viewerSessions),
    myRecentCalls: viewerSessions.slice(0, 10).map(buildRecentCall),
    teamStats: buildSummaryStats(filtered),
  };
}

export function buildDashboardTrend(
  filters: DashboardFilters,
  bucket: "day" | "week",
): DashboardTrendResponse {
  const sessions = filterCallSessions(readCallSessions(), filters);
  const grouped = new Map<number, DashboardTrendResponse["items"][number]>();

  for (const session of sessions) {
    const baseMs = Date.parse(session.startedAt ?? session.updatedAt);
    if (!Number.isFinite(baseMs)) {
      continue;
    }

    const bucketStart = bucket === "week" ? startOfWeek(baseMs) : startOfDay(baseMs);
    const existing = grouped.get(bucketStart) ?? {
      bucketLabel: formatBucketLabel(bucketStart, bucket),
      bucketStart: new Date(bucketStart).toISOString(),
      totalCalls: 0,
      answeredCalls: 0,
      unansweredCalls: 0,
      talkSeconds: 0,
    };

    existing.totalCalls += 1;
    if (session.answered) {
      existing.answeredCalls += 1;
    } else if (session.direction === "outbound") {
      existing.unansweredCalls += 1;
    }
    existing.talkSeconds += Math.max(0, session.talkDurationSeconds ?? 0);
    grouped.set(bucketStart, existing);
  }

  return {
    filters,
    bucket,
    items: [...grouped.entries()]
      .sort((left, right) => left[0] - right[0])
      .map((entry) => entry[1]),
  };
}

function breakdownKey(session: CallSessionRecord, dimension: CallBreakdownDimension): {
  key: string;
  label: string;
} {
  switch (dimension) {
    case "employee":
      return {
        key: session.employeeLoginName ?? "unattributed",
        label: session.employeeDisplayName ?? session.employeeLoginName ?? "Unattributed",
      };
    case "outcome":
      return {
        key: session.outcome,
        label: session.outcome.replace(/_/g, " "),
      };
    case "company":
      return {
        key: session.matchedBusinessAccountId ?? session.matchedCompanyName ?? "unknown",
        label: session.matchedCompanyName ?? "Unknown company",
      };
    case "contact":
      return {
        key: session.matchedContactId ? String(session.matchedContactId) : session.matchedContactName ?? "unknown",
        label: session.matchedContactName ?? "Unknown contact",
      };
    case "source":
      return {
        key: session.source,
        label:
          session.source === "app_bridge"
            ? "App bridge"
            : session.source === "twilio_direct"
              ? "Twilio direct"
              : session.source === "inbound"
                ? "Inbound"
                : "Unknown",
      };
    case "direction":
      return {
        key: session.direction,
        label: session.direction,
      };
  }
}

export function buildDashboardBreakdown(
  filters: DashboardFilters,
  dimension: CallBreakdownDimension,
): DashboardBreakdownResponse {
  const sessions = filterCallSessions(readCallSessions(), filters);
  const buckets = new Map<string, DashboardBreakdownResponse["items"][number]>();

  for (const session of sessions) {
    const { key, label } = breakdownKey(session, dimension);
    const existing = buckets.get(key) ?? {
      key,
      label,
      totalCalls: 0,
      answeredCalls: 0,
      unansweredCalls: 0,
      answerRate: 0,
      talkSeconds: 0,
    };

    existing.totalCalls += 1;
    if (session.answered) {
      existing.answeredCalls += 1;
    } else if (session.direction === "outbound") {
      existing.unansweredCalls += 1;
    }
    existing.talkSeconds += Math.max(0, session.talkDurationSeconds ?? 0);
    existing.answerRate =
      existing.totalCalls > 0 ? existing.answeredCalls / existing.totalCalls : 0;
    buckets.set(key, existing);
  }

  return {
    filters,
    dimension,
    items: [...buckets.values()].sort((left, right) => right.totalCalls - left.totalCalls),
  };
}

export function buildDashboardCallList(
  filters: DashboardFilters,
  page: number,
  pageSize: number,
): DashboardCallListPage {
  const sessions = filterCallSessions(readCallSessions(), filters);
  const currentPage = Math.max(1, Math.trunc(page));
  const currentPageSize = Math.max(1, Math.min(200, Math.trunc(pageSize)));
  const start = (currentPage - 1) * currentPageSize;

  return {
    filters,
    page: currentPage,
    pageSize: currentPageSize,
    total: sessions.length,
    items: sessions.slice(start, start + currentPageSize).map(buildRecentCall),
  };
}

export function buildDashboardCallDetail(sessionId: string): DashboardCallDetailResponse | null {
  const session = readCallSessionById(sessionId);
  if (!session) {
    return null;
  }

  const legs = readCallLegsBySessionId(sessionId);
  const timeline = legs.flatMap((leg) => {
    const raw = JSON.parse(leg.rawJson) as { events?: Array<{ event?: string; occurredAt?: string | null; status?: string | null }> };
    const rawEvents = Array.isArray(raw.events)
      ? raw.events.map((event) => ({
          label: event.event ?? event.status ?? "update",
          status: event.status ?? event.event ?? "update",
          occurredAt: event.occurredAt ?? null,
          legSid: leg.sid,
        }))
      : [];
    if (rawEvents.length > 0) {
      return rawEvents;
    }

    const inferred = [
      {
        label: "initiated",
        status: leg.status ?? "initiated",
        occurredAt: leg.startedAt,
        legSid: leg.sid,
      },
      leg.answeredAt
        ? {
            label: "answered",
            status: "answered",
            occurredAt: leg.answeredAt,
            legSid: leg.sid,
          }
        : null,
      leg.endedAt
        ? {
            label: leg.status ?? "completed",
            status: leg.status ?? "completed",
            occurredAt: leg.endedAt,
            legSid: leg.sid,
          }
        : null,
    ].filter(Boolean) as Array<{
      label: string;
      status: string;
      occurredAt: string | null;
      legSid: string | null;
    }>;

    return inferred;
  }).sort((left, right) => {
    const leftMs = left.occurredAt ? Date.parse(left.occurredAt) : 0;
    const rightMs = right.occurredAt ? Date.parse(right.occurredAt) : 0;
    return leftMs - rightMs;
  });

  return {
    session,
    legs,
    timeline,
    activitySync: (() => {
      const sync = readCallActivitySyncBySessionId(sessionId);
      if (!sync) {
        return null;
      }

      return {
        status: sync.status,
        activityId: sync.activityId,
        error: sync.error,
        updatedAt: sync.updatedAt,
      };
    })(),
  };
}

export function buildDashboardExportCsv(filters: DashboardFilters): string {
  const rows = filterCallSessions(readCallSessions(), filters);
  const lines = [
    [
      "Session ID",
      "Started At",
      "Employee",
      "Login Name",
      "Direction",
      "Source",
      "Outcome",
      "Answered",
      "Company",
      "Contact",
      "Phone Number",
      "Talk Seconds",
      "Ring Seconds",
      "Root SID",
      "Primary Leg SID",
    ].join(","),
  ];

  for (const session of rows) {
    lines.push(
      [
        session.sessionId,
        session.startedAt ?? "",
        session.employeeDisplayName ?? "",
        session.employeeLoginName ?? "",
        session.direction,
        session.source,
        session.outcome,
        session.answered ? "Yes" : "No",
        session.matchedCompanyName ?? "",
        session.matchedContactName ?? "",
        session.counterpartyPhone ?? session.targetPhone ?? "",
        session.talkDurationSeconds ?? "",
        session.ringDurationSeconds ?? "",
        session.rootCallSid,
        session.primaryLegSid ?? "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );
  }

  return lines.join("\n");
}
