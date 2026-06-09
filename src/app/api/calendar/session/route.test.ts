import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireStoredLoginName = vi.fn();
const readGoogleCalendarSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireStoredLoginName,
}));

vi.mock("@/lib/google-calendar", () => ({
  readGoogleCalendarSession,
}));

describe("GET /api/calendar/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 401 when the app username is unavailable", async () => {
    const { HttpError } = await import("@/lib/errors");
    requireStoredLoginName.mockImplementation(() => {
      throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
    });

    const { GET } = await import("@/app/api/calendar/session/route");
    const response = await GET(new NextRequest("http://localhost/api/calendar/session"));

    await expect(response.json()).resolves.toEqual({
      error: "Signed-in username is unavailable. Sign out and sign in again.",
    });
    expect(response.status).toBe(401);
    expect(readGoogleCalendarSession).not.toHaveBeenCalled();
  });

  it("returns the calendar session payload for an app signed-in request", async () => {
    requireStoredLoginName.mockReturnValue("jserrano");
    readGoogleCalendarSession.mockReturnValue({
      status: "connected",
      connectedGoogleEmail: "jserrano@example.com",
      connectionError: null,
      expectedRedirectUri: "https://sales-meadowb.onrender.com/api/calendar/oauth/callback",
      canUploadAttachments: true,
      requiresReconnectForAttachments: false,
    });

    const { GET } = await import("@/app/api/calendar/session/route");
    const response = await GET(new NextRequest("http://localhost/api/calendar/session"));

    await expect(response.json()).resolves.toEqual({
      status: "connected",
      connectedGoogleEmail: "jserrano@example.com",
      connectionError: null,
      expectedRedirectUri: "https://sales-meadowb.onrender.com/api/calendar/oauth/callback",
      canUploadAttachments: true,
      requiresReconnectForAttachments: false,
    });
    expect(response.status).toBe(200);
    expect(readGoogleCalendarSession).toHaveBeenCalledWith("jserrano");
  });

  it("returns 500 with message for unexpected errors", async () => {
    requireStoredLoginName.mockReturnValue("jserrano");
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
