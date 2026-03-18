import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchEventsMock = vi.fn();
const readCallEmployeeDirectoryMock = vi.fn(() => []);
const readEmployeeDirectorySnapshotMock = vi.fn(() => ({
  items: [],
  source: null,
  updatedAt: null,
}));

vi.mock("@/lib/acumatica", () => ({
  fetchEvents: fetchEventsMock,
  readRecordIdentity: (record: Record<string, unknown>) => {
    const id = record.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  },
  readWrappedScalarString: (record: Record<string, { value?: unknown }>, key: string) => {
    const value = record[key]?.value;
    return typeof value === "string" && value.trim() ? value.trim() : "";
  },
  readWrappedNumber: (record: Record<string, { value?: unknown }>, key: string) => {
    const value = record[key]?.value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  },
  readWrappedString: (record: Record<string, { value?: unknown }>, key: string) => {
    const value = record[key]?.value;
    return typeof value === "string" && value.trim() ? value.trim() : "";
  },
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory: readCallEmployeeDirectoryMock,
}));

vi.mock("@/lib/read-model/employees", () => ({
  readEmployeeDirectorySnapshot: readEmployeeDirectorySnapshotMock,
}));

function setBaseEnv(sqlitePath: string, historyPath: string): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.AUTH_LOGIN_URL = "";
  process.env.AUTH_ME_URL = "";
  process.env.AUTH_LOGOUT_URL = "";
  process.env.AUTH_FORGOT_PASSWORD_URL = "";
  process.env.ACUMATICA_BRANCH = "";
  process.env.ACUMATICA_OPPORTUNITY_ENTITY = "Opportunity";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT = "PRODUCTION";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_SERVICE = "SERVICE";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_GLENDALE = "GLENDALE";
  process.env.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT = "Awaiting Estimate";
  process.env.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT = "MAIN";
  process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS = "0";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID =
    "Do you think we are going to win this job?";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID = "Link to Drive";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID = "Project Type";
  process.env.ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT = "";
  process.env.MAIL_INTERNAL_DOMAIN = "meadowb.com";
  process.env.MAIL_CONNECT_RETURN_PATH = "/mail";
  process.env.READ_MODEL_ENABLED = "true";
  process.env.READ_MODEL_SQLITE_PATH = sqlitePath;
  process.env.DATA_QUALITY_HISTORY_PATH = historyPath;
  process.env.READ_MODEL_STALE_AFTER_MS = "300000";
  process.env.READ_MODEL_SYNC_INTERVAL_MS = "300000";
  process.env.CALL_ANALYTICS_STALE_AFTER_MS = "300000";
  process.env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS = "300000";
}

describe("meeting bookings store", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "meeting-bookings-"));
    setBaseEnv(path.join(tempDir, "read-model.sqlite"), path.join(tempDir, "history.json"));
    fetchEventsMock.mockReset();
    readCallEmployeeDirectoryMock.mockReset();
    readEmployeeDirectorySnapshotMock.mockReset();
    readCallEmployeeDirectoryMock.mockReturnValue([]);
    readEmployeeDirectorySnapshotMock.mockReturnValue({
      items: [],
      source: null,
      updatedAt: null,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("upserts and reads meeting bookings from the local dataset", async () => {
    const { getMeetingBookingById, listMeetingBookings, upsertMeetingBooking } = await import(
      "@/lib/meeting-bookings"
    );

    const saved = upsertMeetingBooking({
      eventId: "EV0001",
      actorLoginName: "jserrano",
      actorName: "Jorge Serrano",
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      relatedContactId: 157497,
      relatedContactName: "Jacky Lee",
      meetingSummary: "Operations sync",
      attendeeCount: 4,
      attendees: [
        {
          contactId: 157497,
          contactName: "Jacky Lee",
          email: "jacky.lee@example.com",
          businessAccountRecordId: "record-1",
          businessAccountId: "BA0001",
          companyName: "Alpha Foods",
        },
        {
          contactId: null,
          contactName: "Guest",
          email: "guest@example.com",
          businessAccountRecordId: null,
          businessAccountId: null,
          companyName: null,
        },
      ],
      inviteAuthority: "google",
      calendarInviteStatus: "created",
      occurredAt: "2026-03-18T12:00:00.000Z",
    });

    expect(saved.id).toBe("meeting:EV0001");
    expect(getMeetingBookingById("meeting:EV0001")).toMatchObject({
      actorLoginName: "jserrano",
      meetingSummary: "Operations sync",
      attendeeCount: 4,
      attendees: [
        expect.objectContaining({ contactId: 157497, email: "jacky.lee@example.com" }),
        expect.objectContaining({ contactId: null, email: "guest@example.com" }),
      ],
    });
    expect(listMeetingBookings()[0]).toMatchObject({
      eventId: "EV0001",
      companyName: "Alpha Foods",
      calendarInviteStatus: "created",
    });
  });

  it("backfills historical meeting bookings from Acumatica events for known employees", async () => {
    readCallEmployeeDirectoryMock.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 1,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        normalizedPhone: "+14162304681",
        callerIdPhone: "+14162304681",
        isActive: true,
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
    ]);
    fetchEventsMock.mockResolvedValue([
      {
        id: "event-1",
        CreatedByID: { value: "jserrano" },
        CreatedDateTime: { value: "2026-03-10T14:00:00.000Z" },
        Summary: { value: "Retro meeting" },
        RelatedEntityType: { value: "PX.Objects.CR.Contact" },
        RelatedEntityDescription: { value: "Jacky Lee" },
        Attendees: [
          {
            ContactID: { value: 91 },
            ContactName: { value: "Jacky Lee" },
            Email: { value: "jacky.lee@example.com" },
          },
          {
            Email: { value: "guest@example.com" },
          },
        ],
      },
      {
        id: "event-2",
        CreatedByID: { value: "external.user" },
        CreatedDateTime: { value: "2026-03-10T15:00:00.000Z" },
        Summary: { value: "External meeting" },
      },
    ]);

    const { listMeetingBookings, syncMeetingBookings } = await import("@/lib/meeting-bookings");

    const result = await syncMeetingBookings("cookie");

    expect(result).toEqual({
      fetchedEvents: 2,
      storedMeetings: 1,
    });
    expect(listMeetingBookings()).toEqual([
      expect.objectContaining({
        eventId: "event-1",
        actorLoginName: "jserrano",
        actorName: "Jorge Serrano",
        relatedContactName: "Jacky Lee",
        meetingSummary: "Retro meeting",
        attendeeCount: 2,
        attendees: [
          expect.objectContaining({ contactId: 91, email: "jacky.lee@example.com" }),
          expect.objectContaining({ contactId: null, email: "guest@example.com" }),
        ],
      }),
    ]);
  });
});
