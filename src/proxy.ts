import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getAuthCookieNameForMiddleware,
  isLocalDevAuthBypassEnabled,
} from "@/lib/env";

export function proxy(request: NextRequest) {
  const localDevAuthBypassEnabled = isLocalDevAuthBypassEnabled();
  const authCookieName = getAuthCookieNameForMiddleware();
  const hasSessionCookie =
    localDevAuthBypassEnabled || Boolean(request.cookies.get(authCookieName)?.value);
  const { pathname, search } = request.nextUrl;

  if (pathname === "/signin" && localDevAuthBypassEnabled) {
    return NextResponse.redirect(new URL("/accounts", request.url));
  }

  if (
    (pathname.startsWith("/accounts") ||
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/map") ||
      pathname.startsWith("/quality") ||
      pathname.startsWith("/support") ||
      pathname.startsWith("/tasks")) &&
    !hasSessionCookie
  ) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/accounts/:path*",
    "/dashboard/:path*",
    "/map/:path*",
    "/quality/:path*",
    "/support/:path*",
    "/tasks/:path*",
    "/signin",
  ],
};
