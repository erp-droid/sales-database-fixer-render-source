import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveSignedInCallerIdentity = vi.fn();

vi.mock("@/lib/caller-identity", () => ({
  resolveSignedInCallerIdentity,
}));

type MockResponseInput = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function jsonResponse(input: MockResponseInput): Response {
  const headers = new Headers(input.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Response(input.body === undefined ? null : JSON.stringify(input.body), {
    status: input.status,
    headers,
  });
}

function setAcumaticaEnv(overrides?: Record<string, string | undefined>): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.USER_CREDENTIALS_SECRET = "test-user-credentials-secret";
  process.env.READ_MODEL_SQLITE_PATH = "/tmp/auth-routes-read-model.sqlite";
  process.env.AUTH_LOGIN_URL = "";
  process.env.AUTH_ME_URL = "";
  process.env.AUTH_LOGOUT_URL = "";
  process.env.AUTH_FORGOT_PASSWORD_URL = "";
  process.env.ACUMATICA_BRANCH = "";
  process.env.ACUMATICA_OPPORTUNITY_ENTITY = "Opportunity";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_ID = "PRODUCTION";
  process.env.ACUMATICA_OPPORTUNITY_STAGE = "Awaiting Estimate";
  process.env.ACUMATICA_OPPORTUNITY_LOCATION = "MAIN";
  process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS = "0";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID =
    "Do you think we are going to win this job?";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID = "Link to Drive";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID = "Project Type";
  process.env.ACUMATICA_OPPORTUNITY_DEFAULT_LINK_TO_DRIVE = "";

  if (!overrides) {
    return;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function createAbortableResponse(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    if (!signal) {
      return;
    }

    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    signal.addEventListener(
      "abort",
      () => {
        reject(createAbortError());
      },
      { once: true },
    );
  });
}

describe("auth route timeouts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    resolveSignedInCallerIdentity.mockReset();
    resolveSignedInCallerIdentity.mockResolvedValue({
      loginName: "jserrano",
      employeeId: "E0000045",
      contactId: 12,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14162304681",
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("returns a degraded authenticated session when the upstream probe times out", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      createAbortableResponse((init?.signal as AbortSignal | undefined) ?? null),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/auth/session/route");

    const request = new NextRequest("http://localhost/api/auth/session", {
      headers: {
        cookie: ".ASPXAUTH=existing-cookie; mb_login_name=jorge",
      },
    });

    const responsePromise = GET(request);
    await vi.advanceTimersByTimeAsync(3000);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        id: "jorge",
        name: "jorge",
      },
      degraded: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the stored login name when the upstream session payload omits user details", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          status: 200,
          body: {
            ok: true,
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/auth/session/route");

    const request = new NextRequest("http://localhost/api/auth/session", {
      headers: {
        cookie: ".ASPXAUTH=existing-cookie; mb_login_name=jserrano",
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        id: "jserrano",
        name: "jserrano",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the session active when caller identity cannot be resolved", async () => {
    const { HttpError } = await import("@/lib/errors");
    resolveSignedInCallerIdentity.mockRejectedValueOnce(new HttpError(403, "blocked"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          status: 200,
          body: {
            ok: true,
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/auth/session/route");

    const request = new NextRequest("http://localhost/api/auth/session", {
      headers: {
        cookie: ".ASPXAUTH=existing-cookie; mb_login_name=jserrano",
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        id: "jserrano",
        name: "jserrano",
      },
    });
  });

  it("clears local auth cookies when the upstream session is expired", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          status: 401,
          body: {
            message: "Session is invalid or expired",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/auth/session/route");

    const request = new NextRequest("http://localhost/api/auth/session", {
      headers: {
        cookie: ".ASPXAUTH=expired-cookie; mb_login_name=jserrano",
      },
    });

    const response = await GET(request);
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      user: null,
    });
    expect(setCookie).toContain(".ASPXAUTH=");
    expect(setCookie).toContain("mb_login_name=");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh login immediately even when the browser still has an old session cookie", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/entity/auth/logout")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      if (url.endsWith("/entity/auth/login")) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { ok: true },
            headers: {
              "set-cookie": ".ASPXAUTH=fresh-cookie; Path=/; HttpOnly",
            },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/login/route");

    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ".ASPXAUTH=existing-cookie; mb_login_name=jorge",
      },
      body: JSON.stringify({
        username: "jorge",
        password: "secret",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/entity/auth/logout");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/entity/auth/login");
  });

  it("allows sign-in when the username does not yet resolve to a callable internal contact", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/entity/auth/login")) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { ok: true },
            headers: {
              "set-cookie": ".ASPXAUTH=fresh-cookie; Path=/; HttpOnly",
            },
          }),
        );
      }

      if (url.endsWith("/entity/auth/logout")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/login/route");

    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "sdoalr",
        password: "secret",
      }),
    });

    const response = await POST(request);
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
    expect(setCookie).toContain(".ASPXAUTH=");
    expect(setCookie).toContain("mb_login_name=sdoalr");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows sign-in when the matched internal employee is missing a valid phone", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/entity/auth/login")) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { ok: true },
            headers: {
              "set-cookie": ".ASPXAUTH=fresh-cookie; Path=/; HttpOnly",
            },
          }),
        );
      }

      if (url.endsWith("/entity/auth/logout")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/login/route");

    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "jserrano",
        password: "secret",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("supports plain browser form posts for sign-in fallback", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/entity/auth/login")) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { ok: true },
            headers: {
              "set-cookie": ".ASPXAUTH=fresh-cookie; Path=/; HttpOnly",
            },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/login/route");

    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        username: "jserrano",
        password: "secret",
        next: "/accounts",
      }).toString(),
    });

    const response = await POST(request);
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/accounts");
    expect(setCookie).toContain(".ASPXAUTH=");
  });

  it("translates generic 429 login failures into the API login limit message", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/entity/auth/login")) {
        return Promise.resolve(
          new Response("The custom error module does not recognize this error.", {
            status: 429,
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "bkoczka",
          password: "Meadowbrook2026",
        }),
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error:
        "Acumatica API login limit reached for this user. Close old API sessions in Users (SM201010) or increase concurrent API logins, then sign in again.",
    });
  });
});
