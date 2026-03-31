import crypto from "node:crypto";

import { getFirestore } from "@/lib/firestore";
import { HttpError } from "@/lib/errors";

export type OnboardingRequestStatus =
  | "pending"
  | "submitted"
  | "converted"
  | "failed";

export type OnboardingFinalizationStatus =
  | "queued"
  | "processing"
  | "retrying"
  | "failed"
  | "completed";

export type OnboardingFinalizationState = {
  status: OnboardingFinalizationStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
};

export type OnboardingActiveEditor = {
  sessionId: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type OnboardingRequestRecord = {
  id: string;
  status: OnboardingRequestStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  businessAccountId: string;
  businessAccountRecordId: string;
  opportunityId: string;
  opportunityStage: string | null;
  opportunityStatus: string | null;
  opportunityLastModified: string | null;
  companyName: string | null;
  primaryContactId: number | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  emailTo: string | null;
  emailOverrideTo: string | null;
  emailSentAt: string | null;
  onboardingUrl: string | null;
  submission: Record<string, unknown> | null;
  conversion: Record<string, unknown> | null;
  finalization: OnboardingFinalizationState | null;
  activeEditor: OnboardingActiveEditor | null;
};

type OnboardingScanState = {
  lastScanAt: string | null;
  lastCompletedAt: string | null;
};

type AcceptSubmissionResult = {
  accepted: boolean;
  record: OnboardingRequestRecord;
};

type ClaimFinalizationOptions = {
  token?: string;
  limit?: number;
  leaseMs?: number;
};

type HeartbeatResult = {
  record: OnboardingRequestRecord | null;
  conflict: boolean;
};

const REQUESTS_COLLECTION = "onboarding_requests";
const STATE_COLLECTION = "onboarding_state";
const SCAN_DOC_ID = "scan";

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function normalizeFinalizationState(
  value: unknown,
): OnboardingFinalizationState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = readString(record.status) as OnboardingFinalizationStatus | null;
  if (!status) {
    return null;
  }

  return {
    status,
    attemptCount: readNumber(record.attemptCount) ?? 0,
    nextAttemptAt: readString(record.nextAttemptAt),
    lastAttemptAt: readString(record.lastAttemptAt),
    startedAt: readString(record.startedAt),
    completedAt: readString(record.completedAt),
    leaseOwner: readString(record.leaseOwner),
    leaseExpiresAt: readString(record.leaseExpiresAt),
    lastError: readString(record.lastError),
  };
}

function normalizeActiveEditor(value: unknown): OnboardingActiveEditor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sessionId = readString(record.sessionId);
  const lastSeenAt = readString(record.lastSeenAt);
  const expiresAt = readString(record.expiresAt);
  if (!sessionId || !lastSeenAt || !expiresAt) {
    return null;
  }

  return {
    sessionId,
    lastSeenAt,
    expiresAt,
  };
}

function normalizeRecord(
  id: string,
  data: Record<string, unknown>,
): OnboardingRequestRecord {
  return {
    id,
    status: (data.status as OnboardingRequestStatus) ?? "pending",
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
    submittedAt: typeof data.submittedAt === "string" ? data.submittedAt : null,
    businessAccountId: String(data.businessAccountId ?? ""),
    businessAccountRecordId: String(data.businessAccountRecordId ?? ""),
    opportunityId: String(data.opportunityId ?? ""),
    opportunityStage: typeof data.opportunityStage === "string" ? data.opportunityStage : null,
    opportunityStatus: typeof data.opportunityStatus === "string" ? data.opportunityStatus : null,
    opportunityLastModified:
      typeof data.opportunityLastModified === "string" ? data.opportunityLastModified : null,
    companyName: typeof data.companyName === "string" ? data.companyName : null,
    primaryContactId: typeof data.primaryContactId === "number" ? data.primaryContactId : null,
    primaryContactName:
      typeof data.primaryContactName === "string" ? data.primaryContactName : null,
    primaryContactEmail:
      typeof data.primaryContactEmail === "string" ? data.primaryContactEmail : null,
    emailTo: typeof data.emailTo === "string" ? data.emailTo : null,
    emailOverrideTo:
      typeof data.emailOverrideTo === "string" ? data.emailOverrideTo : null,
    emailSentAt: typeof data.emailSentAt === "string" ? data.emailSentAt : null,
    onboardingUrl: typeof data.onboardingUrl === "string" ? data.onboardingUrl : null,
    submission:
      data.submission && typeof data.submission === "object"
        ? (data.submission as Record<string, unknown>)
        : null,
    conversion:
      data.conversion && typeof data.conversion === "object"
        ? (data.conversion as Record<string, unknown>)
        : null,
    finalization: normalizeFinalizationState(data.finalization),
    activeEditor: normalizeActiveEditor(data.activeEditor),
  };
}

