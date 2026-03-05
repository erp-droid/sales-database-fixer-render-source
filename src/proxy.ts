import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAuthCookieNameForMiddleware } from "@/lib/env";

export function proxy(request: NextRequest) {
  const authCookieName = getAuthCookieNameForMiddleware();
  const hasSessionCookie = Boolean(request.cookies.get(authCookieName)?.value);
  const { pathname, search } = request.nextUrl;

  if (
    (pathname.startsWith("/accounts") ||
      pathname.startsWith("/map") ||
      pathname.startsWith("/quality")) &&
    !hasSessionCookie
  ) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/accounts/:path*", "/map/:path*", "/quality/:path*", "/signin"],
};
