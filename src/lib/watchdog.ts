/**
 * Watchdog agent — monitors the app for errors and auto-fixes them.
 *
 * Triggers:
 *   1. Failed call-activity sync jobs (recording, transcription, Acumatica post failures)
 *   2. Stuck "waiting_for_recording" jobs that have been waiting too long
 *   3. Failed business-account saves (snapshot validation, legacy data)
 *   4. Acumatica session/auth failures
 *
 * Does NOT run on a timer — it runs on demand via POST /api/watchdog/run
 * and should be called by an external cron (Render cron job, etc).
 */

import {
  listPendingCallActivitySyncJobs,
  markCallActivitySyncFailed,
  markCallActivitySyncSkipped,
  readCallActivitySyncBySessionId,
  requeueCallActivitySyncJob,
} from "@/lib/call-analytics/postcall-store";
import {
  processCallActivitySyncJob,
  resolveActivityTarget,
} from "@/lib/call-analytics/postcall-worker";
import {
  readCallSessionById,
  readCallLegsBySessionId,
} from "@/lib/call-analytics/sessionize";
import { reconcileTwilioSession } from "@/lib/call-analytics/ingest";
import { getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";
import { clearCachedServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { sendWatchdogNotification } from "@/lib/watchdog-notify";

// ── Types ──────────────────────────────────────────────────────────────

export type WatchdogAction = {
  sessionId: string;
  issue: string;
  action: string;
  result: "fixed" | "skipped" | "requeued" | "failed";
  detail: string;
};

export type WatchdogReport = {
  ranAt: string;
  durationMs: number;
  checked: number;
  actions: WatchdogAction[];
  healthy: boolean;
};

// ── Constants ──────────────────────────────────────────────────────────

/** If a job has been in "queued" with a waiting_for_recording error for longer than this, act on it. */
const STUCK_RECORDING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** Max age for a failed job before we skip it permanently (stale). */
const STALE_FAILURE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

/** Max retry attempts before the watchdog gives up and marks the job as permanently failed. */
const MAX_WATCHDOG_RETRY_ATTEMPTS = 5;

// ── Helpers ────────────────────────────────────────────────────────────

function ageMs(isoTimestamp: string | null | undefined): number {
  if (!isoTimestamp) return Infinity;
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) return Infinity;
  return Date.now() - parsed;
}

function listAllTroubleSyncJobs(): Array<{
  sessionId: string;
  status: string;
  attempts: number;
  error: string | null;
  updatedAt: string;
  recordingSid: string | null;
}> {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        session_id,
        status,
        attempts,
        error_message,
        updated_at,
        recording_sid
      FROM call_activity_sync
      WHERE status IN ('queued', 'failed', 'transcribed')
      ORDER BY updated_at ASC
      LIMIT 100
      `,
    )
    .all() as Array<{
    session_id: string;
    status: string;
    attempts: number;
    error_message: string | null;
    updated_at: string;
    recording_sid: string | null;
  }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    status: row.status,
    attempts: row.attempts,
    error: row.error_message,
    updatedAt: row.updated_at,
    recordingSid: row.recording_sid,
  }));
}

// ── Diagnosis & Repair ─────────────────────────────────────────────────

async function diagnoseAndRepairJob(job: {
  sessionId: string;
  status: string;
  attempts: number;
  error: string | null;
  updatedAt: string;
  recordingSid: string | null;
}): Promise<WatchdogAction | null> {
  const { sessionId, status, attempts, error, updatedAt } = job;
  const age = ageMs(updatedAt);

  // ── 1. Permanently stale jobs: skip them ─────────────────────────
  if (age > STALE_FAILURE_THRESHOLD_MS && status === "failed") {
    markCallActivitySyncSkipped(sessionId, `Watchdog: skipped stale failure after ${Math.round(age / 3600000)}h.`);
    return {
      sessionId,
      issue: "stale_failure",
      action: "skip",
      result: "skipped",
      detail: `Job failed ${Math.round(age / 3600000)}h ago. Marked as skipped.`,
    };
  }

  // ── 2. Too many retries: give up ─────────────────────────────────
  if (attempts >= MAX_WATCHDOG_RETRY_ATTEMPTS) {
    markCallActivitySyncFailed(
      sessionId,
      `Watchdog: exceeded ${MAX_WATCHDOG_RETRY_ATTEMPTS} attempts. Last error: ${error ?? "unknown"}`,
    );
    return {
      sessionId,
      issue: "max_retries",
      action: "fail_permanently",
      result: "failed",
      detail: `Gave up after ${attempts} attempts. Last error: ${error ?? "unknown"}`,
    };
  }

  // ── 3. Stuck waiting for recording ───────────────────────────────
  const isStuckRecording =
    status === "queued" &&
    typeof error === "string" &&
    error.toLowerCase().includes("waiting for the call recording");

  if (isStuckRecording && age > STUCK_RECORDING_THRESHOLD_MS) {
    // Check if the session actually has a completed destination leg
    const session = readCallSessionById(sessionId);
    if (!session) {
      markCallActivitySyncSkipped(sessionId, "Watchdog: session no longer exists.");
      return {
        sessionId,
        issue: "stuck_recording_no_session",
        action: "skip",
        result: "skipped",
        detail: "Session not found. Skipped.",
      };
    }

    // Try to reconcile from Twilio to get the latest state
    try {
      await reconcileTwilioSession(sessionId);
    } catch {
      // Not critical — continue with what we have
    }

    const refreshedSession = readCallSessionById(sessionId);
    if (refreshedSession && !refreshedSession.answered) {
      markCallActivitySyncSkipped(sessionId, "Watchdog: call was not actually answered (destination leg never connected).");
      return {
        sessionId,
        issue: "stuck_recording_unanswered",
        action: "skip",
        result: "skipped",
        detail: "Destination leg never connected. Skipped.",
      };
    }

    // If answered but still no recording after 10+ min, try one more process cycle
    try {
      const result = await processCallActivitySyncJob(sessionId);
      if (result?.status === "synced") {
        return {
          sessionId,
          issue: "stuck_recording",
          action: "retry_process",
          result: "fixed",
          detail: `Recording found on retry. Activity ${result.activityId ?? "created"}.`,
        };
      }

      return {
        sessionId,
        issue: "stuck_recording",
        action: "retry_process",
        result: "requeued",
        detail: `Still waiting. Status: ${result?.status ?? "unknown"}. Will check again next cycle.`,
      };
    } catch (retryError) {
      return {
        sessionId,
        issue: "stuck_recording",
        action: "retry_process",
        result: "failed",
        detail: `Retry failed: ${getErrorMessage(retryError)}`,
      };
    }
  }

  // ── 4. Failed jobs: diagnose and retry ───────────────────────────
  if (status === "failed") {
    const errorLower = (error ?? "").toLowerCase();

    // Auth failures: clear cached session and retry
    if (errorLower.includes("401") || errorLower.includes("service login failed") || errorLower.includes("session")) {
      clearCachedServiceAcumaticaSession();
      requeueCallActivitySyncJob(sessionId, "Watchdog: cleared stale auth, requeued.");
      return {
        sessionId,
        issue: "auth_failure",
        action: "clear_auth_retry",
        result: "requeued",
        detail: "Cleared cached Acumatica session. Requeued for retry.",
      };
    }

    // OpenAI failures: retry (model fallbacks will kick in) — check before generic 500
    if (errorLower.includes("openai") || errorLower.includes("transcription") || errorLower.includes("summary")) {
      requeueCallActivitySyncJob(sessionId, `Watchdog: retrying OpenAI failure (attempt ${attempts + 1}).`);
      return {
        sessionId,
        issue: "openai_failure",
        action: "requeue",
        result: "requeued",
        detail: `OpenAI error: ${error}. Requeued — model fallback chain will try alternatives.`,
      };
    }

    // Acumatica 500 or rate limit: just retry
    if (errorLower.includes("500") || errorLower.includes("429") || errorLower.includes("rate")) {
      requeueCallActivitySyncJob(sessionId, `Watchdog: retrying after transient error (attempt ${attempts + 1}).`);
      return {
        sessionId,
        issue: "transient_acumatica_error",
        action: "requeue",
        result: "requeued",
        detail: `Transient error (${error}). Requeued for retry.`,
      };
    }

    // No target contact/account: check if we can resolve now
    if (errorLower.includes("no related contact") || errorLower.includes("no_target")) {
      const session = readCallSessionById(sessionId);
      if (session) {
        try {
          const target = await resolveActivityTarget(session);
          if (target) {
            requeueCallActivitySyncJob(sessionId, "Watchdog: target now resolvable, requeued.");
            return {
              sessionId,
              issue: "no_target_resolved",
              action: "requeue",
              result: "requeued",
              detail: `Target now resolvable (${target.relatedEntityType}). Requeued.`,
            };
          }
        } catch {
          // Can't resolve — leave as failed
        }
      }

      return {
        sessionId,
        issue: "no_target",
        action: "no_action",
        result: "failed",
        detail: `Still cannot resolve a target. Original error: ${error}`,
      };
    }

    // Generic failed job: retry once
    requeueCallActivitySyncJob(sessionId, `Watchdog: generic retry (attempt ${attempts + 1}).`);
    return {
      sessionId,
      issue: "generic_failure",
      action: "requeue",
      result: "requeued",
      detail: `Requeued. Error was: ${error}`,
    };
  }

  // ── 5. Transcribed but not yet synced: push it through ───────────
  if (status === "transcribed") {
    try {
      const result = await processCallActivitySyncJob(sessionId);
      if (result?.status === "synced") {
        return {
          sessionId,
          issue: "transcribed_not_synced",
          action: "process",
          result: "fixed",
          detail: `Pushed through to Acumatica. Activity ${result.activityId ?? "created"}.`,
        };
      }

      return {
        sessionId,
        issue: "transcribed_not_synced",
        action: "process",
        result: "requeued",
        detail: `Status after processing: ${result?.status ?? "unknown"}.`,
      };
    } catch (processError) {
      return {
        sessionId,
        issue: "transcribed_not_synced",
        action: "process",
        result: "failed",
        detail: `Processing failed: ${getErrorMessage(processError)}`,
      };
    }
  }

  // Queued jobs that aren't stuck on recording — just let the normal worker handle them
  return null;
}

// ── Main Entry Point ───────────────────────────────────────────────────

export async function runWatchdog(): Promise<WatchdogReport> {
  const startMs = Date.now();
  const actions: WatchdogAction[] = [];

  const jobs = listAllTroubleSyncJobs();

  for (const job of jobs) {
    try {
      const action = await diagnoseAndRepairJob(job);
      if (action) {
        actions.push(action);
      }
    } catch (error) {
      actions.push({
        sessionId: job.sessionId,
        issue: "watchdog_error",
        action: "diagnose",
        result: "failed",
        detail: `Watchdog itself errored: ${getErrorMessage(error)}`,
      });
    }
  }

  const durationMs = Date.now() - startMs;
  const fixed = actions.filter((a) => a.result === "fixed").length;
  const failed = actions.filter((a) => a.result === "failed").length;

  const report: WatchdogReport = {
    ranAt: new Date().toISOString(),
    durationMs,
    checked: jobs.length,
    actions,
    healthy: failed === 0,
  };

  // Send email notification if anything meaningful happened
  try {
    await sendWatchdogNotification(report);
  } catch {
    // Notification failure must never break the watchdog itself
  }

  return report;
}
