export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { runOnboardingScan } from "@/lib/onboarding-automation";

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

function hasValidSecret(request: NextRequest): boolean {
  const secret = getEnv().ONBOARDING_TRIGGER_SECRET;
  if (!secret) {
    return false;
  }

  const provided =
    request.headers.get("x-onboarding-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  return provided === secret;
}

function ensureAuthorized(request: NextRequest): void {
  if (isInternalHost(request) || hasValidSecret(request)) {
    return;
  }

  throw new HttpError(401, "Unauthorized.");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureAuthorized(request);
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
    const report = await runOnboardingScan({ dryRun });
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: getErrorMessage(error), ranAt: new Date().toISOString() },
      { status: 500 },
    );
  }
}
