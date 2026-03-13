export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import {
  buildGoogleCalendarOauthCompleteUrl,
  buildGoogleCalendarOauthStartUrl,
} from "@/lib/google-calendar";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const returnTo = request.nextUrl.searchParams.get("returnTo");

  try {
    requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request);
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
    }

    return NextResponse.redirect(
      buildGoogleCalendarOauthStartUrl({
        loginName,
        returnTo,
      }),
    );
  } catch (error) {
    return NextResponse.redirect(
      buildGoogleCalendarOauthCompleteUrl(request, returnTo, {
        error: getErrorMessage(error),
      }),
    );
  }
}
