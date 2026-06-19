"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppChrome } from "@/components/app-chrome";
import { CallPhoneButton } from "@/components/call-phone-button";
import {
  GmailComposeModal,
  type GmailComposeInitialState,
} from "@/components/gmail-compose-modal";
import {
  extractDeliverableMeetingEmail,
  normalizeMeetingEmail,
} from "@/lib/meeting-create";
import type { MailSessionResponse } from "@/types/mail";
import type { MailContactSuggestion } from "@/types/mail-compose";
import type {
  CalendarEventsResponse,
  CalendarEventUpdateResponse,
  CalendarViewEvent,
  GoogleCalendarSessionResponse,
} from "@/types/google-calendar";
import type {
  MeetingContactOption,
  MeetingCreateOptionsResponse,
  MeetingEmployeeOption,
} from "@/types/meeting-create";

import styles from "./calendar-client.module.css";

type CalendarViewMode = "day" | "week" | "month";

type AuthSessionResponse = {
  authenticated: boolean;
  user: { id: string; name: string } | null;
};

type CalendarOauthWindowMessage =
  | {
      type: "mbcalendar.oauth";
      success: true;
      connectedGoogleEmail?: string | null;
    }
  | {
      type: "mbcalendar.oauth";
      success: false;
      message?: string;
    };

type MailOauthWindowMessage =
  | {
      type: "mbmail.oauth";
      success: true;
      connectedGoogleEmail?: string | null;
    }
  | {
      type: "mbmail.oauth";
      success: false;
      message?: string;
    };

type AddressLookupSuggestion = {
  id: string;
  type: string;
  text: string;
  description: string;
};

type AddressLookupResponse = {
  items: AddressLookupSuggestion[];
};

type AddressRetrieveResponse = {
  address: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
};

type CalendarGuestSuggestion = {
  key: string;
  email: string;
  name: string;
  meta: string | null;
};

type MailComposeState = {
  initialState: GmailComposeInitialState | null;
  isOpen: boolean;
};

type DragState = {
  pointerId: number;
  event: CalendarViewEvent;
  mode: "timed" | "allday";
  startClientX: number;
  startClientY: number;
  grabOffsetMinutes: number;
  isDragging: boolean;
  preview: { dayKey: string; startMinutes: number } | null;
};

type PositionedSegment = {
  event: CalendarViewEvent;
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  columnIndex: number;
  columnCount: number;
};

type SelectedEventDetails = {
  event: CalendarViewEvent;
  left: number;
  top: number;
};

type CalendarEventEditForm = {
  summary: string;
  isAllDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  guestInput: string;
  attendees: Array<{ email: string; displayName: string | null; isOrganizer: boolean }>;
  recurrenceFrequency: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  recurrenceInterval: string;
  recurrenceWeekdays: string[];
  recurrenceTouched: boolean;
  reminderMode: "DEFAULT" | "NONE" | "CUSTOM";
  reminderMinutes: string;
  colorId: string;
  includeGoogleMeet: boolean;
  guestsCanModify: boolean;
  guestsCanInviteOthers: boolean;
  guestsCanSeeOtherGuests: boolean;
  transparency: "opaque" | "transparent";
  visibility: "default" | "public" | "private" | "confidential";
};

type CalendarEventColor = {
  background: string;
  border: string;
  text: string;
  softBackground: string;
};

type CalendarEventStyle = CSSProperties & {
  "--calendar-event-bg": string;
  "--calendar-event-border": string;
  "--calendar-event-text": string;
  "--calendar-event-soft-bg": string;
};

type DetailsIconName =
  | "calendar"
  | "description"
  | "edit"
  | "external"
  | "guests"
  | "location"
  | "owner"
  | "phone"
  | "reminder"
  | "repeat"
  | "time"
  | "video";

