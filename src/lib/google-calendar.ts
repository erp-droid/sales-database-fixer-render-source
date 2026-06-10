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
import type {
  CalendarEventsResponse,
  CalendarViewConference,
  CalendarViewEvent,
  GoogleCalendarSessionResponse,
} from "@/types/google-calendar";
import type { MeetingCreateRequest } from "@/types/meeting-create";

const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
];
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_ACCESS_TOKEN_SKEW_MS = 60 * 1000;
const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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

type GoogleDriveFileResponse = {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  iconLink?: string;
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
  attachmentFiles?: GoogleCalendarAttachmentUploadInput[];
  businessAccountId: string | null;
  companyName: string | null;
  relatedContactId: number | null;
  relatedContactName: string | null;
  request: MeetingCreateRequest;
};

export type GoogleCalendarAttachmentUploadInput = {
  data: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type UploadedGoogleCalendarAttachment = {
  fileId: string;
  fileUrl: string;
  iconLink?: string;
  mimeType: string;
  title: string;
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

function normalizeGoogleOauthScopes(tokenScope: string | null | undefined): Set<string> {
  return new Set(
    (tokenScope ?? "")
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

function hasGoogleOauthScope(
  connection: StoredGoogleCalendarConnection,
  scope: string,
): boolean {
  return normalizeGoogleOauthScopes(connection.tokenScope).has(scope);
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
      canUploadAttachments: false,
      requiresReconnectForAttachments: false,
    };
  }

  if (!expectedRedirectUri) {
    return {
      status: "needs_setup",
      connectedGoogleEmail: null,
      connectionError:
        "APP_BASE_URL is required for Google Calendar OAuth. Set APP_BASE_URL and authorize /api/calendar/oauth/callback in Google Cloud OAuth redirect URIs.",
      expectedRedirectUri: null,
      canUploadAttachments: false,
      requiresReconnectForAttachments: false,
    };
  }

  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    return {
      status: "disconnected",
      connectedGoogleEmail: null,
      connectionError: "Signed-in username is unavailable. Sign out and sign in again.",
      expectedRedirectUri,
      canUploadAttachments: false,
      requiresReconnectForAttachments: false,
    };
  }

  const connection = readGoogleCalendarConnection(normalizedLoginName);
  if (!connection) {
    return {
      status: "disconnected",
      connectedGoogleEmail: null,
      connectionError: null,
      expectedRedirectUri,
      canUploadAttachments: false,
      requiresReconnectForAttachments: false,
    };
  }

  const canUploadAttachments = hasGoogleOauthScope(connection, GOOGLE_DRIVE_FILE_SCOPE);

  return {
    status: "connected",
    connectedGoogleEmail: connection.connectedGoogleEmail,
    connectionError: canUploadAttachments
      ? null
      : "Reconnect Google Calendar once to allow real file attachments.",
    expectedRedirectUri,
    canUploadAttachments,
    requiresReconnectForAttachments: !canUploadAttachments,
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

function normalizeAttachmentLinks(links: string[]): string[] {
  return [
    ...new Set(
      (links ?? [])
        .map((link) => link.trim())
        .filter(Boolean),
    ),
  ];
}

function isGoogleDriveAttachmentLink(link: string): boolean {
  try {
    const url = new URL(link);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "drive.google.com" ||
      hostname.endsWith(".drive.google.com") ||
      hostname === "docs.google.com" ||
      hostname.endsWith(".docs.google.com")
    );
  } catch {
    return false;
  }
}

function buildGoogleCalendarAttachments(
  links: string[],
): Array<{ fileUrl: string; title: string }> {
  return normalizeAttachmentLinks(links)
    .filter(isGoogleDriveAttachmentLink)
    .map((link, index) => ({
      fileUrl: link,
      title: `Attachment ${index + 1}`,
    }));
}

function buildUploadedGoogleCalendarAttachments(
  attachments: UploadedGoogleCalendarAttachment[],
): Array<{ fileId: string; fileUrl: string; iconLink?: string; mimeType: string; title: string }> {
  return attachments.map((attachment) => ({
    fileId: attachment.fileId,
    fileUrl: attachment.fileUrl,
    ...(attachment.iconLink ? { iconLink: attachment.iconLink } : {}),
    mimeType: attachment.mimeType,
    title: attachment.title,
  }));
}

function buildAttachmentDescription(
  links: string[],
  uploadedAttachments: UploadedGoogleCalendarAttachment[],
): string {
  const normalizedLinks = normalizeAttachmentLinks(links);
  const uploadedLines = uploadedAttachments.map(
    (attachment) => `- ${attachment.title}: ${attachment.fileUrl}`,
  );
  if (normalizedLinks.length === 0 && uploadedLines.length === 0) {
    return "";
  }

  return [
    uploadedLines.length > 0
      ? `Attachments:\n${uploadedLines.join("\n")}`
      : "",
    normalizedLinks.length > 0
      ? `Attachment links:\n${normalizedLinks.map((link) => `- ${link}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function truncatePrivateExtendedProperty(value: string): string {
  return value.trim().slice(0, 1024);
}

function buildMeetingDescription(
  input: MeetingCalendarInviteInput,
  uploadedAttachments: UploadedGoogleCalendarAttachment[] = [],
): string | undefined {
  const attachmentDescription = buildAttachmentDescription(
    input.request.attachmentLinks,
    uploadedAttachments,
  );
  const parts = [
    input.request.details?.trim() || "",
    attachmentDescription,
    input.companyName?.trim() ? `Account: ${input.companyName.trim()}` : "",
    input.businessAccountId?.trim()
      ? `Business Account ID: ${input.businessAccountId.trim()}`
      : "",
    input.relatedContactName?.trim()
      ? `Related Contact: ${input.relatedContactName.trim()}`
      : input.relatedContactId !== null
        ? `Related Contact ID: ${input.relatedContactId}`
        : "",
    input.acumaticaEventId ? `Acumatica Event ID: ${input.acumaticaEventId}` : "",
    "Created by Sales Database Fixer.",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function buildGoogleCalendarEventPayload(
  input: MeetingCalendarInviteInput,
  uploadedAttachments: UploadedGoogleCalendarAttachment[] = [],
): Record<string, unknown> {
  const { startDateTimeIso, endDateTimeIso } = buildMeetingDateTimeRange(input.request);
  const attendees = dedupeGoogleCalendarAttendees(input.attendees);
  const attachments = [
    ...buildUploadedGoogleCalendarAttachments(uploadedAttachments),
    ...buildGoogleCalendarAttachments(input.request.attachmentLinks),
  ];
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
        ...(input.request.privateNotes?.trim()
          ? { privateNotes: truncatePrivateExtendedProperty(input.request.privateNotes) }
          : {}),
        ...(input.relatedContactId !== null
          ? { relatedContactId: String(input.relatedContactId) }
          : {}),
        sourceApp: "sales-database-fixer",
      },
    },
  };

  if (input.request.location?.trim()) {
    payload.location = input.request.location.trim();
  }

  const description = buildMeetingDescription(input, uploadedAttachments);
  if (description) {
    payload.description = description;
  }

  if (attendees.length > 0) {
    payload.attendees = attendees;
  }

  if (input.request.includeGoogleMeet) {
    payload.conferenceData = {
      createRequest: {
        requestId: input.meetingSyncKey,
        conferenceSolutionKey: {
          type: "hangoutsMeet",
        },
      },
    };
  }

  if (attachments.length > 0) {
    payload.attachments = attachments;
  }

  return payload;
}

function applyGoogleCalendarCreateParams(
  url: URL,
  input: MeetingCalendarInviteInput,
): void {
  url.searchParams.set("sendUpdates", "all");
  if (input.request.includeGoogleMeet) {
    url.searchParams.set("conferenceDataVersion", "1");
  }
  if (
    (input.attachmentFiles?.length ?? 0) > 0 ||
    buildGoogleCalendarAttachments(input.request.attachmentLinks).length > 0
  ) {
    url.searchParams.set("supportsAttachments", "true");
  }
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

function sanitizeAttachmentFileName(fileName: string): string {
  return fileName
    .trim()
    .replace(/[\\/\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 180) || "Meeting attachment";
}

function buildMultipartRelatedBody(input: {
  metadata: Record<string, unknown>;
  data: Buffer;
  mimeType: string;
}): { body: Buffer; contentType: string } {
  const boundary = `mb-calendar-${crypto.randomUUID()}`;
  const metadataPart = Buffer.from(
    [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(input.metadata),
      "",
      `--${boundary}`,
      `Content-Type: ${input.mimeType || "application/octet-stream"}`,
      "",
    ].join("\r\n"),
    "utf8",
  );
  const closingPart = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  return {
    body: Buffer.concat([metadataPart, input.data, closingPart]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

async function uploadGoogleDriveFile(
  accessToken: string,
  file: GoogleCalendarAttachmentUploadInput,
): Promise<UploadedGoogleCalendarAttachment> {
  const fileName = sanitizeAttachmentFileName(file.fileName);
  const mimeType = file.mimeType.trim() || "application/octet-stream";
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,mimeType,webViewLink,iconLink");

  const multipart = buildMultipartRelatedBody({
    metadata: {
      name: fileName,
      mimeType,
    },
    data: file.data,
    mimeType,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body as unknown as BodyInit,
    cache: "no-store",
  });
  const payload = await readJsonResponse<GoogleDriveFileResponse>(response);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      readGoogleErrorMessage(payload, `Unable to upload ${fileName} to Google Drive.`),
    );
  }

  const uploadedFile = payload ?? {};
  const fileId = uploadedFile.id?.trim();
  const fileUrl = uploadedFile.webViewLink?.trim();
  if (!fileId || !fileUrl) {
    throw new HttpError(
      502,
      `Google Drive uploaded ${fileName} but did not return a usable file link.`,
    );
  }

  return {
    fileId,
    fileUrl,
    ...(uploadedFile.iconLink?.trim() ? { iconLink: uploadedFile.iconLink.trim() } : {}),
    mimeType: uploadedFile.mimeType?.trim() || mimeType,
    title: uploadedFile.name?.trim() || fileName,
  };
}

async function deleteGoogleDriveFile(accessToken: string, fileId: string): Promise<void> {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
  );
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) {
    const payload = await readJsonResponse<Record<string, unknown>>(response);
    throw new HttpError(
      response.status,
      readGoogleErrorMessage(payload, "Unable to delete the uploaded Google Drive attachment."),
    );
  }
}

async function cleanupUploadedGoogleDriveFiles(
  accessToken: string,
  attachments: UploadedGoogleCalendarAttachment[],
): Promise<void> {
  await Promise.allSettled(
    attachments.map((attachment) => deleteGoogleDriveFile(accessToken, attachment.fileId)),
  );
}

async function uploadMeetingAttachmentsToGoogleDrive(
  accessToken: string,
  files: GoogleCalendarAttachmentUploadInput[],
): Promise<UploadedGoogleCalendarAttachment[]> {
  const uploaded: UploadedGoogleCalendarAttachment[] = [];
  try {
    for (const file of files) {
      uploaded.push(await uploadGoogleDriveFile(accessToken, file));
    }
  } catch (error) {
    await cleanupUploadedGoogleDriveFiles(accessToken, uploaded);
    throw error;
  }

  return uploaded;
}

function requireDriveAttachmentScope(
  connection: StoredGoogleCalendarConnection,
  input: MeetingCalendarInviteInput,
): void {
  if ((input.attachmentFiles?.length ?? 0) === 0) {
    return;
  }

  if (hasGoogleOauthScope(connection, GOOGLE_DRIVE_FILE_SCOPE)) {
    return;
  }

  throw new HttpError(
    409,
    "Reconnect Google Calendar to allow real file attachments, then try again.",
  );
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
  const uploadedAttachments = await uploadMeetingAttachmentsToGoogleDrive(
    accessToken,
    input.attachmentFiles ?? [],
  );
  const payload = buildGoogleCalendarEventPayload(input, uploadedAttachments);
  const existingEventId = await findExistingGoogleCalendarEventId(accessToken, input.acumaticaEventId);
  const method = existingEventId ? "PATCH" : "POST";
  const url = existingEventId
    ? new URL(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existingEventId)}`,
      )
    : new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  applyGoogleCalendarCreateParams(url, input);

  let eventId: string | undefined;
  try {
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
    eventId = response.id?.trim();
    if (!eventId) {
      throw new HttpError(502, "Google Calendar accepted the request but did not return an event id.");
    }
  } catch (error) {
    await cleanupUploadedGoogleDriveFiles(accessToken, uploadedAttachments);
    throw error;
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
  const uploadedAttachments = await uploadMeetingAttachmentsToGoogleDrive(
    accessToken,
    input.attachmentFiles ?? [],
  );
  const payload = buildGoogleCalendarEventPayload(input, uploadedAttachments);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  applyGoogleCalendarCreateParams(url, input);

  let eventId: string | undefined;
  try {
    const response = await requestGoogleCalendarJson<GoogleCalendarEventResponse>(url, {
      accessToken,
      init: {
        method: "POST",
        body: JSON.stringify(payload),
      },
      fallbackMessage: "Unable to create the Google Calendar invite.",
    });
    eventId = response.id?.trim();
    if (!eventId) {
      throw new HttpError(502, "Google Calendar accepted the request but did not return an event id.");
    }
  } catch (error) {
    await cleanupUploadedGoogleDriveFiles(accessToken, uploadedAttachments);
    throw error;
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
  requireDriveAttachmentScope(connection, input);

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
  requireDriveAttachmentScope(connection, input);

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

type GoogleCalendarEventTimeResource = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleCalendarEventAttendeeResource = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
  resource?: boolean;
};

type GoogleCalendarEventPersonResource = {
  email?: string;
  displayName?: string;
  self?: boolean;
};

type GoogleCalendarConferenceEntryPointResource = {
  entryPointType?: string;
  uri?: string;
  label?: string;
  pin?: string;
  regionCode?: string;
};

type GoogleCalendarConferenceDataResource = {
  conferenceId?: string;
  conferenceSolution?: {
    name?: string;
    key?: { type?: string };
  };
  entryPoints?: GoogleCalendarConferenceEntryPointResource[];
};

type GoogleCalendarEventReminderResource = {
  useDefault?: boolean;
  overrides?: Array<{
    method?: string;
    minutes?: number;
  }>;
};

type GoogleCalendarEventViewResource = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  hangoutLink?: string;
  htmlLink?: string;
  colorId?: string;
  recurrence?: string[];
  recurringEventId?: string;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  transparency?: string;
  visibility?: string;
  organizer?: GoogleCalendarEventPersonResource;
  creator?: GoogleCalendarEventPersonResource;
  conferenceData?: GoogleCalendarConferenceDataResource;
  reminders?: GoogleCalendarEventReminderResource;
  attendees?: GoogleCalendarEventAttendeeResource[];
  start?: GoogleCalendarEventTimeResource;
  end?: GoogleCalendarEventTimeResource;
};

type GoogleCalendarEventsListResource = {
  items?: GoogleCalendarEventViewResource[];
  nextPageToken?: string;
  timeZone?: string;
};

function readAllDayDateAsIso(date: string, dayOffset = 0): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }

  parsed.setDate(parsed.getDate() + dayOffset);
  return parsed.toISOString();
}

function normalizeGoogleText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function mapGoogleCalendarPerson(
  person: GoogleCalendarEventPersonResource | undefined,
): CalendarViewEvent["organizer"] {
  if (!person) {
    return null;
  }

  const email = normalizeGoogleText(person.email);
  const displayName = normalizeGoogleText(person.displayName);
  if (!email && !displayName) {
    return null;
  }

  return {
    email,
    displayName,
    isSelf: person.self === true,
  };
}

function buildConferenceView(
  conferenceData: GoogleCalendarConferenceDataResource | undefined,
  hangoutLink: string | null,
): CalendarViewConference | null {
  const entryPoints = conferenceData?.entryPoints ?? [];
  const videoEntryPoint = entryPoints.find((entryPoint) => entryPoint.entryPointType === "video");
  const phoneNumbers = entryPoints
    .filter((entryPoint) => entryPoint.entryPointType === "phone")
    .map((entryPoint) => ({
      label: normalizeGoogleText(entryPoint.label),
      uri: normalizeGoogleText(entryPoint.uri),
      pin: normalizeGoogleText(entryPoint.pin),
      regionCode: normalizeGoogleText(entryPoint.regionCode),
    }))
    .filter((entryPoint) => entryPoint.label || entryPoint.uri);
  const morePhoneNumbersUri =
    normalizeGoogleText(
      entryPoints.find((entryPoint) => entryPoint.entryPointType === "more")?.uri,
    ) ?? null;
  const videoUri = normalizeGoogleText(videoEntryPoint?.uri) ?? hangoutLink;
  const conferenceId =
    normalizeGoogleText(conferenceData?.conferenceId) ??
    normalizeGoogleText(videoEntryPoint?.label)?.replace(/^meet\.google\.com\//i, "") ??
    null;
  const name =
    normalizeGoogleText(conferenceData?.conferenceSolution?.name) ??
    (videoUri ? "Google Meet" : null);

  if (!name && !conferenceId && !videoUri && phoneNumbers.length === 0 && !morePhoneNumbersUri) {
    return null;
  }

  return {
    name,
    conferenceId,
    videoUri,
    phoneNumbers,
    morePhoneNumbersUri,
  };
}

function buildRecurrenceLabel(resource: GoogleCalendarEventViewResource): string | null {
  const rule = resource.recurrence
    ?.map((entry) => entry.trim())
    .find((entry) => entry.toUpperCase().startsWith("RRULE:"));
  if (!rule) {
    return resource.recurringEventId?.trim() ? "Repeating event" : null;
  }

  const values = new Map<string, string>();
  rule
    .slice("RRULE:".length)
    .split(";")
    .forEach((part) => {
      const [key, value] = part.split("=");
      if (key && value) {
        values.set(key.toUpperCase(), value);
      }
    });

  const frequency = values.get("FREQ");
  const interval = Number.parseInt(values.get("INTERVAL") ?? "1", 10);
  const every = Number.isFinite(interval) && interval > 1 ? interval : 1;
  const weeklyDays = values
    .get("BYDAY")
    ?.split(",")
    .map((day) => {
      const labels: Record<string, string> = {
        SU: "Sunday",
        MO: "Monday",
        TU: "Tuesday",
        WE: "Wednesday",
        TH: "Thursday",
        FR: "Friday",
        SA: "Saturday",
      };
      return labels[day.replace(/^\d+/, "").toUpperCase()] ?? null;
    })
    .filter((day): day is string => Boolean(day));

  if (frequency === "DAILY") {
    return every === 1 ? "Daily" : `Every ${every} days`;
  }
  if (frequency === "WEEKLY") {
    const base = every === 1 ? "Weekly" : `Every ${every} weeks`;
    return weeklyDays && weeklyDays.length > 0 ? `${base} on ${weeklyDays.join(", ")}` : base;
  }
  if (frequency === "MONTHLY") {
    return every === 1 ? "Monthly" : `Every ${every} months`;
  }
  if (frequency === "YEARLY") {
    return every === 1 ? "Annually" : `Every ${every} years`;
  }

  return "Repeating event";
}

function formatReminderOffset(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
  }

  const hours = minutes / 60;
  if (Number.isInteger(hours) && hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} before`;
  }

  const days = minutes / (60 * 24);
  if (Number.isInteger(days)) {
    return `${days} day${days === 1 ? "" : "s"} before`;
  }

  return `${minutes} minutes before`;
}

function buildReminderLabel(reminders: GoogleCalendarEventReminderResource | undefined): string | null {
  const overrides = reminders?.overrides?.filter(
    (override) => typeof override.minutes === "number",
  );
  if (overrides && overrides.length > 0) {
    return overrides.map((override) => formatReminderOffset(override.minutes ?? 0)).join(", ");
  }

  return reminders?.useDefault === true ? "Default notifications" : null;
}

function readReminderMinutes(
  reminders: GoogleCalendarEventReminderResource | undefined,
): number | null {
  const firstOverride = reminders?.overrides?.find(
    (override) => typeof override.minutes === "number",
  );
  return firstOverride?.minutes ?? null;
}

function readRecurrenceRule(resource: GoogleCalendarEventViewResource): string | null {
  return (
    resource.recurrence
      ?.map((entry) => entry.trim())
      .find((entry) => entry.toUpperCase().startsWith("RRULE:")) ?? null
  );
}

function mapGoogleCalendarEventToView(
  resource: GoogleCalendarEventViewResource,
): CalendarViewEvent | null {
  const eventId = resource.id?.trim();
  if (!eventId || resource.status === "cancelled") {
    return null;
  }

  const startDate = resource.start?.date ?? null;
  const endDate = resource.end?.date ?? null;
  const isAllDay = Boolean(startDate);
  const startIso = isAllDay
    ? readAllDayDateAsIso(startDate ?? "")
    : resource.start?.dateTime ?? null;
  const endIso = isAllDay
    ? readAllDayDateAsIso(endDate ?? startDate ?? "")
    : resource.end?.dateTime ?? startIso;
  if (!startIso || !endIso) {
    return null;
  }

  const selfAttendee = (resource.attendees ?? []).find((attendee) => attendee.self === true);
  const isOrganizer = resource.organizer?.self === true;
  const hangoutLink = normalizeGoogleText(resource.hangoutLink);
  const recurrenceRule = readRecurrenceRule(resource);

  return {
    id: eventId,
    summary: resource.summary?.trim() || "(No title)",
    status: resource.status === "tentative" ? "tentative" : "confirmed",
    isAllDay,
    startIso,
    endIso,
    startDate,
    endDate,
    startTimeZone: resource.start?.timeZone ?? null,
    endTimeZone: resource.end?.timeZone ?? null,
    location: normalizeGoogleText(resource.location),
    description: normalizeGoogleText(resource.description),
    hangoutLink,
    htmlLink: normalizeGoogleText(resource.htmlLink),
    colorId: normalizeGoogleText(resource.colorId),
    recurrenceRule,
    recurringEventId: normalizeGoogleText(resource.recurringEventId),
    reminderMinutes: readReminderMinutes(resource.reminders),
    usesDefaultReminders: resource.reminders?.useDefault !== false,
    guestsCanModify: resource.guestsCanModify === true,
    guestsCanInviteOthers: resource.guestsCanInviteOthers !== false,
    guestsCanSeeOtherGuests: resource.guestsCanSeeOtherGuests !== false,
    transparency: resource.transparency === "transparent" ? "transparent" : "opaque",
    visibility:
      resource.visibility === "public" ||
      resource.visibility === "private" ||
      resource.visibility === "confidential"
        ? resource.visibility
        : "default",
    organizer: mapGoogleCalendarPerson(resource.organizer),
    creator: mapGoogleCalendarPerson(resource.creator),
    conference: buildConferenceView(resource.conferenceData, hangoutLink),
    recurrenceLabel: buildRecurrenceLabel(resource),
    reminderLabel: buildReminderLabel(resource.reminders),
    isOrganizer,
    canReschedule: isOrganizer || resource.guestsCanModify === true,
    isRecurringInstance: Boolean(resource.recurringEventId?.trim()),
    isDeclined: selfAttendee?.responseStatus === "declined",
    attendees: (resource.attendees ?? [])
      .filter((attendee) => attendee.resource !== true)
      .map((attendee) => ({
        email: attendee.email?.trim() || null,
        displayName: attendee.displayName?.trim() || null,
        responseStatus: attendee.responseStatus ?? null,
        isSelf: attendee.self === true,
        isOrganizer: attendee.organizer === true,
      })),
  };
}

function requireGoogleCalendarReadConnection(loginName: string | null | undefined): {
  normalizedLoginName: string;
  connection: StoredGoogleCalendarConnection;
} {
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!normalizedLoginName) {
    throw new HttpError(
      400,
      "Google Calendar requires a signed-in username. Sign out and sign in again.",
    );
  }
  if (!isGoogleCalendarConfigured()) {
    throw new HttpError(
      500,
      "Google Calendar requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
    );
  }

  const connection = readGoogleCalendarConnection(normalizedLoginName);
  if (!connection) {
    throw new HttpError(
      409,
      "Google Calendar is not connected for this account. Connect Google Calendar and try again.",
    );
  }

  return { normalizedLoginName, connection };
}

async function listCalendarEventsWithAccessToken(
  accessToken: string,
  input: { timeMinIso: string; timeMaxIso: string },
): Promise<{ events: CalendarViewEvent[]; calendarTimeZone: string | null }> {
  const events: CalendarViewEvent[] = [];
  let calendarTimeZone: string | null = null;
  let pageToken: string | null = null;
  let remainingPages = 4;

  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", input.timeMinIso);
    url.searchParams.set("timeMax", input.timeMaxIso);
    url.searchParams.set("maxResults", "250");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload: GoogleCalendarEventsListResource =
      await requestGoogleCalendarJson<GoogleCalendarEventsListResource>(url, {
        accessToken,
        fallbackMessage: "Unable to load Google Calendar events.",
      });

    calendarTimeZone = payload.timeZone?.trim() || calendarTimeZone;
    (payload.items ?? []).forEach((item) => {
      const mapped = mapGoogleCalendarEventToView(item);
      if (mapped) {
        events.push(mapped);
      }
    });
    pageToken = payload.nextPageToken?.trim() || null;
    remainingPages -= 1;
  } while (pageToken && remainingPages > 0);

  return { events, calendarTimeZone };
}

