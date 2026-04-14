import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureReadModelSchema } from "@/lib/read-model/schema";

const readCallEmployeeDirectory = vi.fn();
const readCallEmployeeDirectoryMeta = vi.fn();
const readAllCallerPhoneOverrides = vi.fn();
const publishAuditLogChanged = vi.fn();
const upsertCallAuditEvent = vi.fn();
const invalidateDashboardSnapshotCache = vi.fn();

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory,
  readCallEmployeeDirectoryMeta,
}));

vi.mock("@/lib/caller-phone-overrides", () => ({
  readAllCallerPhoneOverrides,
}));

vi.mock("@/lib/call-analytics/phone-match", () => ({
  buildPhoneMatchIndex: () => ({}),
  matchPhoneToAccountWithIndex: () => ({
    matchedContactId: null,
    matchedContactName: null,
    matchedBusinessAccountId: null,
    matchedCompanyName: null,
    phoneMatchType: "none",
    phoneMatchAmbiguityCount: 0,
  }),
}));

vi.mock("@/lib/audit-log-live", () => ({
  publishAuditLogChanged,
}));

vi.mock("@/lib/call-analytics/dashboard-cache", () => ({
  invalidateDashboardSnapshotCache,
}));

vi.mock("@/lib/audit-log-store", () => ({
  upsertCallAuditEvent,
}));

