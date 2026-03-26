export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  authenticateDashboardRefreshRequest,
  finalizeDashboardResponse,
} from "@/lib/call-analytics/request";
import { runDailyCallCoaching } from "@/lib/daily-call-coaching";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";

type DailyCallCoachingRouteAuth =
  | {
      kind: "internal";
    }
  | {
      kind: "dashboard";
      authCookieRefresh: { value: string | null };
    };

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

function hasValidDailyCallCoachingSecret(request: NextRequest): boolean {
  const secret = getEnv().DAILY_CALL_COACHING_SECRET;
  if (!secret) {
    return false;
  }

  const provided =
    request.headers.get("x-daily-call-coaching-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  return provided === secret;
}

async function authenticateDailyCallCoachingRequest(
  request: NextRequest,
): Promise<DailyCallCoachingRouteAuth> {
  if (isInternalHost(request) || hasValidDailyCallCoachingSecret(request)) {
    return { kind: "internal" };
  }

  const auth = await authenticateDashboardRefreshRequest(request);
  return {
    kind: "dashboard",
    authCookieRefresh: auth.authCookieRefresh,
  };
}

function finalizeDailyCallCoachingResponse(
  response: NextResponse,
  auth: DailyCallCoachingRouteAuth,
): NextResponse {
  if (auth.kind !== "dashboard") {
    return response;
  }

  return finalizeDashboardResponse(response, auth.authCookieRefresh);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateDailyCallCoachingRequest(request);
    const rows = getReadModelDb()
      .prepare(
        `
        SELECT
          report_date,
          subject_login_name,
          recipient_email,
          sender_login_name,
          status,
          preview_mode,
          session_count,
          analyzed_call_count,
          transcript_call_count,
          subject_line,
          error_message,
          sent_at,
          updated_at
        FROM daily_call_coaching_reports
        ORDER BY COALESCE(sent_at, updated_at) DESC
        LIMIT 25
        `,
      )
      .all();

    return finalizeDailyCallCoachingResponse(
      NextResponse.json({
        ok: true,
        items: rows,
      }),
      auth,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateDailyCallCoachingRequest(request);
    const body = await request.json().catch(() => ({}));
    const report = await runDailyCallCoaching({
      reportDate: typeof body?.reportDate === "string" ? body.reportDate : undefined,
      loginName: typeof body?.loginName === "string" ? body.loginName : undefined,
      previewRecipientLoginName:
        typeof body?.previewRecipientLoginName === "string"
          ? body.previewRecipientLoginName
          : undefined,
      previewRecipientEmail:
        typeof body?.previewRecipientEmail === "string"
          ? body.previewRecipientEmail
          : undefined,
      force: body?.force === true,
    });

    const failed = report.items.filter((item) => item.status === "failed").length;
    const status = failed > 0 ? 207 : 200;
    return finalizeDailyCallCoachingResponse(NextResponse.json(report, { status }), auth);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
