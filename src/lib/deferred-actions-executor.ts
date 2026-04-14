import {
  deleteBusinessAccount,
  deleteContact,
  fetchBusinessAccountById,
  type AuthCookieRefreshState,
} from "@/lib/acumatica";
import { normalizeBusinessAccountRows } from "@/lib/business-accounts";
import { executeDeferredContactMergeRequest } from "@/lib/contact-merge-execution";
import {
  DEFAULT_DEFERRED_ACTION_MAX_ATTEMPTS,
  listDueApprovedDeferredActions,
  listStaleExecutingDeferredActions,
  markDeferredActionExecuted,
  markDeferredActionExecuting,
  markDeferredActionFailed,
  markDeferredActionRetryScheduled,
  type StoredDeferredActionRecord,
} from "@/lib/deferred-actions-store";
import { getErrorMessage, HttpError } from "@/lib/errors";
import {
  removeReadModelRowsByAccount,
  removeReadModelRowsByContactId,
  replaceReadModelAccountRows,
} from "@/lib/read-model/accounts";
import { parseContactMergePayload } from "@/lib/validation";

type DeferredActionActor = {
  loginName: string | null;
  name: string | null;
};

const DEFERRED_ACTION_RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
] as const;

function isRetryableDeferredActionError(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return true;
  }

  return [401, 408, 409, 425, 429, 500, 502, 503, 504].includes(error.status);
}

function computeRetryExecuteAfter(attemptNumber: number, now = Date.now()): string {
  const backoffMs =
    DEFERRED_ACTION_RETRY_BACKOFF_MS[
      Math.min(
        Math.max(attemptNumber - 1, 0),
        DEFERRED_ACTION_RETRY_BACKOFF_MS.length - 1,
      )
    ] ?? DEFERRED_ACTION_RETRY_BACKOFF_MS[DEFERRED_ACTION_RETRY_BACKOFF_MS.length - 1];

  return new Date(now + backoffMs).toISOString();
}

function canRetryDeferredAction(record: StoredDeferredActionRecord, attemptNumber: number): boolean {
  const maxAttempts =
    record.maxAttempts > 0 ? record.maxAttempts : DEFAULT_DEFERRED_ACTION_MAX_ATTEMPTS;
  return attemptNumber < maxAttempts;
}

function parseDeletePayload(record: StoredDeferredActionRecord): {
  contactId: number;
} {
  if (record.contactId !== null && record.contactId > 0) {
    return {
      contactId: record.contactId,
    };
  }

  try {
    const parsed = JSON.parse(record.payloadJson) as Record<string, unknown>;
    const contactId = Number(parsed.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      throw new Error("Queued delete payload is missing contactId.");
    }

    return {
      contactId,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Queued delete payload is invalid.",
    );
  }
}

async function executeDeferredDeleteContact(
  record: StoredDeferredActionRecord,
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<void> {
  const payload = parseDeletePayload(record);
  try {
    await deleteContact(cookieValue, payload.contactId, authCookieRefresh);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) {
      throw error;
    }
  }

  if (record.businessAccountRecordId) {
    try {
      const refreshedRaw = await fetchBusinessAccountById(
        cookieValue,
        record.businessAccountRecordId,
        authCookieRefresh,
      );
      replaceReadModelAccountRows(
        record.businessAccountRecordId,
        normalizeBusinessAccountRows(refreshedRaw),
      );
      return;
    } catch {
      // Fall back to removing the queued contact row if the account refresh fails.
    }
  }

  removeReadModelRowsByContactId(payload.contactId);
}

function parseDeleteBusinessAccountPayload(record: StoredDeferredActionRecord): {
  businessAccountId: string;
} {
  const businessAccountId = record.businessAccountId?.trim() ?? "";
  if (businessAccountId) {
    return {
      businessAccountId,
    };
  }

  try {
    const parsed = JSON.parse(record.payloadJson) as Record<string, unknown>;
    const payloadBusinessAccountId =
      typeof parsed.businessAccountId === "string" ? parsed.businessAccountId.trim() : "";
    if (!payloadBusinessAccountId) {
      throw new Error("Queued business account delete payload is missing businessAccountId.");
    }

    return {
      businessAccountId: payloadBusinessAccountId,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Queued business account delete payload is invalid.",
    );
  }
}

async function executeDeferredDeleteBusinessAccount(
  record: StoredDeferredActionRecord,
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<void> {
  const payload = parseDeleteBusinessAccountPayload(record);
  try {
    await deleteBusinessAccount(cookieValue, payload.businessAccountId, authCookieRefresh);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) {
      throw error;
    }
  }

  removeReadModelRowsByAccount(
    record.businessAccountRecordId?.trim() ?? payload.businessAccountId,
    payload.businessAccountId,
  );
}

async function executeDeferredMergeContacts(
  record: StoredDeferredActionRecord,
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<void> {
  const parsed = JSON.parse(record.payloadJson);
  const payload = parseContactMergePayload(parsed);
  if (record.preview.actionType !== "mergeContacts") {
    throw new Error("Queued merge action preview is invalid.");
  }

  await executeDeferredContactMergeRequest(
    cookieValue,
    payload,
    record.preview,
    authCookieRefresh,
  );
}

function recoverStaleExecutingDeferredActions(actor: DeferredActionActor): void {
  const staleActions = listStaleExecutingDeferredActions();

  for (const record of staleActions) {
    const attemptNumber = record.attemptCount;
    const timeoutMessage = record.failureMessage?.trim()
      ? `${record.failureMessage} Execution timed out before completion.`
      : "Execution timed out before completion.";

    if (canRetryDeferredAction(record, attemptNumber)) {
      markDeferredActionRetryScheduled(
        record.id,
        actor,
        `${timeoutMessage} Retry ${attemptNumber + 1} of ${record.maxAttempts} scheduled.`,
        new Date().toISOString(),
      );
      continue;
    }

    markDeferredActionFailed(
      record.id,
      actor,
      `${timeoutMessage} Reached retry limit after ${record.maxAttempts} attempts.`,
    );
  }
}

export async function runDueDeferredActions(
  cookieValue: string,
  actor: DeferredActionActor,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<{
  executedCount: number;
  failedCount: number;
}> {
  recoverStaleExecutingDeferredActions(actor);
  const dueActions = listDueApprovedDeferredActions();
  let executedCount = 0;
  let failedCount = 0;

  for (const record of dueActions) {
    if (!markDeferredActionExecuting(record.id, actor)) {
      continue;
    }

    try {
      if (record.actionType === "deleteContact") {
        await executeDeferredDeleteContact(record, cookieValue, authCookieRefresh);
      } else if (record.actionType === "deleteBusinessAccount") {
        await executeDeferredDeleteBusinessAccount(record, cookieValue, authCookieRefresh);
      } else {
        await executeDeferredMergeContacts(record, cookieValue, authCookieRefresh);
      }

      markDeferredActionExecuted(record.id, actor);
      executedCount += 1;
    } catch (error) {
      const failureMessage = getErrorMessage(error);
      const attemptNumber = record.attemptCount + 1;

      if (isRetryableDeferredActionError(error) && canRetryDeferredAction(record, attemptNumber)) {
        markDeferredActionRetryScheduled(
          record.id,
          actor,
          `${failureMessage} Retry ${attemptNumber + 1} of ${record.maxAttempts} scheduled.`,
          computeRetryExecuteAfter(attemptNumber),
        );
        continue;
      }

      markDeferredActionFailed(record.id, actor, failureMessage);
      failedCount += 1;
    }
  }

  return {
    executedCount,
    failedCount,
  };
}
