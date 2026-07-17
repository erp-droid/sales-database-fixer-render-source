import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestAcumaticaPasswordReset = vi.fn();

vi.mock("@/lib/acumatica-password-recovery", () => ({
  normalizePasswordRecoveryUsername(value: string) {
    const trimmed = value.trim();
    const atIndex = trimmed.indexOf("@");
    return atIndex > 0 ? trimmed.slice(0, atIndex).trim() : trimmed;
  },
  requestAcumaticaPasswordReset,
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    AUTH_PROVIDER: "acumatica",
    ACUMATICA_BASE_URL: "https://example.acumatica.com",
    ACUMATICA_COMPANY: "MeadowBrook Live",
  }),
}));

function buildRequest(username: unknown, ip = "203.0.113.10"): NextRequest {
  return new NextRequest("https://sales-meadowb.onrender.com/api/auth/forgot-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ username }),
  });
}

describe("password recovery route", () => {
  beforeEach(() => {
    vi.resetModules();
    requestAcumaticaPasswordReset.mockReset();
    requestAcumaticaPasswordReset.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the legacy GET endpoint inside the CRM", async () => {
    const { GET } = await import("@/app/api/auth/forgot-password/route");
    const response = await GET(
      new NextRequest("https://sales-meadowb.onrender.com/api/auth/forgot-password"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://sales-meadowb.onrender.com/forgot-password",
    );
  });

  it("requires a username without contacting the upstream service", async () => {
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const response = await POST(buildRequest(""));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Enter your MeadowBrook username or email address.",
    });
    expect(requestAcumaticaPasswordReset).not.toHaveBeenCalled();
  });

  it("requests recovery and returns a neutral confirmation", async () => {
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const response = await POST(buildRequest("jdoe@meadowb.com"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requestAcumaticaPasswordReset).toHaveBeenCalledWith(
      "jdoe",
      expect.objectContaining({ AUTH_PROVIDER: "acumatica" }),
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message:
        "If that username matches a MeadowBrook account, password-reset instructions will arrive at the email address on file.",
    });
  });

  it("does not expose upstream error details", async () => {
    requestAcumaticaPasswordReset.mockRejectedValueOnce(
      new Error("Sensitive upstream implementation detail"),
    );
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const response = await POST(buildRequest("jdoe"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error:
        "Password reset is temporarily unavailable. Please try again or contact your MeadowBrook administrator.",
    });
  });

  it("rate limits repeated requests for the same username", async () => {
    const { POST } = await import("@/app/api/auth/forgot-password/route");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(buildRequest("jdoe", `203.0.113.${attempt + 1}`));
      expect(response.status).toBe(200);
    }

    const limited = await POST(buildRequest("jdoe", "203.0.113.100"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(requestAcumaticaPasswordReset).toHaveBeenCalledTimes(5);
  });
});
