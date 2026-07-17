import { getErrorMessage } from "@/lib/errors";
import { logMailSendAudit } from "@/lib/audit-log-store";
import {
  isRepairableMailActivityPayload,
  repairMailActivitySyncWithServiceSession,
} from "@/lib/mail-activity-sync";
import { getReadModelDb } from "@/lib/read-model/db";
import type { MailComposePayload, MailSendResponse } from "@/types/mail-compose";

type MailSendJobStatus = "queued" | "processing" | "succeeded" | "failed";

type StoredMailSendJobRow = {
  id: string;
  requested_by_login_name: string | null;
  requested_by_name: string | null;
  payload_json: string;
  response_json: string;
  status: string;
  attempts: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type MailSendJobRecord = {
  id: string;
  requestedByLoginName: string | null;
  requestedByName: string | null;
  payloadJson: string;
  responseJson: string;
  status: MailSendJobStatus;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type EnqueueMailSendJobInput = {
  actor: {
    loginName: string | null;
    name: string | null;
  };
  payload: Partial<MailComposePayload>;
  response: unknown;
};

let drainPromise: Promise<number> | null = null;

function normalizeStatus(value: string | null | undefined): MailSendJobStatus {
  switch (value) {
    case "queued":
    case "processing":
    case "succeeded":
    case "failed":
      return value;
    default:
      return "queued";
  }
}

function normalizeRow(row: StoredMailSendJobRow): MailSendJobRecord {
  return {
    id: row.id,
    requestedByLoginName: row.requested_by_login_name,
    requestedByName: row.requested_by_name,
    payloadJson: row.payload_json,
    responseJson: row.response_json,
    status: normalizeStatus(row.status),
    attempts: row.attempts,
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRowById(id: string): StoredMailSendJobRow | null {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        id,
        requested_by_login_name,
        requested_by_name,
        payload_json,
        response_json,
        status,
        attempts,
        error_message,
        created_at,
        updated_at
      FROM mail_send_jobs
      WHERE id = ?
      `,
    )
    .get(id.trim()) as StoredMailSendJobRow | undefined;

  return row ?? null;
}

function updateJob(
  id: string,
  input: {
    responseJson?: string;
    status?: MailSendJobStatus;
    error?: string | null;
  },
): MailSendJobRecord {
  const existing = readRowById(id);
  if (!existing) {
    throw new Error(`Mail send job '${id}' was not found.`);
  }

  const db = getReadModelDb();
  const next = {
    responseJson: input.responseJson ?? existing.response_json,
    status: input.status ?? normalizeStatus(existing.status),
    error: input.error !== undefined ? input.error : existing.error_message,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `
    UPDATE mail_send_jobs
    SET response_json = ?,
        status = ?,
        error_message = ?,
        updated_at = ?
    WHERE id = ?
    `,
  ).run(next.responseJson, next.status, next.error, next.updatedAt, id.trim());

  const row = readRowById(id);
  if (!row) {
    throw new Error(`Mail send job '${id}' disappeared after update.`);
  }

  return normalizeRow(row);
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Stored ${label} could not be parsed: ${getErrorMessage(error)}`);
  }
}

function isMailSendResponse(payload: unknown): payload is MailSendResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return record.sent === true && typeof record.threadId === "string" && typeof record.messageId === "string";
}

function buildAuditResultCode(
  response: Partial<MailSendResponse> | null,
): "succeeded" | "partial" | "failed" {
  if (!response) {
    return "failed";
  }

  if (
    response.activitySyncStatus === "failed" ||
    response.activitySyncStatus === "pending" ||
    response.activitySyncStatus === "not_linked"
  ) {
    return "partial";
  }

  return "succeeded";
}

function buildMailSendAuditEventId(jobId: string): string {
  return `email-send-job:${jobId}`;
}

function recordDeliveredMailAudit(job: MailSendJobRecord): boolean {
  const payload = parseJson<Partial<MailComposePayload>>(job.payloadJson, "mail payload");
  const response = parseJson<unknown>(job.responseJson, "mail response");
  if (!isMailSendResponse(response)) {
    return false;
  }

  logMailSendAudit({
    actor: {
      loginName: job.requestedByLoginName,
      name: job.requestedByName,
    },
    payload,
    resultCode: buildAuditResultCode(response),
    response,
    auditEventId: buildMailSendAuditEventId(job.id),
    occurredAt: job.createdAt,
  });
  return true;
}

export function enqueueMailSendJob(input: EnqueueMailSendJobInput): MailSendJobRecord {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `
    INSERT INTO mail_send_jobs (
      id,
      requested_by_login_name,
      requested_by_name,
      payload_json,
      response_json,
      status,
      attempts,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', 0, NULL, ?, ?)
    `,
  ).run(
    id,
    input.actor.loginName?.trim() || null,
    input.actor.name?.trim() || null,
    JSON.stringify(input.payload),
    JSON.stringify(input.response),
    now,
    now,
  );

  const row = readRowById(id);
  if (!row) {
    throw new Error("Failed to enqueue mail send job.");
  }

  const job = normalizeRow(row);
  try {
    // Gmail delivery and CRM activity synchronization are separate outcomes.
    // Record the confirmed delivery immediately so a later CRM sync failure
    // cannot make the sent email disappear from the dashboard.
    recordDeliveredMailAudit(job);
  } catch {
    // The durable job remains available for startup recovery and retries.
  }

  return job;
}

