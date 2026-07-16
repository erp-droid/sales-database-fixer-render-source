export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getErrorMessage, HttpError } from "@/lib/errors";
import { drainSupportTicketQueue } from "@/lib/support-ticket-worker";

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
}

function ensureAuthorized(request: NextRequest): void {
  if (isInternalHost(request)) {
    return;
  }
  const expected = (process.env.TICKET_AGENT_SECRET ?? "").trim();
  const provided = (request.headers.get("x-ticket-agent-secret") ?? "").trim();
  if (!expected || provided !== expected) {
    throw new HttpError(401, "Not authenticated.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureAuthorized(request);
    const processed = await drainSupportTicketQueue(3);
    return NextResponse.json({ ok: true, processed });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status });
  }
}
