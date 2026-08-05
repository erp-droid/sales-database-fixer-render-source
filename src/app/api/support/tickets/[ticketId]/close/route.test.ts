import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addSupportTicketEvent: vi.fn(),
  getStoredLoginName: vi.fn(),
  isSupportOwner: vi.fn(),
  readSupportTicket: vi.fn(),
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

vi.mock("@/lib/support-ticket-store", () => ({
  addSupportTicketEvent: mocks.addSupportTicketEvent,
  readSupportTicket: mocks.readSupportTicket,
  updateSupportTicket: mocks.updateSupportTicket,
}));

import { POST } from "@/app/api/support/tickets/[ticketId]/close/route";

const ticketId = "68d256ac-a935-4515-baf7-21d05fd9d4f0";

function request() {
  return new NextRequest(`https://sales-meadowb.onrender.com/api/support/tickets/${ticketId}/close`, {
    method: "POST",
  });
}

function context() {
  return { params: Promise.resolve({ ticketId }) };
}

function ticket(status: "investigating" | "closed") {
  return {
    id: ticketId,
    ticketNumber: 12,
    status,
    updatedAt: "2026-08-05T14:00:00.000Z",
    latestUpdate: status === "closed" ? "Ticket closed manually by the support owner." : "Investigating.",
    nextAction: status === "closed" ? null : "Continue investigating.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoredLoginName.mockReturnValue("jserrano");
  mocks.isSupportOwner.mockReturnValue(true);
});

describe("POST /api/support/tickets/[ticketId]/close", () => {
  it("lets the support owner close a ticket and records the action", async () => {
    mocks.readSupportTicket
      .mockReturnValueOnce(ticket("investigating"))
      .mockReturnValueOnce(ticket("closed"));
    mocks.updateSupportTicket.mockReturnValue(ticket("closed"));

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      alreadyClosed: false,
      ticket: { id: ticketId, status: "closed", nextAction: null },
      event: { type: "closed_by_support_owner" },
    });
    expect(mocks.updateSupportTicket).toHaveBeenCalledWith(ticketId, {
      status: "closed",
      processingStartedAt: null,
      nextCheckAt: null,
      nextAction: null,
    });
    expect(mocks.addSupportTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId,
        eventType: "closed_by_support_owner",
        actorType: "support_owner",
        details: { closedBy: "jserrano" },
      }),
    );
  });

  it("is idempotent when the ticket is already closed", async () => {
    mocks.readSupportTicket.mockReturnValue(ticket("closed"));

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, alreadyClosed: true });
    expect(mocks.updateSupportTicket).not.toHaveBeenCalled();
    expect(mocks.addSupportTicketEvent).not.toHaveBeenCalled();
  });

  it("rejects employees who are not the support owner", async () => {
    mocks.getStoredLoginName.mockReturnValue("kpareek");
    mocks.isSupportOwner.mockReturnValue(false);

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    expect(mocks.readSupportTicket).not.toHaveBeenCalled();
    expect(mocks.updateSupportTicket).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown ticket", async () => {
    mocks.readSupportTicket.mockReturnValue(null);

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.updateSupportTicket).not.toHaveBeenCalled();
  });
});
