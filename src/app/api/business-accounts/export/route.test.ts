import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

const requireAuthCookieValue = vi.fn(() => "cookie");
const getStoredLoginName = vi.fn(() => "jserrano");
const setAuthCookie = vi.fn();
const getEnv = vi.fn(() => ({
  READ_MODEL_ENABLED: true,
}));
const maybeTriggerReadModelSync = vi.fn();
const readSyncStatus = vi.fn(() => ({
  status: "idle",
  phase: null,
  startedAt: null,
  completedAt: "2026-04-06T12:00:00.000Z",
  lastSuccessfulSyncAt: "2026-04-06T12:00:00.000Z",
  lastError: null,
  rowsCount: 1,
  accountsCount: 1,
  contactsCount: 1,
  progress: null,
}));
const readAllAccountRowsFromReadModel = vi.fn();
const fetchAllSyncRows = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  getStoredLoginName,
  setAuthCookie,
}));

vi.mock("@/lib/env", () => ({
  getEnv,
}));

vi.mock("@/lib/read-model/sync", () => ({
  maybeTriggerReadModelSync,
  readSyncStatus,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  readAllAccountRowsFromReadModel,
}));

vi.mock("@/lib/data-quality-live", () => ({
  fetchAllSyncRows,
}));

function buildRow(overrides: Partial<BusinessAccountRow> = {}): BusinessAccountRow {
  return {
    id: overrides.id ?? "acct-1",
    accountRecordId: overrides.accountRecordId ?? "acct-1",
    rowKey: overrides.rowKey ?? "acct-1:contact:101",
    contactId: overrides.contactId ?? 101,
    isPrimaryContact: overrides.isPrimaryContact ?? true,
    companyPhone: overrides.companyPhone ?? "905-555-0100",
    companyPhoneSource: overrides.companyPhoneSource ?? "account",
    phoneNumber: overrides.phoneNumber ?? "905-555-0100",
    salesRepId: overrides.salesRepId ?? "109343",
    salesRepName: overrides.salesRepName ?? "Jorge Serrano",
    industryType: overrides.industryType ?? "Distribution",
    subCategory: overrides.subCategory ?? "Packaging",
    companyRegion: overrides.companyRegion ?? "Region 5",
    week: overrides.week ?? "Week 4",
    businessAccountId: overrides.businessAccountId ?? "B200000049",
    companyName: overrides.companyName ?? "Footage Tools",
    companyDescription: overrides.companyDescription ?? null,
    address: overrides.address ?? "54 Audia Ct Unit 11, Concord ON L4K 3N4, CA",
    addressLine1: overrides.addressLine1 ?? "54 Audia Ct Unit 11",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Concord",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "L4K 3N4",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? "Yash Marathe",
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? "Facility Lead",
    primaryContactPhone: overrides.primaryContactPhone ?? "905-695-9900",
    primaryContactExtension: overrides.primaryContactExtension ?? "235",
    primaryContactRawPhone: overrides.primaryContactRawPhone ?? null,
    primaryContactEmail: overrides.primaryContactEmail ?? "yash@example.com",
    primaryContactId: overrides.primaryContactId ?? 101,
    category: overrides.category ?? "A",
    notes: overrides.notes ?? "Confirmed",
    lastEmailedAt: overrides.lastEmailedAt ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-04-06T09:30:00.000Z",
  };
}

describe("GET /api/business-accounts/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("jserrano");
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: true,
    });
    readAllAccountRowsFromReadModel.mockReturnValue([
      buildRow(),
      buildRow({
        id: "acct-2",
        accountRecordId: "acct-2",
        rowKey: "acct-2:contact:202",
        contactId: 202,
        businessAccountId: "B200000050",
        companyName: "Acme Packaging",
      }),
    ]);
  });

  it("returns a CSV attachment for jserrano", async () => {
    const { GET } = await import("@/app/api/business-accounts/export/route");

    const response = await GET(
      new NextRequest(
        "http://localhost/api/business-accounts/export?sortBy=companyName&sortDir=asc&page=1&pageSize=25&q=footage",
      ),
    );
    const payload = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("accounts-export-");
    expect(payload).toContain("Company Name");
    expect(payload).toContain("Footage Tools");
    expect(payload).not.toContain("Acme Packaging");
  });

  it("rejects non-jserrano users", async () => {
    getStoredLoginName.mockReturnValue("sdoal");
    const { GET } = await import("@/app/api/business-accounts/export/route");

    const response = await GET(
      new NextRequest("http://localhost/api/business-accounts/export"),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Only jserrano can export account CSV files.");
  });

  it("returns 409 when no local snapshot exists in read-model mode", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    readSyncStatus.mockReturnValue({
      status: "running",
      phase: "fetch",
      startedAt: "2026-04-06T12:00:00.000Z",
      completedAt: null,
      lastSuccessfulSyncAt: null,
      lastError: null,
      rowsCount: 0,
      accountsCount: 0,
      contactsCount: 0,
      progress: null,
    });

    const { GET } = await import("@/app/api/business-accounts/export/route");

    const response = await GET(
      new NextRequest("http://localhost/api/business-accounts/export"),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(payload.error).toContain("No local snapshot yet.");
    expect(fetchAllSyncRows).not.toHaveBeenCalled();
  });
});
