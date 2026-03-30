export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { processTwilioStatusCallback } from "@/lib/call-analytics/ingest";
import { ensureCallActivitySyncQueuedForSession } from "@/lib/call-analytics/postcall-worker";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const result = await processTwilioStatusCallback(request);
    if (result.source === "app_bridge" && result.answered && result.endedAt) {
      void (async () => {
        try {
          if (result.rebuildPromise) {
            await result.rebuildPromise;
          }
        } catch (error) {
          console.error("[call-activity-sync] status callback rebuild failed", {
            sessionId: result.sessionId,
            error: getErrorMessage(error),
          });
        }

        await ensureCallActivitySyncQueuedForSession(result.sessionId).catch(() => undefined);
      })();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
