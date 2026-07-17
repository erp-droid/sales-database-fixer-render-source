import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readCallEmployeeDirectory = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory,
}));

describe("mailbox dashboard audit reconciliation", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    readCallEmployeeDirectory.mockReset();
    tempDir = mkdtempSync(path.join(tmpdir(), "mail-audit-reconciliation-"));
    process.env.AUTH_PROVIDER = "acumatica";
    process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
    process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
    process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
    process.env.MAIL_PROXY_SHARED_SECRET = "mail-reconciliation-test-secret";
    process.env.PORT = "10000";
    process.env.MBQ_BASE_PATH = "/quotes";

    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "kpareek",
        contactId: 1,
        displayName: "Krishna Pareek",
        email: "kpareek@meadowb.com",
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-07-17T16:00:00.000Z",
      },
    ]);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              messageId: "gmail-message-krishna",
              internetMessageId: "<f47ac10b-58cc-4372-a567-0e02b2c3d479@meadowb.com>",
              threadId: "gmail-thread-krishna",
              subject: "Dashboard count test",
              sentAt: "2026-07-17T16:20:00.000Z",
              to: [],
              cc: [],
              bcc: [],
              linkedContact: null,
              matchedContacts: [],
              activitySyncStatus: "failed",
            },
          ],
          total: 1,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses the authoritative mailbox to restore or correct a missing sent-email count", async () => {
    const { logMailSendAudit } = await import("@/lib/audit-log-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { reconcileDeliveredMailboxAudits } = await import(
      "@/lib/mail-audit-reconciliation"
    );

    // Reproduce the ambiguous state from the screenshot: the Gmail message is
    // present, but its existing dashboard row is attributed to Justin.
    logMailSendAudit({
      actor: { loginName: "jsettle", name: "Justin" },
      payload: {
        subject: "Dashboard count test",
        to: [],
        cc: [],
        bcc: [],
        attachments: [],
        sourceSurface: "mail",
      },
      resultCode: "partial",
      response: {
        sent: true,
        threadId: "gmail-thread-krishna",
        messageId: "gmail-message-krishna",
        draftId: null,
        activitySyncStatus: "failed",
      },
      auditEventId: "existing-ambiguous-email",
      occurredAt: "2026-07-17T16:20:00.000Z",
    });

    await expect(reconcileDeliveredMailboxAudits()).resolves.toEqual({
      mailboxesChecked: 1,
      mailboxesFailed: 0,
      messagesChecked: 1,
      recovered: 0,
      reattributed: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:10000/quotes/api/mail/sent-app-messages?limit=500",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer mbmail\.v1\./),
        }),
      }),
    );
    const requestHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const assertionPayload = JSON.parse(
      Buffer.from(requestHeaders.Authorization.split(".")[2] ?? "", "base64url").toString("utf8"),
    ) as { loginName?: string; senderEmail?: string };
    expect(assertionPayload).toMatchObject({
      loginName: "kpareek",
      senderEmail: "kpareek@meadowb.com",
    });

    const audit = getReadModelDb()
      .prepare(
        `
        SELECT actor_login_name, actor_name, result_code, email_message_id
        FROM audit_events
        WHERE id = 'existing-ambiguous-email'
        `,
      )
      .get();
    expect(audit).toEqual({
      actor_login_name: "kpareek",
      actor_name: "Krishna Pareek",
      result_code: "partial",
      email_message_id: "gmail-message-krishna",
    });
  });
});
