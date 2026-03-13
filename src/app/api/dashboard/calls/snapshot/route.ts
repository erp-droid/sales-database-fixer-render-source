export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getDashboardSnapshot } from "@/lib/call-analytics/dashboard-snapshot";
import { maybeTriggerCallAnalyticsRefresh, readCallIngestState } from "@/lib/call-analytics/ingest";
import { authenticateDashboardReadRequest } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = authenticateDashboardReadRequest(request);
    const backgroundRefreshTriggered = maybeTriggerCallAnalyticsRefresh(auth.cookieValue);
    const snapshot = await getDashboardSnapshot(auth.filters);

    return NextResponse.json({
      ...snapshot,
      importState: readCallIngestState(),
      backgroundRefreshTriggered,
      viewer: {
        loginName: auth.viewerLoginName,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
