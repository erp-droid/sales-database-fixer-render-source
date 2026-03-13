export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { processTwilioRecordingCallback } from "@/lib/call-analytics/postcall-worker";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await processTwilioRecordingCallback(request);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

