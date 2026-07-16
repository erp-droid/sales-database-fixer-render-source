export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getErrorMessage, HttpError } from "@/lib/errors";
import { findTicketRepairDispatch } from "@/lib/support-ticket-repair";
import { requireTicketRepairSecret } from "@/lib/support-ticket-repair-auth";
import {
  listSupportTicketAttachments,
  listSupportTicketEvents,
  readSupportTicket,
  readSupportTicketAttachment,
} from "@/lib/support-ticket-store";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    requireTicketRepairSecret(request.headers.get("x-ticket-repair-secret"));
    const ticketId = request.nextUrl.searchParams.get("ticketId")?.trim() ?? "";
    const repairRunId = request.nextUrl.searchParams.get("repairRunId")?.trim() ?? "";
    if (!ticketId || !repairRunId) {
      throw new HttpError(422, "ticketId and repairRunId are required.");
    }
    if (!findTicketRepairDispatch(ticketId, repairRunId)) {
      throw new HttpError(404, "Repair job was not found.");
    }

    const ticket = readSupportTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, "Ticket was not found.");
    }
    const events = listSupportTicketEvents(ticketId, 500);
    const latestDiagnostics = events.filter((event) => event.eventType === "diagnostics_completed").at(-1);
    const latestEmployeeReply = events.filter((event) => event.eventType === "employee_reply_received").at(-1);
    const attachments = listSupportTicketAttachments(ticketId).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      base64Data: readSupportTicketAttachment(attachment).toString("base64"),
    }));

    return NextResponse.json({
      repairRunId,
      ticket: {
        number: ticket.ticketNumber,
        title: ticket.title,
        category: ticket.category,
        impact: ticket.impact,
        description: ticket.description,
        expectedBehavior: ticket.expectedBehavior,
        stepsToReproduce: ticket.stepsToReproduce,
        pageUrl: ticket.pageUrl,
      },
      latestEmployeeReply: latestEmployeeReply?.details?.text ?? null,
      diagnostics: latestDiagnostics?.details?.diagnostics ?? null,
      attachments,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
