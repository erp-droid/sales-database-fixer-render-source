import crypto from "node:crypto";

import type { NextRequest } from "next/server";

import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  buildMeetingDateTimeRange,
  normalizeMeetingEmail,
  type ResolvedMeetingInviteAttendee,
} from "@/lib/meeting-create";
import {
  deleteGoogleCalendarConnection,
  readGoogleCalendarConnection,
  storeGoogleCalendarConnection,
  updateGoogleCalendarAccessToken,
  type StoredGoogleCalendarConnection,
} from "@/lib/google-calendar-store";
import type { GoogleCalendarSessionResponse } from "@/types/google-calendar";
import type { MeetingCreateRequest } from "@/types/meeting-create";

const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
];
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_ACCESS_TOKEN_SKEW_MS = 60 * 1000;

type GoogleOauthState = {
  loginName: string;
  returnTo: string;
  issuedAt: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEventResponse = {
  id?: string;
  items?: Array<{ id?: string }>;
};

export type MeetingCalendarInviteSyncResult =
  | {
      status: "created" | "updated";
      eventId: string;
      connectedGoogleEmail: string;
    }
  | {
      status: "skipped";
      reason: "missing_login_name" | "not_configured" | "not_connected";
    };

export type MeetingInviteAuthority = "google" | "acumatica";

type MeetingCalendarInviteInput = {
  acumaticaEventId: string | null;
  meetingSyncKey: string;
  attendees: ResolvedMeetingInviteAttendee[];
  businessAccountId: string | null;
  companyName: string | null;
  relatedContactId: number;
  relatedContactName: string | null;
  request: MeetingCreateRequest;
};

function normalizeLoginName(loginName: string | null | undefined): string | null {
  const normalized = loginName?.trim().toLowerCase() ?? "";
  return normalized || null;
}

function readGoogleOauthSecret(): string {
  const env = getEnv();
  const secret = env.USER_CREDENTIALS_SECRET ?? env.MAIL_SERVICE_SHARED_SECRET;
  if (!secret?.trim()) {
    throw new HttpError(
      500,
      "USER_CREDENTIALS_SECRET or MAIL_SERVICE_SHARED_SECRET is required for Google Calendar OAuth.",
    );
  }

  return secret.trim();
}

function readGoogleOauthConfig(): { clientId: string; clientSecret: string } {
  const env = getEnv();
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new HttpError(
      500,
      "Google Calendar OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

export function isGoogleCalendarConfigured(): boolean {
  const env = getEnv();
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signOauthState(encodedPayload: string): string {
  return crypto
    .createHmac("sha256", readGoogleOauthSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function sanitizeReturnTo(returnTo: string | null | undefined): string {
  const trimmed = returnTo?.trim() ?? "";
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/calendar/oauth/complete";
  }

  return trimmed;
}

export function buildGoogleCalendarOauthState(input: {
  loginName: string;
  returnTo?: string | null;
}): string {
  const payload: GoogleOauthState = {
    loginName: input.loginName.trim().toLowerCase(),
    returnTo: sanitizeReturnTo(input.returnTo),
    issuedAt: Date.now(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signOauthState(encodedPayload)}`;
}

export function parseGoogleCalendarOauthState(value: string): GoogleOauthState {
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) {
    throw new HttpError(400, "Google Calendar OAuth state is invalid.");
  }

  const expectedSignature = signOauthState(encodedPayload);
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    throw new HttpError(400, "Google Calendar OAuth state could not be verified.");
  }

  let parsed: GoogleOauthState;
  try {
    parsed = JSON.parse(base64UrlDecode(encodedPayload)) as GoogleOauthState;
  } catch {
    throw new HttpError(400, "Google Calendar OAuth state payload is unreadable.");
  }

  const loginName = normalizeLoginName(parsed.loginName);
  if (!loginName) {
    throw new HttpError(400, "Google Calendar OAuth state is missing a user.");
  }

  if (!Number.isFinite(parsed.issuedAt) || Date.now() - parsed.issuedAt > GOOGLE_OAUTH_STATE_TTL_MS) {
    throw new HttpError(400, "Google Calendar OAuth state expired. Start the connection again.");
  }

  return {
    loginName,
    returnTo: sanitizeReturnTo(parsed.returnTo),
    issuedAt: parsed.issuedAt,
  };
}

function readAppBaseUrl(request: NextRequest): string {
  return getEnv().APP_BASE_URL?.trim() || request.nextUrl.origin;
}

export function readGoogleCalendarExpectedRedirectUri(): string | null {
  if (!isGoogleCalendarConfigured()) {
    return null;
  }

  const appBaseUrl = getEnv().APP_BASE_URL?.trim();
  if (!appBaseUrl) {
    return null;
  }

  return new URL("/api/calendar/oauth/callback", appBaseUrl).toString();
}

function requireGoogleCalendarRedirectUri(): string {
  const redirectUri = readGoogleCalendarExpectedRedirectUri();
  if (redirectUri) {
    return redirectUri;
  }

  throw new HttpError(
    500,
    "APP_BASE_URL is required for Google Calendar OAuth. Set APP_BASE_URL and authorize /api/calendar/oauth/callback in Google Cloud OAuth redirect URIs.",
  );
}

export function buildGoogleCalendarOauthCompleteUrl(
  request: NextRequest,
  returnTo: string | null | undefined,
  params: Record<string, string | null | undefined>,
): URL {
  const target = new URL(sanitizeReturnTo(returnTo), readAppBaseUrl(request));
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      target.searchParams.set(key, value);
    }
  });
  return target;
}

function buildGoogleCalendarRedirectUri(): string {
  return requireGoogleCalendarRedirectUri();
}

export function buildGoogleCalendarOauthStartUrl(
  input: { loginName: string; returnTo?: string | null },
): URL {
  const { clientId } = readGoogleOauthConfig();
  const redirectUri = buildGoogleCalendarRedirectUri();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", GOOGLE_CALENDAR_OAUTH_SCOPES.join(" "));
  url.searchParams.set(
    "state",
    buildGoogleCalendarOauthState({
      loginName: input.loginName,
      returnTo: input.returnTo,
    }),
  );
  return url;
}

function readGoogleErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const message =
    (typeof record.error_description === "string" && record.error_description.trim()) ||
    (typeof record.error === "string" && record.error.trim()) ||
    (typeof record.message === "string" && record.message.trim()) ||
    "";
  return message || fallback;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

export async function exchangeGoogleCalendarOauthCode(
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = readGoogleOauthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: buildGoogleCalendarRedirectUri(),
    }),
    cache: "no-store",
  });
  const payload = await readJsonResponse<GoogleTokenResponse>(response);
  if (!response.ok) {
    throw new HttpError(
      502,
      readGoogleErrorMessage(payload, "Unable to complete Google Calendar connection."),
    );
  }

  if (!payload?.access_token) {
    throw new HttpError(502, "Google Calendar connection did not return an access token.");
  }

  return payload;
}

async function refreshGoogleCalendarAccessToken(
  loginName: string,
  refreshToken: string,
): Promise<{
  accessToken: string;
  accessTokenExpiresAt: string | null;
  tokenScope: string | null;
}> {
  const { clientId, clientSecret } = readGoogleOauthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const payload = await readJsonResponse<GoogleTokenResponse>(response);
  if (!response.ok || !payload?.access_token) {
    if (payload?.error === "invalid_grant") {
      deleteGoogleCalendarConnection(loginName);
      throw new HttpError(
        401,
        "Google Calendar access expired. Reconnect Google Calendar and try again.",
      );
    }

    throw new HttpError(
      502,
      readGoogleErrorMessage(payload, "Unable to refresh Google Calendar access."),
    );
  }

  const accessTokenExpiresAt =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null;
  updateGoogleCalendarAccessToken({
    loginName,
    accessToken: payload.access_token,
    accessTokenExpiresAt,
    tokenScope: payload.scope ?? null,
  });

  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt,
    tokenScope: payload.scope ?? null,
  };
}

function isAccessTokenFresh(connection: StoredGoogleCalendarConnection): boolean {
  if (!connection.accessToken || !connection.accessTokenExpiresAt) {
    return false;
  }

  const expiryMs = Date.parse(connection.accessTokenExpiresAt);
  if (!Number.isFinite(expiryMs)) {
    return false;
  }

  return expiryMs - Date.now() > GOOGLE_ACCESS_TOKEN_SKEW_MS;
}

async function resolveGoogleCalendarAccessToken(
  loginName: string,
  connection: StoredGoogleCalendarConnection,
): Promise<string> {
  if (isAccessTokenFresh(connection) && connection.accessToken) {
    return connection.accessToken;
  }

  const refreshed = await refreshGoogleCalendarAccessToken(loginName, connection.refreshToken);
  return refreshed.accessToken;
}

export async function fetchGoogleCalendarProfile(accessToken: string): Promise<{
  email: string;
}> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  const payload = await readJsonResponse<Record<string, unknown>>(response);
  if (!response.ok) {
    throw new HttpError(
      502,
      readGoogleErrorMessage(payload, "Unable to read the connected Google account."),
    );
  }

  const email =
    typeof payload?.email === "string" && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : null;
  if (!email) {
    throw new HttpError(502, "Google did not return the connected account email.");
  }

  return { email };
}

export function readGoogleCalendarSession(
  loginName: string | null | undefined,
): GoogleCalendarSessionResponse {
  const expectedRedirectUri = readGoogleCalendarExpectedRedirectUri();

  if (!isGoogleCalendarConfigured()) {
    return {
      status: "needs_setup",
      connectedGoogleEmail: null,
      connectionError:
        "Google Calendar OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
      expectedRedirectUri,
    };
  }

  if (!expectedRedirectUri) {
    return {
      status: "needs_setup",
      connectedGoogleEmail: null,
      connectionError:
        "APP_BASE_URL is required for Google Calendar OAuth. Set APP_BASE_URL and authorize /api/calendar/oauth/callback in Google Cloud OAuth redirect URIs.",
      expectedRedirectUri: null,
    };
  }

  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    return {
      status: "disconnected",
      connectedGoogleEmail: null,
      connectionError: "Signed-in username is unavailable. Sign out and sign in again.",
      expectedRedirectUri,
    };
  }

  const connection = readGoogleCalendarConnection(normalizedLoginName);
  if (!connection) {
    return {
      status: "disconnected",
      connectedGoogleEmail: null,
      connectionError: null,
      expectedRedirectUri,
    };
  }

  return {
    status: "connected",
    connectedGoogleEmail: connection.connectedGoogleEmail,
    connectionError: null,
    expectedRedirectUri,
  };
}

export function readGoogleCalendarInviteAuthority(
  loginName: string | null | undefined,
): MeetingInviteAuthority {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName || !isGoogleCalendarConfigured()) {
    return "acumatica";
  }

  return readGoogleCalendarConnection(normalizedLoginName) ? "google" : "acumatica";
}

export function disconnectGoogleCalendar(loginName: string): void {
  deleteGoogleCalendarConnection(loginName);
}

function dedupeGoogleCalendarAttendees(
  attendees: ResolvedMeetingInviteAttendee[],
): Array<{ email: string; displayName?: string }> {
  const deduped = new Map<string, { email: string; displayName?: string }>();

  attendees.forEach((attendee) => {
    const normalizedEmail = normalizeMeetingEmail(attendee.email);
    if (!normalizedEmail || deduped.has(normalizedEmail)) {
      return;
    }

    deduped.set(normalizedEmail, {
      email: normalizedEmail,
      ...(attendee.contactName?.trim() ? { displayName: attendee.contactName.trim() } : {}),
    });
  });

  return [...deduped.values()];
}

function buildMeetingDescription(input: MeetingCalendarInviteInput): string | undefined {
  const parts = [
    input.request.details?.trim() || "",
    input.companyName?.trim() ? `Account: ${input.companyName.trim()}` : "",
    input.businessAccountId?.trim()
      ? `Business Account ID: ${input.businessAccountId.trim()}`
      : "",
    input.relatedContactName?.trim()
      ? `Related Contact: ${input.relatedContactName.trim()}`
      : `Related Contact ID: ${input.relatedContactId}`,
    input.acumaticaEventId ? `Acumatica Event ID: ${input.acumaticaEventId}` : "",
    "Created by Sales Database Fixer.",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function buildGoogleCalendarEventPayload(
  input: MeetingCalendarInviteInput,
): Record<string, unknown> {
  const { startDateTimeIso, endDateTimeIso } = buildMeetingDateTimeRange(input.request);
  const attendees = dedupeGoogleCalendarAttendees(input.attendees);
  const payload: Record<string, unknown> = {
    summary: input.request.summary,
    start: {
      dateTime: startDateTimeIso,
      timeZone: input.request.timeZone,
    },
    end: {
      dateTime: endDateTimeIso,
      timeZone: input.request.timeZone,
    },
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: {
      useDefault: true,
    },
    extendedProperties: {
      private: {
        ...(input.acumaticaEventId ? { acumaticaEventId: input.acumaticaEventId } : {}),
        meetingSyncKey: input.meetingSyncKey,
        relatedContactId: String(input.relatedContactId),
        sourceApp: "sales-database-fixer",
      },
    },
  };

  if (input.request.location?.trim()) {
    payload.location = input.request.location.trim();
  }

  const description = buildMeetingDescription(input);
  if (description) {
    payload.description = description;
  }

  if (attendees.length > 0) {
    payload.attendees = attendees;
  }

  return payload;
}

async function requestGoogleCalendarJson<T>(
  url: URL | string,
  input: {
    accessToken: string;
    init?: RequestInit;
    fallbackMessage: string;
  },
): Promise<T> {
  const response = await fetch(url, {
    ...input.init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = await readJsonResponse<T & Record<string, unknown>>(response);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      readGoogleErrorMessage(payload, input.fallbackMessage),
    );
  }

  return (payload ?? {}) as T;
}

async function requestGoogleCalendarEmpty(
  url: URL | string,
  input: {
    accessToken: string;
    init?: RequestInit;
    fallbackMessage: string;
    allowNotFound?: boolean;
  },
): Promise<void> {
  const response = await fetch(url, {
    ...input.init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = await readJsonResponse<Record<string, unknown>>(response);
  if (input.allowNotFound && response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new HttpError(
      response.status,
      readGoogleErrorMessage(payload, input.fallbackMessage),
    );
  }
}

async function findExistingGoogleCalendarEventId(
  accessToken: string,
  acumaticaEventId: string | null,
): Promise<string | null> {
  if (!acumaticaEventId?.trim()) {
    return null;
  }

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("privateExtendedProperty", `acumaticaEventId=${acumaticaEventId}`);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("singleEvents", "true");

  const payload = await requestGoogleCalendarJson<GoogleCalendarEventResponse>(url, {
    accessToken,
    fallbackMessage: "Unable to query the matching Google Calendar invite.",
  });
  const eventId = payload.items?.find((item) => typeof item.id === "string" && item.id.trim())?.id;
  return eventId?.trim() || null;
}

async function upsertMeetingInviteWithAccessToken(
  accessToken: string,
  _connection: StoredGoogleCalendarConnection,
  input: MeetingCalendarInviteInput,
): Promise<{ status: "created" | "updated"; eventId: string }> {
  const payload = buildGoogleCalendarEventPayload(input);
  const existingEventId = await findExistingGoogleCalendarEventId(accessToken, input.acumaticaEventId);
  const method = existingEventId ? "PATCH" : "POST";
  const url = existingEventId
    ? new URL(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existingEventId)}`,
      )
    : new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("sendUpdates", "all");

  const response = await requestGoogleCalendarJson<GoogleCalendarEventResponse>(url, {
    accessToken,
    init: {
      method,
      body: JSON.stringify(payload),
    },
    fallbackMessage:
      method === "POST"
        ? "Unable to create the Google Calendar invite."
        : "Unable to update the Google Calendar invite.",
  });
  const eventId = response.id?.trim();
  if (!eventId) {
    throw new HttpError(502, "Google Calendar accepted the request but did not return an event id.");
  }

  return {
    status: existingEventId ? "updated" : "created",
    eventId,
  };
}

async function createMeetingInviteWithAccessToken(
  accessToken: string,
  _connection: StoredGoogleCalendarConnection,
  input: MeetingCalendarInviteInput,
): Promise<{ status: "created"; eventId: string }> {
  const payload = buildGoogleCalendarEventPayload(input);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("sendUpdates", "all");

  const response = await requestGoogleCalendarJson<GoogleCalendarEventResponse>(url, {
    accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    fallbackMessage: "Unable to create the Google Calendar invite.",
  });
  const eventId = response.id?.trim();
  if (!eventId) {
    throw new HttpError(502, "Google Calendar accepted the request but did not return an event id.");
  }

  return {
    status: "created",
    eventId,
  };
}

async function deleteMeetingInviteWithAccessToken(
  accessToken: string,
  eventId: string,
): Promise<void> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
  );
  await requestGoogleCalendarEmpty(url, {
    accessToken,
    init: {
      method: "DELETE",
    },
    fallbackMessage: "Unable to delete the Google Calendar invite.",
    allowNotFound: true,
  });
}

export async function upsertMeetingInviteToGoogleCalendar(
  loginName: string | null | undefined,
  input: MeetingCalendarInviteInput,
): Promise<MeetingCalendarInviteSyncResult> {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    return {
      status: "skipped",
      reason: "missing_login_name",
    };
  }

  if (!isGoogleCalendarConfigured()) {
    return {
      status: "skipped",
      reason: "not_configured",
    };
  }

  const connection = readGoogleCalendarConnection(normalizedLoginName);
  if (!connection) {
    return {
      status: "skipped",
      reason: "not_connected",
    };
  }

  let accessToken = await resolveGoogleCalendarAccessToken(normalizedLoginName, connection);

  try {
    const synced = await upsertMeetingInviteWithAccessToken(accessToken, connection, input);
    return {
      status: synced.status,
      eventId: synced.eventId,
      connectedGoogleEmail: connection.connectedGoogleEmail,
    };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) {
      throw error;
    }

    accessToken = (
      await refreshGoogleCalendarAccessToken(normalizedLoginName, connection.refreshToken)
    ).accessToken;
    const retried = await upsertMeetingInviteWithAccessToken(accessToken, connection, input);
    return {
      status: retried.status,
      eventId: retried.eventId,
      connectedGoogleEmail: connection.connectedGoogleEmail,
    };
  }
}

export async function createMeetingInviteInGoogleCalendar(
  loginName: string | null | undefined,
  input: MeetingCalendarInviteInput,
): Promise<{ status: "created"; eventId: string; connectedGoogleEmail: string }> {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    throw new HttpError(
      400,
      "Google Calendar invite requires a signed-in username. Sign out and sign in again.",
    );
  }
  if (!isGoogleCalendarConfigured()) {
    throw new HttpError(
      500,
      "Google Calendar invite requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }

  const connection = readGoogleCalendarConnection(normalizedLoginName);
  if (!connection) {
    throw new HttpError(
      409,
      "Google Calendar is not connected for this account. Connect Google Calendar and try again.",
    );
  }

  let accessToken = await resolveGoogleCalendarAccessToken(normalizedLoginName, connection);

  try {
    const created = await createMeetingInviteWithAccessToken(accessToken, connection, input);
    return {
      status: created.status,
      eventId: created.eventId,
      connectedGoogleEmail: connection.connectedGoogleEmail,
    };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) {
      throw error;
    }

    accessToken = (
      await refreshGoogleCalendarAccessToken(normalizedLoginName, connection.refreshToken)
    ).accessToken;
    const created = await createMeetingInviteWithAccessToken(accessToken, connection, input);
    return {
      status: created.status,
      eventId: created.eventId,
      connectedGoogleEmail: connection.connectedGoogleEmail,
    };
  }
}

export async function deleteMeetingInviteFromGoogleCalendar(
  loginName: string | null | undefined,
  eventId: string,
): Promise<void> {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName || !eventId.trim() || !isGoogleCalendarConfigured()) {
    return;
  }

  const connection = readGoogleCalendarConnection(normalizedLoginName);
  if (!connection) {
    return;
  }

  let accessToken = await resolveGoogleCalendarAccessToken(normalizedLoginName, connection);

  try {
    await deleteMeetingInviteWithAccessToken(accessToken, eventId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) {
      throw error;
    }

    accessToken = (
      await refreshGoogleCalendarAccessToken(normalizedLoginName, connection.refreshToken)
    ).accessToken;
    await deleteMeetingInviteWithAccessToken(accessToken, eventId);
  }
}

export function storeGoogleCalendarOauthConnection(input: {
  loginName: string;
  connectedGoogleEmail: string;
  refreshToken: string;
  accessToken: string;
  expiresInSeconds?: number;
  tokenScope?: string | null;
}): void {
  storeGoogleCalendarConnection({
    loginName: input.loginName,
    connectedGoogleEmail: input.connectedGoogleEmail,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    accessTokenExpiresAt:
      typeof input.expiresInSeconds === "number" && Number.isFinite(input.expiresInSeconds)
        ? new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
        : null,
    tokenScope: input.tokenScope ?? null,
  });
}

export function buildGoogleCalendarWarningMessage(
  result: MeetingCalendarInviteSyncResult,
): string | null {
  if (result.status !== "skipped") {
    return null;
  }

  if (result.reason === "missing_login_name") {
    return "Google Calendar invite skipped because the signed-in username is unavailable. Sign out and sign in again.";
  }

  if (result.reason === "not_configured") {
    return "Google Calendar invite skipped because Google OAuth is not configured for this app.";
  }

  return "Google Calendar is not connected for your account, so no calendar invite was sent.";
}

export function describeGoogleCalendarError(error: unknown): string {
  return `Google Calendar invite failed: ${getErrorMessage(error)}`;
}
