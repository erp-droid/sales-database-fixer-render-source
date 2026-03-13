import { ZodError } from "zod";

import {
  collectUnresolvedMailRecipientEmails,
  parseMailComposePayload,
  parseMailLinkContactPayload,
  parseMailThreadsQuery,
} from "@/lib/mail-validation";

describe("mail validation", () => {
  it("rejects compose payloads without any recipients", () => {
    expect(() =>
      parseMailComposePayload({
        subject: "Hello",
        htmlBody: "<div>Hello</div>",
        textBody: "Hello",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: {},
      }),
    ).toThrow(ZodError);
  });

  it("rejects compose payloads without subject or body", () => {
    expect(() =>
      parseMailComposePayload({
        subject: "",
        htmlBody: "",
        textBody: "",
        to: [{ email: "contact@example.com" }],
        linkedContact: {},
      }),
    ).toThrow(ZodError);
  });

  it("rejects partially linked accounts", () => {
    expect(() =>
      parseMailComposePayload({
        subject: "Hello",
        htmlBody: "<div>Hello</div>",
        textBody: "Hello",
        to: [{ email: "contact@example.com" }],
        linkedContact: {
          contactId: 42,
          businessAccountRecordId: "record-1",
          businessAccountId: null,
        },
      }),
    ).toThrow(ZodError);
  });

  it("accepts and normalizes a valid compose payload", () => {
    const parsed = parseMailComposePayload({
      threadId: " thread-1 ",
      draftId: "",
      subject: " Hello ",
      htmlBody: "<div>Hello</div>",
      textBody: "Hello",
      to: [
        {
          email: "CONTACT@Example.com",
          name: " Jane Doe ",
          contactId: "12",
          businessAccountRecordId: " record-1 ",
          businessAccountId: " B0001 ",
        },
      ],
      linkedContact: {
        contactId: "12",
        businessAccountRecordId: " record-1 ",
        businessAccountId: " B0001 ",
        contactName: " Jane Doe ",
        companyName: " Alpha Inc ",
      },
      attachments: [
        {
          fileName: " proposal.pdf ",
          mimeType: "application/pdf",
          sizeBytes: 12,
          base64Data: "YQ==",
        },
      ],
    });

    expect(parsed.threadId).toBe("thread-1");
    expect(parsed.draftId).toBeNull();
    expect(parsed.subject).toBe("Hello");
    expect(parsed.to[0]).toEqual({
      email: "CONTACT@Example.com",
      name: "Jane Doe",
      contactId: 12,
      businessAccountRecordId: "record-1",
      businessAccountId: "B0001",
    });
    expect(parsed.linkedContact).toEqual({
      contactId: 12,
      businessAccountRecordId: "record-1",
      businessAccountId: "B0001",
      contactName: "Jane Doe",
      companyName: "Alpha Inc",
    });
    expect(parsed.attachments[0]?.fileName).toBe("proposal.pdf");
  });

  it("parses link-contact payloads", () => {
    expect(
      parseMailLinkContactPayload({
        contactId: "157497",
        businessAccountRecordId: "record-1",
        businessAccountId: "B0001",
      }),
    ).toEqual({
      contactId: 157497,
      businessAccountRecordId: "record-1",
      businessAccountId: "B0001",
    });
  });

  it("uses defaults for thread list queries", () => {
    expect(parseMailThreadsQuery(new URLSearchParams())).toEqual({
      folder: "inbox",
      limit: 25,
    });
  });

  it("detects unresolved recipients after Acumatica matching", () => {
    expect(
      collectUnresolvedMailRecipientEmails({
        to: [
          {
            email: "known@example.com",
            name: null,
            contactId: 12,
            businessAccountRecordId: "record-1",
            businessAccountId: "B0001",
          },
        ],
        cc: [
          {
            email: "unknown@example.com",
            name: null,
            contactId: null,
            businessAccountRecordId: null,
            businessAccountId: null,
          },
        ],
        bcc: [],
        matchedContacts: [
          {
            contactId: 12,
            businessAccountRecordId: "record-1",
            businessAccountId: "B0001",
            contactName: "Known Contact",
            companyName: "Alpha Inc",
            email: "known@example.com",
          },
        ],
      }),
    ).toEqual(["unknown@example.com"]);
  });
});
