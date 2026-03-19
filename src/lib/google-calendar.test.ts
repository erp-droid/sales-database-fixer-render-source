import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("google-calendar oauth config", () => {
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "google-calendar-test-"));
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.ACUMATICA_BASE_URL = "https://example.invalid";
    process.env.ACUMATICA_COMPANY = "Test Company";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
    process.env.USER_CREDENTIALS_SECRET = "test-user-credentials-secret";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-client-secret";
    delete process.env.APP_BASE_URL;
  });

  afterEach(() => {
    closeDb?.();
    closeDb = null;
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires APP_BASE_URL when Google Calendar OAuth is configured", async () => {
    const googleCalendar = await import("@/lib/google-calendar");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    expect(googleCalendar.readGoogleCalendarSession("jserrano")).toEqual(
      expect.objectContaining({
        status: "needs_setup",
        connectedGoogleEmail: null,
        expectedRedirectUri: null,
      }),
    );
    expect(
      googleCalendar.readGoogleCalendarSession("jserrano").connectionError,
    ).toContain("APP_BASE_URL");
    expect(() =>
      googleCalendar.buildGoogleCalendarOauthStartUrl({
        loginName: "jserrano",
        returnTo: "/calendar/oauth/complete",
      }),
    ).toThrow("APP_BASE_URL is required for Google Calendar OAuth");
  });

  it("uses APP_BASE_URL as the expected Google redirect URI", async () => {
    process.env.APP_BASE_URL = "http://localhost:3000";

    const googleCalendar = await import("@/lib/google-calendar");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    const session = googleCalendar.readGoogleCalendarSession("jserrano");
    const oauthUrl = googleCalendar.buildGoogleCalendarOauthStartUrl({
      loginName: "jserrano",
      returnTo: "/calendar/oauth/complete",
    });

    expect(session).toEqual(
      expect.objectContaining({
        status: "disconnected",
        expectedRedirectUri: "http://localhost:3000/api/calendar/oauth/callback",
      }),
    );
    expect(oauthUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/calendar/oauth/callback",
    );
  });

  it("uses Google invite authority only when a stored connection exists", async () => {
    const googleCalendar = await import("@/lib/google-calendar");
    const { storeGoogleCalendarConnection } = await import("@/lib/google-calendar-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    expect(googleCalendar.readGoogleCalendarInviteAuthority("jserrano")).toBe("acumatica");

    storeGoogleCalendarConnection({
      loginName: "jserrano",
      connectedGoogleEmail: "jserrano@gmail.com",
      refreshToken: "refresh-token",
      accessToken: "access-token",
      accessTokenExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      tokenScope: "calendar.events",
    });

    expect(googleCalendar.readGoogleCalendarInviteAuthority("jserrano")).toBe("google");
  });

  it("keeps the organizer in Google attendees when included and preserves the meeting sync key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "google-event-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const googleCalendar = await import("@/lib/google-calendar");
    const { storeGoogleCalendarConnection } = await import("@/lib/google-calendar-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    closeDb = () => getReadModelDb().close();

    storeGoogleCalendarConnection({
      loginName: "jserrano",
      connectedGoogleEmail: "jserrano@gmail.com",
      refreshToken: "refresh-token",
      accessToken: "access-token",
      accessTokenExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      tokenScope: "calendar.events",
    });

    const result = await googleCalendar.createMeetingInviteInGoogleCalendar("jserrano", {
      acumaticaEventId: null,
      meetingSyncKey: "sync-123",
      attendees: [
        {
          contactId: 1,
          contactRecordId: "contact-1",
          contactName: "Jorge Serrano",
          email: "jserrano@gmail.com",
        },
        {
          contactId: 2,
          contactRecordId: "contact-2",
          contactName: "Jacky Lee",
          email: "jacky.lee@example.com",
        },
      ],
      businessAccountId: "BA0001",
      companyName: "MeadowBrook Construction",
      relatedContactId: 2,
      relatedContactName: "Jacky Lee",
      request: {
        businessAccountRecordId: "record-1",
        businessAccountId: "BA0001",
        sourceContactId: 2,
        organizerContactId: 99,
        includeOrganizerInAcumatica: true,
        relatedContactId: 2,
        summary: "Operations sync",
        location: "Boardroom",
        timeZone: "America/Toronto",
        startDate: "2026-03-13",
        startTime: "09:00",
        endDate: "2026-03-13",
        endTime: "10:00",
        priority: "Normal",
        details: "Review open items.",
        attendeeContactIds: [2],
        attendeeEmails: [],
      },
    });

    expect(result).toEqual({
      status: "created",
      eventId: "google-event-1",
      connectedGoogleEmail: "jserrano@gmail.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      attendees?: Array<{ email: string }>;
      extendedProperties?: { private?: Record<string, string> };
    };

    expect(payload.attendees).toEqual([
      { email: "jserrano@gmail.com", displayName: "Jorge Serrano" },
      { email: "jacky.lee@example.com", displayName: "Jacky Lee" },
    ]);
    expect(payload.extendedProperties?.private?.meetingSyncKey).toBe("sync-123");
  });
});
