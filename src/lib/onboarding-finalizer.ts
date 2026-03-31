import { HttpError, getErrorMessage } from "@/lib/errors";
import { finalizeOnboardingRequestRecord } from "@/lib/onboarding-submit";
import {
  claimDueOnboardingFinalizations,
  completeOnboardingFinalization,
  getOnboardingRequest,
  retryOnboardingFinalization,
  type OnboardingRequestRecord,
} from "@/lib/onboarding-store";
import { parseOnboardingFormPayload } from "@/lib/onboarding-validation";

const MAX_FINALIZATION_ATTEMPTS = 7;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60 * 1000;

export type OnboardingFinalizationRunResult = {
  token: string;
  status: "converted" | "retrying" | "failed" | "skipped";
  reason: string;
  nextAttemptAt?: string | null;
};

function isTransientOnboardingError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  if (error instanceof HttpError) {
    if ([408, 409, 429, 500, 502, 503, 504].includes(error.status)) {
      return true;
    }
  }

  return (
    message.includes("api login limit") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("temporarily unavailable") ||
    message.includes("service unavailable") ||
    message.includes("rate limit") ||
    message.includes("network") ||
    message.includes("socket hang up")
  );
}

function buildRetryDelayMs(attemptCount: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1), RETRY_MAX_MS);
}

function getLeaseOwner(record: OnboardingRequestRecord): string | null {
  return record.finalization?.leaseOwner ?? null;
}

async function processClaimedRecord(
  record: OnboardingRequestRecord,
): Promise<OnboardingFinalizationRunResult> {
  const token = record.id;
  const leaseOwner = getLeaseOwner(record);
  if (!leaseOwner) {
    return {
      token,
      status: "skipped",
      reason: "missing_lease",
    };
  }

  try {
    const payload = parseOnboardingFormPayload(record.submission);
    const result = await finalizeOnboardingRequestRecord(record, payload);
    await completeOnboardingFinalization(token, leaseOwner, {
      status: result.status,
      conversion: result.conversion,
      clearActiveEditor: true,
    });
    return {
      token,
      status: "converted",
      reason: "completed",
    };
  } catch (error) {
    const attemptCount = record.finalization?.attemptCount ?? 1;
    const message = getErrorMessage(error);
    if (
      isTransientOnboardingError(error) &&
      attemptCount < MAX_FINALIZATION_ATTEMPTS
    ) {
      const nextAttemptAt = new Date(
        Date.now() + buildRetryDelayMs(attemptCount),
      ).toISOString();
      await retryOnboardingFinalization(
        token,
        leaseOwner,
        message,
        nextAttemptAt,
      );
      return {
        token,
        status: "retrying",
        reason: message,
        nextAttemptAt,
      };
    }

    await completeOnboardingFinalization(token, leaseOwner, {
      status: "failed",
      conversion: {
        failedAt: new Date().toISOString(),
        error: message,
      },
    });
    return {
      token,
      status: "failed",
      reason: message,
    };
  }
}

export async function processOnboardingFinalizationByToken(
  token: string,
): Promise<OnboardingFinalizationRunResult> {
  const claimed = await claimDueOnboardingFinalizations({
    token,
    limit: 1,
  });
  const record = claimed[0] ?? null;
  if (!record) {
    const current = await getOnboardingRequest(token);
    return {
      token,
      status: "skipped",
      reason: current?.status ?? "not_found",
    };
  }

  return processClaimedRecord(record);
}

export async function runDueOnboardingFinalizations(
  limit = 5,
): Promise<{
  ranAt: string;
  processed: number;
  converted: number;
  retried: number;
  failed: number;
  skipped: number;
  items: OnboardingFinalizationRunResult[];
}> {
  const claimed = await claimDueOnboardingFinalizations({ limit });
  const items: OnboardingFinalizationRunResult[] = [];

  for (const record of claimed) {
    items.push(await processClaimedRecord(record));
  }

  return {
    ranAt: new Date().toISOString(),
    processed: items.length,
    converted: items.filter((item) => item.status === "converted").length,
    retried: items.filter((item) => item.status === "retrying").length,
    failed: items.filter((item) => item.status === "failed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    items,
  };
}
