export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  getStoredLoginName,
  requireAuthCookieValue,
  setAuthCookie,
} from "@/lib/auth";
import { queryBusinessAccounts } from "@/lib/business-accounts";
import {
  buildBusinessAccountsCsv,
  buildBusinessAccountsCsvFilename,
  canExportBusinessAccountsCsv,
} from "@/lib/business-account-export";
import { fetchAllSyncRows } from "@/lib/data-quality-live";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { maybeTriggerReadModelSync, readSyncStatus } from "@/lib/read-model/sync";
import { parseListQuery } from "@/lib/validation";

function hasUsableReadModelSnapshot(): boolean {
  const status = readSyncStatus();
  return Boolean(status.lastSuccessfulSyncAt) || status.rowsCount > 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request);
    if (!canExportBusinessAccountsCsv(loginName)) {
      throw new HttpError(403, "Only jserrano can export account CSV files.");
    }

    const params = parseListQuery(request.nextUrl.searchParams);
    const { READ_MODEL_ENABLED } = getEnv();

    let sourceRows = [] as Awaited<ReturnType<typeof fetchAllSyncRows>>;
    if (READ_MODEL_ENABLED) {
      maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
      sourceRows = readAllAccountRowsFromReadModel();
    }

    if (sourceRows.length === 0 && (!READ_MODEL_ENABLED || !hasUsableReadModelSnapshot())) {
      sourceRows = await fetchAllSyncRows(cookieValue, authCookieRefresh, {
        includeInternal: false,
      });
    }

    const exportRows = queryBusinessAccounts(sourceRows, {
      ...params,
      page: 1,
      pageSize: Math.max(1, sourceRows.length || 1),
    }).items;

    const response = new NextResponse(buildBusinessAccountsCsv(exportRows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildBusinessAccountsCsvFilename()}"`,
        "Cache-Control": "no-store",
      },
    });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;

    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid export parameters",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
