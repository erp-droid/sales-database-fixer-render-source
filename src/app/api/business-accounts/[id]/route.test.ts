import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BusinessAccountConcurrencySnapshot,
  BusinessAccountRow,
} from "@/types/business-account";
import { collectUpdatedConcurrencyFields } from "@/lib/business-account-concurrency";
import { parseUpdatePayload } from "@/lib/validation";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const resolveDeferredActionActor = vi.fn(async () => ({
  loginName: "jserrano",
  name: "Jorge Serrano",
}));
const enqueueDeferredBusinessAccountDeleteAction = vi.fn(() => ({
  id: "delete-account-1",
  executeAfterAt: "2026-04-16T01:00:00.000Z",
}));
const getEnv = vi.fn(() => ({
  READ_MODEL_ENABLED: true,
}));
const fetchBusinessAccountById = vi.fn();
const fetchContactById = vi.fn();
const updateBusinessAccount = vi.fn();
const updateContact = vi.fn();
const setBusinessAccountPrimaryContact = vi.fn();
const readBusinessAccountDetailFromReadModel = vi.fn();
const readStoredBusinessAccountRowsFromReadModel = vi.fn();
const replaceReadModelAccountRows = vi.fn();
const applyLastCalledAtToBusinessAccountRows = vi.fn((rows) => rows);
const saveAccountCompanyDescription = vi.fn();
const maybeTriggerReadModelSync = vi.fn();
const readSyncStatus = vi.fn(() => ({
  status: "idle",
  phase: "idle",
  startedAt: null,
  completedAt: null,
  lastSuccessfulSyncAt: "2026-04-01T10:00:00.000Z",
  lastError: null,
  rowsCount: 1,
  accountsCount: 1,
  contactsCount: 1,
}));
const waitForReadModelSync = vi.fn();
const publishBusinessAccountChanged = vi.fn();
const shouldValidateWithAddressComplete = vi.fn(() => false);
const validateCanadianAddress = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/deferred-action-actor", () => ({
  resolveDeferredActionActor,
}));

vi.mock("@/lib/deferred-actions-store", () => ({
  enqueueDeferredBusinessAccountDeleteAction,
}));

vi.mock("@/lib/env", () => ({
  getEnv,
}));

vi.mock("@/lib/acumatica", () => ({
  fetchBusinessAccountById,
  fetchContactById,
  updateBusinessAccount,
  updateContact,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  readBusinessAccountDetailFromReadModel,
  readStoredBusinessAccountRowsFromReadModel,
  replaceReadModelAccountRows,
}));

vi.mock("@/lib/business-account-call-history", () => ({
  applyLastCalledAtToBusinessAccountRows,
}));

vi.mock("@/lib/read-model/account-local-metadata", () => ({
  applyLocalAccountMetadataToRow: vi.fn((row) => row),
  applyLocalAccountMetadataToRows: vi.fn((rows) => rows),
  saveAccountCompanyDescription,
}));

vi.mock("@/lib/read-model/sync", () => ({
  maybeTriggerReadModelSync,
  readSyncStatus,
  waitForReadModelSync,
}));

vi.mock("@/lib/business-account-live", () => ({
  publishBusinessAccountChanged,
}));

vi.mock("@/lib/contact-merge-server", () => ({
  setBusinessAccountPrimaryContact,
}));

vi.mock("@/lib/address-complete", () => ({
  shouldValidateWithAddressComplete,
  validateCanadianAddress,
}));

