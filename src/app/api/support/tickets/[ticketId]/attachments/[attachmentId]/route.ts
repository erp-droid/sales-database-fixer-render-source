export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { canViewSupportTicket } from "@/lib/support-ticket-access";
import {
  readSupportTicket,
  readSupportTicketAttachment,
  readSupportTicketAttachmentById,
} from "@/lib/support-ticket-store";

type RouteContext = {
  params: Promise<{ ticketId: string; attachmentId: string }>;
};

function safeContentDispositionFileName(value: string): string {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "attachment";
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request)?.trim().toLowerCase();
    if (!loginName) {
      return NextResponse.json({ error: "Signed-in username is unavailable." }, { status: 401 });
    }

    const { ticketId, attachmentId } = await context.params;
    const ticket = readSupportTicket(ticketId);
    if (!ticket || !canViewSupportTicket(loginName, ticket)) {
      return NextResponse.json({ error: "Attachment was not found." }, { status: 404 });
    }
    const attachment = readSupportTicketAttachmentById(ticket.id, attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: "Attachment was not found." }, { status: 404 });
    }

    const fileBytes = Uint8Array.from(readSupportTicketAttachment(attachment));
    return new NextResponse(fileBytes.buffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${safeContentDispositionFileName(attachment.fileName)}"`,
        "Content-Length": String(attachment.sizeBytes),
        "Content-Type": attachment.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Attachment could not be opened." }, { status: 401 });
  }
}
