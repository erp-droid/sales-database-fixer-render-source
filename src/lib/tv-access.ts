import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { validateSessionWithAcumatica } from "@/lib/acumatica";
import { getAuthCookieNameForMiddleware } from "@/lib/env";
import { HttpError } from "@/lib/errors";

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
  const sessionCookie = cookieStore.get(getAuthCookieNameForMiddleware())?.value ?? "";
  const loginName = cookieStore.get("mb_login_name")?.value?.trim().toLowerCase() ?? "";

  if (!sessionCookie || !loginName) {
    redirect(buildSignInUrl(nextPath));
  }

  if (loginName !== TV_ALLOWED_LOGIN_NAME) {
    notFound();
  }

  try {
    await validateSessionWithAcumatica(
      sessionCookie,
      undefined,
      { signal: AbortSignal.timeout(10_000) },
    );
  } catch (error) {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      redirect(buildSignInUrl(nextPath));
    }

    throw error;
  }

  return { loginName };
}
