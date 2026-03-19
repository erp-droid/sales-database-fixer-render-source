import { after, NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { logMailSendAudit } from "@/lib/audit-log-store";
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { repairMailActivitySync } from "@/lib/mail-activity-sync";
import { type ResolvedMailSender, resolveMailSenderForRequest } from "@/lib/mail-auth";
import { drainPendingMailSendJobs, enqueueMailSendJob } from "@/lib/mail-send-jobs";
import { attachMatchedContactsToMailPayload } from "@/lib/mail-recipient-matches";
import { collectUnresolvedMailRecipientEmails } from "@/lib/mail-validation";
import {
  buildMailServiceOauthStartUrl,
  requestMailService,
} from "@/lib/mail-proxy";
import type { MailComposePayload, MailSendResponse } from "@/types/mail-compose";
import type { MailSessionResponse } from "@/types/mail";
import type { MailThreadListResponse } from "@/types/mail-thread";

type AuthCookieRefreshState = {
  value: string | null;
};

const MAIL_SESSION_FOLDERS: MailSessionResponse["folders"] = [
  "inbox",
  "sent",
  "drafts",
  "starred",
];
const MAIL_SESSION_TIMEOUT_MS = 3000;
const MAIL_SESSION_CACHE_TTL_MS = 45_000;
const MAIL_THREADS_TIMEOUT_MS = 5000;
const MAIL_THREADS_CACHE_TTL_MS = 30_000;
const MAIL_SEND_TIMEOUT_MS = 20_000;
const MAIL_SEND_TIMEOUT_MESSAGE =
  "Sending email is taking longer than expected. Check Mail in a few seconds and retry if needed.";

type CachedMailSessionEntry = {
  expiresAt: number;
  payload: MailSessionResponse;
};

type CachedMailThreadListEntry = {
  expiresAt: number;
  payload: MailThreadListResponse;
};

const mailSessionCache = new Map<string, CachedMailSessionEntry>();
const mailThreadListCache = new Map<string, CachedMailThreadListEntry>();

function buildNeedsSetupMailSessionResponse(
  connectionError: string,
): MailSessionResponse {
  return {
    status: "needs_setup",
    senderEmail: null,
    senderDisplayName: null,
    expectedGoogleEmail: null,
    connectedGoogleEmail: null,
    connectionError,
    folders: MAIL_SESSION_FOLDERS,
  };
}

function readCachedMailSession(cacheKey: string): MailSessionResponse | null {
  const cached = mailSessionCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    mailSessionCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
}

function writeCachedMailSession(cacheKey: string, payload: MailSessionResponse): void {
  mailSessionCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + MAIL_SESSION_CACHE_TTL_MS,
  });
}

function readCachedMailThreadList(cacheKey: string): MailThreadListResponse | null {
  const cached = mailThreadListCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    mailThreadListCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
}

function writeCachedMailThreadList(
  cacheKey: string,
  payload: MailThreadListResponse,
): void {
  mailThreadListCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + MAIL_THREADS_CACHE_TTL_MS,
  });
}

function getMailSetupErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as { message?: unknown; status?: unknown };
  if (record.status !== 500 || typeof record.message !== "string") {
    return null;
  }

  if (record.message === "MAIL_SERVICE_URL is not configured.") {
    return "Mail service URL is not configured. Add MAIL_SERVICE_URL before using in-app email.";
  }

  if (record.message === "MAIL_SERVICE_SHARED_SECRET is not configured.") {
    return "Mail service shared secret is not configured. Add MAIL_SERVICE_SHARED_SECRET before using in-app email.";
  }

  return null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json().catch(() => null);
}

function isMailSendResponse(payload: unknown): payload is MailSendResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return record.sent === true && typeof record.threadId === "string" && typeof record.messageId === "string";
}

function isMailThreadListResponse(payload: unknown): payload is MailThreadListResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Array.isArray(record.items) && typeof record.total === "number";
}

function buildDeferredMailSendResponse(payload: unknown): unknown {
  if (!isMailSendResponse(payload)) {
    return payload;
  }

  if (
    payload.activitySyncStatus !== "failed" &&
    payload.activitySyncStatus !== "not_linked"
  ) {
    return payload;
  }

  return {
    ...payload,
    activitySyncStatus: "pending" as const,
    activityError: null,
  } satisfies MailSendResponse;
}

function scheduleMailSendJobDrain(limit: number): void {
  queueMicrotask(() => {
    void drainPendingMailSendJobs(limit).catch(() => {
      // Durable mail jobs remain queued for the next drain pass.
    });
  });
}

function buildDeferredMailActor(request: NextRequest): {
  loginName: string | null;
  name: string | null;
} {
  const storedLoginName = getStoredLoginName(request);
  return {
    loginName: storedLoginName,
    name: storedLoginName,
  };
}