function buildQueuedFinalizationState(nowIso: string): OnboardingFinalizationState {
  return {
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: nowIso,
    lastAttemptAt: null,
    startedAt: null,
    completedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
  };
}

function isIsoInFuture(value: string | null, nowMs: number): boolean {
  if (!value) {
    return false;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > nowMs;
}

function isDue(value: string | null, nowMs: number): boolean {
  if (!value) {
    return true;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return parsed <= nowMs;
}

function serializeRecord(record: OnboardingRequestRecord): Record<string, unknown> {
  return {
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    businessAccountId: record.businessAccountId,
    businessAccountRecordId: record.businessAccountRecordId,
    opportunityId: record.opportunityId,
    opportunityStage: record.opportunityStage,
    opportunityStatus: record.opportunityStatus,
    opportunityLastModified: record.opportunityLastModified,
    companyName: record.companyName,
    primaryContactId: record.primaryContactId,
    primaryContactName: record.primaryContactName,
    primaryContactEmail: record.primaryContactEmail,
    emailTo: record.emailTo,
    emailOverrideTo: record.emailOverrideTo,
    emailSentAt: record.emailSentAt,
    onboardingUrl: record.onboardingUrl,
    submission: record.submission,
    conversion: record.conversion,
    finalization: record.finalization,
    activeEditor: record.activeEditor,
  };
}

export async function getOnboardingRequest(
  token: string,
): Promise<OnboardingRequestRecord | null> {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const doc = await getFirestore()
    .collection(REQUESTS_COLLECTION)
    .doc(trimmed)
    .get();
  if (!doc.exists) {
    return null;
  }

  return normalizeRecord(doc.id, doc.data() as Record<string, unknown>);
}

export async function findOnboardingRequestByOpportunityId(
  opportunityId: string,
): Promise<OnboardingRequestRecord | null> {
  const trimmed = opportunityId.trim();
  if (!trimmed) {
    return null;
  }

  const snapshot = await getFirestore()
    .collection(REQUESTS_COLLECTION)
    .where("opportunityId", "==", trimmed)
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  if (!doc) {
    return null;
  }

  return normalizeRecord(doc.id, doc.data() as Record<string, unknown>);
}

export async function findOnboardingRequestByBusinessAccountId(
  businessAccountId: string,
): Promise<OnboardingRequestRecord | null> {
  const trimmed = businessAccountId.trim();
  if (!trimmed) {
    return null;
  }

  const snapshot = await getFirestore()
    .collection(REQUESTS_COLLECTION)
    .where("businessAccountId", "==", trimmed)
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  if (!doc) {
    return null;
  }

  return normalizeRecord(doc.id, doc.data() as Record<string, unknown>);
}

export async function createOnboardingRequest(
  token: string,
  input: Omit<OnboardingRequestRecord, "id">,
): Promise<OnboardingRequestRecord> {
  const now = new Date().toISOString();
  const payload = {
    ...input,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    submittedAt: input.submittedAt ?? null,
    finalization: input.finalization ?? null,
    activeEditor: input.activeEditor ?? null,
  };

  await getFirestore()
    .collection(REQUESTS_COLLECTION)
    .doc(token.trim())
    .set(payload, { merge: true });

  return normalizeRecord(token.trim(), payload as Record<string, unknown>);
}

export async function updateOnboardingRequest(
  token: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    return;
  }

  await getFirestore()
    .collection(REQUESTS_COLLECTION)
    .doc(trimmed)
    .set(
      {
        ...updates,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
}

export async function acceptOnboardingSubmission(
  token: string,
  submission: Record<string, unknown>,
): Promise<AcceptSubmissionResult> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new HttpError(400, "Onboarding request token is required.");
  }

  const result = await getFirestore().runTransaction(async (transaction) => {
    const ref = getFirestore().collection(REQUESTS_COLLECTION).doc(trimmed);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new HttpError(404, "Onboarding request not found.");
    }

    const current = normalizeRecord(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
    );

    if (current.status !== "pending") {
      return {
        accepted: false,
        record: current,
      };
    }

    const nowIso = new Date().toISOString();
    const next = {
      ...serializeRecord(current),
      status: "submitted",
      submittedAt: nowIso,
      submission,
      conversion: current.conversion ?? null,
      finalization: buildQueuedFinalizationState(nowIso),
      updatedAt: nowIso,
    };

    transaction.set(ref, next, { merge: true });
    return {
      accepted: true,
      record: normalizeRecord(trimmed, next),
    };
  });

  return result;
}

