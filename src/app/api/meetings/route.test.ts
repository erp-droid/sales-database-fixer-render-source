import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/errors";
import type { BusinessAccountRow } from "@/types/business-account";

const requireStoredLoginName = vi.fn(() => "jserrano");
const createMeetingInviteInGoogleCalendar = vi.fn();
const upsertMeetingBooking = vi.fn();
const upsertMeetingAuditEvent = vi.fn();
const readAllAccountRowsFromReadModel = vi.fn();
const readBusinessAccountDetailFromReadModel = vi.fn(() => ({
  row: {
    companyName: "Alpha Foods",
  },
}));
const markReadModelCalendarInviteSent = vi.fn(() => 1);
const publishBusinessAccountChanged = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireStoredLoginName,
}));

vi.mock("@/lib/google-calendar", () => ({
  createMeetingInviteInGoogleCalendar,
}));

vi.mock("@/lib/meeting-bookings", () => ({
  upsertMeetingBooking,
}));

vi.mock("@/lib/audit-log-store", () => ({
  upsertMeetingAuditEvent,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  markReadModelCalendarInviteSent,
  readAllAccountRowsFromReadModel,
  readBusinessAccountDetailFromReadModel,
}));

vi.mock("@/lib/business-account-live", () => ({
  publishBusinessAccountChanged,
}));

function buildAccountRow(input: {
  contactId: number;
  contactName: string;
  email: string | null;
  companyName?: string;
}): BusinessAccountRow {
  return {
    id: "record-1",
    accountRecordId: "record-1",
    rowKey: `record-1:contact:${input.contactId}`,
    contactId: input.contactId,
    isPrimaryContact: input.contactId === 157497,
    marketingEligible: true,
    companyPhone: "416-555-0100",
    companyPhoneSource: "account",
    phoneNumber: "416-555-0100",
    salesRepId: "JS",
    salesRepName: "Jorge Serrano",
    accountType: "Customer",
    opportunityCount: 0,
    industryType: "Manufacturing",
    subCategory: "General",
    companyRegion: "Region 1",
    week: "Week 1",
    businessAccountId: "BA0001",
    companyName: input.companyName ?? "Alpha Foods",
    companyDescription: null,
    address: "1 Main St, Toronto ON M5J 1A1, CA",
    addressLine1: "1 Main St",
    addressLine2: "",
    city: "Toronto",
    state: "ON",
    postalCode: "M5J 1A1",
    country: "CA",
    primaryContactName: input.contactName,
    primaryContactJobTitle: "Operations",
    primaryContactPhone: "416-555-0101",
    primaryContactExtension: null,
    primaryContactRawPhone: "4165550101",
    primaryContactEmail: input.email,
    primaryContactId: input.contactId,
    category: "A",
    notes: null,
    lastCalledAt: null,
    lastCalendarInvitedAt: null,
    lastEmailedAt: null,
    lastModifiedIso: "2026-03-11T12:00:00.000Z",
  };
}

function buildRequestPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    businessAccountRecordId: "record-1",
    businessAccountId: "BA0001",
    sourceContactId: 157497,
    organizerContactId: 157499,
    includeOrganizerInAcumatica: true,
    relatedContactId: 157497,
    category: "Meeting",
    summary: "Operations sync",
    location: "Boardroom",
    timeZone: "America/Toronto",
    startDate: "2026-03-11",
    startTime: "09:00",
    endDate: "2026-03-11",
    endTime: "10:00",
    priority: "Normal",
    details: "Review open items.",
    privateNotes: "Internal prep only.",
    includeGoogleMeet: true,
    attachmentLinks: ["https://drive.google.com/file/d/abc/view"],
    attendeeContactIds: [157498, 157497, 157498],
    attendeeEmails: ["amy.vega@example.com", "guest@example.com"],
    ...overrides,
  };
}

