import { describe, it, expect, vi, beforeEach } from "vitest";

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
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  clearCachedServiceAcumaticaSession: vi.fn(),
}));

const mockDbAll = vi.fn().mockReturnValue([]);
vi.mock("@/lib/read-model/db", () => ({
  getReadModelDb: () => ({
    prepare: () => ({
      all: (...args: unknown[]) => mockDbAll(...args),
      get: vi.fn().mockReturnValue(undefined),
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
});
