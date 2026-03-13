import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "cookie");
const setAuthCookie = vi.fn();
const fetchBusinessAccounts = vi.fn();
const fetchContacts = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", async () => {
  const actual = await vi.importActual<typeof import("@/lib/acumatica")>("@/lib/acumatica");
  return {
    ...actual,
    fetchBusinessAccounts,
    fetchContacts,
  };
});

function buildContact(input: {
  businessAccountId?: string;
  companyName?: string;
  contactId: number;
  displayName: string;
  email: string;
  id?: string;
  phone?: string;
}): Record<string, unknown> {
  return {
    id: input.id ?? `contact-note-${input.contactId}`,
    ContactID: { value: input.contactId },
    DisplayName: { value: input.displayName },
    Email: { value: input.email },
    BusinessAccount: { value: input.businessAccountId ?? "" },
    CompanyName: { value: input.companyName ?? "" },
    Phone1: { value: input.phone ?? "905-555-0100" },
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
  });

  it("returns a MeadowBrook-inclusive contact directory and filters vendors", async () => {
    fetchBusinessAccounts.mockResolvedValue([
      buildAccount({
        businessAccountId: "BA0001",
        companyName: "MeadowBrook Operations",
        contacts: [],
      }),
      buildAccount({
        businessAccountId: "BA0002",
        companyName: "Alpha Foods",
        contacts: [],
      }),
      buildAccount({
        businessAccountId: "VEN0001",
        companyName: "Supply Vendor",
        type: "Vendor",
        contacts: [],
      }),
    ]);
    fetchContacts.mockResolvedValue([
      buildContact({
        businessAccountId: "BA0001",
        companyName: "MeadowBrook Operations",
        contactId: 1001,
        displayName: "Internal Ops",
        email: "internal.ops@meadowb.com",
      }),
      buildContact({
        businessAccountId: "BA0002",
        companyName: "Alpha Foods",
        contactId: 1002,
        displayName: "Amy Vega",
        email: "amy.vega@alphafoods.com",
      }),
      buildContact({
        businessAccountId: "VEN0001",
        companyName: "Supply Vendor",
        contactId: 1003,
        displayName: "Vendor Person",
        email: "vendor@example.com",
      }),
    ]);

    const { GET } = await import("@/app/api/meetings/options/route");

    const response = await GET(new NextRequest("http://localhost/api/meetings/options"));
    const payload = (await response.json()) as {
      accounts: Array<{ businessAccountId: string }>;
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
          contactId: 1002,
          companyName: "Alpha Foods",
          isInternal: false,
        }),
      ]),
    );
    expect(payload.contacts.some((contact) => contact.contactId === 1003)).toBe(false);
  });
});