function buildRow(overrides?: Partial<BusinessAccountRow>): BusinessAccountRow {
  return {
    id: "record-1",
    accountRecordId: "record-1",
    rowKey: "record-1:contact:157252",
    contactId: 157252,
    isPrimaryContact: true,
    marketingEligible: true,
    companyPhone: null,
    companyPhoneSource: null,
    phoneNumber: null,
    salesRepId: "109343",
    salesRepName: "Jorge Serrano",
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: "B200000003",
    companyName: "Alpha Inc",
    companyDescription: null,
    address: "5579 McAdam Road, Mississauga, ON L4Z 1N4, CA",
    addressLine1: "5579 McAdam Road",
    addressLine2: "",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA",
    primaryContactName: "Jorge Serrano",
    primaryContactJobTitle: "Sales",
    primaryContactPhone: "416-230-4681",
    primaryContactExtension: null,
    primaryContactRawPhone: "416-230-4681",
    primaryContactEmail: "jorge@example.com",
    primaryContactId: 157252,
    category: "A",
    notes: null,
    lastEmailedAt: null,
    lastModifiedIso: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
}

function buildNoopPutPayload(row: BusinessAccountRow): Record<string, unknown> {
  return {
    companyName: row.companyName,
    companyDescription: row.companyDescription,
    marketingEligible: row.marketingEligible ?? true,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName,
    companyPhone: row.companyPhone ?? row.phoneNumber ?? null,
    primaryContactName: row.primaryContactName,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone: row.primaryContactPhone,
    primaryContactExtension: row.primaryContactExtension ?? null,
    primaryContactEmail: row.primaryContactEmail,
    category: row.category,
    notes: row.notes,
    expectedLastModified: row.lastModifiedIso,
  };
}

function buildConcurrencySnapshot(row: BusinessAccountRow): BusinessAccountConcurrencySnapshot {
  return {
    companyName: row.companyName,
    companyDescription: row.companyDescription ?? null,
    marketingEligible: row.marketingEligible ?? true,
    assignedBusinessAccountRecordId:
      row.businessAccountId.trim().length > 0 ? (row.accountRecordId ?? row.id) : null,
    assignedBusinessAccountId: row.businessAccountId.trim() || null,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    targetContactId: row.contactId ?? row.primaryContactId ?? null,
    salesRepId: row.salesRepId,
    salesRepName: row.salesRepName,
    industryType: row.industryType,
    subCategory: row.subCategory,
    companyRegion: row.companyRegion,
    week: row.week,
    companyPhone: row.companyPhone ?? row.phoneNumber ?? null,
    primaryContactName: row.primaryContactName,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone: row.primaryContactPhone,
    primaryContactExtension: row.primaryContactExtension ?? null,
    primaryContactEmail: row.primaryContactEmail,
    category: row.category,
    notes: row.notes,
    primaryContactId: row.primaryContactId,
    lastModifiedIso: row.lastModifiedIso,
  };
}

function buildRawContact(
  row: BusinessAccountRow,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ContactID: { value: row.contactId ?? row.primaryContactId ?? 157252 },
    NoteID: { value: "contact-note-1" },
    BusinessAccountID: { value: row.businessAccountId },
    CompanyName: { value: row.companyName },
    DisplayName: { value: row.primaryContactName ?? "" },
    JobTitle: { value: row.primaryContactJobTitle ?? "" },
    Phone1: { value: row.primaryContactPhone ?? "" },
    Extension: { value: row.primaryContactExtension ?? "" },
    Email: { value: row.primaryContactEmail ?? "" },
    note: { value: row.notes ?? "" },
    LastModifiedDateTime: { value: row.lastModifiedIso ?? "2026-04-01T10:00:00.000Z" },
    ...overrides,
  };
}

