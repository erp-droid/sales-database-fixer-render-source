import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

const requireAuthCookieValue = vi.fn(() => "cookie");
const getStoredLoginName = vi.fn(() => "jserrano");
const setAuthCookie = vi.fn();
const getEnv = vi.fn(() => ({
  READ_MODEL_ENABLED: false,
}));
const fetchAllSyncRows = vi.fn();
const queryReadModelBusinessAccounts = vi.fn();
const maybeTriggerReadModelSync = vi.fn();
const resolveDeferredActionActor = vi.fn();
const resolveStoredDeferredActionActor = vi.fn(() => ({
  loginName: "jserrano",
  name: "jserrano",
}));
const retrieveCanadaPostAddressCompleteAddress = vi.fn(
  async (input: { fallback: unknown }) => input.fallback,
);
const logBusinessAccountCreateAudit = vi.fn();

vi.mock("@/lib/auth", () => ({
  getStoredLoginName,
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/env", () => ({
  getEnv,
}));

vi.mock("@/lib/deferred-action-actor", () => ({
  resolveDeferredActionActor,
  resolveStoredDeferredActionActor,
}));

vi.mock("@/lib/address-complete", () => ({
  retrieveCanadaPostAddressCompleteAddress,
}));

vi.mock("@/lib/audit-log-store", () => ({
  logBusinessAccountCreateAudit,
}));

vi.mock("@/lib/data-quality-live", () => ({
  fetchAllSyncRows,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  queryReadModelBusinessAccounts,
  replaceReadModelAccountRows: vi.fn(),
}));

vi.mock("@/lib/read-model/account-local-metadata", () => ({
  applyLocalAccountMetadataToRow: vi.fn((row) => row),
  applyLocalAccountMetadataToRows: vi.fn((rows) => rows),
  saveAccountCompanyDescription: vi.fn(),
}));

vi.mock("@/lib/read-model/sync", () => ({
  maybeTriggerReadModelSync,
  readSyncStatus: vi.fn(() => ({
    status: "idle",
    phase: null,
    startedAt: null,
    completedAt: null,
    lastSuccessfulSyncAt: null,
    lastError: null,
    rowsCount: 0,
    accountsCount: 0,
    contactsCount: 0,
    progress: null,
  })),
}));

function buildRow(input: Partial<BusinessAccountRow> & {
  id: string;
  businessAccountId: string;
  companyName: string;
}): BusinessAccountRow {
  return {
    id: input.id,
    accountRecordId: input.accountRecordId ?? input.id,
    rowKey: input.rowKey ?? `${input.id}:contact:${input.contactId ?? "row"}`,
    contactId: input.contactId ?? null,
    isPrimaryContact: input.isPrimaryContact ?? false,
    companyPhone: input.companyPhone ?? null,
    companyPhoneSource: input.companyPhoneSource ?? null,
    phoneNumber: input.phoneNumber ?? null,
    salesRepId: input.salesRepId ?? null,
    salesRepName: input.salesRepName ?? null,
    industryType: input.industryType ?? null,
    subCategory: input.subCategory ?? null,
    companyRegion: input.companyRegion ?? null,
    week: input.week ?? null,
    businessAccountId: input.businessAccountId,
    companyName: input.companyName,
    address: input.address ?? "5579 McAdam Road, Mississauga, ON L4Z 1N4, CA",
    addressLine1: input.addressLine1 ?? "5579 McAdam Road",
    addressLine2: input.addressLine2 ?? "",
    city: input.city ?? "Mississauga",
    state: input.state ?? "ON",
    postalCode: input.postalCode ?? "L4Z 1N4",
    country: input.country ?? "CA",
    primaryContactName: input.primaryContactName ?? null,
    primaryContactPhone: input.primaryContactPhone ?? null,
    primaryContactEmail: input.primaryContactEmail ?? null,
    primaryContactId: input.primaryContactId ?? null,
    category: input.category ?? null,
    notes: input.notes ?? null,
    lastModifiedIso: input.lastModifiedIso ?? null,
  };
}

