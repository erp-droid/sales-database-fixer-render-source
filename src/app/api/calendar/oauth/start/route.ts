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

function readFirstHeaderValue(request: NextRequest, name: string): string | null {
  return request.headers.get(name)?.split(",")[0]?.trim() || null;
}

function isInternalContainerOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
  } catch {
    return false;
  }
}

function readExpectedRedirectOrigin(): string | null {
  const expectedRedirectUri = readGoogleCalendarExpectedRedirectUri();
  return expectedRedirectUri ? new URL(expectedRedirectUri).origin : null;
}

function resolvePublicOrigin(request: NextRequest): string {
  const expectedOrigin = readExpectedRedirectOrigin();
  const forwardedHost = readFirstHeaderValue(request, "x-forwarded-host");
  const host = forwardedHost ?? readFirstHeaderValue(request, "host");
  const protocol =
    readFirstHeaderValue(request, "x-forwarded-proto") ??
    request.nextUrl.protocol.replace(/:$/, "") ??
    "https";

  if (host) {
    const forwardedOrigin = new URL(`${protocol}://${host}`).origin;
    if (!isInternalContainerOrigin(forwardedOrigin)) {
      return forwardedOrigin;
    }
  }

  if (!isInternalContainerOrigin(request.nextUrl.origin)) {
    return request.nextUrl.origin;
  }

  return expectedOrigin ?? request.nextUrl.origin;
}

function buildCurrentOriginCompleteUrl(
  request: NextRequest,
  returnTo: string | null | undefined,
  params: Record<string, string | null | undefined>,
): URL {
  const target = new URL(sanitizeReturnTo(returnTo), resolvePublicOrigin(request));
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      target.searchParams.set(key, value);
    }
  });
  return target;
}

function assertCalendarRedirectOriginMatchesRequest(request: NextRequest): void {
  const expectedOrigin = readExpectedRedirectOrigin();
  if (!expectedOrigin) {
    return;
  }

  const requestOrigin = resolvePublicOrigin(request);
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
