import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exportAppStateTransferSnapshot = vi.fn();

vi.mock("@/lib/state-transfer", () => ({
  exportAppStateTransferSnapshot,
}));

function makeRequest(headers?: HeadersInit): NextRequest {
  return new NextRequest("https://sales-meadowb.onrender.com/api/system/state-transfer/export", {
    headers,
  });
}

describe("GET /api/system/state-transfer/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STATE_TRANSFER_SYSTEM_KEY = "state-transfer-secret";
    delete process.env.CALL_ACTIVITY_SYNC_SECRET;
    delete process.env.DAILY_CALL_COACHING_SECRET;
    exportAppStateTransferSnapshot.mockResolvedValue({
      version: 1,
      createdAt: "2026-06-16T12:00:00.000Z",
      sourceLabel: "render",
      tables: { account_rows: [] },
      dataQualityHistory: null,
    });
  });

  it("rejects requests without a system key", async () => {
    const { GET } = await import("@/app/api/system/state-transfer/export/route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(exportAppStateTransferSnapshot).not.toHaveBeenCalled();
  });

  it("exports the state transfer snapshot for an authorized system request", async () => {
    const { GET } = await import("@/app/api/system/state-transfer/export/route");
    const response = await GET(makeRequest({ "x-system-key": "state-transfer-secret" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tables).toEqual({ account_rows: [] });
    expect(exportAppStateTransferSnapshot).toHaveBeenCalledWith("https://sales-meadowb.onrender.com");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts the existing call sync secret as a deployment fallback", async () => {
    delete process.env.STATE_TRANSFER_SYSTEM_KEY;
    process.env.CALL_ACTIVITY_SYNC_SECRET = "call-sync-secret";

    const { GET } = await import("@/app/api/system/state-transfer/export/route");
    const response = await GET(makeRequest({ "x-system-key": "call-sync-secret" }));

    expect(response.status).toBe(200);
  });
});
