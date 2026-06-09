export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireStoredLoginName } from "@/lib/auth";
import {
  buildGoogleCalendarOauthStartUrl,
  readGoogleCalendarExpectedRedirectUri,
} from "@/lib/google-calendar";
import { HttpError, getErrorMessage } from "@/lib/errors";

function sanitizeReturnTo(returnTo: string | null | undefined): string {
  const trimmed = returnTo?.trim() ?? "";
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/calendar/oauth/complete";
  }

  return trimmed;
}

function buildCurrentOriginCompleteUrl(
  request: NextRequest,
  returnTo: string | null | undefined,
  params: Record<string, string | null | undefined>,
): URL {
  const target = new URL(sanitizeReturnTo(returnTo), request.nextUrl.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      target.searchParams.set(key, value);
    }
  });
  return target;
}

function assertCalendarRedirectOriginMatchesRequest(request: NextRequest): void {
  const expectedRedirectUri = readGoogleCalendarExpectedRedirectUri();
  if (!expectedRedirectUri) {
    return;
  }

  const expectedOrigin = new URL(expectedRedirectUri).origin;
  const requestOrigin = request.nextUrl.origin;
  if (expectedOrigin === requestOrigin) {
    return;
  }

  throw new HttpError(
    400,
    `Google Calendar OAuth is configured to return to ${expectedOrigin}, but this app is open at ${requestOrigin}. Open the app at ${expectedOrigin}, or update APP_BASE_URL and the Google OAuth redirect URI to ${requestOrigin}/api/calendar/oauth/callback.`,
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const returnTo = request.nextUrl.searchParams.get("returnTo");

  try {
    const loginName = requireStoredLoginName(request);
    assertCalendarRedirectOriginMatchesRequest(request);

    return NextResponse.redirect(
      buildGoogleCalendarOauthStartUrl({
        loginName,
        returnTo,
      }),
    );
  } catch (error) {
    return NextResponse.redirect(
      buildCurrentOriginCompleteUrl(request, returnTo, {
        error: getErrorMessage(error),
      }),
    );
  }
}