describe("rebuildCallSessions", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses caller phone overrides to attribute bridge calls when the employee cache is missing a phone", async () => {
    const db = new Database(":memory:");
    ensureReadModelSchema(db);

    db.prepare(
      `
      INSERT INTO call_legs (
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "CA-root",
      null,
      "CA-root",
      "outbound-api",
      "+16474929859",
      "+14162304681",
      "completed",
      1,
      null,
      "2026-03-09T16:53:18.000Z",
      "2026-03-09T16:53:38.000Z",
      20,
      null,
      null,
      "USD",
      "unknown",
      "root",
      JSON.stringify({
        sid: "CA-root",
        direction: "outbound-api",
        from: "+16474929859",
        to: "+14162304681",
        status: "completed",
        events: [],
      }),
      "2026-03-09T16:53:38.000Z",
    );
    db.prepare(
      `
      INSERT INTO call_legs (
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "CA-child",
      "CA-root",
      "CA-root",
      "outbound-dial",
      "+14162304681",
      "+14163153228",
      "no-answer",
      0,
      null,
      "2026-03-09T16:53:33.000Z",
      "2026-03-09T16:53:38.000Z",
      0,
      null,
      null,
      "USD",
      "unknown",
      "destination",
      JSON.stringify({
        sid: "CA-child",
        parentCallSid: "CA-root",
        direction: "outbound-dial",
        from: "+14162304681",
        to: "+14163153228",
        status: "no-answer",
        events: [],
      }),
      "2026-03-09T16:53:38.000Z",
    );

    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "4162304681",
        contactId: null,
        displayName: "(416) 230-4681",
        email: null,
        normalizedPhone: "+14162304681",
        callerIdPhone: "+14162304681",
        isActive: true,
        updatedAt: "2026-03-18T16:40:27.333Z",
      },
      {
        loginName: "jserrano",
        contactId: 45,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-03-18T16:40:27.333Z",
      },
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: "2026-03-18T16:40:27.333Z",
    });
    readAllCallerPhoneOverrides.mockReturnValue([
      {
        loginName: "jserrano",
        phoneNumber: "+14162304681",
        updatedAt: "2026-03-18T13:55:00.000Z",
      },
    ]);

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => db,
    }));

    const sessionizeModule = await import("@/lib/call-analytics/sessionize");
    const sessions = sessionizeModule.rebuildCallSessions({
      bridgeNumbers: ["+16474929859"],
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(
      expect.objectContaining({
        employeeLoginName: "jserrano",
        employeeDisplayName: "Jorge Serrano",
        employeePhone: "+14162304681",
        targetPhone: "+14163153228",
        answered: false,
        outcome: "no_answer",
      }),
    );
    expect(upsertCallAuditEvent).toHaveBeenCalledTimes(1);
    expect(invalidateDashboardSnapshotCache).toHaveBeenCalledTimes(1);
    expect(publishAuditLogChanged).toHaveBeenCalledWith("call-sessions-rebuilt");
  });

  it("prefers canonical Acumatica caller identity over Twilio-friendly rows for the same phone", async () => {
    const db = new Database(":memory:");
    ensureReadModelSchema(db);

    db.prepare(
      `
      INSERT INTO caller_identity_profiles (
        login_name,
        employee_id,
        contact_id,
        display_name,
        email,
        phone_number,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "kathlynn",
      "E0000999",
      91,
      "Kathlynn Example",
      "kathlynn@meadowb.com",
      "+14162304681",
      "2026-03-19T00:00:00.000Z",
    );
    db.prepare(
      `
      INSERT INTO call_legs (
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "CA-root-2",
      null,
      "CA-root-2",
      "outbound-api",
      "+16474929859",
      "+14162304681",
      "completed",
      1,
      null,
      "2026-03-10T16:53:18.000Z",
      "2026-03-10T16:53:38.000Z",
      20,
      null,
      null,
      "USD",
      "unknown",
      "root",
      JSON.stringify({
        sid: "CA-root-2",
        direction: "outbound-api",
        from: "+16474929859",
        to: "+14162304681",
        status: "completed",
        events: [],
      }),
      "2026-03-10T16:53:38.000Z",
    );
    db.prepare(
      `
      INSERT INTO call_legs (
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "CA-child-2",
      "CA-root-2",
      "CA-root-2",
      "outbound-dial",
      "+14162304681",
      "+14163153228",
      "completed",
      1,
      null,
      "2026-03-10T16:53:33.000Z",
      "2026-03-10T16:53:52.000Z",
      19,
      null,
      null,
      "USD",
      "unknown",
      "destination",
      JSON.stringify({
        sid: "CA-child-2",
        parentCallSid: "CA-root-2",
        direction: "outbound-dial",
        from: "+14162304681",
        to: "+14163153228",
        status: "completed",
        events: [],
      }),
      "2026-03-10T16:53:52.000Z",
    );

    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "kallen",
        contactId: null,
        displayName: "Kallen",
        email: null,
        normalizedPhone: "+14162304681",
        callerIdPhone: "+14162304681",
        isActive: true,
        updatedAt: "2026-03-18T16:40:27.333Z",
      },
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: "2026-03-18T16:40:27.333Z",
    });
    readAllCallerPhoneOverrides.mockReturnValue([]);

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => db,
    }));

    const sessionizeModule = await import("@/lib/call-analytics/sessionize");
    const sessions = sessionizeModule.rebuildCallSessions({
      bridgeNumbers: ["+16474929859"],
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(
      expect.objectContaining({
        employeeLoginName: "kathlynn",
        employeeDisplayName: "Kathlynn Example",
        employeeContactId: 91,
        employeePhone: "+14162304681",
        targetPhone: "+14163153228",
      }),
    );
  });

  it("does not mark provisional root-only bridge calls as answered before the destination leg exists", async () => {
    const db = new Database(":memory:");
    ensureReadModelSchema(db);

    db.prepare(
      `
      INSERT INTO call_legs (
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "CA-root-only",
      null,
      "call-root-only",
      "outbound-api",
      "+16474929859",
      "+14162304681",
      "completed",
      1,
      null,
      "2026-03-10T16:53:18.000Z",
      "2026-03-10T16:53:38.000Z",
      20,
      null,
      null,
      "USD",
      "app_bridge",
      "root",
      JSON.stringify({
        sid: "CA-root-only",
        direction: "outbound-api",
        from: "+16474929859",
        to: "+14162304681",
        status: "completed",
        appContext: {
          sessionId: "call-root-only",
          loginName: "jserrano",
          displayName: "Jorge Serrano",
          userPhone: "+14162304681",
          callerId: "+14162304681",
          bridgeNumber: "+16474929859",
          sourcePage: "accounts",
          linkedBusinessAccountId: "BA-42",
          linkedCompanyName: "Ontario Soccer Association",
          linkedContactId: 158602,
          linkedContactName: "Mike Giona",
        },
        provisional: true,
        targetPhone: "+14163153228",
        events: [],
      }),
      "2026-03-10T16:53:38.000Z",
    );

    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 45,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        normalizedPhone: "+14162304681",
        callerIdPhone: "+14162304681",
        isActive: true,
        updatedAt: "2026-03-18T16:40:27.333Z",
      },
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: "2026-03-18T16:40:27.333Z",
    });
    readAllCallerPhoneOverrides.mockReturnValue([]);

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => db,
    }));

    const sessionizeModule = await import("@/lib/call-analytics/sessionize");
    const sessions = sessionizeModule.rebuildCallSessions({
      bridgeNumbers: ["+16474929859"],
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: "call-root-only",
        employeeLoginName: "jserrano",
        targetPhone: "+14163153228",
        answered: false,
        outcome: "unknown",
        matchedContactName: "Mike Giona",
        matchedCompanyName: "Ontario Soccer Association",
        linkedBusinessAccountId: "BA-42",
        linkedContactId: 158602,
      }),
    );
  });

  it("rebuilds only the affected call session without replacing unrelated sessions", async () => {
    const db = new Database(":memory:");
    ensureReadModelSchema(db);

    const insertLeg = db.prepare(
      `
      INSERT INTO call_legs (
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    insertLeg.run(
      "CA-root-a",
      null,
      "session-a",
      "outbound-api",
      "+16474929859",
      "+14162304681",
      "queued",
      0,
      null,
      "2026-03-10T16:53:18.000Z",
      null,
      null,
      null,
      null,
      "USD",
      "app_bridge",
      "root",
      JSON.stringify({
        sid: "CA-root-a",
        direction: "outbound-api",
        from: "+16474929859",
        to: "+14162304681",
        status: "queued",
        appContext: {
          sessionId: "session-a",
          loginName: "jserrano",
          displayName: "Jorge Serrano",
          userPhone: "+14162304681",
          callerId: "+14162304681",
          bridgeNumber: "+16474929859",
          sourcePage: "accounts",
        },
        events: [],
      }),
      "2026-03-10T16:53:18.000Z",
    );
    insertLeg.run(
      "CA-child-a",
      "CA-root-a",
      "session-a",
      "outbound-dial",
      "+14162304681",
      "+14163153228",
      "ringing",
      0,
      null,
      "2026-03-10T16:53:33.000Z",
      null,
      null,
      null,
      null,
      "USD",
      "app_bridge",
      "destination",
      JSON.stringify({
        sid: "CA-child-a",
        parentCallSid: "CA-root-a",
        direction: "outbound-dial",
        from: "+14162304681",
        to: "+14163153228",
        status: "ringing",
        events: [],
      }),
      "2026-03-10T16:53:33.000Z",
    );
    insertLeg.run(
      "CA-root-b",
      null,
      "session-b",
      "outbound-api",
      "+16474929859",
      "+14162304681",
      "completed",
      1,
      null,
      "2026-03-11T10:00:00.000Z",
      "2026-03-11T10:00:09.000Z",
      9,
      null,
      null,
      "USD",
      "app_bridge",
      "root",
      JSON.stringify({
        sid: "CA-root-b",
        direction: "outbound-api",
        from: "+16474929859",
        to: "+14162304681",
        status: "completed",
        appContext: {
          sessionId: "session-b",
          loginName: "jserrano",
          displayName: "Jorge Serrano",
          userPhone: "+14162304681",
          callerId: "+14162304681",
          bridgeNumber: "+16474929859",
          sourcePage: "accounts",
        },
        events: [],
      }),
      "2026-03-11T10:00:09.000Z",
    );
    insertLeg.run(
      "CA-child-b",
      "CA-root-b",
      "session-b",
      "outbound-dial",
      "+14162304681",
      "+14165550123",
      "completed",
      1,
      "2026-03-11T10:00:04.000Z",
      "2026-03-11T10:00:01.000Z",
      "2026-03-11T10:00:09.000Z",
      5,
      null,
      null,
      "USD",
      "app_bridge",
      "destination",
      JSON.stringify({
        sid: "CA-child-b",
        parentCallSid: "CA-root-b",
        direction: "outbound-dial",
        from: "+14162304681",
        to: "+14165550123",
        status: "completed",
        duration: 5,
        events: [],
      }),
      "2026-03-11T10:00:09.000Z",
    );

    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 45,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        normalizedPhone: "+14162304681",
        callerIdPhone: "+14162304681",
        isActive: true,
        updatedAt: "2026-03-18T16:40:27.333Z",
      },
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: "2026-03-18T16:40:27.333Z",
    });
    readAllCallerPhoneOverrides.mockReturnValue([]);

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => db,
    }));

    const sessionizeModule = await import("@/lib/call-analytics/sessionize");
    sessionizeModule.rebuildCallSessions({
      bridgeNumbers: ["+16474929859"],
    });

    db.prepare(
      `
      UPDATE call_legs
      SET status = ?,
          answered = ?,
          answered_at = ?,
          ended_at = ?,
          duration_seconds = ?,
          updated_at = ?
      WHERE sid = ?
      `,
    ).run(
      "completed",
      1,
      "2026-03-10T16:53:36.000Z",
      "2026-03-10T16:53:44.000Z",
      8,
      "2026-03-10T16:53:44.000Z",
      "CA-child-a",
    );

    const rebuiltSession = sessionizeModule.rebuildCallSession({
      rootCallSid: "CA-root-a",
      sessionId: "session-a",
    });
    const sessions = sessionizeModule.readCallSessions();

    expect(rebuiltSession).toEqual(
      expect.objectContaining({
        sessionId: "session-a",
        rootCallSid: "CA-root-a",
        answered: true,
        outcome: "answered",
        targetPhone: "+14163153228",
        talkDurationSeconds: 8,
      }),
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.find((item) => item.sessionId === "session-b")).toEqual(
      expect.objectContaining({
        rootCallSid: "CA-root-b",
        answered: true,
        outcome: "answered",
        targetPhone: "+14165550123",
      }),
    );
  });
});
