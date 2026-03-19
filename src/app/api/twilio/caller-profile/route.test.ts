import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthCookieValue = vi.fn();
const getStoredLoginName = vi.fn();
const setAuthCookie = vi.fn();
const validateSessionWithAcumatica = vi.fn();
const readCallerPhoneOverride = vi.fn();
const saveCallerPhoneOverride = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthCookieValue,
  getStoredLoginName,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  validateSessionWithAcumatica,
}));

vi.mock("@/lib/caller-phone-overrides", () => ({
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
}));

describe("twilio caller profile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("jlee");
    validateSessionWithAcumatica.mockResolvedValue({ ok: true });
  });

  it("returns the locally cached caller phone immediately", async () => {
    readCallerPhoneOverride.mockReturnValue({
      loginName: "jlee",
      phoneNumber: "+13653411781",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });

    const { GET } = await import("@/app/api/twilio/caller-profile/route");
    const response = await GET(new NextRequest("http://localhost/api/twilio/caller-profile"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      phoneNumber: "+13653411781",
    });
    expect(readCallerPhoneOverride).toHaveBeenCalledWith("jlee");
    expect(validateSessionWithAcumatica).not.toHaveBeenCalled();
  });

  it("returns null when there is no locally cached caller phone", async () => {
    readCallerPhoneOverride.mockReturnValue(null);
    const { GET } = await import("@/app/api/twilio/caller-profile/route");
    const response = await GET(new NextRequest("http://localhost/api/twilio/caller-profile"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      phoneNumber: null,
    });
    expect(readCallerPhoneOverride).toHaveBeenCalledWith("jlee");
  });

  it("stores a normalized callback phone number for the signed-in user", async () => {
    saveCallerPhoneOverride.mockReturnValue({
      loginName: "jlee",
      phoneNumber: "+14165550100",
      updatedAt: "2026-03-17T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/twilio/caller-profile/route");
    const response = await POST(
      new NextRequest("http://localhost/api/twilio/caller-profile", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          phoneNumber: "416-555-0100",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phoneNumber: "+14165550100",
    });
    expect(saveCallerPhoneOverride).toHaveBeenCalledWith("jlee", "416-555-0100");
  });
});
