import { NextRequest, NextResponse } from "next/server";

import {
  buildCookieHeader,
  clearAuthCookie,
  clearStoredLoginName,
  getAuthCookieValue,
} from "@/lib/auth";
import { getEnv } from "@/lib/env";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  const cookieValue = getAuthCookieValue(request);
  const isCustomAuth = env.AUTH_PROVIDER === "custom";
  const logoutUrl = isCustomAuth
    ? env.AUTH_LOGOUT_URL
    : env.AUTH_LOGOUT_URL ?? `${env.ACUMATICA_BASE_URL}/entity/auth/logout`;

  if (logoutUrl && cookieValue) {
    await fetch(logoutUrl, {
      method: "POST",
      headers: {
        Cookie: buildCookieHeader(cookieValue),
      },
      cache: "no-store",
    }).catch(() => {
      // Ignore upstream logout errors and always clear local cookie.
    });
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookie(response);
  clearStoredLoginName(response);

  return response;
}
