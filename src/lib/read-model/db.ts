import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { getEnv } from "@/lib/env";
import { ensureReadModelSchema } from "@/lib/read-model/schema";

let db: Database.Database | null = null;

function resolveDatabasePath(): string {
  const { READ_MODEL_SQLITE_PATH } = getEnv();
  if (path.isAbsolute(READ_MODEL_SQLITE_PATH)) {
    return READ_MODEL_SQLITE_PATH;
  }

  return path.join(process.cwd(), READ_MODEL_SQLITE_PATH);
}

export function getReadModelDb(): Database.Database {
  if (db) {
    return db;
  }

  const sqlitePath = resolveDatabasePath();
  mkdirSync(path.dirname(sqlitePath), { recursive: true });

  const nextDb = new Database(sqlitePath);
  try {
    nextDb.pragma("journal_mode = WAL");
    nextDb.pragma("foreign_keys = ON");
    nextDb.pragma("synchronous = NORMAL");
    ensureReadModelSchema(nextDb);
  } catch (error) {
    nextDb.close();
    throw error;
  }

  db = nextDb;
  return nextDb;
}
