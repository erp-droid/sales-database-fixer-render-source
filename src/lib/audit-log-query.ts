import type { AuditActorOption, AuditLogLink, AuditLogResponse, AuditLogRow, AuditQuery } from "@/lib/audit-log-types";
import { readCallSessions } from "@/lib/call-analytics/sessionize";
import { listStoredDeferredActionRecords } from "@/lib/deferred-actions-store";
import { upsertCallAuditEvent, upsertDeferredActionAuditEvents, upsertMeetingAuditEvent } from "@/lib/audit-log-store";
import { listMeetingBookings } from "@/lib/meeting-bookings";
import { getReadModelDb } from "@/lib/read-model/db";

type StoredAuditEventRow = {
  id: string;
  occurred_at: string;
  item_type: AuditLogRow["itemType"];
  action_group: AuditLogRow["actionGroup"];
  result_code: AuditLogRow["resultCode"];
  actor_login_name: string | null;
  actor_name: string | null;
  source_surface: string | null;
  summary: string;
  business_account_record_id: string | null;
  business_account_id: string | null;
  company_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  phone_number: string | null;
  email_subject: string | null;
  email_thread_id: string | null;
  email_message_id: string | null;
  call_session_id: string | null;
  call_direction: string | null;
  activity_sync_status: string | null;
  created_at: string;
  updated_at: string;
};

type StoredAuditFieldRow = {
  audit_event_id: string;
  field_key: string;
  field_label: string;
};

type StoredAuditLinkRow = {
  audit_event_id: string;
  link_type: AuditLogLink["linkType"];
  role: AuditLogLink["role"];
  business_account_record_id: string | null;
  business_account_id: string | null;
  company_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
};

let bootstrapChecked = false;