describe("GET /api/business-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("jserrano");
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: false,
    });
    queryReadModelBusinessAccounts.mockReturnValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });

  it("returns the full sync dataset when sync=1 and full=1", async () => {
    fetchAllSyncRows.mockResolvedValue([
      buildRow({
        id: "acct-1",
        businessAccountId: "BA0001",
        companyName: "ABC Group",
        contactId: 101,
        primaryContactName: "Amy Vega",
        primaryContactEmail: "amy.vega@example.com",
      }),
      buildRow({
        id: "acct-1",
        businessAccountId: "BA0001",
        companyName: "ABC Group",
        contactId: 102,
        primaryContactName: "Ben Carter",
        primaryContactEmail: "ben.carter@example.com",
      }),
      buildRow({
        id: "acct-2",
        businessAccountId: "BA0002",
        companyName: "MeadowBrook Operations",
        contactId: 201,
        primaryContactName: "Jorge Serrano",
        primaryContactEmail: "jserrano@meadowb.com",
      }),
    ]);

    const { GET } = await import("@/app/api/business-accounts/route");

    const response = await GET(
      new NextRequest(
        "http://localhost/api/business-accounts?sortBy=companyName&sortDir=asc&page=1&pageSize=25&sync=1&full=1&includeInternal=1",
      ),
    );
    const payload = (await response.json()) as {
      items: BusinessAccountRow[];
      page: number;
      pageSize: number;
      total: number;
    };

    expect(response.status).toBe(200);
    expect(fetchAllSyncRows).toHaveBeenCalledWith(
      "cookie",
      expect.any(Object),
      { includeInternal: true },
    );
    expect(payload.total).toBe(3);
    expect(payload.page).toBe(1);
    expect(payload.pageSize).toBe(3);
    expect(payload.items).toHaveLength(3);
    expect(payload.items.map((item) => item.contactId)).toEqual([101, 102, 201]);
  });

  it("uses the full sync dataset for legacy full internal requests", async () => {
    fetchAllSyncRows.mockResolvedValue([
      buildRow({
        id: "acct-1",
        businessAccountId: "BA0001",
        companyName: "ABC Group",
        contactId: 101,
        primaryContactName: "Amy Vega",
        primaryContactEmail: "amy.vega@example.com",
      }),
      buildRow({
        id: "acct-2",
        businessAccountId: "BA0002",
        companyName: "MeadowBrook Operations",
        contactId: 201,
        primaryContactName: "Jorge Serrano",
        primaryContactEmail: "jserrano@meadowb.com",
      }),
    ]);

    const { GET } = await import("@/app/api/business-accounts/route");

    const response = await GET(
      new NextRequest(
        "http://localhost/api/business-accounts?sortBy=companyName&sortDir=asc&page=1&pageSize=25&full=1&includeInternal=1",
      ),
    );
    const payload = (await response.json()) as {
      items: BusinessAccountRow[];
      page: number;
      pageSize: number;
      total: number;
    };

    expect(response.status).toBe(200);
    expect(fetchAllSyncRows).toHaveBeenCalledWith(
      "cookie",
      expect.any(Object),
      { includeInternal: true },
    );
    expect(payload.total).toBe(2);
    expect(payload.items.map((item) => item.contactId)).toEqual([101, 201]);
  });

  it("uses the read model for full internal requests when enabled", async () => {
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: true,
    });
    queryReadModelBusinessAccounts
      .mockReturnValueOnce({
        items: [],
        total: 1,
        page: 1,
        pageSize: 1,
      })
      .mockReturnValueOnce({
        items: [
          buildRow({
            id: "acct-1",
            businessAccountId: "02670D2595",
            companyName: "MeadowBrook Construction - Internal",
            contactId: 159842,
            primaryContactName: "Jacky Lee",
            primaryContactEmail: "jlee@meadowb.com",
          }),
        ],
        total: 1,
        page: 1,
        pageSize: 1,
      });

    const { GET } = await import("@/app/api/business-accounts/route");

    const response = await GET(
      new NextRequest(
        "http://localhost/api/business-accounts?sortBy=companyName&sortDir=asc&page=1&pageSize=25&full=1&includeInternal=1",
      ),
    );
    const payload = (await response.json()) as {
      items: BusinessAccountRow[];
      total: number;
      page: number;
      pageSize: number;
    };

    expect(response.status).toBe(200);
    expect(maybeTriggerReadModelSync).toHaveBeenCalledWith("cookie", expect.any(Object));
    expect(fetchAllSyncRows).not.toHaveBeenCalled();
    expect(queryReadModelBusinessAccounts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        includeInternalRows: true,
        page: 1,
        pageSize: 1,
      }),
      "jserrano",
    );
    expect(queryReadModelBusinessAccounts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        includeInternalRows: true,
        page: 1,
        pageSize: 1,
      }),
      "jserrano",
    );
    expect(payload.total).toBe(1);
    expect(payload.items[0]?.primaryContactName).toBe("Jacky Lee");
  });

  it("bypasses the read model for full internal requests when live=1 is requested", async () => {
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: true,
    });
    fetchAllSyncRows.mockResolvedValue([
      buildRow({
        id: "acct-live-1",
        businessAccountId: "BA1001",
        companyName: "Universal Matter",
        contactId: 501,
        primaryContactName: "Tiho Sudetic",
        primaryContactEmail: "tiho@universalmatter.ca",
      }),
      buildRow({
        id: "acct-live-2",
        businessAccountId: "BA1002",
        companyName: "Vermeer Canada",
        contactId: 601,
        primaryContactName: "Alice Wong",
        primaryContactEmail: "alice@vermeer.ca",
      }),
    ]);

    const { GET } = await import("@/app/api/business-accounts/route");

    const response = await GET(
      new NextRequest(
        "http://localhost/api/business-accounts?sortBy=companyName&sortDir=asc&page=1&pageSize=25&full=1&includeInternal=1&live=1",
      ),
    );
    const payload = (await response.json()) as {
      items: BusinessAccountRow[];
      total: number;
      page: number;
      pageSize: number;
    };

    expect(response.status).toBe(200);
    expect(fetchAllSyncRows).toHaveBeenCalledWith(
      "cookie",
      expect.any(Object),
      { includeInternal: true },
    );
    expect(queryReadModelBusinessAccounts).not.toHaveBeenCalled();
    expect(maybeTriggerReadModelSync).not.toHaveBeenCalled();
    expect(payload.total).toBe(2);
    expect(payload.items.map((item) => item.companyName)).toEqual([
      "Universal Matter",
      "Vermeer Canada",
    ]);
  });

  it("limits Jeffery's full dataset to his A and B accounts", async () => {
    getStoredLoginName.mockReturnValue("jbuhagiar@meadowb.com");
    fetchAllSyncRows.mockResolvedValue([
      buildRow({
        category: "A",
        id: "acct-a-jeffery",
        businessAccountId: "BA2001",
        companyName: "Jeffery A Account",
        primaryContactName: "Avery Stone",
        salesRepName: "Jeffery Buhagiar",
      }),
      buildRow({
        category: "B",
        id: "acct-b-jeffery",
        businessAccountId: "BA2002",
        companyName: "Jeffery B Account",
        primaryContactName: "Bailey Chen",
        salesRepName: "Jeff Buhagiar",
      }),
      buildRow({
        category: "C",
        id: "acct-c-jeffery",
        businessAccountId: "BA2003",
        companyName: "Jeffery C Account",
        primaryContactName: "Casey Nguyen",
        salesRepName: "Jeffery Buhagiar",
      }),
      buildRow({
        category: "A",
        id: "acct-a-justin",
        businessAccountId: "BA2004",
        companyName: "Justin A Account",
        primaryContactName: "Drew Patel",
        salesRepName: "Justin Settle",
      }),
    ]);

    const { GET } = await import("@/app/api/business-accounts/route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/business-accounts?sync=1&full=1&includeInternal=1",
      ),
    );
    const payload = (await response.json()) as {
      items: BusinessAccountRow[];
      total: number;
    };

    expect(response.status).toBe(200);
    expect(payload.total).toBe(2);
    expect(payload.items.map((row) => row.id)).toEqual([
      "acct-a-jeffery",
      "acct-b-jeffery",
    ]);
  });
});

