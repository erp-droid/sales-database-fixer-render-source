import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthCookieValue = vi.fn();
const getStoredLoginName = vi.fn();
const normalizeSessionIdentity = vi.fn();
const setAuthCookie = vi.fn();
const validateSessionWithAcumatica = vi.fn();
const resolveCallerProfile = vi.fn();
const startBridgeCall = vi.fn();
const endBridgeCall = vi.fn();
const readCallSessionById = vi.fn();
const reconcileTwilioSession = vi.fn();
const ensureCallActivitySyncQueuedForSession = vi.fn();
const createCallSessionId = vi.fn();
const buildTwilioBridgeCallbacks = vi.fn();
const recordProvisionalBridgeCall = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthCookieValue,
  getStoredLoginName,
  normalizeSessionIdentity,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  validateSessionWithAcumatica,
}));

vi.mock("@/lib/twilio-outbound", () => ({
  resolveCallerProfile,
  startBridgeCall,
  endBridgeCall,
}));

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallSessionById,
}));

vi.mock("@/lib/call-analytics/ingest", () => ({
  reconcileTwilioSession,
  createCallSessionId,
  buildTwilioBridgeCallbacks,
  recordProvisionalBridgeCall,
}));

vi.mock("@/lib/call-analytics/postcall-worker", () => ({
  ensureCallActivitySyncQueuedForSession,
}));

describe("POST /api/twilio/call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("bkoczka");
    validateSessionWithAcumatica.mockResolvedValue({ ok: true });
    normalizeSessionIdentity.mockReturnValue({
      id: "bkoczka",
      name: "Brock Koczka",
      employeeId: "E0000142",
    });
    createCallSessionId.mockReturnValue("session-1");
    buildTwilioBridgeCallbacks.mockReturnValue({
      parentStatusCallback: "https://example.com/parent",
      childStatusCallback: "https://example.com/child",
      recordingStatusCallback: "https://example.com/recording",
    });
  });

  it("normalizes generic Acumatica Employee-form failures into employee phone guidance", async () => {
    resolveCallerProfile.mockRejectedValueOnce(
      new Error("The custom error module does not recognize this error."),
    );

    const { POST } = await import("@/app/api/twilio/call/route");
    const response = await POST(
      new NextRequest("http://localhost/api/twilio/call", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: "+14165550123",
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Calling is unavailable until the signed-in employee phone can be read from Acumatica.",
      details: undefined,
    });
    expect(resolveCallerProfile).toHaveBeenCalledWith("cookie", "bkoczka");
    expect(startBridgeCall).not.toHaveBeenCalled();
  });
});
