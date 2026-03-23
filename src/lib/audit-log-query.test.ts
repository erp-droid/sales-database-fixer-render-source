import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  process.env.ACUMATICA_OPPORTUNITY_CLASS_ID = "PRODUCTION";
  process.env.ACUMATICA_OPPORTUNITY_STAGE = "Awaiting Estimate";
  process.env.ACUMATICA_OPPORTUNITY_LOCATION = "MAIN";
  process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS = "0";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID = "Do you think we are going to win this job?";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID = "Link to Drive";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID = "Project Type";
  process.env.ACUMATICA_OPPORTUNITY_DEFAULT_LINK_TO_DRIVE = "";
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

function createRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "AR0001",
    accountRecordId: "AR0001",
    rowKey: "row-1",
    contactId: 501,
    isPrimaryContact: true,
    businessAccountId: "BA0001",
    companyName: "Alpha Foods",
    address: "5579 McAdam Road, Mississauga, ON, L4Z 1N4",
    addressLine1: "5579 McAdam Road",
    addressLine2: "Unit 4",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA",
    salesRepId: "109343",
    salesRepName: "Jorge Serrano",
    industryType: "Distribution",
    subCategory: "Pharmaceuticals",
    companyRegion: "Region 1",
    week: "Week 1",
    primaryContactName: "Jorge Serrano",
    primaryContactPhone: "416-230-4681",
    primaryContactEmail: "jserrano@meadowb.com",
    primaryContactId: 501,
    category: "A" as const,
    notes: "VIP",
    lastModifiedIso: "2026-03-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("audit log query", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "audit-log-"));
    vi.resetModules();
    setBaseEnv(path.join(tempDir, "read-model.sqlite"), path.join(tempDir, "history.json"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("stores business account create audit rows with affected fields and links", async () => {
    const { logBusinessAccountCreateAudit, createAuditActor } = await import("@/lib/audit-log-store");
    const { queryAuditLog } = await import("@/lib/audit-log-query");

    logBusinessAccountCreateAudit({
      actor: createAuditActor({ loginName: "jserrano", name: "Jorge Serrano" }),
      request: {
        companyName: "Alpha Foods",
        classId: "LEAD",
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
        companyPhone: null,
        industryType: "Distribution",
        subCategory: "Pharmaceuticals",
        companyRegion: "Region 1",
        week: "Week 1",
        category: "A",
        addressLookupId: "cp-123",
        addressLine1: "5579 McAdam Road",
        addressLine2: "Unit 4",
        city: "Mississauga",
        state: "ON",
        postalCode: "L4Z 1N4",
        country: "CA",
      },
      resultCode: "succeeded",
      businessAccountRecordId: "AR0001",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      createdRow: createRow(),
    });

    const response = queryAuditLog({
      q: "",
      itemType: "all",
      actionGroup: "all",
      result: "all",
      actor: "",
      dateFrom: null,
      dateTo: null,
      businessAccountRecordId: null,
      contactId: null,
      page: 1,
      pageSize: 50,
    });

    expect(response.total).toBe(1);
    expect(response.items[0]).toMatchObject({
      itemType: "business_account",
      actionGroup: "business_account_create",
      resultCode: "succeeded",
      businessAccountRecordId: "AR0001",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      actorLoginName: "jserrano",
    });
    expect(response.items[0].affectedFields.map((field) => field.label)).toEqual(
      expect.arrayContaining(["Company name", "Industry type", "Address line 1"]),
    );
    expect(response.items[0].links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkType: "business_account",
          role: "primary",
          businessAccountRecordId: "AR0001",
        }),
        expect.objectContaining({
          linkType: "contact",
          role: "primary",
          contactId: 501,
        }),
      ]),
    );
  });

  it("stores deferred lifecycle rows and filters by contact", async () => {
    const { upsertDeferredActionAuditEvents } = await import("@/lib/audit-log-store");
    const { queryAuditLog } = await import("@/lib/audit-log-query");

    upsertDeferredActionAuditEvents({
      id: "action-1",
      actionType: "mergeContacts",
      status: "executed",
      businessAccountRecordId: "AR0001",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      contactId: null,
      contactName: null,
      contactRowKey: null,
      keptContactId: 501,
      keptContactName: "Jorge Serrano",
      loserContactIds: [777],
      loserContactNames: ["Duplicate Jorge"],
      affectedFields: ["Display name", "Email"],
      reason: null,
      payloadJson: JSON.stringify({ keepContactId: 501 }),
      preview: {
        actionType: "mergeContacts",
        keepContactId: 501,
        loserContactIds: [777],
        setKeptAsPrimary: true,
        mergedPrimaryContactName: "Jorge Serrano",
        mergedPrimaryContactPhone: null,
        mergedPrimaryContactEmail: "jserrano@meadowb.com",
        mergedNotes: null,
      },
      requestedByLoginName: "jserrano",
      requestedByName: "Jorge Serrano",
      requestedAt: "2026-03-10T12:00:00.000Z",
      executeAfterAt: "2026-03-13T21:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 5,
      lastAttemptAt: "2026-03-13T21:05:00.000Z",
      sourceSurface: "accounts",
      approvedByLoginName: "manager",
      approvedByName: "Manager",
      approvedAt: "2026-03-11T12:00:00.000Z",
      cancelledByLoginName: null,
      cancelledByName: null,
      cancelledAt: null,
      executedByLoginName: "manager",
      executedByName: "Manager",
      executedAt: "2026-03-13T21:10:00.000Z",
      failureMessage: null,
      updatedAt: "2026-03-13T21:10:00.000Z",
    });

    const response = queryAuditLog({
      q: "",
      itemType: "contact",
      actionGroup: "contact_merge",
      result: "executed",
      actor: "",
      dateFrom: null,
      dateTo: null,
      businessAccountRecordId: null,
      contactId: 777,
      page: 1,
      pageSize: 50,
    });

    expect(response.total).toBe(1);
    expect(response.items[0].summary).toContain("Executed merge");
    expect(response.items[0].links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "merged_from",
          contactId: 777,
        }),
        expect.objectContaining({
          role: "merged_into",
          contactId: 501,
        }),
      ]),
    );
  });

  it("bootstraps meeting booking rows into the audit log with company and contact context", async () => {
    const { upsertMeetingBooking } = await import("@/lib/meeting-bookings");
    const { queryAuditLog } = await import("@/lib/audit-log-query");

    upsertMeetingBooking({
      eventId: "EV1001",
      actorLoginName: "sdoal",
      actorName: "Simon Doal",
      businessAccountRecordId: "AR0001",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      relatedContactId: 501,
      relatedContactName: "Jorge Serrano",
      category: "Meeting",
      meetingSummary: "Quarterly review",
      attendeeCount: 2,
      attendees: [
        {
          contactId: 501,
          contactName: "Jorge Serrano",
          email: "jserrano@meadowb.com",
          businessAccountRecordId: "AR0001",
          businessAccountId: "BA0001",
          companyName: "Alpha Foods",
        },
        {
          contactId: null,
          contactName: "Guest attendee",
          email: "guest@example.com",
          businessAccountRecordId: null,
          businessAccountId: null,
          companyName: null,
        },
      ],
      inviteAuthority: "acumatica",
      calendarInviteStatus: "skipped",
      occurredAt: "2026-03-17T17:35:26.247Z",
    });

    const response = queryAuditLog({
      q: "quarterly review",
      itemType: "meeting",
      actionGroup: "meeting_create",
      result: "all",
      actor: "sdoal",
      dateFrom: null,
      dateTo: null,
      businessAccountRecordId: null,
      contactId: null,
      page: 1,
      pageSize: 50,
    });

    expect(response.total).toBe(1);
    expect(response.items[0]).toMatchObject({
      itemType: "meeting",
      actionGroup: "meeting_create",
      actorLoginName: "sdoal",
      actorName: "Simon Doal",
      companyName: "Alpha Foods",
      contactName: "Jorge Serrano",
      summary: 'Booked meeting "Quarterly review" for Alpha Foods',
    });
    expect(response.items[0].links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkType: "business_account",
          role: "primary",
          businessAccountRecordId: "AR0001",
        }),
        expect.objectContaining({
          linkType: "contact",
          role: "primary",
          contactId: 501,
          contactName: "Jorge Serrano",
        }),
        expect.objectContaining({
          linkType: "contact",
          role: "attendee",
          contactName: "Guest attendee",
        }),
      ]),
    );
  });

  it("projects call audit rows and resolves related account filters", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { upsertCallAuditEvent } = await import("@/lib/audit-log-store");
    const { queryAuditLog } = await import("@/lib/audit-log-query");

    const db = getReadModelDb();
    db.prepare(
      `
      INSERT INTO account_rows (
        row_key,
        id,
        account_record_id,
        business_account_id,
        contact_id,
        is_primary_contact,
        company_name,
        address,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        phone_number,
        sales_rep_id,
        sales_rep_name,
        industry_type,
        sub_category,
        company_region,
        week,
        primary_contact_name,
        primary_contact_phone,
        primary_contact_email,
        primary_contact_id,
        category,
        notes,
        last_modified_iso,
        search_text,
        address_key,
        payload_json,
        updated_at
      ) VALUES (
        @row_key,
        @id,
        @account_record_id,
        @business_account_id,
        @contact_id,
        1,
        @company_name,
        @address,
        @address_line1,
        @address_line2,
        @city,
        @state,
        @postal_code,
        @country,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        @primary_contact_name,
        @primary_contact_phone,
        @primary_contact_email,
        @primary_contact_id,
        NULL,
        NULL,
        @last_modified_iso,
        'alpha foods jorge serrano',
        'alpha-foods',
        '{}',
        @updated_at
      )
      `,
    ).run({
      row_key: "row-1",
      id: "AR0001",
      account_record_id: "AR0001",
      business_account_id: "BA0001",
      contact_id: 501,
      company_name: "Alpha Foods",
      address: "5579 McAdam Road, Mississauga, ON, L4Z 1N4",
      address_line1: "5579 McAdam Road",
      address_line2: "Unit 4",
      city: "Mississauga",
      state: "ON",
      postal_code: "L4Z 1N4",
      country: "CA",
      primary_contact_name: "Jorge Serrano",
      primary_contact_phone: "416-230-4681",
      primary_contact_email: "jserrano@meadowb.com",
      primary_contact_id: 501,
      last_modified_iso: "2026-03-10T12:00:00.000Z",
      updated_at: "2026-03-10T12:00:00.000Z",
    });

    upsertCallAuditEvent({
      sessionId: "session-1",
      rootCallSid: "call-1",
      primaryLegSid: "leg-1",
      source: "app_bridge",
      direction: "outbound",
      outcome: "answered",
      answered: true,
      startedAt: "2026-03-10T12:30:00.000Z",
      answeredAt: "2026-03-10T12:31:00.000Z",
      endedAt: "2026-03-10T12:35:00.000Z",
      talkDurationSeconds: 240,
      ringDurationSeconds: 30,
      employeeLoginName: "jserrano",
      employeeDisplayName: "Jorge Serrano",
      employeeContactId: 501,
      employeePhone: "416-230-4681",
      recipientEmployeeLoginName: null,
      recipientEmployeeDisplayName: null,
      presentedCallerId: "416-230-4681",
      bridgeNumber: "437-555-1212",
      targetPhone: "905-555-3333",
      counterpartyPhone: "905-555-3333",
      matchedContactId: 501,
      matchedContactName: "Jorge Serrano",
      matchedBusinessAccountId: "BA0001",
      matchedCompanyName: "Alpha Foods",
      phoneMatchType: "contact_phone",
      phoneMatchAmbiguityCount: 0,
      initiatedFromSurface: "accounts",
      linkedAccountRowKey: "row-1",
      linkedBusinessAccountId: "BA0001",
      linkedContactId: 501,
      metadataJson: "{}",
      updatedAt: "2026-03-10T12:35:00.000Z",
    });

    const response = queryAuditLog({
      q: "",
      itemType: "call",
      actionGroup: "call",
      result: "answered",
      actor: "jserrano",
      dateFrom: null,
      dateTo: null,
      businessAccountRecordId: "AR0001",
      contactId: 501,
      page: 1,
      pageSize: 50,
    });

    expect(response.total).toBe(1);
    expect(response.items[0]).toMatchObject({
      callSessionId: "session-1",
      resultCode: "answered",
      businessAccountRecordId: "AR0001",
      contactId: 501,
      phoneNumber: "905-555-3333",
    });
  });
});
