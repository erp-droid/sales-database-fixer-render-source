#!/usr/bin/env -S npx tsx

import path from "node:path";

import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

type ScriptOptions = {
  reportDate: string | null;
  timeZone: string | null;
  previewLogin: string | null;
  previewRecipientLogin: string | null;
};

function readArgValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0) {
    return null;
  }

  return args[index + 1]?.trim() || null;
}

function hasArg(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function readLocalDateParts(date: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
} | null {
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const readPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = readPart("year");
  const month = readPart("month");
  const day = readPart("day");
  if (!year || !month || !day) {
    return null;
  }

  return { year, month, day };
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

function readOptions(): ScriptOptions {
  const args = process.argv.slice(2);
  if (hasArg(args, "--help")) {
    console.log(
      [
        "Usage:",
        "  npm run recover:daily-call-coaching -- [--report-date YYYY-MM-DD] [--time-zone America/Toronto]",
        "    [--preview-login repLogin] [--preview-recipient-login mailboxLogin]",
        "",
        "Behavior:",
        "  - refreshes call analytics using the service Acumatica session",
        "  - drains post-call sync jobs for the report date until complete or timed out",
        "  - prints the coaching coverage state for that report date",
        "  - optionally runs a forced preview for one rep; it never sends live backlog emails",
      ].join("\n"),
    );
    process.exit(0);
  }

  return {
    reportDate: readArgValue(args, "--report-date"),
    timeZone: readArgValue(args, "--time-zone"),
    previewLogin: readArgValue(args, "--preview-login"),
    previewRecipientLogin: readArgValue(args, "--preview-recipient-login"),
  };
}

async function main(): Promise<void> {
  const options = readOptions();
  const { getEnv } = await import("@/lib/env");
  const env = getEnv();
  const timeZone = options.timeZone ?? env.DAILY_CALL_COACHING_TIME_ZONE;
  const currentDateKey = formatLocalDateKey(new Date(), timeZone);
  const reportDate =
    options.reportDate ??
    (currentDateKey
      ? shiftDateKey(currentDateKey, -env.DAILY_CALL_COACHING_LOOKBACK_DAYS, timeZone)
      : null);

  if (!reportDate) {
    throw new Error("Unable to resolve the report date.");
  }

  const { withServiceAcumaticaSession, clearCachedServiceAcumaticaSession } = await import(
    "@/lib/acumatica-service-auth"
  );
  const { refreshCallAnalytics, readCallIngestState } = await import("@/lib/call-analytics/ingest");
  const { runDueCallActivitySyncJobs } = await import("@/lib/call-analytics/postcall-worker");
  const { buildDailyCallCoachingCoverage, runDailyCallCoaching } = await import(
    "@/lib/daily-call-coaching"
  );

  console.log("[recover-daily-call-coaching] start", {
    reportDate,
    timeZone,
    previewLogin: options.previewLogin,
    previewRecipientLogin: options.previewRecipientLogin ?? env.DAILY_CALL_COACHING_SENDER_LOGIN,
  });

  await withServiceAcumaticaSession(null, (cookieValue, authCookieRefresh) =>
    refreshCallAnalytics(cookieValue, authCookieRefresh, {
      forceEmployeeDirectoryRefresh: true,
      runPostcallSync: false,
    }),
  );

  console.log(
    "[recover-daily-call-coaching] import state after refresh",
    readCallIngestState(),
  );

  let attempts = 0;
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

  while (attempts < 200) {
    attempts += 1;
    const result = await runDueCallActivitySyncJobs(5, {
      localDateKey: reportDate,
      timeZone,
    });
    finalBatchResult = result;
    console.log("[recover-daily-call-coaching] post-call batch", {
      attempt: attempts,
      ...result,
    });
    if (result.completed) {
      break;
    }
  }

  if (!finalBatchResult?.completed) {
    throw new Error(
      `Post-call processing did not complete for ${reportDate}; remaining ${finalBatchResult?.remainingCount ?? "unknown"}.`,
    );
  }

  const coverage = buildDailyCallCoachingCoverage(reportDate, timeZone, readCallIngestState());
  console.log("[recover-daily-call-coaching] coverage", coverage);

  if (!options.previewLogin) {
    console.log(
      "[recover-daily-call-coaching] no preview login provided; stopping before any coaching email send",
    );
    clearCachedServiceAcumaticaSession();
    return;
  }

  const previewResult = await runDailyCallCoaching({
    reportDate,
    loginName: options.previewLogin,
    previewRecipientLoginName:
      options.previewRecipientLogin ?? env.DAILY_CALL_COACHING_SENDER_LOGIN,
    force: true,
  });

  console.log(
    "[recover-daily-call-coaching] preview result",
    JSON.stringify(
      {
        reportDate: previewResult.reportDate,
        senderLoginName: previewResult.senderLoginName,
        dataCoverage: previewResult.dataCoverage,
        items: previewResult.items,
      },
      null,
      2,
    ),
  );

  clearCachedServiceAcumaticaSession();
}

main().catch((error) => {
  console.error("[recover-daily-call-coaching] failed", error);
  process.exitCode = 1;
});
