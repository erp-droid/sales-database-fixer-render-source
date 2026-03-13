import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

  return new Response(input.body === undefined ? null : JSON.stringify(input.body), {
    status: input.status,
    headers,
  });
}

function setAcumaticaEnv(sqlitePath: string): void {
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
  process.env.READ_MODEL_SQLITE_PATH = sqlitePath;
  process.env.USER_CREDENTIALS_SECRET = "test-user-credentials-secret";
}

describe("auth login credential persistence", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "auth-login-credentials-"));
    vi.resetModules();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setAcumaticaEnv(path.join(tempDir, "read-model.sqlite"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("stores encrypted credentials for the signed-in user after a successful login", async () => {
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
    const { readStoredUserCredentials } = await import("@/lib/stored-user-credentials");

    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "jserrano",
        password: "Ruth1234!.",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const stored = readStoredUserCredentials("jserrano");
    expect(stored).toMatchObject({
      loginName: "jserrano",
      username: "jserrano",
      password: "Ruth1234!.",
    });
  });
});

