export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { buildJeffSpecialReportPlan } from "@/lib/jeff-special-report";
import {
  buildJeffSpecialWorkbook,
  buildJeffSpecialWorkbookFilename,
} from "@/lib/jeff-special-workbook";
import { loadVisitationReportRows } from "@/lib/visitation-report-data";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = { value: null as string | null };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const { rows } = await loadVisitationReportRows(cookieValue, authCookieRefresh);
    const plan = buildJeffSpecialReportPlan(rows);
    if (plan.matchedAccountTotal === 0) {
      throw new HttpError(409, "The Jeff Special Report companies could not be found in the CRM snapshot.");
    }

    const workbook = await buildJeffSpecialWorkbook(plan);
    const responseBody = new Uint8Array(workbook.byteLength);
    responseBody.set(workbook);
    const response = new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          `attachment; filename="${buildJeffSpecialWorkbookFilename()}"`,
        "Cache-Control": "no-store",
        "X-Report-Account-Count": String(plan.accountTotal),
        "X-Report-Matched-Count": String(plan.matchedAccountTotal),
        "X-Report-Missing-Count": String(plan.missingAccountTotal),
        "X-Report-Difference-Count": String(plan.differences.length),
        "X-Report-Sheet-Count": String(plan.weeks.length + 1),
      },
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
