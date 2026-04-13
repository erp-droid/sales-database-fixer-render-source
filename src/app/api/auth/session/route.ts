import { after, NextRequest, NextResponse } from "next/server";

import {
  clearAuthCookie,
  clearStoredLoginName,
  getAuthCookieValue,
  getStoredLoginName,
  normalizeSessionUser,
  setAuthCookie,
} from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { resolveSignedInCallerIdentity } from "@/lib/caller-identity";
import {
  createDeferredActionActor,
  hasRunnableDeferredActions,
} from "@/lib/deferred-actions-store";
import { runDueDeferredActions } from "@/lib/deferred-actions-executor";
import { HttpError, getErrorMessage } from "@/lib/errors";

const SESSION_CHECK_TIMEOUT_MS = 3000;
const AUTHENTICATED_SESSION_CACHE_TTL_MS = 15_000;
const DEGRADED_SESSION_CACHE_TTL_MS = 5_000;

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  const storedUser = buildStoredUser(request);
  const authCookieRefresh: AuthCookieRefreshState = {
    value: null,
  };

  if (!cookieValue) {
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
    const deferredActor = createDeferredActionActor({
      loginName: normalizedUser?.id ?? null,
      name: normalizedUser?.name ?? null,
    });

    const activeCookieValue = authCookieRefresh.value ?? cookieValue;
    if (hasRunnableDeferredActions() || storedUser.id) {
      runInBackground(async () => {
        try {
          await resolveSignedInCallerIdentity(
            activeCookieValue,
            storedUser.id,
            { value: null },
            { allowFullDirectorySync: false },
          );
        } catch (error) {
          if (!(error instanceof HttpError) || ![403, 422].includes(error.status)) {
            // Keep the session check resilient. Calling enforces caller identity.
          }
        }

        try {
          await runDueDeferredActions(activeCookieValue, deferredActor, { value: null });
        } catch {
          // Keep session validation responsive even if deferred execution fails.
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
