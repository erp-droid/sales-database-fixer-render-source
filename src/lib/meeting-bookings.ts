import type { AuthCookieRefreshState, RawEvent } from "@/lib/acumatica";
import {
  fetchEvents,
  readRecordIdentity,
  readWrappedNumber,
  readWrappedScalarString,
  readWrappedString,
} from "@/lib/acumatica";
import { invalidateDashboardSnapshotCache } from "@/lib/call-analytics/dashboard-cache";
import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { getReadModelDb } from "@/lib/read-model/db";
import { readEmployeeDirectorySnapshot } from "@/lib/read-model/employees";
import { ensureReadModelSchema } from "@/lib/read-model/schema";

export type StoredMeetingBooking = {
  id: string;
  eventId: string;
  actorLoginName: string | null;
  actorName: string | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  relatedContactId: number | null;
  relatedContactName: string | null;
  meetingSummary: string;
  attendeeCount: number;
  attendees: StoredMeetingAttendee[];
  inviteAuthority: "google" | "acumatica" | null;
  calendarInviteStatus: "created" | "updated" | "skipped" | "failed" | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredMeetingAttendee = {
  contactId: number | null;
  contactName: string | null;
  email: string | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
};

type UpsertMeetingBookingInput = {
  eventId: string;
  actorLoginName: string | null;
  actorName: string | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  relatedContactId: number | null;
  relatedContactName: string | null;
  meetingSummary: string;
  attendeeCount: number;
  attendees?: StoredMeetingAttendee[];
  inviteAuthority: "google" | "acumatica" | null;
  calendarInviteStatus: "created" | "updated" | "skipped" | "failed" | null;
  occurredAt?: string | null;
};

type HistoricalMeetingSyncResult = {
  fetchedEvents: number;
  storedMeetings: number;
};

type StoredMeetingBookingRow = {
  id: string;
  event_id: string;
  actor_login_name: string | null;
  actor_name: string | null;
  business_account_record_id: string | null;
  business_account_id: string | null;
  company_name: string | null;
  related_contact_id: number | null;
  related_contact_name: string | null;
  meeting_summary: string;
  attendee_count: number;
  attendee_details_json: string;
  invite_authority: string | null;
  calendar_invite_status: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

function cleanString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function normalizeLoginName(value: string | null | undefined): string | null {
  const normalized = cleanString(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }

  const atIndex = normalized.indexOf("@");
  return atIndex >= 0 ? normalized.slice(0, atIndex) || null : normalized;
}

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function hasText(value: string | null | undefined): value is string {
  return Boolean(cleanString(value));
}

function readEventText(event: RawEvent, key: string): string | null {
  return cleanString(readWrappedString(event, key) || readWrappedScalarString(event, key));
}

function readEventOccurredAt(event: RawEvent): string | null {
  return (
    readEventText(event, "CreatedDateTime") ||
    readEventText(event, "StartDate") ||
    readEventText(event, "LastModifiedDateTime") ||
    null
  );
}

function readEventSummary(event: RawEvent): string {
  return (
    readEventText(event, "Summary") ||
    readEventText(event, "Subject") ||
    "Meeting created"
  );
}

function readEventItems(event: RawEvent, key: string): unknown[] {
  const value = event[key];
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.value)) {
      return record.value;
    }
    if (Array.isArray(record.items)) {
      return record.items;
    }
  }

  return [];
}

function normalizeMeetingAttendee(
  attendee: Partial<StoredMeetingAttendee>,
): StoredMeetingAttendee | null {
  const contactId =
    typeof attendee.contactId === "number" && Number.isFinite(attendee.contactId)
      ? attendee.contactId
      : null;
  const contactName = cleanString(attendee.contactName);
  const email = cleanString(attendee.email)?.toLowerCase() ?? null;
  const businessAccountRecordId = cleanString(attendee.businessAccountRecordId);
  const businessAccountId = cleanString(attendee.businessAccountId);
  const companyName = cleanString(attendee.companyName);

  if (contactId === null && !contactName && !email) {
    return null;
  }

  return {
    contactId,
    contactName,
    email,
    businessAccountRecordId,
    businessAccountId,
    companyName,
  };
}

