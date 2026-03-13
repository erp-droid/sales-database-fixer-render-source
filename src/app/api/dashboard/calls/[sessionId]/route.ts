export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { maybeTriggerCallAnalyticsRefresh } from "@/lib/call-analytics/ingest";
import { buildDashboardCallDetail } from "@/lib/call-analytics/queries";
import { authenticateDashboardReadRequest } from "@/lib/call-analytics/request";
import { HttpError, getErrorMessage } from "@/lib/errors";

type Context = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(request: NextRequest, context: Context): Promise<NextResponse> {
  try {
    const auth = authenticateDashboardReadRequest(request);
    maybeTriggerCallAnalyticsRefresh(auth.cookieValue);
    const { sessionId } = await context.params;
    const payload = buildDashboardCallDetail(sessionId);
    if (!payload) {
      throw new HttpError(404, "Call session not found.");
    }

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
