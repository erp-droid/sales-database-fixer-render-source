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

type DeliveryEvidenceItem = {
  subjectLoginName: string;
  recipientEmail: string;
  status: "sent" | "skipped" | "failed";
  detail: string;
  idempotencyKey: string;
  deduped: boolean;
  requiredCcEmail: string;
  ccConfirmed: boolean;
  ccConfirmationDetail: "cc_header" | "primary_recipient" | "not_sent";
  ccRecipients: string[];
};

type DeliveryEvidence = {
  reportDate: string;
  recipientsTargeted: string[];
  deliveredCount: number;
  dedupedCount: number;
  skippedCount: number;
  failedCount: number;
  ccRequiredEmail: string | null;
  ccConfirmedCount: number;
  ccMissingCount: number;
  ccMissingRecipients: Array<{
    recipientEmail: string;
    subjectLoginName: string;
    idempotencyKey: string;
    detail: string;
  }>;
  errors: Array<{
    recipientEmail: string;
    subjectLoginName: string;
    idempotencyKey: string;
    detail: string;
  }>;
  items: DeliveryEvidenceItem[];
};

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

function readRuntimeEnv(name: string): string {
  const runtimeProcess = globalThis.process as NodeJS.Process | undefined;
  return String(runtimeProcess?.env?.[name] ?? "").trim();
}

