import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnv = vi.fn();
const readSyncStatus = vi.fn();
const getErrorMessage = vi.fn((error: unknown) =>
  error instanceof Error ? error.message : String(error),
);

vi.mock("@/lib/env", () => ({
  getEnv,
}));

vi.mock("@/lib/read-model/sync", () => ({
  readSyncStatus,
}));

vi.mock("@/lib/errors", () => ({
  getErrorMessage,
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: true,
    });
    readSyncStatus.mockReturnValue({
      status: "idle",
      phase: null,
      startedAt: "2026-04-21T04:29:14.764Z",
      completedAt: "2026-04-21T04:32:40.256Z",
      lastSuccessfulSyncAt: "2026-04-21T04:32:40.256Z",
      deferredVisibilityVersion: "541|2026-04-20T15:26:38.531Z",
      lastError: null,
      rowsCount: 3630,
      accountsCount: 2412,
      contactsCount: 3144,
      progress: null,
      manualSyncBlockedReason: null,
    });
  });

  it("returns the sync status payload when read model is enabled", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const payload = (await response.json()) as {
      ok: boolean;
      readModelEnabled: boolean;
      syncStatus: { status: string; rowsCount: number };
      runtimeIdentity: { instanceId: string; bootedAt: string };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.readModelEnabled).toBe(true);
    expect(payload.syncStatus.status).toBe("idle");
    expect(payload.syncStatus.rowsCount).toBe(3630);
    expect(payload.runtimeIdentity.instanceId.length).toBeGreaterThan(0);
    expect(typeof payload.runtimeIdentity.bootedAt).toBe("string");
    expect(response.headers.get("x-mb-runtime-instance-id")).toBe(payload.runtimeIdentity.instanceId);
    expect(response.headers.get("x-mb-runtime-booted-at")).toBe(payload.runtimeIdentity.bootedAt);
  });

  it("keeps syncStatus populated even when READ_MODEL_ENABLED is false", async () => {
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: false,
    });

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const payload = (await response.json()) as {
      ok: boolean;
      readModelEnabled: boolean;
      syncStatus: { status: string } | null;
      runtimeIdentity: { instanceId: string; bootedAt: string };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.readModelEnabled).toBe(false);
    expect(payload.syncStatus).not.toBeNull();
    expect(payload.syncStatus?.status).toBe("idle");
    expect(readSyncStatus).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-mb-runtime-instance-id")).toBe(payload.runtimeIdentity.instanceId);
    expect(response.headers.get("x-mb-runtime-booted-at")).toBe(payload.runtimeIdentity.bootedAt);
  });

  it("returns a 500 payload when sync status lookup fails", async () => {
    readSyncStatus.mockImplementation(() => {
      throw new Error("read model unavailable");
    });
    getErrorMessage.mockReturnValueOnce("read model unavailable");

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const payload = (await response.json()) as {
      ok: boolean;
      timestamp: string;
      error: string;
      runtimeIdentity: { instanceId: string; bootedAt: string };
    };

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(typeof payload.timestamp).toBe("string");
    expect(payload.error).toBe("read model unavailable");
    expect(response.headers.get("x-mb-runtime-instance-id")).toBe(payload.runtimeIdentity.instanceId);
    expect(response.headers.get("x-mb-runtime-booted-at")).toBe(payload.runtimeIdentity.bootedAt);
  });
});