function buildMailThreadListCacheKey(
  senderEmail: string,
  query: URLSearchParams,
): string {
  return `${senderEmail.trim().toLowerCase()}::${query.toString()}`;
}

function normalizeMailPayload(payload: unknown): Partial<MailComposePayload> {
  return payload && typeof payload === "object" ? (payload as Partial<MailComposePayload>) : {};
}

function assertResolvedMailRecipients(payload: Partial<MailComposePayload>): void {
  const unresolvedRecipients = collectUnresolvedMailRecipientEmails(payload);
  if (unresolvedRecipients.length === 0) {
    return;
  }

  throw new HttpError(
    422,
    unresolvedRecipients.length === 1
      ? `Recipient ${unresolvedRecipients[0]} is not an Acumatica contact. Add only recipients that exist in Acumatica.`
      : `These recipients are not Acumatica contacts: ${unresolvedRecipients.join(", ")}. Add only recipients that exist in Acumatica.`,
  );
}

export async function proxyMailJson(
  request: NextRequest,
  options: {
    path: string;
    method?: string;
    body?: BodyInit | Record<string, unknown> | null;
    query?: URLSearchParams;
    forwardAcumaticaSession?: boolean;
    timeoutMs?: number;
    timeoutMessage?: string;
    resolveRecipients?: boolean;
  },
): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = { value: null };

  try {
    const requestBody =
      options.resolveRecipients !== false &&
      options.body &&
      typeof options.body === "object"
        ? await attachMatchedContactsToMailPayload(request, options.body, authCookieRefresh)
        : options.body;
    const upstream = await requestMailService(request, {
      ...options,
      body: requestBody,
      authCookieRefresh,
      timeoutMs: options.timeoutMs ?? MAIL_SEND_TIMEOUT_MS,
      timeoutMessage: options.timeoutMessage ?? MAIL_SEND_TIMEOUT_MESSAGE,
    });
    const payload = await readJsonResponse(upstream);
    const repairedPayload =
      upstream.ok && options.body && typeof requestBody === "object"
        ? await repairMailActivitySync(
            request,
            requestBody as Partial<MailComposePayload>,
            payload,
            authCookieRefresh,
          )
        : payload;
    const response = NextResponse.json(repairedPayload ?? {}, { status: upstream.status });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}

