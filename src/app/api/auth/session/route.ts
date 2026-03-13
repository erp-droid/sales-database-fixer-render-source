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
import {
  createDeferredActionActor,
  hasRunnableDeferredActions,
} from "@/lib/deferred-actions-store";
import { runDueDeferredActions } from "@/lib/deferred-actions-executor";
import { HttpError, getErrorMessage } from "@/lib/errors";

const SESSION_CHECK_TIMEOUT_MS = 3000;

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  const authCookieRefresh: AuthCookieRefreshState = {
    value: null,
  };

  if (!cookieValue) {
    const response = NextResponse.json({ authenticated: false, user: null });
    clearStoredLoginName(response);
    return response;
  }

  try {
    const payload = await validateSessionWithTimeout(cookieValue, authCookieRefresh);
    const normalizedUser = normalizeSessionUser(payload) ?? buildStoredUser(request);
    const deferredActor = createDeferredActionActor({
      loginName: normalizedUser?.id ?? null,
      name: normalizedUser?.name ?? null,
    });

    if (hasRunnableDeferredActions()) {
      after(async () => {
        try {
          await runDueDeferredActions(cookieValue, deferredActor, { value: null });
        } catch {
          // Keep session validation responsive even if deferred execution fails.
        }
      });
    }

    const response = NextResponse.json({
      authenticated: true,
      user: normalizedUser,
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      const response = NextResponse.json({ authenticated: false, user: null });
      clearAuthCookie(response);
      clearStoredLoginName(response);
      return response;
    }

    if (
      error instanceof HttpError &&
      [429, 500, 502, 503, 504].includes(error.status)
    ) {
      const response = NextResponse.json({
        authenticated: true,
        user: buildStoredUser(request),
        degraded: true,
      });
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      return response;
    }

    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 502 },
    );
  }
}
