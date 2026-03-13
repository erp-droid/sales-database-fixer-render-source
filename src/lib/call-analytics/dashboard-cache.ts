import type { DashboardSnapshotResponse } from "@/lib/call-analytics/types";

type SnapshotCacheEntry = {
  expiresAtMs: number;
  snapshot: DashboardSnapshotResponse;
};

const snapshotCache = new Map<string, SnapshotCacheEntry>();
const snapshotInFlight = new Map<string, Promise<DashboardSnapshotResponse>>();

export function readCachedDashboardSnapshot(key: string, nowMs = Date.now()): DashboardSnapshotResponse | null {
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

export function invalidateDashboardSnapshotCache(): void {
  snapshotCache.clear();
  snapshotInFlight.clear();
}