export async function heartbeatOnboardingEditor(
  token: string,
  sessionId: string,
  ttlMs = 45_000,
): Promise<HeartbeatResult> {
  const trimmedToken = token.trim();
  const trimmedSessionId = sessionId.trim();
  if (!trimmedToken || !trimmedSessionId) {
    return { record: null, conflict: false };
  }

  const result = await getFirestore().runTransaction(async (transaction) => {
    const ref = getFirestore().collection(REQUESTS_COLLECTION).doc(trimmedToken);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      return {
        record: null,
        conflict: false,
      };
    }

    const current = normalizeRecord(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
    );
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const previousEditor = current.activeEditor;
    const conflict =
      current.status === "pending" &&
      Boolean(
        previousEditor &&
          previousEditor.sessionId !== trimmedSessionId &&
          isIsoInFuture(previousEditor.expiresAt, now.getTime()),
      );

    if (current.status !== "pending") {
      return {
        record: current,
        conflict,
      };
    }

    const next = {
      ...serializeRecord(current),
      activeEditor: {
        sessionId: trimmedSessionId,
        lastSeenAt: nowIso,
        expiresAt,
      },
      updatedAt: nowIso,
    };

    transaction.set(ref, next, { merge: true });
    return {
      record: normalizeRecord(trimmedToken, next),
      conflict,
    };
  });

  return result;
}

export async function claimDueOnboardingFinalizations(
  options?: ClaimFinalizationOptions,
): Promise<OnboardingRequestRecord[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 5, 25));
  const leaseMs = Math.max(30_000, options?.leaseMs ?? 5 * 60_000);
  const db = getFirestore();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
  const claimed: OnboardingRequestRecord[] = [];

  const refs = options?.token
    ? [db.collection(REQUESTS_COLLECTION).doc(options.token.trim())]
    : (
        await db
          .collection(REQUESTS_COLLECTION)
          .where("status", "==", "submitted")
          .limit(limit * 5)
          .get()
      ).docs.map((doc) => doc.ref);

  for (const ref of refs) {
    if (claimed.length >= limit) {
      break;
    }

    const leaseOwner = crypto.randomUUID();
    const nextRecord = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return null;
      }

      const current = normalizeRecord(
        snapshot.id,
        snapshot.data() as Record<string, unknown>,
      );
      if (current.status !== "submitted" || !current.submission) {
        return null;
      }

      const finalization = current.finalization ?? buildQueuedFinalizationState(nowIso);
      if (
        isIsoInFuture(finalization.leaseExpiresAt, nowMs) &&
        finalization.leaseOwner
      ) {
        return null;
      }
      if (!isDue(finalization.nextAttemptAt, nowMs)) {
        return null;
      }

      const next = {
        ...serializeRecord(current),
        finalization: {
          ...finalization,
          status:
            finalization.attemptCount > 0 && finalization.status !== "queued"
              ? "retrying"
              : "processing",
          attemptCount: finalization.attemptCount + 1,
          lastAttemptAt: nowIso,
          startedAt: finalization.startedAt ?? nowIso,
          leaseOwner,
          leaseExpiresAt,
        },
        updatedAt: nowIso,
      };

      transaction.set(ref, next, { merge: true });
      return normalizeRecord(snapshot.id, next);
    });

    if (nextRecord) {
      claimed.push(nextRecord);
    }
  }

  return claimed;
}

