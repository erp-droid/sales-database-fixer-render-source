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

import { POST } from "@/app/api/support/tickets/[ticketId]/status/route";

const ticketId = "68d256ac-a935-4515-baf7-21d05fd9d4f0";

function request(status: string) {
  return new NextRequest(`https://sales-meadowb.onrender.com/api/support/tickets/${ticketId}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

function context() {
  return { params: Promise.resolve({ ticketId }) };
}

function ticket(status: string) {
  return {
    id: ticketId,
    ticketNumber: 12,
    status,
    updatedAt: "2026-08-05T14:00:00.000Z",
    latestUpdate: `${status} update`,
    nextAction: status === "resolved" || status === "closed" ? null : "Continue working.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoredLoginName.mockReturnValue("jserrano");
  mocks.isSupportOwner.mockReturnValue(true);
});

describe("POST /api/support/tickets/[ticketId]/status", () => {
  it("moves a ticket to a Pipeline status and records the owner action", async () => {
    mocks.readSupportTicket
      .mockReturnValueOnce(ticket("queued"))
      .mockReturnValueOnce(ticket("waiting_for_employee"));
    mocks.updateSupportTicket.mockReturnValue(ticket("waiting_for_employee"));

    const response = await POST(request("waiting_for_employee"), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      changed: true,
      ticket: { status: "waiting_for_employee" },
      event: { type: "status_changed_by_support_owner" },
    });
    expect(mocks.updateSupportTicket).toHaveBeenCalledWith(ticketId, expect.objectContaining({
      status: "waiting_for_employee",
      processingStartedAt: null,
      nextAction: "Waiting for the employee to respond.",
    }));
    expect(mocks.addSupportTicketEvent).toHaveBeenCalledWith(expect.objectContaining({
      ticketId,
      eventType: "status_changed_by_support_owner",
      actorType: "support_owner",
      details: expect.objectContaining({
        changedBy: "jserrano",
        fromStatus: "queued",
        toStatus: "waiting_for_employee",
      }),
    }));
  });

  it("does not write when the ticket is already in the destination status", async () => {
    mocks.readSupportTicket.mockReturnValue(ticket("investigating"));

    const response = await POST(request("investigating"), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, changed: false, event: null });
    expect(mocks.updateSupportTicket).not.toHaveBeenCalled();
    expect(mocks.addSupportTicketEvent).not.toHaveBeenCalled();
  });

  it("keeps closed tickets terminal", async () => {
    mocks.readSupportTicket.mockReturnValue(ticket("closed"));

    const response = await POST(request("queued"), context());

    expect(response.status).toBe(409);
    expect(mocks.updateSupportTicket).not.toHaveBeenCalled();
  });

  it("rejects employees who are not the support owner", async () => {
    mocks.getStoredLoginName.mockReturnValue("kpareek");
    mocks.isSupportOwner.mockReturnValue(false);

    const response = await POST(request("resolved"), context());

    expect(response.status).toBe(403);
    expect(mocks.readSupportTicket).not.toHaveBeenCalled();
  });

  it("rejects a status that is not a Pipeline destination", async () => {
    const response = await POST(request("repairing"), context());

    expect(response.status).toBe(422);
    expect(mocks.readSupportTicket).not.toHaveBeenCalled();
  });
});
