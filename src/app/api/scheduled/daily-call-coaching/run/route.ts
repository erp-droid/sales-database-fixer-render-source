export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  pickSubjectLogins,
  runDailyCallCoaching,
} from "@/lib/daily-call-coaching";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  readScheduledJobRun,
  resolveScheduledDailyCallCoachingReportDate,
  writeScheduledJobRun,
} from "@/lib/scheduled-jobs";

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

function hasValidSecret(request: NextRequest): boolean {
  const secret = process.env.DAILY_CALL_COACHING_SECRET?.trim() ?? "";
  if (!secret) {
    return false;
  }

  const provided =
    request.headers.get("x-daily-call-coaching-secret") ??
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

function readOptionalReportDate(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get("reportDate")?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function readForceFlag(request: NextRequest): boolean {
  const raw = request.nextUrl.searchParams.get("force")?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureAuthorized(request);

    const timeZone = (process.env.DAILY_CALL_COACHING_TIME_ZONE || "America/Toronto").trim();
    const scheduleHour = readBoundedInteger(process.env.DAILY_CALL_COACHING_SCHEDULE_HOUR, 7, 0, 23);
    const scheduleMinute = readBoundedInteger(process.env.DAILY_CALL_COACHING_SCHEDULE_MINUTE, 0, 0, 59);
    const lookbackDays = readBoundedInteger(process.env.DAILY_CALL_COACHING_LOOKBACK_DAYS, 1, 1, 14);
    const explicitReportDate = readOptionalReportDate(request);
    const force = readForceFlag(request);
    const resolved = explicitReportDate
      ? {
          due: true,
          reportDate: explicitReportDate,
        }
      : resolveScheduledDailyCallCoachingReportDate(
          new Date(),
          timeZone,
          scheduleHour,
          scheduleMinute,
          lookbackDays,
        );

    if (!resolved.reportDate) {
      throw new HttpError(500, "Unable to resolve the scheduled coaching report date.");
    }

    if (!resolved.due && !force) {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        reportDate: resolved.reportDate,
        detail: "Scheduled daily coaching is not due yet for the local schedule window.",
      });
    }

    const existing = force ? null : readScheduledJobRun("daily_call_coaching", resolved.reportDate);
    if (existing?.status === "completed") {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        reportDate: resolved.reportDate,
        detail: "Scheduled daily coaching already completed for this report date.",
        existing,
      });
    }

    writeScheduledJobRun({
      jobName: "daily_call_coaching",
      windowKey: resolved.reportDate,
      status: "running",
      detail: "Scheduled daily coaching started.",
    });

    const result = await runDailyCallCoaching({
      reportDate: resolved.reportDate,
    });

    const expectedLogins = pickSubjectLogins(resolved.reportDate, timeZone);
    const uniqueRecipients = new Set(
      result.items.map((item) => item.recipientEmail.trim().toLowerCase()).filter(Boolean),
    );
    const failedItems = result.items.filter((item) => item.status === "failed");

    if (!result.dataCoverage.complete || failedItems.length > 0) {
      const detail = [
        `Scheduled daily coaching failed for ${resolved.reportDate}.`,
        `Coverage status: ${result.dataCoverage.status}.`,
        result.dataCoverage.detail,
        failedItems.length > 0
          ? `Failed recipients: ${failedItems.map((item) => item.recipientEmail).join(", ")}.`
          : null,
      ]
        .filter(Boolean)
        .join(" ");
      writeScheduledJobRun({
        jobName: "daily_call_coaching",
        windowKey: resolved.reportDate,
        status: "failed",
        detail,
      });
      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          reportDate: resolved.reportDate,
          detail,
          result,
        },
        { status: 500 },
      );
    }

    if (uniqueRecipients.size !== result.items.length || result.items.length !== expectedLogins.length) {
      const detail = [
        `Scheduled daily coaching produced an invalid delivery set for ${resolved.reportDate}.`,
        `Expected reps: ${expectedLogins.length}.`,
        `Reported items: ${result.items.length}.`,
        `Unique recipients: ${uniqueRecipients.size}.`,
      ].join(" ");
      writeScheduledJobRun({
        jobName: "daily_call_coaching",
        windowKey: resolved.reportDate,
        status: "failed",
        detail,
      });
      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          reportDate: resolved.reportDate,
          detail,
          result,
          expectedLogins,
        },
        { status: 500 },
      );
    }

    const detail = [
      `Scheduled daily coaching completed for ${resolved.reportDate}.`,
      `Expected reps: ${expectedLogins.length}.`,
      `Sent: ${result.items.filter((item) => item.status === "sent").length}.`,
      `Skipped: ${result.items.filter((item) => item.status === "skipped").length}.`,
    ].join(" ");
    const run = writeScheduledJobRun({
      jobName: "daily_call_coaching",
      windowKey: resolved.reportDate,
      status: "completed",
      detail,
    });

    return NextResponse.json({
      ok: true,
      status: "completed",
      reportDate: resolved.reportDate,
      detail,
      scheduledRun: run,
      expectedLogins,
      result,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
