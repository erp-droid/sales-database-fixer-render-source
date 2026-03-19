export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { refreshCallAnalytics } from "@/lib/call-analytics/ingest";
import { authenticateDashboardRefreshRequest, finalizeDashboardResponse } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateDashboardRefreshRequest(request);
    const state = await refreshCallAnalytics(auth.cookieValue, auth.authCookieRefresh);
    return finalizeDashboardResponse(NextResponse.json({ ok: true, importState: state }), auth.authCookieRefresh);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
