export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getLiveDataQualityTasks } from "@/lib/data-quality-live";
import { HttpError, getErrorMessage } from "@/lib/errors";

function isRefreshRequested(query: URLSearchParams): boolean {
  const value = query.get("refresh");
  return value === "1" || value === "true";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const responsePayload = await getLiveDataQualityTasks(
      cookieValue,
      authCookieRefresh,
      {
        refresh: isRefreshRequested(request.nextUrl.searchParams),
      },
    );

    const response = NextResponse.json(responsePayload);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    let response: NextResponse;

    if (error instanceof HttpError) {
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
