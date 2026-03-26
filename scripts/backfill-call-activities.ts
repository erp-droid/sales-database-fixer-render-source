#!/usr/bin/env node

import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Options = {
  apply: boolean;
  help: boolean;
  limit: number | null;
  employeeLoginNames: string[];
  sessionIds: string[];
  since: string | null;
  reportFile: string | null;
};

type ReportEntry = {
  sessionId: string;
  employeeLoginName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  matchedContactId: number | null;
  matchedBusinessAccountId: string | null;
  matchedContactName: string | null;
  matchedCompanyName: string | null;
  action:
    | "would_enqueue"
    | "would_mark_existing"
    | "marked_existing"
    | "synced"
    | "queued"
    | "skipped"
    | "failed"
    | "unresolved_target"
    | "lookup_failed"
    | "manual_review_duplicate";
  syncStatus?: string | null;
  activityId?: string | null;
  duplicateCount?: number;
  duplicateReason?: string | null;
  error?: string | null;
};

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function loadLocalEnv(rootDir: string): void {
  const envValues = parseEnvFile(path.join(rootDir, ".env.local"));
  for (const [key, value] of Object.entries(envValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    help: false,
    limit: null,
    employeeLoginNames: [],
    sessionIds: [],
    since: null,
    reportFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[index + 1];
      const numeric = Number(raw);
      if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      options.limit = numeric;
      index += 1;
      continue;
    }
    if (arg === "--employee") {
      const raw = argv[index + 1]?.trim().toLowerCase();
      if (!raw) {
        throw new Error("--employee requires a value.");
      }
      options.employeeLoginNames.push(raw);
      index += 1;
      continue;
    }
    if (arg === "--session-id") {
      const raw = argv[index + 1]?.trim();
      if (!raw) {
        throw new Error("--session-id requires a value.");
      }
      options.sessionIds.push(raw);
      index += 1;
      continue;
    }
    if (arg === "--since") {
      const raw = argv[index + 1]?.trim();
      if (!raw || Number.isNaN(Date.parse(raw))) {
        throw new Error("--since must be an ISO date or datetime.");
      }
      options.since = new Date(raw).toISOString();
      index += 1;
      continue;
    }
    if (arg === "--report-file") {
      const raw = argv[index + 1]?.trim();
      if (!raw) {
        throw new Error("--report-file requires a value.");
      }
      options.reportFile = raw;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  npm run backfill:call-activities -- [--apply] [--limit N] [--employee LOGIN] [--session-id ID] [--since ISO] [--report-file path]",
      "",
      "Behavior:",
      "  - dry-run by default",
      "  - inspects answered app-bridge calls that are not locally marked as synced",
      "  - resolves the related Acumatica contact or account target for each call",
      "  - checks Acumatica for an existing phone activity before creating anything new",
      "  - with --apply, marks matched activities as synced locally or queues/replays the missing call sync",
      "  - writes a JSON report to data/call-activity-backfill-report.json by default",
      "",
    ].join("\n"),
  );
}

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeComparableText(value: string | null | undefined): string {
  return cleanText(value).replace(/\s+/g, " ").toLowerCase();
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const numeric = Date.parse(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return new Date(numeric).toISOString();
}

function toEpochMs(value: string | null | undefined): number | null {
  const iso = toIsoOrNull(value);
  if (!iso) {
    return null;
  }

  return Date.parse(iso);
}

function escapeODataStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function readActivityId(
  activity: Record<string, unknown>,
  readRecordIdentity: (record: unknown) => string | null,
  readWrappedString: (record: unknown, key: string) => string,
): string | null {
  return readRecordIdentity(activity) ?? (cleanText(readWrappedString(activity, "NoteID")) || null);
}

function readActivitySummary(
  activity: Record<string, unknown>,
  readWrappedString: (record: unknown, key: string) => string,
): string {
  return (
    cleanText(readWrappedString(activity, "Summary")) ||
    cleanText(readWrappedString(activity, "Subject"))
  );
}

function readActivityDate(
  activity: Record<string, unknown>,
  readWrappedScalarString: (record: unknown, key: string) => string,
): string | null {
  return (
    toIsoOrNull(readWrappedScalarString(activity, "Date")) ||
    toIsoOrNull(readWrappedScalarString(activity, "StartDate")) ||
    toIsoOrNull(readWrappedScalarString(activity, "CreatedDateTime"))
  );
}

function readActivityBody(
  activity: Record<string, unknown>,
  readWrappedString: (record: unknown, key: string) => string,
): string {
  return cleanText(readWrappedString(activity, "Body"));
}

function buildActivityFilter(noteId: string, phoneActivityType: string): string {
  const escapedNoteId = escapeODataStringLiteral(noteId);
  const escapedType = escapeODataStringLiteral(phoneActivityType);
  return `RelatedEntityNoteID eq guid'${escapedNoteId}' and Type eq '${escapedType}'`;
}

function buildFallbackActivityFilter(noteId: string): string {
  return `RelatedEntityNoteID eq guid'${escapeODataStringLiteral(noteId)}'`;
}

function buildBaseReportEntry(session: {
  sessionId: string;
  employeeLoginName: string | null;
  matchedContactId: number | null;
  matchedBusinessAccountId: string | null;
  matchedContactName: string | null;
  matchedCompanyName: string | null;
  startedAt: string | null;
  endedAt: string | null;
}): Omit<ReportEntry, "action"> {
  return {
    sessionId: session.sessionId,
    employeeLoginName: session.employeeLoginName,
    matchedContactId: session.matchedContactId,
    matchedBusinessAccountId: session.matchedBusinessAccountId,
    matchedContactName: session.matchedContactName,
    matchedCompanyName: session.matchedCompanyName,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const rootDir = process.cwd();
  loadLocalEnv(rootDir);

  const reportFile =
    options.reportFile ??
    path.join(rootDir, "data", "call-activity-backfill-report.json");

  const [
    { getEnv },
    { readWrappedScalarString, readWrappedString, readRecordIdentity },
    { serviceFetchActivities },
    { readCallSessions },
    {
      buildActivitySummary,
      ensureCallActivitySyncQueuedForSession,
      resolveActivityTarget,
    },
    {
      markCallActivitySyncSynced,
      readCallActivitySyncBySessionId,
      upsertQueuedCallActivitySync,
    },
  ] = await Promise.all([
    import("../src/lib/env"),
    import("../src/lib/acumatica"),
    import("../src/lib/acumatica-service-auth"),
    import("../src/lib/call-analytics/sessionize"),
    import("../src/lib/call-analytics/postcall-worker"),
    import("../src/lib/call-analytics/postcall-store"),
  ]);

  const env = getEnv();
  const phoneActivityType = env.ACUMATICA_PHONE_CALL_ACTIVITY_TYPE ?? "P";
  const sinceMs = options.since ? Date.parse(options.since) : null;

  const candidateSessions = readCallSessions()
    .filter((session) => {
      if (session.source !== "app_bridge" || !session.answered || !session.endedAt) {
        return false;
      }
      if (session.outcome === "in_progress") {
        return false;
      }
      if (
        options.employeeLoginNames.length > 0 &&
        !options.employeeLoginNames.includes(cleanText(session.employeeLoginName).toLowerCase())
      ) {
        return false;
      }
      if (options.sessionIds.length > 0 && !options.sessionIds.includes(session.sessionId)) {
        return false;
      }

      const sync = readCallActivitySyncBySessionId(session.sessionId);
      if (sync?.status === "synced" || sync?.status === "processing") {
        return false;
      }

      const sessionMs = toEpochMs(session.startedAt ?? session.endedAt ?? session.updatedAt);
      if (sinceMs !== null && (sessionMs === null || sessionMs < sinceMs)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftMs = toEpochMs(left.startedAt ?? left.endedAt ?? left.updatedAt) ?? 0;
      const rightMs = toEpochMs(right.startedAt ?? right.endedAt ?? right.updatedAt) ?? 0;
      return leftMs - rightMs;
    });

  const limitedSessions =
    options.limit === null ? candidateSessions : candidateSessions.slice(0, options.limit);

  const reportEntries: ReportEntry[] = [];
  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    candidateCount: limitedSessions.length,
    matchedExistingCount: 0,
    wouldMarkExistingCount: 0,
    unresolvedTargetCount: 0,
    wouldEnqueueCount: 0,
    syncedCount: 0,
    queuedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lookupFailedCount: 0,
    manualReviewCount: 0,
  };

  for (const [index, session] of limitedSessions.entries()) {
    if ((index + 1) % 10 === 0 || index === 0) {
      console.info("[call-activity-backfill]", {
        progress: `${index + 1}/${limitedSessions.length}`,
        sessionId: session.sessionId,
        employeeLoginName: session.employeeLoginName,
      });
    }

    const baseEntry = buildBaseReportEntry(session);
    const target = await resolveActivityTarget(session);
    if (!target) {
      reportEntries.push({
        ...baseEntry,
        action: "unresolved_target",
        error: "No related Acumatica contact or business account could be resolved.",
      });
      summary.unresolvedTargetCount += 1;
      continue;
    }

    let relatedActivities: Array<Record<string, unknown>>;
    try {
      relatedActivities = await serviceFetchActivities(session.employeeLoginName, {
        maxRecords: 100,
        batchSize: 100,
        filter: buildActivityFilter(target.relatedEntityNoteId, phoneActivityType),
      });
    } catch (error) {
      try {
        relatedActivities = await serviceFetchActivities(session.employeeLoginName, {
          maxRecords: 100,
          batchSize: 100,
          filter: buildFallbackActivityFilter(target.relatedEntityNoteId),
        });
      } catch (fallbackError) {
        reportEntries.push({
          ...baseEntry,
          action: "lookup_failed",
          error:
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        summary.lookupFailedCount += 1;
        continue;
      }
    }

    const expectedSummary = normalizeComparableText(buildActivitySummary(session));
    const sessionStartedMs =
      toEpochMs(session.startedAt) ??
      toEpochMs(session.endedAt) ??
      toEpochMs(session.updatedAt);

    const duplicateMatches = relatedActivities
      .map((activity) => {
        const activityId = readActivityId(activity, readRecordIdentity, readWrappedString);
        const activitySummary = normalizeComparableText(
          readActivitySummary(activity, readWrappedString),
        );
        const activityDateIso = readActivityDate(activity, readWrappedScalarString);
        const activityDateMs = toEpochMs(activityDateIso);
        const activityBody = readActivityBody(activity, readWrappedString);

        if (activityBody.includes(session.sessionId)) {
          return {
            activityId,
            reason: "session_id",
            timeDeltaMs:
              sessionStartedMs !== null && activityDateMs !== null
                ? Math.abs(activityDateMs - sessionStartedMs)
                : null,
          };
        }

        if (
          activityId &&
          activitySummary === expectedSummary &&
          sessionStartedMs !== null &&
          activityDateMs !== null &&
          Math.abs(activityDateMs - sessionStartedMs) <= 15 * 60 * 1000
        ) {
          return {
            activityId,
            reason: "summary_and_time",
            timeDeltaMs: Math.abs(activityDateMs - sessionStartedMs),
          };
        }

        return null;
      })
      .filter(
        (
          match,
        ): match is { activityId: string | null; reason: string; timeDeltaMs: number | null } =>
          match !== null,
      )
      .sort((left, right) => {
        const leftScore = left.reason === "session_id" ? -1 : left.timeDeltaMs ?? Number.MAX_SAFE_INTEGER;
        const rightScore =
          right.reason === "session_id" ? -1 : right.timeDeltaMs ?? Number.MAX_SAFE_INTEGER;
        return leftScore - rightScore;
      });

    const distinctDuplicateIds = [
      ...new Set(
        duplicateMatches.map((match) => match.activityId).filter((value): value is string => Boolean(value)),
      ),
    ];

    if (distinctDuplicateIds.length > 1) {
      reportEntries.push({
        ...baseEntry,
        action: "manual_review_duplicate",
        duplicateCount: distinctDuplicateIds.length,
        error: "Multiple plausible existing Acumatica activities were found for this call.",
      });
      summary.manualReviewCount += 1;
      continue;
    }

    const existingActivityId = distinctDuplicateIds[0] ?? null;
    if (existingActivityId) {
      if (options.apply) {
        upsertQueuedCallActivitySync({
          sessionId: session.sessionId,
          recordingSid: null,
          recordingStatus: null,
          recordingDurationSeconds: null,
        });
        markCallActivitySyncSynced(session.sessionId, {
          activityId: existingActivityId,
        });
      }

      reportEntries.push({
        ...baseEntry,
        action: options.apply ? "marked_existing" : "would_mark_existing",
        activityId: existingActivityId,
        duplicateCount: 1,
        duplicateReason: duplicateMatches[0]?.reason ?? null,
      });
      if (options.apply) {
        summary.matchedExistingCount += 1;
      } else {
        summary.wouldMarkExistingCount += 1;
      }
      continue;
    }

    if (!options.apply) {
      reportEntries.push({
        ...baseEntry,
        action: "would_enqueue",
      });
      summary.wouldEnqueueCount += 1;
      continue;
    }

    const result = await ensureCallActivitySyncQueuedForSession(session.sessionId);
    const action =
      result?.status === "synced"
        ? "synced"
        : result?.status === "queued"
          ? "queued"
          : result?.status === "skipped"
            ? "skipped"
            : "failed";

    reportEntries.push({
      ...baseEntry,
      action,
      syncStatus: result?.status ?? null,
      activityId: result?.activityId ?? null,
      error: result?.error ?? null,
    });

    if (action === "synced") {
      summary.syncedCount += 1;
    } else if (action === "queued") {
      summary.queuedCount += 1;
    } else if (action === "skipped") {
      summary.skippedCount += 1;
    } else {
      summary.failedCount += 1;
    }
  }

  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(
    reportFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        entries: reportEntries,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.info("[call-activity-backfill] complete", {
    reportFile,
    summary,
  });
}

main().catch((error) => {
  console.error("[call-activity-backfill] failed", error);
  process.exitCode = 1;
});
