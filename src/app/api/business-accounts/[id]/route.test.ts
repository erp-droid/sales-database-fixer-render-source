import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const getEnv = vi.fn(() => ({
  READ_MODEL_ENABLED: true,
}));
const readBusinessAccountDetailFromReadModel = vi.fn();
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

vi.mock("@/lib/env", () => ({
  getEnv,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  readBusinessAccountDetailFromReadModel,
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
    replaceReadModelAccountRows.mockReset();
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

  it("returns 404 for rows associated with Travis Rumney even when cached", async () => {
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
