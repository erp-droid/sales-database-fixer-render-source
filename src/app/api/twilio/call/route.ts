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
import type { CallSessionRecord } from "@/lib/call-analytics/types";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { formatPhoneForTwilioDial } from "@/lib/phone";
import { endBridgeCall, resolveCallerProfile, startBridgeCall } from "@/lib/twilio-outbound";

type StartPayload = {
  to?: string;
  context?: {
    sourcePage?: "accounts" | "map" | "tasks" | "quality" | "calendar";
    linkedBusinessAccountId?: string | null;
    linkedAccountRowKey?: string | null;
    linkedContactId?: number | null;
    linkedCompanyName?: string | null;
    linkedContactName?: string | null;
  } | null;
};

const ACTIVE_BRIDGE_CALL_LOOKBACK_MS = 10 * 60_000;
const ACTIVE_SESSION_RECONCILE_INTERVAL_MS = 30_000;
const ACTIVE_SESSION_CALLBACK_FRESHNESS_MS = 20_000;
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

function logCallSetupTiming(input: {
  step: string;
  startedAt: number;
  loginName?: string | null;
  sessionId?: string | null;
  targetPhone?: string | null;
  extra?: Record<string, unknown>;
}): void {
  const durationMs = Date.now() - input.startedAt;
  if (durationMs < 1000) {
    return;
  }

  const normalizedTargetPhone = formatPhoneForTwilioDial(input.targetPhone ?? "") ?? "";
  console.info("[twilio-call] setup timing", {
    step: input.step,
    durationMs,
    loginName: input.loginName?.trim().toLowerCase() || undefined,
    sessionId: input.sessionId || undefined,
    targetLast4: normalizedTargetPhone ? normalizedTargetPhone.slice(-4) : undefined,
    ...input.extra,
  });
}

function buildActiveBridgeCallPayload(
  session: CallSessionRecord,
  fallbackDisplayName: string,
): Record<string, unknown> {
  return {
    ok: true,
    deduped: true,
    sessionId: session.sessionId,
    callSid: session.rootCallSid,
    status: session.outcome,
    bridgeNumber: session.bridgeNumber,
    callerId: session.presentedCallerId,
    userPhone: session.employeePhone,
    targetPhone: session.targetPhone,
    callerDisplayName:
      session.employeeDisplayName ??
      session.employeeLoginName ??
      fallbackDisplayName,
  };
}

function isEmployeePhoneResolutionError(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("custom error module does not recognize this error") ||
    normalized.includes("insufficient rights to access the employee") ||
    normalized.includes("employee (ep203000)") ||
    normalized.includes("valid phone number in source system")
  );
}

