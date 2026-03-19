import { promises as fs } from "node:fs";
import path from "node:path";

import { getEnv } from "@/lib/env";
import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { getReadModelDb } from "@/lib/read-model/db";

type PortableTableRow = Record<string, unknown>;

export type AppStateTransferSnapshot = {
  version: 1;
  createdAt: string;
  sourceLabel: string | null;
  tables: Record<string, PortableTableRow[]>;
  dataQualityHistory: unknown | null;
};

export type AppStateTransferImportResult = {
  backupPath: string;
  importedTables: Array<{
    name: string;
    rowCount: number;
  }>;
  importedHistory: boolean;
};

const PORTABLE_TABLES = [
  "account_rows",
  "account_local_metadata",
  "employee_directory",
  "sales_rep_directory",
  "address_geocodes",
  "sync_state",
  "call_employee_directory",
  "caller_phone_overrides",
  "caller_identity_profiles",
  "call_legs",
  "call_sessions",
  "call_ingest_state",
  "call_activity_sync",
  "meeting_bookings",
  "deferred_actions",
  "audit_events",
  "audit_event_fields",
  "audit_event_links",
] as const;

function resolveHistoryFilePath(): string {
  const { DATA_QUALITY_HISTORY_PATH } = getEnv();
  if (path.isAbsolute(DATA_QUALITY_HISTORY_PATH)) {
    return DATA_QUALITY_HISTORY_PATH;
  }

  return path.join(process.cwd(), DATA_QUALITY_HISTORY_PATH);
}

function resolveBackupDir(): string {
  const { READ_MODEL_SQLITE_PATH } = getEnv();
  const sqlitePath = path.isAbsolute(READ_MODEL_SQLITE_PATH)
    ? READ_MODEL_SQLITE_PATH
    : path.join(process.cwd(), READ_MODEL_SQLITE_PATH);

  return path.join(path.dirname(sqlitePath), "state-transfer-backups");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readPortableTable(tableName: string): PortableTableRow[] {
  const db = getReadModelDb();
  return db
    .prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`)
    .all() as PortableTableRow[];
}

async function readDataQualityHistory(): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(resolveHistoryFilePath(), "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function assertValidSnapshot(snapshot: unknown): asserts snapshot is AppStateTransferSnapshot {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Snapshot payload must be an object.");
  }

  const record = snapshot as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error("Snapshot version is not supported.");
  }

  if (!record.tables || typeof record.tables !== "object" || Array.isArray(record.tables)) {
    throw new Error("Snapshot tables payload is invalid.");
  }
}

async function saveBackupSnapshot(snapshot: AppStateTransferSnapshot): Promise<string> {
  const backupDir = resolveBackupDir();
  await fs.mkdir(backupDir, { recursive: true });

  const safeTimestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(backupDir, `state-transfer-backup-${safeTimestamp}.json`);
  await fs.writeFile(backupPath, JSON.stringify(snapshot, null, 2), "utf8");
  return backupPath;
}

function replacePortableTables(tables: Record<string, PortableTableRow[]>): Array<{
  name: string;
  rowCount: number;
}> {
  const db = getReadModelDb();
  const importedTables: Array<{ name: string; rowCount: number }> = [];

  db.pragma("foreign_keys = OFF");
  try {
    const importTables = db.transaction(() => {
      for (const tableName of [...PORTABLE_TABLES].reverse()) {
        db.prepare(`DELETE FROM ${quoteIdentifier(tableName)}`).run();
      }

      for (const tableName of PORTABLE_TABLES) {
        const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
        importedTables.push({
          name: tableName,
          rowCount: rows.length,
        });

        if (rows.length === 0) {
          continue;
        }

        const columns = (
          db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name);

        if (columns.length === 0) {
          continue;
        }

        const placeholders = columns.map((column) => `@${column}`).join(", ");
        const insert = db.prepare(
          `
          INSERT INTO ${quoteIdentifier(tableName)} (
            ${columns.map((column) => quoteIdentifier(column)).join(", ")}
          ) VALUES (${placeholders})
          `,
        );

        for (const row of rows) {
          const parameters = Object.fromEntries(
            columns.map((column) => [column, Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null]),
          );
          insert.run(parameters);
        }
      }
    });

    importTables();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  return importedTables;
}

async function writeDataQualityHistory(history: unknown | null): Promise<boolean> {
  const historyPath = resolveHistoryFilePath();

  if (history === null) {
    try {
      await fs.unlink(historyPath);
      return true;
    } catch {
      return false;
    }
  }

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf8");
  return true;
}

export async function exportAppStateTransferSnapshot(
  sourceLabel: string | null,
): Promise<AppStateTransferSnapshot> {
  const tables = Object.fromEntries(
    PORTABLE_TABLES.map((tableName) => [tableName, readPortableTable(tableName)]),
  ) as Record<string, PortableTableRow[]>;

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceLabel,
    tables,
    dataQualityHistory: await readDataQualityHistory(),
  };
}

export async function importAppStateTransferSnapshot(
  snapshotInput: unknown,
): Promise<AppStateTransferImportResult> {
  assertValidSnapshot(snapshotInput);
  const snapshot = snapshotInput as AppStateTransferSnapshot;

  const backupPath = await saveBackupSnapshot(
    await exportAppStateTransferSnapshot("localhost-backup"),
  );
  const importedTables = replacePortableTables(snapshot.tables);
  const importedHistory = await writeDataQualityHistory(snapshot.dataQualityHistory ?? null);

  invalidateReadModelCaches();

  return {
    backupPath,
    importedTables,
    importedHistory,
  };
}
