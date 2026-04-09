import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setCallAnalyticsEnv(): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.CALL_ANALYTICS_STALE_AFTER_MS = "300000";
  process.env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS = "86400000";
}

describe("call analytics refresh gating", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    setCallAnalyticsEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("does not auto-refresh when no call snapshot exists", async () => {
    const { shouldTriggerCallAnalyticsAutoRefresh } = await import("@/lib/call-analytics/ingest");

    expect(
      shouldTriggerCallAnalyticsAutoRefresh({
        status: "idle",
        lastRecentSyncAt: null,
        lastFullBackfillAt: null,
        updatedAt: "2026-03-09T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("allows an empty snapshot to trigger the first import when explicitly enabled", async () => {
    const { shouldTriggerCallAnalyticsAutoRefresh } = await import("@/lib/call-analytics/ingest");

    expect(
      shouldTriggerCallAnalyticsAutoRefresh(
        {
          status: "idle",
          lastRecentSyncAt: null,
          lastFullBackfillAt: null,
          updatedAt: "2026-03-09T00:00:00.000Z",
        },
        Date.parse("2026-03-09T00:01:00.000Z"),
        300_000,
        { allowEmptySnapshot: true },
      ),
    ).toBe(true);
  });

  it("does not auto-refresh while a refresh is already running", async () => {
    const { shouldTriggerCallAnalyticsAutoRefresh } = await import("@/lib/call-analytics/ingest");

    expect(
      shouldTriggerCallAnalyticsAutoRefresh(
        {
          status: "recent_sync_running",
          lastRecentSyncAt: "2026-03-09T00:00:00.000Z",
          lastFullBackfillAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-09T00:00:00.000Z",
        },
        Date.parse("2026-03-09T00:10:00.000Z"),
      ),
    ).toBe(false);
  });

  it("allows auto-refresh once the snapshot is stale", async () => {
    const { shouldTriggerCallAnalyticsAutoRefresh } = await import("@/lib/call-analytics/ingest");

    expect(
      shouldTriggerCallAnalyticsAutoRefresh(
        {
          status: "complete",
          lastRecentSyncAt: "2026-03-09T00:00:00.000Z",
          lastFullBackfillAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-09T00:00:00.000Z",
        },
        Date.parse("2026-03-09T00:06:00.000Z"),
        300_000,
      ),
    ).toBe(true);
  });

  it("skips employee directory refresh while the directory is still fresh", async () => {
    const { shouldRefreshCallEmployeeDirectory } = await import("@/lib/call-analytics/ingest");

    expect(
      shouldRefreshCallEmployeeDirectory(
        {
          total: 3,
          latestUpdatedAt: "2026-03-09T00:00:00.000Z",
        },
        Date.parse("2026-03-09T12:00:00.000Z"),
        86_400_000,
      ),
    ).toBe(false);
  });

  it("refreshes the employee directory when it is empty or stale", async () => {
    const { shouldRefreshCallEmployeeDirectory } = await import("@/lib/call-analytics/ingest");

    expect(
      shouldRefreshCallEmployeeDirectory({
        total: 0,
        latestUpdatedAt: null,
      }),
    ).toBe(true);

    expect(
      shouldRefreshCallEmployeeDirectory(
        {
          total: 3,
          latestUpdatedAt: "2026-03-08T00:00:00.000Z",
        },
        Date.parse("2026-03-09T12:00:00.000Z"),
        86_400_000,
      ),
    ).toBe(true);
  });

  it("clears a stale import error when a successful refresh explicitly sets lastError to null", async () => {
    const { mergeCallIngestState } = await import("@/lib/call-analytics/ingest");

    const merged = mergeCallIngestState(
      {
        scope: "voice",
        status: "error",
        lastRecentSyncAt: "2026-04-08T18:21:59.532Z",
        lastFullBackfillAt: null,
        latestSeenStartTime: "2026-04-08T18:14:25.000Z",
        oldestSeenStartTime: "2026-03-09T16:53:18.000Z",
        fullHistoryComplete: true,
        lastWebhookAt: null,
        lastError: "The service is unavailable.",
        progress: null,
        updatedAt: "2026-04-09T10:00:00.000Z",
      },
      {
        status: "complete",
        lastRecentSyncAt: "2026-04-09T12:22:27.826Z",
        latestSeenStartTime: "2026-04-09T12:20:22.000Z",
        lastError: null,
      },
    );

    expect(merged.status).toBe("complete");
    expect(merged.lastError).toBeNull();
    expect(merged.lastRecentSyncAt).toBe("2026-04-09T12:22:27.826Z");
    expect(merged.latestSeenStartTime).toBe("2026-04-09T12:20:22.000Z");
  });

  it("merges verified Twilio caller IDs into the call employee directory without duplicating known phones", async () => {
    const { mergeVerifiedCallerDirectoryEntries } = await import("@/lib/call-analytics/ingest");

    const merged = mergeVerifiedCallerDirectoryEntries(
      [
        {
          loginName: "jlee",
          contactId: 159842,
          displayName: "Jacky Lee",
          email: "jlee@meadowb.com",
          normalizedPhone: null,
          callerIdPhone: null,
          isActive: true,
          updatedAt: "2026-03-19T10:00:00.000Z",
        },
      ],
      [
        {
          loginName: "jackylee",
          displayName: "Jacky Lee",
          phoneNumber: "+13653411781",
        },
        {
          loginName: "kallen",
          displayName: "Kallen",
          phoneNumber: "+16473023891",
        },
      ],
    );

    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          loginName: "jlee",
          displayName: "Jacky Lee",
          normalizedPhone: "+13653411781",
          callerIdPhone: "+13653411781",
        }),
        expect.objectContaining({
          loginName: "kallen",
          displayName: "Kallen",
          normalizedPhone: "+16473023891",
          callerIdPhone: "+16473023891",
        }),
      ]),
    );
    expect(merged).toHaveLength(2);
  });
});
