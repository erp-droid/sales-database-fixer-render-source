import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireStoredLoginName } from "@/lib/auth";
import { upsertMeetingAuditEvent } from "@/lib/audit-log-store";
import { publishBusinessAccountChanged } from "@/lib/business-account-live";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  createMeetingInviteInGoogleCalendar,
  type GoogleCalendarAttachmentUploadInput,
} from "@/lib/google-calendar";
import {
  buildMeetingContactOptionsFromRows,
  buildMeetingInviteAttendees,
  findMeetingContactByLoginName,
  isMeetingOrganizerContactForLogin,
  type ResolvedMeetingContact,
} from "@/lib/meeting-create";
import { upsertMeetingBooking } from "@/lib/meeting-bookings";
import {
  markReadModelCalendarInviteSent,
  readAllAccountRowsFromReadModel,
  readBusinessAccountDetailFromReadModel,
} from "@/lib/read-model/accounts";
import { parseMeetingCreatePayload } from "@/lib/validation";
import type { MeetingContactOption, MeetingCreateResponse } from "@/types/meeting-create";

const MAX_MEETING_ATTACHMENT_FILES = 5;
const MAX_MEETING_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_MEETING_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

function normalizeAttendeeContactIds(
  relatedContactId: number | null,
  attendeeContactIds: number[],
): number[] {
  return [
    ...new Set(
      [
        relatedContactId,
        ...attendeeContactIds,
      ].filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ),
  ];
}

