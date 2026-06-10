export type GoogleCalendarSessionResponse = {
  status: "connected" | "disconnected" | "needs_setup";
  connectedGoogleEmail: string | null;
  connectionError: string | null;
  expectedRedirectUri: string | null;
  canUploadAttachments: boolean;
  requiresReconnectForAttachments: boolean;
};

export type CalendarViewAttendee = {
  email: string | null;
  displayName: string | null;
  responseStatus: string | null;
  isSelf: boolean;
  isOrganizer: boolean;
};

export type CalendarViewPerson = {
  email: string | null;
  displayName: string | null;
  isSelf: boolean;
};

export type CalendarViewConferencePhone = {
  label: string | null;
  uri: string | null;
  pin: string | null;
  regionCode: string | null;
};

export type CalendarViewConference = {
  name: string | null;
  conferenceId: string | null;
  videoUri: string | null;
  phoneNumbers: CalendarViewConferencePhone[];
  morePhoneNumbersUri: string | null;
};

export type CalendarViewEvent = {
  id: string;
  summary: string;
  status: "confirmed" | "tentative";
  isAllDay: boolean;
  /** Instant the event starts. For all-day events this is the local midnight of startDate. */
  startIso: string;
  /** Instant the event ends (exclusive). */
  endIso: string;
  /** All-day start date (YYYY-MM-DD), null for timed events. */
  startDate: string | null;
  /** All-day end date (YYYY-MM-DD, exclusive), null for timed events. */
  endDate: string | null;
  /** IANA timezone Google stores for the start, when present. */
  startTimeZone: string | null;
  endTimeZone: string | null;
  location: string | null;
  description: string | null;
  hangoutLink: string | null;
  htmlLink: string | null;
  colorId: string | null;
  recurrenceRule: string | null;
  recurringEventId: string | null;
  reminderMinutes: number | null;
  usesDefaultReminders: boolean;
  guestsCanModify: boolean;
  guestsCanInviteOthers: boolean;
  guestsCanSeeOtherGuests: boolean;
  transparency: "opaque" | "transparent";
  visibility: "default" | "public" | "private" | "confidential";
  organizer: CalendarViewPerson | null;
  creator: CalendarViewPerson | null;
  conference: CalendarViewConference | null;
  recurrenceLabel: string | null;
  reminderLabel: string | null;
  isOrganizer: boolean;
  /** True when the connected account may move this event (organizer or guestsCanModify). */
  canReschedule: boolean;
  isRecurringInstance: boolean;
  isDeclined: boolean;
  attendees: CalendarViewAttendee[];
};

export type CalendarEventsResponse = {
  connectedGoogleEmail: string;
  /** The Google calendar's default IANA timezone. */
  calendarTimeZone: string | null;
  events: CalendarViewEvent[];
};

export type CalendarEventUpdateResponse = {
  event: CalendarViewEvent;
};
