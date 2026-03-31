import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteContactMock = vi.fn();
const fetchContactByIdMock = vi.fn();
const updateBusinessAccountMock = vi.fn();
const updateContactMock = vi.fn();
const replaceReadModelAccountRowsMock = vi.fn();
const buildAccountRowsFromRawAccountMock = vi.fn();
const buildDeletedContactRowKeysMock = vi.fn(() => []);
const fetchContactMergeServerContextMock = vi.fn();
const fetchSelectedContactsForMergeMock = vi.fn();
const setBusinessAccountPrimaryContactMock = vi.fn();
const validateContactMergeScopeMock = vi.fn(() => ({
  warnings: [],
  keepIsPrimary: false,
  primaryContactId: null,
}));
const buildPrimaryContactFallbackPayloadsMock = vi.fn(() => [{}]);

vi.mock("@/lib/acumatica", () => ({
  deleteContact: deleteContactMock,
  fetchContactById: fetchContactByIdMock,
  readWrappedNumber: (record: unknown, key: string) => {
    if (!record || typeof record !== "object") {
      return null;
    }
    const field = (record as Record<string, unknown>)[key];
    if (!field || typeof field !== "object") {
      return null;
    }
    const numeric = Number((field as Record<string, unknown>).value);
    return Number.isFinite(numeric) ? numeric : null;
  },
  readWrappedString: (record: unknown, key: string) => {
    if (!record || typeof record !== "object") {
      return "";
    }
    const field = (record as Record<string, unknown>)[key];
    if (!field || typeof field !== "object") {
      return "";
    }
    const value = (field as Record<string, unknown>).value;
    return typeof value === "string" ? value.trim() : "";
  },
  updateBusinessAccount: updateBusinessAccountMock,
  updateContact: updateContactMock,
}));

vi.mock("@/lib/business-accounts", () => ({
  buildPrimaryContactFallbackPayloads: buildPrimaryContactFallbackPayloadsMock,
}));

vi.mock("@/lib/contact-merge-server", () => ({
  buildAccountRowsFromRawAccount: buildAccountRowsFromRawAccountMock,
  buildDeletedContactRowKeys: buildDeletedContactRowKeysMock,
  fetchContactMergeServerContext: fetchContactMergeServerContextMock,
  fetchSelectedContactsForMerge: fetchSelectedContactsForMergeMock,
  setBusinessAccountPrimaryContact: setBusinessAccountPrimaryContactMock,
  validateContactMergeScope: validateContactMergeScopeMock,
}));

