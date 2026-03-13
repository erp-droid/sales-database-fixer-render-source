export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { runDueCallActivitySyncJobs } from "@/lib/call-analytics/postcall-worker";
import {
  authenticateDashboardRefreshRequest,
  finalizeDashboardResponse,
} from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateDashboardRefreshRequest(request);
    const result = await runDueCallActivitySyncJobs();
    return finalizeDashboardResponse(NextResponse.json({ ok: true, ...result }), auth.authCookieRefresh);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
