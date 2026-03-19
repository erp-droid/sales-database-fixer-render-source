export const MEETING_PRIORITY_VALUES = ["Low", "Normal", "High"] as const;
export const MEETING_CATEGORY_VALUES = ["Meeting", "Drop Off"] as const;

export type MeetingPriority = (typeof MEETING_PRIORITY_VALUES)[number];
export type MeetingCategory = (typeof MEETING_CATEGORY_VALUES)[number];

export type MeetingAccountOption = {
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  address: string;
};

export type MeetingContactOption = {
  key: string;
  contactId: number;
  contactName: string;
  email: string | null;
  phone: string | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  isInternal: boolean;
};

export type MeetingEmployeeOption = {
  key: string;
  loginName: string;
  employeeName: string;
  email: string;
  contactId: number | null;
  isInternal: true;
};

export type MeetingSourceContext = {
  accountKey: string;
  accountRecordId: string | null;
  businessAccountId: string;
  companyName: string;
  contactId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

export type MeetingCreateOptionsResponse = {
  contacts: MeetingContactOption[];
  employees: MeetingEmployeeOption[];
  accounts: MeetingAccountOption[];
  defaultTimeZone: string;
};

export type MeetingCreateRequest = {
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  sourceContactId: number | null;
  organizerContactId: number | null;
  includeOrganizerInAcumatica: boolean;
  relatedContactId: number;
  category: MeetingCategory;
  summary: string;
  location: string | null;
  timeZone: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  priority: MeetingPriority;
  details: string | null;
  attendeeContactIds: number[];
  attendeeEmails: string[];
};

export type MeetingCreateResponse = {
  created: true;
  eventId: string;
  category: MeetingCategory;
  inviteAuthority: "google" | "acumatica";
  calendarEventId: string | null;
  calendarInviteStatus: "created" | "updated" | "skipped" | "failed";
  connectedGoogleEmail: string | null;
  includeOrganizerInAcumatica: boolean;
  summary: string;
  relatedContactId: number;
  attendeeCount: number;
  warnings: string[];
};
