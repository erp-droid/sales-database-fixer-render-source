import type { DashboardSnapshotResponse } from "@/lib/call-analytics/types";

type SnapshotCacheEntry = {
  expiresAtMs: number;
  staleAtMs: number | null;
  snapshot: DashboardSnapshotResponse;
};

const snapshotCache = new Map<string, SnapshotCacheEntry>();
const snapshotInFlight = new Map<string, Promise<DashboardSnapshotResponse>>();
const snapshotRebuildStartedAtMs = new Map<string, number>();

export function readCachedDashboardSnapshot(key: string, nowMs = Date.now()): DashboardSnapshotResponse | null {
  const entry = snapshotCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= nowMs) {
    snapshotCache.delete(key);
    return null;
  }

  if (entry.staleAtMs !== null && entry.staleAtMs <= nowMs) {
    return null;
  }

  return entry.snapshot;
}

export function readStaleDashboardSnapshot(key: string, nowMs = Date.now()): DashboardSnapshotResponse | null {
  const entry = snapshotCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= nowMs) {
    snapshotCache.delete(key);
    return null;
  }

  return entry.snapshot;
}

export function writeCachedDashboardSnapshot(
  key: string,
  snapshot: DashboardSnapshotResponse,
  expiresAtMs: number,
): void {
  snapshotCache.set(key, {
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
  for (const entry of snapshotCache.values()) {
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
  const lastStartedAtMs = snapshotRebuildStartedAtMs.get(key) ?? null;
  if (lastStartedAtMs !== null && nowMs - lastStartedAtMs < minIntervalMs) {
    return false;
  }

  snapshotRebuildStartedAtMs.set(key, nowMs);
  return true;
}

export function invalidateDashboardSnapshotCache(): void {
  snapshotCache.clear();
  snapshotInFlight.clear();
  snapshotRebuildStartedAtMs.clear();
}