export async function proxyAuditedMailSendJson(
  request: NextRequest,
  options: {
    path: string;
    method?: string;
    body?: BodyInit | Record<string, unknown> | null;
    query?: URLSearchParams;
    forwardAcumaticaSession?: boolean;
    timeoutMs?: number;
    timeoutMessage?: string;
    resolveRecipients?: boolean;
  },
): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = { value: null };
  let normalizedPayload: Partial<MailComposePayload> = {};

  try {
    const requestBody =
      options.resolveRecipients !== false &&
      options.body &&
      typeof options.body === "object"
        ? await attachMatchedContactsToMailPayload(request, options.body, authCookieRefresh)
        : options.body;
    normalizedPayload = normalizeMailPayload(requestBody);
    if (options.body && typeof requestBody === "object") {
      assertResolvedMailRecipients(normalizedPayload);
    }
    const upstream = await requestMailService(request, {
      ...options,
      body: requestBody,
      authCookieRefresh,
      timeoutMs: options.timeoutMs ?? MAIL_SEND_TIMEOUT_MS,
      timeoutMessage: options.timeoutMessage ?? MAIL_SEND_TIMEOUT_MESSAGE,
    });
    const payload = await readJsonResponse(upstream);
    let queuedDurableJob = false;

    if (upstream.ok && options.body && typeof requestBody === "object" && isMailSendResponse(payload)) {
      try {
        enqueueMailSendJob({
          actor: buildDeferredMailActor(request),
          payload: normalizedPayload,
          response: payload,
        });
        queuedDurableJob = true;
      } catch {
        queuedDurableJob = false;
      }
    }

    const immediatePayload =
      upstream.ok && options.body && typeof requestBody === "object"
        ? buildDeferredMailSendResponse(payload)
        : payload;
    const response = NextResponse.json(immediatePayload ?? {}, { status: upstream.status });

    if (queuedDurableJob) {
      after(() => {
        scheduleMailSendJobDrain(25);
      });
    } else {
      after(async () => {
        let repairedPayload = payload;

        try {
          if (upstream.ok && options.body && typeof requestBody === "object") {
            repairedPayload = await repairMailActivitySync(
              request,
              normalizedPayload,
              payload,
              authCookieRefresh,
            );
          }

          const cookieValue = requireAuthCookieValue(request);
          const actor = await resolveDeferredActionActor(
            request,
            cookieValue,
            authCookieRefresh,
          );
          const resultCode =
            upstream.ok && isMailSendResponse(repairedPayload)
              ? repairedPayload.activitySyncStatus === "failed" ||
                  repairedPayload.activitySyncStatus === "pending"
                ? "partial"
                : "succeeded"
              : "failed";

          logMailSendAudit({
            actor,
            payload: normalizedPayload,
            resultCode,
            response: isMailSendResponse(repairedPayload) ? repairedPayload : null,
          });
        } catch {
          // Background repair/audit should never block delivery.
        }
      });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    after(async () => {
      try {
        const cookieValue = requireAuthCookieValue(request);
        const actor = await resolveDeferredActionActor(
          request,
          cookieValue,
          authCookieRefresh,
        );
        logMailSendAudit({
          actor,
          payload: normalizedPayload,
          resultCode: "failed",
          response: null,
        });
      } catch {
        // Background audit should not mask the original send error.
      }
    });

    const response =
      error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}

export async function proxyMailSessionJson(
  request: NextRequest,
): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = { value: null };
  let resolvedSender: ResolvedMailSender | null = null;
  let cacheKey: string | null = null;

  try {
    after(async () => {
      scheduleMailSendJobDrain(10);
    });

    resolvedSender = await resolveMailSenderForRequest(request, authCookieRefresh);
    cacheKey = resolvedSender.senderEmail.trim().toLowerCase();
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

    if (!forceRefresh && cacheKey) {
      const cached = readCachedMailSession(cacheKey);
      if (cached) {
        const response = NextResponse.json(cached);
        if (authCookieRefresh.value) {
          setAuthCookie(response, authCookieRefresh.value);
        }

        return response;
      }
    }

    const upstream = await requestMailService(request, {
      path: "/api/mail/session",
      authCookieRefresh,
      timeoutMs: MAIL_SESSION_TIMEOUT_MS,
      timeoutMessage:
        "Mailbox status is taking longer than expected. Gmail may still be connecting. Refresh in a few seconds.",
      resolvedSender,
    });
    const payload = await readJsonResponse(upstream);
    if (cacheKey && payload && typeof payload === "object") {
      const record = payload as Partial<MailSessionResponse>;
      if (
        (record.status === "connected" ||
          record.status === "disconnected" ||
          record.status === "needs_setup") &&
        Array.isArray(record.folders)
      ) {
        writeCachedMailSession(cacheKey, payload as MailSessionResponse);
      }
    }

    const response = NextResponse.json(payload ?? {}, { status: upstream.status });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const setupMessage = getMailSetupErrorMessage(error);
    const timeoutFallback =
      error instanceof HttpError && error.status === 504 && resolvedSender
        ? ({
            status: "disconnected",
            senderEmail: resolvedSender.senderEmail,
            senderDisplayName: resolvedSender.displayName,
            expectedGoogleEmail: resolvedSender.senderEmail,
            connectedGoogleEmail: null,
            connectionError: error.message,
            folders: MAIL_SESSION_FOLDERS,
          } satisfies MailSessionResponse)
        : null;

    if (cacheKey && timeoutFallback) {
      writeCachedMailSession(cacheKey, timeoutFallback);
    }

    const response = setupMessage
      ? NextResponse.json(buildNeedsSetupMailSessionResponse(setupMessage))
      : timeoutFallback
        ? NextResponse.json(timeoutFallback)
      : error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}

export async function proxyMailThreadListJson(
  request: NextRequest,
): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = { value: null };
  let resolvedSender: ResolvedMailSender | null = null;
  let cacheKey: string | null = null;

  try {
    after(async () => {
      scheduleMailSendJobDrain(10);
    });

    resolvedSender = await resolveMailSenderForRequest(request, authCookieRefresh);
    cacheKey = buildMailThreadListCacheKey(
      resolvedSender.senderEmail,
      request.nextUrl.searchParams,
    );

    const upstream = await requestMailService(request, {
      path: "/api/mail/threads",
      query: request.nextUrl.searchParams,
      authCookieRefresh,
      timeoutMs: MAIL_THREADS_TIMEOUT_MS,
      timeoutMessage:
        "Mailbox threads are taking longer than expected. Retry in a few seconds.",
      resolvedSender,
    });
    const payload = await readJsonResponse(upstream);

    if (cacheKey && isMailThreadListResponse(payload)) {
      writeCachedMailThreadList(cacheKey, payload);
    }

    if (cacheKey && !upstream.ok && (upstream.status === 429 || upstream.status >= 500)) {
      const cached = readCachedMailThreadList(cacheKey);
      if (cached) {
        const cachedResponse = NextResponse.json(cached);
        if (authCookieRefresh.value) {
          setAuthCookie(cachedResponse, authCookieRefresh.value);
        }

        return cachedResponse;
      }
    }

    const response = NextResponse.json(payload ?? {}, { status: upstream.status });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const cached = cacheKey ? readCachedMailThreadList(cacheKey) : null;
    const response = cached
      ? NextResponse.json(cached)
      : error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}

export async function redirectToMailOauthStart(
  request: NextRequest,
): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = { value: null };

  try {
    const url = await buildMailServiceOauthStartUrl(request, authCookieRefresh);
    const response = NextResponse.redirect(url);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
