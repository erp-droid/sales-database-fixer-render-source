import { buildContactIdentityKeyForRow } from "@/lib/contact-identity";
import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { getReadModelDb } from "@/lib/read-model/db";
import type { BusinessAccountRow } from "@/types/business-account";

type ContactIdentityNoteRow = {
  identity_key: string;
  company_name: string;
  contact_name: string;
  notes: string | null;
  updated_at: string;
};

type SeedCandidate = {
  identityKey: string;
  companyName: string;
  contactName: string;
  notes: string;
  rowKey: string | null;
  contactId: number | null;
};

const SQLITE_CHUNK_SIZE = 800;

function cleanText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function readRowsByIdentityKeys(identityKeys: string[]): Map<string, ContactIdentityNoteRow> {
  const uniqueKeys = [...new Set(identityKeys.filter(Boolean))];
  const rowsByKey = new Map<string, ContactIdentityNoteRow>();
  if (uniqueKeys.length === 0) {
    return rowsByKey;
  }

  const db = getReadModelDb();
  for (const chunk of chunkValues(uniqueKeys, SQLITE_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
        SELECT identity_key, company_name, contact_name, notes, updated_at
        FROM contact_identity_notes
        WHERE identity_key IN (${placeholders})
        `,
      )
      .all(...chunk) as ContactIdentityNoteRow[];
    rows.forEach((row) => rowsByKey.set(row.identity_key, row));
  }

  return rowsByKey;
}

function buildSeedCandidates(rows: BusinessAccountRow[]): Map<string, SeedCandidate> {
  const candidatesByKey = new Map<string, SeedCandidate>();

  for (const row of rows) {
    const identityKey = buildContactIdentityKeyForRow(row);
    const notes = cleanText(row.notes);
    const companyName = cleanText(row.companyName);
    const contactName = cleanText(row.primaryContactName);
    if (!identityKey || !notes || !companyName || !contactName) {
      continue;
    }

    const current = candidatesByKey.get(identityKey);
    if (current && current.notes.length >= notes.length) {
      continue;
    }

    candidatesByKey.set(identityKey, {
      identityKey,
      companyName,
      contactName,
      notes,
      rowKey: row.rowKey ?? null,
      contactId: row.contactId ?? row.primaryContactId ?? null,
    });
  }

  return candidatesByKey;
}

export function seedSharedContactNotesFromRows(rows: BusinessAccountRow[]): void {
  const candidatesByKey = buildSeedCandidates(rows);
  if (candidatesByKey.size === 0) {
    return;
  }

  const existingRows = readRowsByIdentityKeys([...candidatesByKey.keys()]);
  const candidates = [...candidatesByKey.values()].filter(
    (candidate) => !existingRows.has(candidate.identityKey),
  );
  if (candidates.length === 0) {
    return;
  }

  const db = getReadModelDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `
    INSERT OR IGNORE INTO contact_identity_notes (
      identity_key,
      company_name,
      contact_name,
      notes,
      source_row_key,
      source_contact_id,
      updated_by,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const write = db.transaction(() => {
    for (const candidate of candidates) {
      insert.run(
        candidate.identityKey,
        candidate.companyName,
        candidate.contactName,
        candidate.notes,
        candidate.rowKey,
        candidate.contactId,
        "seed",
        now,
        now,
      );
    }
  });

  write();
}

export function applySharedContactNotesToRows(rows: BusinessAccountRow[]): BusinessAccountRow[] {
  seedSharedContactNotesFromRows(rows);

  const identityKeys = rows
    .map((row) => buildContactIdentityKeyForRow(row))
    .filter((key): key is string => Boolean(key));
  const noteRows = readRowsByIdentityKeys(identityKeys);
  if (noteRows.size === 0) {
    return rows;
  }

  return rows.map((row) => {
    const identityKey = buildContactIdentityKeyForRow(row);
    const sharedNotes = identityKey ? noteRows.get(identityKey) : null;
    if (!sharedNotes) {
      return row;
    }

    return {
      ...row,
      notes: sharedNotes.notes,
    };
  });
}

export function upsertSharedContactNotesForRow(input: {
  row: BusinessAccountRow;
  notes: string | null | undefined;
  updatedBy?: string | null;
}): BusinessAccountRow {
  const identityKey = buildContactIdentityKeyForRow(input.row);
  if (!identityKey) {
    return input.row;
  }

  const companyName = cleanText(input.row.companyName);
  const contactName = cleanText(input.row.primaryContactName);
  if (!companyName || !contactName) {
    return input.row;
  }

  const normalizedNotes = cleanText(input.notes);
  const now = new Date().toISOString();
  const db = getReadModelDb();
  db.prepare(
    `
    INSERT INTO contact_identity_notes (
      identity_key,
      company_name,
      contact_name,
      notes,
      source_row_key,
      source_contact_id,
      updated_by,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(identity_key) DO UPDATE SET
      company_name = excluded.company_name,
      contact_name = excluded.contact_name,
      notes = excluded.notes,
      source_row_key = excluded.source_row_key,
      source_contact_id = excluded.source_contact_id,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
    `,
  ).run(
    identityKey,
    companyName,
    contactName,
    normalizedNotes,
    input.row.rowKey ?? null,
    input.row.contactId ?? input.row.primaryContactId ?? null,
    cleanText(input.updatedBy),
    now,
    now,
  );
  invalidateReadModelCaches();

  return {
    ...input.row,
    notes: normalizedNotes,
  };
}
