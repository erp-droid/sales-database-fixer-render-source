import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const fetchBusinessAccounts = vi.fn();
const fetchContacts = vi.fn();
const readCallEmployeeDirectory = vi.fn();
const readCallEmployeeDirectoryMeta = vi.fn();
const syncCallEmployeeDirectory = vi.fn();
const readAllAccountRowsFromReadModel = vi.fn();
const readEmployeeDirectorySnapshot = vi.fn();
const withServiceAcumaticaSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  withServiceAcumaticaSession,
}));

vi.mock("@/lib/acumatica", async () => {
  const actual = await vi.importActual<typeof import("@/lib/acumatica")>("@/lib/acumatica");
  return {
    ...actual,
    fetchBusinessAccounts,
    fetchContacts,
  };
});

vi.mock("@/lib/call-analytics/employee-directory", async () => {
  return {
    readCallEmployeeDirectory,
    readCallEmployeeDirectoryMeta,
    syncCallEmployeeDirectory,
  };
});

vi.mock("@/lib/read-model/accounts", () => ({
  readAllAccountRowsFromReadModel,
}));

vi.mock("@/lib/read-model/employees", () => ({
  hasDetailedEmployeeDirectory: (items: Array<{ email?: string | null }>) =>
    items.filter((item) => item.email?.trim()).length >= Math.min(items.length, 25),
  readEmployeeDirectorySnapshot,
}));

function buildContact(input: {
  businessAccountId?: string;
  companyName?: string;
  contactId: number;
  displayName: string;
  email: string;
  id?: string;
  phone?: string | null;
}): Record<string, unknown> {
  return {
    id: input.id ?? `contact-note-${input.contactId}`,
    ContactID: { value: input.contactId },
    DisplayName: { value: input.displayName },
    Email: { value: input.email },
    BusinessAccount: { value: input.businessAccountId ?? "" },
    CompanyName: { value: input.companyName ?? "" },
    ...(input.phone === null
      ? {}
      : { Phone1: { value: input.phone ?? "905-555-0100" } }),
  };
}

function buildEmployee(input: {
  loginName: string;
  contactId?: number | null;
  displayName: string;
  email?: string | null;
  normalizedPhone?: string | null;
}) {
  return {
    loginName: input.loginName,
    contactId: input.contactId ?? null,
    displayName: input.displayName,
    email: input.email ?? "employee@meadowb.com",
    normalizedPhone: input.normalizedPhone ?? "+14374233641",
    callerIdPhone: input.normalizedPhone ?? "+14374233641",
    isActive: true,
    updatedAt: "2026-03-17T00:00:00.000Z",
  };
}

function buildAccount(input: {
  businessAccountId: string;
  companyName: string;
  contacts: Record<string, unknown>[];
  id?: string;
  type?: string;
}): Record<string, unknown> {
  return {
    id: input.id ?? `account-note-${input.businessAccountId}`,
    Type: { value: input.type ?? "Customer" },
    BusinessAccountID: { value: input.businessAccountId },
    Name: { value: input.companyName },
    MainAddress: {
      AddressLine1: { value: "5579 McAdam Road" },
      City: { value: "Mississauga" },
      State: { value: "ON" },
      PostalCode: { value: "L4Z 1N4" },
      Country: { value: "CA" },
    },
    PrimaryContact: input.contacts[0] ?? {},
    Contacts: input.contacts,
  };
}

