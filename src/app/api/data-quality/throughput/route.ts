import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getLiveDataQualityThroughput } from "@/lib/data-quality-live";
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
    const throughput = await getLiveDataQualityThroughput(
      cookieValue,
      authCookieRefresh,
      {
        refresh,
        basis,
      },
    );

    const response = NextResponse.json(throughput);
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
