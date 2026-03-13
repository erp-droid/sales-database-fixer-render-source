export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  buildGoogleCalendarOauthCompleteUrl,
  exchangeGoogleCalendarOauthCode,
  fetchGoogleCalendarProfile,
  parseGoogleCalendarOauthState,
  storeGoogleCalendarOauthConnection,
} from "@/lib/google-calendar";
import { readGoogleCalendarConnection } from "@/lib/google-calendar-store";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const stateParam = request.nextUrl.searchParams.get("state") ?? "";
  let returnTo = request.nextUrl.searchParams.get("returnTo");

  try {
    const oauthState = parseGoogleCalendarOauthState(stateParam);
    returnTo = oauthState.returnTo;

    const googleError =
      request.nextUrl.searchParams.get("error_description") ??
      request.nextUrl.searchParams.get("error");
    if (googleError) {
      throw new HttpError(400, googleError);
    }

    const code = request.nextUrl.searchParams.get("code")?.trim();
    if (!code) {
      throw new HttpError(400, "Google Calendar did not return an authorization code.");
    }

    const tokenResponse = await exchangeGoogleCalendarOauthCode(code);
    const profile = await fetchGoogleCalendarProfile(tokenResponse.access_token ?? "");
    const existingConnection = readGoogleCalendarConnection(oauthState.loginName);
    const refreshToken = tokenResponse.refresh_token?.trim() || existingConnection?.refreshToken || "";
    if (!refreshToken) {
      throw new HttpError(
        502,
        "Google Calendar did not return an offline refresh token. Reconnect and approve access again.",
      );
    }

    storeGoogleCalendarOauthConnection({
      loginName: oauthState.loginName,
      connectedGoogleEmail: profile.email,
      refreshToken,
      accessToken: tokenResponse.access_token ?? "",
      expiresInSeconds: tokenResponse.expires_in,
      tokenScope: tokenResponse.scope ?? existingConnection?.tokenScope ?? null,
    });

    return NextResponse.redirect(
      buildGoogleCalendarOauthCompleteUrl(request, oauthState.returnTo, {
        connectedGoogleEmail: profile.email,
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
