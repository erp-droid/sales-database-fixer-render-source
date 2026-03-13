import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMailSendAudit = vi.fn();
const repairMailActivitySyncWithServiceSession = vi.fn();

vi.mock("@/lib/audit-log-store", () => ({
  logMailSendAudit,
}));

vi.mock("@/lib/mail-activity-sync", () => ({
  isRepairableMailActivityPayload: (value: unknown) =>
    Boolean(value && typeof value === "object" && "activitySyncStatus" in (value as object)),
  repairMailActivitySyncWithServiceSession,
}));

describe("mail send jobs", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    vi.resetModules();
    logMailSendAudit.mockReset();
    repairMailActivitySyncWithServiceSession.mockReset();
    tempDir = mkdtempSync(path.join(tmpdir(), "mail-send-jobs-"));
    process.env.AUTH_PROVIDER = "acumatica";
    process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
    process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
    process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists and drains queued mail sends", async () => {
    repairMailActivitySyncWithServiceSession.mockResolvedValue({
      sent: true,
      threadId: "thread-1",
      messageId: "message-1",
      draftId: null,
      activitySyncStatus: "synced",
      activityId: "activity-1",
      activityIds: ["activity-1"],
      activityError: null,
    });

    const {
      enqueueMailSendJob,
      drainPendingMailSendJobs,
      listPendingMailSendJobs,
      processMailSendJob,
    } = await import("@/lib/mail-send-jobs");

    const job = enqueueMailSendJob({
      actor: {
        loginName: "jserrano",
        name: "Jorge Serrano",
      },
      payload: {
        subject: "Test send",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: {
          businessAccountRecordId: "record-1",
          businessAccountId: "02670D2595",
          companyName: "Alpha Foods",
          contactId: 157497,
          contactName: "Jacky Lee",
        },
        attachments: [],
        sourceSurface: "accounts",
      },
      response: {
        sent: true,
        threadId: "thread-1",
        messageId: "message-1",
        draftId: null,
        activitySyncStatus: "failed",
        activityError: "Acumatica sync failed",
      },
    });

    expect(listPendingMailSendJobs()).toHaveLength(1);

    await drainPendingMailSendJobs(10);

    expect(repairMailActivitySyncWithServiceSession).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        subject: "Test send",
      }),
      expect.objectContaining({
        activitySyncStatus: "failed",
      }),
    );
    expect(logMailSendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          loginName: "jserrano",
          name: "Jorge Serrano",
        },
        resultCode: "succeeded",
        auditEventId: `email-send-job:${job.id}`,
        response: expect.objectContaining({
          activitySyncStatus: "synced",
          activityId: "activity-1",
        }),
      }),
    );
    expect(listPendingMailSendJobs()).toHaveLength(0);
    expect(await processMailSendJob(job.id)).toBeNull();
  });

  it("keeps failed jobs retryable", async () => {
    repairMailActivitySyncWithServiceSession.mockRejectedValue(
      new Error("Acumatica unavailable"),
    );

    const {
      enqueueMailSendJob,
      drainPendingMailSendJobs,
      listPendingMailSendJobs,
    } = await import("@/lib/mail-send-jobs");

    enqueueMailSendJob({
      actor: {
        loginName: "jserrano",
        name: "Jorge Serrano",
      },
      payload: {
        subject: "Retry send",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: {
          businessAccountRecordId: "record-1",
          businessAccountId: "02670D2595",
          companyName: "Alpha Foods",
          contactId: 157497,
          contactName: "Jacky Lee",
        },
        attachments: [],
        sourceSurface: "accounts",
      },
      response: {
        sent: true,
        threadId: "thread-2",
        messageId: "message-2",
        draftId: null,
        activitySyncStatus: "failed",
        activityError: "Acumatica sync failed",
      },
    });

    await drainPendingMailSendJobs(10);

    const [failedJob] = listPendingMailSendJobs();
    expect(failedJob).toMatchObject({
      status: "failed",
      attempts: 1,
    });
    expect(failedJob.error).toContain("Acumatica unavailable");
    expect(logMailSendAudit).not.toHaveBeenCalled();
  });
});
