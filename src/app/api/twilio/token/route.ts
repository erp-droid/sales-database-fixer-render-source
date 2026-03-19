export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

import {
  getAuthCookieValue,
  normalizeSessionUser,
  setAuthCookie,
} from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { buildTwilioIdentity, getTwilioVoiceConfig } from "@/lib/twilio";

const TOKEN_TTL_SECONDS = 60 * 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const config = getTwilioVoiceConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Twilio browser calling is not configured yet." },
      { status: 503 },
    );
  }

  try {
    const authCookieRefresh: AuthCookieRefreshState = { value: null };
    const sessionPayload = await validateSessionWithAcumatica(
      cookieValue,
      authCookieRefresh,
    );
    const user = normalizeSessionUser(sessionPayload);
    const identity = buildTwilioIdentity(user);

    const accessToken = new twilio.jwt.AccessToken(
      config.accountSid,
      config.apiKeySid,
      config.apiKeySecret,
      {
        identity,
        ttl: TOKEN_TTL_SECONDS,
      },
    );
    const voiceGrant = new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: config.twimlAppSid,
      incomingAllow: false,
    });
    accessToken.addGrant(voiceGrant);

    const response = NextResponse.json({
      token: accessToken.toJwt(),
      identity,
      edge: config.edge,
      callerId: config.callerId,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 502 },
    );
  }
}
