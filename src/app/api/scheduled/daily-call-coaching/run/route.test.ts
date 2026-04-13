import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pickSubjectLogins = vi.fn();
const runDailyCallCoaching = vi.fn();
const readScheduledJobRun = vi.fn();
const writeScheduledJobRun = vi.fn();

vi.mock("@/lib/daily-call-coaching", () => ({
  pickSubjectLogins,
  runDailyCallCoaching,
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
    `http://localhost/api/scheduled/daily-call-coaching/run${query}`,
    {
      method: "POST",
      headers: {
        "x-daily-call-coaching-secret": process.env.DAILY_CALL_COACHING_SECRET ?? "",
      },
    },
  );
}

describe("POST /api/scheduled/daily-call-coaching/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();

    process.env.DAILY_CALL_COACHING_TIME_ZONE = "America/Toronto";
    process.env.DAILY_CALL_COACHING_SCHEDULE_HOUR = "7";
    process.env.DAILY_CALL_COACHING_SCHEDULE_MINUTE = "0";
    process.env.DAILY_CALL_COACHING_LOOKBACK_DAYS = "1";
    process.env.DAILY_CALL_COACHING_SECRET = "test-daily-call-coaching-secret";

    pickSubjectLogins.mockReturnValue(["jserrano"]);
    runDailyCallCoaching.mockResolvedValue({
      dataCoverage: {
        complete: true,
        status: "complete",
        detail: "Coverage complete.",
      },
      items: [
        {
          subjectLoginName: "jserrano",
          recipientEmail: "jserrano@meadowb.com",
          status: "sent",
          detail: "Sent.",
        },
      ],
    });
    readScheduledJobRun.mockReturnValue(null);
    writeScheduledJobRun.mockImplementation((input: Record<string, unknown>) => ({
      jobName: input.jobName,
      windowKey: input.windowKey,
      status: input.status,
      detail: input.detail ?? null,
      startedAt: input.status === "running" ? "2026-04-13T11:30:00.000Z" : null,
      completedAt: input.status === "completed" ? "2026-04-13T11:31:00.000Z" : null,
      updatedAt: "2026-04-13T11:31:00.000Z",
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips before the local coaching window opens", async () => {
    vi.setSystemTime(new Date("2026-04-13T10:30:00.000Z"));
    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      reportDate: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("skipped");
    expect(payload.reportDate).toBe("2026-04-12");
    expect(runDailyCallCoaching).not.toHaveBeenCalled();
    expect(writeScheduledJobRun).not.toHaveBeenCalled();
  });

  it("completes the report date once and records the scheduled run", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      reportDate: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("completed");
    expect(payload.reportDate).toBe("2026-04-12");
    expect(runDailyCallCoaching).toHaveBeenCalledWith({
      reportDate: "2026-04-12",
    });
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        jobName: "daily_call_coaching",
        windowKey: "2026-04-12",
        status: "running",
      }),
    );
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobName: "daily_call_coaching",
        windowKey: "2026-04-12",
        status: "completed",
      }),
    );
  });

  it("skips a report date that already completed", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    readScheduledJobRun.mockReturnValue({
      jobName: "daily_call_coaching",
      windowKey: "2026-04-12",
      status: "completed",
      detail: "already complete",
      startedAt: "2026-04-13T11:00:00.000Z",
      completedAt: "2026-04-13T11:05:00.000Z",
      updatedAt: "2026-04-13T11:05:00.000Z",
    });

    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("skipped");
    expect(runDailyCallCoaching).not.toHaveBeenCalled();
    expect(writeScheduledJobRun).not.toHaveBeenCalled();
  });

  it("fails when the delivery set does not match the canonical rep count", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    pickSubjectLogins.mockReturnValue(["jserrano", "jsettle"]);

    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      detail: string;
    };

    expect(response.status).toBe(500);
    expect(payload.status).toBe("failed");
    expect(payload.detail).toContain("invalid delivery set");
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobName: "daily_call_coaching",
        windowKey: "2026-04-12",
        status: "failed",
      }),
    );
  });
});
