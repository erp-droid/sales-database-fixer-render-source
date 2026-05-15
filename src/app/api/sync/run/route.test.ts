import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const validateSessionWithAcumatica = vi.fn(async () => ({ ok: true }));
const triggerReadModelSync = vi.fn(async () => ({
  accepted: true,
  alreadyRunning: false,
  status: {
    status: "idle" as const,
    phase: null,
    startedAt: null,
    completedAt: null,
    lastSuccessfulSyncAt: "2026-04-14T12:00:00.000Z",
    lastError: null,
    rowsCount: 100,
    accountsCount: 90,
    contactsCount: 80,
    progress: null,
    fullSyncEnabled: true,
    manualSyncBlockedReason: null,
  },
}));
const readManualSyncBlockedReason = vi.fn(() => null);
const getEnv = vi.fn(() => ({
  READ_MODEL_FULL_SYNC_ENABLED: true,
  READ_MODEL_SYNC_STALE_RUNNING_AFTER_MS: 1_800_000,
}));

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  validateSessionWithAcumatica,
}));

vi.mock("@/lib/read-model/sync", () => ({
  FULL_READ_MODEL_SYNC_DISABLED_REASON:
    "Full Acumatica read-model sync is disabled because SQLite is the source of truth for local account edits.",
  triggerReadModelSync,
  readManualSyncBlockedReason,
}));

vi.mock("@/lib/env", () => ({
  getEnv,
}));

describe("POST /api/sync/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    readManualSyncBlockedReason.mockReturnValue(null);
    getEnv.mockReturnValue({
      READ_MODEL_FULL_SYNC_ENABLED: true,
      READ_MODEL_SYNC_STALE_RUNNING_AFTER_MS: 1_800_000,
    });
  });

  it("blocks immediately when full read-model sync is disabled", async () => {
    getEnv.mockReturnValueOnce({
      READ_MODEL_FULL_SYNC_ENABLED: false,
      READ_MODEL_SYNC_STALE_RUNNING_AFTER_MS: 1_800_000,
    });

    const { POST } = await import("@/app/api/sync/run/route");
    const response = await POST(
      new NextRequest("http://localhost/api/sync/run", {
        method: "POST",
        headers: {
          cookie: ".ASPXAUTH=existing-cookie",
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Full Acumatica read-model sync is disabled because SQLite is the source of truth for local account edits.",
    });
    expect(validateSessionWithAcumatica).not.toHaveBeenCalled();
    expect(triggerReadModelSync).not.toHaveBeenCalled();
  });

  it("optionally force-unlocks a stale running lock before checking safeguards", async () => {
    readManualSyncBlockedReason
      .mockReturnValueOnce("A full account sync is already running.")
      .mockReturnValueOnce(null);

    const { POST } = await import("@/app/api/sync/run/route");
    const response = await POST(
      new NextRequest("http://localhost/api/sync/run?forceUnlock=1", {
        method: "POST",
        headers: {
          cookie: ".ASPXAUTH=existing-cookie",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(readManualSyncBlockedReason).toHaveBeenNthCalledWith(
      1,
      expect.any(Number),
    );
    expect(readManualSyncBlockedReason).toHaveBeenCalledTimes(2);
  });

  it("rejects sync attempts during a blocked window", async () => {
    readManualSyncBlockedReason.mockReturnValue(
      "Sync is temporarily blocked while 1 live call is in progress.",
    );

    const { POST } = await import("@/app/api/sync/run/route");
    const response = await POST(
      new NextRequest("http://localhost/api/sync/run", {
        method: "POST",
        headers: {
          cookie: ".ASPXAUTH=existing-cookie",
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Sync is temporarily blocked while 1 live call is in progress.",
    });
    expect(triggerReadModelSync).not.toHaveBeenCalled();
  });

  it("starts sync when no safeguard is active", async () => {
    const { POST } = await import("@/app/api/sync/run/route");
    const response = await POST(
      new NextRequest("http://localhost/api/sync/run", {
        method: "POST",
        headers: {
          cookie: ".ASPXAUTH=existing-cookie",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(validateSessionWithAcumatica).toHaveBeenCalled();
    expect(triggerReadModelSync).toHaveBeenCalledWith("cookie", {
      authCookieRefresh: expect.any(Object),
      force: true,
    });
  });

  it("returns a hard block when another sync is already in flight", async () => {
    triggerReadModelSync.mockResolvedValueOnce({
      accepted: true,
      alreadyRunning: true,
      status: {
        status: "running" as const,
        phase: "fetch",
        startedAt: "2026-04-14T12:00:00.000Z",
        completedAt: null,
        lastSuccessfulSyncAt: "2026-04-14T11:45:00.000Z",
        lastError: null,
        rowsCount: 100,
        accountsCount: 90,
        contactsCount: 80,
        progress: null,
        fullSyncEnabled: true,
        manualSyncBlockedReason: null,
      },
    });

    const { POST } = await import("@/app/api/sync/run/route");
    const response = await POST(
      new NextRequest("http://localhost/api/sync/run", {
        method: "POST",
        headers: {
          cookie: ".ASPXAUTH=existing-cookie",
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "A full account sync is already running.",
    });
  });
});
