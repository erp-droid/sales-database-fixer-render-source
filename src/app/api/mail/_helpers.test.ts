import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

const requestMailService = vi.fn();
const attachMatchedContactsToMailPayload = vi.fn();
const collectUnresolvedMailRecipientEmails = vi.fn();
const repairMailActivitySync = vi.fn();
const resolveDeferredActionActor = vi.fn();
const logMailSendAudit = vi.fn();
const resolveMailSenderForRequest = vi.fn();
const drainPendingMailSendJobs = vi.fn();
const enqueueMailSendJob = vi.fn();
const getStoredLoginName = vi.fn(() => "jserrano");
const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (callback: () => void) => {
      callback();
    },
  };
});

vi.mock("@/lib/mail-proxy", () => ({
  requestMailService,
  buildMailServiceOauthStartUrl: vi.fn(),
}));

vi.mock("@/lib/mail-recipient-matches", () => ({
  attachMatchedContactsToMailPayload,
}));

vi.mock("@/lib/mail-validation", () => ({
  collectUnresolvedMailRecipientEmails,
}));

vi.mock("@/lib/mail-activity-sync", () => ({
  repairMailActivitySync,
}));

vi.mock("@/lib/deferred-action-actor", () => ({
  resolveDeferredActionActor,
}));

vi.mock("@/lib/audit-log-store", () => ({
  logMailSendAudit,
}));

vi.mock("@/lib/mail-auth", () => ({
  resolveMailSenderForRequest,
}));

vi.mock("@/lib/mail-send-jobs", () => ({
  drainPendingMailSendJobs,
  enqueueMailSendJob,
}));

vi.mock("@/lib/auth", () => ({
  getStoredLoginName,
  requireAuthCookieValue,
  setAuthCookie,
}));

describe("proxyAuditedMailSendJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attachMatchedContactsToMailPayload.mockImplementation(
      async (_request: NextRequest, body: unknown) => body,
    );
    collectUnresolvedMailRecipientEmails.mockReturnValue([]);
    requestMailService.mockResolvedValue(
      new Response(
        JSON.stringify({
          sent: true,
          threadId: "thread-1",
          messageId: "message-1",
          draftId: null,
          activitySyncStatus: "failed",
          activityError: "sync failed",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    enqueueMailSendJob.mockImplementation(() => ({ id: "job-1" }));
    drainPendingMailSendJobs.mockResolvedValue(undefined);
  });

  it("passes the default send timeout to the mail service", async () => {
    const { proxyAuditedMailSendJson } = await import("@/app/api/mail/_helpers");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      method: "POST",
      body: JSON.stringify({ subject: "test" }),
      headers: {
        "content-type": "application/json",
      },
    });

    const response = await proxyAuditedMailSendJson(request, {
      path: "/api/mail/messages/send",
      method: "POST",
      body: {
        subject: "test",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: null,
        attachments: [],
        sourceSurface: "accounts",
      },
      forwardAcumaticaSession: true,
    });

    expect(response.status).toBe(200);
    expect(requestMailService).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        timeoutMs: 20_000,
      }),
    );
  });

  it("does not wait for mail queue draining to finish", async () => {
    drainPendingMailSendJobs.mockReturnValue(new Promise(() => {}));

    const { proxyAuditedMailSendJson } = await import("@/app/api/mail/_helpers");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      method: "POST",
      body: JSON.stringify({ subject: "test" }),
      headers: {
        "content-type": "application/json",
      },
    });

    const response = await proxyAuditedMailSendJson(request, {
      path: "/api/mail/messages/send",
      method: "POST",
      body: {
        subject: "test",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: null,
        attachments: [],
        sourceSurface: "accounts",
      },
      forwardAcumaticaSession: true,
    });

    expect(response.status).toBe(200);
    expect(enqueueMailSendJob).toHaveBeenCalled();
    expect(drainPendingMailSendJobs).toHaveBeenCalledWith(25);
  });
});
