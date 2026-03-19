import type { NextRequest } from "next/server";

import { getStoredLoginName, normalizeSessionUser } from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { createDeferredActionActor } from "@/lib/deferred-actions-store";

export async function resolveDeferredActionActor(
  request: NextRequest,
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<{
  loginName: string | null;
  name: string | null;
}> {
  const sessionPayload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
  const normalized = normalizeSessionUser(sessionPayload);
  const storedLoginName = getStoredLoginName(request);

  return createDeferredActionActor({
    loginName: storedLoginName ?? normalized?.id ?? null,
    name: normalized?.name ?? storedLoginName ?? null,
  });
}
