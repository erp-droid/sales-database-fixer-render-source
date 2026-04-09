import { beforeEach, describe, expect, it, vi } from "vitest";

const { countRemainingCallActivitySyncJobsMock } = vi.hoisted(() => ({
  countRemainingCallActivitySyncJobsMock: vi.fn(() => 0),
}));

const {
  buildPhoneMatchIndexMock,
  getEnvMock,
  matchPhoneToAccountWithIndexMock,
  readCallActivitySyncBySessionIdMock,
  readCallEmployeeDirectoryMock,
  readCallSessionsMock,
  serviceFindContactsByEmailSubstringMock,
} = vi.hoisted(() => ({
  buildPhoneMatchIndexMock: vi.fn(() => ({})),
  getEnvMock: vi.fn(() => ({
    MAIL_INTERNAL_DOMAIN: "meadowb.com",
    OPENAI_API_KEY: "",
  })),
  matchPhoneToAccountWithIndexMock: vi.fn(() => ({
    matchedContactId: null,
    matchedContactName: null,
    matchedBusinessAccountId: null,
    matchedCompanyName: null,
    phoneMatchType: "none",
    phoneMatchAmbiguityCount: 0,
  })),
  readCallActivitySyncBySessionIdMock: vi.fn(() => null),
  readCallEmployeeDirectoryMock: vi.fn(() => []),
  readCallSessionsMock: vi.fn(() => []),
  serviceFindContactsByEmailSubstringMock: vi.fn(async () => []),
}));

vi.mock("@/lib/call-analytics/postcall-worker", () => ({
  countRemainingCallActivitySyncJobs: countRemainingCallActivitySyncJobsMock,
}));

vi.mock("@/lib/call-analytics/phone-match", () => ({
  buildPhoneMatchIndex: buildPhoneMatchIndexMock,
  matchPhoneToAccountWithIndex: matchPhoneToAccountWithIndexMock,
}));

vi.mock("@/lib/call-analytics/postcall-store", () => ({
  readCallActivitySyncBySessionId: readCallActivitySyncBySessionIdMock,
}));

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallSessions: readCallSessionsMock,
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory: readCallEmployeeDirectoryMock,
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  serviceFindContactsByEmailSubstring: serviceFindContactsByEmailSubstringMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
}));

import {
  buildDailyCallCoachingCoverage,
  buildDailyCallCoachingReport,
  getDailyCallCoachingExistingSkipDetail,
  buildDailyCallCoachingMailPayload,
  buildDailyCallCoachingStats,
  buildFallbackDailyCallCoachingContent,
  type DailyCallCoachingCall,
  type DailyCallCoachingReport,
} from "@/lib/daily-call-coaching";
import type { CallIngestState } from "@/lib/call-analytics/types";

const SAMPLE_CALLS: DailyCallCoachingCall[] = [
  {
    sessionId: "call-1",
    startedAt: "2026-03-26T14:00:00.000Z",
    localTimeLabel: "10:00 AM",
    contactName: "Mandeep Sunner",
    companyName: "Brenntag",
    phoneNumber: "+19055550111",
    answered: true,
    outcome: "answered",
    talkDurationSeconds: 153,
    transcriptText: null,
    summaryText: "Discussed concrete availability and next follow-up timing.",
    analysisSource: "summary",
  },
  {
    sessionId: "call-2",
    startedAt: "2026-03-26T14:15:00.000Z",
    localTimeLabel: "10:15 AM",
    contactName: null,
    companyName: null,
    phoneNumber: "+19055550123",
    answered: false,
    outcome: "no_answer",
    talkDurationSeconds: 0,
    transcriptText: null,
    summaryText: null,
    analysisSource: "metadata",
  },
  {
    sessionId: "call-3",
    startedAt: "2026-03-26T15:00:00.000Z",
    localTimeLabel: "11:00 AM",
    contactName: "Jeremy Benns",
    companyName: "Lake City Foods",
    phoneNumber: "+19055550145",
    answered: true,
    outcome: "answered",
    talkDurationSeconds: 86,
    transcriptText: "We talked about timing, specs, and the next touchpoint.",
    summaryText: null,
    analysisSource: "transcript",
  },
];