describe("GET /api/business-accounts/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    applyLastCalledAtToBusinessAccountRows.mockReset();
    applyLastCalledAtToBusinessAccountRows.mockImplementation((rows) => rows);
    requireAuthCookieValue.mockReset();
    requireAuthCookieValue.mockReturnValue("cookie");
    setAuthCookie.mockReset();
    getEnv.mockReset();
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: true,
    });
    readBusinessAccountDetailFromReadModel.mockReset();
    readStoredBusinessAccountRowsFromReadModel.mockReset();
    replaceReadModelAccountRows.mockReset();
    resolveDeferredActionActor.mockReset();
    resolveDeferredActionActor.mockResolvedValue({
      loginName: "jserrano",
      name: "Jorge Serrano",
    });
    enqueueDeferredBusinessAccountDeleteAction.mockReset();
    enqueueDeferredBusinessAccountDeleteAction.mockReturnValue({
      id: "delete-account-1",
      executeAfterAt: "2026-04-16T01:00:00.000Z",
    });
    maybeTriggerReadModelSync.mockReset();
    readSyncStatus.mockReset();
    readSyncStatus.mockReturnValue({
      status: "idle",
      phase: "idle",
      startedAt: null,
      completedAt: null,
      lastSuccessfulSyncAt: "2026-04-01T10:00:00.000Z",
      lastError: null,
      rowsCount: 1,
      accountsCount: 1,
      contactsCount: 1,
    });
    waitForReadModelSync.mockReset();
  });

  it("returns 404 for rows where Travis Rumney is the contact even when cached", async () => {
    readBusinessAccountDetailFromReadModel.mockReturnValue({
      row: buildRow({
        primaryContactName: "Travis Justin Rumney",
      }),
      rows: [
        buildRow({
          primaryContactName: "Travis Justin Rumney",
        }),
      ],
      accountLocation: null,
    });

    const { GET } = await import("@/app/api/business-accounts/[id]/route");
    const response = await GET(
      new NextRequest("http://localhost/api/business-accounts/record-1"),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Business account not found.",
    });
  });

  it("returns 404 when Travis is only the sales rep", async () => {
    readBusinessAccountDetailFromReadModel.mockReturnValue({
      row: buildRow({
        salesRepName: "Travis Justin Rumney",
      }),
      rows: [
        buildRow({
          salesRepName: "Travis Justin Rumney",
        }),
      ],
      accountLocation: null,
    });

    const { GET } = await import("@/app/api/business-accounts/[id]/route");
    const response = await GET(
      new NextRequest("http://localhost/api/business-accounts/record-1"),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Business account not found.",
    });
  });

  it("returns 404 when the account exists but deferred visibility hides all rows", async () => {
    fetchBusinessAccountById.mockReset();
    readBusinessAccountDetailFromReadModel.mockReturnValue(null);

    const { GET } = await import("@/app/api/business-accounts/[id]/route");
    const response = await GET(
      new NextRequest("http://localhost/api/business-accounts/record-1"),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(fetchBusinessAccountById).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Business account is not in the local SQLite snapshot. Click Sync records to refresh.",
    });
  });

  it("hydrates requested contact phone and extension on live detail reads", async () => {
    readBusinessAccountDetailFromReadModel.mockReturnValue(null);
    fetchBusinessAccountById.mockResolvedValue({
      id: "record-1",
      BusinessAccountID: { value: "B200000003" },
      Name: { value: "Alpha Inc" },
      MainAddress: {
        value: {
          AddressLine1: { value: "5579 McAdam Road" },
          City: { value: "Mississauga" },
          State: { value: "ON" },
          PostalCode: { value: "L4Z 1N4" },
          Country: { value: "CA" },
        },
      },
      Contacts: [
        {
          ContactID: { value: 157252 },
          DisplayName: { value: "Jorge Serrano" },
          EMail: { value: "jorge@example.com" },
        },
        {
          ContactID: { value: 999001 },
          DisplayName: { value: "Simon Doal" },
          EMail: { value: "simon@example.com" },
        },
      ],
      PrimaryContact: {
        value: {
          ContactID: { value: 157252 },
          DisplayName: { value: "Jorge Serrano" },
          EMail: { value: "jorge@example.com" },
        },
      },
    });
    fetchContactById.mockImplementation(async (_cookie: string, contactId: number) => {
      if (contactId === 157252) {
        return {
          ContactID: { value: 157252 },
          DisplayName: { value: "Jorge Serrano" },
          Phone1: { value: "4162304681" },
          EMail: { value: "jorge@example.com" },
        };
      }

      if (contactId === 999001) {
        return {
          ContactID: { value: 999001 },
          DisplayName: { value: "Simon Doal" },
          JobTitle: { value: "Sales Manager" },
          Phone1: { value: "9055551234" },
          Phone2: { value: "321" },
          EMail: { value: "simon@example.com" },
        };
      }

      throw new Error(`Unexpected contact id ${contactId}`);
    });

    const { GET } = await import("@/app/api/business-accounts/[id]/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/business-accounts/record-1?contactId=999001&live=1",
      ),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    const payload = await response.json();
    expect(response.status).toBe(200);

    expect(payload.row).toMatchObject({
      contactId: 999001,
      primaryContactName: "Simon Doal",
      primaryContactJobTitle: "Sales Manager",
      primaryContactPhone: "905-555-1234",
      primaryContactExtension: "321",
      primaryContactEmail: "simon@example.com",
    });

    const selectedRow =
      Array.isArray(payload.rows) &&
      payload.rows.find(
        (row) =>
          row &&
          typeof row === "object" &&
          "contactId" in row &&
          (row as { contactId?: number | null }).contactId === 999001,
      );
    expect(selectedRow).toMatchObject({
      contactId: 999001,
      primaryContactPhone: "905-555-1234",
      primaryContactExtension: "321",
    });
  });
});

