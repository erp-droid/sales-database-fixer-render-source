#!/usr/bin/env node

import path from "node:path";

import dotenv from "dotenv";

type Options = {
  help: boolean;
  apply: boolean;
  limit: number | null;
  since: string | null;
  before: string | null;
  sessionIds: string[];
  concurrency: number;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    help: false,
    apply: false,
    limit: null,
    since: null,
    before: null,
    sessionIds: [],
    concurrency: 8,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[index + 1];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      options.limit = parsed;
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
    if (arg === "--before") {
      const raw = argv[index + 1]?.trim();
      if (!raw || Number.isNaN(Date.parse(raw))) {
        throw new Error("--before must be an ISO date or datetime.");
      }
      options.before = new Date(raw).toISOString();
      index += 1;
      continue;
    }
    if (arg === "--concurrency") {
      const raw = argv[index + 1];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 32) {
        throw new Error("--concurrency must be an integer between 1 and 32.");
      }
      options.concurrency = parsed;
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(
    [
      "Usage:",
      "  npm run backfill:call-summaries -- [--apply] [--limit N] [--since ISO] [--before ISO] [--session-id ID] [--concurrency N]",
      "",
      "Behavior:",
      "  - dry-run by default",
      "  - targets answered calls that have ended but do not yet have both transcript and summary stored",
      "  - with --apply, queues and processes each missing call until the summary path completes or stalls",
      "  - apply mode defaults to 8 concurrent workers",
    ].join("\n"),
  );
}

function loadLocalEnv(rootDir: string): void {
  dotenv.config({ path: path.join(rootDir, ".env.local"), override: false });
  dotenv.config({ path: path.join(rootDir, ".env"), override: false });
}

function hasSummaryContent(
  record:
    | {
        transcriptText: string | null;
        summaryText: string | null;
      }
    | null
    | undefined,
): boolean {
  return Boolean(record?.transcriptText?.trim() && record.summaryText?.trim());
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const rootDir = process.cwd();
  loadLocalEnv(rootDir);

  const [{ readCallSessions }, { readCallActivitySyncBySessionId }, { ensureCallActivitySyncQueuedForSession }] =
    await Promise.all([
      import("../src/lib/call-analytics/sessionize"),
      import("../src/lib/call-analytics/postcall-store"),
      import("../src/lib/call-analytics/postcall-worker"),
    ]);

  const sinceMs = options.since ? Date.parse(options.since) : null;
  const beforeMs = options.before ? Date.parse(options.before) : null;
  const sessionIdFilter = new Set(options.sessionIds);

  const candidates = readCallSessions()
    .filter((session) => {
      if (!session.answered || !session.endedAt || session.outcome === "in_progress") {
        return false;
      }
      if (sessionIdFilter.size > 0 && !sessionIdFilter.has(session.sessionId)) {
        return false;
      }

      const sessionMs = Date.parse(session.startedAt ?? session.endedAt ?? session.updatedAt);
      if (sinceMs !== null && (!Number.isFinite(sessionMs) || sessionMs < sinceMs)) {
        return false;
      }
      if (beforeMs !== null && (!Number.isFinite(sessionMs) || sessionMs >= beforeMs)) {
        return false;
      }

      return !hasSummaryContent(readCallActivitySyncBySessionId(session.sessionId));
    })
    .sort((left, right) => {
      const leftMs = Date.parse(left.startedAt ?? left.endedAt ?? left.updatedAt);
      const rightMs = Date.parse(right.startedAt ?? right.endedAt ?? right.updatedAt);
      return leftMs - rightMs;
    });

  const limitedCandidates =
    options.limit === null ? candidates : candidates.slice(0, options.limit);

  console.log("[backfill-call-summaries] start", {
    mode: options.apply ? "apply" : "dry-run",
    candidateCount: limitedCandidates.length,
    since: options.since,
    before: options.before,
    sessionIds: options.sessionIds.length,
    concurrency: options.concurrency,
  });

  if (!options.apply) {
    console.table(
      limitedCandidates.slice(0, 20).map((session) => ({
        sessionId: session.sessionId,
        source: session.source,
        employee: session.employeeLoginName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        company: session.matchedCompanyName,
        contact: session.matchedContactName,
      })),
    );
    return;
  }

  const summary = {
    processed: 0,
    synced: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
  };

  let nextIndex = 0;
  let progressLogged = 0;

  const processOne = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= limitedCandidates.length) {
        return;
      }
      nextIndex += 1;
      const session = limitedCandidates[currentIndex];
      if (!session) {
        return;
      }

      if (currentIndex === 0 || currentIndex + 1 >= progressLogged + 10) {
        progressLogged = currentIndex + 1;
        console.log("[backfill-call-summaries] progress", {
          current: currentIndex + 1,
          total: limitedCandidates.length,
          sessionId: session.sessionId,
        });
      }

      const result = await ensureCallActivitySyncQueuedForSession(session.sessionId);
      summary.processed += 1;
      if (result?.status === "synced") {
        summary.synced += 1;
      } else if (result?.status === "queued" || result?.status === "processing") {
        summary.queued += 1;
      } else if (result?.status === "skipped") {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
      }
    }
  };

  const workerCount = Math.min(options.concurrency, Math.max(1, limitedCandidates.length));
  await Promise.all(Array.from({ length: workerCount }, () => processOne()));

  console.log("[backfill-call-summaries] complete", summary);
}

main().catch((error) => {
  console.error("[backfill-call-summaries] failed", error);
  process.exitCode = 1;
});
