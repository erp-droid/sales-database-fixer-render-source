import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordFixedIssuesMock = vi.hoisted(() => vi.fn());
const validateSessionWithAcumaticaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/data-quality-history", () => ({
  recordFixedIssues: recordFixedIssuesMock,
}));

vi.mock("@/lib/acumatica", () => ({
  validateSessionWithAcumatica: validateSessionWithAcumaticaMock,
}));

describe("POST /api/data-quality/fixes", () => {
  beforeEach(() => {
    vi.resetModules();
    recordFixedIssuesMock.mockReset();
    validateSessionWithAcumaticaMock.mockReset();
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.USER_CREDENTIALS_SECRET = "test-user-credentials-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the stored login name without probing Acumatica", async () => {
    const { POST } = await import("@/app/api/data-quality/fixes/route");

    const request = new NextRequest("http://localhost/api/data-quality/fixes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ".ASPXAUTH=session-cookie; mb_login_name=jserrano",
      },
      body: JSON.stringify({
        issueKeys: ["duplicateContact:row:example"],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      attributed: 1,
      user: {
        id: "jserrano",
        name: "jserrano",
      },
    });
    expect(validateSessionWithAcumaticaMock).not.toHaveBeenCalled();
    expect(recordFixedIssuesMock).toHaveBeenCalledWith(["duplicateContact:row:example"], {
      userId: "jserrano",
      userName: "jserrano",
    });
  });

  it("falls back to Acumatica session user when no stored login name exists", async () => {
    validateSessionWithAcumaticaMock.mockResolvedValue({
      id: "109343",
      name: "Jorge Serrano",
    });

    const { POST } = await import("@/app/api/data-quality/fixes/route");

    const request = new NextRequest("http://localhost/api/data-quality/fixes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ".ASPXAUTH=session-cookie",
      },
      body: JSON.stringify({
        issueKeys: ["duplicateContact:row:example"],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      attributed: 1,
      user: {
        id: "109343",
        name: "Jorge Serrano",
      },
    });
    expect(validateSessionWithAcumaticaMock).toHaveBeenCalledTimes(1);
  });
});
