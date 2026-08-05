import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addSupportTicketEvent: vi.fn(),
  getStoredLoginName: vi.fn(),
  isSupportOwner: vi.fn(),
  readSupportTicket: vi.fn(),
  replyToTicketEmail: vi.fn(),
  requireAuthCookieValue: vi.fn(),
  updateSupportTicket: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getStoredLoginName: mocks.getStoredLoginName,
  requireAuthCookieValue: mocks.requireAuthCookieValue,
}));

vi.mock("@/lib/support-ticket-access", () => ({
  isSupportOwner: mocks.isSupportOwner,
}));

vi.mock("@/lib/support-ticket-mail", () => ({
  replyToTicketEmail: mocks.replyToTicketEmail,
}));

vi.mock("@/lib/support-ticket-store", () => ({
  addSupportTicketEvent: mocks.addSupportTicketEvent,
  readSupportTicket: mocks.readSupportTicket,
  updateSupportTicket: mocks.updateSupportTicket,
}));

import { POST } from "@/app/api/support/tickets/[ticketId]/reply/route";

const ticketId = "68d256ac-a935-4515-baf7-21d05fd9d4f0";

function request(message = "The call counter is fixed. Please refresh and try it again.") {
  return new NextRequest(`https://sales-meadowb.onrender.com/api/support/tickets/${ticketId}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

function context() {
  return { params: Promise.resolve({ ticketId }) };
}

function ticket(status = "waiting_for_employee") {
  return {
    id: ticketId,
    ticketNumber: 12,
    status,
    emailThreadId: "thread-12",
    updatedAt: "2026-08-05T14:00:00.000Z",
    latestUpdate: "The support owner replied to the employee.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoredLoginName.mockReturnValue("jserrano");
  mocks.isSupportOwner.mockReturnValue(true);
  mocks.readSupportTicket.mockReturnValue(ticket());
  mocks.replyToTicketEmail.mockResolvedValue({
    sent: true,
    threadId: "thread-12",
    messageId: "message-12",
  });
  mocks.updateSupportTicket.mockReturnValue(ticket());
});

describe("POST /api/support/tickets/[ticketId]/reply", () => {
  it("sends the owner's response on the existing email conversation", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      ticket: { id: ticketId },
      event: { type: "support_owner_reply_sent" },
    });
    expect(mocks.replyToTicketEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticketId, emailThreadId: "thread-12" }),
      {
        heading: "CRM support update",
        paragraphs: ["The call counter is fixed. Please refresh and try it again."],
      },
    );
    expect(mocks.updateSupportTicket).toHaveBeenCalledWith(ticketId, {
      emailMessageId: "message-12",
    });
    expect(mocks.addSupportTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "support_owner_reply_sent",
        actorType: "support_owner",
        details: expect.objectContaining({ sentBy: "jserrano" }),
      }),
    );
  });

  it("rejects employees who are not the support owner", async () => {
    mocks.isSupportOwner.mockReturnValue(false);

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    expect(mocks.replyToTicketEmail).not.toHaveBeenCalled();
  });

  it("rejects an empty response", async () => {
    const response = await POST(request("   "), context());

    expect(response.status).toBe(422);
    expect(mocks.replyToTicketEmail).not.toHaveBeenCalled();
  });

  it("does not reply to a closed ticket", async () => {
    mocks.readSupportTicket.mockReturnValue(ticket("closed"));

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(mocks.replyToTicketEmail).not.toHaveBeenCalled();
  });
});
