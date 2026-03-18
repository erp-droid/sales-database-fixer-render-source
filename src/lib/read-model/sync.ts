import type { AuthCookieRefreshState } from "@/lib/acumatica";
import {
  buildEmployeeDirectoryFromRows,
  DERIVED_EMPLOYEE_DIRECTORY_SOURCE,
  FULL_EMPLOYEE_DIRECTORY_SOURCE,
  readEmployeeDirectory,
  readEmployeeDirectorySnapshot,
  replaceEmployeeDirectory,
} from "@/lib/read-model/employees";
import { geocodePendingAddresses, queueGeocodesForRows } from "@/lib/read-model/geocodes";
import { getReadModelDb } from "@/lib/read-model/db";
import { replaceAllAccountRows, readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { syncCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { getEnv } from "@/lib/env";
import { syncMeetingBookings } from "@/lib/meeting-bookings";
import type { BusinessAccountRow } from "@/types/business-account";
import type { SyncRunResponse, SyncStatusResponse } from "@/types/sync";

type StoredSyncState = {
  status: "idle" | "running" | "failed";
  started_at: string | null;
  completed_at: string | null;
  last_successful_sync_at: string | null;
  last_error: string | null;
  rows_count: number;
  accounts_count: number;
  contacts_count: number;
  phase: string | null;
  progress_json: string | null;
};

function readNextStoredValue<K extends keyof StoredSyncState>(
  current: StoredSyncState | undefined,
  next: Partial<StoredSyncState>,
  key: K,
  fallback: StoredSyncState[K],
): StoredSyncState[K] {
  if (Object.prototype.hasOwnProperty.call(next, key)) {
    return (next[key] ?? fallback) as StoredSyncState[K];
  }

  return (current?.[key] ?? fallback) as StoredSyncState[K];
}

let syncInFlight: Promise<void> | null = null;
let geocodeInFlight: Promise<void> | null = null;

function toSyncStatusResponse(record: StoredSyncState | undefined): SyncStatusResponse {
  let progress: SyncStatusResponse["progress"] = null;

  if (record?.progress_json) {
    try {
      progress = JSON.parse(record.progress_json) as SyncStatusResponse["progress"];
    } catch {
      progress = null;
    }
  }

  return {
    status: record?.status ?? "idle",
    phase: record?.phase ?? null,
    startedAt: record?.started_at ?? null,
    completedAt: record?.completed_at ?? null,
    lastSuccessfulSyncAt: record?.last_successful_sync_at ?? null,
    lastError: record?.last_error ?? null,
    rowsCount: record?.rows_count ?? 0,
    accountsCount: record?.accounts_count ?? 0,
    contactsCount: record?.contacts_count ?? 0,
    progress,
  };
}

function writeSyncState(next: Partial<StoredSyncState> & { status: StoredSyncState["status"] }): void {
  const db = getReadModelDb();
  const current = db
    .prepare(
      `
      SELECT
        status,
        started_at,
        completed_at,
        last_successful_sync_at,
        last_error,
        rows_count,
        accounts_count,
        contacts_count,
        phase,
        progress_json
      FROM sync_state
      WHERE scope = 'full'
      `,
    )
    .get() as StoredSyncState | undefined;

  db.prepare(
    `
    UPDATE sync_state
    SET status = ?,
        started_at = ?,
        completed_at = ?,
        last_successful_sync_at = ?,
        last_error = ?,
        rows_count = ?,
        accounts_count = ?,
        contacts_count = ?,
        phase = ?,
        progress_json = ?
    WHERE scope = 'full'
    `,
  ).run(
    next.status,
    readNextStoredValue(current, next, "started_at", null),
    readNextStoredValue(current, next, "completed_at", null),
    readNextStoredValue(current, next, "last_successful_sync_at", null),
    readNextStoredValue(current, next, "last_error", null),
    readNextStoredValue(current, next, "rows_count", 0),
    readNextStoredValue(current, next, "accounts_count", 0),
    readNextStoredValue(current, next, "contacts_count", 0),
    readNextStoredValue(current, next, "phase", null),
    readNextStoredValue(current, next, "progress_json", null),
  );
}

function computeCounts(rows: BusinessAccountRow[]): {
  rowsCount: number;
  accountsCount: number;
  contactsCount: number;
} {
  const accounts = new Set<string>();
  let contacts = 0;

  for (const row of rows) {
    accounts.add(row.accountRecordId?.trim() || row.id.trim() || row.businessAccountId.trim());
    if (row.contactId !== null && row.contactId !== undefined) {
      contacts += 1;
    }
  }

  return {
    rowsCount: rows.length,
    accountsCount: accounts.size,
    contactsCount: contacts,
  };
}

function kickGeocodeWorker(): void {
  if (geocodeInFlight) {
    return;
  }

  geocodeInFlight = (async () => {
    try {
      while ((await geocodePendingAddresses(150)) > 0) {
        // keep draining pending work
      }
    } finally {
      geocodeInFlight = null;
      invalidateReadModelCaches();
    }
  })();
}

async function runFullSync(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<void> {
  const startedAt = new Date().toISOString();
  let currentPhase = "fetch";
  console.info("[sync]", {
    event: "started",
    startedAt,
  });
  writeSyncState({
    status: "running",
    started_at: startedAt,
    completed_at: null,
    last_error: null,
    phase: "fetch",
    progress_json: JSON.stringify({
      fetchedAccounts: 0,
      fetchedContacts: 0,
      totalAccounts: null,
      totalContacts: null,
    }),
  });

  try {
    const { fetchAllSyncRows } = await import("@/lib/data-quality-live");
    const rows = await fetchAllSyncRows(
      cookieValue,
      authCookieRefresh ?? { value: null },
      { includeInternal: true },
    );
    const counts = computeCounts(rows);
    currentPhase = "persist";
    console.info("[sync]", {
      event: "persisting",
      startedAt,
      rowsCount: counts.rowsCount,
      accountsCount: counts.accountsCount,
      contactsCount: counts.contactsCount,
    });

    writeSyncState({
      status: "running",
      phase: "persist",
      rows_count: counts.rowsCount,
      accounts_count: counts.accountsCount,
      contacts_count: counts.contactsCount,
      progress_json: JSON.stringify({
        fetchedAccounts: counts.accountsCount,
        fetchedContacts: counts.contactsCount,
        totalAccounts: counts.accountsCount,
        totalContacts: counts.contactsCount,
      }),
    });

    replaceAllAccountRows(rows);
    const employeeDirectorySnapshot = readEmployeeDirectorySnapshot();
    if (
      employeeDirectorySnapshot.source !== FULL_EMPLOYEE_DIRECTORY_SOURCE ||
      employeeDirectorySnapshot.items.length === 0
    ) {
      replaceEmployeeDirectory(
        buildEmployeeDirectoryFromRows(rows),
        DERIVED_EMPLOYEE_DIRECTORY_SOURCE,
      );
    }
    currentPhase = "employee-cache";
    writeSyncState({
      status: "running",
      phase: "employee-cache",
      rows_count: counts.rowsCount,
      accounts_count: counts.accountsCount,
      contacts_count: counts.contactsCount,
      progress_json: JSON.stringify({
        fetchedAccounts: counts.accountsCount,
        fetchedContacts: counts.contactsCount,
        totalAccounts: counts.accountsCount,
        totalContacts: counts.contactsCount,
      }),
    });
    try {
      try {
        await withServiceAcumaticaSession(null, (serviceCookieValue, serviceRefresh) =>
          syncCallEmployeeDirectory(serviceCookieValue, serviceRefresh),
        );
      } catch {
        await syncCallEmployeeDirectory(cookieValue, authCookieRefresh);
      }
    } catch (error) {
      console.warn("[sync]", {
        event: "employee_cache_failed",
        startedAt,
        phase: currentPhase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    currentPhase = "meetings";
    writeSyncState({
      status: "running",
      phase: "meetings",
      rows_count: counts.rowsCount,
      accounts_count: counts.accountsCount,
      contacts_count: counts.contactsCount,
      progress_json: JSON.stringify({
        fetchedAccounts: counts.accountsCount,
        fetchedContacts: counts.contactsCount,
        totalAccounts: counts.accountsCount,
        totalContacts: counts.contactsCount,
      }),
    });
    try {
      try {
        await withServiceAcumaticaSession(null, (serviceCookieValue, serviceRefresh) =>
          syncMeetingBookings(serviceCookieValue, serviceRefresh),
        );
      } catch {
        await syncMeetingBookings(cookieValue, authCookieRefresh);
      }
    } catch (error) {
      console.warn("[sync]", {
        event: "meeting_cache_failed",
        startedAt,
        phase: currentPhase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    queueGeocodesForRows(rows);

    const completedAt = new Date().toISOString();
    console.info("[sync]", {
      event: "completed",
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      rowsCount: counts.rowsCount,
      accountsCount: counts.accountsCount,
      contactsCount: counts.contactsCount,
    });
    writeSyncState({
      status: "idle",
      phase: null,
      completed_at: completedAt,
      last_successful_sync_at: completedAt,
      last_error: null,
      rows_count: counts.rowsCount,
      accounts_count: counts.accountsCount,
      contacts_count: counts.contactsCount,
      progress_json: null,
    });

    kickGeocodeWorker();
  } catch (error) {
    const completedAt = new Date().toISOString();
    console.warn("[sync]", {
      event: "failed",
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      phase: currentPhase,
      error: error instanceof Error ? error.message : "Sync failed.",
    });
    writeSyncState({
      status: "failed",
      phase: "failed",
      completed_at: completedAt,
      last_error: error instanceof Error ? error.message : "Sync failed.",
      progress_json: null,
    });
    throw error;
  } finally {
    invalidateReadModelCaches();
  }
}

export function readSyncStatus(): SyncStatusResponse {
  const db = getReadModelDb();
  const record = db
    .prepare(
      `
      SELECT
        status,
        started_at,
        completed_at,
        last_successful_sync_at,
        last_error,
        rows_count,
        accounts_count,
        contacts_count,
        phase,
        progress_json
      FROM sync_state
      WHERE scope = 'full'
      `,
    )
    .get() as StoredSyncState | undefined;

  return toSyncStatusResponse(record);
}

export function hasReadModelSnapshot(): boolean {
  return readSyncStatus().rowsCount > 0 || readAllAccountRowsFromReadModel().length > 0;
}

export function shouldTriggerAutoSync(): boolean {
  const {
    READ_MODEL_AUTO_SYNC_ENABLED,
    READ_MODEL_STALE_AFTER_MS,
    READ_MODEL_SYNC_INTERVAL_MS,
  } = getEnv();
  if (!READ_MODEL_AUTO_SYNC_ENABLED) {
    return false;
  }

  const status = readSyncStatus();
  if (status.status === "running") {
    return false;
  }
  if (!status.lastSuccessfulSyncAt) {
    // Do not start the first full snapshot from ordinary page loads.
    // The user should trigger the initial sync explicitly.
    return false;
  }

  const ageMs = Date.now() - new Date(status.lastSuccessfulSyncAt).getTime();
  const lastCompletionAt = status.completedAt
    ? new Date(status.completedAt).getTime()
    : null;
  const failureAgeMs =
    lastCompletionAt !== null ? Date.now() - lastCompletionAt : Number.POSITIVE_INFINITY;

  if (status.status === "failed" && failureAgeMs < READ_MODEL_SYNC_INTERVAL_MS) {
    return false;
  }

  return (
    Number.isFinite(ageMs) &&
    ageMs >= READ_MODEL_STALE_AFTER_MS &&
    ageMs >= READ_MODEL_SYNC_INTERVAL_MS
  );
}

export function triggerReadModelSync(
  cookieValue: string,
  options?: {
    authCookieRefresh?: AuthCookieRefreshState;
    force?: boolean;
  },
): Promise<SyncRunResponse> {
  if (syncInFlight) {
    return Promise.resolve({
      accepted: true,
      alreadyRunning: true,
      status: readSyncStatus(),
    });
  }

  syncInFlight = runFullSync(cookieValue, options?.authCookieRefresh)
    .catch(() => undefined)
    .finally(() => {
      syncInFlight = null;
    });

  return Promise.resolve({
    accepted: true,
    alreadyRunning: false,
    status: readSyncStatus(),
  });
}

export async function waitForReadModelSync(): Promise<SyncStatusResponse> {
  if (syncInFlight) {
    await syncInFlight;
  }
  return readSyncStatus();
}

export function maybeTriggerReadModelSync(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): void {
  if (!shouldTriggerAutoSync()) {
    return;
  }

  void triggerReadModelSync(cookieValue, { authCookieRefresh });
}

export function readReadModelEmployeesOrFallback() {
  return readEmployeeDirectory();
}
