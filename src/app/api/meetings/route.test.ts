import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/errors";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const getStoredLoginName = vi.fn(() => "jserrano");
const createEvent = vi.fn();
const fetchContactById = vi.fn();
const createMeetingInviteInGoogleCalendar = vi.fn();
const deleteMeetingInviteFromGoogleCalendar = vi.fn();
const readGoogleCalendarInviteAuthority = vi.fn(() => "google");
const readRecordIdentity = vi.fn((record: Record<string, unknown>) => {
  const id = record.id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }

  const note = (record.NoteID as { value?: string } | undefined)?.value;
  return typeof note === "string" && note.trim() ? note.trim() : null;
});

vi.mock("@/lib/auth", () => ({
  getStoredLoginName,
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  createEvent,
  fetchContactById,
  readRecordIdentity,
  readWrappedScalarString: (
    record: Record<string, { value?: unknown }>,
    key: string,
  ) => {
    const value = record[key]?.value;
    return typeof value === "string" && value.trim() ? value.trim() : "";
  },
  readWrappedString: (
    record: Record<string, { value?: unknown }>,
    key: string,
  ) => {
    const value = record[key]?.value;
    return typeof value === "string" && value.trim() ? value.trim() : "";
  },
}));

vi.mock("@/lib/google-calendar", () => ({
  createMeetingInviteInGoogleCalendar,
  deleteMeetingInviteFromGoogleCalendar,
  readGoogleCalendarInviteAuthority,
}));

function buildRequest(
  overrides: Record<string, unknown> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/meetings", {
    method: "POST",
    body: JSON.stringify({
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      sourceContactId: 157497,
      organizerContactId: 157499,
      includeOrganizerInAcumatica: true,
      relatedContactId: 157497,
      summary: "Operations sync",
      location: "Boardroom",
      timeZone: "America/Toronto",
      startDate: "2026-03-11",
      startTime: "09:00",
      endDate: "2026-03-11",
      endTime: "10:00",
      priority: "Normal",
      details: "Review open items.",
      attendeeContactIds: [157498, 157497, 157498],
      attendeeEmails: ["amy.vega@example.com", "guest@example.com"],
      ...overrides,
    }),
    headers: {
      "content-type": "application/json",
    },
  });
}

function buildContactRecord(input: {
  contactId: number;
  displayName: string;
  email: string | null;
}): Record<string, unknown> {
  return {
    id: `contact-note-${input.contactId}`,
    ContactID: { value: input.contactId },
    DisplayName: { value: input.displayName },
    Email: { value: input.email },
  };
}

