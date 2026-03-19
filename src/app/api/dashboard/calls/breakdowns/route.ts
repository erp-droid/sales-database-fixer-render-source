export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { maybeTriggerCallAnalyticsRefresh } from "@/lib/call-analytics/ingest";
import { buildDashboardBreakdown } from "@/lib/call-analytics/queries";
import { authenticateDashboardReadRequest } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = authenticateDashboardReadRequest(request);
    maybeTriggerCallAnalyticsRefresh(auth.cookieValue);
    const dimension = request.nextUrl.searchParams.get("dimension");
    if (
      dimension !== "employee" &&
      dimension !== "outcome" &&
      dimension !== "company" &&
      dimension !== "contact" &&
      dimension !== "source" &&
      dimension !== "direction"
    ) {
      throw new HttpError(400, "Invalid breakdown dimension.");
    }

    const payload = buildDashboardBreakdown(auth.filters, dimension);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
