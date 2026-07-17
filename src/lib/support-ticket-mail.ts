import { buildMailProxyAssertion, ensureMailServiceConfigured } from "@/lib/mail-auth";
import {
  listSupportTicketAttachments,
  readSupportTicketAttachment,
  type SupportTicketRecord,
} from "@/lib/support-ticket-store";
import type { MailAttachmentInput, MailComposePayload, MailSendResponse } from "@/types/mail-compose";
import type { MailMessageAttachmentsResponse, MailThreadResponse } from "@/types/mail-thread";

const REQUEST_TIMEOUT_MS = 20_000;

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeMountPath(value: string | null | undefined, fallback = "/quotes"): string {
  const raw = cleanText(value) || fallback;
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed === "/" ? fallback : prefixed.replace(/\/+$/, "");
}

function getTicketSender(): { loginName: string; senderEmail: string; displayName: string } {
  const internalDomain = cleanText(process.env.MAIL_INTERNAL_DOMAIN) || "meadowb.com";
  const loginName = cleanText(process.env.TICKET_AGENT_SENDER_LOGIN) || "jserrano";
  return {
    loginName,
    senderEmail: cleanText(process.env.TICKET_AGENT_SENDER_EMAIL) || `${loginName}@${internalDomain}`,
    displayName: cleanText(process.env.TICKET_AGENT_SENDER_NAME) || "MeadowBrook CRM Support",
  };
}

function buildMailServiceBaseUrl(): string {
  const { serviceUrl } = ensureMailServiceConfigured();
  const normalized = serviceUrl.replace(/\/+$/, "");
  const mountPath = normalizeMountPath(process.env.MBQ_BASE_PATH, "/quotes");
  return normalized.endsWith(mountPath) ? normalized : `${normalized}${mountPath}`;
}