const HOUR_HEIGHT_PX = 48;
const SNAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const DRAG_THRESHOLD_PX = 5;
const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** The time grid only shows the working window the team cares about. */
const GRID_START_MINUTES = 6 * 60;
const GRID_END_MINUTES = 18 * 60;
const GRID_HOURS = Array.from(
  { length: (GRID_END_MINUTES - GRID_START_MINUTES) / 60 },
  (_, index) => GRID_START_MINUTES / 60 + index,
);
const RECURRENCE_WEEKDAY_OPTIONS = [
  { value: "SU", label: "Sun" },
  { value: "MO", label: "Mon" },
  { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" },
  { value: "TH", label: "Thu" },
  { value: "FR", label: "Fri" },
  { value: "SA", label: "Sat" },
] as const;
const GOOGLE_COLOR_OPTIONS = [
  { value: "", label: "Default" },
  { value: "1", label: "Lavender" },
  { value: "2", label: "Sage" },
  { value: "3", label: "Grape" },
  { value: "4", label: "Flamingo" },
  { value: "5", label: "Banana" },
  { value: "6", label: "Tangerine" },
  { value: "7", label: "Peacock" },
  { value: "8", label: "Graphite" },
  { value: "9", label: "Blueberry" },
  { value: "10", label: "Basil" },
  { value: "11", label: "Tomato" },
] as const;
const DEFAULT_EVENT_COLOR: CalendarEventColor = {
  background: "#3174ad",
  border: "#286298",
  text: "#ffffff",
  softBackground: "#d8e9f8",
};
const GOOGLE_CALENDAR_EVENT_COLORS: Record<string, CalendarEventColor> = {
  "1": {
    background: "#7986cb",
    border: "#6573b7",
    text: "#ffffff",
    softBackground: "#e6e9f7",
  },
  "2": {
    background: "#33b679",
    border: "#249963",
    text: "#ffffff",
    softBackground: "#d9f0e5",
  },
  "3": {
    background: "#8e24aa",
    border: "#771b91",
    text: "#ffffff",
    softBackground: "#efd9f5",
  },
  "4": {
    background: "#e67c73",
    border: "#cc645c",
    text: "#ffffff",
    softBackground: "#f9dfdc",
  },
  "5": {
    background: "#f6c026",
    border: "#dda90f",
    text: "#172033",
    softBackground: "#fff1c7",
  },
  "6": {
    background: "#f5511d",
    border: "#d83f0f",
    text: "#ffffff",
    softBackground: "#fedccd",
  },
  "7": {
    background: "#039be5",
    border: "#027fc0",
    text: "#ffffff",
    softBackground: "#d4eefb",
  },
  "8": {
    background: "#616161",
    border: "#4d4d4d",
    text: "#ffffff",
    softBackground: "#e4e4e4",
  },
  "9": {
    background: "#3f51b5",
    border: "#334295",
    text: "#ffffff",
    softBackground: "#dfe3f7",
  },
  "10": {
    background: "#0b8043",
    border: "#086936",
    text: "#ffffff",
    softBackground: "#d5eadf",
  },
  "11": {
    background: "#d50000",
    border: "#b40000",
    text: "#ffffff",
    softBackground: "#f7d1d1",
  },
};

function minutesToGridOffsetPx(minutes: number): number {
  return ((minutes - GRID_START_MINUTES) / 60) * HOUR_HEIGHT_PX;
}

function getCalendarEventColor(event: CalendarViewEvent): CalendarEventColor {
  const colorId = event.colorId?.trim();
  return (colorId ? GOOGLE_CALENDAR_EVENT_COLORS[colorId] : null) ?? DEFAULT_EVENT_COLOR;
}

function buildCalendarEventStyle(event: CalendarViewEvent, extra?: CSSProperties): CalendarEventStyle {
  const color = getCalendarEventColor(event);
  return {
    ...extra,
    "--calendar-event-bg": color.background,
    "--calendar-event-border": color.border,
    "--calendar-event-text": color.text,
    "--calendar-event-soft-bg": color.softBackground,
  };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date): Date {
  const dayStart = startOfDay(date);
  return addDays(dayStart, -dayStart.getDay());
}

function formatYmd(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatInputTime(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function parseYmd(value: string): Date {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatHourLabel(hour: number): string {
  if (hour === 0) {
    return "";
  }
  if (hour < 12) {
    return `${hour} AM`;
  }
  if (hour === 12) {
    return "12 PM";
  }
  return `${hour - 12} PM`;
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: date.getMinutes() === 0 ? undefined : "2-digit",
  });
}

function formatMinutesAsClock(minutes: number): string {
  const bounded = Math.max(0, Math.min(DAY_MINUTES, minutes));
  const base = new Date(2000, 0, 1, Math.floor(bounded / 60), bounded % 60);
  return base.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatEventTimeRange(event: CalendarViewEvent): string {
  if (event.isAllDay) {
    return "All day";
  }

  const start = new Date(event.startIso);
  const end = new Date(event.endIso);
  return `${formatClockTime(start)} – ${formatClockTime(end)}`;
}

function formatDetailedEventTime(event: CalendarViewEvent): string {
  if (event.isAllDay) {
    const start = parseYmd(event.startDate ?? formatYmd(new Date(event.startIso)));
    const endExclusive = event.endDate ? parseYmd(event.endDate) : addDays(start, 1);
    const endInclusive = addDays(endExclusive, -1);
    const startLabel = start.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    if (isSameDay(start, endInclusive)) {
      return `${startLabel} • All day`;
    }

    const endLabel = endInclusive.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    return `${startLabel} – ${endLabel} • All day`;
  }

  const start = new Date(event.startIso);
  const end = new Date(event.endIso);
  const startLabel = start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  if (isSameDay(start, end)) {
    return `${startLabel} • ${formatClockTime(start)} – ${formatClockTime(end)}`;
  }

  const endLabel = end.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return `${startLabel}, ${formatClockTime(start)} – ${endLabel}, ${formatClockTime(end)}`;
}

function formatCompactUrl(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function formatPersonLabel(person: { email: string | null; displayName: string | null } | null): string | null {
  return person?.displayName ?? person?.email ?? null;
}

function formatAttendeeLabel(attendee: {
  email: string | null;
  displayName: string | null;
}): string {
  return attendee.displayName ?? attendee.email ?? "Guest";
}

function getInitials(label: string): string {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase();
  }
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function formatGuestStatus(status: string | null): string {
  if (status === "accepted") {
    return "Yes";
  }
  if (status === "declined") {
    return "No";
  }
  if (status === "tentative") {
    return "Maybe";
  }
  return "Awaiting";
}

function getGuestStatusClass(status: string | null): string {
  if (status === "accepted") {
    return styles.guestStatusAccepted;
  }
  if (status === "declined") {
    return styles.guestStatusDeclined;
  }
  if (status === "tentative") {
    return styles.guestStatusTentative;
  }
  return styles.guestStatusAwaiting;
}

function extractGuestEmailsFromInput(value: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  const candidates = [value, ...value.split(/[\s,;]+/)];

  candidates.forEach((candidate) => {
    const email = extractDeliverableMeetingEmail(candidate);
    if (email && !seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  });

  return emails;
}

function normalizeSearchText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function formatCalendarLocationAddress(address: AddressRetrieveResponse["address"]): string {
  const locality = [address.city, address.state, address.postalCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const normalizedCountry = address.country.trim().toUpperCase();

  return [address.addressLine1, address.addressLine2, locality]
    .map((part) => part.trim())
    .filter(Boolean)
    .concat(
      normalizedCountry && normalizedCountry !== "CA" && normalizedCountry !== "CAN"
        ? [address.country.trim()]
        : [],
    )
    .join(", ");
}

function parseRecurrenceRule(rule: string | null): Pick<
  CalendarEventEditForm,
  "recurrenceFrequency" | "recurrenceInterval" | "recurrenceWeekdays"
> {
  if (!rule?.trim()) {
    return {
      recurrenceFrequency: "NONE",
      recurrenceInterval: "1",
      recurrenceWeekdays: [],
    };
  }

  const values = new Map<string, string>();
  rule
    .replace(/^RRULE:/i, "")
    .split(";")
    .forEach((part) => {
      const [key, value] = part.split("=");
      if (key && value) {
        values.set(key.toUpperCase(), value);
      }
    });
  const frequency = values.get("FREQ");
  const supportedFrequency =
    frequency === "DAILY" ||
    frequency === "WEEKLY" ||
    frequency === "MONTHLY" ||
    frequency === "YEARLY"
      ? frequency
      : "NONE";

  return {
    recurrenceFrequency: supportedFrequency,
    recurrenceInterval: values.get("INTERVAL") ?? "1",
    recurrenceWeekdays:
      values
        .get("BYDAY")
        ?.split(",")
        .filter((day) =>
          RECURRENCE_WEEKDAY_OPTIONS.some((option) => option.value === day),
        ) ?? [],
  };
}

function buildRecurrenceFromForm(form: CalendarEventEditForm): string[] | null {
  if (form.recurrenceFrequency === "NONE") {
    return null;
  }

  const interval = Math.max(1, Math.min(99, Number.parseInt(form.recurrenceInterval, 10) || 1));
  const parts = [`FREQ=${form.recurrenceFrequency}`];
  if (interval > 1) {
    parts.push(`INTERVAL=${interval}`);
  }
  if (form.recurrenceFrequency === "WEEKLY" && form.recurrenceWeekdays.length > 0) {
    parts.push(`BYDAY=${form.recurrenceWeekdays.join(",")}`);
  }

  return [`RRULE:${parts.join(";")}`];
}

function buildEditFormFromEvent(event: CalendarViewEvent): CalendarEventEditForm {
  const start = event.isAllDay
    ? parseYmd(event.startDate ?? formatYmd(new Date(event.startIso)))
    : new Date(event.startIso);
  const end = event.isAllDay
    ? addDays(parseYmd(event.endDate ?? event.startDate ?? formatYmd(start)), -1)
    : new Date(event.endIso);

  return {
    summary: event.summary === "(No title)" ? "" : event.summary,
    isAllDay: event.isAllDay,
    startDate: formatYmd(start),
    startTime: event.isAllDay ? "" : formatInputTime(start),
    endDate: formatYmd(end),
    endTime: event.isAllDay ? "" : formatInputTime(end),
    location: event.location ?? "",
    description: event.description ?? "",
    guestInput: "",
    attendees: event.attendees
      .filter((attendee) => attendee.email && !attendee.isSelf)
      .map((attendee) => ({
        email: attendee.email ?? "",
        displayName: attendee.displayName,
        isOrganizer: attendee.isOrganizer,
      })),
    ...parseRecurrenceRule(event.recurrenceRule),
    recurrenceTouched: false,
    reminderMode: event.usesDefaultReminders
      ? "DEFAULT"
      : event.reminderMinutes === null
        ? "NONE"
        : "CUSTOM",
    reminderMinutes: String(event.reminderMinutes ?? 10),
    colorId: event.colorId ?? "",
    includeGoogleMeet: Boolean(event.conference?.videoUri ?? event.hangoutLink),
    guestsCanModify: event.guestsCanModify,
    guestsCanInviteOthers: event.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests,
    transparency: event.transparency,
    visibility: event.visibility,
  };
}

function parseLocalDateTime(date: string, time: string): Date | null {
  if (!date || !time) {
    return null;
  }

  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDetailsCardPosition(clientX: number, clientY: number): { left: number; top: number } {
  if (typeof window === "undefined") {
    return { left: 24, top: 24 };
  }

  const gutter = 16;
  const cardWidth = Math.min(560, Math.max(320, window.innerWidth - gutter * 2));
  const cardHeight = Math.min(660, Math.max(420, window.innerHeight - gutter * 2));
  const preferredLeft =
    clientX + 18 + cardWidth > window.innerWidth ? clientX - cardWidth - 18 : clientX + 18;
  const maxLeft = Math.max(gutter, window.innerWidth - cardWidth - gutter);
  const maxTop = Math.max(gutter, window.innerHeight - cardHeight - gutter);

  return {
    left: Math.min(Math.max(gutter, preferredLeft), maxLeft),
    top: Math.min(Math.max(gutter, clientY - 34), maxTop),
  };
}

function eventStartForSort(event: CalendarViewEvent): number {
  if (event.isAllDay && event.startDate) {
    return parseYmd(event.startDate).getTime();
  }
  return Date.parse(event.startIso);
}

function eventCoversDay(event: CalendarViewEvent, day: Date): boolean {
  const dayStartMs = day.getTime();
  const dayEndMs = dayStartMs + DAY_MS;
  if (event.isAllDay && event.startDate) {
    const startMs = parseYmd(event.startDate).getTime();
    const endMs = event.endDate ? parseYmd(event.endDate).getTime() : startMs + DAY_MS;
    return startMs < dayEndMs && endMs > dayStartMs;
  }

  const startMs = Date.parse(event.startIso);
  const endMs = Date.parse(event.endIso);
  return startMs < dayEndMs && endMs > dayStartMs;
}

function isMultiDayTimedEvent(event: CalendarViewEvent): boolean {
  return !event.isAllDay && Date.parse(event.endIso) - Date.parse(event.startIso) >= DAY_MS;
}

function belongsInAllDayRow(event: CalendarViewEvent): boolean {
  return event.isAllDay || isMultiDayTimedEvent(event);
}

function isCalendarOauthWindowMessage(payload: unknown): payload is CalendarOauthWindowMessage {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return record.type === "mbcalendar.oauth" && typeof record.success === "boolean";
}

function isMailOauthWindowMessage(payload: unknown): payload is MailOauthWindowMessage {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return record.type === "mbmail.oauth" && typeof record.success === "boolean";
}

function createMailSuggestionFromMeetingContact(
  contact: MeetingContactOption,
  email: string,
): MailContactSuggestion {
  return {
    key: `calendar-contact:${contact.contactId}:${email}`,
    email,
    name: contact.contactName,
    companyName: contact.companyName,
    contactId: contact.contactId,
    businessAccountRecordId: contact.businessAccountRecordId,
    businessAccountId: contact.businessAccountId,
  };
}

function isMeetingCreateOptionsResponse(
  payload: MeetingCreateOptionsResponse | { error?: string } | null,
): payload is MeetingCreateOptionsResponse {
  return Boolean(
    payload &&
      Array.isArray((payload as MeetingCreateOptionsResponse).contacts) &&
      Array.isArray((payload as MeetingCreateOptionsResponse).employees) &&
      Array.isArray((payload as MeetingCreateOptionsResponse).accounts) &&
      typeof (payload as MeetingCreateOptionsResponse).defaultTimeZone === "string",
  );
}

function isAddressLookupSuggestion(payload: unknown): payload is AddressLookupSuggestion {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    typeof record.text === "string" &&
    typeof record.description === "string"
  );
}

function isAddressLookupResponse(payload: unknown): payload is AddressLookupResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.every((item) => isAddressLookupSuggestion(item));
}

function isAddressRetrieveResponse(payload: unknown): payload is AddressRetrieveResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (!record.address || typeof record.address !== "object") {
    return false;
  }

  const address = record.address as Record<string, unknown>;
  return (
    typeof address.addressLine1 === "string" &&
    typeof address.addressLine2 === "string" &&
    typeof address.city === "string" &&
    typeof address.state === "string" &&
    typeof address.postalCode === "string" &&
    typeof address.country === "string"
  );
}

function parseError(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
  }

  return "Request failed.";
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

/**
 * Assigns side-by-side columns to overlapping segments within one day, the
 * way Google Calendar splits concurrent events.
 */
function layoutDaySegments(
  segments: Array<Omit<PositionedSegment, "columnIndex" | "columnCount">>,
): PositionedSegment[] {
  const sorted = [...segments].sort(
    (left, right) =>
      left.startMinutes - right.startMinutes ||
      right.endMinutes - right.startMinutes - (left.endMinutes - left.startMinutes),
  );
  const positioned: PositionedSegment[] = [];
  let cluster: PositionedSegment[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const flushCluster = () => {
    cluster.forEach((segment) => {
      segment.columnCount = columnEnds.length;
    });
    positioned.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  sorted.forEach((segment) => {
    if (cluster.length > 0 && segment.startMinutes >= clusterEnd) {
      flushCluster();
    }

    let columnIndex = columnEnds.findIndex((end) => end <= segment.startMinutes);
    if (columnIndex === -1) {
      columnIndex = columnEnds.length;
      columnEnds.push(segment.endMinutes);
    } else {
      columnEnds[columnIndex] = segment.endMinutes;
    }

    const placed: PositionedSegment = { ...segment, columnIndex, columnCount: 1 };
    cluster.push(placed);
    clusterEnd = Math.max(clusterEnd, segment.endMinutes);
  });
  flushCluster();

  return positioned;
}

function DetailsIcon({ name }: { name: DetailsIconName }) {
  if (name === "calendar") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <rect height="15" rx="2" stroke="currentColor" strokeWidth="1.8" width="17" x="3.5" y="5" />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "description") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <path d="M7 4.5h7l3 3v12H7z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M14 4.5v3h3M9.5 12h5M9.5 15.5h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg aria-hidden="true" className={styles.detailsActionIcon} fill="none" viewBox="0 0 24 24">
        <path d="m5 19 4.2-1 9.4-9.4a2.1 2.1 0 0 0-3-3L6.2 15z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="m14.5 6.5 3 3M5 19h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "external") {
    return (
      <svg aria-hidden="true" className={styles.detailsActionIcon} fill="none" viewBox="0 0 24 24">
        <path d="M9 7H6.5A2.5 2.5 0 0 0 4 9.5v8A2.5 2.5 0 0 0 6.5 20h8a2.5 2.5 0 0 0 2.5-2.5V15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M13 4h7v7M12 12 20 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "guests") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <path d="M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20c.6-3.5 2.7-5.5 6-5.5s5.4 2 6 5.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M16 11.5a3 3 0 1 0 0-6M16.5 14.5c2.3.4 3.7 2.1 4 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "location") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "owner") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 20c.8-3.7 3.2-5.5 7-5.5s6.2 1.8 7 5.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "phone") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <path d="M7 5.5 9.4 4l2.3 4.4-1.7 1.2c.8 1.8 2.2 3.2 4.1 4.1l1.2-1.7 4.4 2.3L18.2 17c-.6 1-1.7 1.5-2.8 1.2-4.8-1.2-8.6-5-9.8-9.8-.3-1.1.2-2.2 1.4-2.9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "reminder") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <path d="M6 10a6 6 0 1 1 12 0v4l2 3H4l2-3zM10 20h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "repeat") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <path d="M17 4l3 3-3 3M4 7h16M7 20l-3-3 3-3M20 17H4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "video") {
    return (
      <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
        <path d="M5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="m16 11 5-3v8l-5-3" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={styles.detailsIcon} fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

export function CalendarClient() {
  const [authSession, setAuthSession] = useState<AuthSessionResponse | null>(null);
  const [calendarSession, setCalendarSession] = useState<GoogleCalendarSessionResponse | null>(
    null,
  );
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [view, setView] = useState<CalendarViewMode>("week");
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarViewEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [selectedEventDetails, setSelectedEventDetails] = useState<SelectedEventDetails | null>(
    null,
  );
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventEditForm, setEventEditForm] = useState<CalendarEventEditForm | null>(null);
  const [isSavingEventDetails, setIsSavingEventDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsNotice, setDetailsNotice] = useState<string | null>(null);
  const [pendingMoveEventId, setPendingMoveEventId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [meetingOptions, setMeetingOptions] = useState<MeetingCreateOptionsResponse | null>(null);
  const [isLoadingMeetingOptions, setIsLoadingMeetingOptions] = useState(false);
  const [meetingOptionsError, setMeetingOptionsError] = useState<string | null>(null);
  const [mailSession, setMailSession] = useState<MailSessionResponse | null>(null);
  const [isMailSessionLoading, setIsMailSessionLoading] = useState(false);
  const [mailComposeState, setMailComposeState] = useState<MailComposeState>({
    initialState: null,
    isOpen: false,
  });
  const [locationSuggestions, setLocationSuggestions] = useState<AddressLookupSuggestion[]>([]);
  const [locationLookupError, setLocationLookupError] = useState<string | null>(null);
  const [isLoadingLocationSuggestions, setIsLoadingLocationSuggestions] = useState(false);
  const [isApplyingLocationSuggestion, setIsApplyingLocationSuggestion] = useState(false);
  const [hasLocationLookupAttempted, setHasLocationLookupAttempted] = useState(false);
  const [selectedLocationValue, setSelectedLocationValue] = useState<string | null>(null);
  const [selectedLocationLookupId, setSelectedLocationLookupId] = useState<string | null>(null);

  const dragStateRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    eventId: string;
    dayKey: string;
    startMinutes: number;
    durationMinutes: number;
  } | null>(null);
  const timeGridRef = useRef<HTMLDivElement | null>(null);
  const timeGridScrollRef = useRef<HTMLDivElement | null>(null);
  const monthGridRef = useRef<HTMLDivElement | null>(null);
  const debouncedLocationSearchTerm = useDebouncedValue(eventEditForm?.location ?? "", 220);
  const hasEditableEvent = editingEventId !== null && eventEditForm !== null;

  const visibleRange = useMemo(() => {
    if (view === "day") {
      const start = startOfDay(anchorDate);
      return { start, end: addDays(start, 1) };
    }
    if (view === "week") {
      const start = startOfWeek(anchorDate);
      return { start, end: addDays(start, 7) };
    }

    const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const start = startOfWeek(firstOfMonth);
    return { start, end: addDays(start, 42) };
  }, [anchorDate, view]);

  const visibleDays = useMemo(() => {
    const days: Date[] = [];
    for (
      let cursor = new Date(visibleRange.start);
      cursor < visibleRange.end;
      cursor = addDays(cursor, 1)
    ) {
      days.push(new Date(cursor));
    }
    return days;
  }, [visibleRange]);

  const rangeTitle = useMemo(() => {
    if (view === "day") {
      return anchorDate.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    if (view === "month") {
      return anchorDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    const start = visibleRange.start;
    const endInclusive = addDays(visibleRange.end, -1);
    if (start.getMonth() === endInclusive.getMonth()) {
      return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    const startLabel = start.toLocaleDateString(undefined, {
      month: "short",
      ...(start.getFullYear() !== endInclusive.getFullYear() ? { year: "numeric" } : {}),
    });
    const endLabel = endInclusive.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    });
    return `${startLabel} – ${endLabel}`;
  }, [anchorDate, view, visibleRange]);

  const contactsByEmail = useMemo(() => {
    const byEmail = new Map<string, { contact: MeetingContactOption; email: string }>();
    meetingOptions?.contacts.forEach((contact) => {
      const email = extractDeliverableMeetingEmail(contact.email);
      if (!email || byEmail.has(email)) {
        return;
      }

      byEmail.set(email, { contact, email });
    });
    return byEmail;
  }, [meetingOptions]);

  const mailContactSuggestions = useMemo(
    () =>
      [...contactsByEmail.values()]
        .map(({ contact, email }) => createMailSuggestionFromMeetingContact(contact, email))
        .sort((left, right) =>
          `${left.name ?? ""} ${left.email}`.localeCompare(
            `${right.name ?? ""} ${right.email}`,
            undefined,
            { sensitivity: "base", numeric: true },
          ),
        ),
    [contactsByEmail],
  );

  const guestContactSuggestions = useMemo(() => {
    const query = normalizeSearchText(eventEditForm?.guestInput);
    if (!eventEditForm || query.length < 2 || !meetingOptions) {
      return [];
    }

    const existingEmails = new Set(
      eventEditForm.attendees
        .map((attendee) => normalizeMeetingEmail(attendee.email))
        .filter((email): email is string => Boolean(email)),
    );
    const suggestions: CalendarGuestSuggestion[] = [];
    const seenEmails = new Set(existingEmails);

    const pushSuggestion = (suggestion: CalendarGuestSuggestion) => {
      if (seenEmails.has(suggestion.email)) {
        return;
      }

      const haystack = normalizeSearchText(
        [suggestion.name, suggestion.email, suggestion.meta].filter(Boolean).join(" "),
      );
      if (!haystack.includes(query)) {
        return;
      }

      seenEmails.add(suggestion.email);
      suggestions.push(suggestion);
    };

    meetingOptions.contacts.forEach((contact: MeetingContactOption) => {
      const email = extractDeliverableMeetingEmail(contact.email);
      if (!email) {
        return;
      }

      pushSuggestion({
        key: `contact:${contact.contactId}`,
        email,
        name: contact.contactName,
        meta: contact.companyName,
      });
    });

    meetingOptions.employees.forEach((employee: MeetingEmployeeOption) => {
      const email = extractDeliverableMeetingEmail(employee.email);
      if (!email) {
        return;
      }

      pushSuggestion({
        key: `employee:${employee.loginName}`,
        email,
        name: employee.employeeName,
        meta: "Employee",
      });
    });

    return suggestions.slice(0, 8);
  }, [eventEditForm, meetingOptions]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then((response) => readJsonResponse<AuthSessionResponse>(response))
      .then((payload) => {
        if (payload) {
          setAuthSession(payload);
        }
      })
      .catch(() => {
        // The global auth guard handles redirects; ignore here.
      });
    return () => controller.abort();
  }, []);

  const loadCalendarSession = useCallback(async () => {
    setIsLoadingSession(true);
    try {
      const response = await fetch("/api/calendar/session", { cache: "no-store" });
      const payload = await readJsonResponse<GoogleCalendarSessionResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      setCalendarSession(payload as GoogleCalendarSessionResponse);
      setPageError(null);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Unable to load the Google Calendar session.",
      );
    } finally {
      setIsLoadingSession(false);
    }
  }, []);

  const loadMailSession = useCallback(async () => {
    setIsMailSessionLoading(true);
    try {
      const response = await fetch("/api/mail/session", { cache: "no-store" });
      const payload = await readJsonResponse<MailSessionResponse | { error?: string }>(response);
      if (!response.ok) {
        setMailSession({
          status: response.status === 422 ? "needs_setup" : "disconnected",
          senderEmail: null,
          senderDisplayName: null,
          expectedGoogleEmail: null,
          connectedGoogleEmail: null,
          connectionError: parseError(payload),
          folders: ["inbox", "sent", "drafts", "starred"],
        });
        return;
      }

      setMailSession(payload as MailSessionResponse);
    } catch (error) {
      setMailSession({
        status: "disconnected",
        senderEmail: null,
        senderDisplayName: null,
        expectedGoogleEmail: null,
        connectedGoogleEmail: null,
        connectionError: error instanceof Error ? error.message : "Unable to load Gmail.",
        folders: ["inbox", "sent", "drafts", "starred"],
      });
    } finally {
      setIsMailSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendarSession();
  }, [loadCalendarSession]);

  useEffect(() => {
    if (!mailComposeState.isOpen || mailSession || isMailSessionLoading) {
      return;
    }

    void loadMailSession();
  }, [isMailSessionLoading, loadMailSession, mailComposeState.isOpen, mailSession]);

  useEffect(() => {
    if (calendarSession?.status !== "connected") {
      return;
    }

    const controller = new AbortController();
    setIsLoadingMeetingOptions(true);
    setMeetingOptionsError(null);

    fetch("/api/meetings/options", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readJsonResponse<MeetingCreateOptionsResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isMeetingCreateOptionsResponse(payload)) {
          throw new Error("Unexpected contact options response.");
        }

        setMeetingOptions(payload);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setMeetingOptions(null);
        setMeetingOptionsError(
          error instanceof Error ? error.message : "Unable to load contacts.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingMeetingOptions(false);
        }
      });

    return () => controller.abort();
  }, [calendarSession?.status]);

  useEffect(() => {
    function handleCalendarOauthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || !isCalendarOauthWindowMessage(event.data)) {
        return;
      }

      if (!event.data.success) {
        setPageError(event.data.message ?? "Unable to connect Google Calendar.");
        return;
      }

      setPageError(null);
      void loadCalendarSession();
      setRefreshNonce((nonce) => nonce + 1);
    }

    window.addEventListener("message", handleCalendarOauthMessage);
    return () => {
      window.removeEventListener("message", handleCalendarOauthMessage);
    };
  }, [loadCalendarSession]);

  useEffect(() => {
    function handleMailOauthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || !isMailOauthWindowMessage(event.data)) {
        return;
      }

      if (!event.data.success) {
        setDetailsError(event.data.message ?? "Unable to connect Gmail.");
        setDetailsNotice(null);
        return;
      }

      setDetailsError(null);
      setDetailsNotice("Gmail connected. You can send email from the calendar now.");
      void loadMailSession();
    }

    window.addEventListener("message", handleMailOauthMessage);
    return () => {
      window.removeEventListener("message", handleMailOauthMessage);
    };
  }, [loadMailSession]);

  useEffect(() => {
    if (calendarSession?.status !== "connected") {
      setEvents([]);
      return;
    }

    const controller = new AbortController();
    setIsLoadingEvents(true);

    const params = new URLSearchParams({
      timeMin: visibleRange.start.toISOString(),
      timeMax: visibleRange.end.toISOString(),
    });
    fetch(`/api/calendar/events?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readJsonResponse<CalendarEventsResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        const data = payload as CalendarEventsResponse;
        setEvents(data.events);
        setPageError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setPageError(
          error instanceof Error ? error.message : "Unable to load Google Calendar events.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingEvents(false);
        }
      });

    return () => controller.abort();
  }, [calendarSession?.status, refreshNonce, visibleRange]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(new Date());
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (calendarSession?.status !== "connected") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRefreshNonce((nonce) => nonce + 1);
    }, 120_000);
    return () => window.clearInterval(intervalId);
  }, [calendarSession?.status]);

  useEffect(() => {
    const normalizedSearchTerm = debouncedLocationSearchTerm.trim();
    if (
      !hasEditableEvent ||
      selectedLocationLookupId ||
      normalizedSearchTerm.length < 3
    ) {
      setLocationSuggestions([]);
      setIsLoadingLocationSuggestions(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingLocationSuggestions(true);
    setLocationLookupError(null);

    const params = new URLSearchParams({
      q: normalizedSearchTerm,
      country: "CA",
    });

    fetch(`/api/address-complete?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readJsonResponse<AddressLookupResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isAddressLookupResponse(payload)) {
          throw new Error("Unexpected address lookup response.");
        }

        setLocationSuggestions(payload.items);
        setHasLocationLookupAttempted(true);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setLocationSuggestions([]);
        setLocationLookupError(
          error instanceof Error ? error.message : "Address lookup failed.",
        );
        setHasLocationLookupAttempted(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingLocationSuggestions(false);
        }
      });

    return () => controller.abort();
  }, [debouncedLocationSearchTerm, hasEditableEvent, selectedLocationLookupId]);

  useEffect(() => {
    setSelectedEventDetails((current) => {
      if (!current) {
        return current;
      }

      const updatedEvent = events.find((event) => event.id === current.event.id);
      return updatedEvent ? { ...current, event: updatedEvent } : null;
    });
  }, [events]);

  function handleConnectGoogleCalendar() {
    setPageError(null);
    const popup = window.open(
      "/api/calendar/oauth/start?returnTo=/calendar/oauth/complete",
      "calendar-oauth",
      "popup=yes,width=540,height=720,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      setPageError("Allow pop-ups to connect Google Calendar.");
      return;
    }

    popup.focus();
  }

  function handleConnectGmailFromCalendar() {
    setDetailsError(null);
    const popup = window.open(
      "/api/mail/oauth/start?returnTo=/mail/oauth/complete",
      "mail-oauth",
      "popup=yes,width=640,height=780",
    );
    if (!popup) {
      setDetailsError("Allow pop-ups to connect Gmail.");
      setDetailsNotice(null);
      return;
    }

    popup.focus();
  }

  function closeMailComposer() {
    setMailComposeState({
      initialState: null,
      isOpen: false,
    });
  }

  function openEmailComposerForContact(contact: MeetingContactOption, email: string) {
    const suggestion = createMailSuggestionFromMeetingContact(contact, email);
    const initialState: GmailComposeInitialState = {
      subject: "",
      htmlBody: "<div><br /></div>",
      textBody: "",
      to: [
        {
          email: suggestion.email,
          name: suggestion.name,
          contactId: suggestion.contactId,
          businessAccountRecordId: suggestion.businessAccountRecordId,
          businessAccountId: suggestion.businessAccountId,
        },
      ],
      cc: [],
      bcc: [],
      linkedContact: {
        contactId: suggestion.contactId,
        businessAccountRecordId: suggestion.businessAccountRecordId,
        businessAccountId: suggestion.businessAccountId,
        contactName: suggestion.name,
        companyName: suggestion.companyName,
      },
      sourceSurface: "calendar",
    };

    setDetailsError(null);
    setDetailsNotice(null);
    setMailComposeState({
      initialState,
      isOpen: true,
    });
    void loadMailSession();
  }

  const resetLocationLookupState = useCallback((locationValue: string | null = null) => {
    const normalizedLocation = locationValue?.trim() || null;
    setLocationSuggestions([]);
    setLocationLookupError(null);
    setIsLoadingLocationSuggestions(false);
    setIsApplyingLocationSuggestion(false);
    setHasLocationLookupAttempted(false);
    setSelectedLocationValue(normalizedLocation);
    setSelectedLocationLookupId(normalizedLocation ? "existing" : null);
  }, []);

  const openEventDetails = useCallback((event: CalendarViewEvent, clientX: number, clientY: number) => {
    setEditingEventId(null);
    setEventEditForm(null);
    setDetailsError(null);
    setDetailsNotice(null);
    resetLocationLookupState(null);
    setSelectedEventDetails({
      event,
      ...getDetailsCardPosition(clientX, clientY),
    });
  }, [resetLocationLookupState]);

  const closeEventDetails = useCallback(() => {
    setSelectedEventDetails(null);
    setEditingEventId(null);
    setEventEditForm(null);
    setDetailsError(null);
    setDetailsNotice(null);
    setIsSavingEventDetails(false);
    resetLocationLookupState(null);
  }, [resetLocationLookupState]);

  function beginEditingSelectedEvent(event: CalendarViewEvent) {
    if (!event.canReschedule) {
      return;
    }

    setEditingEventId(event.id);
    setEventEditForm(buildEditFormFromEvent(event));
    setDetailsError(null);
    setDetailsNotice(null);
    resetLocationLookupState(event.location);
  }

  function updateEventEditForm<Field extends keyof CalendarEventEditForm>(
    field: Field,
    value: CalendarEventEditForm[Field],
  ) {
    setEventEditForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function addGuestToEditForm() {
    setEventEditForm((current) => {
      if (!current) {
        return current;
      }

      const rawInput = current.guestInput.trim();
      const guestEmails = extractGuestEmailsFromInput(rawInput);
      if (rawInput && guestEmails.length === 0) {
        setDetailsError(`"${rawInput}" is not a valid guest email or contact.`);
        return current;
      }
      if (guestEmails.length === 0) {
        return current;
      }

      const existing = new Set(current.attendees.map((attendee) => attendee.email.toLowerCase()));
      const nextAttendees = [
        ...current.attendees,
        ...guestEmails
          .filter((email) => !existing.has(email))
          .map((email) => ({ email, displayName: null, isOrganizer: false })),
      ];
      setDetailsError(null);
      return { ...current, attendees: nextAttendees, guestInput: "" };
    });
  }

  function addGuestSuggestionToEditForm(suggestion: CalendarGuestSuggestion) {
    setEventEditForm((current) => {
      if (!current) {
        return current;
      }

      const existing = new Set(current.attendees.map((attendee) => attendee.email.toLowerCase()));
      if (existing.has(suggestion.email)) {
        return { ...current, guestInput: "" };
      }

      setDetailsError(null);
      return {
        ...current,
        guestInput: "",
        attendees: [
          ...current.attendees,
          {
            email: suggestion.email,
            displayName: suggestion.name,
            isOrganizer: false,
          },
        ],
      };
    });
  }

  function handleAddGuestInput() {
    const rawInput = eventEditForm?.guestInput.trim() ?? "";
    if (rawInput && extractGuestEmailsFromInput(rawInput).length === 0) {
      const firstSuggestion = guestContactSuggestions[0];
      if (firstSuggestion) {
        addGuestSuggestionToEditForm(firstSuggestion);
        return;
      }
    }

    addGuestToEditForm();
  }

  function removeGuestFromEditForm(email: string) {
    setEventEditForm((current) =>
      current
        ? {
            ...current,
            attendees: current.attendees.filter(
              (attendee) => attendee.email.toLowerCase() !== email.toLowerCase(),
            ),
          }
        : current,
    );
  }

  function toggleRecurrenceWeekday(day: string) {
    setEventEditForm((current) => {
      if (!current) {
        return current;
      }

      const weekdays = current.recurrenceWeekdays.includes(day)
        ? current.recurrenceWeekdays.filter((value) => value !== day)
        : [...current.recurrenceWeekdays, day];
      return { ...current, recurrenceWeekdays: weekdays, recurrenceTouched: true };
    });
  }

  function cancelEventEdit(event: CalendarViewEvent) {
    setEditingEventId(null);
    setEventEditForm(buildEditFormFromEvent(event));
    setDetailsError(null);
    setDetailsNotice(null);
    resetLocationLookupState(event.location);
  }

  function handleLocationEditChange(value: string) {
    if (selectedLocationValue !== null && value !== selectedLocationValue) {
      setSelectedLocationLookupId(null);
      setSelectedLocationValue(null);
    }

    updateEventEditForm("location", value);
    setLocationLookupError(null);
    setHasLocationLookupAttempted(false);
  }

  async function handleSelectLocationSuggestion(suggestion: AddressLookupSuggestion) {
    setIsApplyingLocationSuggestion(true);
    setLocationLookupError(null);

    try {
      const params = new URLSearchParams({
        id: suggestion.id,
        country: "CA",
      });
      const response = await fetch(`/api/address-complete?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<AddressRetrieveResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }
      if (!isAddressRetrieveResponse(payload)) {
        throw new Error("Unexpected address lookup response.");
      }

      const nextLocation = formatCalendarLocationAddress(payload.address);
      updateEventEditForm("location", nextLocation);
      setSelectedLocationLookupId(suggestion.id);
      setSelectedLocationValue(nextLocation);
      setLocationSuggestions([]);
    } catch (error) {
      setLocationLookupError(
        error instanceof Error ? error.message : "Address lookup failed.",
      );
    } finally {
      setIsApplyingLocationSuggestion(false);
    }
  }

  async function saveEventDetails(event: CalendarViewEvent) {
    if (!eventEditForm) {
      return;
    }

    const summary = eventEditForm.summary.trim();
    if (!summary) {
      setDetailsError("Title is required.");
      return;
    }

    const patchBody: Record<string, unknown> = {
      summary,
      location: eventEditForm.location.trim() || null,
      description: eventEditForm.description.trim() || null,
      attendees: eventEditForm.attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName,
      })),
      ...(eventEditForm.recurrenceTouched
        ? { recurrence: buildRecurrenceFromForm(eventEditForm) }
        : {}),
      reminders:
        eventEditForm.reminderMode === "DEFAULT"
          ? { useDefault: true }
          : {
              useDefault: false,
              minutes:
                eventEditForm.reminderMode === "NONE"
                  ? null
                  : Math.max(
                      0,
                      Math.min(40320, Number.parseInt(eventEditForm.reminderMinutes, 10) || 10),
                    ),
            },
      colorId: eventEditForm.colorId || null,
      includeGoogleMeet: eventEditForm.includeGoogleMeet,
      guestsCanModify: eventEditForm.guestsCanModify,
      guestsCanInviteOthers: eventEditForm.guestsCanInviteOthers,
      guestsCanSeeOtherGuests: eventEditForm.guestsCanSeeOtherGuests,
      transparency: eventEditForm.transparency,
      visibility: eventEditForm.visibility,
    };

    if (eventEditForm.isAllDay) {
      if (!eventEditForm.startDate || !eventEditForm.endDate) {
        setDetailsError("Start and end dates are required.");
        return;
      }

      const startDate = eventEditForm.startDate;
      const endDate = formatYmd(addDays(parseYmd(eventEditForm.endDate), 1));
      if (endDate <= startDate) {
        setDetailsError("End date must be after the start date.");
        return;
      }

      patchBody.startDate = startDate;
      patchBody.endDate = endDate;
    } else {
      const start = parseLocalDateTime(eventEditForm.startDate, eventEditForm.startTime);
      const end = parseLocalDateTime(eventEditForm.endDate, eventEditForm.endTime);
      if (!start || !end) {
        setDetailsError("Start and end times are required.");
        return;
      }
      if (end.getTime() <= start.getTime()) {
        setDetailsError("End time must be after the start time.");
        return;
      }

      patchBody.startDateTime = start.toISOString();
      patchBody.endDateTime = end.toISOString();
    }

    setIsSavingEventDetails(true);
    setDetailsError(null);

    try {
      const response = await fetch(`/api/calendar/events/${encodeURIComponent(event.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const payload = await readJsonResponse<CalendarEventUpdateResponse | { error?: string }>(
        response,
      );
      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      const updated = (payload as CalendarEventUpdateResponse).event;
      setEvents((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setSelectedEventDetails((current) =>
        current && current.event.id === updated.id ? { ...current, event: updated } : current,
      );
      setEditingEventId(null);
      setEventEditForm(buildEditFormFromEvent(updated));
      setRefreshNonce((nonce) => nonce + 1);
    } catch (error) {
      setDetailsError(
        error instanceof Error ? error.message : "Unable to save the Google Calendar event.",
      );
    } finally {
      setIsSavingEventDetails(false);
    }
  }

  async function deleteSelectedEvent(event: CalendarViewEvent) {
    if (!window.confirm(`Delete "${event.summary}" from Google Calendar?`)) {
      return;
    }

    setIsSavingEventDetails(true);
    setDetailsError(null);
    try {
      const response = await fetch(`/api/calendar/events/${encodeURIComponent(event.id)}`, {
        method: "DELETE",
      });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      setEvents((current) => current.filter((candidate) => candidate.id !== event.id));
      closeEventDetails();
      setRefreshNonce((nonce) => nonce + 1);
    } catch (error) {
      setDetailsError(
        error instanceof Error ? error.message : "Unable to delete the Google Calendar event.",
      );
    } finally {
      setIsSavingEventDetails(false);
    }
  }

  function shiftAnchor(direction: 1 | -1) {
    if (view === "day") {
      setAnchorDate((current) => addDays(current, direction));
      return;
    }
    if (view === "week") {
      setAnchorDate((current) => addDays(current, direction * 7));
      return;
    }
    setAnchorDate(
      (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  }

  const applyEventMove = useCallback(
    async (event: CalendarViewEvent, dayDelta: number, newStartMinutes: number | null) => {
      const isAllDayMove = event.isAllDay || newStartMinutes === null;
      let patchBody: Record<string, string>;
      let optimistic: CalendarViewEvent;

      if (event.isAllDay && event.startDate) {
        const startDate = formatYmd(addDays(parseYmd(event.startDate), dayDelta));
        const endDate = formatYmd(
          addDays(parseYmd(event.endDate ?? event.startDate), dayDelta || 0),
        );
        if (dayDelta === 0) {
          return;
        }
        patchBody = { startDate, endDate };
        optimistic = {
          ...event,
          startDate,
          endDate,
          startIso: parseYmd(startDate).toISOString(),
          endIso: parseYmd(endDate).toISOString(),
        };
      } else {
        const originalStart = new Date(event.startIso);
        const durationMs = Date.parse(event.endIso) - Date.parse(event.startIso);
        const baseDay = addDays(startOfDay(originalStart), dayDelta);
        const startMinutes =
          newStartMinutes ??
          originalStart.getHours() * 60 + originalStart.getMinutes();
        const newStart = new Date(baseDay);
        newStart.setMinutes(startMinutes);
        const newEnd = new Date(newStart.getTime() + durationMs);
        if (newStart.getTime() === originalStart.getTime()) {
          return;
        }
        patchBody = {
          startDateTime: newStart.toISOString(),
          endDateTime: newEnd.toISOString(),
        };
        optimistic = {
          ...event,
          startIso: newStart.toISOString(),
          endIso: newEnd.toISOString(),
        };
      }

      const previousEvents = events;
      setEvents((current) =>
        current.map((candidate) => (candidate.id === event.id ? optimistic : candidate)),
      );
      setMoveError(null);
      setPendingMoveEventId(event.id);

      try {
        const response = await fetch(`/api/calendar/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        const payload = await readJsonResponse<CalendarEventUpdateResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        const updated = (payload as CalendarEventUpdateResponse).event;
        setEvents((current) =>
          current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
        );
      } catch (error) {
        setEvents(previousEvents);
        setMoveError(
          error instanceof Error
            ? `${isAllDayMove ? "Could not move the event" : "Could not reschedule the event"}: ${error.message}`
            : "Could not update the Google Calendar event.",
        );
      } finally {
        setPendingMoveEventId(null);
      }
    },
    [events],
  );

  const resolveTimeGridTarget = useCallback(
    (clientX: number, clientY: number): { dayKey: string; minutes: number } | null => {
      const grid = timeGridRef.current;
      if (!grid) {
        return null;
      }

      const gridRect = grid.getBoundingClientRect();
      if (clientX < gridRect.left || clientX > gridRect.right) {
        return null;
      }

      const dayCount = view === "day" ? 1 : 7;
      const columnWidth = gridRect.width / dayCount;
      const dayIndex = Math.max(
        0,
        Math.min(dayCount - 1, Math.floor((clientX - gridRect.left) / columnWidth)),
      );
      const dayKey = formatYmd(
        view === "day" ? startOfDay(anchorDate) : addDays(startOfWeek(anchorDate), dayIndex),
      );

      const offsetY = clientY - gridRect.top;
      const minutes = Math.max(
        GRID_START_MINUTES,
        Math.min(GRID_END_MINUTES, GRID_START_MINUTES + (offsetY / HOUR_HEIGHT_PX) * 60),
      );
      return { dayKey, minutes };
    },
    [anchorDate, view],
  );

  const resolveMonthTarget = useCallback(
    (clientX: number, clientY: number): { dayKey: string } | null => {
      const grid = monthGridRef.current;
      if (!grid) {
        return null;
      }

      const rect = grid.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }

      const columnWidth = rect.width / 7;
      const rowHeight = rect.height / 6;
      const column = Math.max(0, Math.min(6, Math.floor((clientX - rect.left) / columnWidth)));
      const row = Math.max(0, Math.min(5, Math.floor((clientY - rect.top) / rowHeight)));
      return { dayKey: formatYmd(addDays(visibleRange.start, row * 7 + column)) };
    },
    [visibleRange.start],
  );

  useEffect(() => {
    function handlePointerMove(pointerEvent: PointerEvent) {
      const dragState = dragStateRef.current;
      if (!dragState || pointerEvent.pointerId !== dragState.pointerId) {
        return;
      }

      const distance = Math.hypot(
        pointerEvent.clientX - dragState.startClientX,
        pointerEvent.clientY - dragState.startClientY,
      );
      if (!dragState.isDragging && distance < DRAG_THRESHOLD_PX) {
        return;
      }
      dragState.isDragging = true;

      if (!dragState.event.canReschedule) {
        return;
      }

      if (dragState.mode === "timed" && view !== "month") {
        const target = resolveTimeGridTarget(pointerEvent.clientX, pointerEvent.clientY);
        if (!target) {
          return;
        }

        const snapped =
          Math.round((target.minutes - dragState.grabOffsetMinutes) / SNAP_MINUTES) *
          SNAP_MINUTES;
        const durationMinutes = Math.max(
          SNAP_MINUTES,
          Math.round(
            (Date.parse(dragState.event.endIso) - Date.parse(dragState.event.startIso)) / 60000,
          ),
        );
        const startMinutes = Math.max(
          GRID_START_MINUTES,
          Math.min(GRID_END_MINUTES - durationMinutes, snapped),
        );
        dragState.preview = { dayKey: target.dayKey, startMinutes };
        setDragPreview({
          eventId: dragState.event.id,
          dayKey: target.dayKey,
          startMinutes,
          durationMinutes,
        });
        return;
      }

      const target =
        view === "month"
          ? resolveMonthTarget(pointerEvent.clientX, pointerEvent.clientY)
          : resolveTimeGridTarget(pointerEvent.clientX, pointerEvent.clientY);
      if (!target) {
        return;
      }

      dragState.preview = { dayKey: target.dayKey, startMinutes: 0 };
      setDragPreview({
        eventId: dragState.event.id,
        dayKey: target.dayKey,
        startMinutes: 0,
        durationMinutes: 0,
      });
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      const dragState = dragStateRef.current;
      if (!dragState || pointerEvent.pointerId !== dragState.pointerId) {
        return;
      }

      dragStateRef.current = null;
      setDragPreview(null);

      if (!dragState.isDragging) {
        openEventDetails(dragState.event, pointerEvent.clientX, pointerEvent.clientY);
        return;
      }

      const preview = dragState.preview;
      if (!preview) {
        return;
      }

      const originDayKey = dragState.event.isAllDay
        ? dragState.event.startDate ?? formatYmd(new Date(dragState.event.startIso))
        : formatYmd(startOfDay(new Date(dragState.event.startIso)));
      const dayDelta = Math.round(
        (parseYmd(preview.dayKey).getTime() - parseYmd(originDayKey).getTime()) / DAY_MS,
      );

      if (dragState.mode === "timed" && view !== "month") {
        void applyEventMove(dragState.event, dayDelta, preview.startMinutes);
      } else if (dayDelta !== 0) {
        void applyEventMove(dragState.event, dayDelta, null);
      }
    }

    function handleKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") {
        dragStateRef.current = null;
        setDragPreview(null);
        closeEventDetails();
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    applyEventMove,
    closeEventDetails,
    openEventDetails,
    resolveMonthTarget,
    resolveTimeGridTarget,
    view,
  ]);

  function handleEventPointerDown(
    pointerEvent: ReactPointerEvent<HTMLElement>,
    event: CalendarViewEvent,
    mode: "timed" | "allday",
  ) {
    if (pointerEvent.button !== 0) {
      return;
    }

    if (event.canReschedule) {
      pointerEvent.preventDefault();
    }

    let grabOffsetMinutes = 0;
    if (mode === "timed" && !event.isAllDay) {
      const target = resolveTimeGridTarget(pointerEvent.clientX, pointerEvent.clientY);
      if (target) {
        const eventStart = new Date(event.startIso);
        const eventStartMinutes = eventStart.getHours() * 60 + eventStart.getMinutes();
        grabOffsetMinutes = Math.max(0, target.minutes - eventStartMinutes);
      }
    }

    dragStateRef.current = {
      pointerId: pointerEvent.pointerId,
      event,
      mode,
      startClientX: pointerEvent.clientX,
      startClientY: pointerEvent.clientY,
      grabOffsetMinutes,
      isDragging: false,
      preview: null,
    };
  }

  const timedSegmentsByDay = useMemo(() => {
    const byDay = new Map<string, PositionedSegment[]>();
    if (view === "month") {
      return byDay;
    }

    visibleDays.forEach((day) => {
      const dayKey = formatYmd(day);
      const dayStartMs = day.getTime();
      const dayEndMs = dayStartMs + DAY_MS;
      const segments = events
        .filter((event) => !belongsInAllDayRow(event))
        .filter((event) => eventCoversDay(event, day))
        .flatMap((event) => {
          const startMs = Date.parse(event.startIso);
          const endMs = Date.parse(event.endIso);
          const rawStartMinutes = Math.round((startMs - dayStartMs) / 60000);
          const rawEndMinutes = Math.round((endMs - dayStartMs) / 60000);
          if (rawEndMinutes <= GRID_START_MINUTES || rawStartMinutes >= GRID_END_MINUTES) {
            return [];
          }

          const startMinutes = Math.max(GRID_START_MINUTES, rawStartMinutes);
          const endMinutes = Math.min(
            GRID_END_MINUTES,
            Math.max(startMinutes + 15, rawEndMinutes),
          );
          return [
            {
              event,
              dayKey,
              startMinutes,
              endMinutes,
              continuesBefore: startMs < dayStartMs,
              continuesAfter: endMs > dayEndMs,
            },
          ];
        });
      byDay.set(dayKey, layoutDaySegments(segments));
    });

    return byDay;
  }, [events, view, visibleDays]);

  const allDayEventsByDay = useMemo(() => {
    const byDay = new Map<string, CalendarViewEvent[]>();
    visibleDays.forEach((day) => {
      const dayKey = formatYmd(day);
      byDay.set(
        dayKey,
        events
          .filter((event) => belongsInAllDayRow(event))
          .filter((event) => eventCoversDay(event, day))
          .sort((left, right) => eventStartForSort(left) - eventStartForSort(right)),
      );
    });
    return byDay;
  }, [events, visibleDays]);

  const monthEventsByDay = useMemo(() => {
    const byDay = new Map<string, CalendarViewEvent[]>();
    if (view !== "month") {
      return byDay;
    }

    visibleDays.forEach((day) => {
      const dayKey = formatYmd(day);
      byDay.set(
        dayKey,
        events
          .filter((event) => eventCoversDay(event, day))
          .sort((left, right) => {
            const leftAllDay = belongsInAllDayRow(left) ? 0 : 1;
            const rightAllDay = belongsInAllDayRow(right) ? 0 : 1;
            return leftAllDay - rightAllDay || eventStartForSort(left) - eventStartForSort(right);
          }),
      );
    });
    return byDay;
  }, [events, view, visibleDays]);

  const now = nowTick;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isConnected = calendarSession?.status === "connected";

  function renderEventBlock(segment: PositionedSegment) {
    const { event } = segment;
    const isPreviewSource = dragPreview?.eventId === event.id;
    const widthPercent = 100 / segment.columnCount;
    const eventHeightPx = Math.max(
      18,
      ((segment.endMinutes - segment.startMinutes) / 60) * HOUR_HEIGHT_PX - 2,
    );
    const isCompact = eventHeightPx < 32;
    const style = buildCalendarEventStyle(event, {
      top: `${minutesToGridOffsetPx(segment.startMinutes)}px`,
      height: `${eventHeightPx}px`,
      left: `calc(${segment.columnIndex * widthPercent}% + 2px)`,
      width: `calc(${widthPercent}% - 4px)`,
    });

    const classNames = [
      styles.eventBlock,
      event.isDeclined ? styles.eventBlockDeclined : null,
      event.status === "tentative" ? styles.eventBlockTentative : null,
      event.canReschedule ? styles.eventBlockDraggable : null,
      isPreviewSource ? styles.eventBlockDragSource : null,
      pendingMoveEventId === event.id ? styles.eventBlockSaving : null,
      isCompact ? styles.eventBlockCompact : null,
    ]
      .filter(Boolean)
      .join(" ");
    const timeRangeLabel = formatEventTimeRange(event);

    return (
      <button
        className={classNames}
        key={`${event.id}:${segment.dayKey}`}
        onPointerDown={(pointerEvent) => handleEventPointerDown(pointerEvent, event, "timed")}
        style={style}
        title={
          event.canReschedule
            ? `${event.summary} — drag to reschedule`
            : `${event.summary} — only the organizer can move this event`
        }
        type="button"
      >
        <span className={styles.eventBlockTitle}>{event.summary}</span>
        <span className={styles.eventBlockMeta}>
          {timeRangeLabel}
          {!isCompact && event.location ? `, ${event.location}` : ""}
        </span>
      </button>
    );
  }

  function renderTimeGrid() {
    const days = view === "day" ? [startOfDay(anchorDate)] : visibleDays;

    return (
      <div className={styles.timeViewShell}>
        <div className={styles.dayHeaderRow}>
          <div className={styles.gutterSpacer} />
          {days.map((day) => {
            const isToday = isSameDay(day, now);
            return (
              <button
                className={styles.dayHeaderCell}
                key={formatYmd(day)}
                onClick={() => {
                  setView("day");
                  setAnchorDate(startOfDay(day));
                }}
                type="button"
              >
                <span className={styles.dayHeaderName}>{WEEKDAY_LABELS[day.getDay()]}</span>
                <span
                  className={[
                    styles.dayHeaderNumber,
                    isToday ? styles.dayHeaderNumberToday : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {day.getDate()}
                </span>
              </button>
            );
          })}
        </div>

        <div className={styles.allDayRow}>
          <div className={styles.gutterLabelCell}>All day</div>
          {days.map((day) => {
            const dayKey = formatYmd(day);
            const dayEvents = allDayEventsByDay.get(dayKey) ?? [];
            const isDropTarget =
              dragPreview !== null &&
              dragPreview.durationMinutes === 0 &&
              dragPreview.dayKey === dayKey;
            return (
              <div
                className={[
                  styles.allDayCell,
                  isDropTarget ? styles.allDayCellDropTarget : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={dayKey}
              >
                {dayEvents.map((event) => (
                  <button
                    className={[
                      styles.allDayChip,
                      event.isDeclined ? styles.eventBlockDeclined : null,
                      event.canReschedule ? styles.eventBlockDraggable : null,
                      pendingMoveEventId === event.id ? styles.eventBlockSaving : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={`${event.id}:${dayKey}`}
                    onPointerDown={(pointerEvent) =>
                      handleEventPointerDown(pointerEvent, event, "allday")
                    }
                    style={buildCalendarEventStyle(event)}
                    title={
                      event.canReschedule
                        ? `${event.summary} — drag to another day`
                        : `${event.summary} — only the organizer can move this event`
                    }
                    type="button"
                  >
                    {event.summary}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className={styles.timeGridScroller} ref={timeGridScrollRef}>
          <div className={styles.timeGridBody}>
            <div className={styles.timeGutter}>
              {GRID_HOURS.map((hour) => (
                <div className={styles.timeGutterCell} key={hour}>
                  <span>{formatHourLabel(hour)}</span>
                </div>
              ))}
            </div>
            <div
              className={view === "day" ? styles.timeGridSingleDay : styles.timeGridWeek}
              ref={timeGridRef}
            >
              {days.map((day) => {
                const dayKey = formatYmd(day);
                const segments = timedSegmentsByDay.get(dayKey) ?? [];
                const isToday = isSameDay(day, now);
                const preview =
                  dragPreview && dragPreview.durationMinutes > 0 && dragPreview.dayKey === dayKey
                    ? dragPreview
                    : null;

                return (
                  <div className={styles.dayColumn} key={dayKey}>
                    {GRID_HOURS.map((hour) => (
                      <div className={styles.hourCell} key={hour} />
                    ))}
                    {segments.map((segment) => renderEventBlock(segment))}
                    {preview ? (
                      <div
                        className={styles.dragGhost}
                        style={{
                          top: `${minutesToGridOffsetPx(preview.startMinutes)}px`,
                          height: `${Math.max(18, (preview.durationMinutes / 60) * HOUR_HEIGHT_PX - 2)}px`,
                        }}
                      >
                        {formatMinutesAsClock(preview.startMinutes)} –{" "}
                        {formatMinutesAsClock(preview.startMinutes + preview.durationMinutes)}
                      </div>
                    ) : null}
                    {isToday &&
                    nowMinutes >= GRID_START_MINUTES &&
                    nowMinutes <= GRID_END_MINUTES ? (
                      <div
                        className={styles.nowIndicator}
                        style={{ top: `${minutesToGridOffsetPx(nowMinutes)}px` }}
                      >
                        <span className={styles.nowIndicatorDot} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderMonthGrid() {
    return (
      <div className={styles.monthViewShell}>
        <div className={styles.monthWeekdayRow}>
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className={styles.monthGrid} ref={monthGridRef}>
          {visibleDays.map((day) => {
            const dayKey = formatYmd(day);
            const dayEvents = monthEventsByDay.get(dayKey) ?? [];
            const isToday = isSameDay(day, now);
            const isCurrentMonth = day.getMonth() === anchorDate.getMonth();
            const visibleEvents = dayEvents.slice(0, 3);
            const hiddenCount = dayEvents.length - visibleEvents.length;
            const isDropTarget = dragPreview !== null && dragPreview.dayKey === dayKey;

            return (
              <div
                className={[
                  styles.monthCell,
                  !isCurrentMonth ? styles.monthCellMuted : null,
                  isDropTarget ? styles.allDayCellDropTarget : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={dayKey}
              >
                <button
                  className={[
                    styles.monthDayNumber,
                    isToday ? styles.dayHeaderNumberToday : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setView("day");
                    setAnchorDate(startOfDay(day));
                  }}
                  type="button"
                >
                  {day.getDate()}
                </button>
                <div className={styles.monthCellEvents}>
                  {visibleEvents.map((event) => (
                    <button
                      className={[
                        styles.monthEventPill,
                        event.isDeclined ? styles.eventBlockDeclined : null,
                        event.canReschedule ? styles.eventBlockDraggable : null,
                        pendingMoveEventId === event.id ? styles.eventBlockSaving : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={`${event.id}:${dayKey}`}
                      onPointerDown={(pointerEvent) =>
                        handleEventPointerDown(pointerEvent, event, "allday")
                      }
                      style={buildCalendarEventStyle(event)}
                      title={event.summary}
                      type="button"
                    >
                      {!belongsInAllDayRow(event) ? (
                        <span className={styles.monthEventTime}>
                          {formatClockTime(new Date(event.startIso))}
                        </span>
                      ) : null}
                      <span className={styles.monthEventTitle}>{event.summary}</span>
                    </button>
                  ))}
                  {hiddenCount > 0 ? (
                    <button
                      className={styles.monthMoreLink}
                      onClick={() => {
                        setView("day");
                        setAnchorDate(startOfDay(day));
                      }}
                      type="button"
                    >
                      +{hiddenCount} more
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderConnectCard() {
    return (
      <div className={styles.connectCard}>
        <h2>Connect Google Calendar</h2>
        <p>
          Connect your Google account to see all of your calendar invites here, drag them to
          reschedule, and push the changes back to Google Calendar.
        </p>
        {calendarSession?.status === "needs_setup" ? (
          <p className={styles.connectError}>
            {calendarSession.connectionError ??
              "Google Calendar OAuth is not configured for this app yet."}
          </p>
        ) : null}
        <button
          className={styles.primaryButton}
          disabled={isLoadingSession || calendarSession?.status === "needs_setup"}
          onClick={handleConnectGoogleCalendar}
          type="button"
        >
          {isLoadingSession ? "Checking..." : "Connect Google Calendar"}
        </button>
      </div>
    );
  }

  function renderLocationEditor() {
    if (!eventEditForm) {
      return null;
    }

    return (
      <div className={styles.editStack}>
        <label className={styles.editField}>
          <span>Location</span>
          <input
            maxLength={1024}
            onChange={(event) => handleLocationEditChange(event.target.value)}
            placeholder="Add location"
            value={eventEditForm.location}
          />
        </label>
        {locationLookupError ? (
          <p className={styles.lookupError}>{locationLookupError}</p>
        ) : null}
        {!selectedLocationLookupId && locationSuggestions.length > 0 ? (
          <div className={styles.lookupSuggestions}>
            {locationSuggestions.map((suggestion) => (
              <button
                className={styles.lookupSuggestionItem}
                key={suggestion.id}
                onClick={() => {
                  void handleSelectLocationSuggestion(suggestion);
                }}
                type="button"
              >
                <span className={styles.lookupSuggestionTitle}>{suggestion.text}</span>
                <span className={styles.lookupSuggestionMeta}>{suggestion.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        {isLoadingLocationSuggestions ? (
          <p className={styles.lookupHint}>Searching Canada Post addresses...</p>
        ) : null}
        {!selectedLocationLookupId &&
        !isLoadingLocationSuggestions &&
        hasLocationLookupAttempted &&
        eventEditForm.location.trim().length >= 3 &&
        locationSuggestions.length === 0 &&
        !locationLookupError ? (
          <p className={styles.lookupHint}>No matching Canada Post addresses were found.</p>
        ) : null}
        {isApplyingLocationSuggestion ? (
          <p className={styles.lookupHint}>Applying selected address...</p>
        ) : null}
      </div>
    );
  }

  function renderEventDetails() {
    if (!selectedEventDetails) {
      return null;
    }

    const selectedEvent = selectedEventDetails.event;
    const meetUrl = selectedEvent.conference?.videoUri ?? selectedEvent.hangoutLink;
    const meetDisplayUrl = meetUrl ? formatCompactUrl(meetUrl) : null;
    const firstPhoneNumber = selectedEvent.conference?.phoneNumbers[0] ?? null;
    const organizerLabel =
      formatPersonLabel(selectedEvent.organizer) ??
      formatPersonLabel(selectedEvent.creator) ??
      calendarSession?.connectedGoogleEmail ??
      null;
    const calendarLabel = calendarSession?.connectedGoogleEmail ?? organizerLabel;
    const acceptedGuests = selectedEvent.attendees.filter(
      (attendee) => attendee.responseStatus === "accepted",
    ).length;
    const tentativeGuests = selectedEvent.attendees.filter(
      (attendee) => attendee.responseStatus === "tentative",
    ).length;
    const declinedGuests = selectedEvent.attendees.filter(
      (attendee) => attendee.responseStatus === "declined",
    ).length;
    const awaitingGuests = selectedEvent.attendees.filter(
      (attendee) =>
        !attendee.responseStatus || attendee.responseStatus === "needsAction",
    ).length;
    const selfAttendee = selectedEvent.attendees.find((attendee) => attendee.isSelf);
    const ownerHelpText = selectedEvent.isOrganizer
      ? "You organized this event. Drag it on the calendar to reschedule everyone."
      : selectedEvent.canReschedule
        ? "The organizer allows guests to modify this event."
        : "Only the organizer can move this event.";
    const isEditing = editingEventId === selectedEvent.id && eventEditForm !== null;

    return (
      <>
        <button
          aria-label="Close event details"
          className={styles.detailsBackdrop}
          onClick={closeEventDetails}
          type="button"
        />
        <aside
          aria-label={`${selectedEvent.summary} details`}
          className={styles.detailsCard}
          style={{ left: selectedEventDetails.left, top: selectedEventDetails.top }}
        >
          <div className={styles.detailsTopBar}>
            <span
              className={styles.detailsColorDot}
              style={buildCalendarEventStyle(selectedEvent)}
            />
            <div className={styles.detailsTopActions}>
              {selectedEvent.canReschedule && !isEditing ? (
                <button
                  aria-label="Edit event"
                  className={styles.detailsIconButton}
                  onClick={() => beginEditingSelectedEvent(selectedEvent)}
                  title="Edit event"
                  type="button"
                >
                  <DetailsIcon name="edit" />
                </button>
              ) : null}
              {selectedEvent.htmlLink ? (
                <a
                  aria-label="Open in Google Calendar"
                  className={styles.detailsIconButton}
                  href={selectedEvent.htmlLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  <DetailsIcon name="external" />
                </a>
              ) : null}
              <button
                aria-label="Close"
                className={styles.detailsIconButton}
                onClick={closeEventDetails}
                type="button"
              >
                x
              </button>
            </div>
          </div>

          <div className={styles.detailsTitleRow}>
            <div className={styles.detailsTitleSpacer} />
            <div className={styles.detailsTitleContent}>
              {isEditing ? (
                <label className={styles.editField}>
                  <span>Title</span>
                  <input
                    autoFocus
                    maxLength={1024}
                    onChange={(event) => updateEventEditForm("summary", event.target.value)}
                    value={eventEditForm.summary}
                  />
                </label>
              ) : (
                <>
                  <h3>{selectedEvent.summary}</h3>
                  <p>{formatDetailedEventTime(selectedEvent)}</p>
                  {selectedEvent.recurrenceLabel ? (
                    <span className={styles.detailsSubtleLine}>
                      {selectedEvent.recurrenceLabel}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="time" />
              <div className={styles.detailsRowContent}>
                <label className={styles.inlineCheckbox}>
                  <input
                    checked={eventEditForm.isAllDay}
                    onChange={(event) => updateEventEditForm("isAllDay", event.target.checked)}
                    type="checkbox"
                  />
                  All day
                </label>
                <div
                  className={
                    eventEditForm.isAllDay ? styles.editDateGrid : styles.editDateTimeGrid
                  }
                >
                  <label className={styles.editField}>
                    <span>Start date</span>
                    <input
                      onChange={(event) => updateEventEditForm("startDate", event.target.value)}
                      type="date"
                      value={eventEditForm.startDate}
                    />
                  </label>
                  {!eventEditForm.isAllDay ? (
                    <label className={styles.editField}>
                      <span>Start time</span>
                      <input
                        onChange={(event) => updateEventEditForm("startTime", event.target.value)}
                        type="time"
                        value={eventEditForm.startTime}
                      />
                    </label>
                  ) : null}
                  <label className={styles.editField}>
                    <span>End date</span>
                    <input
                      onChange={(event) => updateEventEditForm("endDate", event.target.value)}
                      type="date"
                      value={eventEditForm.endDate}
                    />
                  </label>
                  {!eventEditForm.isAllDay ? (
                    <label className={styles.editField}>
                      <span>End time</span>
                      <input
                        onChange={(event) => updateEventEditForm("endTime", event.target.value)}
                        type="time"
                        value={eventEditForm.endTime}
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="repeat" />
              <div className={styles.detailsRowContent}>
                <div className={styles.editStack}>
                  <div className={styles.editDateTimeGrid}>
                    <label className={styles.editField}>
                      <span>Repeat</span>
                      <select
                        onChange={(event) =>
                          setEventEditForm((current) =>
                            current
                              ? {
                                  ...current,
                                  recurrenceFrequency: event.target
                                    .value as CalendarEventEditForm["recurrenceFrequency"],
                                  recurrenceTouched: true,
                                }
                              : current,
                          )
                        }
                        value={eventEditForm.recurrenceFrequency}
                      >
                        <option value="NONE">Does not repeat</option>
                        <option value="DAILY">Daily</option>
                        <option value="WEEKLY">Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                        <option value="YEARLY">Yearly</option>
                      </select>
                    </label>
                    {eventEditForm.recurrenceFrequency !== "NONE" ? (
                      <label className={styles.editField}>
                        <span>Every</span>
                        <input
                          min={1}
                          max={99}
                          onChange={(event) =>
                            setEventEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    recurrenceInterval: event.target.value,
                                    recurrenceTouched: true,
                                  }
                                : current,
                            )
                          }
                          type="number"
                          value={eventEditForm.recurrenceInterval}
                        />
                      </label>
                    ) : null}
                  </div>
                  {eventEditForm.recurrenceFrequency === "WEEKLY" ? (
                    <div className={styles.weekdayToggleGroup}>
                      {RECURRENCE_WEEKDAY_OPTIONS.map((day) => (
                        <button
                          className={[
                            styles.weekdayToggle,
                            eventEditForm.recurrenceWeekdays.includes(day.value)
                              ? styles.weekdayToggleActive
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={day.value}
                          onClick={() => toggleRecurrenceWeekday(day.value)}
                          type="button"
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="video" />
              <div className={styles.detailsRowContent}>
                <label className={styles.inlineCheckbox}>
                  <input
                    checked={eventEditForm.includeGoogleMeet}
                    onChange={(event) =>
                      updateEventEditForm("includeGoogleMeet", event.target.checked)
                    }
                    type="checkbox"
                  />
                  Google Meet
                </label>
                {meetDisplayUrl ? (
                  <span className={styles.detailsLinkText}>{meetDisplayUrl}</span>
                ) : null}
              </div>
            </div>
          ) : meetUrl ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="video" />
              <div className={styles.detailsRowContent}>
                <a
                  className={styles.detailsMeetButton}
                  href={meetUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Join with Google Meet
                </a>
                {meetDisplayUrl ? <span className={styles.detailsLinkText}>{meetDisplayUrl}</span> : null}
              </div>
            </div>
          ) : null}

          {firstPhoneNumber ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="phone" />
              <div className={styles.detailsRowContent}>
                <span className={styles.detailsSectionTitle}>Join by phone</span>
                {firstPhoneNumber.uri ? (
                  <a className={styles.detailsPlainLink} href={firstPhoneNumber.uri}>
                    {firstPhoneNumber.label ?? firstPhoneNumber.uri}
                    {firstPhoneNumber.pin ? ` PIN: ${firstPhoneNumber.pin}` : ""}
                  </a>
                ) : (
                  <span className={styles.detailsBodyText}>
                    {firstPhoneNumber.label}
                    {firstPhoneNumber.pin ? ` PIN: ${firstPhoneNumber.pin}` : ""}
                  </span>
                )}
                {selectedEvent.conference?.morePhoneNumbersUri ? (
                  <a
                    className={styles.detailsPlainLink}
                    href={selectedEvent.conference.morePhoneNumbersUri}
                    rel="noreferrer"
                    target="_blank"
                  >
                    More phone numbers
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {selectedEvent.location ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="location" />
              <div className={styles.detailsRowContent}>
                {isEditing ? (
                  renderLocationEditor()
                ) : (
                  <span className={styles.detailsBodyText}>{selectedEvent.location}</span>
                )}
              </div>
            </div>
          ) : isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="location" />
              <div className={styles.detailsRowContent}>
                {renderLocationEditor()}
              </div>
            </div>
          ) : null}

          {selectedEvent.description || isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="description" />
              <div className={styles.detailsRowContent}>
                {isEditing ? (
                  <label className={styles.editField}>
                    <span>Description</span>
                    <textarea
                      maxLength={8192}
                      onChange={(event) => updateEventEditForm("description", event.target.value)}
                      placeholder="Add description"
                      rows={4}
                      value={eventEditForm.description}
                    />
                  </label>
                ) : (
                  <p className={styles.detailsDescription}>{selectedEvent.description}</p>
                )}
              </div>
            </div>
          ) : null}

          {selectedEvent.attendees.length > 0 || isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="guests" />
              <div className={styles.detailsRowContent}>
                {isEditing ? (
                  <div className={styles.editStack}>
                    <div className={styles.guestInputRow}>
                      <input
                        onChange={(event) => updateEventEditForm("guestInput", event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleAddGuestInput();
                          }
                        }}
                        placeholder="Add guests by name or email"
                        value={eventEditForm.guestInput}
                      />
                      <button
                        className={styles.secondaryButton}
                        onClick={handleAddGuestInput}
                        type="button"
                      >
                        Add
                      </button>
                    </div>
                    {guestContactSuggestions.length > 0 ? (
                      <div className={styles.lookupSuggestions}>
                        {guestContactSuggestions.map((suggestion) => (
                          <button
                            className={styles.lookupSuggestionItem}
                            key={suggestion.key}
                            onClick={() => addGuestSuggestionToEditForm(suggestion)}
                            type="button"
                          >
                            <span className={styles.lookupSuggestionTitle}>{suggestion.name}</span>
                            <span className={styles.lookupSuggestionMeta}>
                              {suggestion.email}
                              {suggestion.meta ? ` • ${suggestion.meta}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {eventEditForm.guestInput.trim().length >= 2 &&
                    isLoadingMeetingOptions ? (
                      <p className={styles.lookupHint}>Loading contacts...</p>
                    ) : null}
                    {eventEditForm.guestInput.trim().length >= 2 &&
                    meetingOptionsError ? (
                      <p className={styles.lookupError}>{meetingOptionsError}</p>
                    ) : null}
                    <div className={styles.guestChipList}>
                      {eventEditForm.attendees.map((attendee) => (
                        <span className={styles.editGuestChip} key={attendee.email}>
                          {attendee.displayName ?? attendee.email}
                          <button
                            aria-label={`Remove ${attendee.email}`}
                            onClick={() => removeGuestFromEditForm(attendee.email)}
                            type="button"
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className={styles.permissionGrid}>
                      <label className={styles.inlineCheckbox}>
                        <input
                          checked={eventEditForm.guestsCanModify}
                          onChange={(event) =>
                            updateEventEditForm("guestsCanModify", event.target.checked)
                          }
                          type="checkbox"
                        />
                        Guests can modify event
                      </label>
                      <label className={styles.inlineCheckbox}>
                        <input
                          checked={eventEditForm.guestsCanInviteOthers}
                          onChange={(event) =>
                            updateEventEditForm("guestsCanInviteOthers", event.target.checked)
                          }
                          type="checkbox"
                        />
                        Guests can invite others
                      </label>
                      <label className={styles.inlineCheckbox}>
                        <input
                          checked={eventEditForm.guestsCanSeeOtherGuests}
                          onChange={(event) =>
                            updateEventEditForm("guestsCanSeeOtherGuests", event.target.checked)
                          }
                          type="checkbox"
                        />
                        Guests can see guest list
                      </label>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className={styles.detailsSectionTitle}>
                      {selectedEvent.attendees.length}{" "}
                      {selectedEvent.attendees.length === 1 ? "guest" : "guests"}
                    </span>
                    <div className={styles.guestSummary}>
                      {acceptedGuests > 0 ? <span>{acceptedGuests} yes</span> : null}
                      {tentativeGuests > 0 ? <span>{tentativeGuests} maybe</span> : null}
                      {declinedGuests > 0 ? <span>{declinedGuests} no</span> : null}
                      {awaitingGuests > 0 ? <span>{awaitingGuests} awaiting</span> : null}
                    </div>
                    <ul className={styles.guestList}>
                      {selectedEvent.attendees.slice(0, 10).map((attendee) => {
                        const label = formatAttendeeLabel(attendee);
                        const attendeeEmail = normalizeMeetingEmail(attendee.email);
                        const matchedContact = attendeeEmail
                          ? contactsByEmail.get(attendeeEmail) ?? null
                          : null;
                        return (
                          <li key={attendee.email ?? attendee.displayName ?? label}>
                            <span className={styles.guestAvatar}>{getInitials(label)}</span>
                            <span className={styles.guestIdentity}>
                              <span className={styles.guestName}>{label}</span>
                              <span className={styles.guestMeta}>
                                {attendee.isOrganizer ? "Organizer" : attendee.email}
                              </span>
                            </span>
                            {matchedContact ? (
                              <span className={styles.guestActions}>
                                <button
                                  className={styles.guestActionButton}
                                  onClick={() =>
                                    openEmailComposerForContact(
                                      matchedContact.contact,
                                      matchedContact.email,
                                    )
                                  }
                                  type="button"
                                >
                                  Email
                                </button>
                                <CallPhoneButton
                                  className={styles.guestActionButton}
                                  context={{
                                    sourcePage: "calendar",
                                    linkedBusinessAccountId:
                                      matchedContact.contact.businessAccountId,
                                    linkedAccountRowKey:
                                      matchedContact.contact.businessAccountRecordId,
                                    linkedContactId: matchedContact.contact.contactId,
                                    linkedCompanyName: matchedContact.contact.companyName,
                                    linkedContactName: matchedContact.contact.contactName,
                                  }}
                                  label={`${matchedContact.contact.contactName} phone`}
                                  phone={matchedContact.contact.phone}
                                />
                              </span>
                            ) : null}
                            <span
                              className={[
                                styles.guestStatus,
                                getGuestStatusClass(attendee.responseStatus),
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              {formatGuestStatus(attendee.responseStatus)}
                            </span>
                          </li>
                        );
                      })}
                      {selectedEvent.attendees.length > 10 ? (
                        <li className={styles.guestMore}>
                          +{selectedEvent.attendees.length - 10} more guests
                        </li>
                      ) : null}
                    </ul>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {selectedEvent.reminderLabel || isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="reminder" />
              <div className={styles.detailsRowContent}>
                {isEditing ? (
                  <div className={styles.editDateTimeGrid}>
                    <label className={styles.editField}>
                      <span>Notification</span>
                      <select
                        onChange={(event) =>
                          updateEventEditForm(
                            "reminderMode",
                            event.target.value as CalendarEventEditForm["reminderMode"],
                          )
                        }
                        value={eventEditForm.reminderMode}
                      >
                        <option value="DEFAULT">Default notification</option>
                        <option value="CUSTOM">Custom minutes before</option>
                        <option value="NONE">No notification</option>
                      </select>
                    </label>
                    {eventEditForm.reminderMode === "CUSTOM" ? (
                      <label className={styles.editField}>
                        <span>Minutes before</span>
                        <input
                          min={0}
                          max={40320}
                          onChange={(event) =>
                            updateEventEditForm("reminderMinutes", event.target.value)
                          }
                          type="number"
                          value={eventEditForm.reminderMinutes}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : (
                  <span className={styles.detailsBodyText}>{selectedEvent.reminderLabel}</span>
                )}
              </div>
            </div>
          ) : null}

          {selectedEvent.recurrenceLabel && !isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="repeat" />
              <div className={styles.detailsRowContent}>
                <span className={styles.detailsBodyText}>{selectedEvent.recurrenceLabel}</span>
              </div>
            </div>
          ) : null}

          {organizerLabel ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="owner" />
              <div className={styles.detailsRowContent}>
                <span className={styles.detailsBodyText}>{organizerLabel}</span>
                <span className={styles.detailsSubtleLine}>{ownerHelpText}</span>
              </div>
            </div>
          ) : null}

          {calendarLabel || isEditing ? (
            <div className={styles.detailsRow}>
              <DetailsIcon name="calendar" />
              <div className={styles.detailsRowContent}>
                {isEditing ? (
                  <div className={styles.editStack}>
                    <span className={styles.detailsBodyText}>{calendarLabel}</span>
                    <div className={styles.editDateTimeGrid}>
                      <label className={styles.editField}>
                        <span>Color</span>
                        <select
                          onChange={(event) => updateEventEditForm("colorId", event.target.value)}
                          value={eventEditForm.colorId}
                        >
                          {GOOGLE_COLOR_OPTIONS.map((color) => (
                            <option key={color.value || "default"} value={color.value}>
                              {color.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.editField}>
                        <span>Availability</span>
                        <select
                          onChange={(event) =>
                            updateEventEditForm(
                              "transparency",
                              event.target.value as CalendarEventEditForm["transparency"],
                            )
                          }
                          value={eventEditForm.transparency}
                        >
                          <option value="opaque">Busy</option>
                          <option value="transparent">Free</option>
                        </select>
                      </label>
                    </div>
                    <label className={styles.editField}>
                      <span>Visibility</span>
                      <select
                        onChange={(event) =>
                          updateEventEditForm(
                            "visibility",
                            event.target.value as CalendarEventEditForm["visibility"],
                          )
                        }
                        value={eventEditForm.visibility}
                      >
                        <option value="default">Default visibility</option>
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                        <option value="confidential">Confidential</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <span className={styles.detailsBodyText}>{calendarLabel}</span>
                )}
              </div>
            </div>
          ) : null}

          {(selfAttendee || selectedEvent.htmlLink) && !selectedEvent.isOrganizer && !isEditing ? (
            <div className={styles.detailsFooter}>
              {selfAttendee ? (
                <span>
                  Going? <strong>{formatGuestStatus(selfAttendee.responseStatus)}</strong>
                </span>
              ) : null}
              {selectedEvent.htmlLink ? (
                <a href={selectedEvent.htmlLink} rel="noreferrer" target="_blank">
                  Respond in Google Calendar
                </a>
              ) : null}
            </div>
          ) : selectedEvent.htmlLink && !isEditing ? (
            <div className={styles.detailsFooter}>
              <a href={selectedEvent.htmlLink} rel="noreferrer" target="_blank">
                Open in Google Calendar
              </a>
            </div>
          ) : null}

          {detailsError ? <p className={styles.detailsError}>{detailsError}</p> : null}
          {detailsNotice ? <p className={styles.detailsNotice}>{detailsNotice}</p> : null}

          {isEditing ? (
            <div className={styles.editActions}>
              <button
                className={styles.dangerButton}
                disabled={isSavingEventDetails}
                onClick={() => void deleteSelectedEvent(selectedEvent)}
                type="button"
              >
                Delete
              </button>
              <span className={styles.editActionSpacer} />
              <button
                className={styles.secondaryButton}
                disabled={isSavingEventDetails}
                onClick={() => cancelEventEdit(selectedEvent)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={styles.primaryButton}
                disabled={isSavingEventDetails}
                onClick={() => void saveEventDetails(selectedEvent)}
                type="button"
              >
                {isSavingEventDetails ? "Saving..." : "Save"}
              </button>
            </div>
          ) : null}
        </aside>
      </>
    );
  }

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      hidePageHeaderCopy
      title="Calendar"
      userName={authSession?.user?.name ?? null}
    >
      <div className={styles.calendarShell}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarGroup}>
            <button
              className={styles.secondaryButton}
              onClick={() => setAnchorDate(startOfDay(new Date()))}
              type="button"
            >
              Today
            </button>
            <button
              aria-label="Previous"
              className={styles.iconButton}
              onClick={() => shiftAnchor(-1)}
              type="button"
            >
              ‹
            </button>
            <button
              aria-label="Next"
              className={styles.iconButton}
              onClick={() => shiftAnchor(1)}
              type="button"
            >
              ›
            </button>
            <h2 className={styles.rangeTitle}>{rangeTitle}</h2>
            {isLoadingEvents ? <span className={styles.loadingHint}>Loading…</span> : null}
          </div>
          <div className={styles.toolbarGroup}>
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                className={[
                  styles.viewButton,
                  view === mode ? styles.viewButtonActive : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={mode}
                onClick={() => setView(mode)}
                type="button"
              >
                {mode === "day" ? "Day" : mode === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        </div>

        {pageError ? <p className={styles.errorBanner}>{pageError}</p> : null}
        {moveError ? (
          <p className={styles.errorBanner}>
            {moveError}{" "}
            <button
              className={styles.linkButton}
              onClick={() => setMoveError(null)}
              type="button"
            >
              Dismiss
            </button>
          </p>
        ) : null}

        {!isConnected && !isLoadingSession ? (
          renderConnectCard()
        ) : view === "month" ? (
          renderMonthGrid()
        ) : (
          renderTimeGrid()
        )}
      </div>
      {renderEventDetails()}
      <GmailComposeModal
        contactSuggestions={mailContactSuggestions}
        initialState={mailComposeState.initialState}
        isOpen={mailComposeState.isOpen}
        onClose={closeMailComposer}
        onRequestConnectGmail={handleConnectGmailFromCalendar}
        onSendError={(message) => {
          setDetailsNotice(null);
          setDetailsError(message);
        }}
        onSendQueued={() => {
          setDetailsError(null);
          setDetailsNotice("Sending email in the background. You can keep working.");
        }}
        onSent={() => {
          setDetailsError(null);
          setDetailsNotice("Email sent.");
        }}
        session={mailSession}
        title="New Message"
      />
    </AppChrome>
  );
}
