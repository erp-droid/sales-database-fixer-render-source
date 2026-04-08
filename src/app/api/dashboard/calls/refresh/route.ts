export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { refreshCallAnalytics } from "@/lib/call-analytics/ingest";
import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { authenticateDashboardRefreshRequest, finalizeDashboardResponse } from "@/lib/call-analytics/request";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";

type CallAnalyticsRefreshRouteAuth =
  | {
      kind: "internal";
    }
  | {
      kind: "dashboard";
      cookieValue: string;
      authCookieRefresh: { value: string | null };
    };

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

function hasValidCallActivitySecret(request: NextRequest): boolean {
  const secret = getEnv().CALL_ACTIVITY_SYNC_SECRET;
  if (!secret) {
    return false;
  }

  const provided =
    request.headers.get("x-call-activity-sync-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  return provided === secret;
}

async function authenticateCallAnalyticsRefreshRequest(
  request: NextRequest,
): Promise<CallAnalyticsRefreshRouteAuth> {
  if (isInternalHost(request) || hasValidCallActivitySecret(request)) {
    return { kind: "internal" };
  }

  const auth = await authenticateDashboardRefreshRequest(request);
  return {
    kind: "dashboard",
    cookieValue: auth.cookieValue,
    authCookieRefresh: auth.authCookieRefresh,
  };
}

function finalizeCallAnalyticsRefreshResponse(
  response: NextResponse,
  auth: CallAnalyticsRefreshRouteAuth,
): NextResponse {
  if (auth.kind !== "dashboard") {
    return response;
  }

  return finalizeDashboardResponse(response, auth.authCookieRefresh);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateCallAnalyticsRefreshRequest(request);
    const state =
      auth.kind === "internal"
        ? await withServiceAcumaticaSession(null, (cookieValue, authCookieRefresh) =>
            refreshCallAnalytics(cookieValue, authCookieRefresh, {
              runPostcallSync: false,
            }),
          )
        : await refreshCallAnalytics(auth.cookieValue, auth.authCookieRefresh);
    return finalizeCallAnalyticsRefreshResponse(NextResponse.json({ ok: true, importState: state }), auth);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