describe("daily-call-coaching", () => {
  beforeEach(() => {
    countRemainingCallActivitySyncJobsMock.mockReset();
    countRemainingCallActivitySyncJobsMock.mockReturnValue(0);
    buildPhoneMatchIndexMock.mockReset();
    buildPhoneMatchIndexMock.mockReturnValue({});
    getEnvMock.mockReset();
    getEnvMock.mockReturnValue({
      MAIL_INTERNAL_DOMAIN: "meadowb.com",
      OPENAI_API_KEY: "",
    });
    matchPhoneToAccountWithIndexMock.mockReset();
    matchPhoneToAccountWithIndexMock.mockReturnValue({
      matchedContactId: null,
      matchedContactName: null,
      matchedBusinessAccountId: null,
      matchedCompanyName: null,
      phoneMatchType: "none",
      phoneMatchAmbiguityCount: 0,
    });
    readCallActivitySyncBySessionIdMock.mockReset();
    readCallActivitySyncBySessionIdMock.mockReturnValue(null);
    readCallEmployeeDirectoryMock.mockReset();
    readCallEmployeeDirectoryMock.mockReturnValue([]);
    readCallSessionsMock.mockReset();
    readCallSessionsMock.mockReturnValue([]);
    serviceFindContactsByEmailSubstringMock.mockReset();
    serviceFindContactsByEmailSubstringMock.mockResolvedValue([]);
  });

  it("treats a completed same-day import as complete coverage for the report date", () => {
    const state: CallIngestState = {
      scope: "voice",
      status: "complete",
      lastRecentSyncAt: "2026-04-08T22:05:00.000Z",
      lastFullBackfillAt: null,
      latestSeenStartTime: "2026-04-08T18:14:25.000Z",
      oldestSeenStartTime: null,
      fullHistoryComplete: true,
      lastWebhookAt: null,
      lastError: null,
      progress: null,
      updatedAt: "2026-04-08T22:05:00.000Z",
    };

    const coverage = buildDailyCallCoachingCoverage("2026-04-08", "America/Toronto", state);

    expect(coverage.complete).toBe(true);
    expect(coverage.snapshotLastRecentSyncAt).toBe("2026-04-08T22:05:00.000Z");
  });

  it("refuses to treat an earlier-day import as complete coverage for the report date", () => {
    const state: CallIngestState = {
      scope: "voice",
      status: "complete",
      lastRecentSyncAt: "2026-04-07T18:21:59.532Z",
      lastFullBackfillAt: null,
      latestSeenStartTime: "2026-04-07T18:14:25.000Z",
      oldestSeenStartTime: null,
      fullHistoryComplete: true,
      lastWebhookAt: null,
      lastError: null,
      progress: null,
      updatedAt: "2026-04-07T18:21:59.532Z",
    };

    const coverage = buildDailyCallCoachingCoverage("2026-04-08", "America/Toronto", state);

    expect(coverage.complete).toBe(false);
    expect(coverage.detail).toContain("only confirmed through 2026-04-07");
  });

  it("refuses coverage when the latest import reported an error", () => {
    const state: CallIngestState = {
      scope: "voice",
      status: "error",
      lastRecentSyncAt: "2026-04-09T11:05:00.000Z",
      lastFullBackfillAt: null,
      latestSeenStartTime: "2026-04-08T18:14:25.000Z",
      oldestSeenStartTime: null,
      fullHistoryComplete: true,
      lastWebhookAt: null,
      lastError: "The service is unavailable.",
      progress: null,
      updatedAt: "2026-04-09T11:05:00.000Z",
    };

    const coverage = buildDailyCallCoachingCoverage("2026-04-08", "America/Toronto", state);

    expect(coverage.complete).toBe(false);
    expect(coverage.detail).toContain("The service is unavailable.");
  });

  it("allows coverage while same-day call processing jobs are still pending", () => {
    countRemainingCallActivitySyncJobsMock.mockReturnValue(3);

    const state: CallIngestState = {
      scope: "voice",
      status: "complete",
      lastRecentSyncAt: "2026-04-08T22:05:00.000Z",
      lastFullBackfillAt: null,
      latestSeenStartTime: "2026-04-08T18:14:25.000Z",
      oldestSeenStartTime: null,
      fullHistoryComplete: true,
      lastWebhookAt: null,
      lastError: null,
      progress: null,
      updatedAt: "2026-04-08T22:05:00.000Z",
    };

    const coverage = buildDailyCallCoachingCoverage("2026-04-08", "America/Toronto", state);

    expect(coverage.complete).toBe(true);
    expect(coverage.remainingCallSyncCount).toBe(3);
    expect(coverage.detail).toContain("metadata fallback");
  });

  it("builds daily coaching stats from call rows", () => {
    const stats = buildDailyCallCoachingStats(SAMPLE_CALLS);

    expect(stats.totalCalls).toBe(3);
    expect(stats.answeredCalls).toBe(2);
    expect(stats.unansweredCalls).toBe(1);
    expect(stats.totalTalkSeconds).toBe(239);
    expect(stats.averageTalkSeconds).toBeCloseTo(79.66, 1);
    expect(stats.uniqueNamedContacts).toBe(2);
    expect(stats.unresolvedCalls).toBe(1);
    expect(stats.shortCalls).toBe(1);
    expect(stats.mediumCalls).toBe(1);
    expect(stats.longCalls).toBe(1);
  });

  it("builds a fallback coaching payload with actionable content", () => {
    const content = buildFallbackDailyCallCoachingContent({
      subjectDisplayName: "Samuel Tita",
      stats: buildDailyCallCoachingStats(SAMPLE_CALLS),
      transcriptCallCount: 1,
      calls: SAMPLE_CALLS,
    });

    expect(content.headline).toContain("Samuel Tita");
    expect(content.strengths.length).toBeGreaterThan(0);
    expect(content.actionItems.length).toBeGreaterThan(0);
    expect(content.strongCalls.length).toBeGreaterThan(0);
    expect(content.strongCalls[0]?.label).toContain("Mandeep Sunner");
    expect(content.weakCalls.length).toBeGreaterThan(0);
    expect(content.weakCalls.some((item) => item.why.includes("no answer"))).toBe(true);
    expect(content.followUps.length).toBeGreaterThan(0);
  });

  it("renders a readable coaching email payload", () => {
    const report: DailyCallCoachingReport = {
      reportDate: "2026-03-26",
      subjectLoginName: "stita",
      subjectDisplayName: "Samuel Tita",
      recipientEmail: "jserrano@meadowb.com",
      previewMode: true,
      senderLoginName: "jserrano",
      stats: buildDailyCallCoachingStats(SAMPLE_CALLS),
      calls: SAMPLE_CALLS,
      content: buildFallbackDailyCallCoachingContent({
        subjectDisplayName: "Samuel Tita",
        stats: buildDailyCallCoachingStats(SAMPLE_CALLS),
        transcriptCallCount: 1,
        calls: SAMPLE_CALLS,
      }),
      subjectLine: "[Preview] Daily Call Coaching for Samuel Tita · Mar 26, 2026",
    };

    const payload = buildDailyCallCoachingMailPayload(report, {
      loginName: "jserrano",
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      contactId: 157497,
    });

    expect(payload.subject).toContain("Samuel Tita");
    expect(payload.htmlBody).toContain("Next Things To Do");
    expect(payload.htmlBody).toContain("Calls That Landed");
    expect(payload.htmlBody).toContain("Calls That Missed");
    expect(payload.htmlBody).toContain("Follow Up Next");
    expect(payload.htmlBody).toContain("Answered");
    expect(payload.htmlBody).toContain("Unanswered");
    expect(payload.htmlBody).toContain("Mandeep Sunner");
    expect(payload.htmlBody).toContain("Jeremy Benns");
    expect(payload.htmlBody).toContain("Preview copy");
    expect(payload.to[0]?.email).toBe("jserrano@meadowb.com");
    expect(payload.htmlBody).toContain("+19055550123");
    expect(payload.htmlBody).not.toContain("Unresolved target");
  });

  it("treats sent rows as terminal for automatic retries", () => {
    expect(getDailyCallCoachingExistingSkipDetail({ status: "sent" })).toBe(
      "Already sent for this date and recipient.",
    );
  });

  it("suppresses automatic retries after a failed send attempt", () => {
    expect(getDailyCallCoachingExistingSkipDetail({ status: "failed" })).toBe(
      "Previous send attempt failed. Automatic retry is suppressed to avoid duplicate coach emails.",
    );
  });

  it("suppresses automatic retries while a send attempt is still pending", () => {
    expect(getDailyCallCoachingExistingSkipDetail({ status: "sending" })).toBe(
      "Previous send attempt is still pending verification. Automatic retry is suppressed to avoid duplicate coach emails.",
    );
  });

  it("allows a forced rerun to bypass stored row suppression", () => {
    expect(getDailyCallCoachingExistingSkipDetail({ status: "failed", force: true })).toBeNull();
    expect(getDailyCallCoachingExistingSkipDetail({ status: "sending", force: true })).toBeNull();
  });

  it("uses a fallback contact id for internal coaching recipients", () => {
    const report: DailyCallCoachingReport = {
      reportDate: "2026-03-26",
      subjectLoginName: "stita",
      subjectDisplayName: "Samuel Tita",
      recipientEmail: "stita@meadowb.com",
      previewMode: false,
      senderLoginName: "jserrano",
      stats: buildDailyCallCoachingStats(SAMPLE_CALLS),
      calls: SAMPLE_CALLS,
      content: buildFallbackDailyCallCoachingContent({
        subjectDisplayName: "Samuel Tita",
        stats: buildDailyCallCoachingStats(SAMPLE_CALLS),
        transcriptCallCount: 1,
        calls: SAMPLE_CALLS,
      }),
      subjectLine: "Daily Call Coaching for Samuel Tita · Mar 26, 2026",
    };

    const payload = buildDailyCallCoachingMailPayload(
      report,
      {
        loginName: "stita",
        displayName: "Samuel Tita",
        email: "stita@meadowb.com",
        contactId: null,
      },
      157497,
    );

    expect(payload.to[0]?.email).toBe("stita@meadowb.com");
    expect(payload.to[0]?.contactId).toBe(157497);
    expect(payload.matchedContacts[0]?.contactId).toBe(157497);
    expect(payload.matchedContacts[0]?.email).toBe("stita@meadowb.com");
  });

  it("aggregates aliased rep login names into one daily report", async () => {
    readCallEmployeeDirectoryMock.mockReturnValue([
      {
        loginName: "kpareek",
        contactId: null,
        displayName: "Krishna Pareek",
        email: "kpareek@meadowb.com",
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-04-09T00:00:00.000Z",
      },
    ]);
    readCallSessionsMock.mockReturnValue([
      {
        sessionId: "call-1",
        startedAt: "2026-04-08T14:00:00.000Z",
        updatedAt: "2026-04-08T14:05:00.000Z",
        direction: "outbound",
        employeeLoginName: "kpareek",
        employeeDisplayName: "Krishna Pareek",
        employeeContactId: null,
        matchedContactName: "Mandeep Sunner",
        matchedCompanyName: "Brenntag",
        counterpartyPhone: "+19055550111",
        targetPhone: "+19055550111",
        answered: true,
        outcome: "answered",
        talkDurationSeconds: 153,
        metadataJson: "{}",
      },
      {
        sessionId: "call-2",
        startedAt: "2026-04-08T15:00:00.000Z",
        updatedAt: "2026-04-08T15:04:00.000Z",
        direction: "outbound",
        employeeLoginName: "Krishna Pareek",
        employeeDisplayName: "Krishna Pareek",
        employeeContactId: null,
        matchedContactName: "Jeremy Benns",
        matchedCompanyName: "Lake City Foods",
        counterpartyPhone: "+19055550145",
        targetPhone: "+19055550145",
        answered: true,
        outcome: "answered",
        talkDurationSeconds: 86,
        metadataJson: JSON.stringify({
          appContext: {
            displayName: "Krishna Pareek",
          },
        }),
      },
    ]);
    readCallActivitySyncBySessionIdMock.mockImplementation((sessionId: string) => {
      if (sessionId === "call-1") {
        return {
          transcriptText: null,
          summaryText: "Discussed concrete availability and next follow-up timing.",
        };
      }

      return {
        transcriptText: "We talked about timing, specs, and the next touchpoint.",
        summaryText: null,
      };
    });

    const report = await buildDailyCallCoachingReport({
      reportDate: "2026-04-08",
      subjectLoginName: "kpareek",
      recipientEmail: "kpareek@meadowb.com",
      previewMode: false,
      senderLoginName: "jserrano",
      timeZone: "America/Toronto",
    });

    expect(report).not.toBeNull();
    expect(report?.subjectDisplayName).toBe("Krishna Pareek");
    expect(report?.calls).toHaveLength(2);
    expect(report?.stats.totalCalls).toBe(2);
    expect(report?.calls.map((call) => call.contactName)).toEqual([
      "Mandeep Sunner",
      "Jeremy Benns",
    ]);
  });
});
