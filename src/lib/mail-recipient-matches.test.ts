import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findContactsByEmailSubstring = vi.fn();
const filterSuppressedBusinessAccountRows = vi.fn();
const readAllAccountRowsFromReadModel = vi.fn();

vi.mock("@/lib/acumatica", () => ({
  findContactsByEmailSubstring,
  readWrappedNumber: (record: Record<string, unknown> | null | undefined, key: string) => {
    if (!record || typeof record !== "object") {
      return null;
    }

    const field = record[key];
    if (!field || typeof field !== "object" || !("value" in field)) {
      return null;
    }

    const numeric = Number((field as { value?: unknown }).value);
    return Number.isFinite(numeric) ? numeric : null;
  },
  readWrappedString: (record: Record<string, unknown> | null | undefined, key: string) => {
    if (!record || typeof record !== "object") {
      return "";
    }

    const field = record[key];
    if (!field || typeof field !== "object" || !("value" in field)) {
      return "";
    }

    const value = (field as { value?: unknown }).value;
    return typeof value === "string" ? value.trim() : "";
  },
}));

vi.mock("@/lib/business-accounts", () => ({
  filterSuppressedBusinessAccountRows,
}));

vi.mock("@/lib/read-model/accounts", () => ({
  readAllAccountRowsFromReadModel,
}));

