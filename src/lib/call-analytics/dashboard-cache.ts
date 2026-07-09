import { getReadModelDb } from "@/lib/read-model/db";
import type { DashboardSnapshotResponse } from "@/lib/call-analytics/types";

type SnapshotCacheEntry = {
  expiresAtMs: number;
  staleAtMs: number | null;
  snapshot: DashboardSnapshotResponse;
};

// The snapshot cache is shared across cluster workers through SQLite: with a
// per-process cache, every worker rebuilt the snapshot cold after a restart
// (~6s of blocked event loop each), and a health probe landing during any of
// those builds got the instance killed. The shared table means one build per
// key cluster-wide; each process keeps only a parse memo so repeat reads skip
// JSON.parse. All SQLite access is best-effort: if the read model is
// unavailable (unit tests), the per-process fallback map preserves the old
// behavior.
const parseMemo = new Map<string, { writtenAtMs: number; snapshot: DashboardSnapshotResponse }>();
const fallbackCache = new Map<string, SnapshotCacheEntry>();
const fallbackRebuildStartedAtMs = new Map<string, number>();
const snapshotInFlight = new Map<string, Promise<DashboardSnapshotResponse>>();

let cacheTableReady = false;

// Grace window during which an expired entry may still be served while a
// background rebuild replaces it. Rebuilding inline on expiry would block the
// event loop for seconds during quiet periods when nothing marks the cache
// stale — the exact stall that fails Render's 5s health check.
const STALE_SERVE_GRACE_MS = 25 * 60 * 1000;

type SharedCacheMeta = {
  expiresAtMs: number;
  staleAtMs: number | null;
  writtenAtMs: number;
  hasPayload: boolean;
};

function getCacheDb(): ReturnType<typeof getReadModelDb> | null {
  try {
    const db = getReadModelDb();
    if (!cacheTableReady) {
      db.exec(
        `
        CREATE TABLE IF NOT EXISTS dashboard_snapshot_cache (
          cache_key TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          stale_at_ms INTEGER,
          rebuild_started_at_ms INTEGER,
          written_at_ms INTEGER NOT NULL
        )
        `,
      );
      cacheTableReady = true;
    }
    return db;
  } catch {
    return null;
  }
}

function readSharedMeta(db: ReturnType<typeof getReadModelDb>, key: string): SharedCacheMeta | null {
  const row = db
    .prepare(
      `
      SELECT expires_at_ms, stale_at_ms, written_at_ms, length(payload_json) AS payload_length
      FROM dashboard_snapshot_cache
      WHERE cache_key = ?
      `,
    )
    .get(key) as
    | { expires_at_ms: number; stale_at_ms: number | null; written_at_ms: number; payload_length: number }
    | undefined;
  if (!row) {
    return null;
  }

  return {
    expiresAtMs: row.expires_at_ms,
    staleAtMs: row.stale_at_ms,
    writtenAtMs: row.written_at_ms,
    hasPayload: row.payload_length > 0,
  };
}

function readSharedSnapshot(
  db: ReturnType<typeof getReadModelDb>,
  key: string,
  meta: SharedCacheMeta,
): DashboardSnapshotResponse | null {
  if (!meta.hasPayload) {
    return null;
  }

  const memo = parseMemo.get(key);
  if (memo && memo.writtenAtMs === meta.writtenAtMs) {
    return memo.snapshot;
  }

  const row = db
    .prepare("SELECT payload_json FROM dashboard_snapshot_cache WHERE cache_key = ?")
    .get(key) as { payload_json: string } | undefined;
  if (!row || !row.payload_json) {
    return null;
  }

  try {
    const snapshot = JSON.parse(row.payload_json) as DashboardSnapshotResponse;
    parseMemo.set(key, { writtenAtMs: meta.writtenAtMs, snapshot });
    return snapshot;
  } catch {
    return null;
  }
}

export function readCachedDashboardSnapshot(key: string, nowMs = Date.now()): DashboardSnapshotResponse | null {
  const db = getCacheDb();
  if (db) {
    const meta = readSharedMeta(db, key);
    if (!meta) {
      return null;
    }
    if (meta.expiresAtMs <= nowMs) {
      return null;
    }
    if (meta.staleAtMs !== null && meta.staleAtMs <= nowMs) {
      return null;
    }
    return readSharedSnapshot(db, key, meta);
  }

  const entry = fallbackCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAtMs <= nowMs) {
    return null;
  }
  if (entry.staleAtMs !== null && entry.staleAtMs <= nowMs) {
    return null;
  }
  return entry.snapshot;
}

