import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildCookieHeader: vi.fn((value: string) => `.ASPXAUTH=${value}`),
  buildMailProxyAssertion: vi.fn(() => "proxy-assertion"),
  ensureMailServiceConfigured: vi.fn(() => ({
    serviceUrl: "https://mail-service.example.com",
    sharedSecret: "service-secret",
  })),
  requireAuthCookieValue: vi.fn(() => "session-cookie"),
  resolveMailSenderForRequest: vi.fn(async () => ({
    loginName: "jserrano",
    displayName: "Jorge Serrano",
    senderEmail: "jserrano@meadowb.com",
  })),
}));

vi.mock("@/lib/auth", () => ({
  buildCookieHeader: mocks.buildCookieHeader,
  requireAuthCookieValue: mocks.requireAuthCookieValue,
}));

vi.mock("@/lib/mail-auth", () => ({
  buildMailProxyAssertion: mocks.buildMailProxyAssertion,
  ensureMailServiceConfigured: mocks.ensureMailServiceConfigured,
  resolveMailSenderForRequest: mocks.resolveMailSenderForRequest,
}));

describe("mail service proxy routing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MBQ_BASE_PATH = "/quotes";
    mocks.ensureMailServiceConfigured.mockReturnValue({
      serviceUrl: "https://mail-service.example.com",
      sharedSecret: "service-secret",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("routes OAuth through the embedded mail mount with a proxy assertion", async () => {
    const { buildMailServiceOauthStartUrl } = await import("@/lib/mail-proxy");
    const request = new NextRequest(
      "https://sales-meadowb.onrender.com/api/mail/oauth/start?returnTo=%2Fmail%3Ffolder%3Dsent",
    );

    const result = new URL(await buildMailServiceOauthStartUrl(request));

    expect(result.origin + result.pathname).toBe(
      "https://mail-service.example.com/quotes/api/mail/oauth/start",
    );
    expect(result.searchParams.get("token")).toBe("proxy-assertion");
    expect(result.searchParams.get("returnTo")).toBe(
      "https://sales-meadowb.onrender.com/mail?folder=sent",
    );
    expect(mocks.buildMailProxyAssertion).toHaveBeenCalledWith({
      loginName: "jserrano",
      displayName: "Jorge Serrano",
      senderEmail: "jserrano@meadowb.com",
    });
  });

  it("does not duplicate the mount path when it is already in MAIL_SERVICE_URL", async () => {
    mocks.ensureMailServiceConfigured.mockReturnValue({
      serviceUrl: "https://mail-service.example.com/quotes/",
      sharedSecret: "service-secret",
    });
    const { buildMailServiceOauthStartUrl } = await import("@/lib/mail-proxy");
    const request = new NextRequest(
      "https://sales-meadowb.onrender.com/api/mail/oauth/start",
    );

    const result = new URL(await buildMailServiceOauthStartUrl(request));

    expect(result.pathname).toBe("/quotes/api/mail/oauth/start");
  });

  it("routes API requests through the mount and authenticates with the proxy secret", async () => {
    const fetchMock = vi.fn(async () => Response.json({ connected: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { requestMailService } = await import("@/lib/mail-proxy");
    const request = new NextRequest("https://sales-meadowb.onrender.com/api/mail/session");

    await requestMailService(request, {
      path: "/api/mail/session",
      query: new URLSearchParams({ folder: "sent" }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe(
      "https://mail-service.example.com/quotes/api/mail/session?folder=sent",
    );
    expect(init.headers.get("Authorization")).toBe("Bearer proxy-assertion");
  });
});
