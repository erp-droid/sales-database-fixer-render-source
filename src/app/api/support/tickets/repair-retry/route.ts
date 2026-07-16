export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getErrorMessage, HttpError } from "@/lib/errors";
import { replyToTicketEmail } from "@/lib/support-ticket-mail";
import {
  canDispatchTicketCodeRepair,
  dispatchTicketCodeRepair,
} from "@/lib/support-ticket-repair";
import { requireTicketRepairSecret } from "@/lib/support-ticket-repair-auth";
import {
  addSupportTicketEvent,
  readSupportTicket,
  updateSupportTicket,
} from "@/lib/support-ticket-store";

const retrySchema = z.object({
  ticketId: z.string().uuid(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireTicketRepairSecret(request.headers.get("x-ticket-repair-secret"));
    const parsed = retrySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(422, parsed.error.issues[0]?.message ?? "Ticket retry is invalid.");
    }

    const ticket = readSupportTicket(parsed.data.ticketId);
    if (!ticket) {
      throw new HttpError(404, "Ticket was not found.");
    }
    if (!canDispatchTicketCodeRepair(ticket)) {
      throw new HttpError(409, "This ticket cannot start another automated repair attempt.");
    }

    const repair = await dispatchTicketCodeRepair(ticket);
    const latestTicket = readSupportTicket(ticket.id) ?? ticket;
    const sent = await replyToTicketEmail(latestTicket, {
      heading: "We are trying the fix again",
      paragraphs: [
        "We fixed a problem in our support system and restarted the work on your CRM ticket.",
        "We still have the details and pictures you sent. You do not need to submit another ticket or do anything right now.",
        "We will test the fix before it goes live and email you here when it is ready.",
      ],
    });

    updateSupportTicket(ticket.id, {
      status: "repairing",
      emailMessageId: sent.messageId,
      processingStartedAt: null,
      lastError: null,
    });
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "code_repair_update_sent",
      actorType: "robot",
      message: "The employee was told that the automated repair was restarted.",
      details: { repairRunId: repair.repairRunId, messageId: sent.messageId, retry: true },
    });

    return NextResponse.json({
      ok: true,
      ticketNumber: ticket.ticketNumber,
      repairRunId: repair.repairRunId,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status });
  }
}