function buildRequest(
  overrides: Record<string, unknown> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/meetings", {
    method: "POST",
    body: JSON.stringify(buildRequestPayload(overrides)),
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("POST /api/meetings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireStoredLoginName.mockReturnValue("jserrano");
    readAllAccountRowsFromReadModel.mockReturnValue([
      buildAccountRow({
        contactId: 157497,
        contactName: "Jacky Lee",
        email: "jacky.lee@example.com",
      }),
      buildAccountRow({
        contactId: 157498,
        contactName: "Amy Vega",
        email: "amy.vega@example.com",
      }),
      buildAccountRow({
        contactId: 157499,
        contactName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        companyName: "MeadowBrook",
      }),
    ]);
    markReadModelCalendarInviteSent.mockReturnValue(1);
    upsertMeetingBooking.mockImplementation((input: Record<string, unknown>) => ({
      id: `meeting:${String(input.eventId)}`,
      eventId: String(input.eventId),
      actorLoginName: input.actorLoginName,
      actorName: input.actorName,
      businessAccountRecordId: input.businessAccountRecordId,
      businessAccountId: input.businessAccountId,
      companyName: input.companyName,
      relatedContactId: input.relatedContactId,
      relatedContactName: input.relatedContactName,
      category: input.category,
      meetingSummary: input.meetingSummary,
      privateNotes: input.privateNotes,
      attendeeCount: input.attendeeCount,
      attendees: input.attendees,
      inviteAuthority: input.inviteAuthority,
      calendarInviteStatus: input.calendarInviteStatus,
      occurredAt: "2026-03-11T14:00:00.000Z",
      createdAt: "2026-03-11T14:00:00.000Z",
      updatedAt: "2026-03-11T14:00:00.000Z",
    }));
  });

  it("requires Google Calendar, creates the Google invite, then stores the app meeting", async () => {
    createMeetingInviteInGoogleCalendar.mockResolvedValue({
      status: "created",
      eventId: "google-event-1",
      connectedGoogleEmail: "jserrano@gmail.com",
    });

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      created: true,
      eventId: "google:google-event-1",
      category: "Meeting",
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
        request: expect.objectContaining({
          includeGoogleMeet: true,
          privateNotes: "Internal prep only.",
          attachmentLinks: ["https://drive.google.com/file/d/abc/view"],
        }),
      }),
    );
    expect(upsertMeetingBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "google:google-event-1",
        actorLoginName: "jserrano",
        actorName: "Jorge Serrano",
        relatedContactId: 157497,
        relatedContactName: "Jacky Lee",
        category: "Meeting",
        meetingSummary: "Operations sync",
        privateNotes: "Internal prep only.",
        attendeeCount: 4,
        inviteAuthority: "google",
        calendarInviteStatus: "created",
      }),
    );
    expect(upsertMeetingAuditEvent).toHaveBeenCalledTimes(1);
    expect(markReadModelCalendarInviteSent).toHaveBeenCalledWith({
      contactIds: [157497, 157498, 157499],
    });
    expect(publishBusinessAccountChanged).toHaveBeenCalledWith({
      accountRecordId: "record-1",
      businessAccountId: "BA0001",
      targetContactId: 157497,
      reason: "calendar-invite-sent",
    });
  });

  it("passes multipart attachment files to the Google invite creator", async () => {
    createMeetingInviteInGoogleCalendar.mockResolvedValue({
      status: "created",
      eventId: "google-event-1",
      connectedGoogleEmail: "jserrano@gmail.com",
    });

    const formData = new FormData();
    formData.append(
      "payload",
      JSON.stringify(buildRequestPayload({ attachmentLinks: [] })),
    );
    formData.append(
      "attachments",
      new File([Buffer.from("agenda")], "agenda.pdf", { type: "application/pdf" }),
    );

    const { POST } = await import("@/app/api/meetings/route");
    const response = await POST(
      new NextRequest("http://localhost/api/meetings", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(createMeetingInviteInGoogleCalendar).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        attachmentFiles: [
          expect.objectContaining({
            data: expect.any(Buffer),
            fileName: "agenda.pdf",
            mimeType: "application/pdf",
            sizeBytes: 6,
          }),
        ],
        request: expect.objectContaining({
          attachmentLinks: [],
        }),
      }),
    );
  });

  it("does not create a local app meeting when Google Calendar is not connected", async () => {
    createMeetingInviteInGoogleCalendar.mockRejectedValue(
      new HttpError(
        409,
        "Google Calendar is not connected for this account. Connect Google Calendar and try again.",
      ),
    );

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toBe(
      "Google Calendar is not connected for this account. Connect Google Calendar and try again.",
    );
    expect(upsertMeetingBooking).not.toHaveBeenCalled();
    expect(upsertMeetingAuditEvent).not.toHaveBeenCalled();
    expect(markReadModelCalendarInviteSent).not.toHaveBeenCalled();
  });

  it("allows direct email invites without a selected app contact", async () => {
    createMeetingInviteInGoogleCalendar.mockResolvedValue({
      status: "created",
      eventId: "google-event-direct",
      connectedGoogleEmail: "jserrano@gmail.com",
    });

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(
      buildRequest({
        sourceContactId: null,
        organizerContactId: null,
        includeOrganizerInAcumatica: false,
        relatedContactId: null,
        attendeeContactIds: [],
        attendeeEmails: ["external@example.com"],
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toEqual(
      expect.objectContaining({
        eventId: "google:google-event-direct",
        relatedContactId: null,
        attendeeCount: 1,
      }),
    );
    expect(createMeetingInviteInGoogleCalendar).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        attendees: [
          expect.objectContaining({ contactId: null, email: "external@example.com" }),
        ],
        relatedContactId: null,
        relatedContactName: null,
      }),
    );
    expect(markReadModelCalendarInviteSent).toHaveBeenCalledWith({ contactIds: [] });
  });

  it("excludes the related contact from the invite when includeRelatedContactInInvite is false", async () => {
    createMeetingInviteInGoogleCalendar.mockResolvedValue({
      status: "created",
      eventId: "google-event-2",
      connectedGoogleEmail: "jserrano@gmail.com",
    });

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(
      buildRequest({
        includeRelatedContactInInvite: false,
        includeOrganizerInAcumatica: false,
        organizerContactId: null,
        attendeeContactIds: [157498, 157497],
        attendeeEmails: [],
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(payload).toEqual(
      expect.objectContaining({
        relatedContactId: 157497,
        attendeeCount: 1,
      }),
    );
    expect(createMeetingInviteInGoogleCalendar).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        attendees: [
          expect.objectContaining({ contactId: 157498, email: "amy.vega@example.com" }),
        ],
        relatedContactId: 157497,
        relatedContactName: "Jacky Lee",
      }),
    );
  });

  it("normalizes messy attendee emails and reports unusable ones specifically", async () => {
    createMeetingInviteInGoogleCalendar.mockResolvedValue({
      status: "created",
      eventId: "google-event-3",
      connectedGoogleEmail: "jserrano@gmail.com",
    });

    const { POST } = await import("@/app/api/meetings/route");

    const messyResponse = await POST(
      buildRequest({
        includeOrganizerInAcumatica: false,
        organizerContactId: null,
        attendeeContactIds: [],
        relatedContactId: null,
        attendeeEmails: ["Alex Buhagiar <abuhagiar@meadowb.com>"],
      }),
    );
    expect(messyResponse.status).toBe(201);
    expect(createMeetingInviteInGoogleCalendar).toHaveBeenCalledWith(
      "jserrano",
      expect.objectContaining({
        attendees: [expect.objectContaining({ email: "abuhagiar@meadowb.com" })],
      }),
    );

    const invalidResponse = await POST(
      buildRequest({
        attendeeEmails: ["Alex Buhagiar"],
      }),
    );
    const invalidPayload = (await invalidResponse.json()) as {
      error: string;
      details: { fieldErrors: Record<string, string[]> };
    };

    expect(invalidResponse.status).toBe(400);
    expect(invalidPayload.error).toContain('"Alex Buhagiar" is not a valid email address');
    expect(invalidPayload.details.fieldErrors.attendeeEmails?.[0]).toContain(
      "is not a valid email address",
    );
    expect(upsertMeetingBooking).toHaveBeenCalledTimes(1);
  });

  it("fails before local storage when Google invite creation fails", async () => {
    createMeetingInviteInGoogleCalendar.mockRejectedValue(
      new HttpError(502, "Unable to create the Google Calendar invite."),
    );

    const { POST } = await import("@/app/api/meetings/route");

    const response = await POST(buildRequest());
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toBe("Unable to create the Google Calendar invite.");
    expect(upsertMeetingBooking).not.toHaveBeenCalled();
    expect(upsertMeetingAuditEvent).not.toHaveBeenCalled();
    expect(markReadModelCalendarInviteSent).not.toHaveBeenCalled();
  });
});
