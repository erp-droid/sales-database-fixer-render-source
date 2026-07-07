import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const importAppStateTransferSnapshot = vi.fn();

vi.mock("@/lib/state-transfer", () => ({
  importAppStateTransferSnapshot,
}));

function makeRequest(headers?: HeadersInit, body: unknown = { version: 1, tables: {} }): NextRequest {
  return new NextRequest("https://sales-meadowb.onrender.com/api/system/state-transfer/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/system/state-transfer/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STATE_TRANSFER_SYSTEM_KEY = "state-transfer-secret";
    delete process.env.CALL_ACTIVITY_SYNC_SECRET;
    delete process.env.DAILY_CALL_COACHING_SECRET;
    importAppStateTransferSnapshot.mockResolvedValue({
      backupPath: "/app/data/state-transfer-backups/state-transfer-backup.json",
      importedTables: [{ name: "account_rows", rowCount: 1 }],
      importedHistory: true,
    });
  });

  it("rejects requests without a system key", async () => {
    const { POST } = await import("@/app/api/system/state-transfer/import/route");
    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(importAppStateTransferSnapshot).not.toHaveBeenCalled();
  });

  it("imports an authorized state transfer snapshot", async () => {
    const { POST } = await import("@/app/api/system/state-transfer/import/route");
    const snapshot = {
      version: 1,
      tables: {
        account_rows: [{ id: "account-1" }],
        account_notes: [{ id: "note-1" }],
      },
      dataQualityHistory: null,
    };
    const response = await POST(makeRequest({ "x-system-key": "state-transfer-secret" }, snapshot));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.importedTables).toEqual([{ name: "account_rows", rowCount: 1 }]);
    expect(importAppStateTransferSnapshot).toHaveBeenCalledWith(snapshot);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a bad request when snapshot import fails", async () => {
    importAppStateTransferSnapshot.mockRejectedValueOnce(new Error("Snapshot version is not supported."));

    const { POST } = await import("@/app/api/system/state-transfer/import/route");
    const response = await POST(makeRequest({ "x-system-key": "state-transfer-secret" }, { version: 999 }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Snapshot version is not supported.");
  });
});
