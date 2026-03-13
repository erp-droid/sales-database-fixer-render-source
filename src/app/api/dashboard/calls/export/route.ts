export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { maybeTriggerCallAnalyticsRefresh } from "@/lib/call-analytics/ingest";
import { buildDashboardExportCsv } from "@/lib/call-analytics/queries";
import { authenticateDashboardReadRequest } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = authenticateDashboardReadRequest(request);
    maybeTriggerCallAnalyticsRefresh(auth.cookieValue);
    const csv = buildDashboardExportCsv(auth.filters);
    const response = new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="call-dashboard-export.csv"',
      },
    });
    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
