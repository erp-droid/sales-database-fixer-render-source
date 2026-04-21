import { beforeEach, describe, expect, it, vi } from "vitest";

const readSyncStatus = vi.fn();

vi.mock("@/lib/read-model/sync", () => ({
  readSyncStatus,
}));

describe("GET /api/sync/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
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

  it("returns sync status payload and runtime identity headers", async () => {
    const { GET } = await import("@/app/api/sync/status/route");
    const response = await GET();
    const payload = (await response.json()) as {
      status: string;
      rowsCount: number;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("idle");
    expect(payload.rowsCount).toBe(3630);
    expect(response.headers.get("x-mb-runtime-instance-id")).toBeTruthy();
    expect(response.headers.get("x-mb-runtime-booted-at")).toBeTruthy();
  });
});