function normalizeAttendeeEmails(attendeeEmails: string[]): string[] {
  return [...new Set(attendeeEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

function uniqueContactIds(ids: Array<number | null | undefined>): number[] {
  return [...new Set(ids.filter((value): value is number => typeof value === "number"))];
}

function toResolvedMeetingContact(contact: MeetingContactOption): ResolvedMeetingContact {
  return {
    contactId: contact.contactId,
    contactRecordId: null,
    contactName: contact.contactName,
    email: contact.email,
  };
}

function readContactLabel(contact: MeetingContactOption | ResolvedMeetingContact | null): string | null {
  if (!contact) {
    return null;
  }

  return contact.contactName?.trim() || contact.email?.trim() || null;
}

function isMultipartRequest(request: NextRequest): boolean {
  return (request.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("multipart/form-data");
}

async function readMeetingAttachmentFiles(
  formData: FormData,
): Promise<GoogleCalendarAttachmentUploadInput[]> {
  const rawFiles = formData.getAll("attachments");
  const files = rawFiles.filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > MAX_MEETING_ATTACHMENT_FILES) {
    throw new HttpError(
      400,
      `You can attach up to ${MAX_MEETING_ATTACHMENT_FILES} files to a calendar invite.`,
    );
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_MEETING_ATTACHMENT_TOTAL_BYTES) {
    throw new HttpError(400, "Calendar invite attachments are too large.");
  }

  return Promise.all(
    files.map(async (file) => {
      if (file.size > MAX_MEETING_ATTACHMENT_BYTES) {
        throw new HttpError(400, `${file.name || "Attachment"} is too large.`);
      }

      return {
        data: Buffer.from(await file.arrayBuffer()),
        fileName: file.name || "Meeting attachment",
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      };
    }),
  );
}

async function readMeetingCreateInput(request: NextRequest): Promise<{
  attachmentFiles: GoogleCalendarAttachmentUploadInput[];
  body: unknown;
}> {
  if (!isMultipartRequest(request)) {
    return {
      attachmentFiles: [],
      body: await request.json().catch(() => {
        throw new HttpError(400, "Request body must be valid JSON.");
      }),
    };
  }

  const formData = await request.formData().catch(() => {
    throw new HttpError(400, "Request body must be valid form data.");
  });
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    throw new HttpError(400, "Meeting payload is required.");
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    throw new HttpError(400, "Meeting payload must be valid JSON.");
  }

  return {
    attachmentFiles: await readMeetingAttachmentFiles(formData),
    body,
  };
}

function requireGoogleCalendarResult(
  result: Awaited<ReturnType<typeof createMeetingInviteInGoogleCalendar>>,
): {
  calendarEventId: string;
  calendarInviteStatus: Extract<MeetingCreateResponse["calendarInviteStatus"], "created">;
  connectedGoogleEmail: string;
} {
  return {
    calendarEventId: result.eventId,
    calendarInviteStatus: result.status,
    connectedGoogleEmail: result.connectedGoogleEmail,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const storedLoginName = requireStoredLoginName(request);
    const { body, attachmentFiles } = await readMeetingCreateInput(request);
    const meetingRequest = parseMeetingCreatePayload(body);
    const allRows = readAllAccountRowsFromReadModel();
    const contactOptions = buildMeetingContactOptionsFromRows(allRows);
    const contactById = new Map(contactOptions.map((contact) => [contact.contactId, contact]));
    const inviteContactIds = normalizeAttendeeContactIds(
      meetingRequest.relatedContactId,
      meetingRequest.attendeeContactIds,
    );
    const attendeeEmails = normalizeAttendeeEmails(meetingRequest.attendeeEmails);
    const resolvedContacts = inviteContactIds
      .map((contactId) => contactById.get(contactId) ?? null)
      .filter((contact): contact is MeetingContactOption => contact !== null);
    const missingContactIds = inviteContactIds.filter((contactId) => !contactById.has(contactId));
    const relatedContact =
      meetingRequest.relatedContactId !== null
        ? contactById.get(meetingRequest.relatedContactId) ?? null
        : null;
    const viewerContact = findMeetingContactByLoginName(contactOptions, storedLoginName);
    const includeOrganizerInInvite =
      meetingRequest.includeOrganizerInAcumatica && viewerContact !== null;
    if (
      meetingRequest.includeOrganizerInAcumatica &&
      viewerContact &&
      !isMeetingOrganizerContactForLogin(viewerContact.email, storedLoginName)
    ) {
      throw new HttpError(
        400,
        "Selected organizer contact does not match the signed-in user.",
      );
    }

    const normalizedRequest = {
      ...meetingRequest,
      attendeeContactIds: inviteContactIds,
      attendeeEmails,
    };
    const meetingCompanyName = normalizedRequest.businessAccountRecordId
      ? readBusinessAccountDetailFromReadModel(
          normalizedRequest.businessAccountRecordId,
          normalizedRequest.relatedContactId,
        )?.row.companyName ?? null
      : relatedContact?.companyName ?? null;
    const meetingSyncKey = randomUUID();
    const googleInviteAttendees = buildMeetingInviteAttendees({
      attendeeEmails: normalizedRequest.attendeeEmails,
      contacts: [
        ...resolvedContacts.map(toResolvedMeetingContact),
        ...(includeOrganizerInInvite && viewerContact ? [toResolvedMeetingContact(viewerContact)] : []),
      ],
    });
    const directInviteEmailCount =
      resolvedContacts.filter((contact) => Boolean(contact.email?.trim())).length +
      (includeOrganizerInInvite && viewerContact?.email ? 1 : 0) +
      normalizedRequest.attendeeEmails.length;
    const warnings: string[] = [];
    if (missingContactIds.length > 0) {
      warnings.push(
        `Some selected app contacts were no longer available and were skipped: ${missingContactIds.join(", ")}.`,
      );
    }
    if (googleInviteAttendees.length < directInviteEmailCount) {
      warnings.push(
        "Duplicate attendee email addresses were collapsed so only one invite is sent per email.",
      );
    }

    const calendarResult = requireGoogleCalendarResult(
      await createMeetingInviteInGoogleCalendar(storedLoginName, {
        acumaticaEventId: null,
        meetingSyncKey,
        attendees: googleInviteAttendees,
        attachmentFiles,
        businessAccountId: normalizedRequest.businessAccountId,
        companyName: meetingCompanyName,
        relatedContactId: normalizedRequest.relatedContactId,
        relatedContactName: readContactLabel(relatedContact),
        request: normalizedRequest,
      }),
    );

    const eventId = `google:${calendarResult.calendarEventId}`;
    const attendeeCount = googleInviteAttendees.length;
    const responseBody: MeetingCreateResponse = {
      created: true,
      eventId,
      category: normalizedRequest.category,
      inviteAuthority: "google",
      calendarEventId: calendarResult.calendarEventId,
      calendarInviteStatus: calendarResult.calendarInviteStatus,
      connectedGoogleEmail: calendarResult.connectedGoogleEmail,
      includeOrganizerInAcumatica: includeOrganizerInInvite,
      summary: normalizedRequest.summary,
      relatedContactId: normalizedRequest.relatedContactId,
      attendeeCount,
      warnings,
    };

    try {
      const storedBooking = upsertMeetingBooking({
        eventId,
        actorLoginName: storedLoginName,
        actorName: readContactLabel(viewerContact) ?? storedLoginName ?? null,
        businessAccountRecordId: normalizedRequest.businessAccountRecordId,
        businessAccountId: normalizedRequest.businessAccountId,
        companyName: meetingCompanyName,
        relatedContactId: normalizedRequest.relatedContactId,
        relatedContactName: readContactLabel(relatedContact),
        category: normalizedRequest.category,
        meetingSummary: normalizedRequest.summary,
        privateNotes: normalizedRequest.privateNotes,
        attendeeCount,
        attendees: googleInviteAttendees.map((attendee) => ({
          contactId: attendee.contactId,
          contactName: attendee.contactName,
          email: attendee.email,
          businessAccountRecordId: null,
          businessAccountId: null,
          companyName: null,
        })),
        inviteAuthority: "google",
        calendarInviteStatus: calendarResult.calendarInviteStatus,
      });
      upsertMeetingAuditEvent(storedBooking, { notifyReason: "meeting-create" });
    } catch (analyticsError) {
      warnings.push(
        `Google Calendar invite was created, but local meeting analytics could not be updated: ${getErrorMessage(analyticsError)}`,
      );
    }

    try {
      const invitedContactIds = uniqueContactIds(googleInviteAttendees.map((attendee) => attendee.contactId));
      const inviteTimestampUpdates = markReadModelCalendarInviteSent({
        contactIds: invitedContactIds,
      });

      if (inviteTimestampUpdates > 0 && normalizedRequest.businessAccountRecordId) {
        publishBusinessAccountChanged({
          accountRecordId: normalizedRequest.businessAccountRecordId,
          businessAccountId: normalizedRequest.businessAccountId,
          targetContactId: normalizedRequest.relatedContactId,
          reason: "calendar-invite-sent",
        });
      }
    } catch (inviteTimestampError) {
      warnings.push(
        `Google Calendar invite was created, but local invite timestamp could not be updated: ${getErrorMessage(inviteTimestampError)}`,
      );
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid meeting create payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }
    if (error instanceof HttpError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
