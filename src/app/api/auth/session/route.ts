import { after, NextRequest, NextResponse } from "next/server";

import {
  buildStoredAuthCookieValueFromSetCookies,
  clearAuthCookie,
  clearStoredLoginName,
  getAuthCookieValue,
  getSetCookieHeaders,
  getStoredLoginName,
  normalizeSessionUser,
  setAuthCookie,
  setStoredLoginName,
} from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { resolveSignedInCallerIdentity } from "@/lib/caller-identity";
import {
  createDeferredActionActor,
  hasRunnableDeferredActions,
} from "@/lib/deferred-actions-store";
import { runDueDeferredActions } from "@/lib/deferred-actions-executor";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { readStoredUserCredentials } from "@/lib/stored-user-credentials";

const SESSION_CHECK_TIMEOUT_MS = 3000;
const UPSTREAM_RELOGIN_TIMEOUT_MS = 10000;
const AUTHENTICATED_SESSION_CACHE_TTL_MS = 60_000;
const DEGRADED_SESSION_CACHE_TTL_MS = 20_000;
const CALLER_IDENTITY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type SessionResponsePayload = {
  authenticated: boolean;
  user: { id: string; name: string } | null;
  degraded?: boolean;
};

type CachedSessionResponse = {
  expiresAt: number;
  payload: SessionResponsePayload;
  authCookieValue: string | null;
};

const cachedSessionResponses = new Map<string, CachedSessionResponse>();
const callerIdentityRefreshByUser = new Map<string, number>();

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

async function validateSessionWithTimeout(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, SESSION_CHECK_TIMEOUT_MS);

  try {
    return await validateSessionWithAcumatica(cookieValue, authCookieRefresh, {
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new HttpError(504, "Session check timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildStoredUser(request: NextRequest): { id: string; name: string } | null {
  const loginName = getStoredLoginName(request);
  if (!loginName) {
    return null;
  }

  return {
    id: loginName,
    name: loginName,
  };
}

function buildInvalidSessionResponse(): NextResponse {
  const response = NextResponse.json({ authenticated: false, user: null });
  clearAuthCookie(response);
  clearStoredLoginName(response);
  return response;
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

async function refreshExpiredAcumaticaSession(
  loginName: string,
): Promise<string | null> {
  const env = getEnv();
  if (env.AUTH_PROVIDER !== "acumatica") {
    return null;
  }

  const storedCredentials = readStoredUserCredentials(loginName);
  if (!storedCredentials) {
    return null;
  }

  const loginUrl = env.AUTH_LOGIN_URL ?? `${env.ACUMATICA_BASE_URL}/entity/auth/login`;
  const response = await fetchWithTimeout(
    loginUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: storedCredentials.username,
        password: storedCredentials.password,
        company: env.ACUMATICA_COMPANY ?? "MeadowBrook Live",
        ...(env.ACUMATICA_BRANCH ? { branch: env.ACUMATICA_BRANCH } : {}),
        ...(env.ACUMATICA_LOCALE ? { locale: env.ACUMATICA_LOCALE } : {}),
      }),
      redirect: "manual",
      cache: "no-store",
    },
    UPSTREAM_RELOGIN_TIMEOUT_MS,
  );

  if (!response.ok) {
    console.warn("[auth-session] upstream re-login failed", {
      loginName,
      status: response.status,
    });
    return null;
  }

  return buildStoredAuthCookieValueFromSetCookies(getSetCookieHeaders(response.headers));
}

function buildSessionCacheKey(
  cookieValue: string,
  storedUser: { id: string; name: string } | null,
): string {
  return `${cookieValue}::${storedUser?.id ?? ""}`;
}

function readCachedSessionResponse(cacheKey: string): CachedSessionResponse | null {
  const cached = cachedSessionResponses.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cachedSessionResponses.delete(cacheKey);
    return null;
  }

  return cached;
}

function storeCachedSessionResponse(
  cacheKey: string,
  payload: SessionResponsePayload,
  authCookieValue: string | null,
  ttlMs: number,
): void {
  cachedSessionResponses.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    payload,
    authCookieValue,
  });
}

function buildSessionResponse(
  payload: SessionResponsePayload,
  authCookieValue: string | null,
): NextResponse {
  const response = NextResponse.json(payload);
  if (authCookieValue) {
    setAuthCookie(response, authCookieValue);
  }
  return response;
}

function runInBackground(task: () => Promise<void>): void {
  try {
    after(task);
    return;
  } catch {
    queueMicrotask(() => {
      void task().catch(() => undefined);
    });
  }
}

