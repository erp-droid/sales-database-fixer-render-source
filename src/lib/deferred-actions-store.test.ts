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
});