describe("GET /api/meetings/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: Array.from({ length: 165 }, (_, index) => ({
        id: `E${index + 1}`,
        name: `Employee ${index + 1}`,
      })),
      source: "acumatica_employees",
      updatedAt: "2026-03-17T00:00:00.000Z",
    });
    withServiceAcumaticaSession.mockImplementation(async (_preferredLoginName, operation) =>
      operation("service-cookie", { value: null }),
    );
  });

  it("returns a MeadowBrook-inclusive contact directory and filters vendors", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([
      {
        id: "row-1",
        accountRecordId: "record-1",
        businessAccountId: "BA0001",
        companyName: "MeadowBrook Operations",
        address: "5579 McAdam Road, Mississauga, ON, CA",
        addressLine1: "5579 McAdam Road",
        addressLine2: "",
        city: "Mississauga",
        state: "ON",
        postalCode: "L4Z 1N4",
        country: "CA",
        phoneNumber: null,
        salesRepId: null,
        salesRepName: null,
        industryType: null,
        subCategory: null,
        companyRegion: null,
        week: null,
        primaryContactName: "Internal Ops",
        primaryContactPhone: null,
        primaryContactEmail: "internal.ops@meadowb.com",
        primaryContactId: 1001,
        category: null,
        notes: null,
        lastModifiedIso: null,
      },
      {
        id: "row-2",
        accountRecordId: "record-2",
        businessAccountId: "BA0002",
        companyName: "Alpha Foods",
        address: "1 Alpha Way, Toronto, ON, CA",
        addressLine1: "1 Alpha Way",
        addressLine2: "",
        city: "Toronto",
        state: "ON",
        postalCode: "M5V 1A1",
        country: "CA",
        phoneNumber: null,
        salesRepId: null,
        salesRepName: null,
        industryType: null,
        subCategory: null,
        companyRegion: null,
        week: null,
        primaryContactName: "Amy Vega",
        primaryContactPhone: "905-555-0100",
        primaryContactEmail: "amy.vega@alphafoods.com",
        primaryContactId: 1002,
        category: null,
        notes: null,
        lastModifiedIso: null,
      },
    ]);
    syncCallEmployeeDirectory.mockResolvedValue([
      buildEmployee({
        loginName: "internal.ops",
        contactId: 1001,
        displayName: "Internal Ops",
        email: "internal.ops@meadowb.com",
      }),
      buildEmployee({
        loginName: "sdoal",
        contactId: 1004,
        displayName: "Simon MeadowBrook",
        email: "simon@meadowb.com",
      }),
    ]);

    const { GET } = await import("@/app/api/meetings/options/route");

    const response = await GET(new NextRequest("http://localhost/api/meetings/options"));
    const payload = (await response.json()) as {
      accounts: Array<{ businessAccountId: string }>;
      employees: Array<{ contactId: number | null; email: string; employeeName: string }>;
      contacts: Array<{ companyName: string | null; contactId: number; isInternal: boolean }>;
      defaultTimeZone: string;
    };

    expect(response.status).toBe(200);
    expect(payload.defaultTimeZone).toBe("America/Toronto");
    expect(payload.accounts.map((account) => account.businessAccountId)).toEqual([
      "BA0002",
      "BA0001",
    ]);
    expect(payload.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contactId: 1001,
          companyName: "MeadowBrook Operations",
          isInternal: true,
        }),
        expect.objectContaining({
          contactId: 1004,
          companyName: "MeadowBrook Internal",
          isInternal: true,
        }),
        expect.objectContaining({
          contactId: 1002,
          companyName: "Alpha Foods",
          isInternal: false,
        }),
      ]),
    );
    expect(payload.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contactId: 1001,
          employeeName: "Internal Ops",
          email: "internal.ops@meadowb.com",
        }),
        expect.objectContaining({
          contactId: 1004,
          employeeName: "Simon MeadowBrook",
          email: "simon@meadowb.com",
        }),
      ]),
    );
    expect(payload.contacts.some((contact) => contact.contactId === 1003)).toBe(false);
    expect(fetchBusinessAccounts).not.toHaveBeenCalled();
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(withServiceAcumaticaSession).toHaveBeenCalledTimes(1);
    expect(syncCallEmployeeDirectory).toHaveBeenCalledWith(
      "service-cookie",
      expect.any(Object),
    );
  });

  it("returns employees directly from the rich cached employee directory", async () => {
    readEmployeeDirectorySnapshot.mockReturnValue({
      items: Array.from({ length: 30 }, (_, index) => ({
        id: `E${index + 1}`,
        name: `Employee ${index + 1}`,
        loginName: `employee${index + 1}`,
        email: `employee${index + 1}@meadowb.com`,
        contactId: index + 1,
      })),
      source: "acumatica_employees",
      updatedAt: "2026-03-17T00:00:00.000Z",
    });
    fetchBusinessAccounts.mockResolvedValue([
      buildAccount({
        businessAccountId: "BA0002",
        companyName: "Alpha Foods",
        contacts: [],
      }),
    ]);
    fetchContacts.mockResolvedValue([]);

    const { GET } = await import("@/app/api/meetings/options/route");
    const response = await GET(new NextRequest("http://localhost/api/meetings/options"));
    const payload = (await response.json()) as {
      employees: Array<{ employeeName: string; email: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeName: "Employee 1",
          email: "employee1@meadowb.com",
        }),
        expect.objectContaining({
          employeeName: "Employee 30",
          email: "employee30@meadowb.com",
        }),
      ]),
    );
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
    expect(withServiceAcumaticaSession).not.toHaveBeenCalled();
  });
});
