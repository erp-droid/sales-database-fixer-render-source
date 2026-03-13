import type { BusinessAccountRow } from "@/types/business-account";
import type {
  MeetingAccountOption,
  MeetingContactOption,
  MeetingCreateOptionsResponse,
  MeetingCreateRequest,
} from "@/types/meeting-create";
import {
  isExcludedInternalCompanyName,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";

export const DEFAULT_MEETING_TIME_ZONE = "America/Toronto";

export type ResolvedMeetingContact = {
  contactId: number;
  contactRecordId: string | null;
  contactName: string | null;
  email: string | null;
};

export type ResolvedMeetingInviteAttendee = {
  contactId: number | null;
  contactRecordId: string | null;
  contactName: string | null;
  email: string;
};

type MeetingEventPayloadVariant = {
  attendeeFieldMode: "contact" | "contactId" | "email";
  dateFieldMode: "date" | "dateTime";
  detailsField: "Body" | "Description";
  relatedEntityTypeValue: "Contact" | "PX.Objects.CR.Contact";
  relatedEntityField: "RelatedEntity" | "RelatedEntityNoteID";
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function normalizeMeetingEmail(value: string | null | undefined): string | null {
  const normalized = normalizeComparable(value);
  return normalized || null;
}

export function normalizeMeetingLoginName(value: string | null | undefined): string | null {
  const comparable = normalizeComparable(value);
  if (!comparable) {
    return null;
  }

  const atIndex = comparable.indexOf("@");
  return atIndex >= 0 ? comparable.slice(0, atIndex) || null : comparable;
}

function readMeetingContactEmailLocalPart(value: string | null | undefined): string | null {
  const comparable = normalizeMeetingEmail(value);
  if (!comparable) {
    return null;
  }

  const [localPart] = comparable.split("@");
  return localPart || null;
}

export function findMeetingContactByLoginName(
  contacts: MeetingContactOption[],
  loginName: string | null | undefined,
): MeetingContactOption | null {
  const normalizedLoginName = normalizeMeetingLoginName(loginName);
  if (!normalizedLoginName) {
    return null;
  }

  return (
    contacts.find((contact) => {
      if (!contact.isInternal) {
        return false;
      }

      return readMeetingContactEmailLocalPart(contact.email) === normalizedLoginName;
    }) ?? null
  );
}

export function findMeetingContactByEmail(
  contacts: MeetingContactOption[],
  email: string | null | undefined,
): MeetingContactOption | null {
  const normalizedEmail = normalizeMeetingEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  return contacts.find((contact) => normalizeMeetingEmail(contact.email) === normalizedEmail) ?? null;
}

export function isMeetingOrganizerContactForLogin(
  email: string | null | undefined,
  loginName: string | null | undefined,
): boolean {
  const normalizedLoginName = normalizeMeetingLoginName(loginName);
  if (!normalizedLoginName || !isExcludedInternalContactEmail(email)) {
    return false;
  }

  return readMeetingContactEmailLocalPart(email) === normalizedLoginName;
}

function compareMeetingAccounts(
  left: MeetingAccountOption,
  right: MeetingAccountOption,
): number {
  const companyCompare = left.companyName.localeCompare(right.companyName, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (companyCompare !== 0) {
    return companyCompare;
  }

  return left.address.localeCompare(right.address, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function compareMeetingContacts(
  left: MeetingContactOption,
  right: MeetingContactOption,
): number {
  const nameCompare = left.contactName.localeCompare(right.contactName, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameCompare !== 0) {
    return nameCompare;
  }

  const companyCompare = (left.companyName ?? "").localeCompare(right.companyName ?? "", undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (companyCompare !== 0) {
    return companyCompare;
  }

  return (left.email ?? "").localeCompare(right.email ?? "", undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function formatMeetingAccountAddress(row: BusinessAccountRow): string {
  if (hasText(row.address)) {
    return row.address;
  }

  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

function readMeetingDateParts(date: string): { day: number; month: number; year: number } {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Date must use YYYY-MM-DD format.");
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function readMeetingTimeParts(time: string): { hour: number; minute: number } {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("Time must use HH:mm format.");
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const utcMs = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );

  return utcMs - date.getTime();
}

export function zonedMeetingDateTimeToUtc(input: {
  date: string;
  time: string;
  timeZone: string;
}): Date {
  const dateParts = readMeetingDateParts(input.date);
  const timeParts = readMeetingTimeParts(input.time);
  const utcGuess = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0,
  );
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), input.timeZone);
  let targetMs = utcGuess - offsetMs;
  const resolvedOffsetMs = getTimeZoneOffsetMs(new Date(targetMs), input.timeZone);
  if (resolvedOffsetMs !== offsetMs) {
    targetMs = utcGuess - resolvedOffsetMs;
  }

  return new Date(targetMs);
}

export function buildMeetingDateTimeRange(request: Pick<
  MeetingCreateRequest,
  "endDate" | "endTime" | "startDate" | "startTime" | "timeZone"
>): {
  endDateTimeIso: string;
  startDateTimeIso: string;
} {
  const start = zonedMeetingDateTimeToUtc({
    date: request.startDate,
    time: request.startTime,
    timeZone: request.timeZone,
  });
  const end = zonedMeetingDateTimeToUtc({
    date: request.endDate,
    time: request.endTime,
    timeZone: request.timeZone,
  });

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Meeting start and end must be valid date/times.");
  }

  if (end.getTime() <= start.getTime()) {
    throw new Error("Meeting end must be after the start.");
  }

  return {
    startDateTimeIso: start.toISOString(),
    endDateTimeIso: end.toISOString(),
  };
}

export function buildMeetingAccountOptionsFromRows(
  rows: BusinessAccountRow[],
): MeetingAccountOption[] {
  const byAccount = new Map<string, MeetingAccountOption>();

  rows.forEach((row) => {
    const businessAccountRecordId = (row.accountRecordId ?? row.id ?? "").trim();
    const businessAccountId = row.businessAccountId.trim();
    const companyName = row.companyName.trim();
    if (!businessAccountRecordId || !businessAccountId || !companyName) {
      return;
    }

    const key = businessAccountRecordId || businessAccountId;
    if (byAccount.has(key)) {
      return;
    }

    byAccount.set(key, {
      businessAccountRecordId,
      businessAccountId,
      companyName,
      address: formatMeetingAccountAddress(row),
    });
  });

  return [...byAccount.values()].sort(compareMeetingAccounts);
}

export function buildMeetingContactOptionsFromRows(
  rows: BusinessAccountRow[],
): MeetingContactOption[] {
  const byContactId = new Map<number, MeetingContactOption>();

  rows.forEach((row) => {
    const contactId = row.contactId ?? row.primaryContactId ?? null;
    if (contactId === null || !Number.isFinite(contactId)) {
      return;
    }

    const contactName =
      row.primaryContactName?.trim() ||
      (hasText(row.companyName) ? `${row.companyName.trim()} contact` : `Contact ${contactId}`);
    const email = row.primaryContactEmail?.trim() || null;
    const phone = row.primaryContactPhone?.trim() || row.phoneNumber?.trim() || null;
    const businessAccountRecordId = row.accountRecordId?.trim() || row.id.trim() || null;
    const businessAccountId = row.businessAccountId.trim() || null;
    const companyName = row.companyName.trim() || null;
    const isInternal =
      isExcludedInternalContactEmail(email) ||
      isExcludedInternalCompanyName(companyName);
    const next: MeetingContactOption = {
      key: `${contactId}:${businessAccountRecordId ?? businessAccountId ?? "contact"}`,
      contactId,
      contactName,
      email,
      phone,
      businessAccountRecordId,
      businessAccountId,
      companyName,
      isInternal,
    };

    const existing = byContactId.get(contactId);
    if (!existing) {
      byContactId.set(contactId, next);
      return;
    }

    byContactId.set(contactId, {
      ...existing,
      contactName:
        normalizeComparable(existing.contactName) === normalizeComparable(`Contact ${contactId}`) &&
        normalizeComparable(next.contactName) !== normalizeComparable(`Contact ${contactId}`)
          ? next.contactName
          : existing.contactName,
      email: existing.email ?? next.email,
      phone: existing.phone ?? next.phone,
      businessAccountRecordId: existing.businessAccountRecordId ?? next.businessAccountRecordId,
      businessAccountId: existing.businessAccountId ?? next.businessAccountId,
      companyName: existing.companyName ?? next.companyName,
      isInternal: existing.isInternal || next.isInternal,
    });
  });

  return [...byContactId.values()].sort(compareMeetingContacts);
}

export function findMeetingContactOptionById(
  rows: BusinessAccountRow[],
  contactId: number,
): MeetingContactOption | null {
  return buildMeetingContactOptionsFromRows(rows).find((option) => option.contactId === contactId) ?? null;
}

export function buildMeetingCreateOptionsFromRows(
  rows: BusinessAccountRow[],
  defaultTimeZone = DEFAULT_MEETING_TIME_ZONE,
): MeetingCreateOptionsResponse {
  return {
    contacts: buildMeetingContactOptionsFromRows(rows),
    accounts: buildMeetingAccountOptionsFromRows(rows),
    defaultTimeZone,
  };
}

export function mergeMeetingCreateOptions(
  current: MeetingCreateOptionsResponse,
  rows: BusinessAccountRow[],
): MeetingCreateOptionsResponse {
  const next = buildMeetingCreateOptionsFromRows(rows, current.defaultTimeZone);
  const accountMap = new Map<string, MeetingAccountOption>();
  const contactMap = new Map<number, MeetingContactOption>();

  [...current.accounts, ...next.accounts].forEach((account) => {
    accountMap.set(account.businessAccountRecordId, account);
  });
  [...current.contacts, ...next.contacts].forEach((contact) => {
    contactMap.set(contact.contactId, contact);
  });

  return {
    defaultTimeZone: current.defaultTimeZone,
    accounts: [...accountMap.values()].sort(compareMeetingAccounts),
    contacts: [...contactMap.values()].sort(compareMeetingContacts),
  };
}

export function buildMeetingEventPayload(
  input: {
    attendees: Array<
      Pick<ResolvedMeetingInviteAttendee, "contactId" | "contactName" | "contactRecordId" | "email">
    >;
    relatedContactRecordId: string;
    request: MeetingCreateRequest;
  },
  variant: MeetingEventPayloadVariant = {
    attendeeFieldMode: "email",
    dateFieldMode: "date",
    detailsField: "Body",
    relatedEntityTypeValue: "PX.Objects.CR.Contact",
    relatedEntityField: "RelatedEntityNoteID",
  },
): Record<string, unknown> {
  const { endDateTimeIso, startDateTimeIso } = buildMeetingDateTimeRange(input.request);
  const payload: Record<string, unknown> = {
    Summary: {
      value: input.request.summary,
    },
    ShowAs: {
      value: "Busy",
    },
    Status: {
      value: "Open",
    },
    Priority: {
      value: input.request.priority,
    },
    Category: {
      value: "Red",
    },
    RelatedEntityType: {
      value: variant.relatedEntityTypeValue,
    },
    [variant.relatedEntityField]: {
      value: input.relatedContactRecordId,
    },
  };

  if (input.attendees.length > 0) {
    payload.Attendees = input.attendees.map((attendee) => {
      const row: Record<string, unknown> = {
        Optional: {
          value: false,
        },
      };

      if (variant.attendeeFieldMode === "email") {
        row.Email = {
          value: attendee.email,
        };
        if (hasText(attendee.contactName)) {
          row.Name = {
            value: attendee.contactName,
          };
        }
        return row;
      }

      if (variant.attendeeFieldMode === "contact") {
        row.Contact = {
          value: attendee.contactRecordId ?? String(attendee.contactId),
        };
        return row;
      }

      row.ContactID = {
        value: attendee.contactId,
      };
      return row;
    });
  }

  payload.TimeZone = {
    value: input.request.timeZone,
  };

  if (variant.dateFieldMode === "dateTime") {
    payload.StartDateTime = {
      value: startDateTimeIso,
    };
    payload.EndDateTime = {
      value: endDateTimeIso,
    };
  } else {
    payload.StartDate = {
      value: startDateTimeIso,
    };
    payload.EndDate = {
      value: endDateTimeIso,
    };
    payload.EndTime = {
      value: endDateTimeIso,
    };
  }

  if (hasText(input.request.location)) {
    payload.Location = {
      value: input.request.location,
    };
  }

  if (hasText(input.request.details)) {
    payload[variant.detailsField] = {
      value: input.request.details,
    };
  }

  return payload;
}

export function buildMeetingEventPayloadVariants(input: {
  attendees: Array<
    Pick<ResolvedMeetingInviteAttendee, "contactId" | "contactName" | "contactRecordId" | "email">
  >;
  relatedContactRecordId: string;
  request: MeetingCreateRequest;
}): Record<string, unknown>[] {
  const variants: MeetingEventPayloadVariant[] = [];
  const hasEmailForEveryAttendee = input.attendees.every((attendee) => hasText(attendee.email));
  const hasContactIdForEveryAttendee = input.attendees.every((attendee) =>
    typeof attendee.contactId === "number" && Number.isFinite(attendee.contactId),
  );
  const hasContactRecordForEveryAttendee = input.attendees.every((attendee) =>
    hasText(attendee.contactRecordId),
  );

  if (hasEmailForEveryAttendee) {
    variants.push(
      {
        attendeeFieldMode: "email",
        dateFieldMode: "date",
        detailsField: "Body",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntityNoteID",
      },
      {
        attendeeFieldMode: "email",
        dateFieldMode: "date",
        detailsField: "Body",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntity",
      },
      {
        attendeeFieldMode: "email",
        dateFieldMode: "date",
        detailsField: "Description",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntityNoteID",
      },
      {
        attendeeFieldMode: "email",
        dateFieldMode: "date",
        detailsField: "Description",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntity",
      },
    );
  }

  if (hasContactIdForEveryAttendee) {
    variants.push(
      {
        attendeeFieldMode: "contactId",
        dateFieldMode: "date",
        detailsField: "Body",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntityNoteID",
      },
      {
        attendeeFieldMode: "contactId",
        dateFieldMode: "date",
        detailsField: "Body",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntity",
      },
      {
        attendeeFieldMode: "contactId",
        dateFieldMode: "date",
        detailsField: "Description",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntityNoteID",
      },
      {
        attendeeFieldMode: "contactId",
        dateFieldMode: "date",
        detailsField: "Description",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntity",
      },
    );
  }

  if (hasContactRecordForEveryAttendee) {
    variants.push(
      {
        attendeeFieldMode: "contact",
        dateFieldMode: "date",
        detailsField: "Body",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntityNoteID",
      },
      {
        attendeeFieldMode: "contact",
        dateFieldMode: "date",
        detailsField: "Body",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntity",
      },
      {
        attendeeFieldMode: "contact",
        dateFieldMode: "date",
        detailsField: "Description",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntityNoteID",
      },
      {
        attendeeFieldMode: "contact",
        dateFieldMode: "date",
        detailsField: "Description",
        relatedEntityTypeValue: "PX.Objects.CR.Contact",
        relatedEntityField: "RelatedEntity",
      },
    );
  }

  if (hasEmailForEveryAttendee) {
    variants.push({
      attendeeFieldMode: "email",
      dateFieldMode: "date",
      detailsField: "Body",
      relatedEntityTypeValue: "Contact",
      relatedEntityField: "RelatedEntityNoteID",
    });
  }

  variants.push({
    attendeeFieldMode:
      hasEmailForEveryAttendee || !hasContactIdForEveryAttendee ? "email" : "contactId",
    dateFieldMode: "dateTime",
    detailsField: "Body",
    relatedEntityTypeValue: "PX.Objects.CR.Contact",
    relatedEntityField: "RelatedEntityNoteID",
  });

  const payloads: Record<string, unknown>[] = [];
  const fingerprints = new Set<string>();

  variants.forEach((variant) => {
    const payload = buildMeetingEventPayload(input, variant);
    const fingerprint = JSON.stringify(payload);
    if (fingerprints.has(fingerprint)) {
      return;
    }
    fingerprints.add(fingerprint);
    payloads.push(payload);
  });

  return payloads;
}

export function buildMeetingInviteAttendees(input: {
  attendeeEmails: string[];
  contacts: ResolvedMeetingContact[];
}): ResolvedMeetingInviteAttendee[] {
  const deduped = new Map<string, ResolvedMeetingInviteAttendee>();

  input.contacts.forEach((contact) => {
    const normalizedEmail = normalizeMeetingEmail(contact.email);
    if (!normalizedEmail || deduped.has(normalizedEmail)) {
      return;
    }

    deduped.set(normalizedEmail, {
      contactId: contact.contactId,
      contactRecordId: contact.contactRecordId,
      contactName: contact.contactName,
      email: normalizedEmail,
    });
  });

  input.attendeeEmails.forEach((email) => {
    const normalizedEmail = normalizeMeetingEmail(email);
    if (!normalizedEmail || deduped.has(normalizedEmail)) {
      return;
    }

    deduped.set(normalizedEmail, {
      contactId: null,
      contactRecordId: null,
      contactName: null,
      email: normalizedEmail,
    });
  });

  return [...deduped.values()];
}
