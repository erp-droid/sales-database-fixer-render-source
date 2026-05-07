export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { validateSessionWithAcumatica } from "@/lib/acumatica";
import { getEnv } from "@/lib/env";
import { getErrorMessage, HttpError } from "@/lib/errors";
import {
  readManualSyncBlockedReason,
  triggerReadModelSync,
} from "@/lib/read-model/sync";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };
  const forceUnlock = request.nextUrl.searchParams.get("forceUnlock") === "1";

  try {
    if (!getEnv().READ_MODEL_AUTO_SYNC_ENABLED) {
      throw new HttpError(
        409,
        "Full sync is disabled while SQLite-only mode is active.",
      );
    }

    const cookieValue = requireAuthCookieValue(request);
    await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
    if (forceUnlock) {
      const staleRunningAfterMs = getEnv().READ_MODEL_SYNC_STALE_RUNNING_AFTER_MS;
      readManualSyncBlockedReason(Date.now() + staleRunningAfterMs + 1);
    }
    const blockedReason = readManualSyncBlockedReason();
    if (blockedReason) {
      throw new HttpError(409, blockedReason);
    }
    const responseBody = await triggerReadModelSync(cookieValue, {
      authCookieRefresh,
      force: true,
    });
    if (responseBody.alreadyRunning) {
      throw new HttpError(409, "A full account sync is already running.");
    }
    const response = NextResponse.json(responseBody);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json(
            { error: error.message, details: error.details },
            { status: error.status },
          )
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
