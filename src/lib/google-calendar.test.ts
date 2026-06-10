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
    expect(oauthUrl.searchParams.has("include_granted_scopes")).toBe(false);
    expect(oauthUrl.searchParams.get("scope")).toBe(
      [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive.file",
      ].join(" "),
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

  it("uploads selected files to Drive, attaches them, keeps attendees, and preserves the meeting sync key", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("upload/drive/v3/files")) {
        return new Response(
          JSON.stringify({
            id: "drive-file-1",
            name: "agenda.pdf",
            mimeType: "application/pdf",
            webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
            iconLink: "https://drive-thirdparty.googleusercontent.com/icon",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({ id: "google-event-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
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
      tokenScope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file",
    });

    const result = await googleCalendar.createMeetingInviteInGoogleCalendar("jserrano", {
      acumaticaEventId: null,
      meetingSyncKey: "sync-123",
      attachmentFiles: [
        {
          data: Buffer.from("agenda"),
          fileName: "agenda.pdf",
          mimeType: "application/pdf",
          sizeBytes: 6,
        },
      ],
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
        privateNotes: "Do not share this note.",
        includeGoogleMeet: true,
        attachmentLinks: [],
        attendeeContactIds: [2],
        attendeeEmails: [],
      },
    });

    expect(result).toEqual({
      status: "created",
      eventId: "google-event-1",
      connectedGoogleEmail: "jserrano@gmail.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(uploadUrl)).toContain("upload/drive/v3/files");
    expect(uploadInit.method).toBe("POST");
    expect(uploadInit.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer access-token",
      }),
    );

    const [url, init] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      attendees?: Array<{ email: string }>;
      attachments?: Array<{ fileId: string; fileUrl: string; mimeType: string; title: string }>;
      conferenceData?: { createRequest?: { conferenceSolutionKey?: { type?: string } } };
      description?: string;
      extendedProperties?: { private?: Record<string, string> };
    };

    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(url.searchParams.get("supportsAttachments")).toBe("true");
    expect(payload.attendees).toEqual([
      { email: "jserrano@gmail.com", displayName: "Jorge Serrano" },
      { email: "jacky.lee@example.com", displayName: "Jacky Lee" },
    ]);
    expect(payload.conferenceData?.createRequest?.conferenceSolutionKey?.type).toBe("hangoutsMeet");
    expect(payload.attachments).toEqual([
      {
        fileId: "drive-file-1",
        fileUrl: "https://drive.google.com/file/d/drive-file-1/view",
        iconLink: "https://drive-thirdparty.googleusercontent.com/icon",
        mimeType: "application/pdf",
        title: "agenda.pdf",
      },
    ]);
    expect(payload.description).toContain("Review open items.");
    expect(payload.description).toContain("https://drive.google.com/file/d/drive-file-1/view");
    expect(payload.description).not.toContain("Do not share this note.");
    expect(payload.extendedProperties?.private?.privateNotes).toBe("Do not share this note.");
    expect(payload.extendedProperties?.private?.meetingSyncKey).toBe("sync-123");
  });

  it("maps Google Calendar event details for the calendar invite popover", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      expect(url).toContain("/calendar/v3/calendars/primary/events");
      return new Response(
        JSON.stringify({
          timeZone: "America/Toronto",
          items: [
            {
              id: "google-event-1",
              status: "confirmed",
              summary: "H&S Toolbox talk for the week",
              location: "Boardroom",
              description: "Start a new document to capture notes",
              hangoutLink: "https://meet.google.com/wba-jzpm-hpw",
              htmlLink: "https://calendar.google.com/event?eid=abc",
              colorId: "9",
              recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
              guestsCanModify: false,
              organizer: {
                email: "jserrano@meadowb.com",
                displayName: "Jorge Serrano",
                self: true,
              },
              creator: {
                email: "jserrano@meadowb.com",
                displayName: "Jorge Serrano",
                self: true,
              },
              conferenceData: {
                conferenceId: "wba-jzpm-hpw",
                conferenceSolution: { name: "Google Meet" },
                entryPoints: [
                  {
                    entryPointType: "video",
                    uri: "https://meet.google.com/wba-jzpm-hpw",
                    label: "meet.google.com/wba-jzpm-hpw",
                  },
                  {
                    entryPointType: "phone",
                    uri: "tel:+16477354272",
                    label: "(CA) +1 647-735-4272",
                    pin: "455 928 088#",
                    regionCode: "CA",
                  },
                  {
                    entryPointType: "more",
                    uri: "https://tel.meet/wba-jzpm-hpw",
                  },
                ],
              },
              reminders: {
                useDefault: false,
                overrides: [{ method: "popup", minutes: 10 }],
              },
              attendees: [
                {
                  email: "jserrano@meadowb.com",
                  displayName: "Jorge Serrano",
                  self: true,
                  organizer: true,
                  responseStatus: "accepted",
                },
                {
                  email: "jacky.lee@example.com",
                  displayName: "Jacky Lee",
                  responseStatus: "needsAction",
                },
              ],
              start: {
                dateTime: "2026-06-08T10:30:00-04:00",
                timeZone: "America/Toronto",
              },
              end: {
                dateTime: "2026-06-08T12:30:00-04:00",
                timeZone: "America/Toronto",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
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
      tokenScope: "https://www.googleapis.com/auth/calendar.events",
    });

    const result = await googleCalendar.listCalendarEventsFromGoogleCalendar("jserrano", {
      timeMinIso: "2026-06-08T04:00:00.000Z",
      timeMaxIso: "2026-06-09T04:00:00.000Z",
    });

    expect(result.calendarTimeZone).toBe("America/Toronto");
    expect(result.events).toEqual([
      expect.objectContaining({
        id: "google-event-1",
        summary: "H&S Toolbox talk for the week",
        location: "Boardroom",
        organizer: {
          email: "jserrano@meadowb.com",
          displayName: "Jorge Serrano",
          isSelf: true,
        },
        conference: expect.objectContaining({
          name: "Google Meet",
          conferenceId: "wba-jzpm-hpw",
          videoUri: "https://meet.google.com/wba-jzpm-hpw",
          phoneNumbers: [
            {
              label: "(CA) +1 647-735-4272",
              uri: "tel:+16477354272",
              pin: "455 928 088#",
              regionCode: "CA",
            },
          ],
          morePhoneNumbersUri: "https://tel.meet/wba-jzpm-hpw",
        }),
        recurrenceLabel: "Weekly on Monday",
        reminderLabel: "10 minutes before",
        isOrganizer: true,
        canReschedule: true,
      }),
    ]);
  });

  it("patches editable Google Calendar event details and schedule", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            id: "google-event-1",
            status: "confirmed",
            summary: "Updated toolbox talk",
            location: "Training room",
            description: "Updated agenda",
            htmlLink: "https://calendar.google.com/event?eid=abc",
            organizer: {
              email: "jserrano@meadowb.com",
              displayName: "Jorge Serrano",
              self: true,
            },
            start: {
              dateTime: "2026-06-08T15:00:00.000Z",
              timeZone: "America/Toronto",
            },
            end: {
              dateTime: "2026-06-08T16:00:00.000Z",
              timeZone: "America/Toronto",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      expect(url).toContain("/calendar/v3/calendars/primary/events/google-event-1");
      return new Response(
        JSON.stringify({
          id: "google-event-1",
          status: "confirmed",
          summary: "H&S Toolbox talk for the week",
          organizer: {
            email: "jserrano@meadowb.com",
            displayName: "Jorge Serrano",
            self: true,
          },
          start: {
            dateTime: "2026-06-08T14:30:00.000Z",
            timeZone: "America/Toronto",
          },
          end: {
            dateTime: "2026-06-08T16:30:00.000Z",
            timeZone: "America/Toronto",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
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
      tokenScope: "https://www.googleapis.com/auth/calendar.events",
    });

    const updated = await googleCalendar.updateCalendarEventInGoogleCalendar("jserrano", {
      eventId: "google-event-1",
      summary: "Updated toolbox talk",
      location: "Training room",
      description: "Updated agenda",
      start: { dateTime: "2026-06-08T15:00:00.000Z" },
      end: { dateTime: "2026-06-08T16:00:00.000Z" },
      attendees: [
        { email: "jacky.lee@example.com", displayName: "Jacky Lee" },
        { email: "new.guest@example.com" },
      ],
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"],
      reminders: { useDefault: false, minutes: 15 },
      colorId: "10",
      includeGoogleMeet: true,
      guestsCanModify: true,
      guestsCanInviteOthers: true,
      guestsCanSeeOtherGuests: false,
      transparency: "transparent",
      visibility: "private",
    });

    expect(updated.summary).toBe("Updated toolbox talk");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit];
    expect(String(patchUrl)).toContain("sendUpdates=all");
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.parse(String(patchInit.body))).toEqual({
      summary: "Updated toolbox talk",
      location: "Training room",
      description: "Updated agenda",
      attendees: [
        { email: "jacky.lee@example.com", displayName: "Jacky Lee" },
        { email: "new.guest@example.com" },
      ],
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"],
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 15 }],
      },
      colorId: "10",
      conferenceData: {
        createRequest: {
          requestId: expect.any(String) as string,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      guestsCanModify: true,
      guestsCanInviteOthers: true,
      guestsCanSeeOtherGuests: false,
      transparency: "transparent",
      visibility: "private",
      start: {
        dateTime: "2026-06-08T15:00:00.000Z",
        timeZone: "America/Toronto",
      },
      end: {
        dateTime: "2026-06-08T16:00:00.000Z",
        timeZone: "America/Toronto",
      },
    });
    expect(String(patchUrl)).toContain("conferenceDataVersion=1");
  });

  it("deletes a Google Calendar event with attendee updates enabled", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
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
      tokenScope: "https://www.googleapis.com/auth/calendar.events",
    });

    await googleCalendar.deleteCalendarEventInGoogleCalendar("jserrano", "google-event-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(deleteUrl)).toContain("/calendar/v3/calendars/primary/events/google-event-1");
    expect(String(deleteUrl)).toContain("sendUpdates=all");
    expect(deleteInit.method).toBe("DELETE");
  });
});
