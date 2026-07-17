import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

describe("route auth proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows protected pages without cookies when local auth bypass is enabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "true");
    vi.stubEnv("LOCAL_DATABASE_ONLY", "true");

    const response = proxy(new NextRequest("http://localhost:3010/accounts"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("skips the sign-in page when local auth bypass is enabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "true");
    vi.stubEnv("LOCAL_DATABASE_ONLY", "true");

    const response = proxy(new NextRequest("http://localhost:3010/signin"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3010/accounts");
  });

  it("keeps the production-style sign-in redirect when the bypass is disabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "false");

    const response = proxy(
      new NextRequest("http://localhost:3010/accounts?q=melrose"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3010/signin?next=%2Faccounts%3Fq%3Dmelrose",
    );
  });

  it("requires a signed-in work session for the support page", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "false");

    const response = proxy(new NextRequest("https://sales-meadowb.onrender.com/support"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://sales-meadowb.onrender.com/signin?next=%2Fsupport",
    );
  });

  it("redirects Jeffery from every non-directory page", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "false");

    const response = proxy(
      new NextRequest("https://sales-meadowb.onrender.com/dashboard", {
        headers: {
          cookie: ".ASPXAUTH=session; mb_login_name=jbuhagiar@meadowb.com",
        },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://sales-meadowb.onrender.com/accounts",
    );
  });

  it("allows Jeffery to open the directory", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_DEV_AUTH_BYPASS", "false");

    const response = proxy(
      new NextRequest("https://sales-meadowb.onrender.com/accounts", {
        headers: {
          cookie: ".ASPXAUTH=session; mb_login_name=jbuhagiar@meadowb.com",
        },
      }),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
