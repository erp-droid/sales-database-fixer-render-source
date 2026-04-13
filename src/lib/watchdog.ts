/**
 * Watchdog agent monitors call-activity sync failures and retries safe repairs.
 */

import {
  markCallActivitySyncFailed,
  markCallActivitySyncSkipped,
  requeueCallActivitySyncJob,
} from "@/lib/call-analytics/postcall-store";
import {
  processCallActivitySyncJob,
  resolveActivityTarget,
} from "@/lib/call-analytics/postcall-worker";
import { readCallSessionById } from "@/lib/call-analytics/sessionize";
import { readCallIngestState, reconcileTwilioSession } from "@/lib/call-analytics/ingest";
import { getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";
import { clearCachedServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import {
  buildDailyCallCoachingCoverage,
  pickSubjectLogins,
} from "@/lib/daily-call-coaching";
import { getEnv } from "@/lib/env";
import { sendWatchdogNotification } from "@/lib/watchdog-notify";

// ── Types ──────────────────────────────────────────────────────────────

export type WatchdogAction = {
  sessionId: string;
  issue: string;
  action: string;
  result: "fixed" | "skipped" | "requeued" | "failed";
  detail: string;
  notificationKey?: string | null;
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

let watchdogRunPromise: Promise<WatchdogReport> | null = null;

// ── Helpers ────────────────────────────────────────────────────────────

function ageMs(isoTimestamp: string | null | undefined): number {
  if (!isoTimestamp) return Infinity;
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) return Infinity;
  return Date.now() - parsed;
}

function readLocalDateParts(date: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} | null {
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const readPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = readPart("year");
  const month = readPart("month");
  const day = readPart("day");
  const hour = readPart("hour");
  const minute = readPart("minute");
  if (!year || !month || !day || !hour || !minute) {
    return null;
  }

  return { year, month, day, hour, minute };
}

function formatLocalDateKey(date: Date, timeZone: string): string | null {
  const parts = readLocalDateParts(date, timeZone);
  if (!parts) {
    return null;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(dateKey: string, offsetDays: number, timeZone: string): string | null {
  const [year, month, day] = String(dateKey)
    .split("-")
    .map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) {
    return null;
  }

  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0));
  return formatLocalDateKey(shifted, timeZone);
}

function readDailyCallCoachingDeliveryStats(reportDate: string): {
  totalRows: number;
  sentRows: number;
  latestStatus: string | null;
  latestSentAt: string | null;
  latestUpdatedAt: string | null;
} {
  const db = getReadModelDb();
  const aggregate = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_rows
      FROM daily_call_coaching_reports
      WHERE report_date = ?
        AND preview_mode = 0
      `,
    )
    .get(reportDate) as
    | {
        total_rows: number | null;
        sent_rows: number | null;
      }
    | undefined;

  const latest = db
    .prepare(
      `
      SELECT
        status,
        sent_at,
        updated_at
      FROM daily_call_coaching_reports
      WHERE report_date = ?
        AND preview_mode = 0
      ORDER BY COALESCE(sent_at, updated_at, created_at) DESC
      LIMIT 1
      `,
    )
    .get(reportDate) as
    | {
        status: string | null;
        sent_at: string | null;
        updated_at: string | null;
      }
    | undefined;

  return {
    totalRows: aggregate?.total_rows ?? 0,
    sentRows: aggregate?.sent_rows ?? 0,
    latestStatus: latest?.status ?? null,
    latestSentAt: latest?.sent_at ?? null,
    latestUpdatedAt: latest?.updated_at ?? null,
  };
}

function buildDailyCallCoachingHealthAction(now: Date): WatchdogAction | null {
  const env = getEnv();
  if (!env.DAILY_CALL_COACHING_ENABLED) {
    return null;
  }

  const timeZone = env.DAILY_CALL_COACHING_TIME_ZONE;
  const currentDateKey = formatLocalDateKey(now, timeZone);
  const localParts = readLocalDateParts(now, timeZone);
  if (!currentDateKey || !localParts) {
    return {
      sessionId: "daily-call-coaching",
      issue: "coaching_schedule_unresolved",
      action: "alert",
      result: "failed",
      detail: "Watchdog could not resolve the local coaching schedule window.",
      notificationKey: "daily-call-coaching:schedule-unresolved",
    };
  }

  const localHour = Number.parseInt(localParts.hour, 10);
  const localMinute = Number.parseInt(localParts.minute, 10);
  const scheduleReady =
    Number.isFinite(localHour) &&
    Number.isFinite(localMinute) &&
    (localHour > env.DAILY_CALL_COACHING_SCHEDULE_HOUR ||
      (localHour === env.DAILY_CALL_COACHING_SCHEDULE_HOUR &&
        localMinute >= env.DAILY_CALL_COACHING_SCHEDULE_MINUTE));

  const reportDate = shiftDateKey(
    currentDateKey,
    -env.DAILY_CALL_COACHING_LOOKBACK_DAYS,
    timeZone,
  );
  if (!reportDate) {
    return {
      sessionId: "daily-call-coaching",
      issue: "coaching_report_date_unresolved",
      action: "alert",
      result: "failed",
      detail: "Watchdog could not resolve the expected coaching report date.",
      notificationKey: "daily-call-coaching:report-date-unresolved",
    };
  }

  const coverage = buildDailyCallCoachingCoverage(reportDate, timeZone, readCallIngestState());
  if (!coverage.complete) {
    return {
      sessionId: `daily-call-coaching:${reportDate}`,
      issue: coverage.status,
      action: "alert",
      result: "failed",
      detail: [
        `Daily coaching is blocked for ${reportDate}.`,
        coverage.detail,
        `Confirmed through: ${coverage.confirmedThroughDate ?? "unknown"}.`,
        `Latest seen call: ${coverage.snapshotLatestSeenStartTime ?? "unknown"}.`,
        `Remaining post-call jobs: ${coverage.remainingCallSyncCount}.`,
        `Stale day gap: ${coverage.staleDays ?? 0}.`,
      ].join(" "),
      notificationKey: `daily-call-coaching:block:${coverage.status}:${reportDate}`,
    };
  }

  if (!scheduleReady) {
    return null;
  }

  const expectedRecipients = pickSubjectLogins(reportDate, timeZone);
  if (expectedRecipients.length === 0) {
    return null;
  }

  const delivery = readDailyCallCoachingDeliveryStats(reportDate);
  if (
    delivery.totalRows >= expectedRecipients.length &&
    delivery.sentRows >= expectedRecipients.length
  ) {
    return null;
  }

  return {
    sessionId: `daily-call-coaching:${reportDate}`,
    issue: "missing_live_send",
    action: "alert",
    result: "failed",
    detail: [
      `Expected ${expectedRecipients.length} live coaching email(s) for ${reportDate}.`,
      `Found ${delivery.sentRows} sent row(s) across ${delivery.totalRows} live report row(s).`,
      `Last row status: ${delivery.latestStatus ?? "none"}.`,
      `Last row sent at: ${delivery.latestSentAt ?? "never"}.`,
      `Last row updated at: ${delivery.latestUpdatedAt ?? "never"}.`,
    ].join(" "),
    notificationKey: `daily-call-coaching:missing-live-send:${reportDate}:${delivery.latestStatus ?? "none"}`,
  };
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
        AND (COALESCE(transcript_text, '') = '' OR COALESCE(summary_text, '') = '')
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

async function runWatchdogCycle(): Promise<WatchdogReport> {
  const startMs = Date.now();
  const actions: WatchdogAction[] = [];

  const jobs = listAllTroubleSyncJobs();
  const coachingHealthEnabled = getEnv().DAILY_CALL_COACHING_ENABLED;
  const coachingHealthAction = coachingHealthEnabled
    ? buildDailyCallCoachingHealthAction(new Date())
    : null;

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

  if (coachingHealthAction) {
    actions.push(coachingHealthAction);
  }

  const durationMs = Date.now() - startMs;
  const fixed = actions.filter((a) => a.result === "fixed").length;
  const failed = actions.filter((a) => a.result === "failed").length;

  const report: WatchdogReport = {
    ranAt: new Date().toISOString(),
    durationMs,
    checked: jobs.length + (coachingHealthEnabled ? 1 : 0),
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

export async function runWatchdog(): Promise<WatchdogReport> {
  if (watchdogRunPromise) {
    return watchdogRunPromise;
  }

  watchdogRunPromise = runWatchdogCycle().finally(() => {
    watchdogRunPromise = null;
  });

  return watchdogRunPromise;
}
