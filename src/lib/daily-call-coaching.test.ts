import { beforeEach, describe, expect, it, vi } from "vitest";

const { countRemainingCallActivitySyncJobsMock } = vi.hoisted(() => ({
  countRemainingCallActivitySyncJobsMock: vi.fn(() => 0),
}));

vi.mock("@/lib/call-analytics/postcall-worker", () => ({
  countRemainingCallActivitySyncJobs: countRemainingCallActivitySyncJobsMock,
}));

import {
  buildDailyCallCoachingCoverage,
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

  it("refuses coverage while same-day call processing jobs are still pending", () => {
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

    expect(coverage.complete).toBe(false);
    expect(coverage.remainingCallSyncCount).toBe(3);
    expect(coverage.detail).toContain("3 call activity job(s)");
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
  });
});
