import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("delivered mail dashboard audit", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "mail-dashboard-audit-"));
    process.env.AUTH_PROVIDER = "acumatica";
    process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
    process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
    process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("counts a Gmail delivery for its actual sender even when CRM activity sync failed", async () => {
    const { enqueueMailSendJob, recoverDeliveredMailSendAudits } = await import(
      "@/lib/mail-send-jobs"
    );
    const { getReadModelDb } = await import("@/lib/read-model/db");

    const job = enqueueMailSendJob({
      actor: {
        loginName: "kpareek",
        name: "Krishna Pareek",
      },
      payload: {
        subject: "Dashboard count check",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: null,
        attachments: [],
        sourceSurface: "mail",
      },
      response: {
        sent: true,
        threadId: "krishna-thread",
        messageId: "krishna-message",
        draftId: null,
        activitySyncStatus: "failed",
        activityError: "CRM activity endpoint unavailable",
      },
    });

    const db = getReadModelDb();
    const readAudit = () =>
      db
        .prepare(
          `
          SELECT occurred_at, actor_login_name, actor_name, result_code,
                 email_message_id, activity_sync_status
          FROM audit_events
          WHERE id = ?
          `,
        )
        .get(`email-send-job:${job.id}`) as
        | {
            occurred_at: string;
            actor_login_name: string;
            actor_name: string;
            result_code: string;
            email_message_id: string;
            activity_sync_status: string;
          }
        | undefined;

    expect(readAudit()).toEqual({
      occurred_at: job.createdAt,
      actor_login_name: "kpareek",
      actor_name: "Krishna Pareek",
      result_code: "partial",
      email_message_id: "krishna-message",
      activity_sync_status: "failed",
    });

    // Simulate a successful email from before this fix whose audit write was
    // lost. Startup recovery restores it without resending the email.
    db.prepare("DELETE FROM audit_events WHERE id = ?").run(`email-send-job:${job.id}`);
    expect(recoverDeliveredMailSendAudits()).toBe(1);
    expect(readAudit()).toEqual(
      expect.objectContaining({
        occurred_at: job.createdAt,
        actor_login_name: "kpareek",
        result_code: "partial",
        email_message_id: "krishna-message",
      }),
    );
  });
});
