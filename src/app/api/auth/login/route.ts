import { NextRequest, NextResponse } from "next/server";

import {
  buildStoredAuthCookieValueFromSetCookies,
  buildCookieHeader,
  getAuthCookieValue,
  getSetCookieHeaders,
  setAuthCookie,
} from "@/lib/auth";
import type { AppEnv } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { HttpError } from "@/lib/errors";

const EXISTING_SESSION_TIMEOUT_MS = 6000;
const UPSTREAM_LOGIN_TIMEOUT_MS = 15000;
const LOGOUT_TIMEOUT_MS = 4000;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(timeoutError);
    }, timeoutMs);

    promise.then(resolve).catch(reject).finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    });
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isConcurrentLoginLimitMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("concurrent api login") ||
    normalized.includes("concurrentapilogins") ||
    normalized.includes("api login limit") ||
    normalized.includes("checkapiuserslimits") ||
    normalized.includes("apiloginlimitreached") ||
    normalized.includes("users (sm201010)") ||
    normalized.includes("users sm201010")
  );
}

function parseUpstreamErrorMessage(rawText: string): string {
  if (!rawText) {
    return "";
  }

  try {
    const payload = JSON.parse(rawText) as Record<string, unknown>;
    const nestedError =
      payload.exceptionMessage ??
      payload.ExceptionMessage ??
      payload.message ??
      payload.error;
    if (typeof nestedError === "string" && nestedError.trim()) {
      return nestedError;
    }
  } catch {
    return rawText;
  }

  return rawText;
}

function normalizeUpstreamError(status: number, message: string): NextResponse {
  const normalizedMessage = message || "Authentication service is unavailable";
  const lower = normalizedMessage.toLowerCase();

  if (isConcurrentLoginLimitMessage(lower)) {
    return NextResponse.json(
      {
        error:
          "Acumatica API login limit reached for this user. Close old API sessions in Users (SM201010) or increase concurrent API logins, then sign in again.",
      },
      { status: 429 },
    );
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid login")
  ) {
    return NextResponse.json({ error: normalizedMessage || "Invalid credentials" }, { status: 401 });
  }

  if (lower.includes("proper company id cannot be determined")) {
    return NextResponse.json(
      {
        error:
          "Acumatica company is required. Set ACUMATICA_COMPANY in .env.local to the same company used in Jeff's app.",
      },
      { status: 401 },
    );
  }

  return NextResponse.json(
    { error: normalizedMessage },
    { status: 502 },
  );
}

function resolveLogoutUrl(env: AppEnv): string | null {
  const isCustomAuth = env.AUTH_PROVIDER === "custom";
  const url = isCustomAuth
    ? env.AUTH_LOGOUT_URL
    : env.AUTH_LOGOUT_URL ?? `${env.ACUMATICA_BASE_URL}/entity/auth/logout`;

  return url ?? null;
}

async function logoutExistingSession(request: NextRequest, env: AppEnv): Promise<void> {
  const existingCookie = request.cookies.get(env.AUTH_COOKIE_NAME)?.value;
  if (!existingCookie) {
    return;
  }

  const logoutUrl = resolveLogoutUrl(env);
  if (!logoutUrl) {
    return;
  }

  await fetchWithTimeout(
    logoutUrl,
    {
      method: "POST",
      headers: {
        Cookie: buildCookieHeader(existingCookie),
        Accept: "application/json",
      },
      cache: "no-store",
    },
    LOGOUT_TIMEOUT_MS,
  ).catch(() => {
    // Best effort only. Login below still proceeds.
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getEnv();

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  // If this browser already has a valid Acumatica session cookie, reuse it
  // instead of creating a fresh login session.
  const existingCookie = getAuthCookieValue(request);
  if (existingCookie) {
    const refreshState: AuthCookieRefreshState = { value: null };
    try {
      await withTimeout(
        validateSessionWithAcumatica(existingCookie, refreshState),
        EXISTING_SESSION_TIMEOUT_MS,
        new HttpError(504, "Session check timed out"),
      );
      const response = NextResponse.json({
        ok: true,
        reusedSession: true,
      });
      if (refreshState.value) {
        setAuthCookie(response, refreshState.value);
      }
      return response;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) {
        // Do not create a new Acumatica login when we cannot confidently verify
        // the current one (transient network/upstream failure). This protects
        // against quickly exhausting concurrent API login slots.
        const response = NextResponse.json(
          {
            error:
              "Unable to verify your existing Acumatica session right now. Please retry in a few seconds.",
          },
          { status: 502 },
        );
        if (refreshState.value) {
          setAuthCookie(response, refreshState.value);
        }
        return response;
      }
    }
  }

  const isCustomAuth = env.AUTH_PROVIDER === "custom";
  const loginUrl = isCustomAuth
    ? env.AUTH_LOGIN_URL
    : env.AUTH_LOGIN_URL ?? `${env.ACUMATICA_BASE_URL}/entity/auth/login`;

  if (!loginUrl) {
    return NextResponse.json(
      { error: "AUTH_LOGIN_URL is required when AUTH_PROVIDER=custom." },
      { status: 500 },
    );
  }

  // Avoid accumulating extra Acumatica sessions from repeated sign-in attempts
  // in the same browser instance.
  await logoutExistingSession(request, env);

  const loginPayload = isCustomAuth
    ? { username, password }
    : {
        name: username,
        password,
        ...(env.ACUMATICA_COMPANY ? { company: env.ACUMATICA_COMPANY } : {}),
        ...(env.ACUMATICA_BRANCH ? { branch: env.ACUMATICA_BRANCH } : {}),
        ...(env.ACUMATICA_LOCALE ? { locale: env.ACUMATICA_LOCALE } : {}),
      };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchWithTimeout(
      loginUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(loginPayload),
        redirect: "manual",
        cache: "no-store",
      },
      UPSTREAM_LOGIN_TIMEOUT_MS,
    );
  } catch (error) {
    if (isAbortError(error)) {
      return NextResponse.json(
        {
          error:
            "Sign-in timed out while waiting for Acumatica. Please retry in a few seconds.",
        },
        { status: 504 },
      );
    }
    throw error;
  }

  if (!upstreamResponse.ok) {
    const rawText = await upstreamResponse.text();
    return normalizeUpstreamError(
      upstreamResponse.status,
      parseUpstreamErrorMessage(rawText),
    );
  }

  const setCookies = getSetCookieHeaders(upstreamResponse.headers);
  const cookieValue = buildStoredAuthCookieValueFromSetCookies(setCookies);

  if (!cookieValue) {
    return NextResponse.json(
      {
        error: `Auth cookie '${env.AUTH_COOKIE_NAME}' was not returned by login endpoint.`,
      },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: env.AUTH_COOKIE_NAME,
    value: cookieValue,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.AUTH_COOKIE_SECURE,
    domain: env.AUTH_COOKIE_DOMAIN,
  });

  return response;
}
