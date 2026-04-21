import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbGet,
  mockDbRun,
  state,
} = vi.hoisted(() => {
  const baseState = {
    syncRow: {
      status: "idle",
      started_at: null,
      completed_at: "2026-04-18T12:00:00.000Z",
      last_successful_sync_at: "2026-04-18T12:00:00.000Z",
      last_error: null,
      rows_count: 100,
      accounts_count: 90,
      contacts_count: 80,
      phase: null,
      progress_json: null,
    },
    callCountRow: {
      total: 0,
    },
    ingestState: {
      scope: "voice",
      status: "complete",
      lastRecentSyncAt: "2026-04-18T12:00:00.000Z",
      lastFullBackfillAt: null,
      latestSeenStartTime: "2026-04-18T11:59:00.000Z",
      oldestSeenStartTime: null,
      fullHistoryComplete: true,
      lastWebhookAt: null,
      lastError: null,
      progress: null,
      updatedAt: "2026-04-18T12:00:00.000Z",
    },
    env: {
      READ_MODEL_SYNC_INTERVAL_MS: 900_000,
      READ_MODEL_SYNC_STALE_RUNNING_AFTER_MS: 1_800_000,
      READ_MODEL_ACTIVE_CALL_STALE_AFTER_MS: 21_600_000,
    },
  };

  const mockDbGetImpl = vi.fn((sql: string) => {
    if (sql.includes("FROM sync_state")) {
      return baseState.syncRow;
    }

    if (sql.includes("FROM call_sessions")) {
      return baseState.callCountRow;
    }

    throw new Error(`Unexpected SQL in sync.test.ts: ${sql}`);
  });

  return {
    state: baseState,
    mockDbGet: mockDbGetImpl,
    mockDbRun: vi.fn(() => undefined),
  };
});

vi.mock("@/lib/read-model/employees", () => ({
  buildEmployeeDirectoryFromRows: vi.fn(() => []),
  DERIVED_EMPLOYEE_DIRECTORY_SOURCE: "derived",
  FULL_EMPLOYEE_DIRECTORY_SOURCE: "full",
  readEmployeeDirectory: vi.fn(() => []),
  readEmployeeDirectorySnapshot: vi.fn(() => ({ source: "derived", items: [] })),
  replaceEmployeeDirectory: vi.fn(),
}));

vi.mock("@/lib/read-model/sales-reps", () => ({
  buildSalesRepDirectory: vi.fn(() => []),
  replaceSalesRepDirectory: vi.fn(),
}));

vi.mock("@/lib/read-model/geocodes", () => ({
  geocodePendingAddresses: vi.fn(async () => 0),
  queueGeocodesForRows: vi.fn(),
}));

vi.mock("@/lib/read-model/db", () => ({
  getReadModelDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => mockDbGet(sql, ...args),
      run: (...args: unknown[]) => mockDbRun(sql, ...args),
    }),
  }),
}));

vi.mock("@/lib/read-model/accounts", () => ({
  replaceAllAccountRows: vi.fn(),
  readAllAccountRowsFromReadModel: vi.fn(() => []),
}));

vi.mock("@/lib/read-model/cache", () => ({
  invalidateReadModelCaches: vi.fn(),
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  syncCallEmployeeDirectory: vi.fn(async () => undefined),
}));

vi.mock("@/lib/call-analytics/ingest", () => ({
  readCallIngestState: () => state.ingestState,
}));

vi.mock("@/lib/business-account-live", () => ({
  publishBusinessAccountChanged: vi.fn(),
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  withServiceAcumaticaSession: vi.fn(async (_cookie: unknown, callback: (...args: unknown[]) => unknown) =>
    callback("cookie", { value: null }),
  ),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => state.env,
}));

vi.mock("@/lib/meeting-bookings", () => ({
  syncMeetingBookings: vi.fn(async () => undefined),
}));

import { readManualSyncBlockedReason } from "@/lib/read-model/sync";

const NOW_MS = Date.parse("2026-04-20T12:00:00.000Z");

describe("readManualSyncBlockedReason", () => {
  beforeEach(() => {
    mockDbGet.mockClear();
    mockDbRun.mockClear();

    state.syncRow = {
      status: "idle",
      started_at: null,
      completed_at: "2026-04-18T12:00:00.000Z",
      last_successful_sync_at: "2026-04-18T12:00:00.000Z",
      last_error: null,
      rows_count: 100,
      accounts_count: 90,
      contacts_count: 80,
      phase: null,
      progress_json: null,
    };

    state.callCountRow = {
      total: 0,
    };

    state.ingestState = {
      scope: "voice",
      status: "complete",
      lastRecentSyncAt: "2026-04-18T12:00:00.000Z",
      lastFullBackfillAt: null,
      latestSeenStartTime: "2026-04-18T11:59:00.000Z",
      oldestSeenStartTime: null,
      fullHistoryComplete: true,
      lastWebhookAt: null,
      lastError: null,
      progress: null,
      updatedAt: "2026-04-18T12:00:00.000Z",
    };

    state.env = {
      READ_MODEL_SYNC_INTERVAL_MS: 900_000,
      READ_MODEL_SYNC_STALE_RUNNING_AFTER_MS: 1_800_000,
      READ_MODEL_ACTIVE_CALL_STALE_AFTER_MS: 21_600_000,
    };
  });

  it("blocks sync when a recent live call is still in progress", () => {
    state.callCountRow = { total: 1 };

    const reason = readManualSyncBlockedReason(NOW_MS);

    expect(reason).toBe("Sync is temporarily blocked while 1 live call is in progress.");
  });

  it("ignores stale in-progress sessions that are older than the active-call threshold", () => {
    state.callCountRow = { total: 0 };
    state.env.READ_MODEL_ACTIVE_CALL_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

    const reason = readManualSyncBlockedReason(NOW_MS);

    expect(reason).toBeNull();
    const callQuery = mockDbGet.mock.calls.find((call) =>
      String(call[0]).includes("FROM call_sessions"),
    );
    const callQuerySql = String(callQuery?.[0] ?? "");
    expect(callQuerySql).toContain("outcome IN ('in_progress', 'unknown')");
    expect(callQuerySql).not.toContain("ended_at IS NULL OR outcome = 'in_progress'");
    expect(callQuerySql).toContain("NULLIF(started_at, '')");
    expect(callQuerySql).toContain("NULLIF(answered_at, '')");
    expect(callQuery?.[1]).toBe(
      new Date(NOW_MS - state.env.READ_MODEL_ACTIVE_CALL_STALE_AFTER_MS).toISOString(),
    );
  });

  it("returns the running lock message before checking call activity", () => {
    state.syncRow = {
      ...state.syncRow,
      status: "running",
      started_at: "2026-04-20T11:55:00.000Z",
    };

    const reason = readManualSyncBlockedReason(NOW_MS);

    expect(reason).toBe("A full account sync is already running.");
    expect(
      mockDbGet.mock.calls.some((call) => String(call[0]).includes("FROM call_sessions")),
    ).toBe(false);
  });
});
