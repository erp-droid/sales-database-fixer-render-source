export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getErrorMessage, HttpError } from "@/lib/errors";
import { recoverDeliveredMailSendAudits } from "@/lib/mail-send-jobs";

function ensureInternalRequest(request: NextRequest): void {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  const isInternal =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host.startsWith("127.0.0.1:") ||
    host.startsWith("localhost:");
  if (!isInternal) {
    throw new HttpError(401, "Not authenticated.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureInternalRequest(request);
    const recovered = recoverDeliveredMailSendAudits(1_000);
    return NextResponse.json({ ok: true, recovered });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status });
  }
}
