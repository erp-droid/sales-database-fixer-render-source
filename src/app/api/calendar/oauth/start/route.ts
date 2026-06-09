export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireStoredLoginName } from "@/lib/auth";
import {
  buildGoogleCalendarOauthCompleteUrl,
  buildGoogleCalendarOauthStartUrl,
} from "@/lib/google-calendar";
import { getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const returnTo = request.nextUrl.searchParams.get("returnTo");

  try {
    const loginName = requireStoredLoginName(request);

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
