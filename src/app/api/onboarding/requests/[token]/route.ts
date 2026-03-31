export const runtime = "nodejs";

import { after, NextRequest, NextResponse } from "next/server";

import { processOnboardingFinalizationByToken } from "@/lib/onboarding-finalizer";
import { buildOnboardingRequestResponse } from "@/lib/onboarding-form";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { getOnboardingRequest } from "@/lib/onboarding-store";

function runInBackground(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    queueMicrotask(() => {
      void task().catch(() => undefined);
    });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const request = await getOnboardingRequest(token);
    if (!request) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    if (request.status === "submitted") {
      runInBackground(async () => {
        await processOnboardingFinalizationByToken(token);
      });
    }

    if (request.status !== "pending") {
      return NextResponse.json(
        {
          status: request.status,
          token: request.id,
          companyName: request.companyName,
          businessAccountId: request.businessAccountId,
          opportunityId: request.opportunityId,
          submittedAt: request.submittedAt,
          finalization: request.finalization
            ? {
                status: request.finalization.status,
                attemptCount: request.finalization.attemptCount,
                nextAttemptAt: request.finalization.nextAttemptAt,
                lastAttemptAt: request.finalization.lastAttemptAt,
                lastError: request.finalization.lastError,
              }
            : null,
        },
        { status: 200 },
      );
    }

    const payload = await buildOnboardingRequestResponse(request);
    return NextResponse.json(payload, { status: 200 });
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