function dedupeMeetingAttendees(attendees: Array<Partial<StoredMeetingAttendee>>): StoredMeetingAttendee[] {
  const byKey = new Map<string, StoredMeetingAttendee>();

  for (const attendee of attendees) {
    const normalized = normalizeMeetingAttendee(attendee);
    if (!normalized) {
      continue;
    }

    const key = [
      normalized.contactId ?? "",
      normalized.email ?? "",
      normalized.contactName ?? "",
    ].join("|");
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
    }
  }

  return [...byKey.values()];
}

function readEventAttendees(event: RawEvent): StoredMeetingAttendee[] {
  const attendees = readEventItems(event, "Attendees");
  return dedupeMeetingAttendees(
    attendees.map((attendee) => ({
      contactId:
        readWrappedNumber(attendee, "ContactID") ??
        readWrappedNumber(attendee, "ContactId") ??
        null,
      contactName:
        readEventText(attendee as RawEvent, "ContactName") ??
        readEventText(attendee as RawEvent, "DisplayName") ??
        readEventText(attendee as RawEvent, "Name"),
      email:
        readEventText(attendee as RawEvent, "Email") ??
        readEventText(attendee as RawEvent, "EMail"),
      businessAccountId:
        readEventText(attendee as RawEvent, "BusinessAccountID") ??
        readEventText(attendee as RawEvent, "BusinessAccountId"),
      companyName:
        readEventText(attendee as RawEvent, "CompanyName") ??
        readEventText(attendee as RawEvent, "BusinessAccountName"),
    })),
  );
}

function readAttendeeDetailsJson(value: string | null | undefined): StoredMeetingAttendee[] {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return dedupeMeetingAttendees(parsed as Array<Partial<StoredMeetingAttendee>>);
  } catch {
    return [];
  }
}

function buildKnownEmployeeNamesByLogin(): Map<string, string> {
  const byLogin = new Map<string, string>();

  for (const employee of readCallEmployeeDirectory()) {
    const loginName = normalizeLoginName(employee.loginName);
    if (!loginName || !hasText(employee.displayName)) {
      continue;
    }

    if (!byLogin.has(loginName)) {
      byLogin.set(loginName, employee.displayName.trim());
    }
  }

  for (const employee of readEmployeeDirectorySnapshot().items) {
    const loginName =
      normalizeLoginName(employee.loginName) ?? normalizeLoginName(employee.email ?? null);
    if (!loginName || !hasText(employee.name)) {
      continue;
    }

    if (!byLogin.has(loginName)) {
      byLogin.set(loginName, employee.name.trim());
    }
  }

  return byLogin;
}

function mapHistoricalEventToMeetingBooking(
  event: RawEvent,
  employeeNamesByLogin: Map<string, string>,
): UpsertMeetingBookingInput | null {
  const eventId =
    cleanString(readRecordIdentity(event)) ??
    cleanString(readEventText(event, "EventID")) ??
    cleanString(readEventText(event, "TaskID"));
  if (!eventId) {
    return null;
  }

  const actorLoginName = normalizeLoginName(readEventText(event, "CreatedByID"));
  if (!actorLoginName || !employeeNamesByLogin.has(actorLoginName)) {
    return null;
  }

  const relatedEntityType = normalizeComparable(readEventText(event, "RelatedEntityType"));
  const relatedDescription = cleanString(readEventText(event, "RelatedEntityDescription"));
  const attendees = readEventAttendees(event);

  return {
    eventId,
    actorLoginName,
    actorName: employeeNamesByLogin.get(actorLoginName) ?? actorLoginName,
    businessAccountRecordId: null,
    businessAccountId: null,
    companyName:
      relatedEntityType.includes("businessaccount") || relatedEntityType.includes("customer")
        ? relatedDescription
        : null,
    relatedContactId: null,
    relatedContactName: relatedEntityType.includes("contact") ? relatedDescription : null,
    meetingSummary: readEventSummary(event),
    attendeeCount: attendees.length,
    attendees,
    inviteAuthority: null,
    calendarInviteStatus: null,
    occurredAt: readEventOccurredAt(event),
  };
}

