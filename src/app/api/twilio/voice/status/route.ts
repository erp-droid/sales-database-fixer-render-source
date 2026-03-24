export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { processTwilioStatusCallback } from "@/lib/call-analytics/ingest";
import { ensureCallActivitySyncQueuedForSession } from "@/lib/call-analytics/postcall-worker";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await processTwilioStatusCallback(request);
    if (session?.source === "app_bridge" && session.answered && session.endedAt) {
      void ensureCallActivitySyncQueuedForSession(session.sessionId).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
