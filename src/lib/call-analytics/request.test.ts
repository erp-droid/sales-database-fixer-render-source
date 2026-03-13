import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateSessionWithAcumatica = vi.fn();

vi.mock("@/lib/acumatica", async () => {
  const actual = await vi.importActual<typeof import("@/lib/acumatica")>("@/lib/acumatica");
  return {
    ...actual,
    validateSessionWithAcumatica,
  };
});

function setDashboardEnv(): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
}

describe("dashboard request auth helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    validateSessionWithAcumatica.mockReset();
    setDashboardEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("authenticates dashboard reads without validating Acumatica", async () => {
    const { authenticateDashboardReadRequest } = await import("@/lib/call-analytics/request");
    const request = new NextRequest(
      "http://localhost/api/dashboard/calls/snapshot?start=2026-03-01T00:00:00.000Z&end=2026-03-09T23:59:59.000Z&employee=jserrano",
      {
        headers: {
          cookie: ".ASPXAUTH=session-cookie; mb_login_name=jserrano",
        },
      },
    );

    const result = authenticateDashboardReadRequest(request);

    expect(result.cookieValue).toBe("session-cookie");
    expect(result.viewerLoginName).toBe("jserrano");
    expect(result.filters.employees).toEqual(["jserrano"]);
    expect(validateSessionWithAcumatica).not.toHaveBeenCalled();
  });

  it("validates Acumatica only for dashboard refresh requests", async () => {
    validateSessionWithAcumatica.mockResolvedValue({
      name: "Jorge Serrano",
    });

    const { authenticateDashboardRefreshRequest } = await import("@/lib/call-analytics/request");
    const request = new NextRequest("http://localhost/api/dashboard/calls/refresh", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie; mb_login_name=jserrano",
      },
    });

    const result = await authenticateDashboardRefreshRequest(request);

    expect(validateSessionWithAcumatica).toHaveBeenCalledTimes(1);
    expect(result.cookieValue).toBe("session-cookie");
    expect(result.viewerLoginName).toBe("jserrano");
    expect(result.viewerDisplayName).toBe("Jorge Serrano");
  });
});