async function requestMailService<T>(
  path: string,
  options?: { method?: string; body?: unknown; baseUrl?: string },
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const assertion = buildMailProxyAssertion(getTicketSender());
  try {
    const response = await fetch(`${options?.baseUrl ?? buildMailServiceBaseUrl()}${path}`, {
      method: options?.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${assertion}`,
        ...(options?.body === undefined ? {} : { "Content-Type": "application/json" }),
        "x-mb-skip-activity-sync": "1",
      },
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal,
    });
    const rawBody = await response.text();
    let payload: unknown = null;
    if (rawBody.trim()) {
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : rawBody.trim().slice(0, 400) || `Mail service returned ${response.status}.`;
      throw new Error(message);
    }
    return payload as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTicketNumber(ticket: SupportTicketRecord): string {
  return `CRM-${String(ticket.ticketNumber).padStart(4, "0")}`;
}

export function buildTicketAcknowledgementCopy(
  ticket: SupportTicketRecord,
  attachmentCount: number,
): { heading: string; paragraphs: string[] } {
  return {
    heading: "We received your CRM support request",
    paragraphs: [
      `Hi ${ticket.employeeName},`,
      `We received your report about “${ticket.title}”. Your ticket number is ${formatTicketNumber(ticket)}.`,
      ...(attachmentCount > 0
        ? [`We also received ${attachmentCount} file${attachmentCount === 1 ? "" : "s"} with your ticket.`]
        : []),
      "We are checking the problem now. We will reply to this email when we have an update. You can reply here at any time if you want to add more details.",
    ],
  };
}

function formatEmailHtml(input: { ticket: SupportTicketRecord; heading: string; paragraphs: string[] }): string {
  const paragraphs = input.paragraphs
    .map((paragraph) => `<p style="margin:0 0 14px;line-height:1.6;color:#334155">${escapeHtml(paragraph)}</p>`)
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#172033">
      <div style="border:1px solid #dce5ee;border-radius:16px;overflow:hidden;background:#ffffff">
        <div style="padding:20px 24px;background:#edf7f2;border-bottom:1px solid #d6e9df">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;color:#247b58">MEADOWBROOK CRM SUPPORT · ${escapeHtml(formatTicketNumber(input.ticket))}</div>
          <h2 style="margin:7px 0 0;font-size:21px;color:#172033">${escapeHtml(input.heading)}</h2>
        </div>
        <div style="padding:24px">${paragraphs}</div>
      </div>
      <p style="margin:12px 4px 0;color:#7b8798;font-size:11px;line-height:1.5">Reply to this email if you have more details or need help. Your reply will stay with this ticket.</p>
    </div>
  `;
}

function buildPayload(input: {
  ticket: SupportTicketRecord;
  heading: string;
  paragraphs: string[];
  threadId?: string | null;
  attachments?: MailAttachmentInput[];
}): MailComposePayload {
  return {
    threadId: input.threadId ?? null,
    draftId: null,
    subject: `[${formatTicketNumber(input.ticket)}] ${input.ticket.title}`,
    htmlBody: formatEmailHtml(input),
    textBody: [
      input.heading,
      "",
      ...input.paragraphs,
      "",
      "Reply to this email if you have more details or need help. Your reply will stay with this ticket.",
    ].join("\n"),
    to: [{
      email: input.ticket.employeeEmail,
      name: input.ticket.employeeName,
      contactId: null,
      businessAccountRecordId: null,
      businessAccountId: null,
    }],
    cc: [],
    bcc: [],
    linkedContact: {
      contactId: null,
      businessAccountRecordId: null,
      businessAccountId: null,
      contactName: null,
      companyName: null,
    },
    matchedContacts: [],
    attachments: input.attachments ?? [],
    sourceSurface: "mail",
  };
}

function assertSendResponse(payload: MailSendResponse): MailSendResponse {
  if (!payload || payload.sent !== true || !cleanText(payload.threadId) || !cleanText(payload.messageId)) {
    throw new Error("Mail service did not return a valid send confirmation.");
  }
  return payload;
}

export async function sendTicketAcknowledgement(ticket: SupportTicketRecord): Promise<MailSendResponse> {
  const storedAttachments = listSupportTicketAttachments(ticket.id);
  const attachments = storedAttachments.map((attachment) => ({
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    base64Data: readSupportTicketAttachment(attachment).toString("base64"),
  }));
  const copy = buildTicketAcknowledgementCopy(ticket, attachments.length);
  const payload = buildPayload({ ticket, ...copy, attachments });
  return assertSendResponse(await requestMailService<MailSendResponse>("/api/mail/messages/send", {
    method: "POST",
    body: payload,
  }));
}

export async function replyToTicketEmail(
  ticket: SupportTicketRecord,
  input: { heading: string; paragraphs: string[] },
): Promise<MailSendResponse> {
  if (!ticket.emailThreadId) {
    throw new Error("Ticket email thread is unavailable.");
  }
  const payload = buildPayload({ ...input, ticket, threadId: ticket.emailThreadId });
  return assertSendResponse(await requestMailService<MailSendResponse>(
    `/api/mail/threads/${encodeURIComponent(ticket.emailThreadId)}/reply`,
    { method: "POST", body: payload },
  ));
}

export async function readTicketEmailThread(ticket: SupportTicketRecord): Promise<MailThreadResponse> {
  if (!ticket.emailThreadId) {
    throw new Error("Ticket email thread is unavailable.");
  }
  const payload = await requestMailService<MailThreadResponse>(
    `/api/mail/threads/${encodeURIComponent(ticket.emailThreadId)}`,
  );
  if (!payload || !payload.thread || !Array.isArray(payload.messages)) {
    throw new Error("Mail service did not return a valid ticket thread.");
  }
  return payload;
}

export async function readTicketEmailAttachments(
  ticket: SupportTicketRecord,
  messageId: string,
): Promise<MailMessageAttachmentsResponse> {
  if (!ticket.emailThreadId) {
    throw new Error("Ticket email thread is unavailable.");
  }
  const path = `/api/mail/threads/${encodeURIComponent(ticket.emailThreadId)}/messages/${encodeURIComponent(messageId)}/attachments`;
  const port = cleanText(process.env.PORT) || "3000";
  const mountPath = normalizeMountPath(process.env.MBQ_BASE_PATH, "/quotes");
  let payload: MailMessageAttachmentsResponse;
  try {
    payload = await requestMailService<MailMessageAttachmentsResponse>(path, {
      baseUrl: `http://127.0.0.1:${port}${mountPath}`,
    });
  } catch {
    payload = await requestMailService<MailMessageAttachmentsResponse>(path);
  }
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("Mail service did not return valid email attachments.");
  }
  return payload;
}
