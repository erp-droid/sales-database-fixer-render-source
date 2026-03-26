import { z } from "zod";

import type {
  MailComposePayload,
  MailMatchedContact,
  MailRecipient,
} from "@/types/mail-compose";
import type { MailLinkContactPayload } from "@/types/mail-thread";

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const nullableTextSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const recipientSchema = z.object({
  email: z.string().trim().email("Recipient email must be valid."),
  name: nullableTextSchema,
  contactId: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }

      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
    }),
  businessAccountRecordId: nullableTextSchema,
  businessAccountId: nullableTextSchema,
});

const attachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  base64Data: z.string().min(1),
});

const matchedContactSchema = z.object({
  contactId: z.coerce.number().int().positive(),
  businessAccountRecordId: nullableTextSchema,
  businessAccountId: nullableTextSchema,
  contactName: nullableTextSchema,
  companyName: nullableTextSchema,
  email: nullableTextSchema,
});

export const mailComposePayloadSchema = z
  .object({
    threadId: nullableTextSchema,
    draftId: nullableTextSchema,
    subject: z.string().trim().max(512).default(""),
    htmlBody: z.string().max(2_000_000).default(""),
    textBody: z.string().max(500_000).default(""),
    to: z.array(recipientSchema).default([]),
    cc: z.array(recipientSchema).default([]),
    bcc: z.array(recipientSchema).default([]),
    linkedContact: z.object({
      contactId: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined || value === "") {
            return null;
          }

          const numeric = Number(value);
          return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
        }),
      businessAccountRecordId: nullableTextSchema,
      businessAccountId: nullableTextSchema,
      contactName: nullableTextSchema,
      companyName: nullableTextSchema,
    }),
    matchedContacts: z.array(matchedContactSchema).default([]),
    attachments: z.array(attachmentSchema).default([]),
    sourceSurface: z.enum(["accounts", "mail"]).default("mail"),
  })
  .superRefine((value, ctx) => {
    const recipientCount = value.to.length + value.cc.length + value.bcc.length;
    if (recipientCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one recipient is required.",
        path: ["to"],
      });
    }

    if (!value.subject.trim() && !value.htmlBody.trim() && !value.textBody.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Subject or body is required.",
        path: ["subject"],
      });
    }

    const totalAttachmentBytes = value.attachments.reduce(
      (total, attachment) => total + attachment.sizeBytes,
      0,
    );
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attachments exceed the 20 MB total limit.",
        path: ["attachments"],
      });
    }

    const linked = value.linkedContact;
    const hasPartialAccountLink =
      (linked.businessAccountRecordId && !linked.businessAccountId) ||
      (!linked.businessAccountRecordId && linked.businessAccountId);
    if (hasPartialAccountLink) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Linked account must include both record ID and business account ID.",
        path: ["linkedContact"],
      });
    }
  });

export const mailLinkContactPayloadSchema = z.object({
  contactId: z.coerce.number().int().positive(),
  businessAccountRecordId: z.string().trim().min(1),
  businessAccountId: nullableTextSchema,
});

export const mailThreadsQuerySchema = z.object({
  folder: z.enum(["inbox", "sent", "drafts", "starred"]).default("inbox"),
  q: z.string().trim().max(255).optional(),
  cursor: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function parseMailComposePayload(value: unknown): MailComposePayload {
  return mailComposePayloadSchema.parse(value);
}

export function parseMailLinkContactPayload(value: unknown): MailLinkContactPayload {
  return mailLinkContactPayloadSchema.parse(value);
}

export function parseMailThreadsQuery(params: URLSearchParams): {
  folder: "inbox" | "sent" | "drafts" | "starred";
  q?: string;
  cursor?: string;
  limit: number;
} {
  const parsed = mailThreadsQuerySchema.parse({
    folder: params.get("folder") ?? undefined,
    q: params.get("q") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });

  return {
    folder: parsed.folder,
    ...(parsed.q ? { q: parsed.q } : {}),
    ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
    limit: parsed.limit,
  };
}

export function buildRecipientComparableKey(recipient: MailRecipient): string {
  return `${recipient.email.trim().toLowerCase()}::${recipient.contactId ?? "none"}`;
}

export function buildMatchedContactComparableKey(contact: MailMatchedContact): string {
  return `${contact.contactId}::${contact.businessAccountRecordId ?? contact.businessAccountId ?? "none"}`;
}

function normalizeComparableEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isAllowedInternalMailboxEmail(value: string | null | undefined): boolean {
  const comparableEmail = normalizeComparableEmail(value);
  if (!comparableEmail) {
    return false;
  }

  const domain = (process.env.MAIL_INTERNAL_DOMAIN ?? "meadowb.com").trim().toLowerCase();
  return Boolean(domain) && comparableEmail.endsWith(`@${domain}`);
}

export function collectUnresolvedMailRecipientEmails(
  payload: Partial<Pick<MailComposePayload, "to" | "cc" | "bcc" | "matchedContacts">>,
): string[] {
  const matchedEmails = new Set(
    (payload.matchedContacts ?? [])
      .map((contact) => normalizeComparableEmail(contact.email))
      .filter(Boolean),
  );
  const unresolved = new Set<string>();

  for (const recipient of [...(payload.to ?? []), ...(payload.cc ?? []), ...(payload.bcc ?? [])]) {
    const comparableEmail = normalizeComparableEmail(recipient.email);
    if (!comparableEmail) {
      continue;
    }

    if (
      (recipient.contactId ?? 0) > 0 ||
      matchedEmails.has(comparableEmail) ||
      isAllowedInternalMailboxEmail(comparableEmail)
    ) {
      continue;
    }

    unresolved.add(comparableEmail);
  }

  return [...unresolved];
}
