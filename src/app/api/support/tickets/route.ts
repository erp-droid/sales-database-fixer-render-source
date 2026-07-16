export const runtime = "nodejs";

import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import {
  isAllowedSupportAttachment,
  normalizeSupportAttachmentMimeType,
  SUPPORT_ATTACHMENT_MAX_FILES,
  SUPPORT_ATTACHMENT_MAX_FILE_BYTES,
  SUPPORT_ATTACHMENT_MAX_TOTAL_BYTES,
} from "@/lib/support-ticket-attachment-policy";
import { resolveSupportTicketRequester } from "@/lib/support-ticket-requester";
import {
  countRecentSupportTicketsForLogin,
  createSupportTicket,
  listSupportTicketsForLogin,
  type SupportTicketRecord,
} from "@/lib/support-ticket-store";
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_IMPACTS,
  type SupportTicketSummary,
} from "@/types/support-ticket";

const ticketSchema = z.object({
  category: z.enum(SUPPORT_TICKET_CATEGORIES),
  impact: z.enum(SUPPORT_TICKET_IMPACTS),
  title: z.string().trim().min(5).max(140),
  description: z.string().trim().min(10).max(4000),
  expectedBehavior: z.string().trim().max(1200).optional().default(""),
  stepsToReproduce: z.string().trim().max(1600).optional().default(""),
  pageUrl: z.union([z.literal(""), z.string().trim().url().max(500)]).optional().default(""),
});

function requireLoginName(request: NextRequest): string {
  requireAuthCookieValue(request);
  const loginName = getStoredLoginName(request)?.trim().toLowerCase();
  if (!loginName) {
    throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
  }
  return loginName;
}

function toSummary(ticket: SupportTicketRecord): SupportTicketSummary {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    category: ticket.category,
    impact: ticket.impact,
    status: ticket.status,
    employeeName: ticket.employeeName,
    employeeEmail: ticket.employeeEmail,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    latestUpdate: ticket.latestUpdate,
    attachmentCount: ticket.attachmentCount,
  };
}

async function readSubmission(request: NextRequest): Promise<{
  fields: unknown;
  attachments: Array<{ fileName: string; mimeType: string; data: Buffer }>;
}> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return {
      fields: await request.json().catch(() => null),
      attachments: [],
    };
  }

  const formData = await request.formData();
  const fields = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value]),
  );
  const files = formData.getAll("attachments").filter(
    (value): value is File => value instanceof File && value.size > 0,
  );

  if (files.length > SUPPORT_ATTACHMENT_MAX_FILES) {
    throw new HttpError(422, `Add no more than ${SUPPORT_ATTACHMENT_MAX_FILES} attachments.`);
  }

  let totalBytes = 0;
  const attachments = [];
  for (const file of files) {
    if (!isAllowedSupportAttachment(file.name, file.type)) {
      throw new HttpError(422, `${file.name} is not a supported attachment type.`);
    }
    if (file.size > SUPPORT_ATTACHMENT_MAX_FILE_BYTES) {
      throw new HttpError(422, `${file.name} is too large. Each attachment must be 6 MB or less.`);
    }
    totalBytes += file.size;
    if (totalBytes > SUPPORT_ATTACHMENT_MAX_TOTAL_BYTES) {
      throw new HttpError(422, "Attachments must total 12 MB or less.");
    }
    attachments.push({
      fileName: file.name,
      mimeType: normalizeSupportAttachmentMimeType(file.name, file.type),
      data: Buffer.from(await file.arrayBuffer()),
    });
  }

  return { fields, attachments };
}

function scheduleTicket(ticketId: string): void {
  if ((process.env.TICKET_AGENT_ENABLED ?? "true").trim().toLowerCase() === "false") {
    return;
  }

  const run = async () => {
    const { processSupportTicketById } = await import("@/lib/support-ticket-worker");
    await processSupportTicketById(ticketId);
  };

  try {
    after(run);
  } catch {
    queueMicrotask(() => {
      void run().catch(() => undefined);
    });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const loginName = requireLoginName(request);
    return NextResponse.json({
      items: listSupportTicketsForLogin(loginName, 20).map(toSummary),
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const loginName = requireLoginName(request);
    const submission = await readSubmission(request);
    const parsed = ticketSchema.safeParse(submission.fields);
    if (!parsed.success) {
      throw new HttpError(422, parsed.error.issues[0]?.message ?? "Ticket details are invalid.");
    }

    const requester = resolveSupportTicketRequester(loginName);

    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    if (countRecentSupportTicketsForLogin(loginName, hourAgo) >= 20) {
      throw new HttpError(429, "Too many tickets were submitted from this sign-in. Please wait before trying again.");
    }

    const ticket = createSupportTicket({
      ...parsed.data,
      ...requester,
      submittedByLogin: loginName,
      attachments: submission.attachments,
    });
    scheduleTicket(ticket.id);
    return NextResponse.json({ ticket: toSummary(ticket) }, { status: 201 });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
