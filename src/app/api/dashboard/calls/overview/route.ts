export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { maybeTriggerCallAnalyticsRefresh } from "@/lib/call-analytics/ingest";
import { buildDashboardOverview } from "@/lib/call-analytics/queries";
import { authenticateDashboardReadRequest } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = authenticateDashboardReadRequest(request);
    maybeTriggerCallAnalyticsRefresh(auth.cookieValue);
    const payload = buildDashboardOverview(
      auth.filters,
      auth.viewerLoginName,
      auth.viewerLoginName,
    );
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
