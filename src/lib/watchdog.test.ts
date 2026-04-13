import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  buildDailyCallCoachingCoverageMock,
  getEnvMock,
  pickSubjectLoginsMock,
  readCallIngestStateMock,
} = vi.hoisted(() => ({
  buildDailyCallCoachingCoverageMock: vi.fn(() => ({
    complete: true,
    status: "complete",
    detail: "Coverage complete.",
    snapshotLastRecentSyncAt: "2026-04-08T22:05:00.000Z",
    snapshotLatestSeenStartTime: "2026-04-08T18:14:25.000Z",
    snapshotLastError: null,
    remainingCallSyncCount: 0,
    confirmedThroughDate: "2026-04-08",
    staleDays: null,
  })),
  getEnvMock: vi.fn(() => ({
    DAILY_CALL_COACHING_ENABLED: false,
    DAILY_CALL_COACHING_LOOKBACK_DAYS: 1,
    DAILY_CALL_COACHING_SCHEDULE_HOUR: 7,
    DAILY_CALL_COACHING_SCHEDULE_MINUTE: 0,
    DAILY_CALL_COACHING_TIME_ZONE: "America/Toronto",
  })),
  pickSubjectLoginsMock: vi.fn(() => []),
  readCallIngestStateMock: vi.fn(() => ({
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
  })),
}));

// ── Mocks (vi.mock is hoisted — use vi.fn() inline) ───────────────────

vi.mock("@/lib/watchdog-notify", () => ({
  sendWatchdogNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/call-analytics/postcall-store", () => ({
  listPendingCallActivitySyncJobs: vi.fn().mockReturnValue([]),
  readCallActivitySyncBySessionId: vi.fn().mockReturnValue(null),
  markCallActivitySyncFailed: vi.fn().mockImplementation((id: string, err: string) => ({
    sessionId: id,
    status: "failed",
    error: err,
    attempts: 1,
  })),
  markCallActivitySyncSkipped: vi.fn().mockImplementation((id: string, err: string) => ({
    sessionId: id,
    status: "skipped",
    error: err,
    attempts: 1,
  })),
  requeueCallActivitySyncJob: vi.fn().mockImplementation((id: string, err: string) => ({
    sessionId: id,
    status: "queued",
    error: err,
    attempts: 1,
  })),
}));

vi.mock("@/lib/call-analytics/postcall-worker", () => ({
  processCallActivitySyncJob: vi.fn().mockResolvedValue(null),
  resolveActivityTarget: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallSessionById: vi.fn().mockReturnValue(null),
  readCallLegsBySessionId: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/call-analytics/ingest", () => ({
  reconcileTwilioSession: vi.fn().mockResolvedValue(null),
  readCallIngestState: readCallIngestStateMock,
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  clearCachedServiceAcumaticaSession: vi.fn(),
}));

vi.mock("@/lib/daily-call-coaching", () => ({
  buildDailyCallCoachingCoverage: buildDailyCallCoachingCoverageMock,
  pickSubjectLogins: pickSubjectLoginsMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
}));

const mockDbAll = vi.fn().mockReturnValue([]);
const mockDbGet = vi.fn().mockReturnValue(undefined);
vi.mock("@/lib/read-model/db", () => ({
  getReadModelDb: () => ({
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => mockDbAll(sql, ...args),
      get: (...args: unknown[]) => mockDbGet(sql, ...args),
    }),
  }),
}));

vi.mock("@/lib/errors", () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "Unknown error"),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// ── Import after mocks ─────────────────────────────────────────────────

import { runWatchdog } from "./watchdog";
import {
  markCallActivitySyncFailed,
  markCallActivitySyncSkipped,
  requeueCallActivitySyncJob,
} from "@/lib/call-analytics/postcall-store";
import { processCallActivitySyncJob } from "@/lib/call-analytics/postcall-worker";
import { readCallSessionById } from "@/lib/call-analytics/sessionize";
import { clearCachedServiceAcumaticaSession } from "@/lib/acumatica-service-auth";

const mockedMarkFailed = vi.mocked(markCallActivitySyncFailed);
const mockedMarkSkipped = vi.mocked(markCallActivitySyncSkipped);
const mockedRequeueJob = vi.mocked(requeueCallActivitySyncJob);
const mockedProcessJob = vi.mocked(processCallActivitySyncJob);
const mockedReadSession = vi.mocked(readCallSessionById);
const mockedClearSession = vi.mocked(clearCachedServiceAcumaticaSession);

