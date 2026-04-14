import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

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
const readBusinessAccountDetailFromReadModel = vi.fn();
const readStoredBusinessAccountRowsFromReadModel = vi.fn();
const replaceReadModelAccountRows = vi.fn();
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

vi.mock("@/lib/read-model/accounts", () => ({
  readBusinessAccountDetailFromReadModel,
  readStoredBusinessAccountRowsFromReadModel,
  replaceReadModelAccountRows,
}));

vi.mock("@/lib/read-model/account-local-metadata", () => ({
  applyLocalAccountMetadataToRow: vi.fn((row) => row),
  applyLocalAccountMetadataToRows: vi.fn((rows) => rows),
  saveAccountCompanyDescription: vi.fn(),
}));

vi.mock("@/lib/read-model/sync", () => ({
  maybeTriggerReadModelSync,
  readSyncStatus,
  waitForReadModelSync,
}));

function buildRow(overrides?: Partial<BusinessAccountRow>): BusinessAccountRow {
  return {
    id: "record-1",
    accountRecordId: "record-1",
    rowKey: "record-1:contact:157252",
    contactId: 157252,
    isPrimaryContact: true,
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

describe("GET /api/business-accounts/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
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
});

describe("DELETE /api/business-accounts/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAuthCookieValue.mockReset();
    requireAuthCookieValue.mockReturnValue("cookie");
    setAuthCookie.mockReset();
    readStoredBusinessAccountRowsFromReadModel.mockReset();
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

  it("rejects deleting a business account while contacts still exist", async () => {
    readStoredBusinessAccountRowsFromReadModel.mockReturnValue([
      buildRow({
        accountRecordId: "record-1",
        businessAccountId: "B200000003",
        contactId: 157252,
        primaryContactId: 157252,
      }),
    ]);

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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Delete the remaining contacts on this business account before queueing the account deletion.",
    });
    expect(enqueueDeferredBusinessAccountDeleteAction).not.toHaveBeenCalled();
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
