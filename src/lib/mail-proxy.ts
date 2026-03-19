import type { NextRequest } from "next/server";

import { buildCookieHeader, requireAuthCookieValue } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import {
  buildMailServiceAssertion,
  ensureMailServiceConfigured,
  type ResolvedMailSender,
  resolveMailSenderForRequest,
} from "@/lib/mail-auth";

type AuthCookieRefreshState = {
  value: string | null;
};

type MailServiceRequestOptions = {
  path: string;
  method?: string;
  body?: BodyInit | Record<string, unknown> | null;
  query?: URLSearchParams;
  authCookieRefresh?: AuthCookieRefreshState;
  headers?: Record<string, string>;
  forwardAcumaticaSession?: boolean;
  timeoutMs?: number;
  timeoutMessage?: string;
  resolvedSender?: ResolvedMailSender;
};

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

function buildAbsoluteServiceUrl(path: string, query?: URLSearchParams): string {
  const { serviceUrl } = ensureMailServiceConfigured();
  const normalizedBase = serviceUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

export async function requestMailService(
  request: NextRequest,
  options: MailServiceRequestOptions,
): Promise<Response> {
  const sessionCookieValue = options.forwardAcumaticaSession
    ? requireAuthCookieValue(request)
    : null;
  const resolvedSender =
    options.resolvedSender ??
    (await resolveMailSenderForRequest(request, options.authCookieRefresh));
  const assertion = buildMailServiceAssertion(resolvedSender);
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${assertion}`);
  if (sessionCookieValue) {
    const activeCookieValue = options.authCookieRefresh?.value ?? sessionCookieValue;
    headers.set("x-mb-acumatica-cookie", buildCookieHeader(activeCookieValue));
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined && options.body !== null) {
    if (typeof options.body === "string" || options.body instanceof FormData) {
      body = options.body;
    } else if (options.body instanceof URLSearchParams) {
      body = options.body;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
  }

  const controller =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? new AbortController()
      : null;
  const timeoutMs = controller ? Math.max(1, Math.trunc(options.timeoutMs as number)) : null;
  const timeoutId =
    controller && timeoutMs !== null
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    return await fetch(buildAbsoluteServiceUrl(options.path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: controller?.signal,
    });
  } catch (error) {
    if (controller && isAbortError(error)) {
      throw new HttpError(
        504,
        options.timeoutMessage ?? "Mail service request timed out.",
      );
    }

    throw error;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export async function buildMailServiceOauthStartUrl(
  request: NextRequest,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<string> {
  const resolvedSender = await resolveMailSenderForRequest(request, authCookieRefresh);
  const assertion = buildMailServiceAssertion(resolvedSender);
  const env = ensureMailServiceConfigured();
  const returnTo = new URL(
    request.nextUrl.origin + (request.nextUrl.searchParams.get("returnTo") || "/mail"),
  );

  const url = new URL(`${env.serviceUrl.replace(/\/$/, "")}/api/mail/oauth/start`);
  url.searchParams.set("token", assertion);
  url.searchParams.set("returnTo", returnTo.toString());
  return url.toString();
}
