export const runtime = "nodejs";

import { after, NextRequest, NextResponse } from "next/server";

import { processOnboardingFinalizationByToken } from "@/lib/onboarding-finalizer";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { acceptOnboardingSubmission } from "@/lib/onboarding-store";
import { parseOnboardingFormPayload } from "@/lib/onboarding-validation";

function runInBackground(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    queueMicrotask(() => {
      void task().catch(() => undefined);
    });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const body = await request.json();
    const payload = parseOnboardingFormPayload(body);
    const result = await acceptOnboardingSubmission(token, payload);

    if (result.accepted) {
      runInBackground(async () => {
        await processOnboardingFinalizationByToken(token);
      });
    }

    return NextResponse.json(
      {
        ok: true,
        status: result.record.status,
        accepted: result.accepted,
      },
      { status: 200 },
    );
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