function normalizePage(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function buildAuditLogRow(
  row: StoredAuditEventRow,
  fields: StoredAuditFieldRow[],
  links: StoredAuditLinkRow[],
): AuditLogRow {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    itemType: row.item_type,
    actionGroup: row.action_group,
    resultCode: row.result_code,
    actorLoginName: row.actor_login_name,
    actorName: row.actor_name,
    sourceSurface: row.source_surface,
    summary: row.summary,
    businessAccountRecordId: row.business_account_record_id,
    businessAccountId: row.business_account_id,
    companyName: row.company_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    phoneNumber: row.phone_number,
    emailSubject: row.email_subject,
    emailThreadId: row.email_thread_id,
    emailMessageId: row.email_message_id,
    callSessionId: row.call_session_id,
    callDirection: row.call_direction,
    activitySyncStatus: row.activity_sync_status,
    affectedFields: fields.map((field) => ({
      key: field.field_key,
      label: field.field_label,
    })),
    links: links.map((link) => ({
      linkType: link.link_type,
      role: link.role,
      businessAccountRecordId: link.business_account_record_id,
      businessAccountId: link.business_account_id,
      companyName: link.company_name,
      contactId: link.contact_id,
      contactName: link.contact_name,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureAuditBootstrap(): void {
  if (!bootstrapChecked) {
    bootstrapChecked = true;
    for (const session of readCallSessions()) {
      upsertCallAuditEvent(session);
    }

    for (const record of listStoredDeferredActionRecords()) {
      upsertDeferredActionAuditEvents(record);
    }
  }

  for (const booking of listMeetingBookings()) {
    upsertMeetingAuditEvent(booking);
  }
}

function buildDateToUpperBound(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString();
}

export function listAuditActors(): AuditActorOption[] {
  ensureAuditBootstrap();
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT DISTINCT
        actor_login_name,
        actor_name
      FROM audit_events
      WHERE COALESCE(actor_login_name, actor_name) IS NOT NULL
      ORDER BY COALESCE(actor_name, actor_login_name) COLLATE NOCASE ASC
      `,
    )
    .all() as Array<{
    actor_login_name: string | null;
    actor_name: string | null;
  }>;

  return rows.map((row) => ({
    loginName: row.actor_login_name,
    name: row.actor_name,
    label: row.actor_name?.trim() || row.actor_login_name?.trim() || "Unknown",
  }));
}

export function queryAuditLog(query: AuditQuery): AuditLogResponse {
  ensureAuditBootstrap();
  const db = getReadModelDb();
  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(200, normalizePage(query.pageSize, 50));
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (query.q.trim()) {
    where.push(`audit_events.search_text LIKE ?`);
    params.push(`%${query.q.trim().toLowerCase()}%`);
  }
  if (query.itemType !== "all") {
    where.push(`audit_events.item_type = ?`);
    params.push(query.itemType);
  }
  if (query.actionGroup !== "all") {
    where.push(`audit_events.action_group = ?`);
    params.push(query.actionGroup);
  }
  if (query.result !== "all") {
    where.push(`audit_events.result_code = ?`);
    params.push(query.result);
  }
  if (query.actor.trim()) {
    where.push(`audit_events.actor_login_name = ?`);
    params.push(query.actor.trim());
  }
  if (query.dateFrom?.trim()) {
    where.push(`audit_events.occurred_at >= ?`);
    params.push(query.dateFrom.trim());
  }
  if (query.dateTo?.trim()) {
    where.push(`audit_events.occurred_at <= ?`);
    params.push(buildDateToUpperBound(query.dateTo));
  }
  if (query.businessAccountRecordId?.trim()) {
    where.push(
      `(audit_events.business_account_record_id = ? OR EXISTS (
        SELECT 1
        FROM audit_event_links
        WHERE audit_event_links.audit_event_id = audit_events.id
          AND audit_event_links.business_account_record_id = ?
      ))`,
    );
    params.push(query.businessAccountRecordId.trim(), query.businessAccountRecordId.trim());
  }
  if (query.contactId !== null) {
    where.push(
      `(audit_events.contact_id = ? OR EXISTS (
        SELECT 1
        FROM audit_event_links
        WHERE audit_event_links.audit_event_id = audit_events.id
          AND audit_event_links.contact_id = ?
      ))`,
    );
    params.push(query.contactId, query.contactId);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const countRow = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM audit_events
      ${whereClause}
      `,
    )
    .get(...params) as { count: number };
  const total = countRow.count;
  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(
      `
      SELECT
        id,
        occurred_at,
        item_type,
        action_group,
        result_code,
        actor_login_name,
        actor_name,
        source_surface,
        summary,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name,
        phone_number,
        email_subject,
        email_thread_id,
        email_message_id,
        call_session_id,
        call_direction,
        activity_sync_status,
        created_at,
        updated_at
      FROM audit_events
      ${whereClause}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ? OFFSET ?
      `,
    )
    .all(...params, pageSize, offset) as StoredAuditEventRow[];

  if (rows.length === 0) {
    return {
      items: [],
      total,
      page,
      pageSize,
      actors: listAuditActors(),
    };
  }

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const fieldRows = db
    .prepare(
      `
      SELECT
        audit_event_id,
        field_key,
        field_label
      FROM audit_event_fields
      WHERE audit_event_id IN (${placeholders})
      ORDER BY field_label COLLATE NOCASE ASC
      `,
    )
    .all(...ids) as StoredAuditFieldRow[];
  const linkRows = db
    .prepare(
      `
      SELECT
        audit_event_id,
        link_type,
        role,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name
      FROM audit_event_links
      WHERE audit_event_id IN (${placeholders})
      ORDER BY role ASC, company_name COLLATE NOCASE ASC, contact_name COLLATE NOCASE ASC
      `,
    )
    .all(...ids) as StoredAuditLinkRow[];

  const fieldsByEventId = new Map<string, StoredAuditFieldRow[]>();
  fieldRows.forEach((row) => {
    const existing = fieldsByEventId.get(row.audit_event_id) ?? [];
    existing.push(row);
    fieldsByEventId.set(row.audit_event_id, existing);
  });
  const linksByEventId = new Map<string, StoredAuditLinkRow[]>();
  linkRows.forEach((row) => {
    const existing = linksByEventId.get(row.audit_event_id) ?? [];
    existing.push(row);
    linksByEventId.set(row.audit_event_id, existing);
  });

  return {
    items: rows.map((row) =>
      buildAuditLogRow(row, fieldsByEventId.get(row.id) ?? [], linksByEventId.get(row.id) ?? []),
    ),
    total,
    page,
    pageSize,
    actors: listAuditActors(),
  };
}

export function queryAuditHistoryForRecord(input: {
  businessAccountRecordId: string | null;
  contactId: number | null;
  limit: number;
}): AuditLogRow[] {
  const response = queryAuditLog({
    q: "",
    itemType: "all",
    actionGroup: "all",
    result: "all",
    actor: "",
    dateFrom: null,
    dateTo: null,
    businessAccountRecordId: input.businessAccountRecordId,
    contactId: input.contactId,
    page: 1,
    pageSize: Math.max(1, input.limit),
  });

  return response.items;
}