export function readStaleDashboardSnapshot(key: string, nowMs = Date.now()): DashboardSnapshotResponse | null {
  const db = getCacheDb();
  if (db) {
    const meta = readSharedMeta(db, key);
    if (!meta) {
      return null;
    }
    if (meta.expiresAtMs + STALE_SERVE_GRACE_MS <= nowMs) {
      db.prepare("DELETE FROM dashboard_snapshot_cache WHERE cache_key = ?").run(key);
      parseMemo.delete(key);
      return null;
    }
    return readSharedSnapshot(db, key, meta);
  }

  const entry = fallbackCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAtMs + STALE_SERVE_GRACE_MS <= nowMs) {
    fallbackCache.delete(key);
    return null;
  }
  return entry.snapshot;
}

export function writeCachedDashboardSnapshot(
  key: string,
  snapshot: DashboardSnapshotResponse,
  expiresAtMs: number,
): void {
  const db = getCacheDb();
  if (db) {
    const writtenAtMs = Date.now();
    db.prepare(
      `
      INSERT INTO dashboard_snapshot_cache
        (cache_key, payload_json, expires_at_ms, stale_at_ms, rebuild_started_at_ms, written_at_ms)
      VALUES (@cache_key, @payload_json, @expires_at_ms, NULL, NULL, @written_at_ms)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        expires_at_ms = excluded.expires_at_ms,
        stale_at_ms = NULL,
        written_at_ms = excluded.written_at_ms
      `,
    ).run({
      cache_key: key,
      payload_json: JSON.stringify(snapshot),
      expires_at_ms: expiresAtMs,
      written_at_ms: writtenAtMs,
    });
    parseMemo.set(key, { writtenAtMs, snapshot });
    return;
  }

  fallbackCache.set(key, {
    snapshot,
    staleAtMs: null,
    expiresAtMs,
  });
}

export function readDashboardSnapshotInFlight(
  key: string,
): Promise<DashboardSnapshotResponse> | null {
  return snapshotInFlight.get(key) ?? null;
}

export function writeDashboardSnapshotInFlight(
  key: string,
  request: Promise<DashboardSnapshotResponse> | null,
): void {
  if (request) {
    snapshotInFlight.set(key, request);
    return;
  }

  snapshotInFlight.delete(key);
}

export function markDashboardSnapshotCacheStale(nowMs = Date.now()): void {
  const db = getCacheDb();
  if (db) {
    db.prepare(
      `
      UPDATE dashboard_snapshot_cache
      SET stale_at_ms = @now
      WHERE stale_at_ms IS NULL OR stale_at_ms > @now
      `,
    ).run({ now: nowMs });
    return;
  }

  for (const entry of fallbackCache.values()) {
    if (entry.staleAtMs === null || entry.staleAtMs > nowMs) {
      entry.staleAtMs = nowMs;
    }
  }
}

export function claimDashboardSnapshotRebuild(
  key: string,
  minIntervalMs: number,
  nowMs = Date.now(),
): boolean {
  const db = getCacheDb();
  if (db) {
    const result = db
      .prepare(
        `
        INSERT INTO dashboard_snapshot_cache
          (cache_key, payload_json, expires_at_ms, stale_at_ms, rebuild_started_at_ms, written_at_ms)
        VALUES (@cache_key, '', 0, NULL, @now, 0)
        ON CONFLICT(cache_key) DO UPDATE SET rebuild_started_at_ms = @now
        WHERE COALESCE(dashboard_snapshot_cache.rebuild_started_at_ms, 0) < @claim_before
        `,
      )
      .run({ cache_key: key, now: nowMs, claim_before: nowMs - minIntervalMs });
    return result.changes > 0;
  }

  const lastStartedAtMs = fallbackRebuildStartedAtMs.get(key) ?? null;
  if (lastStartedAtMs !== null && nowMs - lastStartedAtMs < minIntervalMs) {
    return false;
  }
  fallbackRebuildStartedAtMs.set(key, nowMs);
  return true;
}

// Waits (without blocking the event loop) for another worker's in-progress
// build to land in the shared cache. Returns null on timeout.
export async function waitForSharedDashboardSnapshot(
  key: string,
  timeoutMs: number,
): Promise<DashboardSnapshotResponse | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });
    const snapshot = readStaleDashboardSnapshot(key);
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

export function invalidateDashboardSnapshotCache(): void {
  const db = getCacheDb();
  if (db) {
    try {
      db.prepare("DELETE FROM dashboard_snapshot_cache").run();
    } catch {
      // Table may not exist yet; nothing to clear.
    }
  }
  parseMemo.clear();
  fallbackCache.clear();
  fallbackRebuildStartedAtMs.clear();
  snapshotInFlight.clear();
}
