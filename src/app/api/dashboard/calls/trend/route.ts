export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { maybeTriggerCallAnalyticsRefresh } from "@/lib/call-analytics/ingest";
import { buildDashboardTrend } from "@/lib/call-analytics/queries";
import { authenticateDashboardReadRequest } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = authenticateDashboardReadRequest(request);
    maybeTriggerCallAnalyticsRefresh(auth.cookieValue);
    const bucket = request.nextUrl.searchParams.get("bucket") === "week" ? "week" : "day";
    const payload = buildDashboardTrend(auth.filters, bucket);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
