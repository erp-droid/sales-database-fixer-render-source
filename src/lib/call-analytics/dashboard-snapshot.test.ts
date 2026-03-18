import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CallSessionRecord, DashboardFilters } from "@/lib/call-analytics/types";

const readCallSessionsMock = vi.fn<() => CallSessionRecord[]>();
const readCallEmployeeDirectoryMock = vi.fn<
  () => Array<{
    loginName: string;
    contactId: number | null;
    displayName: string;
    email: string | null;
    normalizedPhone: string | null;
    callerIdPhone: string | null;
    isActive: boolean;
    updatedAt: string;
  }>
>();
const listMeetingBookingsMock = vi.fn();

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallSessions: readCallSessionsMock,
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory: readCallEmployeeDirectoryMock,
}));

vi.mock("@/lib/meeting-bookings", () => ({
  listMeetingBookings: listMeetingBookingsMock,
}));

function setSnapshotEnv(): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.CALL_ANALYTICS_STALE_AFTER_MS = "300000";
}

function buildSession(overrides: Partial<CallSessionRecord>): CallSessionRecord {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    rootCallSid: overrides.rootCallSid ?? "CA-root",
    primaryLegSid: overrides.primaryLegSid ?? "CA-leg",
    source: overrides.source ?? "app_bridge",
    direction: overrides.direction ?? "outbound",
    outcome: overrides.outcome ?? "answered",
    answered: overrides.answered ?? true,
    startedAt: overrides.startedAt ?? "2026-03-08T14:00:00.000Z",
    answeredAt: overrides.answeredAt ?? "2026-03-08T14:00:03.000Z",
    endedAt: overrides.endedAt ?? "2026-03-08T14:05:00.000Z",
    talkDurationSeconds: overrides.talkDurationSeconds ?? 297,
    ringDurationSeconds: overrides.ringDurationSeconds ?? 3,
    employeeLoginName: overrides.employeeLoginName ?? "jserrano",
    employeeDisplayName: overrides.employeeDisplayName ?? "Jorge Serrano",
    employeeContactId: overrides.employeeContactId ?? 1,
    employeePhone: overrides.employeePhone ?? "+14162304681",
    recipientEmployeeLoginName: overrides.recipientEmployeeLoginName ?? null,
    recipientEmployeeDisplayName: overrides.recipientEmployeeDisplayName ?? null,
    presentedCallerId: overrides.presentedCallerId ?? "+14162304681",
    bridgeNumber: overrides.bridgeNumber ?? "+16474929859",
    targetPhone: overrides.targetPhone ?? "+14163153228",
    counterpartyPhone: overrides.counterpartyPhone ?? "+14163153228",
    matchedContactId: overrides.matchedContactId ?? 91,
    matchedContactName: overrides.matchedContactName ?? "Alex Prospect",
    matchedBusinessAccountId: overrides.matchedBusinessAccountId ?? "B2001",
    matchedCompanyName: overrides.matchedCompanyName ?? "Prospect Co",
    phoneMatchType: overrides.phoneMatchType ?? "contact_phone",
    phoneMatchAmbiguityCount: overrides.phoneMatchAmbiguityCount ?? 1,
    initiatedFromSurface: overrides.initiatedFromSurface ?? "accounts",
    linkedAccountRowKey: overrides.linkedAccountRowKey ?? "row-1",
    linkedBusinessAccountId: overrides.linkedBusinessAccountId ?? "B2001",
    linkedContactId: overrides.linkedContactId ?? 91,
    metadataJson: overrides.metadataJson ?? "{}",
    updatedAt: overrides.updatedAt ?? "2026-03-08T14:05:00.000Z",
  };
}

const baseFilters: DashboardFilters = {
  start: "2026-03-07T00:00:00.000Z",
  end: "2026-03-10T00:00:00.000Z",
  employees: [],
  direction: "all",
  outcome: "all",
  source: "all",
  search: "",
};

