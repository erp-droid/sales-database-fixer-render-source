import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AuthCookieRefreshState } from "@/lib/acumatica";
import { parseDashboardFilters } from "@/lib/call-analytics/filter-params";
import { validateSessionWithAcumatica } from "@/lib/acumatica";
import { getAuthCookieValue, getStoredLoginName, normalizeSessionUser, setAuthCookie } from "@/lib/auth";
import { HttpError } from "@/lib/errors";

export type AuthenticatedDashboardReadRequest = {
  cookieValue: string;
  viewerLoginName: string | null;
  filters: ReturnType<typeof parseDashboardFilters>;
};

export type AuthenticatedDashboardRefreshRequest = {
  cookieValue: string;
  authCookieRefresh: AuthCookieRefreshState;
  viewerLoginName: string | null;
  viewerDisplayName: string | null;
  filters: ReturnType<typeof parseDashboardFilters>;
};

export function authenticateDashboardReadRequest(
  request: NextRequest,
): AuthenticatedDashboardReadRequest {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    throw new HttpError(401, "Not authenticated.");
  }

  return {
    cookieValue,
    viewerLoginName: getStoredLoginName(request),
    filters: parseDashboardFilters(request.nextUrl.searchParams),
  };
}

export async function authenticateDashboardRefreshRequest(
  request: NextRequest,
): Promise<AuthenticatedDashboardRefreshRequest> {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    throw new HttpError(401, "Not authenticated.");
  }

  const authCookieRefresh: AuthCookieRefreshState = { value: null };
  const payload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
  const sessionUser = normalizeSessionUser(payload);

  return {
    cookieValue: authCookieRefresh.value ?? cookieValue,
    authCookieRefresh,
    viewerLoginName: getStoredLoginName(request),
    viewerDisplayName: sessionUser?.name ?? null,
    filters: parseDashboardFilters(request.nextUrl.searchParams),
  };
}

export function finalizeDashboardResponse(
  response: NextResponse,
  authCookieRefresh: AuthCookieRefreshState,
): NextResponse {
  if (authCookieRefresh.value) {
    setAuthCookie(response, authCookieRefresh.value);
  }

  return response;
}
