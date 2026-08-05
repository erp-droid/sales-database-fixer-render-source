export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { canViewSupportTicket } from "@/lib/support-ticket-access";
import { readTicketEmailThread } from "@/lib/support-ticket-mail";
import { readSupportTicket } from "@/lib/support-ticket-store";
import type {
  SupportTicketConversationMessage,
  SupportTicketConversationParticipant,
  SupportTicketConversationResponse,
} from "@/types/support-ticket";
import type { MailMessage } from "@/types/mail-thread";

type RouteContext = {
  params: Promise<{ ticketId: string }>;
};

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return named[normalized] ?? entity;
  });
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n\n")
      .replace(/<\/div\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<\/li\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function participant(input: MailMessage["from"]): SupportTicketConversationParticipant | null {
  const email = input?.email?.trim() ?? "";
  if (!email) {
    return null;
  }
  return {
    name: input?.name?.trim() || null,
    email,
  };
}

function participants(inputs: MailMessage["to"]): SupportTicketConversationParticipant[] {
  return inputs
    .map(participant)
    .filter((value): value is SupportTicketConversationParticipant => value !== null);
}

function messageTimestamp(message: MailMessage): string | null {
  return message.receivedAt || message.sentAt || null;
}

function toConversationMessage(message: MailMessage): SupportTicketConversationMessage {
  return {
    id: message.messageId,
    direction: message.direction,
    from: participant(message.from),
    to: participants(message.to),
    subject: message.subject,
    body: message.textBody.trim() || htmlToPlainText(message.htmlBody),
    timestamp: messageTimestamp(message),
    hasAttachments: message.hasAttachments,
  };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request)?.trim().toLowerCase();
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable.");
    }

    const { ticketId } = await context.params;
    const ticket = readSupportTicket(ticketId);
    if (!ticket || !canViewSupportTicket(loginName, ticket)) {
      throw new HttpError(404, "Support ticket was not found.");
    }

    if (!ticket.emailThreadId) {
      const response: SupportTicketConversationResponse = {
        available: false,
        subject: null,
        items: [],
      };
      return NextResponse.json(response, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const thread = await readTicketEmailThread(ticket);
    const items = thread.messages
      .map((message, index) => ({
        item: toConversationMessage(message),
        index,
      }))
      .sort((left, right) => {
        const leftMs = Date.parse(left.item.timestamp ?? "");
        const rightMs = Date.parse(right.item.timestamp ?? "");
        if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
          return leftMs - rightMs;
        }
        return left.index - right.index;
      })
      .map(({ item }) => item);
    const response: SupportTicketConversationResponse = {
      available: true,
      subject: thread.thread.subject || ticket.title,
      items,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    return NextResponse.json(
      { error: getErrorMessage(error) },
      {
        status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
