export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { maybeTriggerCallAnalyticsRefresh, readCallIngestState } from "@/lib/call-analytics/ingest";
import { buildDashboardCallList } from "@/lib/call-analytics/queries";
import { authenticateDashboardReadRequest } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = authenticateDashboardReadRequest(request);
    const backgroundRefreshTriggered = maybeTriggerCallAnalyticsRefresh(auth.cookieValue);
    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "25");
    const payload = buildDashboardCallList(auth.filters, page, pageSize);
    return NextResponse.json({
      ...payload,
      importState: readCallIngestState(),
      backgroundRefreshTriggered,
      viewer: {
        loginName: auth.viewerLoginName,
      },
      employees: readCallEmployeeDirectory().map((item) => ({
        loginName: item.loginName,
        displayName: item.displayName,
        email: item.email,
      })),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
