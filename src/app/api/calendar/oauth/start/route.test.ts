import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRequestLoginName = vi.fn();
const buildGoogleCalendarOauthStartUrl = vi.fn();
const readGoogleCalendarExpectedRedirectUri = vi.fn();

vi.mock("@/lib/request-login", () => ({
  requireRequestLoginName,
}));

vi.mock("@/lib/google-calendar", () => ({
  buildGoogleCalendarOauthStartUrl,
  readGoogleCalendarExpectedRedirectUri,
}));

describe("GET /api/calendar/oauth/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    requireRequestLoginName.mockReturnValue("jserrano");
    buildGoogleCalendarOauthStartUrl.mockReturnValue(
      new URL("https://accounts.google.com/o/oauth2/v2/auth?client_id=test"),
    );
    readGoogleCalendarExpectedRedirectUri.mockReturnValue(
      "http://localhost:3000/api/calendar/oauth/callback",
    );
  });

  it("redirects to Google when the configured callback origin matches the current app origin", async () => {
    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/calendar/oauth/start?returnTo=/calendar/oauth/complete"),
    );

    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
    );
    expect(buildGoogleCalendarOauthStartUrl).toHaveBeenCalledWith({
      loginName: "jserrano",
      returnTo: "/calendar/oauth/complete",
    });
  });

  it("returns to the current app with an error before Google OAuth when the callback origin points elsewhere", async () => {
    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new NextRequest("http://127.0.0.1:4312/api/calendar/oauth/start?returnTo=/calendar/oauth/complete"),
    );
    const location = response.headers.get("location") ?? "";
    const redirectUrl = new URL(location);

    expect(redirectUrl.origin).toBe("http://localhost:4312");
    expect(redirectUrl.pathname).toBe("/calendar/oauth/complete");
    expect(redirectUrl.searchParams.get("error")).toContain(
      "Google Calendar OAuth is configured to return to http://localhost:3000",
    );
    expect(buildGoogleCalendarOauthStartUrl).not.toHaveBeenCalled();
  });

  it("uses forwarded public Render origin instead of the internal container origin", async () => {
    readGoogleCalendarExpectedRedirectUri.mockReturnValue(
      "https://sales-meadowb.onrender.com/api/calendar/oauth/callback",
    );

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new NextRequest("http://0.0.0.0:10000/api/calendar/oauth/start?returnTo=/calendar/oauth/complete", {
        headers: {
          "x-forwarded-host": "sales-meadowb.onrender.com",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=test",
    );
  });

  it("falls back to the configured public origin when an internal Render request errors", async () => {
    const { HttpError } = await import("@/lib/errors");
    requireRequestLoginName.mockImplementation(() => {
      throw new HttpError(401, "Signed-in username is unavailable.");
    });
    readGoogleCalendarExpectedRedirectUri.mockReturnValue(
      "https://sales-meadowb.onrender.com/api/calendar/oauth/callback",
    );

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new NextRequest("http://0.0.0.0:10000/api/calendar/oauth/start?returnTo=/calendar/oauth/complete"),
    );
    const redirectUrl = new URL(response.headers.get("location") ?? "");

    expect(redirectUrl.origin).toBe("https://sales-meadowb.onrender.com");
    expect(redirectUrl.pathname).toBe("/calendar/oauth/complete");
    expect(redirectUrl.searchParams.get("error")).toBe("Signed-in username is unavailable.");
  });
});
