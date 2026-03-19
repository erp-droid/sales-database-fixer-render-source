export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  getAuthCookieValue,
  normalizeSessionIdentity,
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

function isEmployeePhoneResolutionError(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("custom error module does not recognize this error") ||
    normalized.includes("insufficient rights to access the employee") ||
    normalized.includes("employee (ep203000)") ||
    normalized.includes("valid phone number in acumatica")
  );
}

function normalizeCallRouteError(error: unknown): HttpError | null {
  if (error instanceof HttpError && isEmployeePhoneResolutionError(error.message)) {
    return new HttpError(
      422,
      "Calling is unavailable until the signed-in employee phone can be read from Acumatica.",
    );
  }

  if (error instanceof Error && isEmployeePhoneResolutionError(error.message)) {
    return new HttpError(
      422,
      "Calling is unavailable until the signed-in employee phone can be read from Acumatica.",
    );
  }

  return null;
}

function shouldRetryCallerProfileWithSession(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  if ([401, 403].includes(error.status)) {
    return true;
  }

  if (error.status !== 422) {
    return false;
  }

  const normalized = error.message.trim().toLowerCase();
  return !(
    normalized.includes("twilio cannot present") ||
    normalized.includes("verify that employee number in twilio first") ||
    normalized.includes("caller id")
  );
}

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
    const loginName = getStoredLoginName(request);
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
    }

    const body = (await request.json().catch(() => null)) as StartPayload | null;
    const targetPhone = typeof body?.to === "string" ? body.to : "";
    const sessionId = createCallSessionId();

    let callerProfile;
    try {
      callerProfile = await resolveCallerProfile(cookieValue, loginName);
    } catch (error) {
      if (!shouldRetryCallerProfileWithSession(error)) {
        throw error;
      }

      const sessionPayload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
      const sessionIdentity = normalizeSessionIdentity(sessionPayload);
      callerProfile = await resolveCallerProfile(
        authCookieRefresh.value ?? cookieValue,
        loginName,
        authCookieRefresh,
        {
          employeeId: sessionIdentity?.employeeId ?? null,
        },
      );
    }

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
      callerEmployeeId: callerProfile.employeeId ?? null,
      callerContactId: callerProfile.contactId ?? null,
      callerDisplayName: callerProfile.displayName,
      callerLoginName: callerProfile.loginName,
      callerEmail: callerProfile.email ?? null,
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
    const normalizedError = normalizeCallRouteError(error);
    const response =
      normalizedError instanceof HttpError
        ? NextResponse.json(
            { error: normalizedError.message, details: normalizedError.details },
            { status: normalizedError.status },
          )
        : error instanceof HttpError
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
