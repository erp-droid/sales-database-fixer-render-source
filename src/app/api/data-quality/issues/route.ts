import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getLiveDataQualityIssues } from "@/lib/data-quality-live";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { parseDataQualityIssuesQuery } from "@/lib/validation";

function isRefreshRequested(query: URLSearchParams): boolean {
  const value = query.get("refresh");
  return value === "1" || value === "true";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const query = parseDataQualityIssuesQuery(request.nextUrl.searchParams);
    const refresh = isRefreshRequested(request.nextUrl.searchParams);
    const cookieValue = requireAuthCookieValue(request);
    const issues = await getLiveDataQualityIssues(cookieValue, authCookieRefresh, {
      ...query,
      refresh,
    });

    const response = NextResponse.json(issues);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid query parameters",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json(
        {
          error: getErrorMessage(error),
        },
        { status: 500 },
      );
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
