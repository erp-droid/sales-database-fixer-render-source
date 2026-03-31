export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { createManualOnboardingRequest } from "@/lib/onboarding-automation";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";

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
    const body = await request.json().catch(() => ({}));
    const result = await createManualOnboardingRequest({
      businessAccountId: String(body?.businessAccountId ?? ""),
      opportunityId: String(body?.opportunityId ?? ""),
      contactId:
        typeof body?.contactId === "number" ? body.contactId : null,
      contactEmail: typeof body?.contactEmail === "string" ? body.contactEmail : null,
      contactName: typeof body?.contactName === "string" ? body.contactName : null,
      opportunityStage:
        typeof body?.opportunityStage === "string" ? body.opportunityStage : null,
      opportunityStatus:
        typeof body?.opportunityStatus === "string" ? body.opportunityStatus : null,
    });

    return NextResponse.json(result, { status: 200 });
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