export async function listCalendarEventsFromGoogleCalendar(
  loginName: string | null | undefined,
  input: { timeMinIso: string; timeMaxIso: string },
): Promise<CalendarEventsResponse> {
  const { normalizedLoginName, connection } = requireGoogleCalendarReadConnection(loginName);

  let accessToken = await resolveGoogleCalendarAccessToken(normalizedLoginName, connection);

  try {
    const listed = await listCalendarEventsWithAccessToken(accessToken, input);
    return { connectedGoogleEmail: connection.connectedGoogleEmail, ...listed };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) {
      throw error;
    }

    accessToken = (
      await refreshGoogleCalendarAccessToken(normalizedLoginName, connection.refreshToken)
    ).accessToken;
    const listed = await listCalendarEventsWithAccessToken(accessToken, input);
    return { connectedGoogleEmail: connection.connectedGoogleEmail, ...listed };
  }
}

export type CalendarEventUpdateInput = {
  eventId: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  summary?: string;
  location?: string | null;
  description?: string | null;
  attendees?: Array<{ email: string; displayName?: string | null }>;
  recurrence?: string[] | null;
  reminders?: { useDefault: boolean; minutes?: number | null };
  colorId?: string | null;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  includeGoogleMeet?: boolean;
};

export type CalendarEventScheduleUpdateInput = CalendarEventUpdateInput;