describe("POST /api/meetings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("jserrano");
    readGoogleCalendarInviteAuthority.mockReturnValue("google");
    fetchContactById.mockImplementation(async (_cookie: string, contactId: number) => {
      if (contactId === 157497) {
        return buildContactRecord({
          contactId,
          displayName: "Jacky Lee",
          email: "jacky.lee@example.com",
        });
      }
      if (contactId === 157498) {
        return buildContactRecord({
          contactId,
          displayName: "Amy Vega",
          email: "amy.vega@example.com",
        });
      }
      if (contactId === 157499) {
        return buildContactRecord({
          contactId,
          displayName: "Jorge Serrano",
          email: "jserrano@meadowb.com",
        });
      }

      return buildContactRecord({
        contactId,
        displayName: `Contact ${contactId}`,
        email: null,
      });
    });
  });

  it("uses Google as the invite authority, includes the organizer in Google attendees, and omits attendees from the primary Acumatica event", async () => {
    createMeetingInviteInGoogleCalendar.mockResolvedValue({
      status: "created",
      eventId: "google-event-1",
      connectedGoogleEmail: "jserrano@gmail.com",
    });
    createEvent
      .mockResolvedValueOnce({
        id: "event-note-1",
        EventID: { value: "EV0001" },
      })
      .mockResolvedValue({
        id: "event-note-mirror",
        EventID: { value: "EV0002" },
      });

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      created: true,
      eventId: "event-note-1",
      inviteAuthority: "google",
      calendarEventId: "google-event-1",
      calendarInviteStatus: "created",
      connectedGoogleEmail: "jserrano@gmail.com",
      includeOrganizerInAcumatica: true,
      summary: "Operations sync",
      relatedContactId: 157497,
      attendeeCount: 4,
      warnings: [
        "Duplicate attendee email addresses were collapsed so only one invite is sent per email.",
      ],
    });
    expect(createMeetingInviteInGoogleCalendar).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        attendees: [
          expect.objectContaining({ contactId: 157497, email: "jacky.lee@example.com" }),
          expect.objectContaining({ contactId: 157498, email: "amy.vega@example.com" }),
          expect.objectContaining({ contactId: 157499, email: "jserrano@meadowb.com" }),
          expect.objectContaining({ contactId: null, email: "guest@example.com" }),
        ],
        acumaticaEventId: null,
      }),
    );
    expect(createEvent).toHaveBeenCalledTimes(3);

    const primaryPayloadVariants = createEvent.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(primaryPayloadVariants[0]).not.toHaveProperty("Attendees");

    const firstMirrorPayload = createEvent.mock.calls[1]?.[1] as Array<Record<string, unknown>>;
    const secondMirrorPayload = createEvent.mock.calls[2]?.[1] as Array<Record<string, unknown>>;
    expect(firstMirrorPayload[0]).not.toHaveProperty("Attendees");
    expect(secondMirrorPayload[0]).not.toHaveProperty("Attendees");
  });

  it("falls back to Acumatica invite sending when Google is not connected", async () => {
    readGoogleCalendarInviteAuthority.mockReturnValue("acumatica");
    createEvent
      .mockResolvedValueOnce({
        id: "event-note-1",
        EventID: { value: "EV0001" },
      })
      .mockResolvedValue({
        id: "event-note-mirror",
        EventID: { value: "EV0002" },
      });

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toEqual(
      expect.objectContaining({
        inviteAuthority: "acumatica",
        calendarEventId: null,
        calendarInviteStatus: "skipped",
        connectedGoogleEmail: null,
      }),
    );
    expect(createMeetingInviteInGoogleCalendar).not.toHaveBeenCalled();

    const primaryPayloadVariants = createEvent.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(primaryPayloadVariants[0]?.Attendees).toHaveLength(3);
  });

  it("rejects organizer contacts that do not match the signed-in user", async () => {
    fetchContactById.mockImplementation(async (_cookie: string, contactId: number) => {
      if (contactId === 157499) {
        return buildContactRecord({
          contactId,
          displayName: "Wrong Person",
          email: "wrong.person@example.com",
        });
      }

      return buildContactRecord({
        contactId,
        displayName: `Contact ${contactId}`,
        email: `contact${contactId}@example.com`,
      });
    });

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Selected organizer contact does not match the signed-in user.");
    expect(createMeetingInviteInGoogleCalendar).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("fails before Acumatica writes when Google invite creation fails", async () => {
    createMeetingInviteInGoogleCalendar.mockRejectedValue(
      new HttpError(502, "Unable to create the Google Calendar invite."),
    );

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toBe("Unable to create the Google Calendar invite.");
    expect(createEvent).not.toHaveBeenCalled();
    expect(deleteMeetingInviteFromGoogleCalendar).not.toHaveBeenCalled();
  });

  it("rolls back the Google invite when the primary Acumatica event create fails", async () => {
    createMeetingInviteInGoogleCalendar.mockResolvedValue({
      status: "created",
      eventId: "google-event-1",
      connectedGoogleEmail: "jserrano@gmail.com",
    });
    createEvent.mockRejectedValue(new HttpError(422, "Event create failed."));

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(payload.error).toBe("Event create failed.");
    expect(deleteMeetingInviteFromGoogleCalendar).toHaveBeenCalledWith(
      "jserrano",
      "google-event-1",
    );
  });
});
