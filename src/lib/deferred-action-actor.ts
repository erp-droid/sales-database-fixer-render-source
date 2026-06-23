import type { NextRequest } from "next/server";

import { getStoredLoginName, normalizeSessionUser } from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { createDeferredActionActor } from "@/lib/deferred-actions-store";
import { getEnv } from "@/lib/env";

export async function resolveDeferredActionActor(
  request: NextRequest,
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<{
  loginName: string | null;
  name: string | null;
}> {
  const storedLoginName = getStoredLoginName(request);
  if (getEnv().LOCAL_DATABASE_ONLY) {
    return createDeferredActionActor({
      loginName: storedLoginName,
      name: storedLoginName,
    });
  }

  const sessionPayload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
  const normalized = normalizeSessionUser(sessionPayload);

  return createDeferredActionActor({
    loginName: storedLoginName ?? normalized?.id ?? null,
    name: normalized?.name ?? storedLoginName ?? null,
  });
}

export function resolveStoredDeferredActionActor(request: NextRequest): {
  loginName: string | null;
  name: string | null;
} {
  const storedLoginName = getStoredLoginName(request);
  return createDeferredActionActor({
    loginName: storedLoginName,
    name: storedLoginName,
  });
}
