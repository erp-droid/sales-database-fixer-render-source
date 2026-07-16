import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addSupportTicketEvent: vi.fn(),
  findTicketRepairDispatch: vi.fn(),
  listSupportTicketEvents: vi.fn(),
  readSupportTicket: vi.fn(),
  replyToTicketEmail: vi.fn(),
  updateSupportTicket: vi.fn(),
}));

vi.mock("@/lib/support-ticket-mail", () => ({
  replyToTicketEmail: mocks.replyToTicketEmail,
}));

vi.mock("@/lib/support-ticket-repair", () => ({
  findTicketRepairDispatch: mocks.findTicketRepairDispatch,
}));

vi.mock("@/lib/support-ticket-repair-auth", () => ({
  requireTicketRepairSecret: vi.fn(),
}));

vi.mock("@/lib/support-ticket-store", () => ({
  addSupportTicketEvent: mocks.addSupportTicketEvent,
  listSupportTicketEvents: mocks.listSupportTicketEvents,
  readSupportTicket: mocks.readSupportTicket,
  updateSupportTicket: mocks.updateSupportTicket,
}));

import { POST } from "@/app/api/support/tickets/repair-callback/route";

const ticketId = "68d256ac-a935-4515-baf7-21d05fd9d4f0";
const repairRunId = "b0b0f4aa-a6cd-49c7-86b9-4b0917c6f817";

function request(status: "deployed" | "failed") {
  return new NextRequest("https://sales-meadowb.onrender.com/api/support/tickets/repair-callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticketId,
      repairRunId,
      status,
      commitSha: status === "deployed" ? "a".repeat(40) : "",
      summary: status === "deployed" ? "Verified repair deployed." : "Repair stopped safely.",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTicketRepairDispatch.mockReturnValue({ id: "dispatch-event" });
  mocks.listSupportTicketEvents.mockReturnValue([]);
  mocks.readSupportTicket.mockReturnValue({
    id: ticketId,
    ticketNumber: 2,
    emailThreadId: "thread-justin",
  });
  mocks.replyToTicketEmail.mockResolvedValue({
    threadId: "thread-justin",
    messageId: "message-fixed",
  });
});

describe("POST /api/support/tickets/repair-callback", () => {
  it("allows a corrected rerun to replace an earlier failed callback with deployment", async () => {
    mocks.listSupportTicketEvents.mockReturnValue([
      {
        eventType: "code_repair_failed",
        details: { repairRunId },
      },
    ]);

    const response = await POST(request("deployed"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.replyToTicketEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticketId }),
      expect.objectContaining({ heading: "The fix is ready" }),
    );
    expect(mocks.addSupportTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "code_repair_deployed" }),
    );
  });

  it("keeps duplicate failure callbacks idempotent", async () => {
    mocks.listSupportTicketEvents.mockReturnValue([
      {
        eventType: "code_repair_failed",
        details: { repairRunId },
      },
    ]);

    const response = await POST(request("failed"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyProcessed: true });
    expect(mocks.replyToTicketEmail).not.toHaveBeenCalled();
  });

  it("never lets a later failure overwrite a deployed result", async () => {
    mocks.listSupportTicketEvents.mockReturnValue([
      {
        eventType: "code_repair_deployed",
        details: { repairRunId },
      },
    ]);

    const response = await POST(request("failed"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyProcessed: true });
    expect(mocks.updateSupportTicket).not.toHaveBeenCalled();
  });
});
