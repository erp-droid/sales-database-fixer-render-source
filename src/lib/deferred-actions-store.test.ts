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
  process.env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT = "PRODUCTION";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_SERVICE = "SERVICE";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_GLENDALE = "GLENDALE";
  process.env.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT = "Awaiting Estimate";
  process.env.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT = "MAIN";
  process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS = "0";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID = "Do you think we are going to win this job?";
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

describe("deferred actions store", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "deferred-actions-"));
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

  it("persists reason on queued deletes and returns it in summaries", async () => {
    const { enqueueDeferredContactDeleteAction, listDeferredActionSummaries } = await import(
      "@/lib/deferred-actions-store"
    );
    const { replaceAllAccountRows } = await import("@/lib/read-model/accounts");

    replaceAllAccountRows([
      {
        id: "record-1",
        accountRecordId: "record-1",
        rowKey: "record-1:contact:157497",
        contactId: 157497,
        isPrimaryContact: true,
        companyPhone: "905-555-0100",
        companyPhoneSource: "account",
        phoneNumber: "416-230-4681",
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
        accountType: "Customer",
        opportunityCount: 3,
        industryType: null,
        subCategory: null,
        companyRegion: null,
        week: null,
        businessAccountId: "BA0001",
        companyName: "Alpha Foods",
        companyDescription: null,
        address: "1 Main St, Toronto, ON, CA",
        addressLine1: "1 Main St",
        addressLine2: "",
        city: "Toronto",
        state: "ON",
        postalCode: "M1M 1M1",
        country: "CA",
        primaryContactName: "Jorge Serrano",
        primaryContactJobTitle: null,
        primaryContactPhone: "416-230-4681",
        primaryContactExtension: null,
        primaryContactRawPhone: "416-230-4681",
        primaryContactEmail: "jorge@example.com",
        primaryContactId: 157497,
        category: "A",
        notes: null,
        lastModifiedIso: "2026-04-01T10:00:00.000Z",
      },
    ]);

    const queued = enqueueDeferredContactDeleteAction({
      sourceSurface: "accounts",
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      contactId: 157497,
      contactName: "Jorge Serrano",
      contactRowKey: "row-1",
      reason: "Duplicate contact",
      actor: {
        loginName: "jserrano",
        name: "Jorge Serrano",
      },
    });

    const items = listDeferredActionSummaries();
    expect(queued.id).toBeTruthy();
    expect(items[0]).toMatchObject({
      actionType: "deleteContact",
      accountType: "Customer",
      opportunityCount: 3,
      acumaticaBusinessAccountUrl:
        "https://example.acumatica.com/Main?ScreenId=CR303000&CompanyID=MeadowBrook+Live&AcctCD=BA0001",
      contactId: 157497,
      reason: "Duplicate contact",
    });
  });

  it("reads legacy delete rows without reasons", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { listStoredDeferredActionRecords } = await import("@/lib/deferred-actions-store");

    const db = getReadModelDb();
    db.prepare(
      `
      INSERT INTO deferred_actions (
        id,
        action_type,
        status,
        source_surface,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name,
        contact_row_key,
        kept_contact_id,
        kept_contact_name,
        loser_contact_ids_json,
        loser_contact_names_json,
        affected_fields_json,
        reason,
        payload_json,
        preview_json,
        requested_by_login_name,
        requested_by_name,
        requested_at,
        execute_after_at,
        updated_at
      ) VALUES (?, 'deleteContact', 'pending_review', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', '[]', ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "legacy-action",
      "accounts",
      "record-1",
      "BA0001",
      "Alpha Foods",
      157497,
      "Jorge Serrano",
      "row-1",
      JSON.stringify(["Contact record"]),
      JSON.stringify({ contactId: 157497 }),
      JSON.stringify({
        actionType: "deleteContact",
        contactId: 157497,
        rowKey: "row-1",
      }),
      "jserrano",
      "Jorge Serrano",
      "2026-03-10T12:00:00.000Z",
      "2026-03-13T21:00:00.000Z",
      "2026-03-10T12:00:00.000Z",
    );

    const items = listStoredDeferredActionRecords();
    expect(items.find((item) => item.id === "legacy-action")?.reason).toBeNull();
  });

  it("dedupes active merge actions for the same keep and loser contacts", async () => {
    const {
      enqueueDeferredMergeContactsAction,
      listStoredDeferredActionRecords,
    } = await import("@/lib/deferred-actions-store");

    const input = {
      sourceSurface: "merge",
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      keptContactId: 157497,
      keptContactName: "Jorge Serrano",
      loserContactIds: [157499, 157498],
      loserContactNames: ["Duplicate A", "Duplicate B"],
      affectedFields: ["Phone 1", "Email"],
      actor: {
        loginName: "jserrano",
        name: "Jorge Serrano",
      },
      payloadJson: JSON.stringify({
        businessAccountRecordId: "record-1",
        businessAccountId: "BA0001",
        keepContactId: 157497,
        selectedContactIds: [157497, 157498, 157499],
        setKeptAsPrimary: false,
        expectedAccountLastModified: "2026-03-12T12:00:00.000Z",
        expectedContactLastModifieds: [
          { contactId: 157497, lastModified: "2026-03-12T12:00:00.000Z" },
          { contactId: 157498, lastModified: "2026-03-12T12:00:00.000Z" },
          { contactId: 157499, lastModified: "2026-03-12T12:00:00.000Z" },
        ],
        fieldChoices: [{ field: "displayName", sourceContactId: 157497 }],
      }),
      preview: {
        actionType: "mergeContacts" as const,
        keepContactId: 157497,
        loserContactIds: [157499, 157498],
        setKeptAsPrimary: false,
        mergedFields: {
          displayName: "Jorge Serrano",
          phone1: "416-230-4681",
          email: "jserrano@meadowb.com",
        },
        mergedPrimaryContactName: "Jorge Serrano",
        mergedPrimaryContactJobTitle: "Sales Manager",
        mergedPrimaryContactPhone: "416-230-4681",
        mergedPrimaryContactEmail: "jserrano@meadowb.com",
        mergedNotes: "Merged notes",
      },
    };

    const first = enqueueDeferredMergeContactsAction(input);
    const second = enqueueDeferredMergeContactsAction({
      ...input,
      loserContactIds: [157498, 157499],
      preview: {
        ...input.preview,
        loserContactIds: [157498, 157499],
      },
    });

    expect(second).toEqual(first);
    expect(
      listStoredDeferredActionRecords().filter((record) => record.actionType === "mergeContacts"),
    ).toHaveLength(1);
  });

  it("queues and projects business account deletions", async () => {
    const {
      applyDeferredActionsToRows,
      enqueueDeferredBusinessAccountDeleteAction,
      listDeferredActionSummaries,
    } = await import("@/lib/deferred-actions-store");
    const { replaceAllAccountRows } = await import("@/lib/read-model/accounts");

    replaceAllAccountRows([
      {
        id: "record-1",
        accountRecordId: "record-1",
        rowKey: "record-1:primary",
        contactId: null,
        isPrimaryContact: false,
        companyPhone: "905-555-0100",
        companyPhoneSource: "account",
        phoneNumber: "905-555-0100",
        salesRepId: "109343",
        salesRepName: "Jorge Serrano",
        accountType: "Lead",
        opportunityCount: 0,
        industryType: null,
        subCategory: null,
        companyRegion: null,
        week: null,
        businessAccountId: "BA0001",
        companyName: "Alpha Foods",
        companyDescription: null,
        address: "1 Main St, Toronto, ON, CA",
        addressLine1: "1 Main St",
        addressLine2: "",
        city: "Toronto",
        state: "ON",
        postalCode: "M1M 1M1",
        country: "CA",
        primaryContactName: null,
        primaryContactJobTitle: null,
        primaryContactPhone: null,
        primaryContactExtension: null,
        primaryContactRawPhone: null,
        primaryContactEmail: null,
        primaryContactId: null,
        category: "A",
        notes: null,
        lastModifiedIso: "2026-04-01T10:00:00.000Z",
      },
    ]);

    enqueueDeferredBusinessAccountDeleteAction({
      sourceSurface: "accounts",
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      reason: "Account no longer needed",
      actor: {
        loginName: "jserrano",
        name: "Jorge Serrano",
      },
    });

    const summaries = listDeferredActionSummaries();
    expect(summaries[0]).toMatchObject({
      actionType: "deleteBusinessAccount",
      companyName: "Alpha Foods",
      accountType: "Lead",
      opportunityCount: 0,
      reason: "Account no longer needed",
    });

    const projectedRows = applyDeferredActionsToRows([
      {
        id: "record-1",
        accountRecordId: "record-1",
        rowKey: "record-1:primary",
        contactId: null,
        isPrimaryContact: false,
        phoneNumber: null,
        salesRepId: null,
        salesRepName: null,
        industryType: null,
        subCategory: null,
        companyRegion: null,
        week: null,
        businessAccountId: "BA0001",
        companyName: "Alpha Foods",
        address: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactEmail: null,
        primaryContactId: null,
        category: null,
        notes: null,
        lastModifiedIso: null,
      },
    ]);

    expect(projectedRows).toEqual([]);
  });

  it("globally hides queued loser contacts even if sync rows come back under a fallback account key", async () => {
    const {
      applyDeferredActionsToRows,
      enqueueDeferredMergeContactsAction,
    } = await import("@/lib/deferred-actions-store");

    enqueueDeferredMergeContactsAction({
      sourceSurface: "merge",
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      keptContactId: 157497,
      keptContactName: "Kept Contact",
      loserContactIds: [157498],
      loserContactNames: ["Duplicate Contact"],
      affectedFields: ["Phone 1"],
      actor: {
        loginName: "jserrano",
        name: "Jorge Serrano",
      },
      payloadJson: JSON.stringify({
        businessAccountRecordId: "record-1",
        businessAccountId: "BA0001",
        keepContactId: 157497,
        selectedContactIds: [157497, 157498],
        setKeptAsPrimary: false,
      }),
      preview: {
        actionType: "mergeContacts",
        keepContactId: 157497,
        loserContactIds: [157498],
        setKeptAsPrimary: false,
        mergedFields: {
          displayName: "Kept Contact",
        },
        mergedPrimaryContactName: "Kept Contact",
        mergedPrimaryContactJobTitle: null,
        mergedPrimaryContactPhone: null,
        mergedPrimaryContactEmail: null,
        mergedNotes: null,
      },
    });

    const projectedRows = applyDeferredActionsToRows([
      {
        id: "fallback-contact",
        accountRecordId: "fallback-contact",
        rowKey: "fallback-contact:contact:157498",
        contactId: 157498,
        isPrimaryContact: false,
        phoneNumber: null,
        salesRepId: null,
        salesRepName: null,
        industryType: null,
        subCategory: null,
        companyRegion: null,
        week: null,
        businessAccountId: "",
        companyName: "",
        address: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
        primaryContactName: "Duplicate Contact",
        primaryContactPhone: null,
        primaryContactEmail: "duplicate@example.com",
        primaryContactId: 157498,
        category: null,
        notes: null,
        lastModifiedIso: null,
      },
    ]);

    expect(projectedRows).toEqual([]);
  });
});