vi.mock("@/lib/read-model/accounts", () => ({
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

function field(value: string | number | null) {
  return { value };
}

describe("contact merge execution", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "contact-merge-execution-"));
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

  it("treats already-missing loser contacts as a successful deferred merge", async () => {
    const { executeDeferredContactMergeRequest } = await import("@/lib/contact-merge-execution");
    const { HttpError } = await import("@/lib/errors");

    const keepContact = {
      id: "contact-1",
      ContactID: field(157497),
      BusinessAccountID: field("BA0001"),
      DisplayName: field("Jorge Serrano"),
      Phone1: field("416-000-0000"),
      Email: field("old@meadowb.com"),
      LastModifiedDateTime: field("2026-03-12T12:00:00.000Z"),
    };
    const rawAccount = {
      id: "record-1",
      BusinessAccountID: field("BA0001"),
      Name: field("Alpha Foods"),
      LastModifiedDateTime: field("2026-03-12T12:00:00.000Z"),
      Contacts: [keepContact],
    };

    fetchContactMergeServerContextMock
      .mockResolvedValueOnce({
        rawAccount,
        rawAccountWithContacts: rawAccount,
        resolvedRecordId: "record-1",
        updateIdentifiers: ["record-1"],
        identityPayload: {},
      })
      .mockResolvedValueOnce({
        rawAccount,
        rawAccountWithContacts: rawAccount,
        resolvedRecordId: "record-1",
        updateIdentifiers: ["record-1"],
        identityPayload: {},
      });
    fetchContactByIdMock.mockRejectedValueOnce(
      new HttpError(500, "No entity satisfies the condition."),
    );
    buildAccountRowsFromRawAccountMock.mockReturnValue([
      {
        rowKey: "record-1:contact:157497",
        id: "record-1",
        accountRecordId: "record-1",
        businessAccountId: "BA0001",
        companyName: "Alpha Foods",
        contactId: 157497,
        primaryContactId: 157497,
        isPrimaryContact: true,
        primaryContactName: "Jorge Serrano",
        primaryContactJobTitle: "Sales Manager",
        primaryContactPhone: "416-230-4681",
        primaryContactEmail: "jserrano@meadowb.com",
        notes: "Merged notes",
      },
    ]);

    const result = await executeDeferredContactMergeRequest(
      "cookie",
      {
        businessAccountRecordId: "record-1",
        businessAccountId: "BA0001",
        keepContactId: 157497,
        selectedContactIds: [157497, 157498],
        setKeptAsPrimary: false,
        expectedAccountLastModified: "2026-03-12T12:00:00.000Z",
        expectedContactLastModifieds: [
          { contactId: 157497, lastModified: "2026-03-12T12:00:00.000Z" },
          { contactId: 157498, lastModified: "2026-03-12T12:00:00.000Z" },
        ],
        fieldChoices: [{ field: "displayName", sourceContactId: 157497 }],
      },
      {
        actionType: "mergeContacts",
        keepContactId: 157497,
        loserContactIds: [157498],
        setKeptAsPrimary: false,
        mergedFields: {
          displayName: "Jorge Serrano",
          jobTitle: "Sales Manager",
          email: "jserrano@meadowb.com",
          phone1: "416-230-4681",
          notes: "Merged notes",
        },
        mergedPrimaryContactName: "Jorge Serrano",
        mergedPrimaryContactJobTitle: "Sales Manager",
        mergedPrimaryContactPhone: "416-230-4681",
        mergedPrimaryContactEmail: "jserrano@meadowb.com",
        mergedNotes: "Merged notes",
      },
      { value: null },
    );

    expect(updateContactMock).toHaveBeenCalledWith(
      "cookie",
      157497,
      expect.objectContaining({
        DisplayName: { value: "Jorge Serrano" },
        JobTitle: { value: "Sales Manager" },
        Email: { value: "jserrano@meadowb.com" },
        Phone1: { value: "416-230-4681" },
        note: { value: "Merged notes" },
      }),
      { value: null },
    );
    expect(deleteContactMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      merged: true,
      keptContactId: 157497,
      deletedContactIds: [157498],
    });
    expect(replaceReadModelAccountRowsMock).toHaveBeenCalledWith(
      "record-1",
      expect.any(Array),
    );
  });

  it("uses body-first business-account updates when the kept contact becomes primary", async () => {
    const { executeContactMergeRequest } = await import("@/lib/contact-merge-execution");

    const keepContact = {
      id: "contact-1",
      ContactID: field(157497),
      BusinessAccountID: field("BA0001"),
      BusinessAccount: field("BA0001"),
      DisplayName: field("Jorge Serrano"),
      Phone1: field("416-000-0000"),
      Email: field("keep@meadowb.com"),
      LastModifiedDateTime: field("2026-03-12T12:00:00.000Z"),
    };
    const loserContact = {
      id: "contact-2",
      ContactID: field(157498),
      BusinessAccountID: field("BA0001"),
      BusinessAccount: field("BA0001"),
      DisplayName: field("Jordan Smith"),
      Phone1: field("416-000-0001"),
      Email: field("lose@meadowb.com"),
      LastModifiedDateTime: field("2026-03-12T12:00:00.000Z"),
    };
    const rawAccount = {
      id: "record-1",
      BusinessAccountID: field("BA0001"),
      Name: field("Alpha Foods"),
      LastModifiedDateTime: field("2026-03-12T12:00:00.000Z"),
      Contacts: [keepContact, loserContact],
      PrimaryContact: {
        ContactID: field(157498),
      },
    };

    fetchContactMergeServerContextMock
      .mockResolvedValueOnce({
        rawAccount,
        rawAccountWithContacts: rawAccount,
        resolvedRecordId: "record-1",
        updateIdentifiers: ["BA0001", "record-1"],
        identityPayload: {
          id: "record-1",
          BusinessAccountID: { value: "BA0001" },
        },
      })
      .mockResolvedValueOnce({
        rawAccount,
        rawAccountWithContacts: rawAccount,
        resolvedRecordId: "record-1",
        updateIdentifiers: ["BA0001", "record-1"],
        identityPayload: {
          id: "record-1",
          BusinessAccountID: { value: "BA0001" },
        },
      });
    fetchSelectedContactsForMergeMock.mockResolvedValue([keepContact, loserContact]);
    validateContactMergeScopeMock.mockReturnValue({
      warnings: [],
      keepIsPrimary: false,
      primaryContactId: 157498,
    });
    buildPrimaryContactFallbackPayloadsMock.mockReturnValue([
      {
        PrimaryContactID: { value: 157497 },
      },
    ]);
    buildAccountRowsFromRawAccountMock.mockReturnValue([
      {
        rowKey: "record-1:contact:157497",
        id: "record-1",
        accountRecordId: "record-1",
        businessAccountId: "BA0001",
        companyName: "Alpha Foods",
        contactId: 157497,
        primaryContactId: 157497,
        isPrimaryContact: true,
        primaryContactName: "Jorge Serrano",
        primaryContactJobTitle: "Sales Manager",
        primaryContactPhone: "416-230-4681",
        primaryContactEmail: "keep@meadowb.com",
        notes: "Merged notes",
      },
    ]);
    updateContactMock.mockResolvedValue(undefined);
    updateBusinessAccountMock.mockResolvedValue(undefined);
    setBusinessAccountPrimaryContactMock.mockResolvedValue(rawAccount);
    deleteContactMock.mockResolvedValue(undefined);

    const result = await executeContactMergeRequest(
      "cookie",
      {
        businessAccountRecordId: "record-1",
        businessAccountId: "BA0001",
        keepContactId: 157497,
        selectedContactIds: [157497, 157498],
        setKeptAsPrimary: true,
        expectedAccountLastModified: "2026-03-12T12:00:00.000Z",
        expectedContactLastModifieds: [
          { contactId: 157497, lastModified: "2026-03-12T12:00:00.000Z" },
          { contactId: 157498, lastModified: "2026-03-12T12:00:00.000Z" },
        ],
        fieldChoices: [{ field: "displayName", sourceContactId: 157497 }],
      },
      { value: null },
    );

    expect(updateBusinessAccountMock).toHaveBeenCalledWith(
      "cookie",
      ["BA0001", "record-1"],
      expect.objectContaining({
        id: "record-1",
        BusinessAccountID: { value: "BA0001" },
        PrimaryContactID: { value: 157497 },
      }),
      { value: null },
      {
        strategy: "body-first",
      },
    );
    expect(setBusinessAccountPrimaryContactMock).toHaveBeenCalledWith(
      "cookie",
      expect.objectContaining({
        resolvedRecordId: "record-1",
      }),
      157497,
      { value: null },
      keepContact,
    );
    expect(result).toMatchObject({
      merged: true,
      keptContactId: 157497,
      deletedContactIds: [157498],
    });
  });
});
