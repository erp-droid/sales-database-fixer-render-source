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
    manualSyncBlockedReason: null,
  },
}));
const readManualSyncBlockedReason = vi.fn(() => null);

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  validateSessionWithAcumatica,
}));

vi.mock("@/lib/read-model/sync", () => ({
  triggerReadModelSync,
  readManualSyncBlockedReason,
}));

describe("POST /api/sync/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    readManualSyncBlockedReason.mockReturnValue(null);
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
