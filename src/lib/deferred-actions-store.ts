import { getReadModelDb } from "@/lib/read-model/db";
import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { upsertDeferredActionAuditEvents } from "@/lib/audit-log-store";
import {
  applyDeferredContactOperationToRows,
  getDeferredActionAccountKey,
  type DeferredMergeContactsFieldSnapshot,
  type DeferredContactOperationPreview,
} from "@/lib/deferred-contact-operations";
import { publishDeferredActionsChanged } from "@/lib/deferred-actions-live";
import { CONTACT_MERGE_FIELD_KEYS } from "@/types/contact-merge";
import type { BusinessAccountRow } from "@/types/business-account";
import type {
  DeferredActionCounts,
  DeferredActionListResponse,
  DeferredActionStatus,
  DeferredActionSummary,
} from "@/types/deferred-action";

export const DEFERRED_ACTION_TIME_ZONE = "America/Toronto";
export const DEFAULT_DEFERRED_ACTION_MAX_ATTEMPTS = 5;
export const DEFERRED_ACTION_EXECUTION_BATCH_LIMIT = 50;
export const DEFERRED_ACTION_STALE_EXECUTING_AFTER_MS = 15 * 60 * 1000;

const ACTIVE_PREVIEW_STATUSES = new Set<DeferredActionStatus>([
  "pending_review",
  "approved",
  "executing",
  "failed",
]);

const ACTIVE_QUEUE_STATUSES = new Set<DeferredActionStatus>([
  "pending_review",
  "approved",
  "executing",
]);

type DeferredActionActor = {
  loginName: string | null;
  name: string | null;
};

type StoredDeferredAction = {
  id: string;
  action_type: string;
  status: DeferredActionStatus;
  source_surface: string;
  business_account_record_id: string | null;
  business_account_id: string | null;
  company_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  contact_row_key: string | null;
  kept_contact_id: number | null;
  kept_contact_name: string | null;
  loser_contact_ids_json: string;
  loser_contact_names_json: string;
  affected_fields_json: string;
  reason: string | null;
  payload_json: string;
  preview_json: string;
  requested_by_login_name: string | null;
  requested_by_name: string | null;
  requested_at: string;
  execute_after_at: string;
  attempt_count: number;
  max_attempts: number;
  last_attempt_at: string | null;
  approved_by_login_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  cancelled_by_login_name: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  executed_by_login_name: string | null;
  executed_by_name: string | null;
  executed_at: string | null;
  failure_message: string | null;
  updated_at: string;
};

export type StoredDeferredActionRecord = {
  id: string;
  actionType: DeferredActionSummary["actionType"];
  status: DeferredActionStatus;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  contactId: number | null;
  contactName: string | null;
  contactRowKey: string | null;
  keptContactId: number | null;
  keptContactName: string | null;
  loserContactIds: number[];
  loserContactNames: string[];
  affectedFields: string[];
  reason: string | null;
  payloadJson: string;
  preview: DeferredContactOperationPreview;
  requestedByLoginName: string | null;
  requestedByName: string | null;
  requestedAt: string;
  executeAfterAt: string;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  sourceSurface: string;
  approvedByLoginName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  cancelledByLoginName: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  executedByLoginName: string | null;
  executedByName: string | null;
  executedAt: string | null;
  failureMessage: string | null;
  updatedAt: string;
};

type EnqueueDeferredDeleteContactInput = {
  sourceSurface: string;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  contactId: number;
  contactName: string | null;
  contactRowKey: string | null;
  reason: string;
  actor: DeferredActionActor;
};

type EnqueueDeferredMergeContactsInput = {
  sourceSurface: string;
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  keptContactId: number;
  keptContactName: string | null;
  loserContactIds: number[];
  loserContactNames: string[];
  affectedFields: string[];
  actor: DeferredActionActor;
  payloadJson: string;
  preview: DeferredContactOperationPreview;
};

function parseJsonArray<T>(value: string, predicate: (item: unknown) => item is T): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(predicate);
  } catch {
    return [];
  }
}

