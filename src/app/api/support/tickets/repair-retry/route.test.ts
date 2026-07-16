import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addSupportTicketEvent: vi.fn(),
  canDispatchTicketCodeRepair: vi.fn(),
  dispatchTicketCodeRepair: vi.fn(),
  readSupportTicket: vi.fn(),
  replyToTicketEmail: vi.fn(),
  updateSupportTicket: vi.fn(),
}));

vi.mock("@/lib/support-ticket-mail", () => ({
  replyToTicketEmail: mocks.replyToTicketEmail,
}));

vi.mock("@/lib/support-ticket-repair", () => ({
  canDispatchTicketCodeRepair: mocks.canDispatchTicketCodeRepair,
  dispatchTicketCodeRepair: mocks.dispatchTicketCodeRepair,
}));

vi.mock("@/lib/support-ticket-store", () => ({
  addSupportTicketEvent: mocks.addSupportTicketEvent,
  readSupportTicket: mocks.readSupportTicket,
  updateSupportTicket: mocks.updateSupportTicket,
}));

import { POST } from "@/app/api/support/tickets/repair-retry/route";

const originalSecret = process.env.TICKET_REPAIR_CALLBACK_SECRET;
const ticketId = "68d256ac-a935-4515-baf7-21d05fd9d4f0";
const repairRunId = "28a1752f-01db-4330-a7dc-98e0800ae731";

function request(secret = "retry-secret") {
  return new NextRequest("https://sales-meadowb.onrender.com/api/support/tickets/repair-retry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ticket-repair-secret": secret,
    },
    body: JSON.stringify({ ticketId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TICKET_REPAIR_CALLBACK_SECRET = "retry-secret";
  const ticket = {
    id: ticketId,
    ticketNumber: 2,
    status: "escalated",
  };
  mocks.readSupportTicket.mockReturnValue(ticket);
  mocks.canDispatchTicketCodeRepair.mockReturnValue(true);
  mocks.dispatchTicketCodeRepair.mockResolvedValue({ repairRunId });
  mocks.replyToTicketEmail.mockResolvedValue({
    threadId: "thread-justin",
    messageId: "message-retry",
  });
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.TICKET_REPAIR_CALLBACK_SECRET;
  } else {
    process.env.TICKET_REPAIR_CALLBACK_SECRET = originalSecret;
  }
});

describe("POST /api/support/tickets/repair-retry", () => {
  it("restarts an eligible ticket and keeps communication on its email thread", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ticketNumber: 2, repairRunId });
    expect(mocks.dispatchTicketCodeRepair).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticketId, ticketNumber: 2 }),
    );
    expect(mocks.replyToTicketEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticketId }),
      expect.objectContaining({ heading: "We are trying the fix again" }),
    );
    expect(mocks.updateSupportTicket).toHaveBeenCalledWith(
      ticketId,
      expect.objectContaining({ status: "repairing", emailMessageId: "message-retry" }),
    );
    expect(mocks.addSupportTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId,
        eventType: "code_repair_update_sent",
        details: expect.objectContaining({ repairRunId, retry: true }),
      }),
    );
  });

  it("rejects a request without the exact repair secret", async () => {
    const response = await POST(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.dispatchTicketCodeRepair).not.toHaveBeenCalled();
  });

  it("rejects duplicate or exhausted repair attempts", async () => {
    mocks.canDispatchTicketCodeRepair.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.dispatchTicketCodeRepair).not.toHaveBeenCalled();
  });
});
