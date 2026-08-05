export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { isSupportOwner } from "@/lib/support-ticket-access";
import {
  addSupportTicketEvent,
  readSupportTicket,
  updateSupportTicket,
  type SupportTicketRecord,
} from "@/lib/support-ticket-store";
import type { SupportTicketCloseResponse } from "@/types/support-ticket";

type RouteContext = {
  params: Promise<{ ticketId: string }>;
};

const CLOSED_EVENT_TYPE = "closed_by_support_owner" as const;
const CLOSED_MESSAGE = "Ticket closed manually by the support owner.";

function closedTicketPayload(
  ticket: SupportTicketRecord,
  alreadyClosed: boolean,
): SupportTicketCloseResponse {
  return {
    ok: true,
    alreadyClosed,
    ticket: {
      id: ticket.id,
      status: "closed",
      updatedAt: ticket.updatedAt,
      latestUpdate: ticket.latestUpdate,
      nextAction: null,
    },
    event: alreadyClosed
      ? null
      : {
          type: CLOSED_EVENT_TYPE,
          message: CLOSED_MESSAGE,
          details: [],
          createdAt: ticket.updatedAt,
        },
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
      throw new HttpError(403, "Only the support owner can close tickets.");
    }

    const { ticketId } = await context.params;
    const ticket = readSupportTicket(ticketId);
    if (!ticket) {
      throw new HttpError(404, "Support ticket was not found.");
    }
    if (ticket.status === "closed") {
      return NextResponse.json(closedTicketPayload(ticket, true), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const closed = updateSupportTicket(ticket.id, {
      status: "closed",
      processingStartedAt: null,
      nextCheckAt: null,
      nextAction: null,
    });
    if (!closed) {
      throw new HttpError(404, "Support ticket was not found.");
    }

    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: CLOSED_EVENT_TYPE,
      actorType: "support_owner",
      message: CLOSED_MESSAGE,
      details: { closedBy: loginName },
    });

    const latest = readSupportTicket(ticket.id);
    if (!latest || latest.status !== "closed") {
      throw new Error("Closed support ticket could not be read back.");
    }

    return NextResponse.json(closedTicketPayload(latest, false), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
