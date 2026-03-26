export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { runWatchdog } from "@/lib/watchdog";
import {
  authenticateDashboardRefreshRequest,
  finalizeDashboardResponse,
} from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateDashboardRefreshRequest(request);
    const report = await runWatchdog();

    const status = report.healthy ? 200 : 207;
    return finalizeDashboardResponse(NextResponse.json(report, { status }), auth.authCookieRefresh);
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
    const auth = await authenticateDashboardRefreshRequest(request);
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
      .get() as { failed_count: number; stuck_recording_count: number; pending_sync_count: number } | undefined;

    return finalizeDashboardResponse(
      NextResponse.json({
        ok: true,
        timestamp: new Date().toISOString(),
        failedJobs: counts?.failed_count ?? 0,
        stuckRecordingJobs: counts?.stuck_recording_count ?? 0,
        pendingSyncJobs: counts?.pending_sync_count ?? 0,
        healthy: (counts?.failed_count ?? 0) === 0 && (counts?.stuck_recording_count ?? 0) === 0,
      }),
      auth.authCookieRefresh,
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