function shouldRefreshCallerIdentity(userId: string, nowMs = Date.now()): boolean {
  const lastRefreshAt = callerIdentityRefreshByUser.get(userId) ?? 0;
  if (nowMs - lastRefreshAt < CALLER_IDENTITY_REFRESH_INTERVAL_MS) {
    return false;
  }

  callerIdentityRefreshByUser.set(userId, nowMs);
  if (callerIdentityRefreshByUser.size > 1000) {
    const staleBefore = nowMs - CALLER_IDENTITY_REFRESH_INTERVAL_MS * 2;
    for (const [cachedUserId, refreshedAt] of callerIdentityRefreshByUser.entries()) {
      if (refreshedAt < staleBefore) {
        callerIdentityRefreshByUser.delete(cachedUserId);
      }
    }
  }

  return true;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  const storedUser = buildStoredUser(request);
  const authCookieRefresh: AuthCookieRefreshState = {
    value: null,
  };

  if (!cookieValue) {
    if (storedUser?.id) {
      callerIdentityRefreshByUser.delete(storedUser.id);
    }
    const response = NextResponse.json({ authenticated: false, user: null });
    clearStoredLoginName(response);
    return response;
  }

  const cacheKey = buildSessionCacheKey(cookieValue, storedUser);
  const cachedResponse = readCachedSessionResponse(cacheKey);
  if (cachedResponse) {
    return buildSessionResponse(
      cachedResponse.payload,
      cachedResponse.authCookieValue,
    );
  }

  try {
    const payload = await validateSessionWithTimeout(cookieValue, authCookieRefresh);
    if (!storedUser?.id) {
      cachedSessionResponses.delete(cacheKey);
      return buildInvalidSessionResponse();
    }

    const normalizedUser = normalizeSessionUser(payload) ?? storedUser;
    const userId = normalizedUser?.id ?? storedUser.id;
    const activeCookieValue = authCookieRefresh.value ?? cookieValue;
    const shouldRunDeferredActions = hasRunnableDeferredActions();
    const shouldRunIdentityRefresh = shouldRefreshCallerIdentity(userId);
    if (shouldRunDeferredActions || shouldRunIdentityRefresh) {
      runInBackground(async () => {
        if (shouldRunIdentityRefresh) {
          try {
            await resolveSignedInCallerIdentity(
              activeCookieValue,
              userId,
              { value: null },
              { allowFullDirectorySync: false },
            );
          } catch (error) {
            if (!(error instanceof HttpError) || ![403, 422].includes(error.status)) {
              // Keep the session check resilient. Calling enforces caller identity.
            }
          }
        }

        if (shouldRunDeferredActions) {
          const deferredActor = createDeferredActionActor({
            loginName: normalizedUser?.id ?? null,
            name: normalizedUser?.name ?? null,
          });

          try {
            await runDueDeferredActions(activeCookieValue, deferredActor, { value: null });
          } catch {
            // Keep session validation responsive even if deferred execution fails.
          }
        }
      });
    }

    const responsePayload: SessionResponsePayload = {
      authenticated: true,
      user: normalizedUser,
    };
    storeCachedSessionResponse(
      cacheKey,
      responsePayload,
      authCookieRefresh.value,
      AUTHENTICATED_SESSION_CACHE_TTL_MS,
    );
    return buildSessionResponse(responsePayload, authCookieRefresh.value);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      cachedSessionResponses.delete(cacheKey);
      if (storedUser?.id) {
        const refreshedCookieValue = await refreshExpiredAcumaticaSession(storedUser.id).catch(
          (refreshError) => {
            console.warn("[auth-session] failed to refresh expired upstream session", {
              error: getErrorMessage(refreshError),
              loginName: storedUser.id,
            });
            return null;
          },
        );

        if (refreshedCookieValue) {
          const responsePayload: SessionResponsePayload = {
            authenticated: true,
            user: storedUser,
          };
          const nextCacheKey = buildSessionCacheKey(refreshedCookieValue, storedUser);
          storeCachedSessionResponse(
            nextCacheKey,
            responsePayload,
            refreshedCookieValue,
            AUTHENTICATED_SESSION_CACHE_TTL_MS,
          );

          const response = buildSessionResponse(responsePayload, refreshedCookieValue);
          setStoredLoginName(response, storedUser.id);
          console.info("[auth-session] refreshed expired upstream session", {
            loginName: storedUser.id,
          });
          return response;
        }

        callerIdentityRefreshByUser.delete(storedUser.id);
      }
      console.warn("[auth-session] upstream rejected stored session", {
        loginName: storedUser?.id ?? null,
      });
      return buildInvalidSessionResponse();
    }

    if (
      error instanceof HttpError &&
      [429, 500, 502, 503, 504].includes(error.status)
    ) {
      const responsePayload: SessionResponsePayload = {
        authenticated: true,
        user: storedUser,
        degraded: true,
      };
      storeCachedSessionResponse(
        cacheKey,
        responsePayload,
        authCookieRefresh.value,
        DEGRADED_SESSION_CACHE_TTL_MS,
      );
      return buildSessionResponse(responsePayload, authCookieRefresh.value);
    }

    cachedSessionResponses.delete(cacheKey);
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 502 },
    );
  }
}