async function updateCalendarEventWithAccessToken(
  accessToken: string,
  input: CalendarEventUpdateInput,
): Promise<CalendarViewEvent> {
  const eventUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
  );
  const existing = await requestGoogleCalendarJson<GoogleCalendarEventViewResource>(eventUrl, {
    accessToken,
    fallbackMessage: "Unable to load the Google Calendar event.",
  });
  const existingView = mapGoogleCalendarEventToView(existing);
  if (!existingView) {
    throw new HttpError(404, "That Google Calendar event no longer exists.");
  }
  if (!existingView.canReschedule) {
    throw new HttpError(
      403,
      "Only events you organize (or that allow guest changes) can be moved here.",
    );
  }

  const buildTimePatch = (
    requested: { dateTime?: string; date?: string },
    existingTime: GoogleCalendarEventTimeResource | undefined,
  ): GoogleCalendarEventTimeResource => {
    if (requested.date) {
      return { date: requested.date };
    }

    return {
      dateTime: requested.dateTime,
      ...(existingTime?.timeZone ? { timeZone: existingTime.timeZone } : {}),
    };
  };

  const patchBody: Record<string, unknown> = {};
  if (input.start && input.end) {
    patchBody.start = buildTimePatch(input.start, existing.start);
    patchBody.end = buildTimePatch(input.end, existing.end);
  }
  if (input.summary !== undefined) {
    patchBody.summary = input.summary;
  }
  if (input.location !== undefined) {
    patchBody.location = input.location ?? "";
  }
  if (input.description !== undefined) {
    patchBody.description = input.description ?? "";
  }
  if (input.attendees !== undefined) {
    patchBody.attendees = input.attendees.map((attendee) => ({
      email: attendee.email,
      ...(attendee.displayName?.trim() ? { displayName: attendee.displayName.trim() } : {}),
    }));
  }
  if (input.recurrence !== undefined) {
    patchBody.recurrence = input.recurrence ?? [];
  }
  if (input.reminders !== undefined) {
    if (input.reminders.useDefault) {
      patchBody.reminders = { useDefault: true };
    } else {
      patchBody.reminders =
        input.reminders.minutes === null || input.reminders.minutes === undefined
          ? { useDefault: false, overrides: [] }
          : {
              useDefault: false,
              overrides: [{ method: "popup", minutes: input.reminders.minutes }],
            };
    }
  }
  if (input.colorId !== undefined) {
    patchBody.colorId = input.colorId ?? "";
  }
  if (input.guestsCanModify !== undefined) {
    patchBody.guestsCanModify = input.guestsCanModify;
  }
  if (input.guestsCanInviteOthers !== undefined) {
    patchBody.guestsCanInviteOthers = input.guestsCanInviteOthers;
  }
  if (input.guestsCanSeeOtherGuests !== undefined) {
    patchBody.guestsCanSeeOtherGuests = input.guestsCanSeeOtherGuests;
  }
  if (input.transparency !== undefined) {
    patchBody.transparency = input.transparency;
  }
  if (input.visibility !== undefined) {
    patchBody.visibility = input.visibility;
  }
  if (input.includeGoogleMeet === true && !existing.conferenceData) {
    patchBody.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (input.includeGoogleMeet === false) {
    patchBody.conferenceData = null;
  }

  const patchUrl = new URL(eventUrl.toString());
  patchUrl.searchParams.set("sendUpdates", "all");
  if (input.includeGoogleMeet !== undefined) {
    patchUrl.searchParams.set("conferenceDataVersion", "1");
  }
  const updated = await requestGoogleCalendarJson<GoogleCalendarEventViewResource>(patchUrl, {
    accessToken,
    init: {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    },
    fallbackMessage: "Unable to update the Google Calendar event.",
  });

  const updatedView = mapGoogleCalendarEventToView(updated);
  if (!updatedView) {
    throw new HttpError(502, "Google Calendar accepted the change but returned no event.");
  }

  return updatedView;
}

