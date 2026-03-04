import { NextRequest, NextResponse } from "next/server";

import {
  getAuthCookieValue,
  normalizeSessionUser,
  setAuthCookie,
} from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);

  if (!cookieValue) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  try {
    const authCookieRefresh: AuthCookieRefreshState = {
      value: null,
    };
    const payload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
    const response = NextResponse.json({
      authenticated: true,
      user: normalizeSessionUser(payload),
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return NextResponse.json({ authenticated: false, user: null });
    }

    if (
      error instanceof HttpError &&
      [429, 500, 502, 503, 504].includes(error.status)
    ) {
      return NextResponse.json({
        authenticated: true,
        user: null,
        degraded: true,
      });
    }

    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 502 },
    );
  }
}
