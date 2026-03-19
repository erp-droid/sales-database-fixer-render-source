import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createActivity = vi.fn();
const fetchBusinessAccountById = vi.fn();
const fetchContactById = vi.fn();

vi.mock("@/lib/acumatica", () => ({
  createActivity,
  fetchBusinessAccountById,
  fetchContactById,
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

describe("repairMailActivitySync", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createActivity.mockReset();
    fetchBusinessAccountById.mockReset();
    fetchContactById.mockReset();
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("repairs a failed upstream sync by writing a contact-linked Acumatica email activity", async () => {
    fetchContactById.mockResolvedValue({
      id: "21b3b035-a7ef-f011-8370-025dbe72350a",
      NoteID: { value: "21b3b035-a7ef-f011-8370-025dbe72350a" },
    });
    createActivity.mockResolvedValue({
      id: "f639c4a9-581d-f111-8372-025dbe72350a",
      NoteID: { value: "f639c4a9-581d-f111-8372-025dbe72350a" },
    });

    const { repairMailActivitySync } = await import("@/lib/mail-activity-sync");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie",
      },
    });

    const result = await repairMailActivitySync(
      request,
      {
        subject: "Sender match verification",
        htmlBody: "<p>Hello Jorge</p>",
        textBody: "Hello Jorge",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: {
          contactId: null,
          businessAccountRecordId: null,
          businessAccountId: null,
          contactName: null,
          companyName: null,
        },
        matchedContacts: [
          {
            contactId: 157497,
            businessAccountRecordId: null,
            businessAccountId: "02670D2595",
            contactName: "Jorge Serrano",
            companyName: "MeadowBrook Construction - Internal",
            email: "jserrano@meadowb.com",
          },
        ],
        attachments: [],
        sourceSurface: "accounts",
      },
      {
        logged: true,
        threadId: "thread-1",
        messageId: "message-1",
        activitySyncStatus: "failed",
        activityError: "Contact 157497: Acumatica request failed (400): The request is invalid.",
      },
    );

    expect(fetchContactById).toHaveBeenCalledWith(
      "session-cookie",
      157497,
      undefined,
    );
    expect(createActivity).toHaveBeenCalledWith(
      "session-cookie",
      expect.objectContaining({
        summary: "Sender match verification",
        relatedEntityNoteId: "21b3b035-a7ef-f011-8370-025dbe72350a",
        relatedEntityType: "PX.Objects.CR.Contact",
        type: "M",
        status: "Completed",
      }),
      undefined,
    );
    expect(result).toMatchObject({
      activitySyncStatus: "synced",
      activityId: "f639c4a9-581d-f111-8372-025dbe72350a",
      activityIds: ["f639c4a9-581d-f111-8372-025dbe72350a"],
      activityError: null,
    });
  });

  it("falls back to the business account record when contact lookup cannot resolve a contact note id", async () => {
    fetchContactById.mockRejectedValue(new Error("not found"));
    createActivity.mockResolvedValue({
      id: "fa39c4a9-581d-f111-8372-025dbe72350a",
      NoteID: { value: "fa39c4a9-581d-f111-8372-025dbe72350a" },
    });

    const { repairMailActivitySync } = await import("@/lib/mail-activity-sync");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie",
      },
    });

    const result = await repairMailActivitySync(
      request,
      {
        subject: "Account fallback verification",
        htmlBody: "<p>Hello account</p>",
        textBody: "Hello account",
        to: [
          {
            email: "jserrano@meadowb.com",
            name: "Jorge Serrano",
            contactId: 157497,
            businessAccountRecordId: "c65accd4-7ded-f011-8370-025dbe72350a",
            businessAccountId: "02670D2595",
          },
        ],
        cc: [],
        bcc: [],
        linkedContact: {
          contactId: 157497,
          businessAccountRecordId: "c65accd4-7ded-f011-8370-025dbe72350a",
          businessAccountId: "02670D2595",
          contactName: "Jorge Serrano",
          companyName: "MeadowBrook Construction - Internal",
        },
        matchedContacts: [
          {
            contactId: 157497,
            businessAccountRecordId: "c65accd4-7ded-f011-8370-025dbe72350a",
            businessAccountId: "02670D2595",
            contactName: "Jorge Serrano",
            companyName: "MeadowBrook Construction - Internal",
            email: "jserrano@meadowb.com",
          },
        ],
        attachments: [],
        sourceSurface: "accounts",
      },
      {
        sent: true,
        threadId: "thread-2",
        messageId: "message-2",
        activitySyncStatus: "failed",
        activityError: "Acumatica request failed",
      },
    );

    expect(createActivity).toHaveBeenCalledWith(
      "session-cookie",
      expect.objectContaining({
        relatedEntityNoteId: "c65accd4-7ded-f011-8370-025dbe72350a",
        relatedEntityType: "PX.Objects.CR.BAccount",
      }),
      undefined,
    );
    expect(result).toMatchObject({
      activitySyncStatus: "synced",
      activityId: "fa39c4a9-581d-f111-8372-025dbe72350a",
    });
  });

  it("does not write a duplicate activity when the upstream payload is already synced", async () => {
    const { repairMailActivitySync } = await import("@/lib/mail-activity-sync");
    const request = new NextRequest("http://localhost/api/mail/messages/send", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie",
      },
    });

    const payload = {
      sent: true,
      activitySyncStatus: "synced",
      activityId: "existing-activity",
      threadId: "thread-3",
      messageId: "message-3",
    };

    const result = await repairMailActivitySync(
      request,
      {
        subject: "Already synced",
        htmlBody: "<p>Hello</p>",
        textBody: "Hello",
        to: [],
        cc: [],
        bcc: [],
        linkedContact: {
          contactId: 157497,
          businessAccountRecordId: "c65accd4-7ded-f011-8370-025dbe72350a",
          businessAccountId: "02670D2595",
          contactName: "Jorge Serrano",
          companyName: "MeadowBrook Construction - Internal",
        },
        attachments: [],
        sourceSurface: "accounts",
      },
      payload,
    );

    expect(createActivity).not.toHaveBeenCalled();
    expect(result).toBe(payload);
  });
});
