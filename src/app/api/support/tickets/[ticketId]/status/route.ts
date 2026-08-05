export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { isSupportOwner } from "@/lib/support-ticket-access";
import {
  addSupportTicketEvent,
  readSupportTicket,
  updateSupportTicket,
} from "@/lib/support-ticket-store";
import type {
  SupportTicketStatus,
  SupportTicketStatusUpdateResponse,
} from "@/types/support-ticket";

type RouteContext = {
  params: Promise<{ ticketId: string }>;
};

const statusSchema = z.object({
  status: z.enum(["queued", "investigating", "waiting_for_employee", "resolved"]),
});

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  queued: "Received",
  investigating: "In progress",
  waiting_for_details: "Waiting for details",
  repairing: "Repairing",
  waiting_for_employee: "Waiting on employee",
  monitoring: "Monitoring",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

function transitionPatch(status: z.infer<typeof statusSchema>["status"]) {
  const now = Date.now();
  switch (status) {
    case "queued":
      return {
        status,
        processingStartedAt: null,
        nextCheckAt: new Date(now).toISOString(),
        nextAction: "Ticket returned to the received queue by the support owner.",
      } as const;
    case "investigating":
      return {
        status,
        processingStartedAt: new Date(now).toISOString(),
        nextCheckAt: new Date(now + 10 * 60_000).toISOString(),
        nextAction: "The support owner is actively investigating this ticket.",
      } as const;
    case "waiting_for_employee":
      return {
        status,
        processingStartedAt: null,
        nextCheckAt: new Date(now + 24 * 60 * 60_000).toISOString(),
        nextAction: "Waiting for the employee to respond.",
      } as const;
    case "resolved":
      return {
        status,
        processingStartedAt: null,
        nextCheckAt: null,
        nextAction: null,
      } as const;
  }
}

function responsePayload(
  ticket: NonNullable<ReturnType<typeof readSupportTicket>>,
  changed: boolean,
  eventMessage: string | null,
): SupportTicketStatusUpdateResponse {
  return {
    ok: true,
    changed,
    ticket: {
      id: ticket.id,
      status: ticket.status,
      updatedAt: ticket.updatedAt,
      latestUpdate: ticket.latestUpdate,
      nextAction: ticket.nextAction,
    },
    event: eventMessage
      ? {
          type: "status_changed_by_support_owner",
          message: eventMessage,
          details: [],
          createdAt: ticket.updatedAt,
        }
      : null,
  };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request)?.trim().toLowerCase();
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable.");
    }
    if (!isSupportOwner(loginName)) {
      throw new HttpError(403, "Only the support owner can change ticket status.");
    }

    const parsed = statusSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(422, "Choose a valid Pipeline destination.");
    }

    const { ticketId } = await context.params;
    const ticket = readSupportTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, "Support ticket was not found.");
    }
    if (ticket.status === "closed") {
      throw new HttpError(409, "Closed tickets are final and cannot be moved to another status.");
    }
    if (ticket.status === parsed.data.status) {
      return NextResponse.json(responsePayload(ticket, false, null), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const updated = updateSupportTicket(ticket.id, transitionPatch(parsed.data.status));
    if (!updated || updated.status !== parsed.data.status) {
      throw new HttpError(409, "The ticket status changed before this move could be saved. Refresh and try again.");
    }

    const eventMessage = `Ticket moved from ${STATUS_LABELS[ticket.status]} to ${STATUS_LABELS[parsed.data.status]}.`;
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "status_changed_by_support_owner",
      actorType: "support_owner",
      message: eventMessage,
      details: {
        changedBy: loginName,
        fromStatus: ticket.status,
        toStatus: parsed.data.status,
      },
    });

    const latest = readSupportTicket(ticket.id);
    if (!latest || latest.status !== parsed.data.status) {
      throw new Error("Updated support ticket could not be read back.");
    }

    return NextResponse.json(responsePayload(latest, true, eventMessage), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