describe("attachMatchedContactsToMailPayload", () => {
  beforeEach(() => {
    vi.resetModules();
    findContactsByEmailSubstring.mockReset();
    filterSuppressedBusinessAccountRows.mockReset();
    readAllAccountRowsFromReadModel.mockReset();

    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
  });

  it("hydrates matched recipients and builds activity targets from To recipients only", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    findContactsByEmailSubstring.mockImplementation(async (_cookieValue, email: string) => {
      if (email === "alex@alpha.com") {
        return [
          {
            ContactID: { value: 101 },
            DisplayName: { value: "Alex Alpha" },
            CompanyName: { value: "Alpha Construction" },
            BusinessAccountID: { value: "BA-1" },
            Email: { value: "alex@alpha.com" },
          },
        ];
      }

      if (email === "bianca@bravo.com") {
        return [
          {
            ContactID: { value: 202 },
            DisplayName: { value: "Bianca Bravo" },
            CompanyName: { value: "Bravo Mechanical" },
            BusinessAccountID: { value: "BA-2" },
            Email: { value: "bianca@bravo.com" },
          },
        ];
      }

      return [];
    });
    filterSuppressedBusinessAccountRows.mockImplementation((rows) => rows);

    const { attachMatchedContactsToMailPayload } = await import("@/lib/mail-recipient-matches");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie",
      },
    });

    const result = await attachMatchedContactsToMailPayload(request, {
      subject: "Test",
      htmlBody: "<p>Hello</p>",
      textBody: "Hello",
      to: [
        {
          email: "alex@alpha.com",
          name: null,
          contactId: null,
          businessAccountRecordId: null,
          businessAccountId: null,
        },
      ],
      cc: [
        {
          email: "bianca@bravo.com",
          name: null,
          contactId: null,
          businessAccountRecordId: null,
          businessAccountId: null,
        },
      ],
      bcc: [],
      linkedContact: {
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null,
        contactName: null,
        companyName: null,
      },
      attachments: [],
      sourceSurface: "mail",
    });

    expect(findContactsByEmailSubstring).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      to: [
        {
          email: "alex@alpha.com",
          name: "Alex Alpha",
          contactId: 101,
          businessAccountRecordId: null,
          businessAccountId: "BA-1",
        },
      ],
      cc: [
        {
          email: "bianca@bravo.com",
          name: "Bianca Bravo",
          contactId: 202,
          businessAccountRecordId: null,
          businessAccountId: "BA-2",
        },
      ],
      linkedContact: {
        contactId: 101,
        businessAccountRecordId: null,
        businessAccountId: "BA-1",
        contactName: "Alex Alpha",
        companyName: "Alpha Construction",
      },
      matchedContacts: [
        {
          contactId: 101,
          businessAccountRecordId: null,
          businessAccountId: "BA-1",
          contactName: "Alex Alpha",
          companyName: "Alpha Construction",
          email: "alex@alpha.com",
        },
      ],
    });
  });

  it("keeps manually selected Acumatica recipients without reloading all accounts", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    filterSuppressedBusinessAccountRows.mockImplementation((rows) => rows);

    const { attachMatchedContactsToMailPayload } = await import("@/lib/mail-recipient-matches");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie",
      },
    });

    const result = await attachMatchedContactsToMailPayload(request, {
      subject: "Test",
      htmlBody: "<p>Hello</p>",
      textBody: "Hello",
      to: [
        {
          email: "known@example.com",
          name: "Known Contact",
          contactId: 404,
          businessAccountRecordId: "BA-404",
          businessAccountId: "BA-404",
        },
      ],
      cc: [],
      bcc: [],
      linkedContact: {
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null,
        contactName: null,
        companyName: null,
      },
      attachments: [],
      sourceSurface: "mail",
    });

    expect(findContactsByEmailSubstring).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      matchedContacts: [
        {
          contactId: 404,
          businessAccountRecordId: "BA-404",
          businessAccountId: "BA-404",
          contactName: "Known Contact",
          companyName: null,
          email: "known@example.com",
        },
      ],
      linkedContact: {
        contactId: 404,
        businessAccountRecordId: "BA-404",
        businessAccountId: "BA-404",
        contactName: "Known Contact",
        companyName: null,
      },
    });
  });

  it("hydrates unresolved recipients from the read model before live Acumatica fallback", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([
      {
        accountRecordId: "BA-3",
        id: "BA-3",
        businessAccountId: "BA-3",
        companyName: "Charlie Electric",
        primaryContactName: "Casey Charlie",
        primaryContactEmail: "casey@charlie.com",
        contactId: 303,
      },
    ]);
    filterSuppressedBusinessAccountRows.mockImplementation((rows) => rows);

    const { attachMatchedContactsToMailPayload } = await import("@/lib/mail-recipient-matches");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie",
      },
    });

    const result = await attachMatchedContactsToMailPayload(request, {
      subject: "Test",
      htmlBody: "<p>Hello</p>",
      textBody: "Hello",
      to: [
        {
          email: "casey@charlie.com",
          name: null,
          contactId: null,
          businessAccountRecordId: null,
          businessAccountId: null,
        },
      ],
      cc: [],
      bcc: [],
      linkedContact: {
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null,
        contactName: null,
        companyName: null,
      },
      attachments: [],
      sourceSurface: "mail",
    });

    expect(findContactsByEmailSubstring).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      to: [
        {
          email: "casey@charlie.com",
          name: "Casey Charlie",
          contactId: 303,
          businessAccountRecordId: "BA-3",
          businessAccountId: "BA-3",
        },
      ],
      matchedContacts: [
        {
          contactId: 303,
          businessAccountRecordId: "BA-3",
          businessAccountId: "BA-3",
          contactName: "Casey Charlie",
          companyName: "Charlie Electric",
          email: "casey@charlie.com",
        },
      ],
    });
  });

  it("uses a targeted live contact lookup instead of loading all accounts", async () => {
    readAllAccountRowsFromReadModel.mockReturnValue([]);
    filterSuppressedBusinessAccountRows.mockImplementation((rows) => rows);
    findContactsByEmailSubstring.mockResolvedValue([
      {
        ContactID: { value: 909 },
        DisplayName: { value: "Jordan Delta" },
        CompanyName: { value: "Delta Roofing" },
        BusinessAccountID: { value: "BA-909" },
        Email: { value: "jordan@delta.com" },
      },
    ]);

    const { attachMatchedContactsToMailPayload } = await import("@/lib/mail-recipient-matches");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie",
      },
    });

    const result = await attachMatchedContactsToMailPayload(request, {
      subject: "Test",
      htmlBody: "<p>Hello</p>",
      textBody: "Hello",
      to: [
        {
          email: "jordan@delta.com",
          name: null,
          contactId: null,
          businessAccountRecordId: null,
          businessAccountId: null,
        },
      ],
      cc: [],
      bcc: [],
      linkedContact: {
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null,
        contactName: null,
        companyName: null,
      },
      attachments: [],
      sourceSurface: "mail",
    });

    expect(findContactsByEmailSubstring).toHaveBeenCalledWith(
      "session-cookie",
      "jordan@delta.com",
      undefined,
    );
    expect(result).toMatchObject({
      to: [
        {
          email: "jordan@delta.com",
          name: "Jordan Delta",
          contactId: 909,
          businessAccountId: "BA-909",
        },
      ],
      matchedContacts: [
        {
          contactId: 909,
          businessAccountId: "BA-909",
          contactName: "Jordan Delta",
          companyName: "Delta Roofing",
          email: "jordan@delta.com",
        },
      ],
    });
  });
});
