import crypto from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getEnv } from "@/lib/env";
import { getReadModelDb } from "@/lib/read-model/db";
import {
  normalizeSupportAttachmentMimeType,
  supportAttachmentStorageExtension,
} from "@/lib/support-ticket-attachment-policy";
import type {
  SupportTicketCategory,
  SupportTicketImpact,
  SupportTicketStatus,
  SupportTicketSummary,
  SupportTicketUnderstanding,
} from "@/types/support-ticket";

export type SupportTicketRecord = SupportTicketSummary & {
  description: string;
  expectedBehavior: string | null;
  stepsToReproduce: string | null;
  pageUrl: string | null;
  submittedByLogin: string;
  emailThreadId: string | null;
  emailMessageId: string | null;
  lastIncomingMessageAt: string | null;
  diagnosis: string | null;
  resolution: string | null;
  processingAttempts: number;
  processingStartedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  lastActionKey: string | null;
};

export type SupportTicketEvent = {
  id: string;
  ticketId: string;
  eventType: string;
  actorType: string;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

type TicketRow = {
  id: string;
  ticket_number: number;
  title: string;
  category: SupportTicketCategory;
  impact: SupportTicketImpact;
  status: SupportTicketStatus;
  employee_name: string;
  employee_email: string;
  description: string;
  expected_behavior: string | null;
  steps_to_reproduce: string | null;
  page_url: string | null;
  submitted_by_login: string;
  email_thread_id: string | null;
  email_message_id: string | null;
  last_incoming_message_at: string | null;
  diagnosis: string | null;
  resolution: string | null;
  processing_attempts: number;
  processing_started_at: string | null;
  next_check_at: string | null;
  last_error: string | null;
  clarification_rounds: number;
  remediation_attempts: number;
  next_action: string | null;
  last_action_key: string | null;
  understanding_json: string | null;
  latest_update: string | null;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

type AttachmentRow = {
  id: string;
  ticket_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
};

export type SupportTicketAttachmentInput = {
  fileName: string;
  mimeType: string;
  data: Buffer;
};

export type SupportTicketAttachmentRecord = {
  id: string;
  ticketId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
};

type EventRow = {
  id: string;
  ticket_id: string;
  event_type: string;
  actor_type: string;
  message: string;
  details_json: string | null;
  created_at: string;
};

let schemaReady = false;

function ensureSupportTicketSchema(): void {
  if (schemaReady) {
    return;
  }

  const db = getReadModelDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      ticket_number INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      impact TEXT NOT NULL,
      status TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      employee_email TEXT NOT NULL,
      description TEXT NOT NULL,
      expected_behavior TEXT,
      steps_to_reproduce TEXT,
      page_url TEXT,
      submitted_by_login TEXT NOT NULL,
      email_thread_id TEXT,
      email_message_id TEXT,
      last_incoming_message_at TEXT,
      diagnosis TEXT,
      resolution TEXT,
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      processing_started_at TEXT,
      next_check_at TEXT,
      last_error TEXT,
      clarification_rounds INTEGER NOT NULL DEFAULT 0,
      remediation_attempts INTEGER NOT NULL DEFAULT 0,
      next_action TEXT,
      last_action_key TEXT,
      understanding_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_support_tickets_submitter
      ON support_tickets(submitted_by_login, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_queue
      ON support_tickets(status, next_check_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_thread
      ON support_tickets(email_thread_id);

    CREATE TABLE IF NOT EXISTS support_ticket_attachments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket
      ON support_ticket_attachments(ticket_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS support_ticket_events (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket
      ON support_ticket_events(ticket_id, created_at DESC);
  `);

  const existingColumns = new Set(
    (db.prepare("PRAGMA table_info(support_tickets)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  const migrations = [
    ["clarification_rounds", "ALTER TABLE support_tickets ADD COLUMN clarification_rounds INTEGER NOT NULL DEFAULT 0"],
    ["remediation_attempts", "ALTER TABLE support_tickets ADD COLUMN remediation_attempts INTEGER NOT NULL DEFAULT 0"],
    ["next_action", "ALTER TABLE support_tickets ADD COLUMN next_action TEXT"],
    ["last_action_key", "ALTER TABLE support_tickets ADD COLUMN last_action_key TEXT"],
    ["understanding_json", "ALTER TABLE support_tickets ADD COLUMN understanding_json TEXT"],
  ] as const;
  for (const [column, statement] of migrations) {
    if (!existingColumns.has(column)) {
      db.exec(statement);
    }
  }
  schemaReady = true;
}

function cleanOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function parseDetails(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseUnderstanding(value: string | null): SupportTicketUnderstanding | null {
  const parsed = parseDetails(value);
  if (
    !parsed ||
    typeof parsed.summary !== "string" ||
    !["low", "medium", "high"].includes(String(parsed.confidence)) ||
    !Array.isArray(parsed.assumptions) ||
    !Array.isArray(parsed.unknowns)
  ) {
    return null;
  }
  return {
    summary: parsed.summary,
    confidence: parsed.confidence as SupportTicketUnderstanding["confidence"],
    assumptions: parsed.assumptions.filter((item): item is string => typeof item === "string"),
    unknowns: parsed.unknowns.filter((item): item is string => typeof item === "string"),
  };
}

function mapTicketRow(row: TicketRow): SupportTicketRecord {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    title: row.title,
    category: row.category,
    impact: row.impact,
    status: row.status,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    description: row.description,
    expectedBehavior: row.expected_behavior,
    stepsToReproduce: row.steps_to_reproduce,
    pageUrl: row.page_url,
    submittedByLogin: row.submitted_by_login,
    emailThreadId: row.email_thread_id,
    emailMessageId: row.email_message_id,
    lastIncomingMessageAt: row.last_incoming_message_at,
    diagnosis: row.diagnosis,
    resolution: row.resolution,
    processingAttempts: row.processing_attempts,
    processingStartedAt: row.processing_started_at,
    nextCheckAt: row.next_check_at,
    lastError: row.last_error,
    clarificationRounds: row.clarification_rounds,
    remediationAttempts: row.remediation_attempts,
    nextAction: row.next_action,
    lastActionKey: row.last_action_key,
    understanding: parseUnderstanding(row.understanding_json),
    latestUpdate: row.latest_update,
    attachmentCount: row.attachment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttachmentRow(row: AttachmentRow): SupportTicketAttachmentRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
}

function mapEventRow(row: EventRow): SupportTicketEvent {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    message: row.message,
    details: parseDetails(row.details_json),
    createdAt: row.created_at,
  };
}

const TICKET_SELECT = `
  SELECT
    t.*,
    (
      SELECT e.message
      FROM support_ticket_events e
      WHERE e.ticket_id = t.id
      ORDER BY e.created_at DESC
      LIMIT 1
    ) AS latest_update,
    (
      SELECT COUNT(*)
      FROM support_ticket_attachments a
      WHERE a.ticket_id = t.id
    ) AS attachment_count
  FROM support_tickets t
`;

function resolveAttachmentRoot() {
  const configuredPath = getEnv().READ_MODEL_SQLITE_PATH;
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  return path.join(path.dirname(databasePath), "support-ticket-attachments");
}

function safeAttachmentName(fileName: string) {
  const baseName = path.basename(fileName).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (baseName || "attachment").slice(0, 180);
}

export function createSupportTicket(input: {
  title: string;
  category: SupportTicketCategory;
  impact: SupportTicketImpact;
  employeeName: string;
  employeeEmail: string;
  description: string;
  expectedBehavior?: string | null;
  stepsToReproduce?: string | null;
  pageUrl?: string | null;
  submittedByLogin: string;
  attachments?: SupportTicketAttachmentInput[];
}): SupportTicketRecord {
  ensureSupportTicketSchema();
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const attachmentDirectory = path.join(resolveAttachmentRoot(), id);
  const storedAttachments: SupportTicketAttachmentRecord[] = [];

  try {
    if (input.attachments?.length) {
      mkdirSync(attachmentDirectory, { recursive: true });
      for (const attachment of input.attachments) {
        const attachmentId = crypto.randomUUID();
        const fileName = safeAttachmentName(attachment.fileName);
        const mimeType = normalizeSupportAttachmentMimeType(fileName, attachment.mimeType);
        const storagePath = path.join(
          attachmentDirectory,
          `${attachmentId}${supportAttachmentStorageExtension(fileName, mimeType)}`,
        );
        writeFileSync(storagePath, attachment.data, { flag: "wx" });
        storedAttachments.push({
          id: attachmentId,
          ticketId: id,
          fileName,
          mimeType,
          sizeBytes: attachment.data.byteLength,
          storagePath,
          createdAt: now,
        });
      }
    }
  } catch (error) {
    for (const attachment of storedAttachments) {
      try {
        unlinkSync(attachment.storagePath);
      } catch {
        // Best-effort cleanup for files created during this failed submission.
      }
    }
    throw error;
  }

  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO support_tickets (
        id, title, category, impact, status, employee_name, employee_email,
        description, expected_behavior, steps_to_reproduce, page_url,
        submitted_by_login, next_check_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title.trim(),
      input.category,
      input.impact,
      input.employeeName.trim(),
      input.employeeEmail.trim().toLowerCase(),
      input.description.trim(),
      cleanOptional(input.expectedBehavior),
      cleanOptional(input.stepsToReproduce),
      cleanOptional(input.pageUrl),
      input.submittedByLogin.trim().toLowerCase(),
      now,
      now,
      now,
    );

    const insertAttachment = db.prepare(`
      INSERT INTO support_ticket_attachments (
        id, ticket_id, file_name, mime_type, size_bytes, storage_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attachment of storedAttachments) {
      insertAttachment.run(
        attachment.id,
        attachment.ticketId,
        attachment.fileName,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.storagePath,
        attachment.createdAt,
      );
    }

    const ticketNumber = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO support_ticket_events (
        id, ticket_id, event_type, actor_type, message, details_json, created_at
      ) VALUES (?, ?, 'submitted', 'employee', ?, NULL, ?)
    `).run(
      crypto.randomUUID(),
      id,
      `Ticket CRM-${String(ticketNumber).padStart(4, "0")} submitted and queued for investigation.`,
      now,
    );
  });
  try {
    create();
  } catch (error) {
    for (const attachment of storedAttachments) {
      try {
        unlinkSync(attachment.storagePath);
      } catch {
        // Best-effort cleanup for files created during this failed transaction.
      }
    }
    throw error;
  }

  const created = readSupportTicket(id);
  if (!created) {
    throw new Error("Created support ticket could not be read back.");
  }
  return created;
}

export function listSupportTicketAttachments(ticketId: string): SupportTicketAttachmentRecord[] {
  ensureSupportTicketSchema();
  const rows = getReadModelDb().prepare(`
    SELECT id, ticket_id, file_name, mime_type, size_bytes, storage_path, created_at
    FROM support_ticket_attachments
    WHERE ticket_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(ticketId) as AttachmentRow[];
  return rows.map(mapAttachmentRow);
}

export function readSupportTicketAttachment(attachment: SupportTicketAttachmentRecord): Buffer {
  const root = `${path.resolve(resolveAttachmentRoot())}${path.sep}`;
  const storagePath = path.resolve(attachment.storagePath);
  if (!storagePath.startsWith(root)) {
    throw new Error("Support ticket attachment path is outside the configured storage root.");
  }
  return readFileSync(storagePath);
}

export function countRecentSupportTicketsForLogin(loginName: string, sinceIso: string): number {
  ensureSupportTicketSchema();
  const row = getReadModelDb().prepare(`
    SELECT COUNT(*) AS count
    FROM support_tickets
    WHERE submitted_by_login = ? AND created_at >= ?
  `).get(loginName.trim().toLowerCase(), sinceIso) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function readSupportTicket(id: string): SupportTicketRecord | null {
  ensureSupportTicketSchema();
  const row = getReadModelDb().prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(id) as TicketRow | undefined;
  return row ? mapTicketRow(row) : null;
}

export function listSupportTicketsForLogin(loginName: string, limit = 20): SupportTicketRecord[] {
  ensureSupportTicketSchema();
  const rows = getReadModelDb().prepare(`
    ${TICKET_SELECT}
    WHERE t.submitted_by_login = ?
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(loginName.trim().toLowerCase(), Math.max(1, Math.min(limit, 100))) as TicketRow[];
  return rows.map(mapTicketRow);
}

export function listSupportTicketEvents(ticketId: string, limit = 100): SupportTicketEvent[] {
  ensureSupportTicketSchema();
  const rows = getReadModelDb().prepare(`
    SELECT * FROM (
      SELECT *
      FROM support_ticket_events
      WHERE ticket_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) recent_events
    ORDER BY created_at ASC
  `).all(ticketId, Math.max(1, Math.min(limit, 500))) as EventRow[];
  return rows.map(mapEventRow);
}

export function listSupportTicketEventsByType(
  ticketId: string,
  eventType: string,
  limit = 100,
): SupportTicketEvent[] {
  ensureSupportTicketSchema();
  const rows = getReadModelDb().prepare(`
    SELECT * FROM (
      SELECT *
      FROM support_ticket_events
      WHERE ticket_id = ? AND event_type = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) recent_events
    ORDER BY created_at ASC
  `).all(ticketId, eventType, Math.max(1, Math.min(limit, 500))) as EventRow[];
  return rows.map(mapEventRow);
}

export function addSupportTicketEvent(input: {
  ticketId: string;
  eventType: string;
  actorType: string;
  message: string;
  details?: Record<string, unknown> | null;
  createdAt?: string;
}): void {
  ensureSupportTicketSchema();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const db = getReadModelDb();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO support_ticket_events (
        id, ticket_id, event_type, actor_type, message, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      input.ticketId,
      input.eventType,
      input.actorType,
      input.message.trim(),
      input.details ? JSON.stringify(input.details) : null,
      createdAt,
    );
    db.prepare("UPDATE support_tickets SET updated_at = ? WHERE id = ?").run(createdAt, input.ticketId);
  })();
}

export function updateSupportTicket(
  id: string,
  patch: Partial<{
    status: SupportTicketStatus;
    emailThreadId: string | null;
    emailMessageId: string | null;
    lastIncomingMessageAt: string | null;
    diagnosis: string | null;
    resolution: string | null;
    processingStartedAt: string | null;
    nextCheckAt: string | null;
    lastError: string | null;
    clarificationRounds: number;
    remediationAttempts: number;
    nextAction: string | null;
    lastActionKey: string | null;
    understanding: SupportTicketUnderstanding | null;
  }>,
): SupportTicketRecord | null {
  ensureSupportTicketSchema();
  const fieldMap = {
    status: "status",
    emailThreadId: "email_thread_id",
    emailMessageId: "email_message_id",
    lastIncomingMessageAt: "last_incoming_message_at",
    diagnosis: "diagnosis",
    resolution: "resolution",
    processingStartedAt: "processing_started_at",
    nextCheckAt: "next_check_at",
    lastError: "last_error",
    clarificationRounds: "clarification_rounds",
    remediationAttempts: "remediation_attempts",
    nextAction: "next_action",
    lastActionKey: "last_action_key",
    understanding: "understanding_json",
  } as const;
  const entries = Object.entries(patch) as Array<[
    keyof typeof fieldMap,
    string | number | SupportTicketUnderstanding | null,
  ]>;
  if (entries.length === 0) {
    return readSupportTicket(id);
  }

  const now = new Date().toISOString();
  const assignments = entries.map(([key]) => `${fieldMap[key]} = ?`);
  getReadModelDb().prepare(`
    UPDATE support_tickets
    SET ${assignments.join(", ")}, updated_at = ?
    WHERE id = ?
  `).run(
    ...entries.map(([key, value]) => key === "understanding" && value !== null ? JSON.stringify(value) : value),
    now,
    id,
  );
  return readSupportTicket(id);
}

export function claimSupportTicketForProcessing(ticketId?: string | null): SupportTicketRecord | null {
  ensureSupportTicketSchema();
  const db = getReadModelDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - 10 * 60_000).toISOString();

  return db.transaction(() => {
    const ticketFilter = ticketId ? "AND t.id = ?" : "";
    const row = db.prepare(`
      ${TICKET_SELECT}
      WHERE (
        (t.status = 'queued' AND COALESCE(t.next_check_at, t.created_at) <= ?)
        OR (t.status = 'investigating' AND t.processing_started_at < ?)
        OR (t.status = 'repairing' AND t.next_check_at <= ?)
        OR (
          t.status IN ('waiting_for_details', 'waiting_for_employee', 'monitoring', 'escalated')
          AND COALESCE(t.next_check_at, t.updated_at, t.created_at) <= ?
        )
      )
      ${ticketFilter}
      ORDER BY
        CASE t.impact WHEN 'blocked' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END,
        t.created_at ASC
      LIMIT 1
    `).get(...(ticketId
      ? [nowIso, staleIso, nowIso, nowIso, ticketId]
      : [nowIso, staleIso, nowIso, nowIso])) as TicketRow | undefined;

    if (!row) {
      return null;
    }

    const nextStatus = row.status === "queued" || row.status === "investigating"
      ? "investigating"
      : row.status;
    const result = db.prepare(`
      UPDATE support_tickets
      SET status = ?, processing_started_at = ?, processing_attempts = processing_attempts + 1,
          next_check_at = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?
    `).run(
      nextStatus,
      nowIso,
      new Date(now.getTime() + 60_000).toISOString(),
      nowIso,
      row.id,
      row.updated_at,
    );
    return result.changes === 1 ? readSupportTicket(row.id) : null;
  })();
}

export function releaseSupportTicketAfterFailure(
  ticket: SupportTicketRecord,
  errorMessage: string,
): void {
  const shouldRetrySoon = ticket.processingAttempts < 3;
  const now = Date.now();
  updateSupportTicket(ticket.id, {
    status: shouldRetrySoon ? "queued" : "monitoring",
    nextAction: shouldRetrySoon
      ? "Retry the autonomous investigation after a temporary failure."
      : "Recheck the failed dependency automatically.",
    processingStartedAt: null,
    nextCheckAt: new Date(now + (shouldRetrySoon ? 60_000 : 5 * 60_000)).toISOString(),
    lastError: errorMessage.slice(0, 1200),
  });
  addSupportTicketEvent({
    ticketId: ticket.id,
    eventType: shouldRetrySoon ? "retry_scheduled" : "automatic_monitoring_scheduled",
    actorType: "system",
    message: shouldRetrySoon
      ? "A transient investigation error occurred; the ticket will retry automatically."
      : "Repeated investigation errors occurred; automatic dependency monitoring will continue.",
    details: { error: errorMessage.slice(0, 1200) },
  });
}

export function hasSupportTicketEvent(ticketId: string, eventType: string): boolean {
  ensureSupportTicketSchema();
  const row = getReadModelDb().prepare(`
    SELECT 1 AS found
    FROM support_ticket_events
    WHERE ticket_id = ? AND event_type = ?
    LIMIT 1
  `).get(ticketId, eventType) as { found: number } | undefined;
  return row?.found === 1;
}
