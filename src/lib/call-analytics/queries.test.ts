import { describe, expect, it } from "vitest";

import { buildSummaryStats, filterCallSessions, parseDashboardFilters } from "@/lib/call-analytics/queries";
import type { CallSessionRecord } from "@/lib/call-analytics/types";

function buildSession(overrides: Partial<CallSessionRecord>): CallSessionRecord {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    rootCallSid: overrides.rootCallSid ?? "CA-root",
    primaryLegSid: overrides.primaryLegSid ?? "CA-leg",
    source: overrides.source ?? "app_bridge",
    direction: overrides.direction ?? "outbound",
    outcome: overrides.outcome ?? "answered",
    answered: overrides.answered ?? true,
    startedAt: overrides.startedAt ?? "2026-03-08T14:00:00.000Z",
    answeredAt: overrides.answeredAt ?? "2026-03-08T14:00:03.000Z",
    endedAt: overrides.endedAt ?? "2026-03-08T14:05:00.000Z",
    talkDurationSeconds: overrides.talkDurationSeconds ?? 297,
    ringDurationSeconds: overrides.ringDurationSeconds ?? 3,
    employeeLoginName: overrides.employeeLoginName ?? "jserrano",
    employeeDisplayName: overrides.employeeDisplayName ?? "Jose Serrano",
    employeeContactId: overrides.employeeContactId ?? 1,
    employeePhone: overrides.employeePhone ?? "+14162304681",
    recipientEmployeeLoginName: overrides.recipientEmployeeLoginName ?? null,
    recipientEmployeeDisplayName: overrides.recipientEmployeeDisplayName ?? null,
    presentedCallerId: overrides.presentedCallerId ?? "+14162304681",
    bridgeNumber: overrides.bridgeNumber ?? "+16474929859",
    targetPhone: overrides.targetPhone ?? "+14163153228",
    counterpartyPhone: overrides.counterpartyPhone ?? "+14163153228",
    matchedContactId: overrides.matchedContactId ?? 91,
    matchedContactName: overrides.matchedContactName ?? "Alex Prospect",
    matchedBusinessAccountId: overrides.matchedBusinessAccountId ?? "B2001",
    matchedCompanyName: overrides.matchedCompanyName ?? "Prospect Co",
    phoneMatchType: overrides.phoneMatchType ?? "contact_phone",
    phoneMatchAmbiguityCount: overrides.phoneMatchAmbiguityCount ?? 1,
    initiatedFromSurface: overrides.initiatedFromSurface ?? "accounts",
    linkedAccountRowKey: overrides.linkedAccountRowKey ?? "row-1",
    linkedBusinessAccountId: overrides.linkedBusinessAccountId ?? "B2001",
    linkedContactId: overrides.linkedContactId ?? 91,
    metadataJson: overrides.metadataJson ?? "{}",
    updatedAt: overrides.updatedAt ?? "2026-03-08T14:05:00.000Z",
  };
}

describe("parseDashboardFilters", () => {
  it("parses repeated employee filters and constrained enums", () => {
    const params = new URLSearchParams();
    params.set("start", "2026-03-01T00:00:00.000Z");
    params.set("end", "2026-03-09T23:59:59.000Z");
    params.append("employee", "jserrano");
    params.append("employee", "pparker");
    params.set("direction", "outbound");
    params.set("outcome", "unanswered");
    params.set("source", "app");
    params.set("search", "4163153228");

    expect(parseDashboardFilters(params)).toEqual({
      start: "2026-03-01T00:00:00.000Z",
      end: "2026-03-09T23:59:59.000Z",
      employees: ["jserrano", "pparker"],
      direction: "outbound",
      outcome: "unanswered",
      source: "app",
      search: "4163153228",
    });
  });
});

describe("filterCallSessions", () => {
  it("filters by employee, source, direction, date range, and unanswered outcome", () => {
    const sessions = [
      buildSession({
        sessionId: "answered-app",
        startedAt: "2026-03-08T10:00:00.000Z",
        answered: true,
        outcome: "answered",
        source: "app_bridge",
      }),
      buildSession({
        sessionId: "missed-app",
        startedAt: "2026-03-08T11:00:00.000Z",
        answered: false,
        outcome: "no_answer",
        talkDurationSeconds: 0,
        source: "app_bridge",
      }),
      buildSession({
        sessionId: "other-user",
        startedAt: "2026-03-08T12:00:00.000Z",
        employeeLoginName: "pparker",
        employeeDisplayName: "Peter Parker",
        source: "twilio_direct",
      }),
    ];

    const filtered = filterCallSessions(sessions, {
      start: "2026-03-08T00:00:00.000Z",
      end: "2026-03-09T00:00:00.000Z",
      employees: ["jserrano"],
      direction: "outbound",
      outcome: "unanswered",
      source: "app",
      search: "alex prospect",
    });

    expect(filtered.map((session) => session.sessionId)).toEqual(["missed-app"]);
  });
});

describe("buildSummaryStats", () => {
  it("computes answer rate and talk durations from outbound sessions", () => {
    const stats = buildSummaryStats([
      buildSession({
        sessionId: "answered-call",
        answered: true,
        outcome: "answered",
        direction: "outbound",
        talkDurationSeconds: 120,
      }),
      buildSession({
        sessionId: "missed-call",
        answered: false,
        outcome: "no_answer",
        direction: "outbound",
        talkDurationSeconds: 0,
      }),
      buildSession({
        sessionId: "missed-inbound",
        answered: false,
        outcome: "no_answer",
        direction: "inbound",
        talkDurationSeconds: 0,
      }),
    ]);

    expect(stats.totalCalls).toBe(3);
    expect(stats.outboundCalls).toBe(2);
    expect(stats.inboundCalls).toBe(1);
    expect(stats.answeredCalls).toBe(1);
    expect(stats.unansweredCalls).toBe(1);
    expect(stats.answerRate).toBe(0.5);
    expect(stats.totalTalkSeconds).toBe(120);
    expect(stats.averageTalkSeconds).toBe(120);
    expect(stats.missedInboundCalls).toBe(1);
  });
});
