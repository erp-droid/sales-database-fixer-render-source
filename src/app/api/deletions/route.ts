export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
import { runDueDeferredActions } from "@/lib/deferred-actions-executor";
import {
  approveDeferredActions,
  buildDeferredActionListResponse,
  cancelDeferredActions,
  hasRunnableDeferredActions,
} from "@/lib/deferred-actions-store";
import { HttpError, getErrorMessage } from "@/lib/errors";
import type {
  DeferredActionBulkRequest,
  DeferredActionBulkResponse,
  DeferredActionRunDueResponse,
} from "@/types/deferred-action";

function parseBulkRequest(value: unknown): DeferredActionBulkRequest {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  const action = record.action;
  const actionIds = record.actionIds;
  if (action !== "approve" && action !== "cancel") {
    throw new HttpError(400, "Bulk action must be 'approve' or 'cancel'.");
  }
  if (!Array.isArray(actionIds) || !actionIds.every((item) => typeof item === "string")) {
    throw new HttpError(400, "actionIds must be an array of IDs.");
  }

  return {
    action,
    actionIds,
  };
}

async function maybeRunDueActions(
  request: NextRequest,
  cookieValue: string,
  authCookieRefresh: { value: string | null },
): Promise<{
  executedCount: number;
  failedCount: number;
}> {
  if (!hasRunnableDeferredActions()) {
    return {
      executedCount: 0,
      failedCount: 0,
    };
  }

  const actor = await resolveDeferredActionActor(request, cookieValue, authCookieRefresh);
  return runDueDeferredActions(cookieValue, actor, authCookieRefresh);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const { executedCount, failedCount } = await maybeRunDueActions(
      request,
      cookieValue,
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const actor = await resolveDeferredActionActor(request, cookieValue, authCookieRefresh);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const payload = parseBulkRequest(body);
    const updatedCount =
      payload.action === "approve"
        ? approveDeferredActions(payload.actionIds, actor)
        : cancelDeferredActions(payload.actionIds, actor);
    const { executedCount, failedCount } = await maybeRunDueActions(
      request,
      cookieValue,
      authCookieRefresh,
    );
    const responseBody: DeferredActionBulkResponse = {
      ...buildDeferredActionListResponse(executedCount, failedCount),
      updatedCount,
    };
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
