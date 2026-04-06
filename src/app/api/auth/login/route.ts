import { NextRequest, NextResponse } from "next/server";

import {
  buildStoredAuthCookieValueFromSetCookies,
  buildCookieHeader,
  clearStoredLoginName,
  getSetCookieHeaders,
  setStoredLoginName,
  setAuthCookie,
} from "@/lib/auth";
import type { AppEnv } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { storeUserCredentials } from "@/lib/stored-user-credentials";

const UPSTREAM_LOGIN_TIMEOUT_MS = 30000;
const LOGOUT_TIMEOUT_MS = 4000;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
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

type LoginResponseMode = "json" | "form";

type ParsedLoginRequest = {
  mode: LoginResponseMode;
  nextPath: string;
  password: string;
  username: string;
};

type NormalizedUpstreamError = {
  message: string;
  status: number;
};

function normalizeNextPath(value: unknown): string {
  if (typeof value !== "string") {
    return "/accounts";
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/accounts";
  }

  return trimmed;
}

async function parseLoginRequest(request: NextRequest): Promise<ParsedLoginRequest> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const body = await request.formData().catch(() => null);
    const username = typeof body?.get("username") === "string" ? String(body?.get("username")).trim() : "";
    const password = typeof body?.get("password") === "string" ? String(body?.get("password")) : "";
    const nextPath = normalizeNextPath(body?.get("next"));

    return {
      mode: "form",
      nextPath,
      password,
      username,
    };
  }

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const nextPath = normalizeNextPath(body?.next);

  return {
    mode: "json",
    nextPath,
    password,
    username,
  };
}

function buildSignInRedirect(request: NextRequest, nextPath: string, error?: string): URL {
  const redirectUrl = new URL("/signin", request.url);
  redirectUrl.searchParams.set("next", nextPath);
  if (error) {
    redirectUrl.searchParams.set("error", error);
  }
  return redirectUrl;
}

function buildLoginErrorResponse(
  request: NextRequest,
  mode: LoginResponseMode,
  nextPath: string,
  status: number,
  message: string,
): NextResponse {
  if (mode === "form") {
    return NextResponse.redirect(buildSignInRedirect(request, nextPath, message), {
      status: 303,
    });
  }

  return NextResponse.json({ error: message }, { status });
}

function normalizeUpstreamError(status: number, message: string): NormalizedUpstreamError {
  const normalizedMessage = message || "Authentication service is unavailable";
  const lower = normalizedMessage.toLowerCase();

  if (status === 429 || isConcurrentLoginLimitMessage(lower)) {
    return {
      message:
        "Acumatica API login limit reached for this user. Close old API sessions in Users (SM201010) or increase concurrent API logins, then sign in again.",
      status: 429,
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid login")
  ) {
    return {
      message: normalizedMessage || "Invalid credentials",
      status: 401,
    };
  }

  if (lower.includes("proper company id cannot be determined")) {
    return {
      message:
        'Acumatica company is required. Set ACUMATICA_COMPANY in .env.local to "MeadowBrook Live".',
      status: 401,
    };
  }

  return {
    message: normalizedMessage,
    status: 502,
  };
}

function resolveLogoutUrl(env: AppEnv): string | null {
  const isCustomAuth = env.AUTH_PROVIDER === "custom";
  const url = isCustomAuth
    ? env.AUTH_LOGOUT_URL
    : env.AUTH_LOGOUT_URL ?? `${env.ACUMATICA_BASE_URL}/entity/auth/logout`;

  return url ?? null;
}

async function logoutCookieValue(cookieValue: string, env: AppEnv): Promise<void> {
  const logoutUrl = resolveLogoutUrl(env);
  if (!logoutUrl) {
    return;
  }

  await fetchWithTimeout(
    logoutUrl,
    {
      method: "POST",
      headers: {
        Cookie: buildCookieHeader(cookieValue),
        Accept: "application/json",
      },
      cache: "no-store",
    },
    LOGOUT_TIMEOUT_MS,
  ).catch(() => {
    // Best effort only. Login below still proceeds.
  });
}

async function logoutExistingSession(request: NextRequest, env: AppEnv): Promise<void> {
  const existingCookie = request.cookies.get(env.AUTH_COOKIE_NAME)?.value;
  if (!existingCookie) {
    return;
  }

  await logoutCookieValue(existingCookie, env);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  const { mode, nextPath, password, username } = await parseLoginRequest(request);

  if (!username || !password) {
    return buildLoginErrorResponse(
      request,
      mode,
      nextPath,
      400,
      "Username and password are required.",
    );
  }

  const isCustomAuth = env.AUTH_PROVIDER === "custom";
  const loginUrl = isCustomAuth
    ? env.AUTH_LOGIN_URL
    : env.AUTH_LOGIN_URL ?? `${env.ACUMATICA_BASE_URL}/entity/auth/login`;

  if (!loginUrl) {
    return buildLoginErrorResponse(
      request,
      mode,
      nextPath,
      500,
      "AUTH_LOGIN_URL is required when AUTH_PROVIDER=custom.",
    );
  }

  // Try to release any prior upstream browser session before opening a new one.
  await logoutExistingSession(request, env);

  const loginPayload = isCustomAuth
    ? { username, password }
    : {
        name: username,
        password,
        company: env.ACUMATICA_COMPANY ?? "MeadowBrook Live",
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
      return buildLoginErrorResponse(
        request,
        mode,
        nextPath,
        504,
        "Sign-in timed out while waiting for Acumatica. Please retry in a few seconds.",
      );
    }
    throw error;
  }

  if (!upstreamResponse.ok) {
    const rawText = await upstreamResponse.text();
    const normalizedError = normalizeUpstreamError(
      upstreamResponse.status,
      parseUpstreamErrorMessage(rawText),
    );
    return buildLoginErrorResponse(
      request,
      mode,
      nextPath,
      normalizedError.status,
      normalizedError.message,
    );
  }

  const setCookies = getSetCookieHeaders(upstreamResponse.headers);
  const cookieValue = buildStoredAuthCookieValueFromSetCookies(setCookies);

  if (!cookieValue) {
    return buildLoginErrorResponse(
      request,
      mode,
      nextPath,
      502,
      `Auth cookie '${env.AUTH_COOKIE_NAME}' was not returned by login endpoint.`,
    );
  }

  const response =
    mode === "form"
      ? NextResponse.redirect(new URL(nextPath, request.url), { status: 303 })
      : NextResponse.json({ ok: true });
  setAuthCookie(response, cookieValue);
  if (username) {
    setStoredLoginName(response, username);
  } else {
    clearStoredLoginName(response);
  }
  if (env.AUTH_PROVIDER === "acumatica") {
    storeUserCredentials({
      loginName: username,
      username,
      password,
    });
  }

  return response;
}
