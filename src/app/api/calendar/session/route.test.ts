import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn();
const getStoredLoginName = vi.fn();
const readGoogleCalendarSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  getStoredLoginName,
}));

vi.mock("@/lib/google-calendar", () => ({
  readGoogleCalendarSession,
}));

describe("GET /api/calendar/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 401 when the request is not authenticated", async () => {
    const { HttpError } = await import("@/lib/errors");
    requireAuthCookieValue.mockImplementation(() => {
      throw new HttpError(401, "Not authenticated");
    });

    const { GET } = await import("@/app/api/calendar/session/route");
    const response = await GET(new NextRequest("http://localhost/api/calendar/session"));

    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
    expect(response.status).toBe(401);
    expect(getStoredLoginName).not.toHaveBeenCalled();
    expect(readGoogleCalendarSession).not.toHaveBeenCalled();
  });

  it("returns the calendar session payload for an authenticated request", async () => {
    requireAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("jserrano");
    readGoogleCalendarSession.mockReturnValue({
      status: "connected",
      connectedGoogleEmail: "jserrano@example.com",
      connectionError: null,
      expectedRedirectUri: "https://sales-meadowb.onrender.com/api/calendar/oauth/callback",
    });

    const { GET } = await import("@/app/api/calendar/session/route");
    const response = await GET(new NextRequest("http://localhost/api/calendar/session"));

    await expect(response.json()).resolves.toEqual({
      status: "connected",
      connectedGoogleEmail: "jserrano@example.com",
      connectionError: null,
      expectedRedirectUri: "https://sales-meadowb.onrender.com/api/calendar/oauth/callback",
    });
    expect(response.status).toBe(200);
    expect(readGoogleCalendarSession).toHaveBeenCalledWith("jserrano");
  });

  it("returns 500 with message for unexpected errors", async () => {
    requireAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("jserrano");
    readGoogleCalendarSession.mockImplementation(() => {
      throw new Error("calendar lookup failed");
    });

    const { GET } = await import("@/app/api/calendar/session/route");
    const response = await GET(new NextRequest("http://localhost/api/calendar/session"));

    await expect(response.json()).resolves.toEqual({
      error: "calendar lookup failed",
    });
    expect(response.status).toBe(500);
  });
});
