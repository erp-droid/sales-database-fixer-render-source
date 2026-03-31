export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { HttpError, getErrorMessage } from "@/lib/errors";
import { heartbeatOnboardingEditor } from "@/lib/onboarding-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));
    const sessionId =
      typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) {
      throw new HttpError(400, "sessionId is required.");
    }

    const result = await heartbeatOnboardingEditor(token, sessionId);
    if (!result.record) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        conflict: result.conflict,
        status: result.record.status,
      },
      { status: 200 },
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