describe("POST /api/business-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: false,
    });
    retrieveCanadaPostAddressCompleteAddress.mockImplementation(
      async (input: { fallback: unknown }) => input.fallback,
    );
    resolveStoredDeferredActionActor.mockReturnValue({
      loginName: "jserrano",
      name: "jserrano",
    });
  });

  it("creates a local account without validating the legacy actor session", async () => {
    const { POST } = await import("@/app/api/business-accounts/route");

    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts", {
        method: "POST",
        body: JSON.stringify({
          companyName: "360 Advanced Security Corporation",
          companyDescription: "Security services.",
          classId: "LEAD",
          salesRepId: null,
          salesRepName: null,
          companyPhone: "905-555-1212",
          industryType: "Service",
          subCategory: "Service",
          companyRegion: "Region 5",
          week: null,
          category: "B",
          addressLookupId: "ca-post-id",
          addressLine1: "31 Constellation Crt",
          addressLine2: "",
          city: "Etobicoke",
          state: "ON",
          postalCode: "M9W 1K4",
          country: "CA",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(resolveStoredDeferredActionActor).toHaveBeenCalledTimes(1);
    expect(resolveDeferredActionActor).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      created: true,
      createdRow: expect.objectContaining({
        companyName: "360 Advanced Security Corporation",
        addressLine1: "31 Constellation Crt",
      }),
      warnings: ["Saved locally."],
    });
    expect(payload.businessAccountId).toMatch(/^LOCAL-/);
    expect(logBusinessAccountCreateAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          loginName: "jserrano",
          name: "jserrano",
        },
        resultCode: "succeeded",
        companyName: "360 Advanced Security Corporation",
      }),
    );
  });
});
