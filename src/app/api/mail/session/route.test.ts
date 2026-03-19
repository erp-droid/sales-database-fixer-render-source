import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/errors";
import type { MailSessionResponse } from "@/types/mail";

const setAuthCookie = vi.fn();
const requestMailService = vi.fn();
const resolveMailSenderForRequest = vi.fn();

vi.mock("@/lib/auth", () => ({
  setAuthCookie,
}));

vi.mock("@/lib/mail-auth", () => ({
  resolveMailSenderForRequest,
}));

vi.mock("@/lib/mail-proxy", () => ({
  buildMailServiceOauthStartUrl: vi.fn(),
  requestMailService,
}));

describe("GET /api/mail/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resolveMailSenderForRequest.mockResolvedValue({
      loginName: "jserrano",
      senderEmail: "jserrano@meadowb.com",
      displayName: "Jorge Serrano",
    });
  });

  it("returns a structured needs_setup response when MAIL_SERVICE_URL is missing", async () => {
    requestMailService.mockRejectedValue(
      new HttpError(500, "MAIL_SERVICE_URL is not configured."),
    );

    const { GET } = await import("@/app/api/mail/session/route");
    const request = new NextRequest("http://localhost/api/mail/session");

    const response = await GET(request);
    const payload = (await response.json()) as MailSessionResponse;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "needs_setup",
      senderEmail: null,
      senderDisplayName: null,
      expectedGoogleEmail: null,
      connectedGoogleEmail: null,
      connectionError:
        "Mail service URL is not configured. Add MAIL_SERVICE_URL before using in-app email.",
      folders: ["inbox", "sent", "drafts", "starred"],
    });
  });

  it("returns a structured needs_setup response when MAIL_SERVICE_SHARED_SECRET is missing", async () => {
    requestMailService.mockRejectedValue(
      new HttpError(500, "MAIL_SERVICE_SHARED_SECRET is not configured."),
    );

    const { GET } = await import("@/app/api/mail/session/route");
    const request = new NextRequest("http://localhost/api/mail/session");

    const response = await GET(request);
    const payload = (await response.json()) as MailSessionResponse;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("needs_setup");
    expect(payload.connectionError).toBe(
      "Mail service shared secret is not configured. Add MAIL_SERVICE_SHARED_SECRET before using in-app email.",
    );
  });

  it("passes through the upstream session payload when the mail service succeeds", async () => {
    requestMailService.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "connected",
          senderEmail: "jserrano@meadowb.com",
          senderDisplayName: "Jorge Serrano",
          expectedGoogleEmail: "jserrano@meadowb.com",
          connectedGoogleEmail: "jserrano@meadowb.com",
          connectionError: null,
          folders: ["inbox", "sent", "drafts", "starred"],
        } satisfies MailSessionResponse),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    const { GET } = await import("@/app/api/mail/session/route");
    const request = new NextRequest("http://localhost/api/mail/session");

    const response = await GET(request);
    const payload = (await response.json()) as MailSessionResponse;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("connected");
    expect(payload.connectedGoogleEmail).toBe("jserrano@meadowb.com");
  });

  it("returns a disconnected mailbox state with sender info when the mail service hangs", async () => {
    const { HttpError } = await import("@/lib/errors");
    requestMailService.mockRejectedValue(
      new HttpError(
        504,
        "Mailbox status is taking longer than expected. Gmail may still be connecting. Refresh in a few seconds.",
      ),
    );

    const { GET } = await import("@/app/api/mail/session/route");
    const request = new NextRequest("http://localhost/api/mail/session");

    const response = await GET(request);
    const payload = (await response.json()) as MailSessionResponse;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "disconnected",
      senderEmail: "jserrano@meadowb.com",
      senderDisplayName: "Jorge Serrano",
      expectedGoogleEmail: "jserrano@meadowb.com",
      connectedGoogleEmail: null,
      connectionError:
        "Mailbox status is taking longer than expected. Gmail may still be connecting. Refresh in a few seconds.",
      folders: ["inbox", "sent", "drafts", "starred"],
    });
  });

  it("reuses the cached timeout fallback on a non-refresh retry", async () => {
    const { HttpError } = await import("@/lib/errors");
    requestMailService.mockRejectedValue(
      new HttpError(
        504,
        "Mailbox status is taking longer than expected. Gmail may still be connecting. Refresh in a few seconds.",
      ),
    );

    const { GET } = await import("@/app/api/mail/session/route");

    const firstResponse = await GET(new NextRequest("http://localhost/api/mail/session"));
    const firstPayload = (await firstResponse.json()) as MailSessionResponse;
    expect(firstResponse.status).toBe(200);
    expect(firstPayload.status).toBe("disconnected");
    expect(requestMailService).toHaveBeenCalledTimes(1);

    requestMailService.mockClear();

    const secondResponse = await GET(new NextRequest("http://localhost/api/mail/session"));
    const secondPayload = (await secondResponse.json()) as MailSessionResponse;
    expect(secondResponse.status).toBe(200);
    expect(secondPayload).toEqual(firstPayload);
    expect(requestMailService).not.toHaveBeenCalled();
  });
});
