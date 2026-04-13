import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const withServiceAcumaticaSession = vi.fn();
const refreshCallAnalytics = vi.fn();
const readCallIngestState = vi.fn();
const runDueCallActivitySyncJobs = vi.fn();
const readScheduledJobRun = vi.fn();
const writeScheduledJobRun = vi.fn();

vi.mock("@/lib/acumatica-service-auth", () => ({
  withServiceAcumaticaSession,
}));

vi.mock("@/lib/call-analytics/ingest", () => ({
  refreshCallAnalytics,
  readCallIngestState,
}));

vi.mock("@/lib/call-analytics/postcall-worker", () => ({
  runDueCallActivitySyncJobs,
}));

vi.mock("@/lib/scheduled-jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scheduled-jobs")>(
    "@/lib/scheduled-jobs",
  );

  return {
    ...actual,
    readScheduledJobRun,
    writeScheduledJobRun,
  };
});

function buildRequest(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/scheduled/call-activity-sync/run${query}`,
    {
      method: "POST",
      headers: {
        "x-call-activity-sync-secret": process.env.CALL_ACTIVITY_SYNC_SECRET ?? "",
      },
    },
  );
}

describe("POST /api/scheduled/call-activity-sync/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T21:10:00.000Z"));

    process.env.CALL_ACTIVITY_SYNC_TIME_ZONE = "America/Toronto";
    process.env.CALL_ACTIVITY_SYNC_SCHEDULE_HOUR = "17";
    process.env.CALL_ACTIVITY_SYNC_SCHEDULE_MINUTE = "0";
    process.env.CALL_ACTIVITY_SYNC_BATCH_SIZE = "5";
    process.env.CALL_ACTIVITY_SYNC_MAX_BATCHES_PER_WINDOW = "10";
    process.env.CALL_ACTIVITY_SYNC_SECRET = "test-call-activity-sync-secret";

    withServiceAcumaticaSession.mockImplementation(
      async (_session: unknown, callback: (cookie: string, authCookieRefresh?: unknown) => Promise<unknown>) =>
        callback("cookie", undefined),
    );
    refreshCallAnalytics.mockResolvedValue({
      status: "completed",
    });
    runDueCallActivitySyncJobs.mockResolvedValue({
      processedCount: 2,
      syncedCount: 2,
      failedCount: 0,
      skippedCount: 0,
      remainingCount: 0,
      completed: true,
    });
    readCallIngestState.mockReturnValue({
      lastRecentSyncAt: "2026-04-13T21:05:00.000Z",
      latestSeenStartTime: "2026-04-13T20:45:00.000Z",
      lastError: null,
    });
    readScheduledJobRun.mockReturnValue(null);
    writeScheduledJobRun.mockImplementation((input: Record<string, unknown>) => ({
      jobName: input.jobName,
      windowKey: input.windowKey,
      status: input.status,
      detail: input.detail ?? null,
      startedAt: input.status === "running" ? "2026-04-13T21:10:00.000Z" : null,
      completedAt: input.status === "completed" ? "2026-04-13T21:11:00.000Z" : null,
      updatedAt: "2026-04-13T21:11:00.000Z",
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes the current local-day sync window once coverage is confirmed", async () => {
    const { POST } = await import("@/app/api/scheduled/call-activity-sync/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      targetDateKey: string;
      scheduledRun?: { status: string };
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("completed");
    expect(payload.targetDateKey).toBe("2026-04-13");
    expect(withServiceAcumaticaSession).toHaveBeenCalledTimes(1);
    expect(refreshCallAnalytics).toHaveBeenCalledWith(
      "cookie",
      undefined,
      { runPostcallSync: false },
    );
    expect(runDueCallActivitySyncJobs).toHaveBeenCalledWith(5, {
      localDateKey: "2026-04-13",
      timeZone: "America/Toronto",
    });
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        jobName: "call_activity_sync",
        windowKey: "2026-04-13",
        status: "running",
      }),
    );
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobName: "call_activity_sync",
        windowKey: "2026-04-13",
        status: "completed",
      }),
    );
  });

  it("skips a window that is already marked completed", async () => {
    readScheduledJobRun.mockReturnValue({
      jobName: "call_activity_sync",
      windowKey: "2026-04-13",
      status: "completed",
      detail: "already complete",
      startedAt: "2026-04-13T21:00:00.000Z",
      completedAt: "2026-04-13T21:05:00.000Z",
      updatedAt: "2026-04-13T21:05:00.000Z",
    });

    const { POST } = await import("@/app/api/scheduled/call-activity-sync/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      detail: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("skipped");
    expect(payload.detail).toContain("already completed");
    expect(withServiceAcumaticaSession).not.toHaveBeenCalled();
    expect(runDueCallActivitySyncJobs).not.toHaveBeenCalled();
    expect(writeScheduledJobRun).not.toHaveBeenCalled();
  });
});
