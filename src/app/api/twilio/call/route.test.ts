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
const findRecentBridgeCallSessionForEmployee = vi.fn();
const reconcileTwilioSession = vi.fn();
const ensureCallActivitySyncQueuedForSession = vi.fn();
const createCallSessionId = vi.fn();
const buildTwilioBridgeCallbacks = vi.fn();
const recordProvisionalBridgeCall = vi.fn();

type StartedBridgeCallPayload = {
  sid: string;
  status: string;
  bridgeNumber: string;
  callerId: string;
  userPhone: string;
  targetPhone: string;
};

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
  findRecentBridgeCallSessionForEmployee,
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
    findRecentBridgeCallSessionForEmployee.mockReturnValue(null);
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

  it("reuses an existing recent bridge call instead of starting a duplicate", async () => {
    resolveCallerProfile.mockResolvedValueOnce({
      loginName: "bkoczka",
      employeeId: "E0000142",
      contactId: 42,
      displayName: "Brock Koczka",
      email: "bkoczka@example.com",
      userPhone: "+14165550111",
      callerId: "+14165550111",
      bridgeNumber: "+14165559999",
    });
    findRecentBridgeCallSessionForEmployee.mockReturnValueOnce({
      sessionId: "session-existing",
      rootCallSid: "CAexisting",
      primaryLegSid: null,
      source: "app_bridge",
      direction: "outbound",
      outcome: "in_progress",
      answered: false,
      startedAt: "2026-03-25T13:57:10.000Z",
      answeredAt: null,
      endedAt: null,
      talkDurationSeconds: null,
      ringDurationSeconds: null,
      employeeLoginName: "bkoczka",
      employeeDisplayName: "Brock Koczka",
      employeeContactId: 42,
      employeePhone: "+14165550111",
      recipientEmployeeLoginName: null,
      recipientEmployeeDisplayName: null,
      presentedCallerId: "+14165550111",
      bridgeNumber: "+14165559999",
      targetPhone: "+14165550123",
      counterpartyPhone: "+14165550123",
      matchedContactId: null,
      matchedContactName: null,
      matchedBusinessAccountId: null,
      matchedCompanyName: null,
      phoneMatchType: "none",
      phoneMatchAmbiguityCount: 0,
      initiatedFromSurface: "accounts",
      linkedAccountRowKey: null,
      linkedBusinessAccountId: null,
      linkedContactId: null,
      metadataJson: "{}",
      updatedAt: new Date().toISOString(),
    });

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deduped: true,
      sessionId: "session-existing",
      callSid: "CAexisting",
      status: "in_progress",
      bridgeNumber: "+14165559999",
      callerId: "+14165550111",
      userPhone: "+14165550111",
      targetPhone: "+14165550123",
      callerDisplayName: "Brock Koczka",
    });
    expect(startBridgeCall).not.toHaveBeenCalled();
    expect(recordProvisionalBridgeCall).not.toHaveBeenCalled();
  });

  it("coalesces concurrent duplicate start requests into one bridge call", async () => {
    createCallSessionId.mockReturnValueOnce("session-1").mockReturnValueOnce("session-2");
    resolveCallerProfile.mockResolvedValue({
      loginName: "bkoczka",
      employeeId: "E0000142",
      contactId: 42,
      displayName: "Brock Koczka",
      email: "bkoczka@example.com",
      userPhone: "+14165550111",
      callerId: "+14165550111",
      bridgeNumber: "+14165559999",
    });

    let resolveStartedCall: ((value: StartedBridgeCallPayload) => void) | null = null;
    startBridgeCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStartedCall = resolve;
        }),
    );

    const { POST } = await import("@/app/api/twilio/call/route");

    const requestA = new NextRequest("http://localhost/api/twilio/call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: "+14165550123",
      }),
    });
    const requestB = new NextRequest("http://localhost/api/twilio/call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: "+14165550123",
      }),
    });

    const firstResponsePromise = POST(requestA);
    const secondResponsePromise = POST(requestB);

    await vi.waitFor(() => {
      expect(startBridgeCall).toHaveBeenCalledTimes(1);
    });

    if (!resolveStartedCall) {
      throw new Error("startBridgeCall was not invoked.");
    }

    const releaseStartedCall: (value: StartedBridgeCallPayload) => void = resolveStartedCall;
    releaseStartedCall({
      sid: "CAexisting",
      status: "queued",
      bridgeNumber: "+14165559999",
      callerId: "+14165550111",
      userPhone: "+14165550111",
      targetPhone: "+14165550123",
    });

    const [firstResponse, secondResponse] = await Promise.all([
      firstResponsePromise,
      secondResponsePromise,
    ]);

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({
      ok: true,
      sessionId: "session-1",
      callSid: "CAexisting",
      status: "queued",
      bridgeNumber: "+14165559999",
      callerId: "+14165550111",
      userPhone: "+14165550111",
      targetPhone: "+14165550123",
      callerDisplayName: "Brock Koczka",
    });

    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({
      ok: true,
      deduped: true,
      sessionId: "session-1",
      callSid: "CAexisting",
      status: "queued",
      bridgeNumber: "+14165559999",
      callerId: "+14165550111",
      userPhone: "+14165550111",
      targetPhone: "+14165550123",
      callerDisplayName: "Brock Koczka",
    });

    expect(recordProvisionalBridgeCall).toHaveBeenCalledTimes(1);
    expect(recordProvisionalBridgeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        rootCallSid: "CAexisting",
        targetPhone: "+14165550123",
      }),
    );
  });
});
