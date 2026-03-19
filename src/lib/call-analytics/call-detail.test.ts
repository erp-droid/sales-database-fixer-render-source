import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CallActivitySyncRecord,
  CallLegRecord,
  CallSessionRecord,
} from "@/lib/call-analytics/types";

const readCallSessionByIdMock = vi.fn<() => CallSessionRecord | null>();
const readCallLegsBySessionIdMock = vi.fn<() => CallLegRecord[]>();
const readCallActivitySyncBySessionIdMock = vi.fn<() => CallActivitySyncRecord | null>();

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallSessionById: readCallSessionByIdMock,
  readCallLegsBySessionId: readCallLegsBySessionIdMock,
  readCallSessions: vi.fn(() => []),
}));

vi.mock("@/lib/call-analytics/postcall-store", () => ({
  readCallActivitySyncBySessionId: readCallActivitySyncBySessionIdMock,
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory: vi.fn(() => []),
}));

vi.mock("@/lib/call-analytics/ingest", () => ({
  readCallIngestState: vi.fn(() => ({
    scope: "voice",
    status: "complete",
    lastRecentSyncAt: "2026-03-11T00:00:00.000Z",
    lastFullBackfillAt: "2026-03-10T00:00:00.000Z",
    latestSeenStartTime: "2026-03-11T00:00:00.000Z",
    oldestSeenStartTime: "2026-03-01T00:00:00.000Z",
    fullHistoryComplete: true,
    lastWebhookAt: "2026-03-11T00:00:00.000Z",
    lastError: null,
    progress: null,
    updatedAt: "2026-03-11T00:00:00.000Z",
  })),
}));

function buildSession(): CallSessionRecord {
  return {
    sessionId: "call-1",
    rootCallSid: "CA-root",
    primaryLegSid: "CA-child",
    source: "app_bridge",
    direction: "outbound",
    outcome: "answered",
    answered: true,
    startedAt: "2026-03-11T14:00:00.000Z",
    answeredAt: "2026-03-11T14:00:03.000Z",
    endedAt: "2026-03-11T14:10:00.000Z",
    talkDurationSeconds: 597,
    ringDurationSeconds: 3,
    employeeLoginName: "jserrano",
    employeeDisplayName: "Jorge Serrano",
    employeeContactId: 157497,
    employeePhone: "+14162304681",
    recipientEmployeeLoginName: null,
    recipientEmployeeDisplayName: null,
    presentedCallerId: "+14162304681",
    bridgeNumber: "+16474929859",
    targetPhone: "+14163153228",
    counterpartyPhone: "+14163153228",
    matchedContactId: 91,
    matchedContactName: "Alex Prospect",
    matchedBusinessAccountId: "B2001",
    matchedCompanyName: "Prospect Co",
    phoneMatchType: "contact_phone",
    phoneMatchAmbiguityCount: 1,
    initiatedFromSurface: "accounts",
    linkedAccountRowKey: "row-1",
    linkedBusinessAccountId: "B2001",
    linkedContactId: 91,
    metadataJson: "{}",
    updatedAt: "2026-03-11T14:10:00.000Z",
  };
}

describe("buildDashboardCallDetail", () => {
  beforeEach(() => {
    vi.resetModules();
    readCallSessionByIdMock.mockReset();
    readCallLegsBySessionIdMock.mockReset();
    readCallActivitySyncBySessionIdMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes activity sync status in the detail payload", async () => {
    readCallSessionByIdMock.mockReturnValue(buildSession());
    readCallLegsBySessionIdMock.mockReturnValue([]);
    readCallActivitySyncBySessionIdMock.mockReturnValue({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
      status: "failed",
      attempts: 2,
      transcriptText: "Transcript",
      summaryText: "Summary",
      activityId: null,
      error: "Missing phone call activity type",
      recordingDeletedAt: null,
      createdAt: "2026-03-11T14:11:00.000Z",
      updatedAt: "2026-03-11T14:12:00.000Z",
    });

    const { buildDashboardCallDetail } = await import("@/lib/call-analytics/queries");
    const detail = buildDashboardCallDetail("call-1");

    expect(detail?.activitySync).toEqual({
      status: "failed",
      activityId: null,
      error: "Missing phone call activity type",
      updatedAt: "2026-03-11T14:12:00.000Z",
    });
  });
});

