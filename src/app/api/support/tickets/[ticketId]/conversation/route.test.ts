import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  canViewSupportTicketMock,
  getStoredLoginNameMock,
  readSupportTicketMock,
  readTicketEmailThreadMock,
  requireAuthCookieValueMock,
} = vi.hoisted(() => ({
  canViewSupportTicketMock: vi.fn(),
  getStoredLoginNameMock: vi.fn(),
  readSupportTicketMock: vi.fn(),
  readTicketEmailThreadMock: vi.fn(),
  requireAuthCookieValueMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getStoredLoginName: getStoredLoginNameMock,
  requireAuthCookieValue: requireAuthCookieValueMock,
}));

vi.mock("@/lib/support-ticket-access", () => ({
  canViewSupportTicket: canViewSupportTicketMock,
}));

vi.mock("@/lib/support-ticket-mail", () => ({
  readTicketEmailThread: readTicketEmailThreadMock,
}));

vi.mock("@/lib/support-ticket-store", () => ({
  readSupportTicket: readSupportTicketMock,
}));

function request() {
  return new NextRequest("http://localhost/api/support/tickets/ticket-1/conversation");
}

function context() {
  return { params: Promise.resolve({ ticketId: "ticket-1" }) };
}

describe("GET /api/support/tickets/[ticketId]/conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStoredLoginNameMock.mockReturnValue("jserrano");
    readSupportTicketMock.mockReturnValue({
      id: "ticket-1",
      title: "CRM ticket",
      submittedByLogin: "kpareek",
      emailThreadId: "thread-1",
    });
    canViewSupportTicketMock.mockReturnValue(true);
  });

  it("returns every thread message in chronological order with safe plain text", async () => {
    readTicketEmailThreadMock.mockResolvedValue({
      thread: { subject: "[CRM-0001] CRM ticket" },
      messages: [
        {
          messageId: "message-2",
          direction: "incoming",
          subject: "Re: CRM ticket",
          htmlBody: "",
          textBody: "Employee follow-up",
          from: { name: "Krishna", email: "krishna@example.com" },
          to: [{ name: "Support", email: "support@example.com" }],
          sentAt: null,
          receivedAt: "2026-08-05T12:00:00.000Z",
          hasAttachments: true,
        },
        {
          messageId: "message-1",
          direction: "outgoing",
          subject: "CRM ticket",
          htmlBody: "<p>Support &amp; update</p><p>Second line</p>",
          textBody: "",
          from: { name: "Support", email: "support@example.com" },
          to: [{ name: "Krishna", email: "krishna@example.com" }],
          sentAt: "2026-08-05T11:00:00.000Z",
          receivedAt: null,
          hasAttachments: false,
        },
      ],
    });

    const { GET } = await import("@/app/api/support/tickets/[ticketId]/conversation/route");
    const response = await GET(request(), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload.items.map((item: { id: string }) => item.id)).toEqual(["message-1", "message-2"]);
    expect(payload.items[0].body).toBe("Support & update\n\nSecond line");
    expect(payload.items[1]).toMatchObject({
      body: "Employee follow-up",
      direction: "incoming",
      hasAttachments: true,
    });
  });

  it("does not disclose another employee's ticket", async () => {
    canViewSupportTicketMock.mockReturnValue(false);

    const { GET } = await import("@/app/api/support/tickets/[ticketId]/conversation/route");
    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(readTicketEmailThreadMock).not.toHaveBeenCalled();
  });

  it("reports that the conversation is not ready before the email thread exists", async () => {
    readSupportTicketMock.mockReturnValue({
      id: "ticket-1",
      title: "CRM ticket",
      submittedByLogin: "jserrano",
      emailThreadId: null,
    });

    const { GET } = await import("@/app/api/support/tickets/[ticketId]/conversation/route");
    const response = await GET(request(), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ available: false, subject: null, items: [] });
    expect(readTicketEmailThreadMock).not.toHaveBeenCalled();
  });
});
