export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { readCallIngestState, refreshCallAnalytics } from "@/lib/call-analytics/ingest";
import { runDueCallActivitySyncJobs } from "@/lib/call-analytics/postcall-worker";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  formatLocalDateKey,
  readScheduledJobRun,
  resolveScheduledCallActivityTargetDate,
  writeScheduledJobRun,
} from "@/lib/scheduled-jobs";

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

function hasValidSecret(request: NextRequest): boolean {
  const secret = process.env.CALL_ACTIVITY_SYNC_SECRET?.trim() ?? "";
  if (!secret) {
    return false;
  }

  const provided =
    request.headers.get("x-call-activity-sync-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  return provided === secret;
}

function ensureAuthorized(request: NextRequest): void {
  if (isInternalHost(request) || hasValidSecret(request)) {
    return;
  }

  throw new HttpError(401, "Not authenticated.");
}

function readBoundedInteger(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function readBooleanFlag(value: string | null | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function readOptionalDateKey(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get("dateKey")?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function readForceFlag(request: NextRequest): boolean {
  const raw = request.nextUrl.searchParams.get("force")?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureAuthorized(request);

    const timeZone = (process.env.CALL_ACTIVITY_SYNC_TIME_ZONE || "America/Toronto").trim();
    const scheduleHour = readBoundedInteger(process.env.CALL_ACTIVITY_SYNC_SCHEDULE_HOUR, 17, 0, 23);
    const scheduleMinute = readBoundedInteger(process.env.CALL_ACTIVITY_SYNC_SCHEDULE_MINUTE, 0, 0, 59);
    const maxBatches = readBoundedInteger(
      process.env.CALL_ACTIVITY_SYNC_MAX_BATCHES_PER_WINDOW,
      200,
      1,
      500,
    );
    const runtimeCapMs = readBoundedInteger(
      process.env.CALL_ACTIVITY_SYNC_RUNTIME_CAP_MS,
      45_000,
      5_000,
      300_000,
    );
    const batchLimit = readBoundedInteger(process.env.CALL_ACTIVITY_SYNC_BATCH_SIZE, 5, 1, 25);
    const refreshBeforeRun = readBooleanFlag(process.env.CALL_ACTIVITY_SYNC_REFRESH_BEFORE_RUN, true);
    const force = readForceFlag(request);
    const startedAtMs = Date.now();
    const targetDateKey =
      readOptionalDateKey(request) ??
      resolveScheduledCallActivityTargetDate(new Date(), timeZone, scheduleHour, scheduleMinute);

    if (!targetDateKey) {
      throw new HttpError(500, "Unable to resolve the scheduled call-sync target date.");
    }

    const existing = force ? null : readScheduledJobRun("call_activity_sync", targetDateKey);
    if (existing?.status === "completed") {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        targetDateKey,
        detail: "Scheduled call-activity sync already completed for this date.",
        existing,
      });
    }

    writeScheduledJobRun({
      jobName: "call_activity_sync",
      windowKey: targetDateKey,
      status: "running",
      detail: "Scheduled call-activity sync started.",
    });

    const importState = refreshBeforeRun
      ? await withServiceAcumaticaSession(null, (cookieValue, authCookieRefresh) =>
          refreshCallAnalytics(cookieValue, authCookieRefresh, {
            runPostcallSync: false,
          }),
        )
      : readCallIngestState();

    let attempts = 0;
    let hitRuntimeCap = false;
    let finalBatchResult:
      | {
          processedCount: number;
          syncedCount: number;
          failedCount: number;
          skippedCount: number;
          remainingCount: number;
          completed: boolean;
        }
      | null = null;

    while (attempts < maxBatches) {
      if (Date.now() - startedAtMs >= runtimeCapMs) {
        hitRuntimeCap = true;
        break;
      }

      attempts += 1;
      finalBatchResult = await runDueCallActivitySyncJobs(batchLimit, {
        localDateKey: targetDateKey,
        timeZone,
      });
      if (finalBatchResult.completed) {
        break;
      }
    }

    const latestState = readCallIngestState();
    const confirmedDateKey = latestState.lastRecentSyncAt
      ? formatLocalDateKey(new Date(latestState.lastRecentSyncAt), timeZone)
      : null;
    const reachedCoverage = refreshBeforeRun
      ? confirmedDateKey !== null && confirmedDateKey >= targetDateKey
      : true;
    const elapsedMs = Date.now() - startedAtMs;
    const complete =
      finalBatchResult?.completed === true &&
      reachedCoverage &&
      !latestState.lastError;

    if (hitRuntimeCap && finalBatchResult && !finalBatchResult.completed && !latestState.lastError) {
      const detail = [
        `Scheduled call-activity sync paused after runtime cap (${runtimeCapMs}ms).`,
        `Elapsed: ${elapsedMs}ms.`,
        `Attempted batches: ${attempts}.`,
        `Remaining jobs: ${finalBatchResult.remainingCount}.`,
        `Confirmed through: ${confirmedDateKey ?? "unknown"}.`,
      ].join(" ");
      const run = writeScheduledJobRun({
        jobName: "call_activity_sync",
        windowKey: targetDateKey,
        status: "running",
        detail,
      });
      return NextResponse.json(
        {
          ok: true,
          status: "deferred",
          targetDateKey,
          detail,
          runtime: {
            capMs: runtimeCapMs,
            elapsedMs,
          },
          scheduledRun: run,
          importState: latestState,
          refreshState: importState,
          finalBatchResult,
        },
        { status: 202 },
      );
    }

    if (!complete) {
      const detail = [
        `Scheduled call-activity sync did not complete for ${targetDateKey}.`,
        `Confirmed through: ${confirmedDateKey ?? "unknown"}.`,
        `Remaining jobs: ${finalBatchResult?.remainingCount ?? "unknown"}.`,
        `Elapsed: ${elapsedMs}ms (cap ${runtimeCapMs}ms).`,
        hitRuntimeCap ? "Stopped due to runtime cap." : null,
        `Latest seen call: ${latestState.latestSeenStartTime ?? "unknown"}.`,
        latestState.lastError ? `Last error: ${latestState.lastError}.` : null,
      ]
        .filter(Boolean)
        .join(" ");
      writeScheduledJobRun({
        jobName: "call_activity_sync",
        windowKey: targetDateKey,
        status: "failed",
        detail,
      });
      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          targetDateKey,
          detail,
          importState: latestState,
          refreshState: importState,
          finalBatchResult,
        },
        { status: 500 },
      );
    }

    const detail = [
      `Scheduled call-activity sync completed for ${targetDateKey}.`,
      `Confirmed through: ${confirmedDateKey}.`,
      `Remaining jobs: ${finalBatchResult?.remainingCount ?? 0}.`,
    ].join(" ");
    const run = writeScheduledJobRun({
      jobName: "call_activity_sync",
      windowKey: targetDateKey,
      status: "completed",
      detail,
    });

    return NextResponse.json({
      ok: true,
      status: "completed",
      targetDateKey,
      detail,
      scheduledRun: run,
      importState: latestState,
      refreshState: importState,
      finalBatchResult,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
