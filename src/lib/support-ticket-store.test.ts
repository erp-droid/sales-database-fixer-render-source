import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("support ticket reply evidence", () => {
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), "support-ticket-evidence-test-"));
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
  });

  afterEach(() => {
    closeDb?.();
    closeDb = null;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores reply pictures once and keeps their source separate from the original report", async () => {
    const { getReadModelDb } = await import("@/lib/read-model/db");
    const {
      createSupportTicket,
      listSupportTicketAttachments,
      readSupportTicketAttachment,
      storeSupportTicketReplyAttachments,
    } = await import("@/lib/support-ticket-store");
    closeDb = () => getReadModelDb().close();

    const ticket = createSupportTicket({
      title: "Dashboard email count is missing",
      category: "mail",
      impact: "major",
      employeeName: "Krishna Pareek",
      employeeEmail: "kpareek@meadowb.com",
      description: "I sent an email but do not see my activity.",
      submittedByLogin: "kpareek",
      attachments: [{ fileName: "original.png", mimeType: "image/png", data: Buffer.from("original") }],
    });
    const replyInput = {
      fileName: "dashboard.png",
      mimeType: "image/png",
      data: Buffer.from("reply-picture"),
      sourceMessageId: "gmail-message-1",
      sourceAttachmentId: "gmail-attachment-1",
    };

    expect(storeSupportTicketReplyAttachments(ticket.id, [replyInput])).toHaveLength(1);
    expect(storeSupportTicketReplyAttachments(ticket.id, [replyInput])).toHaveLength(0);

    const attachments = listSupportTicketAttachments(ticket.id);
    expect(attachments.map(({ fileName, sourceType }) => ({ fileName, sourceType }))).toEqual([
      { fileName: "original.png", sourceType: "submission" },
      { fileName: "dashboard.png", sourceType: "email_reply" },
    ]);
    expect(readSupportTicketAttachment(attachments[1]!)).toEqual(Buffer.from("reply-picture"));
  });
});