function parsePreview(
  actionType: string,
  previewJson: string,
): DeferredContactOperationPreview | null {
  try {
    const parsed = JSON.parse(previewJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (actionType === "deleteContact") {
      const contactId = Number(record.contactId);
      if (!Number.isInteger(contactId) || contactId <= 0) {
        return null;
      }

      return {
        actionType: "deleteContact",
        contactId,
        rowKey: typeof record.rowKey === "string" ? record.rowKey : null,
      };
    }

    if (actionType !== "mergeContacts") {
      return null;
    }

    const keepContactId = Number(record.keepContactId);
    if (!Number.isInteger(keepContactId) || keepContactId <= 0) {
      return null;
    }

    const mergedFields =
      record.mergedFields && typeof record.mergedFields === "object"
        ? (Object.fromEntries(
            CONTACT_MERGE_FIELD_KEYS.flatMap((field) => {
              if (!Object.prototype.hasOwnProperty.call(record.mergedFields, field)) {
                return [];
              }

              const value = (record.mergedFields as Record<string, unknown>)[field];
              if (typeof value !== "string" && value !== null) {
                return [];
              }

              return [[field, value ?? null] as const];
            }),
          ) as DeferredMergeContactsFieldSnapshot)
        : null;

    return {
      actionType: "mergeContacts",
      keepContactId,
      loserContactIds: Array.isArray(record.loserContactIds)
        ? record.loserContactIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [],
      setKeptAsPrimary: record.setKeptAsPrimary === true,
      mergedFields,
      mergedPrimaryContactName:
        typeof record.mergedPrimaryContactName === "string"
          ? record.mergedPrimaryContactName
          : null,
      mergedPrimaryContactJobTitle:
        typeof record.mergedPrimaryContactJobTitle === "string"
          ? record.mergedPrimaryContactJobTitle
          : null,
      mergedPrimaryContactPhone:
        typeof record.mergedPrimaryContactPhone === "string"
          ? record.mergedPrimaryContactPhone
          : null,
      mergedPrimaryContactEmail:
        typeof record.mergedPrimaryContactEmail === "string"
          ? record.mergedPrimaryContactEmail
          : null,
      mergedNotes: typeof record.mergedNotes === "string" ? record.mergedNotes : null,
    };
  } catch {
    return null;
  }
}

function toStoredRecord(row: StoredDeferredAction): StoredDeferredActionRecord | null {
  const actionType =
    row.action_type === "mergeContacts" ? "mergeContacts" : row.action_type === "deleteContact"
      ? "deleteContact"
      : null;
  if (!actionType) {
    return null;
  }

  const preview = parsePreview(actionType, row.preview_json);
  if (!preview) {
    return null;
  }

  return {
    id: row.id,
    actionType,
    status: row.status,
    businessAccountRecordId: row.business_account_record_id,
    businessAccountId: row.business_account_id,
    companyName: row.company_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactRowKey: row.contact_row_key,
    keptContactId: row.kept_contact_id,
    keptContactName: row.kept_contact_name,
    loserContactIds: parseJsonArray(row.loser_contact_ids_json, (item): item is number =>
      Number.isInteger(item),
    ),
    loserContactNames: parseJsonArray(row.loser_contact_names_json, (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
    ),
    affectedFields: parseJsonArray(row.affected_fields_json, (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
    ),
    reason: row.reason?.trim() || null,
    payloadJson: row.payload_json,
    preview,
    requestedByLoginName: row.requested_by_login_name,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    executeAfterAt: row.execute_after_at,
    attemptCount:
      Number.isInteger(row.attempt_count) && row.attempt_count >= 0 ? row.attempt_count : 0,
    maxAttempts:
      Number.isInteger(row.max_attempts) && row.max_attempts > 0
        ? row.max_attempts
        : DEFAULT_DEFERRED_ACTION_MAX_ATTEMPTS,
    lastAttemptAt: row.last_attempt_at,
    sourceSurface: row.source_surface,
    approvedByLoginName: row.approved_by_login_name,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    cancelledByLoginName: row.cancelled_by_login_name,
    cancelledByName: row.cancelled_by_name,
    cancelledAt: row.cancelled_at,
    executedByLoginName: row.executed_by_login_name,
    executedByName: row.executed_by_name,
    executedAt: row.executed_at,
    failureMessage: row.failure_message,
    updatedAt: row.updated_at,
  };
}

function toSummary(record: StoredDeferredActionRecord): DeferredActionSummary {
  return {
    id: record.id,
    actionType: record.actionType,
    status: record.status,
    sourceSurface: record.sourceSurface,
    businessAccountRecordId: record.businessAccountRecordId,
    businessAccountId: record.businessAccountId,
    companyName: record.companyName,
    contactId: record.contactId,
    contactName: record.contactName,
    keptContactId: record.keptContactId,
    keptContactName: record.keptContactName,
    loserContactIds: record.loserContactIds,
    loserContactNames: record.loserContactNames,
    affectedFields: record.affectedFields,
    reason: record.reason,
    requestedByLoginName: record.requestedByLoginName,
    requestedByName: record.requestedByName,
    approvedByLoginName: record.approvedByLoginName,
    approvedByName: record.approvedByName,
    cancelledByLoginName: record.cancelledByLoginName,
    cancelledByName: record.cancelledByName,
    requestedAt: record.requestedAt,
    executeAfterAt: record.executeAfterAt,
    approvedAt: record.approvedAt,
    cancelledAt: record.cancelledAt,
    executedAt: record.executedAt,
    failureMessage: record.failureMessage,
  };
}

function buildCounts(items: DeferredActionSummary[]): DeferredActionCounts {
  return {
    pending_review: items.filter((item) => item.status === "pending_review").length,
    approved: items.filter((item) => item.status === "approved").length,
    cancelled: items.filter((item) => item.status === "cancelled").length,
    executing: items.filter((item) => item.status === "executing").length,
    executed: items.filter((item) => item.status === "executed").length,
    failed: items.filter((item) => item.status === "failed").length,
  };
}

function readStoredActions(): StoredDeferredActionRecord[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        id,
        action_type,
        status,
        source_surface,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name,
        contact_row_key,
        kept_contact_id,
        kept_contact_name,
        loser_contact_ids_json,
        loser_contact_names_json,
        affected_fields_json,
        reason,
        payload_json,
        preview_json,
        requested_by_login_name,
        requested_by_name,
        requested_at,
        execute_after_at,
        attempt_count,
        max_attempts,
        last_attempt_at,
        approved_by_login_name,
        approved_by_name,
        approved_at,
        cancelled_by_login_name,
        cancelled_by_name,
        cancelled_at,
        executed_by_login_name,
        executed_by_name,
        executed_at,
        failure_message,
        updated_at
      FROM deferred_actions
      ORDER BY execute_after_at ASC, requested_at DESC, id DESC
      `,
    )
    .all() as StoredDeferredAction[];

  return rows
    .map((row) => toStoredRecord(row))
    .filter((row): row is StoredDeferredActionRecord => row !== null);
}

export function listStoredDeferredActionRecords(): StoredDeferredActionRecord[] {
  return readStoredActions();
}

export function getStoredDeferredActionById(actionId: string): StoredDeferredActionRecord | null {
  return readStoredActions().find((record) => record.id === actionId) ?? null;
}

function toTorontoParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFERRED_ACTION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdayValue = read("weekday").toLowerCase();
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: weekdayMap[weekdayValue] ?? 0,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const utcMs = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return utcMs - date.getTime();
}

function zonedDateTimeToUtc(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}, timeZone: string): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  let targetMs = utcGuess - offsetMs;
  const resolvedOffsetMs = getTimeZoneOffsetMs(new Date(targetMs), timeZone);
  if (resolvedOffsetMs !== offsetMs) {
    targetMs = utcGuess - resolvedOffsetMs;
  }
  return new Date(targetMs);
}

export function computeNextDeferredExecutionAt(now = new Date()): string {
  const current = toTorontoParts(now);
  let daysUntilFriday = (5 - current.weekday + 7) % 7;
  const afterCutoff =
    current.weekday === 5 &&
    (
      current.hour > 17 ||
      (current.hour === 17 &&
        (current.minute > 0 || (current.minute === 0 && current.second > 0)))
    );

  if (daysUntilFriday === 0 && afterCutoff) {
    daysUntilFriday = 7;
  }

  const target = zonedDateTimeToUtc(
    {
      year: current.year,
      month: current.month,
      day: current.day + daysUntilFriday,
      hour: 17,
      minute: 0,
      second: 0,
    },
    DEFERRED_ACTION_TIME_ZONE,
  );

  return target.toISOString();
}

function buildActionId(): string {
  return crypto.randomUUID();
}

export function listDeferredActionSummaries(): DeferredActionSummary[] {
  return readStoredActions().map((record) => toSummary(record));
}

export function buildDeferredActionListResponse(
  executedNowCount = 0,
  failedNowCount = 0,
): DeferredActionListResponse {
  const items = listDeferredActionSummaries();
  return {
    items,
    counts: buildCounts(items),
    now: new Date().toISOString(),
    executeTimeZone: DEFERRED_ACTION_TIME_ZONE,
    executedNowCount,
    failedNowCount,
  };
}

export function hasDueApprovedDeferredActions(asOf = new Date().toISOString()): boolean {
  const db = getReadModelDb();
  const record = db
    .prepare(
      `
      SELECT 1
      FROM deferred_actions
      WHERE status = 'approved'
        AND execute_after_at <= ?
      LIMIT 1
      `,
    )
    .get(asOf) as { 1: number } | undefined;

  return Boolean(record);
}

export function listDueApprovedDeferredActions(
  asOf = new Date().toISOString(),
): StoredDeferredActionRecord[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        id,
        action_type,
        status,
        source_surface,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name,
        contact_row_key,
        kept_contact_id,
        kept_contact_name,
        loser_contact_ids_json,
        loser_contact_names_json,
        affected_fields_json,
        reason,
        payload_json,
        preview_json,
        requested_by_login_name,
        requested_by_name,
        requested_at,
        execute_after_at,
        attempt_count,
        max_attempts,
        last_attempt_at,
        approved_by_login_name,
        approved_by_name,
        approved_at,
        cancelled_by_login_name,
        cancelled_by_name,
        cancelled_at,
        executed_by_login_name,
        executed_by_name,
        executed_at,
        failure_message,
        updated_at
      FROM deferred_actions
      WHERE status = 'approved'
        AND execute_after_at <= ?
      ORDER BY execute_after_at ASC, requested_at ASC, id ASC
      LIMIT ?
      `,
    )
    .all(asOf, DEFERRED_ACTION_EXECUTION_BATCH_LIMIT) as StoredDeferredAction[];

  return rows
    .map((row) => toStoredRecord(row))
    .filter((row): row is StoredDeferredActionRecord => row !== null);
}

export function listStaleExecutingDeferredActions(
  staleBefore = new Date(Date.now() - DEFERRED_ACTION_STALE_EXECUTING_AFTER_MS).toISOString(),
): StoredDeferredActionRecord[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        id,
        action_type,
        status,
        source_surface,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name,
        contact_row_key,
        kept_contact_id,
        kept_contact_name,
        loser_contact_ids_json,
        loser_contact_names_json,
        affected_fields_json,
        reason,
        payload_json,
        preview_json,
        requested_by_login_name,
        requested_by_name,
        requested_at,
        execute_after_at,
        attempt_count,
        max_attempts,
        last_attempt_at,
        approved_by_login_name,
        approved_by_name,
        approved_at,
        cancelled_by_login_name,
        cancelled_by_name,
        cancelled_at,
        executed_by_login_name,
        executed_by_name,
        executed_at,
        failure_message,
        updated_at
      FROM deferred_actions
      WHERE status = 'executing'
        AND updated_at <= ?
      ORDER BY updated_at ASC, requested_at ASC, id ASC
      LIMIT ?
      `,
    )
    .all(staleBefore, DEFERRED_ACTION_EXECUTION_BATCH_LIMIT) as StoredDeferredAction[];

  return rows
    .map((row) => toStoredRecord(row))
    .filter((row): row is StoredDeferredActionRecord => row !== null);
}

export function hasRunnableDeferredActions(
  asOf = new Date().toISOString(),
  staleBefore = new Date(Date.now() - DEFERRED_ACTION_STALE_EXECUTING_AFTER_MS).toISOString(),
): boolean {
  const db = getReadModelDb();
  const record = db
    .prepare(
      `
      SELECT 1
      FROM deferred_actions
      WHERE (status = 'approved' AND execute_after_at <= ?)
         OR (status = 'executing' AND updated_at <= ?)
      LIMIT 1
      `,
    )
    .get(asOf, staleBefore) as { 1: number } | undefined;

  return Boolean(record);
}

export function enqueueDeferredContactDeleteAction(
  input: EnqueueDeferredDeleteContactInput,
): {
  id: string;
  executeAfterAt: string;
} {
  const db = getReadModelDb();
  const reason = input.reason.trim();
  const existing = db
    .prepare(
      `
      SELECT id, execute_after_at
      FROM deferred_actions
      WHERE action_type = 'deleteContact'
        AND contact_id = ?
        AND status IN ('pending_review', 'approved', 'executing', 'failed')
      ORDER BY requested_at DESC
      LIMIT 1
      `,
    )
    .get(input.contactId) as { id: string; execute_after_at: string } | undefined;

  if (existing) {
    db.prepare(
      `
      UPDATE deferred_actions
      SET reason = ?,
          payload_json = ?,
          updated_at = ?
      WHERE id = ?
      `,
    ).run(
      reason,
      JSON.stringify({
        contactId: input.contactId,
        reason,
      }),
      new Date().toISOString(),
      existing.id,
    );
    invalidateReadModelCaches();
    publishDeferredActionsChanged("queued-delete");
    const record = getStoredDeferredActionById(existing.id);
    if (record) {
      upsertDeferredActionAuditEvents(record);
    }
    return {
      id: existing.id,
      executeAfterAt: existing.execute_after_at,
    };
  }

  const id = buildActionId();
  const now = new Date().toISOString();
  const executeAfterAt = computeNextDeferredExecutionAt();
  const preview = {
    actionType: "deleteContact",
    contactId: input.contactId,
    rowKey: input.contactRowKey,
  } as const;

  db.prepare(
    `
    INSERT INTO deferred_actions (
      id,
      action_type,
      status,
      source_surface,
      business_account_record_id,
      business_account_id,
      company_name,
      contact_id,
      contact_name,
      contact_row_key,
      kept_contact_id,
      kept_contact_name,
      loser_contact_ids_json,
      loser_contact_names_json,
      affected_fields_json,
      reason,
      payload_json,
      preview_json,
      requested_by_login_name,
      requested_by_name,
      requested_at,
      execute_after_at,
      attempt_count,
      max_attempts,
      last_attempt_at,
      updated_at
    ) VALUES (?, 'deleteContact', 'pending_review', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
    `,
  ).run(
    id,
    input.sourceSurface,
    input.businessAccountRecordId,
    input.businessAccountId,
    input.companyName,
    input.contactId,
    input.contactName,
    input.contactRowKey,
    JSON.stringify(["Contact record"]),
    reason,
    JSON.stringify({
      contactId: input.contactId,
      reason,
    }),
    JSON.stringify(preview),
    input.actor.loginName,
    input.actor.name,
    now,
    executeAfterAt,
    DEFAULT_DEFERRED_ACTION_MAX_ATTEMPTS,
    now,
  );

  invalidateReadModelCaches();
  publishDeferredActionsChanged("queued-delete");
  const record = getStoredDeferredActionById(id);
  if (record) {
    upsertDeferredActionAuditEvents(record);
  }
  return {
    id,
    executeAfterAt,
  };
}

function normalizeContactIdSet(contactIds: number[]): number[] {
  return [...new Set(contactIds.filter((value) => Number.isInteger(value) && value > 0))].sort(
    (left, right) => left - right,
  );
}

function findMatchingActiveMergeAction(
  input: EnqueueDeferredMergeContactsInput,
): StoredDeferredActionRecord | null {
  const normalizedLoserIds = normalizeContactIdSet(input.loserContactIds);
  return readStoredActions().find((record) => {
    if (
      record.actionType !== "mergeContacts" ||
      !ACTIVE_QUEUE_STATUSES.has(record.status) ||
      record.businessAccountRecordId !== input.businessAccountRecordId ||
      record.keptContactId !== input.keptContactId
    ) {
      return false;
    }

    const recordLoserIds = normalizeContactIdSet(record.loserContactIds);
    if (recordLoserIds.length !== normalizedLoserIds.length) {
      return false;
    }

    return recordLoserIds.every((contactId, index) => contactId === normalizedLoserIds[index]);
  }) ?? null;
}

export function enqueueDeferredMergeContactsAction(
  input: EnqueueDeferredMergeContactsInput,
): {
  id: string;
  executeAfterAt: string;
} {
  const existing = findMatchingActiveMergeAction(input);
  if (existing) {
    return {
      id: existing.id,
      executeAfterAt: existing.executeAfterAt,
    };
  }

  const db = getReadModelDb();
  const id = buildActionId();
  const now = new Date().toISOString();
  const executeAfterAt = computeNextDeferredExecutionAt();

  db.prepare(
    `
    INSERT INTO deferred_actions (
      id,
      action_type,
      status,
      source_surface,
      business_account_record_id,
      business_account_id,
      company_name,
      contact_id,
      contact_name,
      contact_row_key,
      kept_contact_id,
      kept_contact_name,
      loser_contact_ids_json,
      loser_contact_names_json,
      affected_fields_json,
      reason,
      payload_json,
      preview_json,
      requested_by_login_name,
      requested_by_name,
      requested_at,
      execute_after_at,
      attempt_count,
      max_attempts,
      last_attempt_at,
      updated_at
    ) VALUES (?, 'mergeContacts', 'pending_review', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
    `,
  ).run(
    id,
    input.sourceSurface,
    input.businessAccountRecordId,
    input.businessAccountId,
    input.companyName,
    input.keptContactId,
    input.keptContactName,
    JSON.stringify(input.loserContactIds),
    JSON.stringify(input.loserContactNames),
    JSON.stringify(input.affectedFields),
    input.payloadJson,
    JSON.stringify(input.preview),
    input.actor.loginName,
    input.actor.name,
    now,
    executeAfterAt,
    DEFAULT_DEFERRED_ACTION_MAX_ATTEMPTS,
    now,
  );

  invalidateReadModelCaches();
  publishDeferredActionsChanged("queued-merge");
  const record = getStoredDeferredActionById(id);
  if (record) {
    upsertDeferredActionAuditEvents(record);
  }
  return {
    id,
    executeAfterAt,
  };
}

function updateStatuses(
  actionIds: string[],
  nextStatus: "approved" | "cancelled",
  actor: DeferredActionActor,
): number {
  const uniqueIds = [...new Set(actionIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return 0;
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const result =
    nextStatus === "approved"
      ? db
          .prepare(
            `
            UPDATE deferred_actions
            SET status = 'approved',
                approved_by_login_name = ?,
                approved_by_name = ?,
                approved_at = ?,
                updated_at = ?
            WHERE id IN (${placeholders})
              AND status = 'pending_review'
            `,
          )
          .run(actor.loginName, actor.name, now, now, ...uniqueIds)
      : db
          .prepare(
            `
            UPDATE deferred_actions
            SET status = 'cancelled',
                cancelled_by_login_name = ?,
                cancelled_by_name = ?,
                cancelled_at = ?,
                failure_message = NULL,
                updated_at = ?
            WHERE id IN (${placeholders})
              AND status IN ('pending_review', 'approved', 'failed')
            `,
          )
          .run(actor.loginName, actor.name, now, now, ...uniqueIds);

  if (result.changes > 0) {
    invalidateReadModelCaches();
    publishDeferredActionsChanged(nextStatus === "approved" ? "approved" : "cancelled");
    uniqueIds.forEach((id) => {
      const record = getStoredDeferredActionById(id);
      if (record) {
        upsertDeferredActionAuditEvents(record);
      }
    });
  }

  return result.changes;
}

export function approveDeferredActions(
  actionIds: string[],
  actor: DeferredActionActor,
): number {
  return updateStatuses(actionIds, "approved", actor);
}

export function cancelDeferredActions(
  actionIds: string[],
  actor: DeferredActionActor,
): number {
  return updateStatuses(actionIds, "cancelled", actor);
}

export function markDeferredActionExecuting(
  actionId: string,
  actor: DeferredActionActor,
): boolean {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE deferred_actions
      SET status = 'executing',
          executed_by_login_name = ?,
          executed_by_name = ?,
          attempt_count = COALESCE(attempt_count, 0) + 1,
          last_attempt_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'approved'
        AND COALESCE(attempt_count, 0) < COALESCE(max_attempts, ?)
      `,
    )
    .run(
      actor.loginName,
      actor.name,
      now,
      now,
      actionId,
      DEFAULT_DEFERRED_ACTION_MAX_ATTEMPTS,
    );

  if (result.changes > 0) {
    invalidateReadModelCaches();
    publishDeferredActionsChanged("executing");
  }

  return result.changes > 0;
}

export function markDeferredActionRetryScheduled(
  actionId: string,
  actor: DeferredActionActor,
  failureMessage: string,
  executeAfterAt: string,
): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE deferred_actions
    SET status = 'approved',
        executed_by_login_name = ?,
        executed_by_name = ?,
        executed_at = NULL,
        failure_message = ?,
        execute_after_at = ?,
        updated_at = ?
    WHERE id = ?
    `,
  ).run(actor.loginName, actor.name, failureMessage, executeAfterAt, now, actionId);
  invalidateReadModelCaches();
  publishDeferredActionsChanged("approved");
  const record = getStoredDeferredActionById(actionId);
  if (record) {
    upsertDeferredActionAuditEvents(record);
  }
}

export function markDeferredActionExecuted(
  actionId: string,
  actor: DeferredActionActor,
): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE deferred_actions
    SET status = 'executed',
        executed_by_login_name = ?,
        executed_by_name = ?,
        executed_at = ?,
        failure_message = NULL,
        updated_at = ?
    WHERE id = ?
    `,
  ).run(actor.loginName, actor.name, now, now, actionId);
  invalidateReadModelCaches();
  publishDeferredActionsChanged("executed");
  const record = getStoredDeferredActionById(actionId);
  if (record) {
    upsertDeferredActionAuditEvents(record);
  }
}

export function markDeferredActionFailed(
  actionId: string,
  actor: DeferredActionActor,
  failureMessage: string,
): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE deferred_actions
    SET status = 'failed',
        executed_by_login_name = ?,
        executed_by_name = ?,
        failure_message = ?,
        updated_at = ?
    WHERE id = ?
    `,
  ).run(actor.loginName, actor.name, failureMessage, now, actionId);
  invalidateReadModelCaches();
  publishDeferredActionsChanged("failed");
  const record = getStoredDeferredActionById(actionId);
  if (record) {
    upsertDeferredActionAuditEvents(record);
  }
}

function resolveActionAccountKey(action: StoredDeferredActionRecord): string {
  return action.businessAccountRecordId?.trim() || action.businessAccountId?.trim() || "";
}

export function getActiveDeferredActionPreviews(): Array<{
  id: string;
  accountKey: string;
  requestedAt: string;
  preview: DeferredContactOperationPreview;
}> {
  return readStoredActions()
    .filter((record) => ACTIVE_PREVIEW_STATUSES.has(record.status))
    .map((record) => ({
      id: record.id,
      accountKey: resolveActionAccountKey(record),
      requestedAt: record.requestedAt,
      preview: record.preview,
    }))
    .filter((record) => record.accountKey.length > 0)
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

export function applyDeferredActionsToRows(rows: BusinessAccountRow[]): BusinessAccountRow[] {
  const activeActions = getActiveDeferredActionPreviews();
  if (activeActions.length === 0 || rows.length === 0) {
    return rows;
  }

  const rowsByAccount = new Map<string, BusinessAccountRow[]>();
  const accountOrder: string[] = [];
  rows.forEach((row) => {
    const key = getDeferredActionAccountKey(row);
    const existing = rowsByAccount.get(key);
    if (existing) {
      existing.push(row);
      return;
    }

    rowsByAccount.set(key, [row]);
    accountOrder.push(key);
  });

  const actionsByAccount = new Map<string, typeof activeActions>();
  activeActions.forEach((action) => {
    const existing = actionsByAccount.get(action.accountKey);
    if (existing) {
      existing.push(action);
      return;
    }
    actionsByAccount.set(action.accountKey, [action]);
  });

  const transformedRows: BusinessAccountRow[] = [];
  for (const accountKey of accountOrder) {
    const accountRows = rowsByAccount.get(accountKey) ?? [];
    const actions = actionsByAccount.get(accountKey) ?? [];
    const nextRows = actions.reduce(
      (currentRows, action) => applyDeferredContactOperationToRows(currentRows, action.preview),
      accountRows,
    );
    transformedRows.push(...nextRows);
  }

  return transformedRows;
}

export function createDeferredActionActor(input: DeferredActionActor): DeferredActionActor {
  return {
    loginName: input.loginName?.trim() || null,
    name: input.name?.trim() || null,
  };
}