export async function completeOnboardingFinalization(
  token: string,
  leaseOwner: string,
  updates: {
    status: OnboardingRequestStatus;
    conversion: Record<string, unknown>;
    clearActiveEditor?: boolean;
  },
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    return;
  }

  await getFirestore().runTransaction(async (transaction) => {
    const ref = getFirestore().collection(REQUESTS_COLLECTION).doc(trimmed);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      return;
    }

    const current = normalizeRecord(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
    );
    if (current.finalization?.leaseOwner !== leaseOwner) {
      return;
    }

    const nowIso = new Date().toISOString();
    const next = {
      ...serializeRecord(current),
      status: updates.status,
      conversion: updates.conversion,
      activeEditor: updates.clearActiveEditor ? null : current.activeEditor,
      finalization: {
        ...(current.finalization ?? buildQueuedFinalizationState(nowIso)),
        status: updates.status === "converted" ? "completed" : "failed",
        completedAt: nowIso,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastError:
          typeof updates.conversion.error === "string" ? updates.conversion.error : null,
      },
      updatedAt: nowIso,
    };

    transaction.set(ref, next, { merge: true });
  });
}

export async function retryOnboardingFinalization(
  token: string,
  leaseOwner: string,
  errorMessage: string,
  nextAttemptAt: string,
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    return;
  }

  await getFirestore().runTransaction(async (transaction) => {
    const ref = getFirestore().collection(REQUESTS_COLLECTION).doc(trimmed);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      return;
    }

    const current = normalizeRecord(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
    );
    if (current.finalization?.leaseOwner !== leaseOwner) {
      return;
    }

    const nowIso = new Date().toISOString();
    const next = {
      ...serializeRecord(current),
      status: "submitted",
      conversion: {
        ...(current.conversion ?? {}),
        lastRetryScheduledAt: nowIso,
        error: errorMessage,
      },
      finalization: {
        ...(current.finalization ?? buildQueuedFinalizationState(nowIso)),
        status: "retrying",
        nextAttemptAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: errorMessage,
      },
      updatedAt: nowIso,
    };

    transaction.set(ref, next, { merge: true });
  });
}

export async function getOnboardingScanState(): Promise<OnboardingScanState> {
  const doc = await getFirestore().collection(STATE_COLLECTION).doc(SCAN_DOC_ID).get();
  if (!doc.exists) {
    return { lastScanAt: null, lastCompletedAt: null };
  }

  const data = doc.data() as Record<string, unknown>;
  return {
    lastScanAt: typeof data.lastScanAt === "string" ? data.lastScanAt : null,
    lastCompletedAt:
      typeof data.lastCompletedAt === "string" ? data.lastCompletedAt : null,
  };
}

export async function updateOnboardingScanState(
  updates: Partial<OnboardingScanState>,
): Promise<void> {
  await getFirestore()
    .collection(STATE_COLLECTION)
    .doc(SCAN_DOC_ID)
    .set(
      {
        ...updates,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
}
