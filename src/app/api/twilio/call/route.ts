export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  getAuthCookieValue,
  normalizeSessionIdentity,
  getStoredLoginName,
  setAuthCookie,
} from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { queueCallActivitySyncForSession } from "@/lib/call-analytics/postcall-worker";
import {
  findRecentBridgeCallSessionForEmployee,
  readCallSessionById,
} from "@/lib/call-analytics/sessionize";
import {
  buildTwilioBridgeCallbacks,
  createCallSessionId,
  reconcileTwilioSession,
  recordProvisionalBridgeCall,
} from "@/lib/call-analytics/ingest";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { formatPhoneForTwilioDial } from "@/lib/phone";
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

const ACTIVE_BRIDGE_CALL_LOOKBACK_MS = 45_000;
const ACTIVE_SESSION_RECONCILE_INTERVAL_MS = 15_000;
const pendingBridgeCallStarts = new Map<string, Promise<BridgeCallStartResult>>();
const pendingSessionReconciles = new Map<string, Promise<unknown>>();
const lastSessionReconcileAt = new Map<string, number>();

type EndPayload = {
  callSid?: string;
};

type BridgeCallStartResult = {
  sessionId: string;
  callSid: string;
  status: string | null;
  bridgeNumber: string;
  callerId: string;
  userPhone: string;
  targetPhone: string;
  callerDisplayName: string;
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

function buildBridgeCallStartKey(employeeLoginName: string, targetPhone: string): string {
  return `${employeeLoginName.trim().toLowerCase()}::${
    formatPhoneForTwilioDial(targetPhone) ?? targetPhone.trim()
  }`;
}

async function startOrJoinPendingBridgeCall(
  key: string,
  startCall: () => Promise<BridgeCallStartResult>,
): Promise<BridgeCallStartResult & { deduped: boolean }> {
  const pendingStart = pendingBridgeCallStarts.get(key);
  if (pendingStart) {
    const result = await pendingStart;
    return {
      ...result,
      deduped: true,
    };
  }

  const startedCallPromise = startCall();
  pendingBridgeCallStarts.set(key, startedCallPromise);

  try {
    const result = await startedCallPromise;
    return {
      ...result,
      deduped: false,
    };
  } finally {
    if (pendingBridgeCallStarts.get(key) === startedCallPromise) {
      pendingBridgeCallStarts.delete(key);
    }
  }
}

function maybeStartSessionReconcile(sessionId: string): void {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return;
  }

  if (pendingSessionReconciles.has(normalizedSessionId)) {
    return;
  }

  const now = Date.now();
  const lastStartedAt = lastSessionReconcileAt.get(normalizedSessionId) ?? 0;
  if (now - lastStartedAt < ACTIVE_SESSION_RECONCILE_INTERVAL_MS) {
    return;
  }

  lastSessionReconcileAt.set(normalizedSessionId, now);
  const reconcilePromise = reconcileTwilioSession(normalizedSessionId)
    .catch(() => undefined)
    .finally(() => {
      pendingSessionReconciles.delete(normalizedSessionId);
    });

  pendingSessionReconciles.set(normalizedSessionId, reconcilePromise);
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
    maybeStartSessionReconcile(sessionId);
    session = readCallSessionById(sessionId) ?? session;
  } else {
    pendingSessionReconciles.delete(sessionId);
    lastSessionReconcileAt.delete(sessionId);
  }

  if (session.answered && session.endedAt) {
    queueCallActivitySyncForSession(sessionId);
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

    const existingSession = findRecentBridgeCallSessionForEmployee({
      employeeLoginName: callerProfile.loginName,
      targetPhone,
      withinMs: ACTIVE_BRIDGE_CALL_LOOKBACK_MS,
    });
    if (existingSession && !existingSession.endedAt) {
      const response = NextResponse.json({
        ok: true,
        deduped: true,
        sessionId: existingSession.sessionId,
        callSid: existingSession.rootCallSid,
        status: existingSession.outcome,
        bridgeNumber: existingSession.bridgeNumber,
        callerId: existingSession.presentedCallerId,
        userPhone: existingSession.employeePhone,
        targetPhone: existingSession.targetPhone,
        callerDisplayName: existingSession.employeeDisplayName ?? callerProfile.displayName,
      });
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      return response;
    }

    const startResult = await startOrJoinPendingBridgeCall(
      buildBridgeCallStartKey(callerProfile.loginName, targetPhone),
      async () => {
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

        return {
          sessionId,
          callSid: startedCall.sid,
          status: startedCall.status,
          bridgeNumber: startedCall.bridgeNumber,
          callerId: startedCall.callerId,
          userPhone: startedCall.userPhone,
          targetPhone: startedCall.targetPhone,
          callerDisplayName: callerProfile.displayName,
        };
      },
    );

    const response = NextResponse.json({
      ok: true,
      ...(startResult.deduped ? { deduped: true } : {}),
      sessionId: startResult.sessionId,
      callSid: startResult.callSid,
      status: startResult.status,
      bridgeNumber: startResult.bridgeNumber,
      callerId: startResult.callerId,
      userPhone: startResult.userPhone,
      targetPhone: startResult.targetPhone,
      callerDisplayName: startResult.callerDisplayName,
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
