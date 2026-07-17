import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMailService = vi.fn();
const readCallEmployeeDirectory = vi.fn();

vi.mock("@/lib/mail-proxy", () => ({
  requestMailService,
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory,
}));

describe("mailbox dashboard audit reconciliation", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    vi.resetModules();
    requestMailService.mockReset();
    readCallEmployeeDirectory.mockReset();
    tempDir = mkdtempSync(path.join(tmpdir(), "mail-audit-reconciliation-"));
    process.env.AUTH_PROVIDER = "acumatica";
    process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
    process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
    process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");

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
    requestMailService.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              messageId: "19f708100545160b",
              internetMessageId: "<legacy-generated@mail.gmail.com>",
              threadId: "19f708100545160b",
              subject: "Facility Maintenance & Infrastructure Support",
              sentAt: "2026-07-17T14:35:30.000Z",
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
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses the authoritative mailbox to restore a verified legacy sent-email count", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { reconcileDeliveredMailboxAudits } = await import(
      "@/lib/mail-audit-reconciliation"
    );

    await expect(reconcileDeliveredMailboxAudits()).resolves.toEqual({
      mailboxesChecked: 1,
      mailboxesFailed: 0,
      messagesChecked: 1,
      recovered: 1,
      reattributed: 0,
    });

    expect(requestMailService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        path: "/api/mail/sent-app-messages",
        query: expect.any(URLSearchParams),
        resolvedSender: {
          loginName: "kpareek",
          displayName: "Krishna Pareek",
          senderEmail: "kpareek@meadowb.com",
        },
      }),
    );
    const query = requestMailService.mock.calls[0]?.[1]?.query as URLSearchParams;
    expect(query.get("limit")).toBe("500");
    expect(query.getAll("includeMessageId")).toEqual(["19f708100545160b"]);

    const audit = getReadModelDb()
      .prepare(
        `
        SELECT actor_login_name, actor_name, result_code, email_message_id
        FROM audit_events
        WHERE email_message_id = '19f708100545160b'
        `,
      )
      .get();
    expect(audit).toEqual({
      actor_login_name: "kpareek",
      actor_name: "Krishna Pareek",
      result_code: "partial",
      email_message_id: "19f708100545160b",
    });
  });
});
