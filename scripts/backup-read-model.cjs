#!/usr/bin/env node
/**
 * Safe, scheduled backup of the read-model SQLite database.
 *
 * In local-database-only mode this SQLite file is the SOLE system of record,
 * so we take consistent, timestamped copies on a schedule and prune old ones.
 *
 * Uses better-sqlite3's online backup API (NOT a plain file copy), which is
 * safe to run while the app is actively writing in WAL mode.
 *
 * Resolution order for the source DB path:
 *   1. --db <path> argument
 *   2. READ_MODEL_SQLITE_PATH env var (matches the running app)
 *   3. ./data/read-model.sqlite (code default)
 *
 * Env knobs:
 *   READ_MODEL_BACKUP_DIR   override the backups folder (default: <dbdir>/backups)
 *   READ_MODEL_BACKUP_KEEP  how many backups to retain (default: 48)
 */

try {
  require("dotenv/config");
} catch {
  // dotenv is optional; env may be provided by the parent process.
}

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

function resolveSourcePath() {
  const fromArg = readArg("--db");
  if (fromArg) return path.resolve(fromArg);
  const fromEnv = process.env.READ_MODEL_SQLITE_PATH;
  if (fromEnv && fromEnv.trim()) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return path.resolve(process.cwd(), "data/read-model.sqlite");
}

function timestamp() {
  // 2026-06-19T14-05-32 -> filesystem-safe, sortable
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "").replace("T", "_");
}

function pruneOldBackups(backupDir, keep) {
  const entries = fs
    .readdirSync(backupDir)
    .filter((f) => /^read-model_.*\.sqlite$/.test(f))
    .map((f) => ({ f, full: path.join(backupDir, f) }))
    .sort((a, b) => b.f.localeCompare(a.f)); // newest first (timestamps sort lexically)

  const stale = entries.slice(keep);
  for (const { full } of stale) {
    try {
      fs.unlinkSync(full);
      console.log("[backup] pruned old backup", full);
    } catch (err) {
      console.warn("[backup] failed to prune", full, err.message);
    }
  }
  return { kept: Math.min(entries.length, keep), pruned: stale.length };
}

async function main() {
  const srcPath = resolveSourcePath();
  if (!fs.existsSync(srcPath)) {
    console.error("[backup] source database not found:", srcPath);
    process.exit(1);
  }

  const dbDir = path.dirname(srcPath);
  const backupDir =
    process.env.READ_MODEL_BACKUP_DIR && process.env.READ_MODEL_BACKUP_DIR.trim()
      ? path.resolve(process.env.READ_MODEL_BACKUP_DIR)
      : path.join(dbDir, "backups");
  const keep = Math.max(1, Number(process.env.READ_MODEL_BACKUP_KEEP || 48) || 48);

  fs.mkdirSync(backupDir, { recursive: true });

  const destPath = path.join(backupDir, `read-model_${timestamp()}.sqlite`);

  // Open read-only and use the online backup API. This produces a single,
  // fully-consistent file even while the app writes via WAL.
  const db = new Database(srcPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destPath);
  } finally {
    db.close();
  }

  const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(1);
  const { kept, pruned } = pruneOldBackups(backupDir, keep);
  console.log(
    `[backup] OK -> ${destPath} (${sizeMb} MB) | retained ${kept}, pruned ${pruned}`,
  );
}

main().catch((err) => {
  console.error("[backup] FAILED:", err.message);
  process.exit(1);
});
