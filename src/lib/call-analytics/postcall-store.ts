import { getReadModelDb } from "@/lib/read-model/db";
import type {
  CallActivitySyncRecord,
  CallActivitySyncStatus,
} from "@/lib/call-analytics/types";

type StoredCallActivitySyncRow = {
  session_id: string;
  recording_sid: string | null;
  recording_status: string | null;
  recording_duration_seconds: number | null;
  status: string;
  attempts: number;
  transcript_text: string | null;
  summary_text: string | null;
  activity_id: string | null;
  error_message: string | null;
  recording_deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type UpsertCallActivitySyncInput = {
  sessionId: string;
  recordingSid: string | null;
  recordingStatus: string | null;
  recordingDurationSeconds: number | null;
};

function normalizeStatus(value: string | null | undefined): CallActivitySyncStatus {
  switch (value) {
    case "queued":
    case "processing":
    case "transcribed":
    case "synced":
    case "failed":
    case "skipped":
      return value;
    default:
      return "queued";
  }
}

function normalizeRow(row: StoredCallActivitySyncRow): CallActivitySyncRecord {
  return {
    sessionId: row.session_id,
    recordingSid: row.recording_sid,
    recordingStatus: row.recording_status,
    recordingDurationSeconds: row.recording_duration_seconds,
    status: normalizeStatus(row.status),
    attempts: row.attempts,
    transcriptText: row.transcript_text,
    summaryText: row.summary_text,
    activityId: row.activity_id,
    error: row.error_message,
    recordingDeletedAt: row.recording_deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRowBySessionId(sessionId: string): StoredCallActivitySyncRow | null {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        session_id,
        recording_sid,
        recording_status,
        recording_duration_seconds,
        status,
        attempts,
        transcript_text,
        summary_text,
        activity_id,
        error_message,
        recording_deleted_at,
        created_at,
        updated_at
      FROM call_activity_sync
      WHERE session_id = ?
      `,
    )
    .get(sessionId.trim()) as StoredCallActivitySyncRow | undefined;

  return row ?? null;
}

export function readCallActivitySyncBySessionId(sessionId: string): CallActivitySyncRecord | null {
  const row = readRowBySessionId(sessionId);
  return row ? normalizeRow(row) : null;
}

export function listPendingCallActivitySyncJobs(limit = 25): CallActivitySyncRecord[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        session_id,
        recording_sid,
        recording_status,
        recording_duration_seconds,
        status,
        attempts,
        transcript_text,
        summary_text,
        activity_id,
        error_message,
        recording_deleted_at,
        created_at,
        updated_at
      FROM call_activity_sync
      WHERE status IN ('queued', 'failed', 'transcribed')
      ORDER BY updated_at ASC, created_at ASC
      LIMIT ?
      `,
    )
    .all(Math.max(1, Math.trunc(limit))) as StoredCallActivitySyncRow[];

  return rows.map(normalizeRow);
}

export function upsertQueuedCallActivitySync(input: UpsertCallActivitySyncInput): CallActivitySyncRecord {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO call_activity_sync (
      session_id,
      recording_sid,
      recording_status,
      recording_duration_seconds,
      status,
      attempts,
      transcript_text,
      summary_text,
      activity_id,
      error_message,
      recording_deleted_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      recording_sid = COALESCE(excluded.recording_sid, call_activity_sync.recording_sid),
      recording_status = COALESCE(excluded.recording_status, call_activity_sync.recording_status),
      recording_duration_seconds = COALESCE(
        excluded.recording_duration_seconds,
        call_activity_sync.recording_duration_seconds
      ),
      status = CASE
        WHEN call_activity_sync.status IN ('synced', 'skipped', 'processing')
          THEN call_activity_sync.status
        ELSE 'queued'
      END,
      error_message = CASE
        WHEN call_activity_sync.status IN ('synced', 'skipped', 'processing')
          THEN call_activity_sync.error_message
        ELSE NULL
      END,
      updated_at = excluded.updated_at
    `,
  ).run(
    input.sessionId.trim(),
    input.recordingSid,
    input.recordingStatus,
    input.recordingDurationSeconds,
    now,
    now,
  );

  const row = readRowBySessionId(input.sessionId);
  if (!row) {
    throw new Error("Failed to upsert call activity sync row.");
  }

  return normalizeRow(row);
}

export function claimCallActivitySyncJob(sessionId: string): CallActivitySyncRecord | null {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE call_activity_sync
      SET status = 'processing',
          attempts = attempts + 1,
          error_message = NULL,
          updated_at = ?
      WHERE session_id = ?
        AND status IN ('queued', 'failed', 'transcribed')
      `,
    )
    .run(now, sessionId.trim());

  if (result.changes === 0) {
    return null;
  }

  const row = readRowBySessionId(sessionId);
  return row ? normalizeRow(row) : null;
}

function updateJob(
  sessionId: string,
  input: {
    status?: CallActivitySyncStatus;
    transcriptText?: string | null;
    summaryText?: string | null;
    activityId?: string | null;
    error?: string | null;
    recordingDeletedAt?: string | null;
  },
): CallActivitySyncRecord {
  const existing = readRowBySessionId(sessionId);
  if (!existing) {
    throw new Error(`Call activity sync row '${sessionId}' was not found.`);
  }

  const db = getReadModelDb();
  const next = {
    status: input.status ?? normalizeStatus(existing.status),
    transcriptText:
      input.transcriptText !== undefined ? input.transcriptText : existing.transcript_text,
    summaryText: input.summaryText !== undefined ? input.summaryText : existing.summary_text,
    activityId: input.activityId !== undefined ? input.activityId : existing.activity_id,
    error: input.error !== undefined ? input.error : existing.error_message,
    recordingDeletedAt:
      input.recordingDeletedAt !== undefined
        ? input.recordingDeletedAt
        : existing.recording_deleted_at,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `
    UPDATE call_activity_sync
    SET status = ?,
        transcript_text = ?,
        summary_text = ?,
        activity_id = ?,
        error_message = ?,
        recording_deleted_at = ?,
        updated_at = ?
    WHERE session_id = ?
    `,
  ).run(
    next.status,
    next.transcriptText,
    next.summaryText,
    next.activityId,
    next.error,
    next.recordingDeletedAt,
    next.updatedAt,
    sessionId.trim(),
  );

  const row = readRowBySessionId(sessionId);
  if (!row) {
    throw new Error(`Call activity sync row '${sessionId}' disappeared after update.`);
  }

  return normalizeRow(row);
}

export function requeueCallActivitySyncJob(sessionId: string, error?: string | null): CallActivitySyncRecord {
  return updateJob(sessionId, {
    status: "queued",
    error: error ?? null,
  });
}

export function markCallActivitySyncTranscribed(
  sessionId: string,
  input: {
    transcriptText: string;
    summaryText: string;
  },
): CallActivitySyncRecord {
  return updateJob(sessionId, {
    status: "transcribed",
    transcriptText: input.transcriptText,
    summaryText: input.summaryText,
    error: null,
  });
}

export function markCallActivitySyncRecordingResolved(
  sessionId: string,
  input: {
    recordingSid: string | null;
    recordingStatus: string | null;
    recordingDurationSeconds: number | null;
  },
): CallActivitySyncRecord {
  const existing = readRowBySessionId(sessionId);
  if (!existing) {
    throw new Error(`Call activity sync row '${sessionId}' was not found.`);
  }

  const db = getReadModelDb();
  const updatedAt = new Date().toISOString();
  db.prepare(
    `
    UPDATE call_activity_sync
    SET recording_sid = ?,
        recording_status = ?,
        recording_duration_seconds = ?,
        updated_at = ?
    WHERE session_id = ?
    `,
  ).run(
    input.recordingSid ?? existing.recording_sid,
    input.recordingStatus ?? existing.recording_status,
    input.recordingDurationSeconds ?? existing.recording_duration_seconds,
    updatedAt,
    sessionId.trim(),
  );

  const row = readRowBySessionId(sessionId);
  if (!row) {
    throw new Error(`Call activity sync row '${sessionId}' disappeared after recording update.`);
  }

  return normalizeRow(row);
}

export function markCallActivitySyncFailed(
  sessionId: string,
  error: string,
): CallActivitySyncRecord {
  return updateJob(sessionId, {
    status: "failed",
    error,
  });
}

export function markCallActivitySyncSkipped(
  sessionId: string,
  error: string,
): CallActivitySyncRecord {
  return updateJob(sessionId, {
    status: "skipped",
    error,
  });
}

export function markCallActivitySyncSynced(
  sessionId: string,
  input: {
    activityId: string | null;
  },
): CallActivitySyncRecord {
  return updateJob(sessionId, {
    status: "synced",
    activityId: input.activityId,
    error: null,
  });
}

export function markCallActivitySyncRecordingDeleted(
  sessionId: string,
  deletedAt = new Date().toISOString(),
): CallActivitySyncRecord {
  return updateJob(sessionId, {
    recordingDeletedAt: deletedAt,
  });
}