describe("dashboard snapshot builder and cache", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    readCallSessionsMock.mockReset();
    readCallEmployeeDirectoryMock.mockReset();
    listMeetingBookingsMock.mockReset();
    listMeetingBookingsMock.mockReturnValue([]);
    setSnapshotEnv();
  });

  afterEach(async () => {
    const cacheModule = await import("@/lib/call-analytics/dashboard-cache");
    cacheModule.invalidateDashboardSnapshotCache();
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("builds team stats, activity ordering, and bucket drilldowns from one session set", async () => {
    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    const snapshot = snapshotModule.buildDashboardSnapshotForTests(
      baseFilters,
      [
        buildSession({
          sessionId: "bucket-1-a",
          employeeLoginName: "jserrano",
          employeeDisplayName: "Jorge Serrano",
          startedAt: "2026-03-08T14:00:00.000Z",
          talkDurationSeconds: 120,
          matchedCompanyName: "Northwind",
        }),
        buildSession({
          sessionId: "bucket-1-b",
          employeeLoginName: "dcowell",
          employeeDisplayName: "Derek Cowell",
          startedAt: "2026-03-08T16:00:00.000Z",
          answered: false,
          outcome: "no_answer",
          talkDurationSeconds: 0,
          matchedCompanyName: "Northwind",
        }),
        buildSession({
          sessionId: "bucket-2-a",
          employeeLoginName: "jserrano",
          employeeDisplayName: "Jorge Serrano",
          startedAt: "2026-03-09T14:00:00.000Z",
          matchedCompanyName: "Contoso",
        }),
      ],
      [
        { loginName: "jserrano", displayName: "Jorge Serrano", email: null },
        { loginName: "dcowell", displayName: "Derek Cowell", email: null },
        { loginName: "jlee", displayName: "Jacky Lee", email: null },
      ],
      undefined,
      undefined,
      undefined,
      [
        {
          id: "meeting:event-1",
          eventId: "event-1",
          actorLoginName: "jserrano",
          actorName: "Jorge Serrano",
          businessAccountRecordId: "record-1",
          businessAccountId: "B2001",
          companyName: "Northwind",
          relatedContactId: 91,
          relatedContactName: "Alex Prospect",
          meetingSummary: "Intro meeting",
          attendeeCount: 3,
          attendees: [],
          inviteAuthority: "google",
          calendarInviteStatus: "created",
          occurredAt: "2026-03-08T15:00:00.000Z",
          createdAt: "2026-03-08T15:00:00.000Z",
          updatedAt: "2026-03-08T15:00:00.000Z",
        },
      ],
    );

    expect(snapshot.teamStats.totalCalls).toBe(3);
    expect(snapshot.meetingStats.totalMeetings).toBe(1);
    expect(snapshot.meetingLeaderboard[0]?.loginName).toBe("jserrano");
    expect(snapshot.recentMeetings[0]?.meetingSummary).toBe("Intro meeting");
    expect(snapshot.teamStats.outboundCalls).toBe(3);
    expect(snapshot.employeeLeaderboard[0]?.loginName).toBe("jserrano");
    expect(snapshot.activityGaps[0]?.loginName).toBe("jlee");
    expect(snapshot.bucketDrilldowns).toHaveLength(2);
    expect(snapshot.bucketDrilldowns[0]?.companies[0]?.label).toBe("Northwind");
    expect(snapshot.bucketDrilldowns[0]?.outcomes[0]?.label).toBe("answered");
  });

  it("returns warm cache hits without rereading call sessions", async () => {
    readCallSessionsMock.mockReturnValue([buildSession({ sessionId: "cached-1" })]);
    listMeetingBookingsMock.mockReturnValue([]);
    readCallEmployeeDirectoryMock.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 1,
        displayName: "Jorge Serrano",
        email: null,
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-03-09T00:00:00.000Z",
      },
    ]);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-03-09T00:00:00.000Z"));

    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");

    await snapshotModule.getDashboardSnapshot(baseFilters);
    await snapshotModule.getDashboardSnapshot(baseFilters);

    expect(readCallSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("expires cached snapshots after the ttl", async () => {
    readCallSessionsMock.mockReturnValue([buildSession({ sessionId: "ttl-1" })]);
    listMeetingBookingsMock.mockReturnValue([]);
    readCallEmployeeDirectoryMock.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 1,
        displayName: "Jorge Serrano",
        email: null,
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-03-09T00:00:00.000Z",
      },
    ]);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(Date.parse("2026-03-09T00:00:00.000Z"));

    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    await snapshotModule.getDashboardSnapshot(baseFilters);

    nowSpy.mockReturnValue(Date.parse("2026-03-09T00:06:00.000Z"));
    await snapshotModule.getDashboardSnapshot(baseFilters);

    expect(readCallSessionsMock).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent in-flight snapshot requests", async () => {
    readCallSessionsMock.mockImplementation(
      () =>
        [buildSession({ sessionId: "in-flight-1" })],
    );
    listMeetingBookingsMock.mockReturnValue([]);
    readCallEmployeeDirectoryMock.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 1,
        displayName: "Jorge Serrano",
        email: null,
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-03-09T00:00:00.000Z",
      },
    ]);

    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    const [left, right] = await Promise.all([
      snapshotModule.getDashboardSnapshot(baseFilters),
      snapshotModule.getDashboardSnapshot(baseFilters),
    ]);

    expect(readCallSessionsMock).toHaveBeenCalledTimes(1);
    expect(left.generatedAt).toBe(right.generatedAt);
  });

  it("recomputes after explicit cache invalidation", async () => {
    readCallSessionsMock.mockReturnValue([buildSession({ sessionId: "invalidate-1" })]);
    listMeetingBookingsMock.mockReturnValue([]);
    readCallEmployeeDirectoryMock.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 1,
        displayName: "Jorge Serrano",
        email: null,
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-03-09T00:00:00.000Z",
      },
    ]);

    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    const cacheModule = await import("@/lib/call-analytics/dashboard-cache");

    await snapshotModule.getDashboardSnapshot(baseFilters);
    cacheModule.invalidateDashboardSnapshotCache();
    await snapshotModule.getDashboardSnapshot(baseFilters);

    expect(readCallSessionsMock).toHaveBeenCalledTimes(2);
  });
});
