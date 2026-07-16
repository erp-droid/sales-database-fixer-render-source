export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getErrorMessage, HttpError } from "@/lib/errors";
import { replyToTicketEmail } from "@/lib/support-ticket-mail";
import { findTicketRepairDispatch } from "@/lib/support-ticket-repair";
import { requireTicketRepairSecret } from "@/lib/support-ticket-repair-auth";
import {
  addSupportTicketEvent,
  listSupportTicketEvents,
  readSupportTicket,
  updateSupportTicket,
} from "@/lib/support-ticket-store";

const callbackSchema = z.object({
  ticketId: z.string().uuid(),
  repairRunId: z.string().uuid(),
  status: z.enum(["deployed", "failed"]),
  commitSha: z.union([z.literal(""), z.string().regex(/^[a-f0-9]{7,64}$/i)]).optional().default(""),
  summary: z.string().trim().min(1).max(3000),
});

function callbackState(ticketId: string, repairRunId: string) {
  const matchingEvents = listSupportTicketEvents(ticketId, 500).filter(
    (event) => event.details?.repairRunId === repairRunId,
  );
  return {
    deployed: matchingEvents.some((event) => event.eventType === "code_repair_deployed"),
    failed: matchingEvents.some((event) => event.eventType === "code_repair_failed"),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireTicketRepairSecret(request.headers.get("x-ticket-repair-secret"));
    const parsed = callbackSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(422, parsed.error.issues[0]?.message ?? "Repair callback is invalid.");
    }
    const input = parsed.data;
    if (!findTicketRepairDispatch(input.ticketId, input.repairRunId)) {
      throw new HttpError(404, "Repair job was not found.");
    }
    const existingCallback = callbackState(input.ticketId, input.repairRunId);
    if (existingCallback.deployed || (input.status === "failed" && existingCallback.failed)) {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    const ticket = readSupportTicket(input.ticketId);
    if (!ticket) {
      throw new HttpError(404, "Ticket was not found.");
    }

    if (input.status === "deployed") {
      const commitLabel = input.commitSha ? input.commitSha.slice(0, 12) : "the verified commit";
      const sent = await replyToTicketEmail(ticket, {
        heading: "The fix is ready",
        paragraphs: [
          "We fixed the CRM problem you reported. The updated CRM passed our checks and is ready to use.",
          "Please try the same thing again. Reply “resolved” if it works now. If it does not, reply “still broken” and tell us what happened.",
        ],
      });
      updateSupportTicket(ticket.id, {
        status: "waiting_for_employee",
        resolution: `Verified code repair deployed at ${commitLabel}.`,
        emailMessageId: sent.messageId,
        processingStartedAt: null,
        nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
        lastError: null,
      });
      addSupportTicketEvent({
        ticketId: ticket.id,
        eventType: "code_repair_deployed",
        actorType: "robot",
        message: `Verified code repair ${commitLabel} deployed; waiting for employee confirmation.`,
        details: { repairRunId: input.repairRunId, commitSha: input.commitSha, summary: input.summary },
      });
    } else {
      const sent = await replyToTicketEmail(ticket, {
        heading: "Your ticket is still open",
        paragraphs: [
          "We were not able to finish the fix. We did not leave an untested change in the CRM.",
          "Your ticket is still open. You do not need to send another ticket. A support person will review it.",
        ],
      });
      updateSupportTicket(ticket.id, {
        status: "escalated",
        emailMessageId: sent.messageId,
        processingStartedAt: null,
        nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
        lastError: input.summary.slice(0, 1200),
      });
      addSupportTicketEvent({
        ticketId: ticket.id,
        eventType: "code_repair_failed",
        actorType: "system",
        message: "The automated code repair did not complete a verified healthy deployment.",
        details: { repairRunId: input.repairRunId, commitSha: input.commitSha, summary: input.summary },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status });
  }
}
