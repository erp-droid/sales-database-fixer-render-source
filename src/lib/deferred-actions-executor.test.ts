import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteContactMock = vi.fn();
const fetchBusinessAccountByIdMock = vi.fn();
const executeDeferredContactMergeRequestMock = vi.fn();
const normalizeBusinessAccountRowsMock = vi.fn(() => []);
const removeReadModelRowsByContactIdMock = vi.fn();
const replaceReadModelAccountRowsMock = vi.fn();

vi.mock("@/lib/acumatica", () => ({
  deleteContact: deleteContactMock,
  fetchBusinessAccountById: fetchBusinessAccountByIdMock,
}));

vi.mock("@/lib/contact-merge-execution", () => ({
  executeDeferredContactMergeRequest: executeDeferredContactMergeRequestMock,
}));

vi.mock("@/lib/business-accounts", () => ({
  normalizeBusinessAccountRows: normalizeBusinessAccountRowsMock,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  removeReadModelRowsByContactId: removeReadModelRowsByContactIdMock,
  replaceReadModelAccountRows: replaceReadModelAccountRowsMock,
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

describe("deferred actions executor", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "deferred-actions-executor-"));
    vi.resetModules();
    vi.clearAllMocks();
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

  it("retries transient delete failures and succeeds on a later pass", async () => {
    const {
      approveDeferredActions,
      enqueueDeferredContactDeleteAction,
      getStoredDeferredActionById,
    } = await import("@/lib/deferred-actions-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { HttpError } = await import("@/lib/errors");
    const { runDueDeferredActions } = await import("@/lib/deferred-actions-executor");

    const actor = { loginName: "jserrano", name: "Jorge Serrano" };
    const queued = enqueueDeferredContactDeleteAction({
      sourceSurface: "quality",
      businessAccountRecordId: null,
      businessAccountId: null,
      companyName: "Alpha Foods",
      contactId: 157497,
      contactName: "Jorge Serrano",
      contactRowKey: "row-1",
      reason: "Duplicate contact",
      actor,
    });
    approveDeferredActions([queued.id], actor);

    const db = getReadModelDb();
    db.prepare("UPDATE deferred_actions SET execute_after_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      queued.id,
    );

    deleteContactMock
      .mockRejectedValueOnce(new HttpError(503, "Temporary Acumatica outage"))
      .mockResolvedValueOnce(undefined);

    const firstPass = await runDueDeferredActions("cookie", actor, { value: null });
    expect(firstPass).toEqual({
      executedCount: 0,
      failedCount: 0,
    });

    const afterRetry = getStoredDeferredActionById(queued.id);
    expect(afterRetry?.status).toBe("approved");
    expect(afterRetry?.attemptCount).toBe(1);
    expect(afterRetry?.failureMessage).toContain("Retry 2 of 5 scheduled");
    db.prepare("UPDATE deferred_actions SET execute_after_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      queued.id,
    );

    const secondPass = await runDueDeferredActions("cookie", actor, { value: null });
    expect(secondPass).toEqual({
      executedCount: 1,
      failedCount: 0,
    });

    const afterSuccess = getStoredDeferredActionById(queued.id);
    expect(afterSuccess?.status).toBe("executed");
    expect(afterSuccess?.attemptCount).toBe(2);
  });

  it("processes due actions in batches of 50", async () => {
    const {
      approveDeferredActions,
      enqueueDeferredContactDeleteAction,
      listStoredDeferredActionRecords,
    } = await import("@/lib/deferred-actions-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { runDueDeferredActions } = await import("@/lib/deferred-actions-executor");

    const actor = { loginName: "jserrano", name: "Jorge Serrano" };
    const actionIds: string[] = [];

    for (let index = 0; index < 55; index += 1) {
      const queued = enqueueDeferredContactDeleteAction({
        sourceSurface: "quality",
        businessAccountRecordId: null,
        businessAccountId: null,
        companyName: `Company ${index}`,
        contactId: 157497 + index,
        contactName: `Contact ${index}`,
        contactRowKey: `row-${index}`,
        reason: "Bulk cleanup",
        actor,
      });
      actionIds.push(queued.id);
    }

    approveDeferredActions(actionIds, actor);
    const db = getReadModelDb();
    const dueAt = new Date().toISOString();
    db.prepare("UPDATE deferred_actions SET execute_after_at = ? WHERE id = ?").run(
      dueAt,
      actionIds[0],
    );
    for (let index = 1; index < actionIds.length; index += 1) {
      db.prepare("UPDATE deferred_actions SET execute_after_at = ? WHERE id = ?").run(
        dueAt,
        actionIds[index],
      );
    }
    deleteContactMock.mockResolvedValue(undefined);

    const firstPass = await runDueDeferredActions("cookie", actor, { value: null });
    expect(firstPass).toEqual({
      executedCount: 50,
      failedCount: 0,
    });

    const records = listStoredDeferredActionRecords();
    expect(records.filter((record) => record.status === "executed")).toHaveLength(50);
    expect(records.filter((record) => record.status === "approved")).toHaveLength(5);
  });

  it("recovers stale executing actions and retries them", async () => {
    const {
      approveDeferredActions,
      enqueueDeferredContactDeleteAction,
      getStoredDeferredActionById,
      markDeferredActionExecuting,
    } = await import("@/lib/deferred-actions-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { runDueDeferredActions } = await import("@/lib/deferred-actions-executor");

    const actor = { loginName: "jserrano", name: "Jorge Serrano" };
    const queued = enqueueDeferredContactDeleteAction({
      sourceSurface: "quality",
      businessAccountRecordId: null,
      businessAccountId: null,
      companyName: "Alpha Foods",
      contactId: 157497,
      contactName: "Jorge Serrano",
      contactRowKey: "row-1",
      reason: "Duplicate contact",
      actor,
    });
    approveDeferredActions([queued.id], actor);
    expect(markDeferredActionExecuting(queued.id, actor)).toBe(true);

    const db = getReadModelDb();
    db.prepare("UPDATE deferred_actions SET updated_at = ? WHERE id = ?").run(
      "2026-03-01T00:00:00.000Z",
      queued.id,
    );

    deleteContactMock.mockResolvedValue(undefined);

    const result = await runDueDeferredActions("cookie", actor, { value: null });
    expect(result).toEqual({
      executedCount: 1,
      failedCount: 0,
    });

    const record = getStoredDeferredActionById(queued.id);
    expect(record?.status).toBe("executed");
    expect(record?.attemptCount).toBe(2);
  });

  it("treats already-deleted contacts as successful executions", async () => {
    const {
      approveDeferredActions,
      enqueueDeferredContactDeleteAction,
      getStoredDeferredActionById,
    } = await import("@/lib/deferred-actions-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { HttpError } = await import("@/lib/errors");
    const { runDueDeferredActions } = await import("@/lib/deferred-actions-executor");

    const actor = { loginName: "jserrano", name: "Jorge Serrano" };
    const queued = enqueueDeferredContactDeleteAction({
      sourceSurface: "quality",
      businessAccountRecordId: null,
      businessAccountId: null,
      companyName: "Alpha Foods",
      contactId: 157497,
      contactName: "Jorge Serrano",
      contactRowKey: "row-1",
      reason: "Already removed upstream",
      actor,
    });
    approveDeferredActions([queued.id], actor);

    const db = getReadModelDb();
    db.prepare("UPDATE deferred_actions SET execute_after_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      queued.id,
    );

    deleteContactMock.mockRejectedValueOnce(new HttpError(404, "Contact not found"));

    const result = await runDueDeferredActions("cookie", actor, { value: null });
    expect(result).toEqual({
      executedCount: 1,
      failedCount: 0,
    });

    const record = getStoredDeferredActionById(queued.id);
    expect(record?.status).toBe("executed");
    expect(record?.attemptCount).toBe(1);
  });

  it("passes queued merge previews to the deferred merge executor", async () => {
    const {
      approveDeferredActions,
      enqueueDeferredMergeContactsAction,
      getStoredDeferredActionById,
    } = await import("@/lib/deferred-actions-store");
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const { runDueDeferredActions } = await import("@/lib/deferred-actions-executor");

    const actor = { loginName: "jserrano", name: "Jorge Serrano" };
    const queued = enqueueDeferredMergeContactsAction({
      sourceSurface: "merge",
      businessAccountRecordId: "record-1",
      businessAccountId: "BA0001",
      companyName: "Alpha Foods",
      keptContactId: 157497,
      keptContactName: "Jorge Serrano",
      loserContactIds: [157498],
      loserContactNames: ["Jorge Serrano Duplicate"],
      affectedFields: ["Phone 1"],
      actor,
      payloadJson: JSON.stringify({
        businessAccountRecordId: "record-1",
        businessAccountId: "BA0001",
        keepContactId: 157497,
        selectedContactIds: [157497, 157498],
        setKeptAsPrimary: false,
        expectedAccountLastModified: "2026-03-10T12:00:00.000Z",
        expectedContactLastModifieds: [
          { contactId: 157497, lastModified: "2026-03-10T12:00:00.000Z" },
          { contactId: 157498, lastModified: "2026-03-10T12:00:00.000Z" },
        ],
        fieldChoices: [{ field: "displayName", sourceContactId: 157497 }],
      }),
      preview: {
        actionType: "mergeContacts",
        keepContactId: 157497,
        loserContactIds: [157498],
        setKeptAsPrimary: false,
        mergedFields: {
          displayName: "Jorge Serrano",
          phone1: "416-230-4681",
        },
        mergedPrimaryContactName: "Jorge Serrano",
        mergedPrimaryContactJobTitle: "Sales Manager",
        mergedPrimaryContactPhone: "416-230-4681",
        mergedPrimaryContactEmail: "jserrano@meadowb.com",
        mergedNotes: "Merged notes",
      },
    });
    approveDeferredActions([queued.id], actor);

    const db = getReadModelDb();
    db.prepare("UPDATE deferred_actions SET execute_after_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      queued.id,
    );

    executeDeferredContactMergeRequestMock.mockResolvedValueOnce(undefined);

    const result = await runDueDeferredActions("cookie", actor, { value: null });
    expect(result).toEqual({
      executedCount: 1,
      failedCount: 0,
    });
    expect(executeDeferredContactMergeRequestMock).toHaveBeenCalledWith(
      "cookie",
      expect.objectContaining({
        keepContactId: 157497,
        selectedContactIds: [157497, 157498],
      }),
      expect.objectContaining({
        actionType: "mergeContacts",
        keepContactId: 157497,
        loserContactIds: [157498],
        mergedFields: expect.objectContaining({
          displayName: "Jorge Serrano",
        }),
      }),
      { value: null },
    );

    const record = getStoredDeferredActionById(queued.id);
    expect(record?.status).toBe("executed");
  });
});
