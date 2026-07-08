import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CallSessionRecord, DashboardFilters } from "@/lib/call-analytics/types";

const readCallSessionsMock = vi.fn<() => CallSessionRecord[]>();
const readCallActivitySyncBySessionIdMock = vi.fn();
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
const readAllCallerIdentityProfilesMock = vi.fn();
const listMeetingBookingsMock = vi.fn();

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallSessions: readCallSessionsMock,
}));

vi.mock("@/lib/call-analytics/postcall-store", () => ({
  readCallActivitySyncBySessionId: readCallActivitySyncBySessionIdMock,
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory: readCallEmployeeDirectoryMock,
}));

vi.mock("@/lib/caller-identity-cache", () => ({
  readAllCallerIdentityProfiles: readAllCallerIdentityProfilesMock,
}));

vi.mock("@/lib/meeting-bookings", () => ({
  listMeetingBookings: listMeetingBookingsMock,
  resolveMeetingBookingCategory: (value: string | null | undefined) =>
    value === "Meeting" || value === "Drop Off" ? value : null,
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
    readCallActivitySyncBySessionIdMock.mockReset();
    readCallActivitySyncBySessionIdMock.mockReturnValue({
      transcriptText: "Transcript ready.",
      summaryText: "Summary ready.",
    });
    readCallEmployeeDirectoryMock.mockReset();
    readAllCallerIdentityProfilesMock.mockReset();
    readAllCallerIdentityProfilesMock.mockReturnValue([]);
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
        { loginName: "jserrano", displayName: "Jorge Serrano", email: null, callerIdPhone: "+14162304681" },
        { loginName: "dcowell", displayName: "Derek Cowell", email: null, callerIdPhone: "+14165550123" },
        { loginName: "jlee", displayName: "Jacky Lee", email: null, callerIdPhone: "+13653411781" },
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
          category: "Meeting",
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
    expect(snapshot.meetingCategoryAnalytics.meetings.stats.totalMeetings).toBe(1);
    expect(snapshot.meetingCategoryAnalytics.dropOffs.stats.totalMeetings).toBe(0);
    expect(snapshot.teamStats.outboundCalls).toBe(3);
    expect(snapshot.employeeLeaderboard).toHaveLength(0);
    expect(snapshot.activityGaps).toHaveLength(0);
    expect(snapshot.bucketDrilldowns).toHaveLength(2);
    expect(snapshot.bucketDrilldowns[0]?.companies[0]?.label).toBe("Northwind");
    expect(snapshot.bucketDrilldowns[0]?.outcomes[0]?.label).toBe("answered");
  });

  it("shows only sales call reps while retaining zero-call reps", async () => {
    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    const snapshot = snapshotModule.buildDashboardSnapshotForTests(
      baseFilters,
      [
        buildSession({
          sessionId: "real-rep-call",
          employeeLoginName: "jserrano",
          employeeDisplayName: "Jorge Serrano",
          startedAt: "2026-03-08T14:00:00.000Z",
        }),
      ],
      [
        { loginName: "4162304681", displayName: "(416) 230-4681", email: null },
        { loginName: "jserrano", displayName: "Jorge Serrano", email: null, callerIdPhone: "+14162304681" },
        { loginName: "kpareek", displayName: "kpareek", email: null },
        { loginName: "smessih", displayName: "smessih", email: null },
        { loginName: "stita", displayName: "Samuel Tita", email: null },
        { loginName: "bkoczka", displayName: "Brock Koczka", email: null },
        { loginName: "jsettle", displayName: "Justin Settle", email: null },
      ],
    );

    expect(snapshot.employees.map((employee) => employee.loginName)).toEqual([
      "kpareek",
      "smessih",
      "stita",
      "bkoczka",
      "jsettle",
    ]);
    expect(snapshot.employeeLeaderboard.map((employee) => employee.loginName)).toEqual([
      "bkoczka",
      "jsettle",
      "kpareek",
      "stita",
      "smessih",
    ]);
    expect(snapshot.activityGaps.map((employee) => employee.loginName)).toEqual([
      "bkoczka",
      "jsettle",
      "kpareek",
      "stita",
      "smessih",
    ]);
  });

  it("uses familiar rep names instead of raw login names", async () => {
    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    const snapshot = snapshotModule.buildDashboardSnapshotForTests(
      baseFilters,
      [
        buildSession({
          sessionId: "krishna-call",
          employeeLoginName: "kpareek",
          employeeDisplayName: "kpareek",
          startedAt: "2026-03-08T14:00:00.000Z",
        }),
      ],
      [
        { loginName: "smessih", displayName: "smessih", email: null },
        { loginName: "kpareek", displayName: "kpareek", email: null },
        { loginName: "stita", displayName: "stita", email: null },
        { loginName: "bkoczka", displayName: "bkoczka", email: null },
        { loginName: "jsettle", displayName: "jsettle", email: null },
      ],
    );

    expect(snapshot.employees.map((employee) => employee.displayName)).toEqual([
      "Sarah",
      "Krishna",
      "Samuel",
      "Brock",
      "Justin",
    ]);
    expect(snapshot.employeeLeaderboard.find((employee) => employee.loginName === "kpareek")?.displayName).toBe(
      "Krishna",
    );
  });

  it("dedupes duplicate sales roster rows by caller ID", async () => {
    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    const snapshot = snapshotModule.buildDashboardSnapshotForTests(
      baseFilters,
      [],
      [
        {
          loginName: "smesshah",
          displayName: "Smesshah",
          email: null,
          callerIdPhone: "+12895415935",
        },
        {
          loginName: "smessih",
          displayName: "Smessih",
          email: null,
          callerIdPhone: "+12895415935",
          isCallerIdentityProfile: true,
        },
      ],
    );

    expect(snapshot.employeeLeaderboard.map((employee) => employee.loginName)).toEqual(["smessih"]);
  });

  it("treats all non-drop-off meeting categories as meetings booked", async () => {
    const snapshotModule = await import("@/lib/call-analytics/dashboard-snapshot");
    const snapshot = snapshotModule.buildDashboardSnapshotForTests(
      baseFilters,
      [],
      [
        { loginName: "jserrano", displayName: "Jorge Serrano", email: null },
        { loginName: "sdoal", displayName: "Simon Doal", email: null },
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
          category: "Meeting",
          meetingSummary: "Intro meeting",
          attendeeCount: 2,
          attendees: [],
          inviteAuthority: "google",
          calendarInviteStatus: "created",
          occurredAt: "2026-03-08T15:00:00.000Z",
          createdAt: "2026-03-08T15:00:00.000Z",
          updatedAt: "2026-03-08T15:00:00.000Z",
        },
        {
          id: "meeting:event-2",
          eventId: "event-2",
          actorLoginName: "sdoal",
          actorName: "Simon Doal",
          businessAccountRecordId: "record-2",
          businessAccountId: "B2002",
          companyName: "Contoso",
          relatedContactId: 92,
          relatedContactName: "Jordan Buyer",
          category: "Site Visit",
          meetingSummary: "Site visit",
          attendeeCount: 1,
          attendees: [],
          inviteAuthority: "acumatica",
          calendarInviteStatus: "created",
          occurredAt: "2026-03-08T16:00:00.000Z",
          createdAt: "2026-03-08T16:00:00.000Z",
          updatedAt: "2026-03-08T16:00:00.000Z",
        },
        {
          id: "meeting:event-3",
          eventId: "event-3",
          actorLoginName: "sdoal",
          actorName: "Simon Doal",
          businessAccountRecordId: "record-3",
          businessAccountId: "B2003",
          companyName: "Fabrikam",
          relatedContactId: 93,
          relatedContactName: "Morgan Owner",
          category: null,
          meetingSummary: "Planning session",
          attendeeCount: 3,
          attendees: [],
          inviteAuthority: "acumatica",
          calendarInviteStatus: "created",
          occurredAt: "2026-03-08T17:00:00.000Z",
          createdAt: "2026-03-08T17:00:00.000Z",
          updatedAt: "2026-03-08T17:00:00.000Z",
        },
        {
          id: "meeting:event-4",
          eventId: "event-4",
          actorLoginName: "jserrano",
          actorName: "Jorge Serrano",
          businessAccountRecordId: "record-4",
          businessAccountId: "B2004",
          companyName: "Tailspin",
          relatedContactId: 94,
          relatedContactName: "Chris Lead",
          category: "Drop Off",
          meetingSummary: "Material drop off",
          attendeeCount: 1,
          attendees: [],
          inviteAuthority: "acumatica",
          calendarInviteStatus: "created",
          occurredAt: "2026-03-08T18:00:00.000Z",
          createdAt: "2026-03-08T18:00:00.000Z",
          updatedAt: "2026-03-08T18:00:00.000Z",
        },
      ],
    );

    expect(snapshot.meetingStats.totalMeetings).toBe(3);
    expect(snapshot.meetingCategoryAnalytics.meetings.stats.totalMeetings).toBe(3);
    expect(snapshot.meetingCategoryAnalytics.dropOffs.stats.totalMeetings).toBe(1);
    expect(snapshot.meetingCategoryAnalytics.meetings.leaderboard.map((item) => item.loginName)).toEqual([
      "sdoal",
      "jserrano",
    ]);
    expect(snapshot.meetingCategoryAnalytics.meetings.recentMeetings.map((item) => item.category)).toEqual([
      "Meeting",
      "Site Visit",
      null,
    ]);
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
