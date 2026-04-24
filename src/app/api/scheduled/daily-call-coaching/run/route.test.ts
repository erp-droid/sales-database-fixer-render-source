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
          requiredCcEmail: "jserrano@meadowb.com",
          ccConfirmed: true,
          ccConfirmationDetail: "primary_recipient",
          ccRecipients: [],
        },
      ],
    });
    readScheduledJobRun.mockImplementation((jobName: string, windowKey: string) => {
      if (jobName === "call_activity_sync") {
        return {
          jobName: "call_activity_sync",
          windowKey,
          status: "completed",
          detail: "call activity sync completed",
          startedAt: "2026-04-13T10:40:00.000Z",
          completedAt: "2026-04-13T10:55:00.000Z",
          updatedAt: "2026-04-13T10:55:00.000Z",
        };
      }
      return null;
    });
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
      retryFailedOnly: true,
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

  it("treats the exact 7:00 AM local boundary as due", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:00:00.000Z"));
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
      retryFailedOnly: true,
    });
  });

  it("skips a report date that already completed", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    readScheduledJobRun.mockImplementation((jobName: string, windowKey: string) => {
      if (jobName === "daily_call_coaching") {
        return {
          jobName: "daily_call_coaching",
          windowKey: "2026-04-12",
          status: "completed",
          detail: "already complete",
          startedAt: "2026-04-13T11:00:00.000Z",
          completedAt: "2026-04-13T11:05:00.000Z",
          updatedAt: "2026-04-13T11:05:00.000Z",
        };
      }
      if (jobName === "call_activity_sync") {
        return {
          jobName: "call_activity_sync",
          windowKey,
          status: "completed",
          detail: "call activity sync completed",
          startedAt: "2026-04-13T10:40:00.000Z",
          completedAt: "2026-04-13T10:55:00.000Z",
          updatedAt: "2026-04-13T10:55:00.000Z",
        };
      }
      return null;
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

  it("continues with warnings when prior-day 5:00 PM call-activity finalization is missing", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    readScheduledJobRun.mockImplementation((jobName: string) => {
      if (jobName === "call_activity_sync") {
        return null;
      }
      return null;
    });
    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      detail: string;
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("completed_with_warnings");
    expect(payload.warnings.length).toBeGreaterThan(0);
    expect(payload.warnings[0]).toContain("Call-activity finalization status is missing");
    expect(runDailyCallCoaching).toHaveBeenCalledWith({
      reportDate: "2026-04-12",
      retryFailedOnly: true,
    });
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobName: "daily_call_coaching",
        windowKey: "2026-04-12",
        status: "completed",
      }),
    );
  });

  it("returns idempotency evidence including deduped counts", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    pickSubjectLogins.mockReturnValue(["jserrano", "jsettle"]);
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
          requiredCcEmail: "jserrano@meadowb.com",
          ccConfirmed: true,
          ccConfirmationDetail: "primary_recipient",
          ccRecipients: [],
        },
        {
          subjectLoginName: "jsettle",
          recipientEmail: "jsettle@meadowb.com",
          status: "skipped",
          detail: "Already sent for this date and recipient.",
          requiredCcEmail: "jserrano@meadowb.com",
          ccConfirmed: false,
          ccConfirmationDetail: "not_sent",
          ccRecipients: [],
        },
      ],
    });

    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");
    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      evidence: {
        deliveredCount: number;
        dedupedCount: number;
        failedCount: number;
        ccConfirmedCount: number;
        ccMissingCount: number;
        items: Array<{
          recipientEmail: string;
          idempotencyKey: string;
          deduped: boolean;
          ccConfirmed: boolean;
          ccConfirmationDetail: "cc_header" | "primary_recipient" | "not_sent";
          requiredCcEmail: string;
          ccRecipients: string[];
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("completed");
    expect(payload.evidence.deliveredCount).toBe(1);
    expect(payload.evidence.dedupedCount).toBe(1);
    expect(payload.evidence.failedCount).toBe(0);
    expect(payload.evidence.ccConfirmedCount).toBe(1);
    expect(payload.evidence.ccMissingCount).toBe(0);
    expect(payload.evidence.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientEmail: "jserrano@meadowb.com",
          idempotencyKey: "daily-coach:2026-04-12:jserrano@meadowb.com",
          deduped: false,
          ccConfirmed: true,
          ccConfirmationDetail: "primary_recipient",
          requiredCcEmail: "jserrano@meadowb.com",
          ccRecipients: [],
        }),
        expect.objectContaining({
          recipientEmail: "jsettle@meadowb.com",
          idempotencyKey: "daily-coach:2026-04-12:jsettle@meadowb.com",
          deduped: true,
          ccConfirmed: false,
          ccConfirmationDetail: "not_sent",
          requiredCcEmail: "jserrano@meadowb.com",
          ccRecipients: [],
        }),
      ]),
    );
  });

  it("fails when a delivered message is missing the required CC confirmation", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    runDailyCallCoaching.mockResolvedValue({
      dataCoverage: {
        complete: true,
        status: "complete",
        detail: "Coverage complete.",
      },
      items: [
        {
          subjectLoginName: "kpareek",
          recipientEmail: "kpareek@meadowb.com",
          status: "sent",
          detail: "Sent.",
          requiredCcEmail: "jserrano@meadowb.com",
          ccConfirmed: false,
          ccConfirmationDetail: "not_sent",
          ccRecipients: [],
        },
      ],
    });

    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      detail: string;
      evidence: {
        ccMissingCount: number;
      };
    };

    expect(response.status).toBe(500);
    expect(payload.status).toBe("failed");
    expect(payload.detail).toContain("Required CC missing");
    expect(payload.evidence.ccMissingCount).toBe(1);
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobName: "daily_call_coaching",
        windowKey: "2026-04-12",
        status: "failed",
      }),
    );
  });

  it("completes with warnings when call import coverage is still postcall_pending", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
    runDailyCallCoaching.mockResolvedValue({
      dataCoverage: {
        complete: false,
        status: "postcall_pending",
        detail:
          "Call import is complete for 2026-04-12. 12 transcript/activity job(s) are still pending.",
      },
      items: [
        {
          subjectLoginName: "jserrano",
          recipientEmail: "jserrano@meadowb.com",
          status: "sent",
          detail: "Sent.",
          requiredCcEmail: "jserrano@meadowb.com",
          ccConfirmed: true,
          ccConfirmationDetail: "primary_recipient",
          ccRecipients: [],
        },
      ],
    });

    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");
    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      warnings: string[];
      detail: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("completed_with_warnings");
    expect(payload.warnings.length).toBeGreaterThan(0);
    expect(payload.warnings[0]).toContain("Coverage is postcall_pending");
    expect(payload.detail).toContain("Warnings:");
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobName: "daily_call_coaching",
        windowKey: "2026-04-12",
        status: "completed",
      }),
    );
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

  it("completes with warnings when a recipient remains suppressed after a previous ambiguous send attempt", async () => {
    vi.setSystemTime(new Date("2026-04-13T11:30:00.000Z"));
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
          status: "skipped",
          detail: "Previous send attempt is still pending verification. Automatic retry is suppressed to avoid duplicate coach emails.",
          requiredCcEmail: "jserrano@meadowb.com",
          ccConfirmed: false,
          ccConfirmationDetail: "not_sent",
          ccRecipients: [],
        },
      ],
    });

    const { POST } = await import("@/app/api/scheduled/daily-call-coaching/run/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as {
      status: string;
      detail: string;
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("completed_with_warnings");
    expect(payload.warnings.length).toBeGreaterThan(0);
    expect(payload.warnings[0]).toContain("Suppressed retries");
    expect(payload.detail).toContain("Suppressed retries");
    expect(writeScheduledJobRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobName: "daily_call_coaching",
        windowKey: "2026-04-12",
        status: "completed",
      }),
    );
  });
});