function hasValidSecret(request: NextRequest): boolean {
  const secret = readRuntimeEnv("DAILY_CALL_COACHING_SECRET");
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

function buildDailyCoachIdempotencyKey(reportDate: string, recipientEmail: string): string {
  return `daily-coach:${reportDate}:${recipientEmail.trim().toLowerCase()}`;
}

function isDedupedItem(detail: string): boolean {
  return (
    /Already sent for this date and recipient\./i.test(detail) ||
    /Already processed for this date and recipient\./i.test(detail)
  );
}

function buildDeliveryEvidence(input: {
  reportDate: string;
  recipientsTargeted: string[];
  items: Array<{
    subjectLoginName: string;
    recipientEmail: string;
    status: "sent" | "skipped" | "failed";
    detail: string;
    requiredCcEmail: string;
    ccConfirmed: boolean;
    ccConfirmationDetail: "cc_header" | "primary_recipient" | "not_sent";
    ccRecipients: string[];
  }>;
}): DeliveryEvidence {
  const items: DeliveryEvidenceItem[] = input.items.map((item) => ({
    subjectLoginName: item.subjectLoginName,
    recipientEmail: item.recipientEmail,
    status: item.status,
    detail: item.detail,
    idempotencyKey: buildDailyCoachIdempotencyKey(input.reportDate, item.recipientEmail),
    deduped: item.status === "skipped" ? isDedupedItem(item.detail) : false,
    requiredCcEmail: item.requiredCcEmail.trim().toLowerCase(),
    ccConfirmed: item.status === "sent" ? item.ccConfirmed : false,
    ccConfirmationDetail: item.status === "sent" ? item.ccConfirmationDetail : "not_sent",
    ccRecipients: item.ccRecipients.map((email) => email.trim().toLowerCase()).filter(Boolean),
  }));
  const sentItems = items.filter((item) => item.status === "sent");
  const ccMissingRecipients = sentItems
    .filter((item) => !item.ccConfirmed)
    .map((item) => ({
      recipientEmail: item.recipientEmail,
      subjectLoginName: item.subjectLoginName,
      idempotencyKey: item.idempotencyKey,
      detail: item.detail,
    }));

  return {
    reportDate: input.reportDate,
    recipientsTargeted: input.recipientsTargeted,
    deliveredCount: sentItems.length,
    dedupedCount: items.filter((item) => item.deduped).length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    failedCount: items.filter((item) => item.status === "failed").length,
    ccRequiredEmail: items[0]?.requiredCcEmail ?? null,
    ccConfirmedCount: sentItems.filter((item) => item.ccConfirmed).length,
    ccMissingCount: ccMissingRecipients.length,
    ccMissingRecipients,
    errors: items
      .filter((item) => item.status === "failed")
      .map((item) => ({
        recipientEmail: item.recipientEmail,
        subjectLoginName: item.subjectLoginName,
        idempotencyKey: item.idempotencyKey,
        detail: item.detail,
      })),
    items,
  };
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

    const finalizedImport = force ? null : readScheduledJobRun("call_activity_sync", resolved.reportDate);

    writeScheduledJobRun({
      jobName: "daily_call_coaching",
      windowKey: resolved.reportDate,
      status: "running",
      detail: "Scheduled daily coaching started.",
    });

    const result = await runDailyCallCoaching({
      reportDate: resolved.reportDate,
      retryFailedOnly: true,
    });

    const expectedLogins = pickSubjectLogins(resolved.reportDate, timeZone);
    const uniqueRecipients = new Set(
      result.items.map((item) => item.recipientEmail.trim().toLowerCase()).filter(Boolean),
    );
    const evidence = buildDeliveryEvidence({
      reportDate: resolved.reportDate,
      recipientsTargeted: expectedLogins,
      items: result.items.map((item) => ({
        subjectLoginName: item.subjectLoginName,
        recipientEmail: item.recipientEmail,
        status: item.status,
        detail: item.detail,
        requiredCcEmail: item.requiredCcEmail,
        ccConfirmed: item.ccConfirmed,
        ccConfirmationDetail: item.ccConfirmationDetail,
        ccRecipients: item.ccRecipients,
      })),
    });
    const failedItems = evidence.items.filter((item) => item.status === "failed");
    const suppressedRetryItems = evidence.items.filter(
      (item) => item.status === "skipped" && /Automatic retry is suppressed/i.test(item.detail),
    );
    const missingCcItems = evidence.items.filter(
      (item) => item.status === "sent" && !item.ccConfirmed,
    );
    const hasBlockingCoverage =
      result.dataCoverage.status === "call_import_missing" ||
      result.dataCoverage.status === "call_import_error" ||
      result.dataCoverage.status === "call_import_stale";
    const hasCoverageWarning = !result.dataCoverage.complete && !hasBlockingCoverage;

    if (
      hasBlockingCoverage ||
      failedItems.length > 0 ||
      missingCcItems.length > 0
    ) {
      const detail = [
        `Scheduled daily coaching failed for ${resolved.reportDate}.`,
        `Coverage status: ${result.dataCoverage.status}.`,
        result.dataCoverage.detail,
        failedItems.length > 0
          ? `Failed recipients: ${failedItems.map((item) => item.recipientEmail).join(", ")}.`
          : null,
        `Delivered: ${evidence.deliveredCount}.`,
        `Deduped: ${evidence.dedupedCount}.`,
        `CC confirmed: ${evidence.ccConfirmedCount}.`,
        suppressedRetryItems.length > 0
          ? `Suppressed retries: ${suppressedRetryItems.map((item) => item.recipientEmail).join(", ")}.`
          : null,
        missingCcItems.length > 0
          ? `Required CC missing for: ${missingCcItems.map((item) => item.recipientEmail).join(", ")}.`
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
          evidence,
          remediationSteps: [
            `Inspect failed recipients using evidence.items/idempotency keys for ${resolved.reportDate}.`,
            `Run npm run recover:daily-call-coaching -- --report-date ${resolved.reportDate} to rebuild and preview reports before retry.`,
            `Confirm required CC (${evidence.ccRequiredEmail ?? "jserrano@meadowb.com"}) on all delivered messages before rerun.`,
            `Rerun POST /api/scheduled/daily-call-coaching/run?reportDate=${resolved.reportDate}&force=1 once failures are resolved.`,
          ],
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
        `Delivered: ${evidence.deliveredCount}.`,
        `Deduped: ${evidence.dedupedCount}.`,
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
          evidence,
          remediationSteps: [
            `Compare recipientsTargeted vs evidence.items for ${resolved.reportDate} and correct any roster mismatch.`,
            `Rerun POST /api/scheduled/daily-call-coaching/run?reportDate=${resolved.reportDate}&force=1 after roster correction.`,
          ],
          result,
          expectedLogins,
        },
        { status: 500 },
      );
    }

    const warnings: string[] = [];
    if (!force && finalizedImport?.status !== "completed") {
      warnings.push(
        `Call-activity finalization status is ${finalizedImport?.status ?? "missing"}; coaching ran with available data fallback.`,
      );
    }
    if (hasCoverageWarning) {
      warnings.push(`Coverage is ${result.dataCoverage.status}: ${result.dataCoverage.detail}`);
    }
    if (suppressedRetryItems.length > 0) {
      warnings.push(
        `Suppressed retries (not resent): ${suppressedRetryItems.map((item) => item.recipientEmail).join(", ")}.`,
      );
    }

    const detail = [
      `Scheduled daily coaching completed for ${resolved.reportDate}.`,
      `Expected reps: ${expectedLogins.length}.`,
      `Sent: ${evidence.deliveredCount}.`,
      `Deduped: ${evidence.dedupedCount}.`,
      `Skipped: ${evidence.skippedCount}.`,
      `Failed: ${evidence.failedCount}.`,
      `CC confirmed: ${evidence.ccConfirmedCount}.`,
      warnings.length > 0 ? `Warnings: ${warnings.join(" ")}` : null,
    ].join(" ");
    const run = writeScheduledJobRun({
      jobName: "daily_call_coaching",
      windowKey: resolved.reportDate,
      status: "completed",
      detail,
    });

    return NextResponse.json({
      ok: true,
      status: warnings.length > 0 ? "completed_with_warnings" : "completed",
      reportDate: resolved.reportDate,
      detail,
      scheduledRun: run,
      evidence,
      warnings,
      prerequisite: {
        callActivityFinalization: finalizedImport,
      },
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