function writeMeetingBookingUpsert(
  db: ReturnType<typeof getReadModelDb>,
  input: UpsertMeetingBookingInput,
): void {
  const now = new Date().toISOString();
  const occurredAt = cleanString(input.occurredAt) ?? now;
  const eventId = input.eventId.trim();
  if (!eventId) {
    throw new Error("Meeting booking event ID is required.");
  }

  const id = `meeting:${eventId}`;
  db.prepare(
    `
    INSERT INTO meeting_bookings (
      id,
      event_id,
      actor_login_name,
      actor_name,
      business_account_record_id,
      business_account_id,
      company_name,
      related_contact_id,
      related_contact_name,
      meeting_summary,
      attendee_count,
      attendee_details_json,
      invite_authority,
      calendar_invite_status,
      occurred_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @event_id,
      @actor_login_name,
      @actor_name,
      @business_account_record_id,
      @business_account_id,
      @company_name,
      @related_contact_id,
      @related_contact_name,
      @meeting_summary,
      @attendee_count,
      @attendee_details_json,
      @invite_authority,
      @calendar_invite_status,
      @occurred_at,
      COALESCE((SELECT created_at FROM meeting_bookings WHERE id = @id), @updated_at),
      @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      event_id = excluded.event_id,
      actor_login_name = excluded.actor_login_name,
      actor_name = excluded.actor_name,
      business_account_record_id = excluded.business_account_record_id,
      business_account_id = excluded.business_account_id,
      company_name = excluded.company_name,
      related_contact_id = excluded.related_contact_id,
      related_contact_name = excluded.related_contact_name,
      meeting_summary = excluded.meeting_summary,
      attendee_count = excluded.attendee_count,
      attendee_details_json = excluded.attendee_details_json,
      invite_authority = excluded.invite_authority,
      calendar_invite_status = excluded.calendar_invite_status,
      occurred_at = excluded.occurred_at,
      updated_at = excluded.updated_at
    `,
  ).run({
    id,
    event_id: eventId,
    actor_login_name: cleanString(input.actorLoginName)?.toLowerCase() ?? null,
    actor_name: cleanString(input.actorName),
    business_account_record_id: cleanString(input.businessAccountRecordId),
    business_account_id: cleanString(input.businessAccountId),
    company_name: cleanString(input.companyName),
    related_contact_id:
      typeof input.relatedContactId === "number" && Number.isFinite(input.relatedContactId)
        ? input.relatedContactId
        : null,
    related_contact_name: cleanString(input.relatedContactName),
    meeting_summary: cleanString(input.meetingSummary) ?? "Meeting created",
    attendee_count: Math.max(0, Math.trunc(input.attendeeCount)),
    attendee_details_json: JSON.stringify(dedupeMeetingAttendees(input.attendees ?? [])),
    invite_authority: input.inviteAuthority,
    calendar_invite_status: input.calendarInviteStatus,
    occurred_at: occurredAt,
    updated_at: now,
  });
}

export function replaceMeetingBookings(items: UpsertMeetingBookingInput[]): number {
  const db = getReadModelDb();
  ensureReadModelSchema(db);

  const replace = db.transaction((records: UpsertMeetingBookingInput[]) => {
    db.prepare("DELETE FROM meeting_bookings").run();
    for (const item of records) {
      writeMeetingBookingUpsert(db, item);
    }
  });

  replace(items);
  invalidateDashboardSnapshotCache();
  return items.length;
}

