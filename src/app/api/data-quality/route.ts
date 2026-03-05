import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getLiveDataQualityExpandedSummary } from "@/lib/data-quality-live";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { parseDataQualityBasisQuery } from "@/lib/validation";

function isRefreshRequested(query: URLSearchParams): boolean {
  const value = query.get("refresh");
  return value === "1" || value === "true";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const refresh = isRefreshRequested(request.nextUrl.searchParams);
    const { basis } = parseDataQualityBasisQuery(request.nextUrl.searchParams);
    const cookieValue = requireAuthCookieValue(request);
    const summary = await getLiveDataQualityExpandedSummary(cookieValue, authCookieRefresh, {
      refresh,
      basis,
    });

    const response = NextResponse.json(summary);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof ZodError
        ? NextResponse.json(
            {
              error: "Invalid query parameters",
              details: error.flatten(),
            },
            { status: 400 },
          )
        : error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
            },
            { status: error.status },
          )
        : NextResponse.json(
            {
              error: getErrorMessage(error),
            },
            { status: 500 },
          );

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