export function recoverDeliveredMailSendAudits(limit = 500): number {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        jobs.id,
        jobs.requested_by_login_name,
        jobs.requested_by_name,
        jobs.payload_json,
        jobs.response_json,
        jobs.status,
        jobs.attempts,
        jobs.error_message,
        jobs.created_at,
        jobs.updated_at
      FROM mail_send_jobs AS jobs
      WHERE NOT EXISTS (
        SELECT 1
        FROM audit_events AS events
        WHERE events.id = 'email-send-job:' || jobs.id
      )
      ORDER BY jobs.created_at ASC
      LIMIT ?
      `,
    )
    .all(Math.max(1, Math.trunc(limit))) as StoredMailSendJobRow[];

  let recovered = 0;
  for (const row of rows) {
    try {
      if (recordDeliveredMailAudit(normalizeRow(row))) {
        recovered += 1;
      }
    } catch {
      // One malformed historical job must not prevent recovery of the rest.
    }
  }

  return recovered;
}

export function listPendingMailSendJobs(limit = 25): MailSendJobRecord[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        id,
        requested_by_login_name,
        requested_by_name,
        payload_json,
        response_json,
        status,
        attempts,
        error_message,
        created_at,
        updated_at
      FROM mail_send_jobs
      WHERE status IN ('queued', 'failed')
      ORDER BY updated_at ASC, created_at ASC
      LIMIT ?
      `,
    )
    .all(Math.max(1, Math.trunc(limit))) as StoredMailSendJobRow[];

  return rows.map(normalizeRow);
}

export function claimMailSendJob(id: string): MailSendJobRecord | null {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE mail_send_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
        AND status IN ('queued', 'failed')
      `,
    )
    .run(now, id.trim());

  if (result.changes === 0) {
    return null;
  }

  const row = readRowById(id);
  return row ? normalizeRow(row) : null;
}

export function markMailSendJobFailed(id: string, error: string): MailSendJobRecord {
  return updateJob(id, {
    status: "failed",
    error,
  });
}

export function markMailSendJobSucceeded(id: string, response: unknown): MailSendJobRecord {
  return updateJob(id, {
    responseJson: JSON.stringify(response),
    status: "succeeded",
    error: null,
  });
}

export async function processMailSendJob(id: string): Promise<MailSendJobRecord | null> {
  const claimed = claimMailSendJob(id);
  if (!claimed) {
    return null;
  }

  try {
    const payload = parseJson<Partial<MailComposePayload>>(claimed.payloadJson, "mail payload");
    const upstreamResponse = parseJson<unknown>(claimed.responseJson, "mail response");
      const repairedResponse =
        isRepairableMailActivityPayload(upstreamResponse)
        ? await repairMailActivitySyncWithServiceSession(
            null,
            payload,
            upstreamResponse,
          )
        : upstreamResponse;

    logMailSendAudit({
      actor: {
        loginName: claimed.requestedByLoginName,
        name: claimed.requestedByName,
      },
      payload,
      resultCode: buildAuditResultCode(
        isMailSendResponse(repairedResponse) ? repairedResponse : null,
      ),
      response: isMailSendResponse(repairedResponse) ? repairedResponse : null,
      auditEventId: buildMailSendAuditEventId(claimed.id),
      occurredAt: claimed.createdAt,
    });

    return markMailSendJobSucceeded(claimed.id, repairedResponse);
  } catch (error) {
    try {
      // The email was already delivered even if the separate CRM activity
      // repair failed. Preserve it as a partial audit event for the dashboard.
      recordDeliveredMailAudit(claimed);
    } catch {
      // Keep the job retryable if its stored data or the audit write is broken.
    }
    return markMailSendJobFailed(claimed.id, getErrorMessage(error));
  }
}

export async function drainPendingMailSendJobs(limit = 25): Promise<number> {
  if (drainPromise) {
    return drainPromise;
  }

  drainPromise = (async () => {
    let remaining = Math.max(1, Math.trunc(limit));
    let processed = 0;
    const processedIds = new Set<string>();

    while (remaining > 0) {
      const jobs = listPendingMailSendJobs(Math.min(remaining, 10)).filter(
        (job) => !processedIds.has(job.id),
      );
      if (jobs.length === 0) {
        break;
      }

      for (const job of jobs) {
        processedIds.add(job.id);
        await processMailSendJob(job.id);
        processed += 1;
        remaining -= 1;
        if (remaining <= 0) {
          break;
        }
      }
    }
    return processed;
  })().finally(() => {
    drainPromise = null;
  });

  return drainPromise;
}
