"use client";

import { useEffect, useMemo, useState } from "react";

import { CreateContactDrawer } from "@/components/create-contact-drawer";
import {
  buildMeetingDateTimeRange,
  DEFAULT_MEETING_TIME_ZONE,
  findMeetingContactByEmail,
  findMeetingContactByLoginName,
  findMeetingContactOptionById,
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
  MeetingPriority,
  MeetingCreateRequest,
  MeetingSourceContext,
} from "@/types/meeting-create";
import type {
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import type { GoogleCalendarSessionResponse } from "@/types/google-calendar";

import styles from "./create-meeting-drawer.module.css";

type CreateMeetingDrawerProps = {
  isLoadingOptions: boolean;
  isOpen: boolean;
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

const MEETING_PRIORITY_OPTIONS: MeetingPriority[] = ["Low", "Normal", "High"];

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
    (record.connectedGoogleEmail === null || typeof record.connectedGoogleEmail === "string") &&
    typeof record.includeOrganizerInAcumatica === "boolean" &&
    typeof record.summary === "string" &&
    typeof record.relatedContactId === "number" &&
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
    (record.expectedRedirectUri === null || typeof record.expectedRedirectUri === "string")
  );
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

function buildDefaultMeetingSlot(timeZone: string): Pick<
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
  const end = new Date(start.getTime() + 60 * 60 * 1000);

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
  if (!source || source.contactId === null) {
    return null;
  }

  return {
    key: `${source.contactId}:${source.accountRecordId ?? source.accountKey}`,
    contactId: source.contactId,
    contactName: source.contactName?.trim() || `Contact ${source.contactId}`,
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

function buildEmptyMeetingForm(timeZone: string): MeetingFormState {
  const defaults = buildDefaultMeetingSlot(timeZone);

  return {
    summary: "",
    location: null,
    timeZone,
    startDate: defaults.startDate,
    startTime: defaults.startTime,
    endDate: defaults.endDate,
    endTime: defaults.endTime,
    priority: "Normal",
    details: null,
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

function uniqueContactIds(ids: Array<number | null | undefined>): number[] {
  return [...new Set(ids.filter((value): value is number => typeof value === "number"))];
}

function uniqueAttendeeEmails(emails: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      emails
        .map((email) => normalizeMeetingEmail(email))
        .filter((email): email is string => Boolean(email)),
    ),
  ];
}

function isValidAttendeeEmail(value: string | null | undefined): value is string {
  const normalized = normalizeMeetingEmail(value);
  if (!normalized) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
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

export function CreateMeetingDrawer({
  isLoadingOptions,
  isOpen,
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
    buildEmptyMeetingForm(defaultTimeZone),
  );
  const [relatedContactId, setRelatedContactId] = useState<number | null>(null);
  const [attendeeContactIds, setAttendeeContactIds] = useState<number[]>([]);
  const [attendeeEmails, setAttendeeEmails] = useState<string[]>([]);
  const [relatedContactSearchTerm, setRelatedContactSearchTerm] = useState("");
  const [attendeeSearchTerm, setAttendeeSearchTerm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreateContactOpen, setIsCreateContactOpen] = useState(false);
  const [localContacts, setLocalContacts] = useState<MeetingContactOption[]>([]);
  const [includeOrganizerInAcumatica, setIncludeOrganizerInAcumatica] = useState(false);
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
        byId.set(contact.contactId, contact);
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
  const viewerContact = useMemo(
    () => findMeetingContactByLoginName(contactDirectory, viewerLoginName),
    [contactDirectory, viewerLoginName],
  );
  const viewerContactId = viewerContact?.contactId ?? null;

  useEffect(() => {
    if (!isOpen) {
      setForm(buildEmptyMeetingForm(defaultTimeZone));
      setRelatedContactId(null);
      setAttendeeContactIds([]);
      setAttendeeEmails([]);
      setRelatedContactSearchTerm("");
      setAttendeeSearchTerm("");
      setFormError(null);
      setIsSubmitting(false);
      setIsCreateContactOpen(false);
      setLocalContacts([]);
      setIncludeOrganizerInAcumatica(false);
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
      return;
    }

    const nextTimeZone = options?.defaultTimeZone ?? DEFAULT_MEETING_TIME_ZONE;
    setForm(buildEmptyMeetingForm(nextTimeZone));
    setRelatedContactId(source?.contactId ?? null);
    setAttendeeContactIds(source?.contactId !== null && source?.contactId !== undefined ? [source.contactId] : []);
    setAttendeeEmails([]);
    setRelatedContactSearchTerm(source?.contactName?.trim() ?? "");
    setAttendeeSearchTerm("");
    setFormError(null);
    setIsSubmitting(false);
    setIsCreateContactOpen(false);
    setLocalContacts([]);
    setIncludeOrganizerInAcumatica(Boolean(viewerContact));
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
  }, [
    defaultTimeZone,
    isOpen,
    source?.accountKey,
    source?.accountRecordId,
    source?.businessAccountId,
    source?.companyName,
    source?.contactId,
    source?.contactName,
    options?.defaultTimeZone,
    viewerContact,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const controller = new AbortController();
    setIsLoadingCalendarSession(true);

    fetch("/api/calendar/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readJsonResponse<GoogleCalendarSessionResponse | { error?: string }>(
          response,
        );
        if (!response.ok) {
          throw new Error(parseError(payload));
        }
        if (!isGoogleCalendarSessionResponse(payload)) {
          throw new Error("Unexpected Google Calendar session response.");
        }

        if (!controller.signal.aborted) {
          setCalendarSession(payload);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setCalendarSession({
          status: "disconnected",
          connectedGoogleEmail: null,
          connectionError:
            error instanceof Error ? error.message : "Unable to load Google Calendar status.",
          expectedRedirectUri: null,
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingCalendarSession(false);
        }
      });

    return () => controller.abort();
  }, [isOpen]);

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
      }));
    }

    window.addEventListener("message", handleCalendarOauthMessage);
    return () => {
      window.removeEventListener("message", handleCalendarOauthMessage);
    };
  }, []);

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

  const relatedContactLocked = source?.contactId !== null && source?.contactId !== undefined;
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
    () => uniqueContactIds([relatedContactId, ...attendeeContactIds]),
    [attendeeContactIds, relatedContactId],
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
          .map((attendee) => normalizeMeetingEmail(attendee.email))
          .filter((value): value is string => Boolean(value)),
      ),
    [selectedAttendees],
  );
  const selectedExternalAttendeeEmails = useMemo(
    () =>
      normalizedAttendeeEmails.filter((email) => !selectedAttendeeEmailSet.has(email)),
    [normalizedAttendeeEmails, selectedAttendeeEmailSet],
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

    return contactDirectory
      .filter((contact) => !normalizedAttendeeIds.includes(contact.contactId))
      .filter((contact) => matchMeetingContact(contact, attendeeSearchTerm))
      .slice(0, 10);
  }, [attendeeSearchTerm, contactDirectory, isOpen, normalizedAttendeeIds]);
  const normalizedAttendeeSearchEmail = normalizeMeetingEmail(attendeeSearchTerm);
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
    !selectedExternalAttendeeEmails.includes(normalizedAttendeeSearchEmail) &&
    matchingDirectInviteContact === null;
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
    const popup = window.open(
      "/api/calendar/oauth/start?returnTo=/calendar/oauth/complete",
      "calendar-oauth",
      "popup=yes,width=540,height=720,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      setFormError("Allow pop-ups to connect Google Calendar.");
      return;
    }

    popup.focus();
  }

  async function handleDisconnectGoogleCalendar() {
    setFormError(null);
    setIsDisconnectingCalendar(true);

    try {
      const response = await fetch("/api/calendar/oauth/disconnect", {
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
    setRelatedContactId((current) => {
      const nextRelatedId = contact.contactId;
      setAttendeeContactIds((currentAttendees) =>
        uniqueContactIds([
          nextRelatedId,
          ...currentAttendees.filter((contactId) => contactId !== current),
        ]),
      );
      return nextRelatedId;
    });
    removeMatchingAttendeeEmail(contact.email);
    setRelatedContactSearchTerm(contact.contactName);
    setFormError(null);
  }

  function handleAddAttendee(contact: MeetingContactOption) {
    setAttendeeContactIds((current) => uniqueContactIds([...current, contact.contactId]));
    if (relatedContactId === null) {
      setRelatedContactId(contact.contactId);
      setRelatedContactSearchTerm(contact.contactName);
    }
    removeMatchingAttendeeEmail(contact.email);
    setAttendeeSearchTerm("");
    setFormError(null);
  }

  function handleAddAttendeeEmail(email: string) {
    const normalizedEmail = normalizeMeetingEmail(email);
    if (!normalizedEmail) {
      return;
    }

    setAttendeeEmails((current) => uniqueAttendeeEmails([...current, normalizedEmail]));
    setAttendeeSearchTerm("");
    setFormError(null);
  }

  function handleRemoveAttendee(contactId: number) {
    if (contactId === relatedContactId) {
      return;
    }

    setAttendeeContactIds((current) => current.filter((value) => value !== contactId));
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
      setLocalContacts((current) => {
        const byId = new Map(current.map((contact) => [contact.contactId, contact]));
        byId.set(createdContact.contactId, createdContact);
        return [...byId.values()].sort(compareMeetingContacts);
      });
      setAttendeeContactIds((current) =>
        uniqueContactIds([...current, createdContact.contactId]),
      );
      removeMatchingAttendeeEmail(createdContact.email);
      if (!relatedContactLocked) {
        setRelatedContactId(createdContact.contactId);
      }
      setRelatedContactSearchTerm(createdContact.contactName);
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

    const effectiveRelatedContactId = relatedContactId ?? normalizedAttendeeIds[0] ?? null;
    if (effectiveRelatedContactId === null) {
      setFormError("Select the related contact before creating the meeting.");
      return;
    }

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
        error instanceof Error ? error.message : "Meeting end must be after the start.",
      );
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessAccountRecordId: source?.accountRecordId ?? null,
          businessAccountId: source?.businessAccountId ?? null,
          sourceContactId: source?.contactId ?? null,
          organizerContactId: includeOrganizerInAcumatica ? viewerContactId : null,
          includeOrganizerInAcumatica,
          relatedContactId: effectiveRelatedContactId,
          summary: form.summary.trim(),
          location: normalizeNullableInput(form.location ?? ""),
          timeZone: defaultTimeZone,
          startDate: form.startDate,
          startTime: form.startTime,
          endDate: form.startDate,
          endTime: form.endTime,
          priority: form.priority,
          details: normalizeNullableInput(form.details ?? ""),
          attendeeContactIds: normalizedAttendeeIds,
          attendeeEmails: selectedExternalAttendeeEmails,
        } satisfies MeetingCreateRequest),
      });

      const payload = await readJsonResponse<MeetingCreateResponse | { error?: string }>(
        response,
      );

      if (!response.ok) {
        throw new Error(parseError(payload));
      }

      if (!isMeetingCreateResponse(payload)) {
        throw new Error("Unexpected response while creating the meeting.");
      }

      onMeetingCreated(payload);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create the meeting.");
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
      <aside className={`${styles.drawer} ${styles.drawerOpen}`}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.kicker}>Create Meeting</p>
            <h2>Create Acumatica Event</h2>
            <p className={styles.headerMeta}>
              {source
                ? `${source.companyName} · ${source.contactName ?? "Select a contact"}`
                : "Create an event under Activities and relate it to a contact."}
            </p>
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className={styles.drawerBody}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3>Calendar Invites</h3>
              {calendarSession?.status === "connected" ? (
                <button
                  className={styles.secondaryButton}
                  onClick={handleDisconnectGoogleCalendar}
                  type="button"
                  disabled={isDisconnectingCalendar}
                >
                  {isDisconnectingCalendar ? "Disconnecting..." : "Disconnect"}
                </button>
              ) : (
                <button
                  className={styles.secondaryButton}
                  onClick={handleConnectGoogleCalendar}
                  type="button"
                  disabled={isLoadingCalendarSession}
                >
                  {isLoadingCalendarSession ? "Checking..." : "Connect Google Calendar"}
                </button>
              )}
            </div>
            <p className={styles.lookupHint}>
              Meetings created here can send Google Calendar invites directly from the connected
              account instead of relying on the Gmail Apps Script bridge.
            </p>
            {calendarSession?.status === "connected" ? (
              <div className={styles.calendarStatusCard}>
                <span className={styles.calendarStatusBadge}>Connected</span>
                <strong>{calendarSession.connectedGoogleEmail}</strong>
                <span className={styles.calendarStatusMeta}>
                  Google Calendar will send invites for this meeting. Contact attendees can still be mirrored into Acumatica separately.
                </span>
              </div>
            ) : calendarSession?.status === "needs_setup" ? (
              <div className={styles.calendarStatusCard}>
                <span className={styles.calendarStatusBadgeMuted}>Setup needed</span>
                <span className={styles.calendarStatusMeta}>
                  {calendarSession.connectionError ??
                    "Google Calendar OAuth is not configured for this app yet."}
                </span>
                {calendarSession.expectedRedirectUri ? (
                  <code className={styles.calendarStatusCode}>
                    {calendarSession.expectedRedirectUri}
                  </code>
                ) : null}
              </div>
            ) : (
              <div className={styles.calendarStatusCard}>
                <span className={styles.calendarStatusBadgeMuted}>Not connected</span>
                <span className={styles.calendarStatusMeta}>
                  {calendarSession?.connectionError ??
                    "Acumatica will still create the meeting, but no Google invite will be sent until you connect Calendar."}
                </span>
                {calendarSession?.expectedRedirectUri ? (
                  <code className={styles.calendarStatusCode}>
                    {calendarSession.expectedRedirectUri}
                  </code>
                ) : null}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3>Event</h3>
            </div>

            <label>
              Summary
              <input
                onChange={(event) => updateForm("summary", event.target.value)}
                value={form.summary}
              />
            </label>

            <label>
              Location
              <input
                onChange={(event) => handleLocationChange(event.target.value)}
                placeholder="Start typing an address"
                value={form.location ?? ""}
              />
            </label>
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

            <div className={styles.fieldGrid}>
              <label>
                Priority
                <select
                  onChange={(event) =>
                    updateForm("priority", event.target.value as MeetingPriority)
                  }
                  value={form.priority}
                >
                  {MEETING_PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start Date
                <input
                  onChange={(event) => updateForm("startDate", event.target.value)}
                  type="date"
                  value={form.startDate}
                />
              </label>
              <label>
                Start Time
                <input
                  onChange={(event) => updateForm("startTime", event.target.value)}
                  type="time"
                  value={form.startTime}
                />
              </label>
              <label>
                End Time
                <input
                  onChange={(event) => updateForm("endTime", event.target.value)}
                  type="time"
                  value={form.endTime}
                />
              </label>
              <label>
                Category
                <input readOnly value="Red" />
              </label>
            </div>

            <label>
              Details
              <textarea
                className={styles.textarea}
                onChange={(event) => updateForm("details", event.target.value)}
                value={form.details ?? ""}
              />
            </label>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3>Related Contact</h3>
              <button
                className={styles.secondaryButton}
                disabled={createContactAccountOptions.length === 0}
                onClick={() => setIsCreateContactOpen(true)}
                type="button"
              >
                Create new contact
              </button>
            </div>

            {relatedContact ? (
              <div className={styles.selectedCard}>
                <strong>{relatedContact.contactName}</strong>
                <span>{relatedContact.companyName ?? "No account"}</span>
                <span>{relatedContact.email ?? "No email"}</span>
                {relatedContact.isInternal ? (
                  <span className={styles.badge}>Internal</span>
                ) : null}
                {!relatedContactLocked ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      const nextRelatedId =
                        attendeeContactIds.find((contactId) => contactId !== relatedContact.contactId) ??
                        null;
                      setRelatedContactId(nextRelatedId);
                      setRelatedContactSearchTerm(
                        nextRelatedId !== null
                          ? (contactById.get(nextRelatedId)?.contactName ?? "")
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
                    Change contact
                  </button>
                ) : (
                  <p className={styles.lookupHint}>
                    This meeting stays tied to the selected contact.
                  </p>
                )}
              </div>
            ) : (
              <>
                <label>
                  Search contact
                  <input
                    disabled={isOptionsPending || Boolean(optionsError && !options)}
                    onChange={(event) => setRelatedContactSearchTerm(event.target.value)}
                    placeholder={
                      isOptionsPending
                        ? "Loading contacts..."
                        : "Search name, account, email, or phone"
                    }
                    value={relatedContactSearchTerm}
                  />
                </label>
                <p className={styles.lookupHint}>
                  Acumatica needs one primary related contact on the invite-sending event. Every contact attendee below also gets its own mirrored meeting activity.
                </p>
                {relatedContactSuggestions.length > 0 ? (
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

            {optionsError ? (
              <div className={styles.inlineNotice}>
                <p className={styles.error}>{optionsError}</p>
                {onRetryLoadOptions ? (
                  <button
                    className={styles.secondaryButton}
                    onClick={onRetryLoadOptions}
                    type="button"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <h3>Attendees</h3>
            <p className={styles.lookupHint}>
              Contact attendees get mirrored meeting activities in Acumatica. When Google Calendar is connected, Google sends the invite emails and shows included attendees on the calendar event.
            </p>
            {viewerContact ? (
              <label className={styles.checkboxLabel}>
                <input
                  checked={includeOrganizerInAcumatica}
                  onChange={(event) => setIncludeOrganizerInAcumatica(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  Include my contact
                  <small className={styles.checkboxHint}>
                    Adds {viewerContact.contactName} {viewerContact.email ? `(${viewerContact.email})` : ""} to the mirrored Acumatica meeting activities and, when Google Calendar is connected, to the attendee list there as well.
                  </small>
                </span>
              </label>
            ) : (
              <p className={styles.lookupHint}>
                No internal contact matched your login, so your contact cannot be mirrored automatically.
              </p>
            )}

            <label>
              Search attendees
              <input
                disabled={isOptionsPending || !options}
                onChange={(event) => setAttendeeSearchTerm(event.target.value)}
                placeholder={
                  isOptionsPending
                    ? "Loading contacts..."
                    : "Search name, account, email, or phone"
                }
                value={attendeeSearchTerm}
              />
            </label>

            {attendeeSuggestions.length > 0 ? (
              <div className={styles.lookupSuggestions}>
                {attendeeSuggestions.map((contact) => (
                  <button
                    className={styles.lookupSuggestionItem}
                    key={contact.key}
                    onClick={() => handleAddAttendee(contact)}
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
            ) : attendeeSearchTerm.trim() && !isOptionsPending ? (
              <p className={styles.lookupHint}>No matching attendees were found.</p>
            ) : null}
            {canInviteDirectEmail ? (
              <button
                className={styles.secondaryButton}
                onClick={() => handleAddAttendeeEmail(attendeeSearchTerm)}
                type="button"
              >
                Invite {normalizedAttendeeSearchEmail} directly
              </button>
            ) : null}
            {matchingDirectInviteContact && normalizedAttendeeSearchEmail ? (
              <p className={styles.lookupHint}>
                {normalizedAttendeeSearchEmail} already exists in Acumatica. Add the contact entry above so the meeting is logged under that account.
              </p>
            ) : null}

            <div className={styles.attendeeList}>
              {selectedAttendees.map((attendee) => {
                const isLockedAttendee = attendee.contactId === relatedContactId;

                return (
                  <div className={styles.attendeeCard} key={attendee.contactId}>
                    <div>
                      <strong>{attendee.contactName}</strong>
                      <div className={styles.attendeeMeta}>
                        <span>{attendee.companyName ?? "No account"}</span>
                        <span>{attendee.email ?? "No email"}</span>
                        {attendee.isInternal ? (
                          <span className={styles.badge}>Internal</span>
                        ) : null}
                        {isLockedAttendee ? (
                          <span className={styles.badge}>Related</span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      className={styles.secondaryButton}
                      disabled={isLockedAttendee}
                      onClick={() => handleRemoveAttendee(attendee.contactId)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {selectedExternalAttendeeEmails.map((email) => (
                <div className={styles.attendeeCard} key={email}>
                  <div>
                    <strong>{email}</strong>
                    <div className={styles.attendeeMeta}>
                      <span>Direct email invite</span>
                      <span>Not linked to an Acumatica contact</span>
                    </div>
                  </div>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      setAttendeeEmails((current) =>
                        current.filter((value) => normalizeMeetingEmail(value) !== email),
                      );
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>

          {formError ? <p className={styles.error}>{formError}</p> : null}

          <div className={styles.actions}>
            <button className={styles.secondaryButton} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className={styles.primaryButton}
              disabled={isSubmitting}
              onClick={() => {
                void handleSubmit();
              }}
              type="button"
            >
              {isSubmitting ? "Creating..." : "Create meeting"}
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
