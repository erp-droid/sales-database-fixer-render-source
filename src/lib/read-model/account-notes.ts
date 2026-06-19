import { randomUUID } from "node:crypto";

import { getReadModelDb } from "@/lib/read-model/db";

export type AccountNote = {
  id: string;
  accountRecordId: string;
  businessAccountId: string | null;
  companyName: string | null;
  contactId: number | null;
  contactName: string | null;
  note: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoredAccountNoteRow = {
  id: string;
  account_record_id: string;
  business_account_id: string | null;
  company_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  note: string;
  author: string | null;
  created_at: string;
  updated_at: string;
};

function toAccountNote(row: StoredAccountNoteRow): AccountNote {
  return {
    id: row.id,
    accountRecordId: row.account_record_id,
    businessAccountId: row.business_account_id,
    companyName: row.company_name,
    contactId: row.contact_id,
    contactName: row.contact_name,
    note: row.note,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Returns every note for the account (both company-level notes, where
// contact_id is null, and per-contact notes). Callers split by contactId.
export function listAccountNotes(accountRecordId: string): AccountNote[] {
  const trimmed = accountRecordId.trim();
  if (!trimmed) {
    return [];
  }

  const rows = getReadModelDb()
    .prepare(
      `
      SELECT id, account_record_id, business_account_id, company_name, contact_id, contact_name,
             note, author, created_at, updated_at
      FROM account_notes
      WHERE account_record_id = ?
      ORDER BY created_at DESC, id DESC
      `,
    )
    .all(trimmed) as StoredAccountNoteRow[];

  return rows.map(toAccountNote);
}

export function createAccountNote(input: {
  accountRecordId: string;
  businessAccountId?: string | null;
  companyName?: string | null;
  contactId?: number | null;
  contactName?: string | null;
  note: string;
  author?: string | null;
}): AccountNote {
  const accountRecordId = input.accountRecordId.trim();
  const note = input.note.trim();
  if (!accountRecordId) {
    throw new Error("accountRecordId is required to create a note.");
  }
  if (!note) {
    throw new Error("Note text is required.");
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const contactId =
    typeof input.contactId === "number" && Number.isInteger(input.contactId) && input.contactId > 0
      ? input.contactId
      : null;

  getReadModelDb()
    .prepare(
      `
      INSERT INTO account_notes (
        id, account_record_id, business_account_id, company_name, contact_id, contact_name,
        note, author, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      accountRecordId,
      input.businessAccountId?.trim() || null,
      input.companyName?.trim() || null,
      contactId,
      input.contactName?.trim() || null,
      note,
      input.author?.trim() || null,
      now,
      now,
    );

  return {
    id,
    accountRecordId,
    businessAccountId: input.businessAccountId?.trim() || null,
    companyName: input.companyName?.trim() || null,
    contactId,
    contactName: input.contactName?.trim() || null,
    note,
    author: input.author?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateAccountNote(input: {
  id: string;
  accountRecordId: string;
  note: string;
}): AccountNote | null {
  const note = input.note.trim();
  if (!note) {
    throw new Error("Note text is required.");
  }

  const now = new Date().toISOString();
  const result = getReadModelDb()
    .prepare(
      `
      UPDATE account_notes
      SET note = ?, updated_at = ?
      WHERE id = ? AND account_record_id = ?
      `,
    )
    .run(note, now, input.id.trim(), input.accountRecordId.trim());

  if (result.changes === 0) {
    return null;
  }

  const row = getReadModelDb()
    .prepare(
      `
      SELECT id, account_record_id, business_account_id, company_name, contact_id, contact_name,
             note, author, created_at, updated_at
      FROM account_notes
      WHERE id = ?
      `,
    )
    .get(input.id.trim()) as StoredAccountNoteRow | undefined;

  return row ? toAccountNote(row) : null;
}

export function deleteAccountNote(input: { id: string; accountRecordId: string }): boolean {
  const result = getReadModelDb()
    .prepare(`DELETE FROM account_notes WHERE id = ? AND account_record_id = ?`)
    .run(input.id.trim(), input.accountRecordId.trim());

  return result.changes > 0;
}
