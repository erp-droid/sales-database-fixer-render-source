import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const createContact = vi.fn();
const fetchBusinessAccountById = vi.fn();
const fetchContactMergeServerContext = vi.fn();
const setBusinessAccountPrimaryContact = vi.fn();
const buildAccountRowsFromRawAccount = vi.fn();
const logContactCreateAudit = vi.fn();
const resolveDeferredActionActor = vi.fn(async () => ({
  loginName: "jserrano",
  name: "Jorge Serrano",
}));
const replaceReadModelAccountRows = vi.fn();
const getEnv = vi.fn(() => ({
  READ_MODEL_ENABLED: false,
}));

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readWrappedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = Number((field as Record<string, unknown>).value);
  return Number.isFinite(value) ? value : null;
}

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  createContact,
  fetchBusinessAccountById,
  readWrappedNumber,
  readWrappedString,
}));

vi.mock("@/lib/contact-merge-server", () => ({
  buildAccountRowsFromRawAccount,
  fetchContactMergeServerContext,
  setBusinessAccountPrimaryContact,
}));

vi.mock("@/lib/audit-log-store", () => ({
  logContactCreateAudit,
}));

vi.mock("@/lib/deferred-action-actor", () => ({
  resolveDeferredActionActor,
}));

vi.mock("@/lib/env", () => ({
  getEnv,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  replaceReadModelAccountRows,
}));

vi.mock("@/lib/read-model/account-local-metadata", () => ({
  applyLocalAccountMetadataToRow: vi.fn((row) => row),
  applyLocalAccountMetadataToRows: vi.fn((rows) => rows),
}));

function buildRow(): BusinessAccountRow {
  return {
    id: "record-1",
    accountRecordId: "record-1",
    rowKey: "record-1:contact:157497",
    contactId: 157497,
    isPrimaryContact: true,
    companyPhone: null,
    companyPhoneSource: null,
    phoneNumber: null,
    salesRepId: null,
    salesRepName: null,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: "B200000003",
    companyName: "Alpha Inc",
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
    primaryContactExtension: "31",
    primaryContactRawPhone: "416-230-4681",
    primaryContactEmail: "jserrano@meadowb.com",
    primaryContactId: 157497,
    category: null,
    notes: null,
    lastModifiedIso: null,
  };
}

describe("POST /api/business-accounts/[id]/contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnv.mockReturnValue({
      READ_MODEL_ENABLED: false,
    });
    fetchContactMergeServerContext.mockResolvedValue({
      rawAccount: {
        AccountCD: { value: "B200000003" },
        Name: { value: "Alpha Inc" },
      },
      resolvedRecordId: "record-1",
    });
    createContact.mockResolvedValue({
      ContactID: { value: 157497 },
    });
    setBusinessAccountPrimaryContact.mockResolvedValue(undefined);
    fetchBusinessAccountById.mockResolvedValue({
      id: { value: "record-1" },
    });
    buildAccountRowsFromRawAccount.mockReturnValue([buildRow()]);
  });

  it("passes normalized phone and extension to the Acumatica contact payload", async () => {
    const { POST } = await import("@/app/api/business-accounts/[id]/contacts/route");

    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts/record-1/contacts", {
        method: "POST",
        body: JSON.stringify({
          displayName: "Jorge Serrano",
          jobTitle: "Sales",
          email: "jserrano@meadowb.com",
          phone1: "4162304681",
          extension: "31",
          contactClass: "sales",
        }),
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

    expect(response.status).toBe(201);
    expect(createContact).toHaveBeenCalledWith(
      "cookie",
      expect.objectContaining({
        Phone1: { value: "416-230-4681" },
        Phone2: { value: "31" },
        BusinessAccount: { value: "B200000003" },
      }),
      expect.any(Object),
    );
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      contactId: 157497,
      createdRow: expect.objectContaining({
        primaryContactExtension: "31",
      }),
    });
  });
});
