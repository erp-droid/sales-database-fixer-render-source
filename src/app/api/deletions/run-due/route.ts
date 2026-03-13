export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
import { runDueDeferredActions } from "@/lib/deferred-actions-executor";
import { buildDeferredActionListResponse } from "@/lib/deferred-actions-store";
import { HttpError, getErrorMessage } from "@/lib/errors";
import type { DeferredActionRunDueResponse } from "@/types/deferred-action";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const actor = await resolveDeferredActionActor(request, cookieValue, authCookieRefresh);
    const { executedCount, failedCount } = await runDueDeferredActions(
      cookieValue,
      actor,
      authCookieRefresh,
    );
    const responseBody: DeferredActionRunDueResponse = buildDeferredActionListResponse(
      executedCount,
      failedCount,
    );
    const response = NextResponse.json(responseBody);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json(
            {
              error: getErrorMessage(error),
            },
            { status: 500 },
          );

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