// ── Tests ──────────────────────────────────────────────────────────────

describe("watchdog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbAll.mockReturnValue([]);
    mockDbGet.mockReturnValue(undefined);
    getEnvMock.mockReturnValue({
      DAILY_CALL_COACHING_ENABLED: false,
      DAILY_CALL_COACHING_LOOKBACK_DAYS: 1,
      DAILY_CALL_COACHING_SCHEDULE_HOUR: 7,
      DAILY_CALL_COACHING_SCHEDULE_MINUTE: 0,
      DAILY_CALL_COACHING_TIME_ZONE: "America/Toronto",
    });
    buildDailyCallCoachingCoverageMock.mockReturnValue({
      complete: true,
      status: "complete",
      detail: "Coverage complete.",
      snapshotLastRecentSyncAt: "2026-04-08T22:05:00.000Z",
      snapshotLatestSeenStartTime: "2026-04-08T18:14:25.000Z",
      snapshotLastError: null,
      remainingCallSyncCount: 0,
      confirmedThroughDate: "2026-04-08",
      staleDays: null,
    });
    pickSubjectLoginsMock.mockReturnValue([]);
    readCallIngestStateMock.mockReturnValue({
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
    });
    vi.useRealTimers();
  });

  it("returns a healthy report when there are no trouble jobs", async () => {
    const report = await runWatchdog();
    expect(report.healthy).toBe(true);
    expect(report.checked).toBe(0);
    expect(report.actions).toHaveLength(0);
  });

  it("skips stale failures older than 48 hours", async () => {
    const staleTime = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "stale-session",
        status: "failed",
        attempts: 2,
        error_message: "Some old error",
        updated_at: staleTime,
        recording_sid: null,
      },
    ]);

    const report = await runWatchdog();
    expect(report.checked).toBe(1);
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("stale_failure");
    expect(report.actions[0].result).toBe("skipped");
    expect(mockedMarkSkipped).toHaveBeenCalledWith("stale-session", expect.stringContaining("stale"));
  });

  it("gives up after max retries", async () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "maxed-out",
        status: "failed",
        attempts: 5,
        error_message: "Keeps failing",
        updated_at: recentTime,
        recording_sid: null,
      },
    ]);

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("max_retries");
    expect(report.actions[0].result).toBe("failed");
    expect(mockedMarkFailed).toHaveBeenCalledWith("maxed-out", expect.stringContaining("exceeded"));
  });

  it("clears auth and requeues on 401 failures", async () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "auth-fail",
        status: "failed",
        attempts: 1,
        error_message: "Acumatica service login failed (401): Unauthorized",
        updated_at: recentTime,
        recording_sid: null,
      },
    ]);

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("auth_failure");
    expect(report.actions[0].result).toBe("requeued");
    expect(mockedClearSession).toHaveBeenCalled();
    expect(mockedRequeueJob).toHaveBeenCalledWith("auth-fail", expect.stringContaining("auth"));
  });

  it("requeues transient Acumatica errors (500/429)", async () => {
    const recentTime = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "transient-500",
        status: "failed",
        attempts: 1,
        error_message: "Acumatica returned 500: Internal Server Error",
        updated_at: recentTime,
        recording_sid: "RE123",
      },
    ]);

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("transient_acumatica_error");
    expect(report.actions[0].result).toBe("requeued");
  });

  it("requeues OpenAI failures for model fallback", async () => {
    const recentTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "openai-fail",
        status: "failed",
        attempts: 1,
        error_message: "OpenAI transcription failed (500): server error",
        updated_at: recentTime,
        recording_sid: "RE456",
      },
    ]);

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("openai_failure");
    expect(report.actions[0].result).toBe("requeued");
  });

  it("skips stuck recording jobs where destination leg never connected", async () => {
    const stuckTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "stuck-rec",
        status: "queued",
        attempts: 2,
        error_message: "Waiting for the call recording to be available.",
        updated_at: stuckTime,
        recording_sid: null,
      },
    ]);

    // Session exists but was not answered
    mockedReadSession.mockReturnValue({
      sessionId: "stuck-rec",
      answered: false,
      endedAt: stuckTime,
    } as never);

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("stuck_recording_unanswered");
    expect(report.actions[0].result).toBe("skipped");
  });

  it("retries stuck recording jobs that were actually answered", async () => {
    const stuckTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "stuck-answered",
        status: "queued",
        attempts: 1,
        error_message: "Waiting for the call recording to be available.",
        updated_at: stuckTime,
        recording_sid: null,
      },
    ]);

    mockedReadSession.mockReturnValue({
      sessionId: "stuck-answered",
      answered: true,
      endedAt: stuckTime,
    } as never);

    mockedProcessJob.mockResolvedValueOnce({
      sessionId: "stuck-answered",
      status: "synced",
      activityId: "act-123",
    } as never);

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("stuck_recording");
    expect(report.actions[0].result).toBe("fixed");
  });

  it("pushes transcribed-but-not-synced jobs through to Acumatica", async () => {
    const recentTime = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "transcribed-stuck",
        status: "transcribed",
        attempts: 1,
        error_message: null,
        updated_at: recentTime,
        recording_sid: "RE789",
      },
    ]);

    mockedProcessJob.mockResolvedValueOnce({
      sessionId: "transcribed-stuck",
      status: "synced",
      activityId: "act-456",
    } as never);

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("transcribed_not_synced");
    expect(report.actions[0].result).toBe("fixed");
  });

  it("handles watchdog internal errors gracefully", async () => {
    const recentTime = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    mockDbAll.mockReturnValue([
      {
        session_id: "blow-up",
        status: "failed",
        attempts: 1,
        error_message: "401 Unauthorized",
        updated_at: recentTime,
        recording_sid: null,
      },
    ]);

    mockedClearSession.mockImplementationOnce(() => {
      throw new Error("Something went wrong in the watchdog itself");
    });

    const report = await runWatchdog();
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].issue).toBe("watchdog_error");
    expect(report.actions[0].result).toBe("failed");
    expect(report.actions[0].detail).toContain("Watchdog itself errored");
  });

  it("alerts when daily coaching is blocked by stale call import coverage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:30:00.000Z"));
    getEnvMock.mockReturnValue({
      DAILY_CALL_COACHING_ENABLED: true,
      DAILY_CALL_COACHING_LOOKBACK_DAYS: 1,
      DAILY_CALL_COACHING_SCHEDULE_HOUR: 7,
      DAILY_CALL_COACHING_SCHEDULE_MINUTE: 0,
      DAILY_CALL_COACHING_TIME_ZONE: "America/Toronto",
    });
    buildDailyCallCoachingCoverageMock.mockReturnValue({
      complete: false,
      status: "call_import_stale",
      detail: "Call import is only confirmed through 2026-04-07.",
      snapshotLastRecentSyncAt: "2026-04-07T22:05:00.000Z",
      snapshotLatestSeenStartTime: "2026-04-07T18:14:25.000Z",
      snapshotLastError: null,
      remainingCallSyncCount: 0,
      confirmedThroughDate: "2026-04-07",
      staleDays: 1,
    });

    const report = await runWatchdog();

    expect(report.checked).toBe(1);
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]).toEqual(
      expect.objectContaining({
        sessionId: "daily-call-coaching:2026-04-08",
        issue: "call_import_stale",
        action: "alert",
        result: "failed",
      }),
    );
    expect(report.actions[0].detail).toContain("Confirmed through: 2026-04-07.");
  });

  it("alerts when the live coaching run is missing after the schedule window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T13:30:00.000Z"));
    getEnvMock.mockReturnValue({
      DAILY_CALL_COACHING_ENABLED: true,
      DAILY_CALL_COACHING_LOOKBACK_DAYS: 1,
      DAILY_CALL_COACHING_SCHEDULE_HOUR: 7,
      DAILY_CALL_COACHING_SCHEDULE_MINUTE: 0,
      DAILY_CALL_COACHING_TIME_ZONE: "America/Toronto",
    });
    pickSubjectLoginsMock.mockReturnValue(["kpareek", "stita"]);
    mockDbGet.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*) AS total_rows")) {
        return {
          total_rows: 0,
          sent_rows: 0,
        };
      }

      return undefined;
    });

    const report = await runWatchdog();

    expect(report.checked).toBe(1);
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]).toEqual(
      expect.objectContaining({
        sessionId: "daily-call-coaching:2026-04-08",
        issue: "missing_live_send",
        action: "alert",
        result: "failed",
      }),
    );
    expect(report.actions[0].detail).toContain("Expected 2 live coaching email(s)");
  });
});
