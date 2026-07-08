import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getAuthCookieNameForMiddleware } from "@/lib/env";

export const TV_ALLOWED_LOGIN_NAME = "jserrano";

function buildSignInUrl(nextPath: string): string {
  const params = new URLSearchParams();
  params.set("next", nextPath);
  return `/signin?${params.toString()}`;
}

export async function requireTvAccess(nextPath: string): Promise<{
  loginName: string;
}> {
  const cookieStore = await cookies();
  const hasSessionCookie = Boolean(
    cookieStore.get(getAuthCookieNameForMiddleware())?.value,
  );
  const loginName = cookieStore.get("mb_login_name")?.value?.trim().toLowerCase() ?? "";

  if (!hasSessionCookie || !loginName) {
    redirect(buildSignInUrl(nextPath));
  }

  if (loginName !== TV_ALLOWED_LOGIN_NAME) {
    notFound();
  }

  return { loginName };
}
