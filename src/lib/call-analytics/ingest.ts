import type { NextRequest } from "next/server";
import twilio from "twilio";

import type { AuthCookieRefreshState } from "@/lib/acumatica";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";
import { createTwilioRestClient, getTwilioRestConfig, normalizeTwilioPhoneNumber, readTwilioPhoneInventory } from "@/lib/twilio";
import { readCallLegsBySessionId, readCallSessionById, rebuildCallSessions } from "@/lib/call-analytics/sessionize";
import type { CallSessionRecord } from "@/lib/call-analytics/types";
import { readCallEmployeeDirectoryMeta, syncCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { invalidateDashboardSnapshotCache } from "@/lib/call-analytics/dashboard-cache";
import type { CallAnalyticsSource, CallIngestState } from "@/lib/call-analytics/types";

type CallContextPayload = {
  sourcePage?: "accounts" | "map" | "tasks" | "quality";
  linkedBusinessAccountId?: string | null;
  linkedAccountRowKey?: string | null;
  linkedContactId?: number | null;
  linkedCompanyName?: string | null;
  linkedContactName?: string | null;
};

type ProvisionalBridgeCallInput = {
  sessionId: string;
  rootCallSid: string;
  status: string | null;
  bridgeNumber: string;
  callerId: string;
  userPhone: string;
  targetPhone: string;
  callerDisplayName: string;
  callerLoginName: string;
  context?: CallContextPayload;
};

type StoredCallIngestState = {
  status: CallIngestState["status"];
  last_recent_sync_at: string | null;
  last_full_backfill_at: string | null;
  latest_seen_start_time: string | null;
  oldest_seen_start_time: string | null;
  full_history_complete: number;
  last_webhook_at: string | null;
  last_error: string | null;
  progress_json: string | null;
  updated_at: string;
};

type StoredCallLegRaw = {
  raw_json: string;
};

type TwilioCallRecordLike = {
  sid: string;
  parentCallSid?: string | null;
  direction?: string | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  dateCreated?: Date | string | null;
  dateUpdated?: Date | string | null;
  duration?: string | number | null;
  price?: string | null;
  priceUnit?: string | null;
  answeredBy?: string | null;
};

let refreshInFlight: Promise<CallIngestState> | null = null;

export type CallAnalyticsRefreshEligibility = Pick<
  CallIngestState,
  "status" | "lastRecentSyncAt" | "lastFullBackfillAt" | "updatedAt"
>;

export type CallEmployeeDirectoryRefreshEligibility = {
  total: number;
  latestUpdatedAt: string | null;
};

function parseProgressJson(value: string | null): CallIngestState["progress"] {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as CallIngestState["progress"];
  } catch {
    return null;
  }
}