export async function syncMeetingBookings(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<HistoricalMeetingSyncResult> {
  const employeeNamesByLogin = buildKnownEmployeeNamesByLogin();
  const existingByEventId = new Map(
    listMeetingBookings().map((booking) => [booking.eventId, booking] as const),
  );
  const events = await fetchEvents(
    cookieValue,
    {
      batchSize: 200,
      filter: "CreatedByID ne null",
    },
    authCookieRefresh,
  );
  const bookings = events
    .map((event) => mapHistoricalEventToMeetingBooking(event, employeeNamesByLogin))
    .filter((item): item is UpsertMeetingBookingInput => item !== null)
    .map((item) => {
      const existing = existingByEventId.get(item.eventId);
      if (!existing) {
        return item;
      }

      return {
        ...item,
        businessAccountRecordId: item.businessAccountRecordId ?? existing.businessAccountRecordId,
        businessAccountId: item.businessAccountId ?? existing.businessAccountId,
        companyName: item.companyName ?? existing.companyName,
        relatedContactId: item.relatedContactId ?? existing.relatedContactId,
        relatedContactName: item.relatedContactName ?? existing.relatedContactName,
        attendeeCount: item.attendeeCount > 0 ? item.attendeeCount : existing.attendeeCount,
        attendees: item.attendees && item.attendees.length > 0 ? item.attendees : existing.attendees,
        inviteAuthority: item.inviteAuthority ?? existing.inviteAuthority,
        calendarInviteStatus: item.calendarInviteStatus ?? existing.calendarInviteStatus,
      };
    });

  replaceMeetingBookings(bookings);
  return {
    fetchedEvents: events.length,
    storedMeetings: bookings.length,
  };
}

function toStoredMeetingBooking(row: StoredMeetingBookingRow): StoredMeetingBooking {
  return {
    id: row.id,
    eventId: row.event_id,
    actorLoginName: row.actor_login_name,
    actorName: row.actor_name,
    businessAccountRecordId: row.business_account_record_id,
    businessAccountId: row.business_account_id,
    companyName: row.company_name,
    relatedContactId: row.related_contact_id,
    relatedContactName: row.related_contact_name,
    meetingSummary: row.meeting_summary,
    attendeeCount: Math.max(0, Number(row.attendee_count) || 0),
    attendees: readAttendeeDetailsJson(row.attendee_details_json),
    inviteAuthority:
      row.invite_authority === "google" || row.invite_authority === "acumatica"
        ? row.invite_authority
        : null,
    calendarInviteStatus:
      row.calendar_invite_status === "created" ||
      row.calendar_invite_status === "updated" ||
      row.calendar_invite_status === "skipped" ||
      row.calendar_invite_status === "failed"
        ? row.calendar_invite_status
        : null,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertMeetingBooking(input: UpsertMeetingBookingInput): StoredMeetingBooking {
  const db = getReadModelDb();
  ensureReadModelSchema(db);
  writeMeetingBookingUpsert(db, input);

  invalidateDashboardSnapshotCache();
  return getMeetingBookingById(`meeting:${input.eventId.trim()}`) as StoredMeetingBooking;
}

export function listMeetingBookings(): StoredMeetingBooking[] {
  const db = getReadModelDb();
  ensureReadModelSchema(db);
  return (
    db
      .prepare(
        `
        SELECT
          id,
          event_id,
          actor_login_name,
          actor_name,
          business_account_record_id,
          business_account_id,
          company_name,
          related_contact_id,
          related_contact_name,
          meeting_summary,
          attendee_count,
          attendee_details_json,
          invite_authority,
          calendar_invite_status,
          occurred_at,
          created_at,
          updated_at
        FROM meeting_bookings
        ORDER BY occurred_at DESC, id DESC
        `,
      )
      .all() as StoredMeetingBookingRow[]
  ).map(toStoredMeetingBooking);
}

export function getMeetingBookingById(id: string): StoredMeetingBooking | null {
  const db = getReadModelDb();
  ensureReadModelSchema(db);
  const row = db
    .prepare(
      `
      SELECT
        id,
        event_id,
        actor_login_name,
        actor_name,
        business_account_record_id,
        business_account_id,
        company_name,
        related_contact_id,
        related_contact_name,
        meeting_summary,
        attendee_count,
        attendee_details_json,
        invite_authority,
        calendar_invite_status,
        occurred_at,
        created_at,
        updated_at
      FROM meeting_bookings
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(id) as StoredMeetingBookingRow | undefined;

  return row ? toStoredMeetingBooking(row) : null;
}