describe("DELETE /api/business-accounts/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    applyLastCalledAtToBusinessAccountRows.mockReset();
    applyLastCalledAtToBusinessAccountRows.mockImplementation((rows) => rows);
    requireAuthCookieValue.mockReset();
    requireAuthCookieValue.mockReturnValue("cookie");
    setAuthCookie.mockReset();
    readStoredBusinessAccountRowsFromReadModel.mockReset();
    fetchBusinessAccountById.mockReset();
    resolveDeferredActionActor.mockReset();
    resolveDeferredActionActor.mockResolvedValue({
      loginName: "jserrano",
      name: "Jorge Serrano",
    });
    enqueueDeferredBusinessAccountDeleteAction.mockReset();
    enqueueDeferredBusinessAccountDeleteAction.mockReturnValue({
      id: "delete-account-1",
      executeAfterAt: "2026-04-16T01:00:00.000Z",
    });
  });

  it("queues deleting a business account even while contacts still exist", async () => {
    readStoredBusinessAccountRowsFromReadModel.mockReturnValue([
      buildRow({
        accountRecordId: "record-1",
        businessAccountId: "B200000003",
        contactId: 157252,
        primaryContactId: 157252,
      }),
    ]);
    fetchBusinessAccountById.mockResolvedValue({
      id: "record-1",
      BusinessAccountID: { value: "B200000003" },
      AccountName: { value: "Alpha Inc" },
      Contacts: [
        {
          ContactID: { value: 157252 },
          DisplayName: { value: "Jorge Serrano" },
        },
      ],
      PrimaryContact: {
        value: {
          ContactID: { value: 157252 },
          DisplayName: { value: "Jorge Serrano" },
        },
      },
    });

    const { DELETE } = await import("@/app/api/business-accounts/[id]/route");
    const response = await DELETE(
      new NextRequest("http://localhost/api/business-accounts/record-1?source=accounts", {
        method: "DELETE",
        body: JSON.stringify({ reason: "Company closed" }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      actionId: "delete-account-1",
      actionType: "deleteBusinessAccount",
      businessAccountRecordId: "record-1",
      businessAccountId: "B200000003",
      reason: "Company closed",
      executeAfterAt: "2026-04-16T01:00:00.000Z",
      status: "pending_review",
    });
    expect(enqueueDeferredBusinessAccountDeleteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        businessAccountRecordId: "record-1",
        businessAccountId: "B200000003",
        reason: "Company closed",
        sourceSurface: "accounts",
      }),
    );
  });

  it("rechecks the live account before rejecting a business account delete", async () => {
    readStoredBusinessAccountRowsFromReadModel.mockReturnValue([
      buildRow({
        accountRecordId: "record-1",
        rowKey: "record-1:contact:157252",
        businessAccountId: "B200000003",
        contactId: 157252,
        primaryContactId: 157252,
      }),
    ]);
    fetchBusinessAccountById.mockResolvedValue({
      id: "record-1",
      BusinessAccountID: { value: "B200000003" },
      AccountName: { value: "Alpha Inc" },
      Contacts: [],
      PrimaryContact: { value: null },
    });

    const { DELETE } = await import("@/app/api/business-accounts/[id]/route");
    const response = await DELETE(
      new NextRequest("http://localhost/api/business-accounts/record-1?source=accounts", {
        method: "DELETE",
        body: JSON.stringify({ reason: "Duplicate placeholder account" }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      actionId: "delete-account-1",
      actionType: "deleteBusinessAccount",
      businessAccountRecordId: "record-1",
      businessAccountId: "B200000003",
      reason: "Duplicate placeholder account",
      executeAfterAt: "2026-04-16T01:00:00.000Z",
      status: "pending_review",
    });
    expect(fetchBusinessAccountById).toHaveBeenCalledWith(
      "cookie",
      "record-1",
      expect.objectContaining({ value: null }),
    );
    expect(replaceReadModelAccountRows).toHaveBeenCalledWith(
      "record-1",
      expect.arrayContaining([
        expect.objectContaining({
          accountRecordId: "record-1",
          businessAccountId: "B200000003",
          contactId: null,
          primaryContactId: null,
        }),
      ]),
    );
  });

  it("queues the business account delete when no contacts remain", async () => {
    readStoredBusinessAccountRowsFromReadModel.mockReturnValue([
      buildRow({
        accountRecordId: "record-1",
        rowKey: "record-1:primary",
        businessAccountId: "B200000003",
        contactId: null,
        isPrimaryContact: false,
        primaryContactId: null,
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactEmail: null,
      }),
    ]);

    const { DELETE } = await import("@/app/api/business-accounts/[id]/route");
    const response = await DELETE(
      new NextRequest("http://localhost/api/business-accounts/record-1?source=accounts", {
        method: "DELETE",
        body: JSON.stringify({ reason: "Duplicate placeholder account" }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      actionId: "delete-account-1",
      actionType: "deleteBusinessAccount",
      businessAccountRecordId: "record-1",
      businessAccountId: "B200000003",
      reason: "Duplicate placeholder account",
      executeAfterAt: "2026-04-16T01:00:00.000Z",
      status: "pending_review",
    });
    expect(enqueueDeferredBusinessAccountDeleteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        businessAccountRecordId: "record-1",
        businessAccountId: "B200000003",
        reason: "Duplicate placeholder account",
        sourceSurface: "accounts",
      }),
    );
  });
});

