export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { buildVisitationRouteSalesRepOptions } from "@/lib/visitation-route-report";
import { loadVisitationReportRows } from "@/lib/visitation-report-data";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = { value: null as string | null };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const { rows } = await loadVisitationReportRows(cookieValue, authCookieRefresh);
    const response = NextResponse.json({
      items: buildVisitationRouteSalesRepOptions(rows),
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response = error instanceof HttpError
      ? NextResponse.json(
          { error: error.message, details: error.details },
          { status: error.status },
        )
      : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
