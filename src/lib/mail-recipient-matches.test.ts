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
    readAllAccountRowsFromReadModel.mockReturnValue([
      {
        accountRecordId: "BA-1",
        id: "BA-1",
        businessAccountId: "BA-1",
        companyName: "Alpha Construction",
        primaryContactName: "Alex Alpha",
        primaryContactEmail: "alex@alpha.com",
        contactId: 101,
      },
      {
        accountRecordId: "BA-2",
        id: "BA-2",
        businessAccountId: "BA-2",
        companyName: "Bravo Mechanical",
        primaryContactName: "Bianca Bravo",
        primaryContactEmail: "bianca@bravo.com",
        contactId: 202,
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

    expect(findContactsByEmailSubstring).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      to: [
        {
          email: "alex@alpha.com",
          name: "Alex Alpha",
          contactId: 101,
          businessAccountRecordId: "BA-1",
          businessAccountId: "BA-1",
        },
      ],
      cc: [
        {
          email: "bianca@bravo.com",
          name: "Bianca Bravo",
          contactId: 202,
          businessAccountRecordId: "BA-2",
          businessAccountId: "BA-2",
        },
      ],
      linkedContact: {
        contactId: 101,
        businessAccountRecordId: "BA-1",
        businessAccountId: "BA-1",
        contactName: "Alex Alpha",
        companyName: "Alpha Construction",
      },
      matchedContacts: [
        {
          contactId: 101,
          businessAccountRecordId: "BA-1",
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

  it("preserves unknown recipients without a live Acumatica lookup", async () => {
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

    expect(findContactsByEmailSubstring).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      to: [
        {
          email: "jordan@delta.com",
          name: null,
          contactId: null,
          businessAccountId: null,
        },
      ],
      matchedContacts: [],
      linkedContact: {
        contactId: null,
      },
    });
  });

  it("preserves recipients when the local read model is unavailable", async () => {
    readAllAccountRowsFromReadModel.mockImplementation(() => {
      throw new Error("read model unavailable");
    });
    filterSuppressedBusinessAccountRows.mockImplementation((rows) => rows);

    const { attachMatchedContactsToMailPayload } = await import("@/lib/mail-recipient-matches");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=expired-session-cookie",
      },
    });

    const result = await attachMatchedContactsToMailPayload(request, {
      subject: "Test",
      htmlBody: "<p>Hello</p>",
      textBody: "Hello",
      to: [
        {
          email: "unknown@example.com",
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
      to: [{ email: "unknown@example.com", contactId: null }],
      matchedContacts: [],
    });
  });
});
