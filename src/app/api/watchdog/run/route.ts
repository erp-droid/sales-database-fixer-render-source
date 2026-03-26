export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  authenticateDashboardRefreshRequest,
  finalizeDashboardResponse,
} from "@/lib/call-analytics/request";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { runWatchdog } from "@/lib/watchdog";

type WatchdogRouteAuth =
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

function hasValidWatchdogSecret(request: NextRequest): boolean {
  const secret = getEnv().WATCHDOG_SECRET;
  if (!secret) {
    return false;
  }

  const provided =
    request.headers.get("x-watchdog-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  return provided === secret;
}

async function authenticateWatchdogRequest(
  request: NextRequest,
): Promise<WatchdogRouteAuth> {
  if (isInternalHost(request) || hasValidWatchdogSecret(request)) {
    return { kind: "internal" };
  }

  const auth = await authenticateDashboardRefreshRequest(request);
  return {
    kind: "dashboard",
    authCookieRefresh: auth.authCookieRefresh,
  };
}

function finalizeWatchdogResponse(
  response: NextResponse,
  auth: WatchdogRouteAuth,
): NextResponse {
  if (auth.kind !== "dashboard") {
    return response;
  }

  return finalizeDashboardResponse(response, auth.authCookieRefresh);
}

async function readWatchdogCounts(): Promise<{
  failedJobs: number;
  stuckRecordingJobs: number;
  pendingSyncJobs: number;
}> {
  const { getReadModelDb } = await import("@/lib/read-model/db");
  const db = getReadModelDb();
  const counts = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        SUM(CASE WHEN status = 'queued' AND error_message LIKE '%waiting for the call recording%' THEN 1 ELSE 0 END) AS stuck_recording_count,
        SUM(CASE WHEN status = 'transcribed' THEN 1 ELSE 0 END) AS pending_sync_count
      FROM call_activity_sync
      `,
    )
    .get() as
    | {
        failed_count: number | null;
        stuck_recording_count: number | null;
        pending_sync_count: number | null;
      }
    | undefined;

  return {
    failedJobs: counts?.failed_count ?? 0,
    stuckRecordingJobs: counts?.stuck_recording_count ?? 0,
    pendingSyncJobs: counts?.pending_sync_count ?? 0,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateWatchdogRequest(request);
    const report = await runWatchdog();
    const status = report.healthy ? 200 : 207;
    return finalizeWatchdogResponse(NextResponse.json(report, { status }), auth);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: getErrorMessage(error), ranAt: new Date().toISOString() },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateWatchdogRequest(request);
    const counts = await readWatchdogCounts();

    return finalizeWatchdogResponse(
      NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
        failedJobs: counts.failedJobs,
        stuckRecordingJobs: counts.stuckRecordingJobs,
        pendingSyncJobs: counts.pendingSyncJobs,
        healthy: counts.failedJobs === 0 && counts.stuckRecordingJobs === 0,
      }),
      auth,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { ok: false, error: getErrorMessage(error), timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