export function readCallIngestState(): CallIngestState {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        status,
        last_recent_sync_at,
        last_full_backfill_at,
        latest_seen_start_time,
        oldest_seen_start_time,
        full_history_complete,
        last_webhook_at,
        last_error,
        progress_json,
        updated_at
      FROM call_ingest_state
      WHERE scope = 'voice'
      `,
    )
    .get() as StoredCallIngestState | undefined;

  if (!row) {
    return {
      scope: "voice",
      status: "idle",
      lastRecentSyncAt: null,
      lastFullBackfillAt: null,
      latestSeenStartTime: null,
      oldestSeenStartTime: null,
      fullHistoryComplete: false,
      lastWebhookAt: null,
      lastError: null,
      progress: null,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    scope: "voice",
    status: row.status,
    lastRecentSyncAt: row.last_recent_sync_at,
    lastFullBackfillAt: row.last_full_backfill_at,
    latestSeenStartTime: row.latest_seen_start_time,
    oldestSeenStartTime: row.oldest_seen_start_time,
    fullHistoryComplete: row.full_history_complete === 1,
    lastWebhookAt: row.last_webhook_at,
    lastError: row.last_error,
    progress: parseProgressJson(row.progress_json),
    updatedAt: row.updated_at,
  };
}

function readLatestSnapshotTimestamp(state: CallAnalyticsRefreshEligibility): string | null {
  return state.lastRecentSyncAt ?? state.lastFullBackfillAt ?? null;
}

export function shouldTriggerCallAnalyticsAutoRefresh(
  state: CallAnalyticsRefreshEligibility,
  nowMs = Date.now(),
  staleAfterMs = getEnv().CALL_ANALYTICS_STALE_AFTER_MS,
): boolean {
  if (state.status === "recent_sync_running" || state.status === "full_backfill_running") {
    return false;
  }

  const latestSnapshotAt = readLatestSnapshotTimestamp(state);
  if (!latestSnapshotAt) {
    return false;
  }

  const ageMs = nowMs - Date.parse(latestSnapshotAt);
  if (!Number.isFinite(ageMs)) {
    return false;
  }

  return ageMs >= staleAfterMs;
}

export function shouldRefreshCallEmployeeDirectory(
  state: CallEmployeeDirectoryRefreshEligibility,
  nowMs = Date.now(),
  staleAfterMs = getEnv().CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS,
): boolean {
  if (state.total <= 0 || !state.latestUpdatedAt) {
    return true;
  }

  const ageMs = nowMs - Date.parse(state.latestUpdatedAt);
  if (!Number.isFinite(ageMs)) {
    return true;
  }

  return ageMs >= staleAfterMs;
}

function writeCallIngestState(
  next: Partial<CallIngestState> & { status: CallIngestState["status"] },
): CallIngestState {
  const db = getReadModelDb();
  const current = readCallIngestState();
  const updated: CallIngestState = {
    scope: "voice",
    status: next.status,
    lastRecentSyncAt: next.lastRecentSyncAt ?? current.lastRecentSyncAt,
    lastFullBackfillAt: next.lastFullBackfillAt ?? current.lastFullBackfillAt,
    latestSeenStartTime: next.latestSeenStartTime ?? current.latestSeenStartTime,
    oldestSeenStartTime: next.oldestSeenStartTime ?? current.oldestSeenStartTime,
    fullHistoryComplete: next.fullHistoryComplete ?? current.fullHistoryComplete,
    lastWebhookAt: next.lastWebhookAt ?? current.lastWebhookAt,
    lastError: next.lastError ?? current.lastError,
    progress: next.progress ?? current.progress,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `
    UPDATE call_ingest_state
    SET status = ?,
        last_recent_sync_at = ?,
        last_full_backfill_at = ?,
        latest_seen_start_time = ?,
        oldest_seen_start_time = ?,
        full_history_complete = ?,
        last_webhook_at = ?,
        last_error = ?,
        progress_json = ?,
        updated_at = ?
    WHERE scope = 'voice'
    `,
  ).run(
    updated.status,
    updated.lastRecentSyncAt,
    updated.lastFullBackfillAt,
    updated.latestSeenStartTime,
    updated.oldestSeenStartTime,
    updated.fullHistoryComplete ? 1 : 0,
    updated.lastWebhookAt,
    updated.lastError,
    updated.progress ? JSON.stringify(updated.progress) : null,
    updated.updatedAt,
  );

  return updated;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  const numeric = Date.parse(value);
  return Number.isFinite(numeric) ? new Date(numeric).toISOString() : null;
}

function parseDurationSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
}

function computeAnswered(
  status: string | null | undefined,
  durationSeconds: number | null,
  rawEventName?: string | null,
): boolean {
  if (rawEventName === "answered") {
    return true;
  }

  return (status ?? "") === "completed" && (durationSeconds ?? 0) > 0;
}

function normalizeSource(value: string | null | undefined): CallAnalyticsSource {
  if (value === "app_bridge" || value === "twilio_direct" || value === "inbound") {
    return value;
  }

  return "unknown";
}

function determineLegType(
  direction: string | null | undefined,
  parentSid: string | null | undefined,
  sourceHint: string | null | undefined,
): "root" | "destination" | "inbound" | "unknown" {
  if ((direction ?? "").startsWith("inbound")) {
    return "inbound";
  }

  if (parentSid) {
    return "destination";
  }

  if (sourceHint === "root" || (direction ?? "").startsWith("outbound")) {
    return "root";
  }

  return "unknown";
}

function mergeRawJson(
  existingRawJson: string | null,
  nextPayload: Record<string, unknown>,
  event?: {
    event?: string | null;
    occurredAt?: string | null;
    status?: string | null;
    source?: string | null;
  },
): string {
  let existing: Record<string, unknown> = {};
  if (existingRawJson) {
    try {
      const parsed = JSON.parse(existingRawJson) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        existing = parsed;
      }
    } catch {
      existing = {};
    }
  }

  const events = Array.isArray(existing.events)
    ? [...existing.events]
    : [];
  if (event && (event.event || event.status || event.occurredAt)) {
    events.push(event);
  }

  return JSON.stringify({
    ...existing,
    ...nextPayload,
    events,
  });
}

function upsertCallLeg(entry: {
  sid: string;
  parentSid?: string | null;
  sessionId: string;
  direction: string;
  fromNumber?: string | null;
  toNumber?: string | null;
  status?: string | null;
  answered?: boolean;
  answeredAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  ringDurationSeconds?: number | null;
  price?: string | null;
  priceUnit?: string | null;
  source: CallAnalyticsSource;
  legType: "root" | "destination" | "inbound" | "unknown";
  rawPayload: Record<string, unknown>;
  rawEvent?: {
    event?: string | null;
    occurredAt?: string | null;
    status?: string | null;
    source?: string | null;
  };
}): void {
  const db = getReadModelDb();
  const existing = db
    .prepare(
      `
      SELECT raw_json
      FROM call_legs
      WHERE sid = ?
      `,
    )
    .get(entry.sid) as StoredCallLegRaw | undefined;

  const now = new Date().toISOString();
  const rawJson = mergeRawJson(existing?.raw_json ?? null, entry.rawPayload, entry.rawEvent);

  db.prepare(
    `
    INSERT INTO call_legs (
      sid,
      parent_sid,
      session_id,
      direction,
      from_number,
      to_number,
      status,
      answered,
      answered_at,
      started_at,
      ended_at,
      duration_seconds,
      ring_duration_seconds,
      price,
      price_unit,
      source,
      leg_type,
      raw_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET
      parent_sid = excluded.parent_sid,
      session_id = excluded.session_id,
      direction = excluded.direction,
      from_number = excluded.from_number,
      to_number = excluded.to_number,
      status = excluded.status,
      answered = excluded.answered,
      answered_at = COALESCE(excluded.answered_at, call_legs.answered_at),
      started_at = COALESCE(excluded.started_at, call_legs.started_at),
      ended_at = COALESCE(excluded.ended_at, call_legs.ended_at),
      duration_seconds = COALESCE(excluded.duration_seconds, call_legs.duration_seconds),
      ring_duration_seconds = COALESCE(excluded.ring_duration_seconds, call_legs.ring_duration_seconds),
      price = COALESCE(excluded.price, call_legs.price),
      price_unit = COALESCE(excluded.price_unit, call_legs.price_unit),
      source = excluded.source,
      leg_type = excluded.leg_type,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
    `,
  ).run(
    entry.sid,
    entry.parentSid ?? null,
    entry.sessionId,
    entry.direction,
    entry.fromNumber ?? null,
    entry.toNumber ?? null,
    entry.status ?? null,
    entry.answered ? 1 : 0,
    entry.answeredAt ?? null,
    entry.startedAt ?? null,
    entry.endedAt ?? null,
    entry.durationSeconds ?? null,
    entry.ringDurationSeconds ?? null,
    entry.price ?? null,
    entry.priceUnit ?? null,
    entry.source,
    entry.legType,
    rawJson,
    now,
  );
}

function normalizeTwilioCallRecord(call: TwilioCallRecordLike, source: CallAnalyticsSource, sessionId?: string): void {
  const durationSeconds = parseDurationSeconds(call.duration);
  upsertCallLeg({
    sid: call.sid,
    parentSid: call.parentCallSid ?? null,
    sessionId: sessionId ?? call.parentCallSid ?? call.sid,
    direction: call.direction ?? "unknown",
    fromNumber: normalizeTwilioPhoneNumber(call.from),
    toNumber: normalizeTwilioPhoneNumber(call.to),
    status: call.status ?? null,
    answered: computeAnswered(
      call.status ?? null,
      durationSeconds,
      (call.status ?? null) === "in-progress" ? "answered" : null,
    ),
    answeredAt: null,
    startedAt: toIso(call.startTime ?? call.dateCreated),
    endedAt: toIso(call.endTime),
    durationSeconds,
    ringDurationSeconds: null,
    price: call.price ?? null,
    priceUnit: call.priceUnit ?? null,
    source,
    legType: determineLegType(call.direction, call.parentCallSid, null),
    rawPayload: {
      sid: call.sid,
      parentCallSid: call.parentCallSid ?? null,
      direction: call.direction ?? null,
      from: call.from ?? null,
      to: call.to ?? null,
      status: call.status ?? null,
      startTime: toIso(call.startTime),
      endTime: toIso(call.endTime),
      dateCreated: toIso(call.dateCreated),
      dateUpdated: toIso(call.dateUpdated),
      duration: durationSeconds,
      price: call.price ?? null,
      priceUnit: call.priceUnit ?? null,
      answeredBy: call.answeredBy ?? null,
    },
  });
}

export async function reconcileTwilioSession(sessionId: string): Promise<CallSessionRecord | null> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  const existingSession = readCallSessionById(normalizedSessionId);
  if (!existingSession) {
    return null;
  }

  const client = createTwilioRestClient();
  if (!client) {
    return existingSession;
  }

  const callsBySid = new Map<string, TwilioCallRecordLike>();
  const rootCallSid = existingSession.rootCallSid?.trim();
  const knownCallSids = new Set(
    readCallLegsBySessionId(normalizedSessionId)
      .map((leg) => leg.sid.trim())
      .filter(Boolean),
  );
  if (rootCallSid) {
    knownCallSids.add(rootCallSid);
  }

  for (const callSid of knownCallSids) {
    try {
      const call = await client.calls(callSid).fetch();
      callsBySid.set(call.sid, call as TwilioCallRecordLike);
    } catch {
      // Ignore transient fetch errors; another leg may still be enough to rebuild the session.
    }
  }

  if (rootCallSid) {
    try {
      const childCalls = await client.calls.list({
        parentCallSid: rootCallSid,
        limit: 20,
      });
      for (const childCall of childCalls) {
        callsBySid.set(childCall.sid, childCall as TwilioCallRecordLike);
      }
    } catch {
      // Ignore transient list errors; status polling can retry on the next pass.
    }
  }

  if (callsBySid.size === 0) {
    return existingSession;
  }

  for (const call of callsBySid.values()) {
    normalizeTwilioCallRecord(call, "app_bridge", normalizedSessionId);
  }

  let bridgeNumbers: string[] = [];
  try {
    bridgeNumbers = (await readTwilioPhoneInventory()).voiceNumbers;
  } catch {
    bridgeNumbers = [];
  }

  rebuildCallSessions({ bridgeNumbers });
  return readCallSessionById(normalizedSessionId);
}

function readCallbackUrlBase(requestOrUrl?: string | URL | NextRequest): string {
  const envBaseUrl = getEnv().APP_BASE_URL?.trim();
  if (envBaseUrl) {
    return envBaseUrl.replace(/\/+$/, "");
  }

  if (typeof requestOrUrl === "string") {
    return new URL(requestOrUrl).origin;
  }

  if (requestOrUrl instanceof URL) {
    return requestOrUrl.origin;
  }

  if (requestOrUrl) {
    return requestOrUrl.nextUrl.origin;
  }

  throw new Error("Unable to determine application base URL.");
}

export function buildTwilioStatusCallbackUrl(
  requestOrUrl: string | URL | NextRequest,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL("/api/twilio/voice/status", readCallbackUrlBase(requestOrUrl));
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

export function buildTwilioRecordingCallbackUrl(
  requestOrUrl: string | URL | NextRequest,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL("/api/twilio/voice/recording", readCallbackUrlBase(requestOrUrl));
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

export function createCallSessionId(): string {
  return `call-${crypto.randomUUID()}`;
}

export function recordProvisionalBridgeCall(input: ProvisionalBridgeCallInput): void {
  upsertCallLeg({
    sid: input.rootCallSid,
    sessionId: input.sessionId,
    direction: "outbound-api",
    fromNumber: normalizeTwilioPhoneNumber(input.bridgeNumber),
    toNumber: normalizeTwilioPhoneNumber(input.userPhone),
    status: input.status ?? "queued",
    answered: false,
    startedAt: new Date().toISOString(),
    source: "app_bridge",
    legType: "root",
    rawPayload: {
      appContext: {
        sessionId: input.sessionId,
        loginName: input.callerLoginName,
        displayName: input.callerDisplayName,
        userPhone: input.userPhone,
        callerId: input.callerId,
        bridgeNumber: input.bridgeNumber,
        sourcePage: input.context?.sourcePage ?? "unknown",
        linkedBusinessAccountId: input.context?.linkedBusinessAccountId ?? null,
        linkedAccountRowKey: input.context?.linkedAccountRowKey ?? null,
        linkedContactId: input.context?.linkedContactId ?? null,
        linkedCompanyName: input.context?.linkedCompanyName ?? null,
        linkedContactName: input.context?.linkedContactName ?? null,
      },
      provisional: true,
      targetPhone: input.targetPhone,
    },
    rawEvent: {
      event: "initiated",
      occurredAt: new Date().toISOString(),
      status: input.status ?? "queued",
      source: "app_bridge",
    },
  });

  rebuildCallSessions({
    bridgeNumbers: [input.bridgeNumber],
  });
}

function readWindowBounds(calls: TwilioCallRecordLike[]): {
  latestSeenStartTime: string | null;
  oldestSeenStartTime: string | null;
} {
  const times = calls
    .map((call) => toIso(call.startTime ?? call.dateCreated))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  return {
    latestSeenStartTime: times[times.length - 1] ?? null,
    oldestSeenStartTime: times[0] ?? null,
  };
}

async function ingestTwilioCalls(
  calls: TwilioCallRecordLike[],
  source: CallAnalyticsSource,
  bridgeNumbers: string[],
): Promise<number> {
  for (const call of calls) {
    normalizeTwilioCallRecord(call, source);
  }

  rebuildCallSessions({ bridgeNumbers });
  return calls.length;
}

async function listTwilioCalls(params: {
  startTimeAfter?: Date;
  startTimeBefore?: Date;
  limit?: number;
}): Promise<TwilioCallRecordLike[]> {
  const client = createTwilioRestClient();
  if (!client) {
    return [];
  }

  return client.calls.list({
    startTimeAfter: params.startTimeAfter,
    startTimeBefore: params.startTimeBefore,
    pageSize: 1000,
    limit: params.limit ?? 5000,
  });
}

async function runWarmRecentImport(bridgeNumbers: string[]): Promise<CallIngestState> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  writeCallIngestState({
    status: "recent_sync_running",
    lastError: null,
    progress: {
      phase: "warm_recent",
      processedCalls: 0,
      importedCalls: 0,
      windowStartIso: windowStart.toISOString(),
      windowEndIso: now.toISOString(),
    },
  });

  const calls = await listTwilioCalls({
    startTimeAfter: windowStart,
    limit: 5000,
  });
  const importedCalls = await ingestTwilioCalls(calls, "unknown", bridgeNumbers);
  const bounds = readWindowBounds(calls);

  return writeCallIngestState({
    status: "idle",
    lastRecentSyncAt: new Date().toISOString(),
    latestSeenStartTime: bounds.latestSeenStartTime,
    oldestSeenStartTime: bounds.oldestSeenStartTime,
    lastError: null,
    progress: {
      phase: "warm_recent",
      processedCalls: calls.length,
      importedCalls,
      windowStartIso: windowStart.toISOString(),
      windowEndIso: now.toISOString(),
    },
  });
}

async function runRecentReconcile(bridgeNumbers: string[]): Promise<CallIngestState> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  writeCallIngestState({
    status: "recent_sync_running",
    lastError: null,
    progress: {
      phase: "recent_reconcile",
      processedCalls: 0,
      importedCalls: 0,
      windowStartIso: windowStart.toISOString(),
      windowEndIso: now.toISOString(),
    },
  });

  const calls = await listTwilioCalls({
    startTimeAfter: windowStart,
    limit: 5000,
  });
  const importedCalls = await ingestTwilioCalls(calls, "unknown", bridgeNumbers);
  const bounds = readWindowBounds(calls);
  const current = readCallIngestState();

  return writeCallIngestState({
    status: current.fullHistoryComplete ? "complete" : "idle",
    lastRecentSyncAt: new Date().toISOString(),
    latestSeenStartTime: current.latestSeenStartTime ?? bounds.latestSeenStartTime,
    oldestSeenStartTime: current.oldestSeenStartTime ?? bounds.oldestSeenStartTime,
    lastError: null,
    progress: {
      phase: "recent_reconcile",
      processedCalls: calls.length,
      importedCalls,
      windowStartIso: windowStart.toISOString(),
      windowEndIso: now.toISOString(),
    },
  });
}

async function runHistoricalBackfill(bridgeNumbers: string[]): Promise<CallIngestState> {
  const current = readCallIngestState();
  if (current.fullHistoryComplete) {
    return current;
  }

  const startBefore = current.oldestSeenStartTime
    ? new Date(current.oldestSeenStartTime)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  writeCallIngestState({
    status: "full_backfill_running",
    lastError: null,
    progress: {
      phase: "historical_backfill",
      processedCalls: 0,
      importedCalls: 0,
      windowStartIso: null,
      windowEndIso: startBefore.toISOString(),
    },
  });

  const calls = await listTwilioCalls({
    startTimeBefore: startBefore,
    limit: 5000,
  });
  const importedCalls = await ingestTwilioCalls(calls, "unknown", bridgeNumbers);
  const bounds = readWindowBounds(calls);
  const fullHistoryComplete = calls.length < 5000;

  return writeCallIngestState({
    status: fullHistoryComplete ? "complete" : "idle",
    lastFullBackfillAt: new Date().toISOString(),
    oldestSeenStartTime: bounds.oldestSeenStartTime ?? current.oldestSeenStartTime,
    latestSeenStartTime: current.latestSeenStartTime ?? bounds.latestSeenStartTime,
    fullHistoryComplete,
    lastError: null,
    progress: {
      phase: "historical_backfill",
      processedCalls: calls.length,
      importedCalls,
      windowStartIso: bounds.oldestSeenStartTime,
      windowEndIso: startBefore.toISOString(),
    },
  });
}

export async function refreshCallAnalytics(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
  options?: {
    forceEmployeeDirectoryRefresh?: boolean;
  },
): Promise<CallIngestState> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    if (!getTwilioRestConfig()) {
      return writeCallIngestState({
        status: "idle",
        lastError: "Twilio is not configured.",
      });
    }

    const inventory = await readTwilioPhoneInventory();
    const shouldRefreshDirectory =
      options?.forceEmployeeDirectoryRefresh === true ||
      shouldRefreshCallEmployeeDirectory(readCallEmployeeDirectoryMeta());
    if (shouldRefreshDirectory) {
      await syncCallEmployeeDirectory(cookieValue, authCookieRefresh);
    }

    const current = readCallIngestState();
    let nextState = current;
    if (!current.lastRecentSyncAt) {
      nextState = await runWarmRecentImport(inventory.voiceNumbers);
    } else {
      nextState = await runRecentReconcile(inventory.voiceNumbers);
    }

    if (!nextState.fullHistoryComplete) {
      nextState = await runHistoricalBackfill(inventory.voiceNumbers);
    }

    return nextState;
  })()
    .catch((error) => {
      const nextState = writeCallIngestState({
        status: "error",
        lastError: error instanceof Error ? error.message : "Unable to refresh call analytics.",
      });
      throw Object.assign(error instanceof Error ? error : new Error("Call analytics refresh failed."), {
        callIngestState: nextState,
      });
    })
    .finally(() => {
      invalidateDashboardSnapshotCache();
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export function maybeTriggerCallAnalyticsRefresh(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): boolean {
  if (refreshInFlight) {
    return false;
  }

  if (!shouldTriggerCallAnalyticsAutoRefresh(readCallIngestState())) {
    return false;
  }

  void refreshCallAnalytics(cookieValue, authCookieRefresh).catch(() => undefined);
  return true;
}

export async function processTwilioStatusCallback(request: NextRequest): Promise<void> {
  const config = getTwilioRestConfig();
  if (!config) {
    throw new HttpError(503, "Twilio is not configured.");
  }

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const formData = await request.formData();
  const params = Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, typeof value === "string" ? value : ""]),
  ) as Record<string, string>;

  const isValid = twilio.validateRequest(config.authToken, signature, request.url, params);
  if (!isValid) {
    throw new HttpError(403, "Invalid Twilio signature.");
  }

  const callSid = params.CallSid?.trim();
  if (!callSid) {
    throw new HttpError(400, "Twilio callback is missing CallSid.");
  }

  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || params.CallSid.trim();
  const legHint = request.nextUrl.searchParams.get("leg")?.trim();
  const source = normalizeSource(request.nextUrl.searchParams.get("source"));
  const durationSeconds = parseDurationSeconds(params.CallDuration ?? null);
  const eventTimestamp = toIso(params.Timestamp ?? null) ?? new Date().toISOString();
  const status = params.CallStatus?.trim() ?? null;
  const answered = computeAnswered(status, durationSeconds, status === "in-progress" ? "answered" : null);

  upsertCallLeg({
    sid: callSid,
    parentSid: params.ParentCallSid?.trim() || null,
    sessionId,
    direction: params.Direction?.trim() || "unknown",
    fromNumber: normalizeTwilioPhoneNumber(params.From),
    toNumber: normalizeTwilioPhoneNumber(params.To),
    status,
    answered,
    answeredAt: status === "in-progress" ? eventTimestamp : null,
    startedAt: toIso(params.Timestamp ?? null),
    endedAt:
      status &&
      ["completed", "busy", "failed", "no-answer", "canceled"].includes(status)
        ? eventTimestamp
        : null,
    durationSeconds,
    source,
    legType: determineLegType(params.Direction, params.ParentCallSid, legHint),
    rawPayload: params,
    rawEvent: {
      event: request.nextUrl.searchParams.get("event"),
      occurredAt: eventTimestamp,
      status,
      source: source,
    },
  });

  const inventory = await readTwilioPhoneInventory();
  rebuildCallSessions({ bridgeNumbers: inventory.voiceNumbers });
  invalidateDashboardSnapshotCache();
  writeCallIngestState({
    status: readCallIngestState().fullHistoryComplete ? "complete" : "idle",
    lastWebhookAt: new Date().toISOString(),
    lastError: null,
  });
}

export function buildTwilioBridgeCallbacks(
  requestOrUrl: string | URL | NextRequest,
  sessionId: string,
): {
  parentStatusCallback: string;
  childStatusCallback: string;
  recordingStatusCallback: string;
} {
  return {
    parentStatusCallback: buildTwilioStatusCallbackUrl(requestOrUrl, {
      sessionId,
      source: "app_bridge",
      leg: "root",
    }),
    childStatusCallback: buildTwilioStatusCallbackUrl(requestOrUrl, {
      sessionId,
      source: "app_bridge",
      leg: "destination",
    }),
    recordingStatusCallback: buildTwilioRecordingCallbackUrl(requestOrUrl, {
      sessionId,
    }),
  };
}
