"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CreateContactDrawer } from "@/components/create-contact-drawer";
import {
  buildMeetingDateTimeRange,
  DEFAULT_MEETING_TIME_ZONE,
  extractDeliverableMeetingEmail,
  extractDeliverableMeetingEmails,
  findMeetingContactByEmail,
  findMeetingContactByLoginName,
  findMeetingContactOptionById,
  isBlockedMeetingAttendeeEmail,
  isBlockedMeetingEmployeeAttendee,
  isDeliverableMeetingEmail,
  isPositiveMeetingContactId,
  normalizeMeetingContactId,
  normalizeMeetingContactIds,
  normalizeMeetingEmail,
} from "@/lib/meeting-create";
import {
  isExcludedInternalCompanyName,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
import type {
  MeetingContactOption,
  MeetingCreateOptionsResponse,
  MeetingCreateResponse,
  MeetingCategory,
  MeetingEmployeeOption,
  MeetingPriority,
  MeetingCreateRequest,
  MeetingSourceContext,
} from "@/types/meeting-create";
import { MEETING_CATEGORY_VALUES } from "@/types/meeting-create";
import type {
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import type { GoogleCalendarSessionResponse } from "@/types/google-calendar";

import styles from "./create-meeting-drawer.module.css";

type CreateMeetingDrawerProps = {
  isLoadingOptions: boolean;
  isOpen: boolean;
  defaultCategory: MeetingCategory;
  source: MeetingSourceContext | null;
  onClose: () => void;
  onContactCreated: (
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) => void;
  onMeetingCreated: (result: MeetingCreateResponse) => void;
  onRetryLoadOptions?: () => void;
  options: MeetingCreateOptionsResponse | null;
  optionsError: string | null;
  viewerLoginName?: string | null;
};

type MeetingFormState = Omit<
  MeetingCreateRequest,
  | "attendeeContactIds"
  | "attendeeEmails"
  | "businessAccountId"
  | "businessAccountRecordId"
  | "includeOrganizerInAcumatica"
  | "includeRelatedContactInInvite"
  | "organizerContactId"
  | "relatedContactId"
  | "sourceContactId"
>;

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

type EmployeeSearchResponse = {
  items: MeetingEmployeeOption[];
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

type MeetingAttendeeSuggestion =
  | {
      key: string;
      kind: "contact";
      contact: MeetingContactOption;
    }
  | {
      key: string;
      kind: "employee";
      employee: MeetingEmployeeOption;
    };

const MEETING_PRIORITY_OPTIONS: MeetingPriority[] = ["Low", "Normal", "High"];
const MAX_MEETING_ATTACHMENT_FILES = 5;
const MAX_MEETING_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_MEETING_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

type PendingMeetingAttachment = {
  id: string;
  file: File;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const MEETING_PAYLOAD_FIELD_LABELS: Record<string, string> = {
  attendeeEmails: "Guests",
  attendeeContactIds: "Guests",
  relatedContactId: "Contact",
  summary: "Title",
  startDate: "Date",
  endDate: "Date",
  startTime: "Start time",
  endTime: "End time",
  details: "Description",
  privateNotes: "Private notes",
  location: "Location",
  attachmentLinks: "Attachments",
  timeZone: "Time zone",
  category: "Type",
  priority: "Priority",
};

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const record = payload as Record<string, unknown>;
  const errorValue = readText(record.error);
  const details = record.details;

  if (details && typeof details === "object") {
    const detailsRecord = details as Record<string, unknown>;
    const modelState = detailsRecord.modelState;
    if (modelState && typeof modelState === "object") {
      for (const [field, value] of Object.entries(modelState as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          const first = value.map(readText).find(Boolean);
          if (first) {
            return `${field}: ${first}`;
          }
        }
      }
    }

    const fieldErrors = detailsRecord.fieldErrors;
    if (fieldErrors && typeof fieldErrors === "object") {
      for (const [field, value] of Object.entries(fieldErrors as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          const first = value.map(readText).find(Boolean);
          if (first) {
            const label = MEETING_PAYLOAD_FIELD_LABELS[field];
            return label ? `${label}: ${first}` : first;
          }
        }
      }
    }

    const formErrors = detailsRecord.formErrors;
    if (Array.isArray(formErrors)) {
      const first = formErrors.map(readText).find(Boolean);
      if (first) {
        return first;
      }
    }
  }

  return errorValue ?? "Request failed.";
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function isMeetingCreateResponse(payload: unknown): payload is MeetingCreateResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.created === true &&
    typeof record.eventId === "string" &&
    (record.inviteAuthority === "google" || record.inviteAuthority === "acumatica") &&
    (record.calendarEventId === null || typeof record.calendarEventId === "string") &&
    (record.calendarInviteStatus === "created" ||
      record.calendarInviteStatus === "updated" ||
      record.calendarInviteStatus === "skipped" ||
      record.calendarInviteStatus === "failed") &&
    (record.category === "Meeting" || record.category === "Drop Off") &&
    (record.connectedGoogleEmail === null || typeof record.connectedGoogleEmail === "string") &&
    typeof record.includeOrganizerInAcumatica === "boolean" &&
    typeof record.summary === "string" &&
    (typeof record.relatedContactId === "number" || record.relatedContactId === null) &&
    typeof record.attendeeCount === "number" &&
    Array.isArray(record.warnings)
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

function isGoogleCalendarSessionResponse(
  payload: unknown,
): payload is GoogleCalendarSessionResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    (record.status === "connected" ||
      record.status === "disconnected" ||
      record.status === "needs_setup") &&
    (record.connectedGoogleEmail === null ||
      typeof record.connectedGoogleEmail === "string") &&
    (record.connectionError === null || typeof record.connectionError === "string") &&
    (record.expectedRedirectUri === null || typeof record.expectedRedirectUri === "string") &&
    typeof record.canUploadAttachments === "boolean" &&
    typeof record.requiresReconnectForAttachments === "boolean"
  );
}

function isMeetingEmployeeOption(payload: unknown): payload is MeetingEmployeeOption {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    typeof record.key === "string" &&
    typeof record.loginName === "string" &&
    typeof record.employeeName === "string" &&
    typeof record.email === "string" &&
    (isPositiveMeetingContactId(record.contactId) || record.contactId === null) &&
    record.isInternal === true
  );
}

function isEmployeeSearchResponse(payload: unknown): payload is EmployeeSearchResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.every((item) => isMeetingEmployeeOption(item));
}