function normalizeCallRouteError(error: unknown): HttpError | null {
  if (error instanceof HttpError && isEmployeePhoneResolutionError(error.message)) {
    return new HttpError(
      422,
      "Calling is unavailable until the signed-in employee phone can be read from source system.",
    );
  }

  if (error instanceof Error && isEmployeePhoneResolutionError(error.message)) {
    return new HttpError(
      422,
      "Calling is unavailable until the signed-in employee phone can be read from source system.",
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

function shouldSkipFreshWebhookDrivenReconcile(session: CallSessionRecord): boolean {
  const updatedAtMs = Date.parse(session.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs < ACTIVE_SESSION_CALLBACK_FRESHNESS_MS;
}

function maybeStartSessionReconcile(session: CallSessionRecord): void {
  const normalizedSessionId = session.sessionId.trim();
  if (!normalizedSessionId) {
    return;
  }

  if (shouldSkipFreshWebhookDrivenReconcile(session)) {
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

  let session = readCallSessionById(sessionId, { repairFromEmployeeDirectory: false });
  if (!session) {
    return NextResponse.json({ error: "Call session was not found." }, { status: 404 });
  }

  if (!session.endedAt || session.outcome === "in_progress") {
    maybeStartSessionReconcile(session);
    session = readCallSessionById(sessionId, { repairFromEmployeeDirectory: false }) ?? session;
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
  const routeStartedAt = Date.now();
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const authCookieRefresh: AuthCookieRefreshState = { value: null };
  let activeLoginName: string | null = null;
  let activeSessionId: string | null = null;
  let activeTargetPhone: string | null = null;

  try {
    const loginName = getStoredLoginName(request);
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
    }

    const body = (await request.json().catch(() => null)) as StartPayload | null;
    const targetPhone = typeof body?.to === "string" ? body.to : "";
    const sessionId = createCallSessionId();
    const normalizedLoginName = loginName.trim().toLowerCase();
    activeLoginName = normalizedLoginName;
    activeSessionId = sessionId;
    activeTargetPhone = targetPhone;

    const activeLookupStartedAt = Date.now();
    const activeLocalSession = findRecentBridgeCallSessionForEmployee({
      employeeLoginName: normalizedLoginName,
      targetPhone,
      withinMs: ACTIVE_BRIDGE_CALL_LOOKBACK_MS,
    });
    logCallSetupTiming({
      step: "find-active-session-before-profile",
      startedAt: activeLookupStartedAt,
      loginName: normalizedLoginName,
      sessionId,
      targetPhone,
    });
    if (activeLocalSession && !activeLocalSession.endedAt) {
      logCallSetupTiming({
        step: "total-deduped-before-profile",
        startedAt: routeStartedAt,
        loginName: normalizedLoginName,
        sessionId,
        targetPhone,
      });
      return NextResponse.json(
        buildActiveBridgeCallPayload(activeLocalSession, normalizedLoginName),
      );
    }

    let callerProfile;
    try {
      const resolveStartedAt = Date.now();
      callerProfile = await resolveCallerProfile(cookieValue, loginName);
      logCallSetupTiming({
        step: "resolve-caller-profile",
        startedAt: resolveStartedAt,
        loginName: normalizedLoginName,
        sessionId,
        targetPhone,
      });
    } catch (error) {
      if (getEnv().LOCAL_DATABASE_ONLY || !shouldRetryCallerProfileWithSession(error)) {
        throw error;
      }

      const validateStartedAt = Date.now();
      const sessionPayload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
      logCallSetupTiming({
        step: "validate-session-retry",
        startedAt: validateStartedAt,
        loginName: normalizedLoginName,
        sessionId,
        targetPhone,
      });
      const sessionIdentity = normalizeSessionIdentity(sessionPayload);
      const retryResolveStartedAt = Date.now();
      callerProfile = await resolveCallerProfile(
        authCookieRefresh.value ?? cookieValue,
        loginName,
        authCookieRefresh,
        {
          employeeId: sessionIdentity?.employeeId ?? null,
        },
      );
      logCallSetupTiming({
        step: "resolve-caller-profile-retry",
        startedAt: retryResolveStartedAt,
        loginName: normalizedLoginName,
        sessionId,
        targetPhone,
      });
    }

    const existingLookupStartedAt = Date.now();
    const existingSession = findRecentBridgeCallSessionForEmployee({
      employeeLoginName: callerProfile.loginName,
      targetPhone,
      withinMs: ACTIVE_BRIDGE_CALL_LOOKBACK_MS,
    });
    logCallSetupTiming({
      step: "find-active-session-after-profile",
      startedAt: existingLookupStartedAt,
      loginName: callerProfile.loginName,
      sessionId,
      targetPhone,
    });
    if (existingSession && !existingSession.endedAt) {
      const response = NextResponse.json({
        ...buildActiveBridgeCallPayload(existingSession, callerProfile.displayName),
      });
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      logCallSetupTiming({
        step: "total-deduped-after-profile",
        startedAt: routeStartedAt,
        loginName: callerProfile.loginName,
        sessionId,
        targetPhone,
      });
      return response;
    }

    const pendingStartStartedAt = Date.now();
    const startResult = await startOrJoinPendingBridgeCall(
      buildBridgeCallStartKey(callerProfile.loginName, targetPhone),
      async () => {
        const callbacks = buildTwilioBridgeCallbacks(request, sessionId);
        const twilioStartStartedAt = Date.now();
        const startedCall = await startBridgeCall(callerProfile, targetPhone, {
          parentStatusCallback: callbacks.parentStatusCallback,
          childStatusCallback: callbacks.childStatusCallback,
          recordingStatusCallback: callbacks.recordingStatusCallback,
        });
        logCallSetupTiming({
          step: "start-bridge-call",
          startedAt: twilioStartStartedAt,
          loginName: callerProfile.loginName,
          sessionId,
          targetPhone,
        });
        const recordStartedAt = Date.now();
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
        logCallSetupTiming({
          step: "record-provisional-call",
          startedAt: recordStartedAt,
          loginName: callerProfile.loginName,
          sessionId,
          targetPhone,
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
    logCallSetupTiming({
      step: "start-or-join-pending-call",
      startedAt: pendingStartStartedAt,
      loginName: callerProfile.loginName,
      sessionId,
      targetPhone,
      extra: startResult.deduped ? { deduped: true } : undefined,
    });

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
    logCallSetupTiming({
      step: "total",
      startedAt: routeStartedAt,
      loginName: callerProfile.loginName,
      sessionId,
      targetPhone,
    });
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
    logCallSetupTiming({
      step: "total-error",
      startedAt: routeStartedAt,
      loginName: activeLoginName,
      sessionId: activeSessionId,
      targetPhone: activeTargetPhone,
      extra: {
        error: getErrorMessage(error),
      },
    });
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
    if (!getEnv().LOCAL_DATABASE_ONLY) {
      await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
    }

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
