import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory: vi.fn().mockReturnValue([
    {
      loginName: "jserrano",
      contactId: 157499,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      normalizedPhone: "+14162304681",
      callerIdPhone: "+14162304681",
      isActive: true,
      updatedAt: "2026-03-26T18:00:00.000Z",
    },
  ]),
}));

vi.mock("@/lib/mail-auth", () => ({
  ensureMailServiceConfigured: () => ({
    serviceUrl: "https://mail.example.com",
    sharedSecret: "test-secret",
  }),
  buildMailServiceAssertion: vi.fn().mockReturnValue("mock-assertion-token"),
}));

vi.mock("@/lib/errors", () => ({
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
vi.stubGlobal("fetch", mockFetch);

import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { sendWatchdogNotification } from "./watchdog-notify";
import type { WatchdogReport } from "./watchdog";

const mockedReadCallEmployeeDirectory = vi.mocked(readCallEmployeeDirectory);

describe("watchdog-notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 157499,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        normalizedPhone: "+14162304681",
        callerIdPhone: "+14162304681",
        isActive: true,
        updatedAt: "2026-03-26T18:00:00.000Z",
      },
    ]);
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
  });

  it("does not send email when there are no meaningful actions", async () => {
    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 50,
      checked: 3,
      actions: [
        {
          sessionId: "s1",
          issue: "stale_failure",
          action: "skip",
          result: "skipped",
          detail: "Old.",
        },
      ],
      healthy: true,
    };

    await sendWatchdogNotification(report);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not send email when the mailbox cannot be resolved", async () => {
    mockedReadCallEmployeeDirectory.mockReturnValue([]);

    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 80,
      checked: 1,
      actions: [
        {
          sessionId: "s1",
          issue: "stuck_recording",
          action: "retry_process",
          result: "fixed",
          detail: "Recording found.",
        },
      ],
      healthy: true,
    };

    await sendWatchdogNotification(report);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends a valid compose payload to the mail service", async () => {
    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 120,
      checked: 2,
      actions: [
        {
          sessionId: "s1",
          issue: "stuck_recording",
          action: "retry_process",
          result: "fixed",
          detail: "Recording found.",
        },
      ],
      healthy: true,
    };

    await sendWatchdogNotification(report);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://mail.example.com/api/mail/messages/send");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer mock-assertion-token");

    const body = JSON.parse(String(options.body));
    expect(body.subject).toContain("[watchdog]");
    expect(body.subject).toContain("1 fixed");
    expect(body.htmlBody).toContain("s1");
    expect(body.textBody).toContain("s1");
    expect(body.to).toEqual([
      {
        email: "jserrano@meadowb.com",
        name: "Jorge Serrano",
        contactId: 157499,
        businessAccountRecordId: null,
        businessAccountId: null,
      },
    ]);
    expect(body.linkedContact).toEqual({
      contactId: 157499,
      businessAccountRecordId: null,
      businessAccountId: null,
      contactName: "Jorge Serrano",
      companyName: null,
    });
    expect(body.matchedContacts).toEqual([
      {
        contactId: 157499,
        businessAccountRecordId: null,
        businessAccountId: null,
        contactName: "Jorge Serrano",
        companyName: null,
        email: "jserrano@meadowb.com",
      },
    ]);
  });

  it("does not throw if the mail service returns an error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 100,
      checked: 1,
      actions: [
        {
          sessionId: "s4",
          issue: "generic_failure",
          action: "requeue",
          result: "requeued",
          detail: "Retried.",
        },
      ],
      healthy: true,
    };

    await expect(sendWatchdogNotification(report)).resolves.toBeUndefined();
  });

  it("does not throw if fetch itself fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 100,
      checked: 1,
      actions: [
        {
          sessionId: "s5",
          issue: "openai_failure",
          action: "requeue",
          result: "requeued",
          detail: "Retried.",
        },
      ],
      healthy: true,
    };

    await expect(sendWatchdogNotification(report)).resolves.toBeUndefined();
  });
});