export async function updateCalendarEventInGoogleCalendar(
  loginName: string | null | undefined,
  input: CalendarEventUpdateInput,
): Promise<CalendarViewEvent> {
  const { normalizedLoginName, connection } = requireGoogleCalendarReadConnection(loginName);

  let accessToken = await resolveGoogleCalendarAccessToken(normalizedLoginName, connection);

  try {
    return await updateCalendarEventWithAccessToken(accessToken, input);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) {
      throw error;
    }

    accessToken = (
      await refreshGoogleCalendarAccessToken(normalizedLoginName, connection.refreshToken)
    ).accessToken;
    return await updateCalendarEventWithAccessToken(accessToken, input);
  }
}

export async function updateCalendarEventScheduleInGoogleCalendar(
  loginName: string | null | undefined,
  input: CalendarEventScheduleUpdateInput,
): Promise<CalendarViewEvent> {
  return updateCalendarEventInGoogleCalendar(loginName, input);
}

async function deleteCalendarEventWithAccessToken(
  accessToken: string,
  eventId: string,
): Promise<void> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
  );
  url.searchParams.set("sendUpdates", "all");
  await requestGoogleCalendarEmpty(url, {
    accessToken,
    init: { method: "DELETE" },
    fallbackMessage: "Unable to delete the Google Calendar event.",
    allowNotFound: true,
  });
}

export async function deleteCalendarEventInGoogleCalendar(
  loginName: string | null | undefined,
  eventId: string,
): Promise<void> {
  const { normalizedLoginName, connection } = requireGoogleCalendarReadConnection(loginName);

  let accessToken = await resolveGoogleCalendarAccessToken(normalizedLoginName, connection);

  try {
    await deleteCalendarEventWithAccessToken(accessToken, eventId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) {
      throw error;
    }

    accessToken = (
      await refreshGoogleCalendarAccessToken(normalizedLoginName, connection.refreshToken)
    ).accessToken;
    await deleteCalendarEventWithAccessToken(accessToken, eventId);
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
