import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getAuthCookieNameForMiddleware,
  getLocalDevLoginName,
  isLocalDevAuthBypassEnabled,
} from "@/lib/env";
import {
  isJefferyDirectoryUser,
  LOGIN_NAME_COOKIE,
} from "@/lib/account-directory-access";

const PROTECTED_PAGE_PREFIXES = [
  "/accounts",
  "/audit",
  "/calendar",
  "/dashboard",
  "/deletions",
  "/mail",
  "/map",
  "/quality",
  "/reports",
  "/state-transfer",
  "/support",
  "/tasks",
  "/tv",
] as const;

export function proxy(request: NextRequest) {
  const localDevAuthBypassEnabled = isLocalDevAuthBypassEnabled();
  const authCookieName = getAuthCookieNameForMiddleware();
  const hasSessionCookie =
    localDevAuthBypassEnabled || Boolean(request.cookies.get(authCookieName)?.value);
  const { pathname, search } = request.nextUrl;
  const storedLoginName = localDevAuthBypassEnabled
    ? getLocalDevLoginName()
    : request.cookies.get(LOGIN_NAME_COOKIE)?.value;
  const isDirectoryOnlyUser = isJefferyDirectoryUser(storedLoginName);
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (pathname === "/signin" && localDevAuthBypassEnabled) {
    return NextResponse.redirect(new URL("/accounts", request.url));
  }

  if (
    isDirectoryOnlyUser &&
    hasSessionCookie &&
    pathname !== "/accounts"
  ) {
    return NextResponse.redirect(new URL("/accounts", request.url));
  }

  if (isProtectedPage && !hasSessionCookie) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/accounts/:path*",
    "/audit/:path*",
    "/calendar/:path*",
    "/dashboard/:path*",
    "/deletions/:path*",
    "/mail/:path*",
    "/map/:path*",
    "/quality/:path*",
    "/reports/:path*",
    "/state-transfer/:path*",
    "/support/:path*",
    "/tasks/:path*",
    "/tv/:path*",
    "/signin",
  ],
};
