import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthCookieValue, getStoredLoginName } from "@/lib/auth";

describe("local development auth bypass", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("provides a local identity when the bypass is enabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "true");
    vi.stubEnv("LOCAL_DATABASE_ONLY", "true");
    vi.stubEnv("LOCAL_DEV_LOGIN_NAME", "jserrano");

    const request = new NextRequest("http://localhost:3010/accounts");

    expect(getAuthCookieValue(request)).toBe("local-dev-auth-bypass");
    expect(getStoredLoginName(request)).toBe("jserrano");
  });

  it("keeps the isolated local identity ahead of cookies from other localhost apps", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "true");
    vi.stubEnv("LOCAL_DATABASE_ONLY", "true");
    vi.stubEnv("LOCAL_DEV_LOGIN_NAME", "local-user");

    const request = new NextRequest("http://localhost:3010/accounts", {
      headers: {
        cookie: ".ASPXAUTH=existing-cookie; mb_login_name=signed-in-user",
      },
    });

    expect(getAuthCookieValue(request)).toBe("local-dev-auth-bypass");
    expect(getStoredLoginName(request)).toBe("local-user");
  });

  it("never enables the bypass in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "true");
    vi.stubEnv("LOCAL_DATABASE_ONLY", "true");
    vi.stubEnv("LOCAL_DEV_LOGIN_NAME", "jserrano");

    const request = new NextRequest("https://sales-meadowb.onrender.com/accounts");

    expect(getAuthCookieValue(request)).toBeNull();
    expect(getStoredLoginName(request)).toBeNull();
  });

  it("keeps the bypass off when source-system access is enabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "true");
    vi.stubEnv("LOCAL_DATABASE_ONLY", "false");

    const request = new NextRequest("http://localhost:3010/accounts");

    expect(getAuthCookieValue(request)).toBeNull();
    expect(getStoredLoginName(request)).toBeNull();
  });
});
