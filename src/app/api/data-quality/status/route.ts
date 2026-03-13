import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { getLiveDataQualitySnapshot } from "@/lib/data-quality-live";
import { markIssuesReviewed, syncDataQualityHistory } from "@/lib/data-quality-history";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { parseDataQualityStatusPayload } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const { action, issueKeys, reviewKeys } = parseDataQualityStatusPayload(body);

    // Ensure history reflects latest snapshot before applying status changes.
    const snapshot = await getLiveDataQualitySnapshot(cookieValue, authCookieRefresh, {
      refresh: false,
    });
    await syncDataQualityHistory(snapshot);
    await markIssuesReviewed(issueKeys, action, reviewKeys ?? []);

    const response = NextResponse.json({
      ok: true,
      updated: issueKeys.length,
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
          error: "Invalid request payload",
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
