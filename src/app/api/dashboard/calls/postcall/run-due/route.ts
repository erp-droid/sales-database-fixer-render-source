export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { runDueCallActivitySyncJobs } from "@/lib/call-analytics/postcall-worker";
import {
  authenticateDashboardRefreshRequest,
  finalizeDashboardResponse,
} from "@/lib/call-analytics/request";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";

type CallActivityRouteAuth =
  | {
      kind: "internal";
    }
  | {
      kind: "dashboard";
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

async function authenticateCallActivityRequest(
  request: NextRequest,
): Promise<CallActivityRouteAuth> {
  if (isInternalHost(request) || hasValidCallActivitySecret(request)) {
    return { kind: "internal" };
  }

  const auth = await authenticateDashboardRefreshRequest(request);
  return {
    kind: "dashboard",
    authCookieRefresh: auth.authCookieRefresh,
  };
}

function finalizeCallActivityResponse(
  response: NextResponse,
  auth: CallActivityRouteAuth,
): NextResponse {
  if (auth.kind !== "dashboard") {
    return response;
  }

  return finalizeDashboardResponse(response, auth.authCookieRefresh);
}

function readLimitParam(request: NextRequest, fallback = 25): number {
  const raw = request.nextUrl.searchParams.get("limit") ?? "";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(25, parsed);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateCallActivityRequest(request);
    const limit = readLimitParam(request);
    const result = await runDueCallActivitySyncJobs(limit);
    return finalizeCallActivityResponse(NextResponse.json({ ok: true, ...result }), auth);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
