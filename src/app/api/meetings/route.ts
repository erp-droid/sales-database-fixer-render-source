import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getStoredLoginName, requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { upsertMeetingAuditEvent } from "@/lib/audit-log-store";
import {
  createEvent,
  fetchContactById,
  readRecordIdentity,
  readWrappedScalarString,
  readWrappedString,
} from "@/lib/acumatica";
import {
  buildMeetingEventPayloadVariants,
  buildMeetingInviteAttendees,
  isMeetingOrganizerContactForLogin,
  type ResolvedMeetingContact,
} from "@/lib/meeting-create";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  createMeetingInviteInGoogleCalendar,
  deleteMeetingInviteFromGoogleCalendar,
  readGoogleCalendarInviteAuthority,
} from "@/lib/google-calendar";
import { upsertMeetingBooking } from "@/lib/meeting-bookings";
import { readBusinessAccountDetailFromReadModel } from "@/lib/read-model/accounts";
import { parseMeetingCreatePayload } from "@/lib/validation";
import type { MeetingCreateResponse } from "@/types/meeting-create";

function readContactDisplayName(record: unknown): string | null {
  const explicit =
    readWrappedString(record, "DisplayName") ||
    readWrappedString(record, "FullName") ||
    readWrappedString(record, "ContactName") ||
    readWrappedString(record, "Attention");
  if (explicit) {
    return explicit;
  }

  const composite = [
    readWrappedString(record, "FirstName"),
    readWrappedString(record, "MiddleName"),
    readWrappedString(record, "LastName"),
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
    .trim();

  return composite || null;
}

function readContactEmail(record: unknown): string | null {
  return readWrappedString(record, "Email") || readWrappedString(record, "EMail") || null;
}

function normalizeAttendeeContactIds(
  relatedContactId: number,
  attendeeContactIds: number[],
): number[] {
  return [...new Set([relatedContactId, ...attendeeContactIds])];
}

function normalizeAttendeeEmails(attendeeEmails: string[]): string[] {
  return [...new Set(attendeeEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

function uniqueContactIds(ids: Array<number | null | undefined>): number[] {
  return [...new Set(ids.filter((value): value is number => typeof value === "number"))];
}

function readEventIdentity(record: unknown): string | null {
  return (
    readRecordIdentity(record) ||
    readWrappedScalarString(record, "EventID") ||
    readWrappedScalarString(record, "TaskID") ||
    readWrappedScalarString(record, "NoteID") ||
    null
  );
}

function readContactLabel(contact: ResolvedMeetingContact): string {
  return contact.contactName?.trim() || contact.email?.trim() || `contact ${contact.contactId}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const meetingRequest = parseMeetingCreatePayload(body);
    const storedLoginName = getStoredLoginName(request);
    const inviteAuthority = readGoogleCalendarInviteAuthority(storedLoginName);
    const inviteContactIds = normalizeAttendeeContactIds(
      meetingRequest.relatedContactId,
      meetingRequest.attendeeContactIds,
    );
    const attendeeEmails = normalizeAttendeeEmails(meetingRequest.attendeeEmails);
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
      : null;
    const meetingSyncKey = randomUUID();
    const contactIdsToResolve = uniqueContactIds([
      ...inviteContactIds,
      normalizedRequest.includeOrganizerInAcumatica ? normalizedRequest.organizerContactId : null,
    ]);
    const resolvedContacts = new Map<number, ResolvedMeetingContact>();
    await Promise.all(
      contactIdsToResolve.map(async (contactId) => {
        const record = await fetchContactById(cookieValue, contactId, authCookieRefresh);
        const resolvedContact: ResolvedMeetingContact = {
          contactId,
          contactRecordId: readRecordIdentity(record),
          contactName: readContactDisplayName(record),
          email: readContactEmail(record),
        };
        resolvedContacts.set(contactId, resolvedContact);
        return resolvedContact;
      }),
    );
    const attendees: ResolvedMeetingContact[] = inviteContactIds.map((contactId) => {
      const contact = resolvedContacts.get(contactId);
      if (!contact) {
        throw new HttpError(502, `Unable to resolve attendee contact ${contactId} from Acumatica.`);
      }
      return contact;
    });
    const relatedContact =
      attendees.find((contact) => contact.contactId === normalizedRequest.relatedContactId) ?? null;
    const relatedContactRecordId = relatedContact?.contactRecordId ?? null;
    if (!relatedContactRecordId) {
      throw new HttpError(
        502,
        "Acumatica returned the related contact but did not include a record identity.",
      );
    }
    const warnings: string[] = [];
    let calendarEventId: string | null = null;
    let calendarInviteStatus: MeetingCreateResponse["calendarInviteStatus"] = "skipped";
    let connectedGoogleEmail: string | null = null;
    let organizerContact: ResolvedMeetingContact | null = null;
    if (normalizedRequest.includeOrganizerInAcumatica) {
      const organizerContactId = normalizedRequest.organizerContactId;
      if (organizerContactId === null) {
        throw new HttpError(400, "Selected organizer contact does not match the signed-in user.");
      }

      organizerContact = resolvedContacts.get(organizerContactId) ?? null;
      if (!organizerContact) {
        throw new HttpError(
          502,
          `Unable to resolve organizer contact ${organizerContactId} from Acumatica.`,
        );
      }

      if (!isMeetingOrganizerContactForLogin(organizerContact.email, storedLoginName)) {
        throw new HttpError(
          400,
          "Selected organizer contact does not match the signed-in user.",
        );
      }
    }
    const inviteAttendees = buildMeetingInviteAttendees({
      attendeeEmails: normalizedRequest.attendeeEmails,
      contacts: attendees,
    });
    const googleInviteAttendees = buildMeetingInviteAttendees({
      attendeeEmails: normalizedRequest.attendeeEmails,
      contacts:
        organizerContact && normalizedRequest.includeOrganizerInAcumatica
          ? [...attendees, organizerContact]
          : attendees,
    });
    const directInviteEmailCount =
      (organizerContact && normalizedRequest.includeOrganizerInAcumatica
        ? [...attendees, organizerContact]
        : attendees
      ).filter((contact) => Boolean(contact.email?.trim())).length +
      normalizedRequest.attendeeEmails.length;
    if (googleInviteAttendees.length < directInviteEmailCount) {
      warnings.push(
        "Duplicate attendee email addresses were collapsed so only one invite is sent per email.",
      );
    }

    if (inviteAuthority === "google") {
      const calendarResult = await createMeetingInviteInGoogleCalendar(storedLoginName, {
        acumaticaEventId: null,
        meetingSyncKey,
        attendees: googleInviteAttendees,
        businessAccountId: normalizedRequest.businessAccountId,
        companyName: meetingCompanyName,
        relatedContactId: normalizedRequest.relatedContactId,
        relatedContactName: relatedContact?.contactName ?? null,
        request: normalizedRequest,
      });
      calendarEventId = calendarResult.eventId;
      calendarInviteStatus = calendarResult.status;
      connectedGoogleEmail = calendarResult.connectedGoogleEmail;
    }

    let eventId: string;
    try {
      const createdEvent = await createEvent(
        cookieValue,
        buildMeetingEventPayloadVariants({
          attendees: inviteAuthority === "google" ? [] : inviteAttendees,
          relatedContactRecordId,
          request: normalizedRequest,
        }),
        authCookieRefresh,
      );

      eventId = readEventIdentity(createdEvent) ?? "";
      if (!eventId) {
        throw new HttpError(
          502,
          "Acumatica created the event but did not return an event identity.",
        );
      }
    } catch (error) {
      if (inviteAuthority === "google" && calendarEventId) {
        try {
          await deleteMeetingInviteFromGoogleCalendar(storedLoginName, calendarEventId);
        } catch (rollbackError) {
          throw new HttpError(
            error instanceof HttpError ? error.status : 500,
            `${getErrorMessage(error)} Google Calendar rollback also failed: ${getErrorMessage(rollbackError)}`,
          );
        }
      }

      throw error;
    }

    const acumaticaActivityContactIds = uniqueContactIds([
      ...inviteContactIds,
      normalizedRequest.includeOrganizerInAcumatica ? normalizedRequest.organizerContactId : null,
    ]);
    const mirroredContacts = acumaticaActivityContactIds
      .filter((contactId) => contactId !== normalizedRequest.relatedContactId)
      .map((contactId) => resolvedContacts.get(contactId) ?? null)
      .filter((contact): contact is ResolvedMeetingContact => contact !== null);

    for (const mirroredContact of mirroredContacts) {
      if (!mirroredContact.contactRecordId) {
        warnings.push(
          `Acumatica did not return a record identity for ${readContactLabel(mirroredContact)}, so no mirrored activity was written for that contact.`,
        );
        continue;
      }

      try {
        await createEvent(
          cookieValue,
          buildMeetingEventPayloadVariants({
            attendees: [],
            relatedContactRecordId: mirroredContact.contactRecordId,
            request: normalizedRequest,
          }),
          authCookieRefresh,
        );
      } catch (mirrorError) {
        warnings.push(
          `Unable to mirror the meeting activity for ${readContactLabel(mirroredContact)}: ${getErrorMessage(mirrorError)}`,
        );
      }
    }

    const responseBody: MeetingCreateResponse = {
      created: true,
      eventId,
      inviteAuthority,
      calendarEventId,
      calendarInviteStatus,
      connectedGoogleEmail,
      includeOrganizerInAcumatica: normalizedRequest.includeOrganizerInAcumatica,
      summary: normalizedRequest.summary,
      relatedContactId: normalizedRequest.relatedContactId,
      attendeeCount: inviteContactIds.length + attendeeEmails.length,
      warnings,
    };

    try {
      const storedBooking = upsertMeetingBooking({
        eventId,
        actorLoginName: storedLoginName,
        actorName: organizerContact?.contactName ?? storedLoginName ?? null,
        businessAccountRecordId: normalizedRequest.businessAccountRecordId,
        businessAccountId: normalizedRequest.businessAccountId,
        companyName: meetingCompanyName,
        relatedContactId: normalizedRequest.relatedContactId,
        relatedContactName: relatedContact?.contactName ?? null,
        meetingSummary: normalizedRequest.summary,
        attendeeCount: responseBody.attendeeCount,
        attendees:
          (inviteAuthority === "google" ? googleInviteAttendees : inviteAttendees).map((attendee) => ({
            contactId: attendee.contactId,
            contactName: attendee.contactName,
            email: attendee.email,
            businessAccountRecordId: null,
            businessAccountId: null,
            companyName: null,
          })),
        inviteAuthority,
        calendarInviteStatus,
      });
      upsertMeetingAuditEvent(storedBooking, { notifyReason: "meeting-create" });
    } catch (analyticsError) {
      warnings.push(
        `Meeting created, but dashboard analytics could not be updated: ${getErrorMessage(analyticsError)}`,
      );
    }

    const response = NextResponse.json(responseBody, { status: 201 });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid meeting create payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
