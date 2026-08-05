export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { isSupportOwner } from "@/lib/support-ticket-access";
import { replyToTicketEmail } from "@/lib/support-ticket-mail";
import {
  addSupportTicketEvent,
  readSupportTicket,
  updateSupportTicket,
} from "@/lib/support-ticket-store";
import type { SupportTicketReplyResponse } from "@/types/support-ticket";

type RouteContext = {
  params: Promise<{ ticketId: string }>;
};

const replySchema = z.object({
  message: z.string().trim().min(1, "Write a response before sending.").max(5000),
});

const EVENT_TYPE = "support_owner_reply_sent" as const;
const EVENT_MESSAGE = "The support owner replied to the employee.";

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request)?.trim().toLowerCase();
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable.");
    }
    if (!isSupportOwner(loginName)) {
      throw new HttpError(403, "Only the support owner can reply to tickets.");
    }

    const parsed = replySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(422, parsed.error.issues[0]?.message ?? "Ticket response is invalid.");
    }

    const { ticketId } = await context.params;
    const ticket = readSupportTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, "Support ticket was not found.");
    }
    if (ticket.status === "closed") {
      throw new HttpError(409, "This ticket is closed and cannot receive another response.");
    }
    if (!ticket.emailThreadId) {
      throw new HttpError(409, "The ticket email conversation has not started yet.");
    }

    let sent: Awaited<ReturnType<typeof replyToTicketEmail>>;
    try {
      sent = await replyToTicketEmail(ticket, {
        heading: "CRM support update",
        paragraphs: [parsed.data.message],
      });
    } catch (error) {
      throw new HttpError(502, `Unable to send the ticket response: ${getErrorMessage(error)}`);
    }

    const updated = updateSupportTicket(ticket.id, {
      emailMessageId: sent.messageId,
    });
    if (!updated) {
      throw new HttpError(404, "Support ticket was not found.");
    }

    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: EVENT_TYPE,
      actorType: "support_owner",
      message: EVENT_MESSAGE,
      details: {
        messageId: sent.messageId,
        sentBy: loginName,
        text: parsed.data.message,
      },
    });

    const latest = readSupportTicket(ticket.id);
    if (!latest) {
      throw new Error("Updated support ticket could not be read back.");
    }

    const response: SupportTicketReplyResponse = {
      ok: true,
      ticket: {
        id: latest.id,
        updatedAt: latest.updatedAt,
        latestUpdate: latest.latestUpdate,
      },
      event: {
        type: EVENT_TYPE,
        message: EVENT_MESSAGE,
        details: [parsed.data.message],
        createdAt: latest.updatedAt,
      },
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
