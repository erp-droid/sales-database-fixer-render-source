export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import {
  buildAddressKeyFromRow,
  kickGeocodeWorker,
  queueGeocodesForRows,
  readReadyGeocodeMap,
} from "@/lib/read-model/geocodes";
import { buildVisitationRoutePlan } from "@/lib/visitation-route-report";
import { loadVisitationReportRows } from "@/lib/visitation-report-data";
import {
  buildVisitationRouteWorkbook,
  buildVisitationRouteWorkbookFilename,
} from "@/lib/visitation-route-workbook";

function normalizedComparable(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = { value: null as string | null };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const salesRepId = request.nextUrl.searchParams.get("salesRepId")?.trim() ?? "";
    const salesRepName = request.nextUrl.searchParams.get("salesRepName")?.trim() ?? "";
    if (!salesRepId && !salesRepName) {
      throw new HttpError(400, "Choose a sales rep before running the report.");
    }
    if (salesRepId.length > 100 || salesRepName.length > 200) {
      throw new HttpError(400, "The selected sales rep is not valid.");
    }

    const { rows, readModelEnabled } = await loadVisitationReportRows(
      cookieValue,
      authCookieRefresh,
    );
    const targetId = normalizedComparable(salesRepId);
    const targetName = normalizedComparable(salesRepName);
    const candidateRows = rows.filter((row) => {
      const isAb = row.category === "A" || row.category === "B";
      const idMatches =
        Boolean(targetId) && normalizedComparable(row.salesRepId) === targetId;
      const nameMatches =
        Boolean(targetName) && normalizedComparable(row.salesRepName) === targetName;
      return isAb && (idMatches || nameMatches);
    });

    let geocodes = new Map<string, { latitude: number; longitude: number }>();
    if (readModelEnabled) {
      queueGeocodesForRows(candidateRows);
      const addressKeys = candidateRows.map(buildAddressKeyFromRow);
      geocodes = readReadyGeocodeMap(addressKeys);
      kickGeocodeWorker();
    }

    const plan = buildVisitationRoutePlan({
      rows,
      geocodes,
      salesRepId,
      salesRepName,
    });
    if (plan.accountTotal === 0) {
      throw new HttpError(404, "No category A or B accounts were found for that sales rep.");
    }

    const workbook = await buildVisitationRouteWorkbook(plan);
    const responseBody = new Uint8Array(workbook.byteLength);
    responseBody.set(workbook);
    const response = new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          `attachment; filename="${buildVisitationRouteWorkbookFilename(plan.salesRepName)}"`,
        "Cache-Control": "no-store",
        "X-Report-Account-Count": String(plan.accountTotal),
        "X-Report-Mapped-Count": String(plan.mappedAccountTotal),
        "X-Report-Sheet-Count": String(plan.days.length),
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
