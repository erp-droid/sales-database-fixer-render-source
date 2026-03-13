export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  getAuthCookieValue,
  getStoredLoginName,
  setAuthCookie,
} from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { ensureCallActivitySyncQueuedForSession } from "@/lib/call-analytics/postcall-worker";
import { readCallSessionById } from "@/lib/call-analytics/sessionize";
import {
  buildTwilioBridgeCallbacks,
  createCallSessionId,
  reconcileTwilioSession,
  recordProvisionalBridgeCall,
} from "@/lib/call-analytics/ingest";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { endBridgeCall, resolveCallerProfile, startBridgeCall } from "@/lib/twilio-outbound";

type StartPayload = {
  to?: string;
  context?: {
    sourcePage?: "accounts" | "map" | "tasks" | "quality";
    linkedBusinessAccountId?: string | null;
    linkedAccountRowKey?: string | null;
    linkedContactId?: number | null;
    linkedCompanyName?: string | null;
    linkedContactName?: string | null;
  } | null;
};

type EndPayload = {
  callSid?: string;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  let session = readCallSessionById(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Call session was not found." }, { status: 404 });
  }

  if (!session.endedAt || session.outcome === "in_progress") {
    session = (await reconcileTwilioSession(sessionId)) ?? session;
  }

  if (session.answered && session.endedAt) {
    void ensureCallActivitySyncQueuedForSession(sessionId).catch(() => undefined);
  }

  return NextResponse.json({
    sessionId: session.sessionId,
    active: session.endedAt === null,
    answered: session.answered,
    outcome: session.outcome,
    endedAt: session.endedAt,
    updatedAt: session.updatedAt,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const authCookieRefresh: AuthCookieRefreshState = { value: null };

  try {
    await validateSessionWithAcumatica(cookieValue, authCookieRefresh);

    const loginName = getStoredLoginName(request);
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
    }

    const body = (await request.json().catch(() => null)) as StartPayload | null;
    const targetPhone = typeof body?.to === "string" ? body.to : "";
    const sessionId = createCallSessionId();
    const callerProfile = await resolveCallerProfile(
      authCookieRefresh.value ?? cookieValue,
      loginName,
      authCookieRefresh,
    );
    const callbacks = buildTwilioBridgeCallbacks(request, sessionId);
    const startedCall = await startBridgeCall(callerProfile, targetPhone, {
      parentStatusCallback: callbacks.parentStatusCallback,
      childStatusCallback: callbacks.childStatusCallback,
      recordingStatusCallback: callbacks.recordingStatusCallback,
    });
    recordProvisionalBridgeCall({
      sessionId,
      rootCallSid: startedCall.sid,
      status: startedCall.status,
      bridgeNumber: startedCall.bridgeNumber,
      callerId: startedCall.callerId,
      userPhone: startedCall.userPhone,
      targetPhone: startedCall.targetPhone,
      callerDisplayName: callerProfile.displayName,
      callerLoginName: callerProfile.loginName,
      context: body?.context ?? undefined,
    });

    const response = NextResponse.json({
      ok: true,
      sessionId,
      callSid: startedCall.sid,
      status: startedCall.status,
      bridgeNumber: startedCall.bridgeNumber,
      callerId: startedCall.callerId,
      userPhone: startedCall.userPhone,
      targetPhone: startedCall.targetPhone,
      callerDisplayName: callerProfile.displayName,
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const authCookieRefresh: AuthCookieRefreshState = { value: null };

  try {
    await validateSessionWithAcumatica(cookieValue, authCookieRefresh);

    const body = (await request.json().catch(() => null)) as EndPayload | null;
    const callSid = typeof body?.callSid === "string" ? body.callSid : "";
    await endBridgeCall(callSid);

    const response = NextResponse.json({ ok: true });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
