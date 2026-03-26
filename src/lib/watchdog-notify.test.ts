import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    MAIL_SERVICE_URL: "https://mail.example.com",
    MAIL_SERVICE_SHARED_SECRET: "test-secret",
    MAIL_INTERNAL_DOMAIN: "meadowb.com",
  }),
}));

vi.mock("@/lib/mail-auth", () => ({
  ensureMailServiceConfigured: () => ({
    serviceUrl: "https://mail.example.com",
    sharedSecret: "test-secret",
  }),
  buildMailServiceAssertion: vi.fn().mockReturnValue("mock-assertion-token"),
}));

vi.mock("@/lib/errors", () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "Unknown error"),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
vi.stubGlobal("fetch", mockFetch);

import { sendWatchdogNotification } from "./watchdog-notify";
import type { WatchdogReport } from "./watchdog";

describe("watchdog-notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
  });

  it("does not send email when there are no meaningful actions", async () => {
    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 50,
      checked: 3,
      actions: [
        { sessionId: "s1", issue: "stale_failure", action: "skip", result: "skipped", detail: "Old." },
      ],
      healthy: true,
    };

    await sendWatchdogNotification(report);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends email when there are fixed actions", async () => {
    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 120,
      checked: 2,
      actions: [
        { sessionId: "s1", issue: "stuck_recording", action: "retry_process", result: "fixed", detail: "Recording found." },
      ],
      healthy: true,
    };

    await sendWatchdogNotification(report);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://mail.example.com/api/mail/messages/send");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.to).toBe("jserrano@meadowb.com");
    expect(body.subject).toContain("1 fixed");
    expect(body.htmlBody).toContain("s1");
  });

  it("sends email when there are requeued actions", async () => {
    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 80,
      checked: 1,
      actions: [
        { sessionId: "s2", issue: "auth_failure", action: "clear_auth_retry", result: "requeued", detail: "Cleared auth." },
      ],
      healthy: true,
    };

    await sendWatchdogNotification(report);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.subject).toContain("1 requeued");
  });

  it("sends email when there are failed actions", async () => {
    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 200,
      checked: 1,
      actions: [
        { sessionId: "s3", issue: "max_retries", action: "fail_permanently", result: "failed", detail: "Gave up." },
      ],
      healthy: false,
    };

    await sendWatchdogNotification(report);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.subject).toContain("⚠️");
    expect(body.subject).toContain("1 failed");
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
        { sessionId: "s4", issue: "generic_failure", action: "requeue", result: "requeued", detail: "Retried." },
      ],
      healthy: true,
    };

    // Should not throw
    await expect(sendWatchdogNotification(report)).resolves.toBeUndefined();
  });

  it("does not throw if fetch itself fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 100,
      checked: 1,
      actions: [
        { sessionId: "s5", issue: "openai_failure", action: "requeue", result: "requeued", detail: "Retried." },
      ],
      healthy: true,
    };

    await expect(sendWatchdogNotification(report)).resolves.toBeUndefined();
  });

  it("includes authorization header with assertion token", async () => {
    const report: WatchdogReport = {
      ranAt: new Date().toISOString(),
      durationMs: 50,
      checked: 1,
      actions: [
        { sessionId: "s6", issue: "transient_acumatica_error", action: "requeue", result: "requeued", detail: "500 error." },
      ],
      healthy: true,
    };

    await sendWatchdogNotification(report);
    const options = mockFetch.mock.calls[0][1];
    expect(options.headers.Authorization).toBe("Bearer mock-assertion-token");
  });
});