function isCalendarOauthWindowMessage(
  payload: unknown,
): payload is CalendarOauthWindowMessage {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (record.type !== "mbcalendar.oauth" || typeof record.success !== "boolean") {
    return false;
  }

  return (
    (record.success === true &&
      (record.connectedGoogleEmail === undefined ||
        record.connectedGoogleEmail === null ||
        typeof record.connectedGoogleEmail === "string")) ||
    (record.success === false &&
      (record.message === undefined || typeof record.message === "string"))
  );
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

function buildMeetingClockParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function formatWallClockDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWallClockTime(date: Date): string {
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function buildDefaultMeetingSlot(
  timeZone: string,
  category: MeetingCategory,
): Pick<
  MeetingFormState,
  "endDate" | "endTime" | "startDate" | "startTime"
> {
  const nowParts = buildMeetingClockParts(new Date(), timeZone);
  const wallClockNow = new Date(
    Date.UTC(
      nowParts.year,
      nowParts.month - 1,
      nowParts.day,
      nowParts.hour,
      nowParts.minute,
      0,
      0,
    ),
  );
  const roundedMinutes = Math.ceil((wallClockNow.getUTCMinutes() + 1) / 30) * 30;
  wallClockNow.setUTCMinutes(roundedMinutes, 0, 0);

  const start = wallClockNow;
  const durationMinutes = category === "Drop Off" ? 15 : 60;
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  return {
    startDate: formatWallClockDate(start),
    startTime: formatWallClockTime(start),
    endDate: formatWallClockDate(end),
    endTime: formatWallClockTime(end),
  };
}

function compareMeetingContacts(left: MeetingContactOption, right: MeetingContactOption): number {
  const nameCompare = left.contactName.localeCompare(right.contactName, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return (left.companyName ?? "").localeCompare(right.companyName ?? "", undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function buildFallbackSourceContactOption(
  source: MeetingSourceContext | null,
): MeetingContactOption | null {
  const contactId = normalizeMeetingContactId(source?.contactId);
  if (!source || contactId === null) {
    return null;
  }

  return {
    key: `${contactId}:${source.accountRecordId ?? source.accountKey}`,
    contactId,
    contactName: source.contactName?.trim() || `Contact ${contactId}`,
    email: source.contactEmail?.trim() || null,
    phone: source.contactPhone?.trim() || null,
    businessAccountRecordId: source.accountRecordId?.trim() || null,
    businessAccountId: source.businessAccountId.trim() || null,
    companyName: source.companyName.trim() || null,
    isInternal:
      isExcludedInternalContactEmail(source.contactEmail) ||
      isExcludedInternalCompanyName(source.companyName),
  };
}

function buildEmptyMeetingForm(timeZone: string, category: MeetingCategory): MeetingFormState {
  const defaults = buildDefaultMeetingSlot(timeZone, category);

  return {
    category,
    summary: "",
    location: null,
    timeZone,
    startDate: defaults.startDate,
    startTime: defaults.startTime,
    endDate: defaults.endDate,
    endTime: defaults.endTime,
    priority: "Normal",
    details: null,
    privateNotes: null,
    includeGoogleMeet: false,
    attachmentLinks: [],
  };
}

function matchMeetingContact(
  option: MeetingContactOption,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [option.contactName, option.companyName, option.email, option.phone, option.businessAccountId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function matchMeetingEmployee(
  option: MeetingEmployeeOption,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [option.employeeName, option.email, option.loginName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function uniqueContactIds(ids: Array<number | null | undefined>): number[] {
  return normalizeMeetingContactIds(ids);
}

function uniqueAttendeeEmails(emails: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      emails
        .map((email) => normalizeMeetingEmail(email))
        .filter((email): email is string => Boolean(email)),
    ),
  ].filter((email) => !isBlockedMeetingAttendeeEmail(email));
}

function isValidAttendeeEmail(value: string | null | undefined): value is string {
  return extractDeliverableMeetingEmail(value) !== null && !isBlockedMeetingAttendeeEmail(value);
}

function extractAllowedAttendeeEmails(value: string): string[] {
  return extractDeliverableMeetingEmails(value).filter(
    (email) => !isBlockedMeetingAttendeeEmail(email),
  );
}

function buildLoginNameHeaders(loginName: string | null): HeadersInit | undefined {
  const normalized = loginName?.trim();
  return normalized ? { "x-mb-login-name": normalized } : undefined;
}

function normalizeNullableInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatMeetingLocationAddress(address: AddressRetrieveResponse["address"]): string {
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

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

export function CreateMeetingDrawer({
  isLoadingOptions,
  isOpen,
  defaultCategory,
  source,
  onClose,
  onContactCreated,
  onMeetingCreated,
  onRetryLoadOptions,
  options,
  optionsError,
  viewerLoginName = null,
}: CreateMeetingDrawerProps) {
  const fallbackIssueContact = useMemo(
    () => buildFallbackSourceContactOption(source),
    [source],
  );
  const defaultTimeZone = options?.defaultTimeZone ?? DEFAULT_MEETING_TIME_ZONE;
  const [form, setForm] = useState<MeetingFormState>(() =>
    buildEmptyMeetingForm(defaultTimeZone, defaultCategory),
  );
  const [relatedContactId, setRelatedContactId] = useState<number | null>(null);
  const [attendeeContactIds, setAttendeeContactIds] = useState<number[]>([]);
  const [attendeeEmails, setAttendeeEmails] = useState<string[]>([]);
  const [relatedContactSearchTerm, setRelatedContactSearchTerm] = useState("");
  const [attendeeSearchTerm, setAttendeeSearchTerm] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<PendingMeetingAttachment[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const attendeeInputRef = useRef<HTMLInputElement | null>(null);
  const resetKeyRef = useRef<string | null>(null);
  const calendarSessionRequestRef = useRef(0);
  const debouncedAttendeeSearchTerm = useDebouncedValue(attendeeSearchTerm, 220);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreateContactOpen, setIsCreateContactOpen] = useState(false);
  const [localContacts, setLocalContacts] = useState<MeetingContactOption[]>([]);
  const [remoteEmployeeMatches, setRemoteEmployeeMatches] = useState<MeetingEmployeeOption[]>([]);
  const [remoteEmployeeSearchError, setRemoteEmployeeSearchError] = useState<string | null>(null);
  const [isSearchingRemoteEmployees, setIsSearchingRemoteEmployees] = useState(false);
  const [includeOrganizerInAcumatica, setIncludeOrganizerInAcumatica] = useState(false);
  const [includeRelatedInInvite, setIncludeRelatedInInvite] = useState(true);
  const [locationSuggestions, setLocationSuggestions] = useState<AddressLookupSuggestion[]>([]);
  const [locationLookupError, setLocationLookupError] = useState<string | null>(null);
  const [isLoadingLocationSuggestions, setIsLoadingLocationSuggestions] = useState(false);
  const [isApplyingLocationSuggestion, setIsApplyingLocationSuggestion] = useState(false);
  const [hasLocationLookupAttempted, setHasLocationLookupAttempted] = useState(false);
  const [selectedLocationValue, setSelectedLocationValue] = useState<string | null>(null);
  const [selectedLocationLookupId, setSelectedLocationLookupId] = useState<string | null>(null);
  const [calendarSession, setCalendarSession] = useState<GoogleCalendarSessionResponse | null>(null);
  const [isLoadingCalendarSession, setIsLoadingCalendarSession] = useState(false);
  const [isDisconnectingCalendar, setIsDisconnectingCalendar] = useState(false);
  const debouncedLocationSearchTerm = useDebouncedValue(form.location ?? "", 220);
  const contactDirectory = useMemo(() => {
    const byId = new Map<number, MeetingContactOption>();

    [...(options?.contacts ?? []), ...localContacts]
      .sort(compareMeetingContacts)
      .forEach((contact) => {
        const contactId = normalizeMeetingContactId(contact.contactId);
        if (contactId === null) {
          return;
        }

        byId.set(contactId, { ...contact, contactId });
      });

    if (fallbackIssueContact) {
      byId.set(fallbackIssueContact.contactId, fallbackIssueContact);
    }

    return [...byId.values()].sort(compareMeetingContacts);
  }, [fallbackIssueContact, localContacts, options?.contacts]);
  const contactById = useMemo(() => {
    const map = new Map<number, MeetingContactOption>();
    contactDirectory.forEach((contact) => {
      map.set(contact.contactId, contact);
    });
    return map;
  }, [contactDirectory]);
  const employeeDirectory = useMemo(() => {
    const byKey = new Map<string, MeetingEmployeeOption>();

    [...(options?.employees ?? []), ...remoteEmployeeMatches].forEach((employee) => {
      if (isBlockedMeetingEmployeeAttendee(employee)) {
        return;
      }

      const contactId = normalizeMeetingContactId(employee.contactId);
      const dedupeKey =
        normalizeMeetingEmail(employee.email) ?? employee.loginName.trim().toLowerCase();
      if (!dedupeKey || byKey.has(dedupeKey)) {
        return;
      }

      byKey.set(dedupeKey, { ...employee, contactId });
    });

    return [...byKey.values()].sort((left, right) =>
      left.employeeName.localeCompare(right.employeeName, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
  }, [options?.employees, remoteEmployeeMatches]);
  const employeeByEmail = useMemo(() => {
    const map = new Map<string, MeetingEmployeeOption>();
    employeeDirectory.forEach((employee) => {
      const inviteEmail =
        extractDeliverableMeetingEmail(employee.email) ?? normalizeMeetingEmail(employee.email);
      if (inviteEmail) {
        map.set(inviteEmail, employee);
      }
    });
    return map;
  }, [employeeDirectory]);
  const viewerContact = useMemo(
    () => findMeetingContactByLoginName(contactDirectory, viewerLoginName),
    [contactDirectory, viewerLoginName],
  );
  const viewerContactId = viewerContact?.contactId ?? null;
  const sourceContactId = normalizeMeetingContactId(source?.contactId);
  const categoryLabel = form.category;
  const categoryLowerLabel = categoryLabel === "Drop Off" ? "drop off" : "meeting";
  const createLabel = form.category === "Drop Off" ? "Schedule drop off" : "Schedule meeting";
  const createHeading = form.category === "Drop Off" ? "Schedule Drop Off" : "Schedule Meeting";
  const isGoogleCalendarConnected = calendarSession?.status === "connected";
  const canUploadSelectedAttachments =
    attachmentFiles.length === 0 || calendarSession?.canUploadAttachments !== false;
  const isScheduleDisabled =
    isSubmitting || !isGoogleCalendarConnected || !canUploadSelectedAttachments;

  const refreshCalendarSession = useCallback(
    async (input?: { signal?: AbortSignal; showLoading?: boolean }) => {
      const requestId = calendarSessionRequestRef.current + 1;
      calendarSessionRequestRef.current = requestId;
      const showLoading = input?.showLoading ?? true;

      if (showLoading) {
        setIsLoadingCalendarSession(true);
      }

      try {
        const response = await fetch("/api/calendar/session", {
          cache: "no-store",
          credentials: "same-origin",
          headers: buildLoginNameHeaders(viewerLoginName),
          signal: input?.signal,
        });
        const payload = await readJsonResponse<GoogleCalendarSessionResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isGoogleCalendarSessionResponse(payload)) {
          throw new Error("Unexpected Google Calendar session response.");
        }

        if (!input?.signal?.aborted && calendarSessionRequestRef.current === requestId) {
          setCalendarSession(payload);
        }

        return payload;
      } catch (error) {
        if (input?.signal?.aborted) {
          return null;
        }

        const fallback: GoogleCalendarSessionResponse = {
          status: "disconnected",
          connectedGoogleEmail: null,
          connectionError:
            error instanceof Error ? error.message : "Unable to load Google Calendar status.",
          expectedRedirectUri: null,
          canUploadAttachments: false,
          requiresReconnectForAttachments: false,
        };

        if (calendarSessionRequestRef.current === requestId) {
          setCalendarSession(fallback);
        }

        return fallback;
      } finally {
        if (!input?.signal?.aborted && calendarSessionRequestRef.current === requestId) {
          setIsLoadingCalendarSession(false);
        }
      }
    },
    [viewerLoginName],
  );

  useEffect(() => {
    if (!isOpen) {
      setForm(buildEmptyMeetingForm(defaultTimeZone, defaultCategory));
      setRelatedContactId(null);
      setAttendeeContactIds([]);
      setAttendeeEmails([]);
      setRelatedContactSearchTerm("");
      setAttendeeSearchTerm("");
      setAttachmentFiles([]);
      setFormError(null);
      setIsSubmitting(false);
      setIsCreateContactOpen(false);
      setLocalContacts([]);
      setIncludeOrganizerInAcumatica(false);
      setIncludeRelatedInInvite(true);
      setLocationSuggestions([]);
      setLocationLookupError(null);
      setIsLoadingLocationSuggestions(false);
      setIsApplyingLocationSuggestion(false);
      setHasLocationLookupAttempted(false);
      setSelectedLocationValue(null);
      setSelectedLocationLookupId(null);
      setCalendarSession(null);
      setIsLoadingCalendarSession(false);
      setIsDisconnectingCalendar(false);
      setRemoteEmployeeMatches([]);
      setRemoteEmployeeSearchError(null);
      setIsSearchingRemoteEmployees(false);
      resetKeyRef.current = null;
      return;
    }

    const nextResetKey = [
      defaultCategory,
      source?.accountRecordId ?? "",
      source?.businessAccountId ?? "",
      source?.accountKey ?? "",
      sourceContactId ?? "",
    ].join("|");
    if (resetKeyRef.current === nextResetKey) {
      return;
    }
    resetKeyRef.current = nextResetKey;

    const nextTimeZone = options?.defaultTimeZone ?? DEFAULT_MEETING_TIME_ZONE;
    setForm(buildEmptyMeetingForm(nextTimeZone, defaultCategory));
    setRelatedContactId(sourceContactId);
    setAttendeeContactIds(sourceContactId !== null ? [sourceContactId] : []);
    setAttendeeEmails([]);
    setRelatedContactSearchTerm(source?.contactName?.trim() ?? "");
    setAttendeeSearchTerm("");
    setAttachmentFiles([]);
    setFormError(null);
    setIsSubmitting(false);
    setIsCreateContactOpen(false);
    setLocalContacts([]);
    setIncludeOrganizerInAcumatica(Boolean(viewerContact));
    setIncludeRelatedInInvite(true);
    setLocationSuggestions([]);
    setLocationLookupError(null);
    setIsLoadingLocationSuggestions(false);
    setIsApplyingLocationSuggestion(false);
    setHasLocationLookupAttempted(false);
    setSelectedLocationValue(null);
    setSelectedLocationLookupId(null);
    setCalendarSession(null);
    setIsLoadingCalendarSession(false);
    setIsDisconnectingCalendar(false);
    setRemoteEmployeeMatches([]);
    setRemoteEmployeeSearchError(null);
    setIsSearchingRemoteEmployees(false);
  }, [
    defaultTimeZone,
    isOpen,
    source?.accountKey,
    source?.accountRecordId,
    source?.businessAccountId,
    source?.companyName,
    source?.contactId,
    source?.contactName,
    sourceContactId,
    defaultCategory,
    options?.defaultTimeZone,
    viewerContact,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const controller = new AbortController();
    void refreshCalendarSession({ signal: controller.signal });

    return () => controller.abort();
  }, [isOpen, refreshCalendarSession]);

  useEffect(() => {
    function handleCalendarOauthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || !isCalendarOauthWindowMessage(event.data)) {
        return;
      }

      if (!event.data.success) {
        setFormError(event.data.message ?? "Unable to connect Google Calendar.");
        return;
      }

      setCalendarSession((current) => ({
        status: "connected",
        connectedGoogleEmail: event.data.connectedGoogleEmail ?? null,
        connectionError: null,
        expectedRedirectUri: current?.expectedRedirectUri ?? null,
        canUploadAttachments: true,
        requiresReconnectForAttachments: false,
      }));
      void refreshCalendarSession({ showLoading: false });
    }

    window.addEventListener("message", handleCalendarOauthMessage);
    return () => {
      window.removeEventListener("message", handleCalendarOauthMessage);
    };
  }, [refreshCalendarSession]);

  useEffect(() => {
    const normalizedSearchTerm = debouncedLocationSearchTerm.trim();
    if (
      !isOpen ||
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

        if (!controller.signal.aborted) {
          setLocationSuggestions(payload.items);
          setHasLocationLookupAttempted(true);
        }
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
  }, [debouncedLocationSearchTerm, isOpen, selectedLocationLookupId]);

  useEffect(() => {
    const normalizedSearchTerm = debouncedAttendeeSearchTerm.trim();
    if (!isOpen || normalizedSearchTerm.length < 2) {
      setRemoteEmployeeMatches([]);
      setRemoteEmployeeSearchError(null);
      setIsSearchingRemoteEmployees(false);
      return;
    }

    const controller = new AbortController();
    setIsSearchingRemoteEmployees(true);
    setRemoteEmployeeSearchError(null);

    fetch(`/api/employees/search?q=${encodeURIComponent(normalizedSearchTerm)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: buildLoginNameHeaders(viewerLoginName),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readJsonResponse<EmployeeSearchResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isEmployeeSearchResponse(payload)) {
          throw new Error("Unexpected employee search response.");
        }

        if (!controller.signal.aborted) {
          setRemoteEmployeeMatches(
            payload.items.filter((employee) => !isBlockedMeetingEmployeeAttendee(employee)),
          );
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setRemoteEmployeeMatches([]);
        setRemoteEmployeeSearchError(
          error instanceof Error ? error.message : "Unable to search employees.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsSearchingRemoteEmployees(false);
        }
      });

    return () => controller.abort();
  }, [debouncedAttendeeSearchTerm, isOpen, viewerLoginName]);

  const relatedContactLocked = sourceContactId !== null;
  const createContactAccountOptions = useMemo(
    () =>
      (options?.accounts ?? []).map((account) => ({
        businessAccountRecordId: account.businessAccountRecordId,
        businessAccountId: account.businessAccountId,
        companyName: account.companyName,
        address: account.address,
      })),
    [options?.accounts],
  );

  const normalizedAttendeeIds = useMemo(
    () =>
      uniqueContactIds([
        ...(includeRelatedInInvite ? [relatedContactId] : []),
        ...attendeeContactIds.filter(
          (contactId) => includeRelatedInInvite || contactId !== relatedContactId,
        ),
      ]),
    [attendeeContactIds, includeRelatedInInvite, relatedContactId],
  );
  const normalizedAttendeeEmails = useMemo(
    () => uniqueAttendeeEmails(attendeeEmails),
    [attendeeEmails],
  );
  const selectedAttendees = useMemo(
    () =>
      normalizedAttendeeIds.map((contactId) => {
        return (
          contactById.get(contactId) ?? {
            key: `contact-${contactId}`,
            contactId,
          contactName: `Contact ${contactId}`,
          email: null,
          phone: null,
          businessAccountRecordId: source?.accountRecordId ?? null,
          businessAccountId: source?.businessAccountId ?? null,
          companyName: source?.companyName ?? null,
          isInternal: false,
        }
      );
      }),
    [contactById, normalizedAttendeeIds, source?.accountRecordId, source?.businessAccountId, source?.companyName],
  );
  const selectedAttendeeEmailSet = useMemo(
    () =>
      new Set(
        selectedAttendees
          .map(
            (attendee) =>
              extractDeliverableMeetingEmail(attendee.email) ??
              normalizeMeetingEmail(attendee.email),
          )
          .filter((value): value is string => Boolean(value)),
      ),
    [selectedAttendees],
  );
  const selectedExternalAttendeeEmails = useMemo(
    () =>
      normalizedAttendeeEmails.filter(
        (email) => !selectedAttendeeEmailSet.has(email) && !isBlockedMeetingAttendeeEmail(email),
      ),
    [normalizedAttendeeEmails, selectedAttendeeEmailSet],
  );
  const selectedInviteEmailSet = useMemo(
    () => new Set([...selectedAttendeeEmailSet, ...selectedExternalAttendeeEmails]),
    [selectedAttendeeEmailSet, selectedExternalAttendeeEmails],
  );
  const relatedContact =
    relatedContactId !== null
      ? contactById.get(relatedContactId) ??
        (fallbackIssueContact?.contactId === relatedContactId ? fallbackIssueContact : null)
      : null;

  const relatedContactSuggestions = useMemo(() => {
    if (!isOpen || relatedContactLocked || relatedContactId !== null) {
      return [];
    }

    return contactDirectory
      .filter((contact) => matchMeetingContact(contact, relatedContactSearchTerm))
      .slice(0, 10);
  }, [
    contactDirectory,
    isOpen,
    relatedContactId,
    relatedContactLocked,
    relatedContactSearchTerm,
  ]);

  const attendeeSuggestions = useMemo(() => {
    if (!isOpen) {
      return [];
    }

    const contactSuggestions: MeetingAttendeeSuggestion[] = contactDirectory
      .filter((contact) => !normalizedAttendeeIds.includes(contact.contactId))
      .filter((contact) => matchMeetingContact(contact, attendeeSearchTerm))
      .map((contact) => ({
        key: `contact:${contact.key}`,
        kind: "contact",
        contact,
      }));

    const employeeSuggestions: MeetingAttendeeSuggestion[] = employeeDirectory
      .filter((employee) => {
        if (isBlockedMeetingEmployeeAttendee(employee)) {
          return false;
        }

        const inviteEmail =
          extractDeliverableMeetingEmail(employee.email) ??
          normalizeMeetingEmail(employee.email);
        if (!inviteEmail) {
          return false;
        }

        if (selectedInviteEmailSet.has(inviteEmail)) {
          return false;
        }

        if (employee.contactId !== null && contactById.has(employee.contactId)) {
          return false;
        }

        return matchMeetingEmployee(employee, attendeeSearchTerm);
      })
      .map((employee) => ({
        key: `employee:${employee.key}`,
        kind: "employee",
        employee,
      }));

    return [...contactSuggestions, ...employeeSuggestions]
      .sort((left, right) => {
        const leftLabel =
          left.kind === "contact" ? left.contact.contactName : left.employee.employeeName;
        const rightLabel =
          right.kind === "contact" ? right.contact.contactName : right.employee.employeeName;
        return leftLabel.localeCompare(rightLabel, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      })
      .slice(0, 10);
  }, [
    attendeeSearchTerm,
    contactById,
    contactDirectory,
    employeeDirectory,
    isOpen,
    normalizedAttendeeIds,
    selectedInviteEmailSet,
  ]);
  const normalizedAttendeeSearchEmail = extractDeliverableMeetingEmail(attendeeSearchTerm);
  const matchingDirectInviteContact = useMemo(
    () =>
      normalizedAttendeeSearchEmail
        ? findMeetingContactByEmail(contactDirectory, normalizedAttendeeSearchEmail)
        : null,
    [contactDirectory, normalizedAttendeeSearchEmail],
  );
  const canInviteDirectEmail =
    isValidAttendeeEmail(attendeeSearchTerm) &&
    normalizedAttendeeSearchEmail !== null &&
    !selectedInviteEmailSet.has(normalizedAttendeeSearchEmail) &&
    !isBlockedMeetingAttendeeEmail(normalizedAttendeeSearchEmail);
  const isOptionsPending = isLoadingOptions && !options;

  function updateForm<K extends keyof MeetingFormState>(
    key: K,
    value: MeetingFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "startDate" ? { endDate: value as MeetingFormState["startDate"] } : {}),
    }));
  }

  function handleConnectGoogleCalendar() {
    setFormError(null);
    const params = new URLSearchParams({
      returnTo: "/calendar/oauth/complete",
    });
    if (viewerLoginName?.trim()) {
      params.set("loginName", viewerLoginName.trim());
    }
    const popup = window.open(
      `/api/calendar/oauth/start?${params.toString()}`,
      "calendar-oauth",
      "popup=yes,width=540,height=720,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      setFormError("Allow pop-ups to connect Google Calendar.");
      return;
    }

    popup.focus();

    let hasRefreshedAfterClose = false;
    let focusRefreshTimeoutId: number | null = null;
    const refreshAfterPopupClose = () => {
      if (hasRefreshedAfterClose) {
        return;
      }
      hasRefreshedAfterClose = true;
      window.clearInterval(closeCheckId);
      window.removeEventListener("focus", handleWindowFocus);
      if (focusRefreshTimeoutId !== null) {
        window.clearTimeout(focusRefreshTimeoutId);
      }
      void refreshCalendarSession({ showLoading: true });
    };
    const closeCheckId = window.setInterval(() => {
      if (popup.closed) {
        refreshAfterPopupClose();
      }
    }, 700);
    const handleWindowFocus = () => {
      if (focusRefreshTimeoutId !== null) {
        window.clearTimeout(focusRefreshTimeoutId);
      }
      focusRefreshTimeoutId = window.setTimeout(() => {
        if (popup.closed) {
          refreshAfterPopupClose();
          return;
        }

        void refreshCalendarSession({ showLoading: false });
      }, 500);
    };
    window.addEventListener("focus", handleWindowFocus);
  }

  async function handleDisconnectGoogleCalendar() {
    setFormError(null);
    setIsDisconnectingCalendar(true);

    try {
      const response = await fetch("/api/calendar/oauth/disconnect", {
        credentials: "same-origin",
        headers: buildLoginNameHeaders(viewerLoginName),
        method: "POST",
      });
      const payload = await readJsonResponse<{ disconnected?: boolean; error?: string }>(response);
      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      setCalendarSession({
        status: "disconnected",
        connectedGoogleEmail: null,
        connectionError: null,
        expectedRedirectUri: calendarSession?.expectedRedirectUri ?? null,
        canUploadAttachments: false,
        requiresReconnectForAttachments: false,
      });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Unable to disconnect Google Calendar.",
      );
    } finally {
      setIsDisconnectingCalendar(false);
    }
  }

  function handleLocationChange(value: string) {
    if (selectedLocationValue !== null && value !== selectedLocationValue) {
      setSelectedLocationLookupId(null);
      setSelectedLocationValue(null);
    }

    updateForm("location", value);
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

      const nextLocation = formatMeetingLocationAddress(payload.address);
      updateForm("location", nextLocation);
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

  function removeMatchingAttendeeEmail(email: string | null | undefined) {
    const normalizedEmail = normalizeMeetingEmail(email);
    if (!normalizedEmail) {
      return;
    }

    setAttendeeEmails((current) =>
      current.filter((value) => normalizeMeetingEmail(value) !== normalizedEmail),
    );
  }

  function handleSelectRelatedContact(contact: MeetingContactOption) {
    const selectedContactId = normalizeMeetingContactId(contact.contactId);
    if (selectedContactId === null) {
      return;
    }

    setRelatedContactId((current) => {
      const nextRelatedId = selectedContactId;
      setAttendeeContactIds((currentAttendees) =>
        uniqueContactIds([
          nextRelatedId,
          ...currentAttendees.filter((contactId) => contactId !== current),
        ]),
      );
      return nextRelatedId;
    });
    setIncludeRelatedInInvite(true);
    removeMatchingAttendeeEmail(contact.email);
    setRelatedContactSearchTerm(contact.contactName);
    setFormError(null);
  }

  function handleAddAttendee(contact: MeetingContactOption) {
    const contactId = normalizeMeetingContactId(contact.contactId);
    if (contactId === null) {
      return;
    }

    setAttendeeContactIds((current) => uniqueContactIds([...current, contactId]));
    if (relatedContactId === null) {
      setRelatedContactId(contactId);
      setRelatedContactSearchTerm(contact.contactName);
      setIncludeRelatedInInvite(true);
    } else if (contactId === relatedContactId) {
      setIncludeRelatedInInvite(true);
    }
    removeMatchingAttendeeEmail(contact.email);
    setAttendeeSearchTerm("");
    setFormError(null);
  }

  function handleAddAttendeeEmails(value: string): boolean {
    const deliverableEmails = extractAllowedAttendeeEmails(value);
    if (deliverableEmails.length === 0) {
      return false;
    }

    setAttendeeEmails((current) => uniqueAttendeeEmails([...current, ...deliverableEmails]));
    setAttendeeSearchTerm("");
    setFormError(null);
    return true;
  }

  function handleAttendeeInputChange(value: string) {
    if (!/[;,]/.test(value)) {
      setAttendeeSearchTerm(value);
      return;
    }

    const parts = value.split(/[;,]/);
    const trailingInput = parts.pop() ?? "";
    const addedEmails = extractAllowedAttendeeEmails(parts.join(","));

    if (addedEmails.length > 0) {
      setAttendeeEmails((current) => uniqueAttendeeEmails([...current, ...addedEmails]));
      setFormError(null);
    }

    setAttendeeSearchTerm(trailingInput.trimStart());
  }

  function handleAttendeeInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== ",") {
      return;
    }

    if (!handleAddAttendeeEmails(attendeeSearchTerm)) {
      return;
    }

    event.preventDefault();
  }

  function handleAddEmployeeAttendee(employee: MeetingEmployeeOption) {
    if (isBlockedMeetingEmployeeAttendee(employee)) {
      setAttendeeSearchTerm("");
      return;
    }

    const deliverableEmail = extractDeliverableMeetingEmail(employee.email);
    if (!deliverableEmail || isBlockedMeetingAttendeeEmail(deliverableEmail)) {
      setAttendeeSearchTerm("");
      setFormError(
        `${employee.employeeName} cannot be invited because their directory email ("${employee.email}") is not a valid email address. Ask an admin to fix it, or type their correct email to invite them directly.`,
      );
      return;
    }

    setAttendeeEmails((current) => uniqueAttendeeEmails([...current, deliverableEmail]));
    setAttendeeSearchTerm("");
    setFormError(null);
  }

  function handleRemoveAttendee(contactId: number) {
    const normalizedContactId = normalizeMeetingContactId(contactId);
    if (normalizedContactId === null) {
      return;
    }

    if (normalizedContactId === relatedContactId) {
      setIncludeRelatedInInvite(false);
    }

    setAttendeeContactIds((current) => current.filter((value) => value !== normalizedContactId));
  }

  function handleRestoreRelatedAttendee() {
    if (relatedContactId === null) {
      return;
    }

    setIncludeRelatedInInvite(true);
    setAttendeeContactIds((current) => uniqueContactIds([relatedContactId, ...current]));
  }

  function handleSelectAttachmentFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (nextFiles.length === 0) {
      return;
    }

    const existingBytes = attachmentFiles.reduce((total, attachment) => total + attachment.sizeBytes, 0);
    const existingKeys = new Set(
      attachmentFiles.map(
        (attachment) => `${attachment.fileName}:${attachment.sizeBytes}:${attachment.file.lastModified}`,
      ),
    );
    const accepted: PendingMeetingAttachment[] = [];
    let nextTotalBytes = existingBytes;

    for (const file of nextFiles) {
      if (attachmentFiles.length + accepted.length >= MAX_MEETING_ATTACHMENT_FILES) {
        setFormError(`You can attach up to ${MAX_MEETING_ATTACHMENT_FILES} files.`);
        break;
      }

      if (file.size > MAX_MEETING_ATTACHMENT_BYTES) {
        setFormError(`${file.name || "Attachment"} is too large. Maximum file size is 10 MB.`);
        continue;
      }

      if (nextTotalBytes + file.size > MAX_MEETING_ATTACHMENT_TOTAL_BYTES) {
        setFormError("Calendar invite attachments are too large.");
        break;
      }

      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (existingKeys.has(key)) {
        continue;
      }

      existingKeys.add(key);
      nextTotalBytes += file.size;
      accepted.push({
        id: `${key}:${crypto.randomUUID()}`,
        file,
        fileName: file.name || "Meeting attachment",
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
    }

    if (accepted.length > 0) {
      setAttachmentFiles((current) => [...current, ...accepted]);
      setFormError(null);
    }
  }

  function handleRemoveAttachment(id: string) {
    setAttachmentFiles((current) => current.filter((attachment) => attachment.id !== id));
    setFormError(null);
  }

  function handleMeetingContactCreated(
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) {
    onContactCreated(result);
    const createdContact =
      findMeetingContactOptionById(result.accountRows, result.contactId) ??
      null;

    if (createdContact) {
      const createdContactId = normalizeMeetingContactId(createdContact.contactId);
      if (createdContactId !== null) {
        const normalizedCreatedContact = { ...createdContact, contactId: createdContactId };
        setLocalContacts((current) => {
          const byId = new Map(current.map((contact) => [contact.contactId, contact]));
          byId.set(createdContactId, normalizedCreatedContact);
          return [...byId.values()].sort(compareMeetingContacts);
        });
        setAttendeeContactIds((current) =>
          uniqueContactIds([...current, createdContactId]),
        );
        removeMatchingAttendeeEmail(createdContact.email);
        if (!relatedContactLocked) {
          setRelatedContactId(createdContactId);
          setIncludeRelatedInInvite(true);
        }
        setRelatedContactSearchTerm(createdContact.contactName);
      }
    }

    if (result.created) {
      setIsCreateContactOpen(false);
    }
  }

  async function handleSubmit() {
    if (!form.summary.trim()) {
      setFormError("Summary is required.");
      return;
    }

    if (form.summary.trim().length > 255) {
      setFormError("The title can be at most 255 characters long.");
      return;
    }

    const undeliverableGuestEmails = selectedExternalAttendeeEmails.filter(
      (email) => !isDeliverableMeetingEmail(email),
    );
    if (undeliverableGuestEmails.length > 0) {
      setFormError(
        `These guest emails are not valid: ${undeliverableGuestEmails.join(", ")}. Remove those guests or re-add them with a corrected address.`,
      );
      return;
    }

    if (!isGoogleCalendarConnected) {
      setFormError("Connect Google Calendar before scheduling this invite.");
      return;
    }

    if (!canUploadSelectedAttachments) {
      setFormError("Reconnect Google Calendar to allow real file attachments.");
      return;
    }

    const effectiveRelatedContactId =
      normalizeMeetingContactId(relatedContactId) ?? normalizedAttendeeIds[0] ?? null;
    const organizerContactId =
      includeOrganizerInAcumatica ? normalizeMeetingContactId(viewerContactId) : null;
    try {
      buildMeetingDateTimeRange({
        startDate: form.startDate,
        startTime: form.startTime,
        endDate: form.startDate,
        endTime: form.endTime,
        timeZone: defaultTimeZone,
      });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : `${categoryLabel} end must be after the start.`,
      );
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const requestPayload = {
        businessAccountRecordId: source?.accountRecordId ?? null,
        businessAccountId: source?.businessAccountId ?? null,
        sourceContactId,
        organizerContactId,
        includeOrganizerInAcumatica,
        includeRelatedContactInInvite: includeRelatedInInvite,
        relatedContactId: effectiveRelatedContactId,
        category: form.category,
        summary: form.summary.trim(),
        location: normalizeNullableInput(form.location ?? ""),
        timeZone: defaultTimeZone,
        startDate: form.startDate,
        startTime: form.startTime,
        endDate: form.startDate,
        endTime: form.endTime,
        priority: form.priority,
        details: normalizeNullableInput(form.details ?? ""),
        privateNotes: normalizeNullableInput(form.privateNotes ?? ""),
        includeGoogleMeet: form.includeGoogleMeet,
        attachmentLinks: [],
        attendeeContactIds: normalizedAttendeeIds,
        attendeeEmails: selectedExternalAttendeeEmails.filter(
          (email) => !isBlockedMeetingAttendeeEmail(email),
        ),
      } satisfies MeetingCreateRequest;
      const requestBody =
        attachmentFiles.length > 0
          ? (() => {
              const formData = new FormData();
              formData.append("payload", JSON.stringify(requestPayload));
              attachmentFiles.forEach((attachment) => {
                formData.append("attachments", attachment.file, attachment.fileName);
              });
              return formData;
            })()
          : JSON.stringify(requestPayload);
      const requestHeaders =
        attachmentFiles.length > 0
          ? undefined
          : {
              "Content-Type": "application/json",
            };
      const response = await fetch("/api/meetings", {
        method: "POST",
        body: requestBody,
        credentials: "same-origin",
        headers: {
          ...requestHeaders,
          ...buildLoginNameHeaders(viewerLoginName),
        },
      });

      const payload = await readJsonResponse<MeetingCreateResponse | { error?: string }>(
        response,
      );

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!isMeetingCreateResponse(payload)) {
        throw new Error(`Unexpected response while creating the ${categoryLowerLabel}.`);
      }

      onMeetingCreated(payload);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `Unable to create the ${categoryLowerLabel}.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <button className={styles.backdrop} onClick={onClose} type="button" />
      <aside className={`${styles.drawer} ${styles.drawerOpen}`} aria-label={createHeading}>
        <div className={styles.drawerHeader}>
          <button className={styles.iconButton} onClick={onClose} type="button" aria-label="Close">
            x
          </button>
        </div>

        <div className={styles.drawerBody}>
          <div className={styles.titleBlock}>
            <div className={styles.modeRow}>
              {MEETING_CATEGORY_VALUES.map((category) => (
                <button
                  className={`${styles.modeButton} ${
                    form.category === category ? styles.modeButtonActive : ""
                  }`}
                  key={category}
                  onClick={() => updateForm("category", category)}
                  type="button"
                >
                  {category}
                </button>
              ))}
              <select
                className={styles.inlineSelect}
                onChange={(event) =>
                  updateForm("priority", event.target.value as MeetingPriority)
                }
                value={form.priority}
              >
                {MEETING_PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority} priority
                  </option>
                ))}
              </select>
            </div>
            <p className={styles.contextLine}>
              <span className={styles.contextIcon}>Pin</span>
              {source
                ? `${source.companyName} - ${source.contactName ?? "Select a contact"}`
                : `Create an app ${categoryLowerLabel} and send a Google Calendar invite.`}
            </p>
            <input
              className={styles.titleInput}
              maxLength={255}
              onChange={(event) => updateForm("summary", event.target.value)}
              placeholder="Add title"
              value={form.summary}
            />
          </div>

          <div className={styles.connectionRow}>
            <div className={styles.connectionCopy}>
              <span
                className={
                  calendarSession?.status === "connected"
                    ? styles.calendarStatusBadge
                    : styles.calendarStatusBadgeMuted
                }
              >
                {calendarSession?.status === "connected"
                  ? "Connected"
                  : calendarSession?.status === "needs_setup"
                    ? "Setup needed"
                    : "Not connected"}
              </span>
              <span>
                {calendarSession?.status === "connected"
                  ? calendarSession.requiresReconnectForAttachments
                    ? calendarSession.connectionError ??
                      "Reconnect Google Calendar once to allow real file attachments."
                    : `Google invites send from ${calendarSession.connectedGoogleEmail ?? "this account"}.`
                  : calendarSession?.connectionError ??
                    "Connect Calendar before scheduling. The app will not create invites without Google Calendar."}
              </span>
            </div>
            {calendarSession?.status === "connected" &&
            !calendarSession.requiresReconnectForAttachments ? (
              <button
                className={styles.secondaryButton}
                disabled={isDisconnectingCalendar}
                onClick={handleDisconnectGoogleCalendar}
                type="button"
              >
                {isDisconnectingCalendar ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <button
                className={styles.secondaryButton}
                disabled={isLoadingCalendarSession}
                onClick={handleConnectGoogleCalendar}
                type="button"
              >
                {isLoadingCalendarSession
                  ? "Checking..."
                  : calendarSession?.requiresReconnectForAttachments
                    ? "Reconnect"
                    : "Connect Google Calendar"}
              </button>
            )}
          </div>

          {calendarSession?.expectedRedirectUri && calendarSession.status === "needs_setup" ? (
            <code className={styles.calendarStatusCode}>
              {calendarSession.expectedRedirectUri}
            </code>
          ) : null}

          <div className={styles.calendarRows}>
            <div className={styles.calendarRow}>
              <span className={styles.rowIcon}>Time</span>
              <div className={styles.timeGrid}>
                <label>
                  Date
                  <input
                    onChange={(event) => updateForm("startDate", event.target.value)}
                    type="date"
                    value={form.startDate}
                  />
                </label>
                <label>
                  Start
                  <input
                    onChange={(event) => updateForm("startTime", event.target.value)}
                    type="time"
                    value={form.startTime}
                  />
                </label>
                <label>
                  End
                  <input
                    onChange={(event) => updateForm("endTime", event.target.value)}
                    type="time"
                    value={form.endTime}
                  />
                </label>
              </div>
            </div>

            <div className={styles.calendarRow}>
              <span className={styles.rowIcon}>Guests</span>
              <div className={styles.rowContent}>
                <div className={styles.chipInput} onClick={() => attendeeInputRef.current?.focus()}>
                  {selectedAttendees.map((attendee) => {
                    const isRelatedAttendee = attendee.contactId === relatedContactId;

                    return (
                      <span className={styles.attendeeChip} key={attendee.contactId}>
                        <span>
                          {attendee.contactName}
                          {attendee.email ? ` <${attendee.email}>` : ""}
                        </span>
                        {isRelatedAttendee ? <small>Related</small> : null}
                        <button
                          aria-label={
                            isRelatedAttendee
                              ? `Remove ${attendee.contactName} from the invite`
                              : `Remove ${attendee.contactName}`
                          }
                          onClick={() => handleRemoveAttendee(attendee.contactId)}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    );
                  })}
                  {selectedExternalAttendeeEmails.map((email) => (
                    <span className={styles.attendeeChip} key={email}>
                      <span>{employeeByEmail.get(email)?.employeeName ?? email}</span>
                      <button
                        aria-label={`Remove ${email}`}
                        onClick={() => {
                          setAttendeeEmails((current) =>
                            current.filter((value) => normalizeMeetingEmail(value) !== email),
                          );
                        }}
                        type="button"
                      >
                        x
                      </button>
                    </span>
                  ))}
                  <input
                    autoComplete="off"
                    onChange={(event) => handleAttendeeInputChange(event.target.value)}
                    onKeyDown={handleAttendeeInputKeyDown}
                    placeholder={
                      isOptionsPending
                        ? "Type an email, or wait for contacts..."
                        : "Add guests by name or email"
                    }
                    ref={attendeeInputRef}
                    value={attendeeSearchTerm}
                  />
                </div>

                {relatedContact && !includeRelatedInInvite ? (
                  <p className={styles.lookupHint}>
                    {relatedContact.contactName} stays linked to this {categoryLowerLabel} as the
                    contact, but will not receive the calendar invite.{" "}
                    <button
                      className={styles.linkButton}
                      onClick={handleRestoreRelatedAttendee}
                      type="button"
                    >
                      Add back to invite
                    </button>
                  </p>
                ) : null}

                {attendeeSearchTerm.trim() && attendeeSuggestions.length > 0 ? (
                  <div className={styles.lookupSuggestions}>
                    {attendeeSuggestions.map((suggestion) =>
                      suggestion.kind === "contact" ? (
                        <button
                          className={styles.lookupSuggestionItem}
                          key={suggestion.key}
                          onClick={() => handleAddAttendee(suggestion.contact)}
                          type="button"
                        >
                          <span className={styles.lookupSuggestionTitle}>
                            {suggestion.contact.contactName}
                          </span>
                          <span className={styles.lookupSuggestionMeta}>
                            {suggestion.contact.isInternal
                              ? "MeadowBrook employee"
                              : suggestion.contact.companyName ?? "No account"}
                          </span>
                          <span className={styles.lookupSuggestionMeta}>
                            {suggestion.contact.email ?? "No email"}
                          </span>
                        </button>
                      ) : (
                        <button
                          className={styles.lookupSuggestionItem}
                          key={suggestion.key}
                          onClick={() => handleAddEmployeeAttendee(suggestion.employee)}
                          type="button"
                        >
                          <span className={styles.lookupSuggestionTitle}>
                            {suggestion.employee.employeeName}
                          </span>
                          <span className={styles.lookupSuggestionMeta}>MeadowBrook employee</span>
                          <span className={styles.lookupSuggestionMeta}>
                            {suggestion.employee.email}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                ) : attendeeSearchTerm.trim() && !isOptionsPending && !isSearchingRemoteEmployees ? (
                  <p className={styles.lookupHint}>No matching attendees were found.</p>
                ) : null}
                {remoteEmployeeSearchError ? (
                  <p className={styles.lookupHint}>{remoteEmployeeSearchError}</p>
                ) : null}
                {canInviteDirectEmail ? (
                  <button
                    className={styles.linkButton}
                    onClick={() => handleAddAttendeeEmails(attendeeSearchTerm)}
                    type="button"
                  >
                    Add {normalizedAttendeeSearchEmail}
                  </button>
                ) : null}
                {matchingDirectInviteContact && normalizedAttendeeSearchEmail ? (
                  <p className={styles.lookupHint}>
                    This email also exists as {matchingDirectInviteContact.contactName}; choosing the contact logs the activity under that account.
                  </p>
                ) : null}
                {viewerContact ? (
                  <label className={styles.checkboxLabel}>
                    <input
                      checked={includeOrganizerInAcumatica}
                      onChange={(event) => setIncludeOrganizerInAcumatica(event.target.checked)}
                      type="checkbox"
                    />
                    Add me to the Google invite
                  </label>
                ) : (
                  <p className={styles.lookupHint}>
                    No internal app contact matched your login, so you cannot be added automatically.
                  </p>
                )}
              </div>
            </div>

            <div className={styles.calendarRow}>
              <span className={styles.rowIcon}>Contact</span>
              <div className={styles.rowContent}>
                {relatedContact ? (
                  <div className={styles.relatedContactRow}>
                    <span className={styles.selectedContact}>
                      <strong>{relatedContact.contactName}</strong>
                      <span>{relatedContact.companyName ?? "No account"}</span>
                      <span>{relatedContact.email ?? "No email"}</span>
                    </span>
                    {!relatedContactLocked ? (
                      <button
                        className={styles.linkButton}
                        onClick={() => {
                          const nextRelatedId =
                            attendeeContactIds.find(
                              (contactId) => contactId !== relatedContact.contactId,
                            ) ?? null;
                          setRelatedContactId(nextRelatedId);
                          setIncludeRelatedInInvite(true);
                          setRelatedContactSearchTerm(
                            nextRelatedId !== null
                              ? contactById.get(nextRelatedId)?.contactName ?? ""
                              : "",
                          );
                          setAttendeeContactIds((current) => {
                            const remaining = current.filter(
                              (contactId) => contactId !== relatedContact.contactId,
                            );
                            return nextRelatedId !== null
                              ? uniqueContactIds([nextRelatedId, ...remaining])
                              : remaining;
                          });
                        }}
                        type="button"
                      >
                        Change
                      </button>
                    ) : (
                      <span className={styles.lookupHint}>Linked to the selected contact.</span>
                    )}
                  </div>
                ) : (
                  <>
                    <input
                      disabled={isOptionsPending || Boolean(optionsError && !options)}
                      onChange={(event) => setRelatedContactSearchTerm(event.target.value)}
                      placeholder={
                        isOptionsPending
                          ? "Loading contacts..."
                          : "Search an app contact"
                      }
                      value={relatedContactSearchTerm}
                    />
                    {relatedContactSearchTerm.trim() && relatedContactSuggestions.length > 0 ? (
                      <div className={styles.lookupSuggestions}>
                        {relatedContactSuggestions.map((contact) => (
                          <button
                            className={styles.lookupSuggestionItem}
                            key={contact.key}
                            onClick={() => handleSelectRelatedContact(contact)}
                            type="button"
                          >
                            <span className={styles.lookupSuggestionTitle}>{contact.contactName}</span>
                            <span className={styles.lookupSuggestionMeta}>
                              {contact.companyName ?? "No account"}
                            </span>
                            <span className={styles.lookupSuggestionMeta}>
                              {contact.email ?? "No email"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : relatedContactSearchTerm.trim() && !isOptionsPending ? (
                      <p className={styles.lookupHint}>No matching contacts were found.</p>
                    ) : null}
                  </>
                )}
                <button
                  className={styles.linkButton}
                  disabled={createContactAccountOptions.length === 0}
                  onClick={() => setIsCreateContactOpen(true)}
                  type="button"
                >
                  Create new contact
                </button>
                {optionsError ? (
                  <div className={styles.inlineNotice}>
                    <p className={styles.error}>{optionsError}</p>
                    {onRetryLoadOptions ? (
                      <button className={styles.secondaryButton} onClick={onRetryLoadOptions} type="button">
                        Retry
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className={styles.calendarRow}>
              <span className={styles.rowIcon}>Meet</span>
              <div className={styles.rowContent}>
                <button
                  className={`${styles.meetButton} ${
                    form.includeGoogleMeet ? styles.meetButtonActive : ""
                  }`}
                  onClick={() => updateForm("includeGoogleMeet", !form.includeGoogleMeet)}
                  type="button"
                >
                  {form.includeGoogleMeet
                    ? "Google Meet video conferencing will be added"
                    : "Add Google Meet video conferencing"}
                </button>
                {form.includeGoogleMeet && calendarSession?.status !== "connected" ? (
                  <p className={styles.lookupHint}>
                    Meet links are generated only when Google Calendar is connected.
                  </p>
                ) : null}
              </div>
            </div>

            <div className={styles.calendarRow}>
              <span className={styles.rowIcon}>Location</span>
              <div className={styles.rowContent}>
                <input
                  onChange={(event) => handleLocationChange(event.target.value)}
                  placeholder="Add rooms or location"
                  value={form.location ?? ""}
                />
                {locationLookupError ? <p className={styles.error}>{locationLookupError}</p> : null}
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
                (form.location ?? "").trim().length >= 3 &&
                locationSuggestions.length === 0 &&
                !locationLookupError ? (
                  <p className={styles.lookupHint}>No matching Canada Post addresses were found.</p>
                ) : null}
                {isApplyingLocationSuggestion ? (
                  <p className={styles.lookupHint}>Applying selected address...</p>
                ) : null}
              </div>
            </div>

            <div className={styles.calendarRow}>
              <span className={styles.rowIcon}>Description</span>
              <div className={styles.rowContent}>
                <textarea
                  className={styles.descriptionInput}
                  onChange={(event) => updateForm("details", event.target.value)}
                  placeholder="Add description"
                  value={form.details ?? ""}
                />
                <div className={styles.attachmentComposer}>
                  <button
                    className={styles.attachmentButton}
                    disabled={attachmentFiles.length >= MAX_MEETING_ATTACHMENT_FILES}
                    onClick={() => attachmentInputRef.current?.click()}
                    type="button"
                  >
                    Add attachment
                  </button>
                  <input
                    className={styles.fileInput}
                    multiple
                    onChange={handleSelectAttachmentFiles}
                    ref={attachmentInputRef}
                    type="file"
                  />
                </div>
                {attachmentFiles.length > 0 && !canUploadSelectedAttachments ? (
                  <p className={styles.lookupHint}>
                    Reconnect Google Calendar once so the app can upload and attach files through Google Drive.
                  </p>
                ) : null}
                {attachmentFiles.length > 0 ? (
                  <div className={styles.attachmentList}>
                    {attachmentFiles.map((attachment) => (
                      <span className={styles.attachmentChip} key={attachment.id}>
                        <span>
                          {attachment.fileName}
                          <small>{formatAttachmentSize(attachment.sizeBytes)}</small>
                        </span>
                        <button
                          aria-label={`Remove ${attachment.fileName}`}
                          onClick={() => handleRemoveAttachment(attachment.id)}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className={styles.calendarRow}>
              <span className={styles.rowIcon}>Private</span>
              <div className={styles.rowContent}>
                <textarea
                  className={styles.privateNotesInput}
                  onChange={(event) => updateForm("privateNotes", event.target.value)}
                  placeholder="Private notes"
                  value={form.privateNotes ?? ""}
                />
                <p className={styles.lookupHint}>
                  Private notes are stored for internal context and are not shared in the Google Calendar invite description.
                </p>
              </div>
            </div>
          </div>

          {formError ? <p className={styles.error}>{formError}</p> : null}

          <div className={styles.actions}>
            <button className={styles.secondaryButton} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className={styles.primaryButton}
              disabled={isScheduleDisabled}
              onClick={() => {
                void handleSubmit();
              }}
              type="button"
            >
              {isSubmitting
                ? "Scheduling..."
                : !isGoogleCalendarConnected
                  ? "Connect Calendar first"
                  : !canUploadSelectedAttachments
                    ? "Reconnect for attachments"
                    : createLabel}
            </button>
          </div>
        </div>
      </aside>

      <CreateContactDrawer
        accountOptions={createContactAccountOptions}
        initialAccountRecordId={
          source?.accountRecordId ??
          relatedContact?.businessAccountRecordId ??
          null
        }
        isOpen={isCreateContactOpen}
        onClose={() => setIsCreateContactOpen(false)}
        onContactCreated={handleMeetingContactCreated}
      />
    </>
  );
}