describe("PUT /api/business-accounts/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    applyLastCalledAtToBusinessAccountRows.mockReset();
    applyLastCalledAtToBusinessAccountRows.mockImplementation((rows) => rows);
    requireAuthCookieValue.mockReset();
    requireAuthCookieValue.mockReturnValue("cookie");
    setAuthCookie.mockReset();
    publishBusinessAccountChanged.mockReset();
    shouldValidateWithAddressComplete.mockReset();
    shouldValidateWithAddressComplete.mockReturnValue(false);
    validateCanadianAddress.mockReset();
    fetchBusinessAccountById.mockReset();
    fetchContactById.mockReset();
    updateBusinessAccount.mockReset();
    updateContact.mockReset();
    setBusinessAccountPrimaryContact.mockReset();
    saveAccountCompanyDescription.mockReset();
    setBusinessAccountPrimaryContact.mockImplementation(async () => undefined);
    readBusinessAccountDetailFromReadModel.mockReset();
    replaceReadModelAccountRows.mockReset();
  });

  it("short-circuits cached no-op saves without writing to Acumatica", async () => {
    const cachedRow = buildRow({
      contactId: null,
      primaryContactId: null,
      rowKey: "record-1:primary",
      companyPhone: "437-213-9438",
      phoneNumber: "437-213-9438",
      salesRepId: null,
      salesRepName: null,
      category: null,
      primaryContactName: null,
      primaryContactJobTitle: null,
      primaryContactPhone: null,
      primaryContactExtension: null,
      primaryContactRawPhone: null,
      primaryContactEmail: null,
      notes: null,
    });

    readBusinessAccountDetailFromReadModel.mockImplementation(
      (_id: string, contactId?: number) => {
        if (contactId !== undefined) {
          return null;
        }

        return {
          row: cachedRow,
          rows: [cachedRow],
          accountLocation: null,
        };
      },
    );

    const { PUT } = await import("@/app/api/business-accounts/[id]/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/business-accounts/record-1", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildNoopPutPayload(cachedRow)),
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: cachedRow.id,
      accountRecordId: cachedRow.accountRecordId,
      companyName: cachedRow.companyName,
    });
    expect(fetchBusinessAccountById).not.toHaveBeenCalled();
    expect(updateBusinessAccount).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
    expect(publishBusinessAccountChanged).toHaveBeenCalledTimes(1);
  });

  it("persists local marketing eligibility updates without writing to Acumatica", async () => {
    const cachedRow = buildRow({
      contactId: null,
      primaryContactId: null,
      rowKey: "record-1:primary",
      marketingEligible: true,
    });

    readBusinessAccountDetailFromReadModel.mockImplementation(
      (_id: string, contactId?: number) => {
        if (contactId !== undefined) {
          return null;
        }

        return {
          row: cachedRow,
          rows: [cachedRow],
          accountLocation: null,
        };
      },
    );

    const { PUT } = await import("@/app/api/business-accounts/[id]/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/business-accounts/record-1", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...buildNoopPutPayload(cachedRow),
          marketingEligible: false,
        }),
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateBusinessAccount).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
    expect(saveAccountCompanyDescription).toHaveBeenCalledWith(
      expect.objectContaining({
        accountRecordId: "record-1",
        businessAccountId: "B200000003",
        marketingEligible: false,
      }),
    );
  });

  it("short-circuits already-primary saves without writing to Acumatica", async () => {
    const cachedRow = buildRow({
      contactId: 157252,
      primaryContactId: 157252,
      isPrimaryContact: true,
      rowKey: "record-1:contact:157252",
      primaryContactName: "Harvey Tamber",
      primaryContactJobTitle: null,
      primaryContactPhone: null,
      primaryContactExtension: null,
      primaryContactRawPhone: null,
      primaryContactEmail: null,
      notes: "Confirmed Decision Maker",
    });

    readBusinessAccountDetailFromReadModel.mockImplementation(
      (_id: string, contactId?: number) => {
        if (contactId !== undefined && contactId !== 157252) {
          return null;
        }

        return {
          row: cachedRow,
          rows: [cachedRow],
          accountLocation: null,
        };
      },
    );

    const { PUT } = await import("@/app/api/business-accounts/[id]/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/business-accounts/record-1", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...buildNoopPutPayload(cachedRow),
          targetContactId: 157252,
          assignedBusinessAccountId: cachedRow.businessAccountId,
          assignedBusinessAccountRecordId: cachedRow.accountRecordId,
          setAsPrimaryContact: true,
        }),
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: cachedRow.id,
      primaryContactId: cachedRow.primaryContactId,
      primaryContactName: cachedRow.primaryContactName,
    });
    expect(fetchBusinessAccountById).not.toHaveBeenCalled();
    expect(updateBusinessAccount).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
    expect(publishBusinessAccountChanged).toHaveBeenCalledTimes(1);
  });

  it("uses the cached target row for a primary-only switch when fetching the contact details fails", async () => {
    const currentPrimaryRow = buildRow({
      contactId: 157252,
      primaryContactId: 157252,
      isPrimaryContact: true,
      rowKey: "record-1:contact:157252",
      salesRepId: null,
      salesRepName: null,
      category: null,
      primaryContactName: "Harvey Tamber",
      primaryContactEmail: "harvey@example.com",
    });
    const targetRow = buildRow({
      contactId: 157253,
      primaryContactId: 157252,
      isPrimaryContact: false,
      rowKey: "record-1:contact:157253",
      salesRepId: null,
      salesRepName: null,
      category: null,
      primaryContactName: "Satman Gill",
      primaryContactEmail: "satman@example.com",
      primaryContactPhone: "647-555-0101",
      notes: "Target contact",
    });

    readBusinessAccountDetailFromReadModel.mockImplementation(
      (_id: string, contactId?: number) => {
        if (contactId === 157253) {
          return {
            row: targetRow,
            rows: [currentPrimaryRow, targetRow],
            accountLocation: null,
          };
        }

        return {
          row: currentPrimaryRow,
          rows: [currentPrimaryRow, targetRow],
          accountLocation: null,
        };
      },
    );

    fetchBusinessAccountById
      .mockResolvedValueOnce({
        id: "record-1",
        BusinessAccountID: { value: currentPrimaryRow.businessAccountId },
        Name: { value: currentPrimaryRow.companyName },
        MainAddress: {
          value: {
            AddressLine1: { value: currentPrimaryRow.addressLine1 },
            AddressLine2: { value: currentPrimaryRow.addressLine2 },
            City: { value: currentPrimaryRow.city },
            State: { value: currentPrimaryRow.state },
            PostalCode: { value: currentPrimaryRow.postalCode },
            Country: { value: currentPrimaryRow.country },
          },
        },
        Contacts: [
          {
            ContactID: { value: 157252 },
            DisplayName: { value: "Harvey Tamber" },
            Email: { value: "harvey@example.com" },
          },
          {
            ContactID: { value: 157253 },
            DisplayName: { value: "Satman Gill" },
            Email: { value: "satman@example.com" },
            Phone1: { value: "647-555-0101" },
            note: { value: "Target contact" },
          },
        ],
        PrimaryContact: {
          ContactID: { value: 157252 },
          DisplayName: { value: "Harvey Tamber" },
          Email: { value: "harvey@example.com" },
        },
      })
      .mockResolvedValueOnce({
        id: "record-1",
        BusinessAccountID: { value: currentPrimaryRow.businessAccountId },
        Name: { value: currentPrimaryRow.companyName },
        MainAddress: {
          value: {
            AddressLine1: { value: currentPrimaryRow.addressLine1 },
            AddressLine2: { value: currentPrimaryRow.addressLine2 },
            City: { value: currentPrimaryRow.city },
            State: { value: currentPrimaryRow.state },
            PostalCode: { value: currentPrimaryRow.postalCode },
            Country: { value: currentPrimaryRow.country },
          },
        },
        Contacts: [
          {
            ContactID: { value: 157252 },
            DisplayName: { value: "Harvey Tamber" },
            Email: { value: "harvey@example.com" },
          },
          {
            ContactID: { value: 157253 },
            DisplayName: { value: "Satman Gill" },
            Email: { value: "satman@example.com" },
            Phone1: { value: "647-555-0101" },
            note: { value: "Target contact" },
          },
        ],
        PrimaryContact: {
          ContactID: { value: 157253 },
          DisplayName: { value: "Satman Gill" },
          Email: { value: "satman@example.com" },
        },
      });

    fetchContactById
      .mockRejectedValueOnce(new Error("temporary contact lookup failure"))
      .mockResolvedValue(
        buildRawContact(targetRow, {
          LastModifiedDateTime: { value: "2026-04-02T11:00:00.000Z" },
        }),
      );

    const { PUT } = await import("@/app/api/business-accounts/[id]/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/business-accounts/record-1", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...buildNoopPutPayload(targetRow),
          targetContactId: 157253,
          assignedBusinessAccountId: targetRow.businessAccountId,
          assignedBusinessAccountRecordId: targetRow.accountRecordId,
          setAsPrimaryContact: true,
        }),
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(updateBusinessAccount).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
    expect(setBusinessAccountPrimaryContact).toHaveBeenCalledTimes(1);
    expect(responseBody).toMatchObject({
      contactId: 157253,
      primaryContactId: 157253,
      primaryContactName: "Satman Gill",
      isPrimaryContact: true,
    });
  });

  it("treats sparse no-op payloads as unchanged by preserving cached optional fields", async () => {
    const cachedRow = buildRow({
      contactId: null,
      primaryContactId: null,
      rowKey: "record-1:primary",
      companyPhone: null,
      phoneNumber: null,
      salesRepId: "109337",
      salesRepName: "Jeffery Buhagiar",
      companyRegion: "Region 6",
      industryType: null,
      subCategory: null,
      week: null,
      category: null,
      primaryContactName: null,
      primaryContactJobTitle: null,
      primaryContactPhone: null,
      primaryContactExtension: null,
      primaryContactRawPhone: null,
      primaryContactEmail: null,
      notes: null,
    });

    readBusinessAccountDetailFromReadModel.mockImplementation(
      (_id: string, contactId?: number) => {
        if (contactId !== undefined) {
          return null;
        }

        return {
          row: cachedRow,
          rows: [cachedRow],
          accountLocation: null,
        };
      },
    );

    const sparseNoopPayload = {
      companyName: cachedRow.companyName,
      addressLine1: cachedRow.addressLine1,
      addressLine2: cachedRow.addressLine2,
      city: cachedRow.city,
      state: cachedRow.state,
      postalCode: cachedRow.postalCode,
      country: cachedRow.country,
      salesRepId: cachedRow.salesRepId,
      salesRepName: cachedRow.salesRepName,
      companyPhone: null,
      primaryContactName: null,
      primaryContactPhone: null,
      primaryContactEmail: null,
      category: cachedRow.category,
      notes: cachedRow.notes,
      expectedLastModified: cachedRow.lastModifiedIso,
    };

    const { PUT } = await import("@/app/api/business-accounts/[id]/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/business-accounts/record-1", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(sparseNoopPayload),
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: cachedRow.id,
      accountRecordId: cachedRow.accountRecordId,
      companyRegion: "Region 6",
      salesRepId: "109337",
      salesRepName: "Jeffery Buhagiar",
    });
    expect(fetchBusinessAccountById).not.toHaveBeenCalled();
    expect(updateBusinessAccount).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("treats snapshot-only note edits as contact-only even when account fields drift", async () => {
    const snapshotRow = buildRow({
      notes: "Original note",
      lastModifiedIso: "2026-04-01T10:00:00.000Z",
    });
    const cachedRow = buildRow({
      ...snapshotRow,
      salesRepName: "Updated Rep Name",
    });
    const contactId = snapshotRow.contactId as number;

    readBusinessAccountDetailFromReadModel.mockImplementation(
      (_id: string, requestedContactId?: number) => {
        if (requestedContactId !== undefined && requestedContactId !== contactId) {
          return null;
        }

        return {
          row: cachedRow,
          rows: [cachedRow],
          accountLocation: null,
        };
      },
    );

    fetchContactById
      .mockResolvedValueOnce(
        buildRawContact(snapshotRow, {
          LastModifiedDateTime: { value: "2026-04-02T11:00:00.000Z" },
          note: { value: "Original note" },
        }),
      )
      .mockResolvedValueOnce(
        buildRawContact(snapshotRow, {
          LastModifiedDateTime: { value: "2026-04-03T12:00:00.000Z" },
          note: { value: "Updated from drawer" },
        }),
      );

    const { PUT } = await import("@/app/api/business-accounts/[id]/route");
    const debugPayload = {
      ...buildNoopPutPayload(snapshotRow),
      targetContactId: contactId,
      notes: "Updated from drawer",
      baseSnapshot: buildConcurrencySnapshot(snapshotRow),
    };
    const parsedDebugPayload = parseUpdatePayload(debugPayload);
    expect([...collectUpdatedConcurrencyFields(parsedDebugPayload)]).toEqual([
      "assignedBusinessAccountRecordId",
      "assignedBusinessAccountId",
      "notes",
    ]);

    const response = await PUT(
      new NextRequest("http://localhost/api/business-accounts/record-1", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(debugPayload),
      }),
      {
        params: Promise.resolve({
          id: "record-1",
        }),
      },
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(responseBody).toMatchObject({
      notes: "Updated from drawer",
      contactId,
      accountRecordId: cachedRow.accountRecordId,
    });
    expect(fetchBusinessAccountById).not.toHaveBeenCalled();
    expect(updateBusinessAccount).not.toHaveBeenCalled();
    expect(updateContact).toHaveBeenCalledTimes(1);
    expect(fetchContactById).toHaveBeenCalledTimes(2);
  });

  it("reassigns contact-only saves to a different business account when the assigned account changes", async () => {
    const sourceRow = buildRow({
      id: "lead-record-1",
      accountRecordId: "lead-record-1",
      rowKey: "lead-record-1:contact:157252",
      businessAccountId: "LEAD-100",
      companyName: "Vac Aero Lead",
      primaryContactName: "Val Cowen",
      primaryContactEmail: "val@vacaero.com",
      notes: "Original note",
    });
    const targetContactId = sourceRow.contactId as number;

    readBusinessAccountDetailFromReadModel.mockImplementation(
      (_id: string, requestedContactId?: number) => {
        if (requestedContactId !== undefined && requestedContactId !== targetContactId) {
          return null;
        }

        return {
          row: sourceRow,
          rows: [sourceRow],
          accountLocation: null,
        };
      },
    );

    fetchContactById
      .mockResolvedValueOnce(buildRawContact(sourceRow))
      .mockResolvedValueOnce(
        buildRawContact(sourceRow, {
          BusinessAccountID: { value: "VAC-200" },
          BusinessAccount: { value: "VAC-200" },
          CompanyName: { value: "Vac Aero International" },
        }),
      );

    fetchBusinessAccountById.mockResolvedValueOnce({
      id: "customer-record-1",
      BusinessAccountID: { value: "VAC-200" },
      Name: { value: "Vac Aero International" },
      MainAddress: {
        value: {
          AddressLine1: { value: "1 Customer Way" },
          City: { value: "Toronto" },
          State: { value: "ON" },
          PostalCode: { value: "M5V 1A1" },
          Country: { value: "CA" },
        },
      },
      Contacts: [
        {
          ContactID: { value: targetContactId },
          BusinessAccountID: { value: "VAC-200" },
          DisplayName: { value: "Val Cowen" },
          Email: { value: "val@vacaero.com" },
          note: { value: "Original note" },
        },
      ],
      PrimaryContact: {
        ContactID: { value: targetContactId },
        DisplayName: { value: "Val Cowen" },
        Email: { value: "val@vacaero.com" },
      },
    });

    const { PUT } = await import("@/app/api/business-accounts/[id]/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/business-accounts/lead-record-1", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...buildNoopPutPayload(sourceRow),
          targetContactId,
          assignedBusinessAccountRecordId: "customer-record-1",
          assignedBusinessAccountId: "VAC-200",
          baseSnapshot: buildConcurrencySnapshot(sourceRow),
        }),
      }),
      {
        params: Promise.resolve({
          id: "lead-record-1",
        }),
      },
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(updateContact).toHaveBeenCalledWith(
      "cookie",
      targetContactId,
      expect.objectContaining({
        BusinessAccount: {
          value: "VAC-200",
        },
      }),
      expect.any(Object),
    );
    expect(fetchBusinessAccountById).toHaveBeenCalledWith(
      "cookie",
      "customer-record-1",
      expect.any(Object),
    );
    expect(replaceReadModelAccountRows).toHaveBeenNthCalledWith(1, "lead-record-1", []);
    expect(replaceReadModelAccountRows).toHaveBeenNthCalledWith(
      2,
      "customer-record-1",
      expect.arrayContaining([
        expect.objectContaining({
          contactId: targetContactId,
          businessAccountId: "VAC-200",
        }),
      ]),
    );
    expect(responseBody).toMatchObject({
      contactId: targetContactId,
      businessAccountId: "VAC-200",
    });
  });
});
