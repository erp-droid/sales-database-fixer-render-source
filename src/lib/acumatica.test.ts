import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  return new Response(
    input.body === undefined ? null : JSON.stringify(input.body),
    {
      status: input.status,
      headers,
    },
  );
}

function setAcumaticaEnv(overrides?: Record<string, string | undefined>): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.AUTH_LOGIN_URL = "";
  process.env.AUTH_ME_URL = "";
  process.env.AUTH_LOGOUT_URL = "";
  process.env.AUTH_FORGOT_PASSWORD_URL = "";
  process.env.ACUMATICA_BRANCH = "";

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

describe("Acumatica endpoint resolution", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
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
  });

  it("derives the eCommerce fallback with the same version", async () => {
    const acumaticaModule = await import("@/lib/acumatica");
    expect(
      acumaticaModule.deriveFallbackAcumaticaEntityPath("/entity/lightspeed/24.200.001"),
    ).toBe("/entity/eCommerce/24.200.001");
  });

  it("derives the Default fallback with the same version", async () => {
    const acumaticaModule = await import("@/lib/acumatica");
    expect(
      acumaticaModule.deriveDefaultAcumaticaEntityPath("/entity/lightspeed/24.200.001"),
    ).toBe("/entity/Default/24.200.001");
  });

  it("uses the configured endpoint when it is available and reuses the cache", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");
    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact?$top=1",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact?$top=1",
    );
  });

  it("falls back to eCommerce when the configured endpoint is not found", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/eCommerce/24.200.001/Contact?$top=1",
    );
  });

  it("falls back to Default when eCommerce is unusable for customer management", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: {
            message:
              "The required configuration data is not entered on the Customer Management Preferences form.",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/entity/Default/24.200.001/Contact?$top=1",
    );
  });

  it("does not fall back when the configured endpoint returns 401", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 401,
        body: { message: "Session is invalid or expired" },
      }),
    );

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await expect(validateSessionWithAcumatica("cookie")).rejects.toMatchObject({
      status: 401,
      message: "Session is invalid or expired",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a precise diagnostic when both endpoints are missing", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [eCommerce/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [Default/24.200.001] not found" },
        }),
      );

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await expect(validateSessionWithAcumatica("cookie")).rejects.toMatchObject({
      status: 502,
      message:
        'Acumatica REST endpoint was not found for company "MeadowBrook Live". Tested:\n/entity/lightspeed/24.200.001\n/entity/eCommerce/24.200.001\n/entity/Default/24.200.001',
    });
  });

  it("retries other endpoints when a cached endpoint later disappears", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 404,
          body: { message: "Endpoint [lightspeed/24.200.001] not found" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 500,
          body: {
            message:
              "The required configuration data is not entered on the Customer Management Preferences form.",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");

    await validateSessionWithAcumatica("cookie");
    await validateSessionWithAcumatica("cookie");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/entity/lightspeed/24.200.001/Contact?$top=1",
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/entity/eCommerce/24.200.001/Contact?$top=1",
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(
      "/entity/Default/24.200.001/Contact?$top=1",
    );
  });
});

describe("Acumatica environment and login payload", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("requires ACUMATICA_COMPANY for direct Acumatica auth", async () => {
    vi.resetModules();
    setAcumaticaEnv({
      ACUMATICA_COMPANY: undefined,
    });

    const { getEnv } = await import("@/lib/env");

    expect(() => getEnv()).toThrow(
      "Invalid environment configuration for Acumatica auth provider: ACUMATICA_COMPANY",
    );
  });

  it("sends MeadowBrook Live in the Acumatica login payload", async () => {
    vi.resetModules();
    setAcumaticaEnv();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": ".ASPXAUTH=abc123; Path=/; HttpOnly",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/auth/login/route");

    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "jorge",
        password: "secret",
      }),
    });

    const response = await POST(request);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const payload =
      typeof requestInit?.body === "string"
        ? (JSON.parse(requestInit.body) as Record<string, string>)
        : {};

    expect(response.status).toBe(200);
    expect(payload.company).toBe("MeadowBrook Live");
  });
});

describe("Acumatica request logging", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setAcumaticaEnv();
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
  });

  it("suppresses fast successful request logs", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");
    await validateSessionWithAcumatica("cookie");

    const requestLogs = infoSpy.mock.calls.filter((call) => call[0] === "[acumatica]");
    expect(requestLogs).toHaveLength(0);
  });

  it("logs slow successful requests", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));

    let nowCalls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      nowCalls += 1;
      return nowCalls === 1 ? 0 : 1500;
    });

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");
    await validateSessionWithAcumatica("cookie");

    const requestLogs = infoSpy.mock.calls.filter((call) => call[0] === "[acumatica]");
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]?.[1]).toMatchObject({
      status: 200,
      attempts: 1,
      durationMs: 1500,
    });
  });

  it("logs warning entries for failed requests", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 500,
        body: { message: "Server error" },
      }),
    );

    const { validateSessionWithAcumatica } = await import("@/lib/acumatica");
    await expect(validateSessionWithAcumatica("cookie")).rejects.toMatchObject({
      status: 500,
    });

    const requestLogs = warnSpy.mock.calls.filter((call) => call[0] === "[acumatica]");
    expect(requestLogs).toHaveLength(1);
    expect(requestLogs[0]?.[1]).toMatchObject({
      status: 500,
      attempts: 1,
    });
  });
});

describe("Acumatica entity creation", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv();
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
  });

  it("creates business accounts with PUT on the entity collection", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { id: "abc" } }));

    const { createBusinessAccount } = await import("@/lib/acumatica");
    await createBusinessAccount("cookie", {
      Name: { value: "Alpha Inc" },
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const requestInit = fetchMock.mock.calls[0]?.[1];

    expect(requestUrl).toContain("/entity/lightspeed/24.200.001/BusinessAccount");
    expect(requestInit?.method).toBe("PUT");
  });

  it("creates contacts with PUT on the entity collection", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 200, body: { id: "contact" } }));

    const { createContact } = await import("@/lib/acumatica");
    await createContact("cookie", {
      DisplayName: { value: "Jane Doe" },
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const requestInit = fetchMock.mock.calls[0]?.[1];

    expect(requestUrl).toContain("/entity/lightspeed/24.200.001/Contact");
    expect(requestInit?.method).toBe("PUT");
  });
});
