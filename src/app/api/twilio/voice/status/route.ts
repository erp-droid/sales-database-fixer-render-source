export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { processTwilioStatusCallback } from "@/lib/call-analytics/ingest";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await processTwilioStatusCallback(request);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
