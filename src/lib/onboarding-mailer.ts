import nodemailer, { type Transporter } from "nodemailer";

import { buildMailServiceAssertion, ensureMailServiceConfigured } from "@/lib/mail-auth";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { buildOnboardingEmail } from "@/lib/onboarding-email";
import type { MailComposePayload, MailRecipient, MailSendResponse } from "@/types/mail-compose";

type SendOnboardingEmailInput = {
  companyName: string | null;
  contactName: string | null;
  contactEmail: string;
  onboardingUrl: string;
  opportunityId: string | null;
};

type SendPaymentTermsOverrideEmailInput = {
  companyName: string | null;
  businessAccountId: string;
  opportunityId: string | null;
  defaultTermsId: string;
  requestedTermsId: string;
  invoiceContact: { name: string; email: string };
  paymentContact: { name: string; email: string };
};

let cachedTransport: Transporter | null = null;

function isSmtpConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.ONBOARDING_SMTP_HOST && env.ONBOARDING_SMTP_USER && env.ONBOARDING_SMTP_PASS);
}

function resolveTransport(): Transporter {
  if (cachedTransport) {
    return cachedTransport;
  }

  const env = getEnv();
  if (!env.ONBOARDING_SMTP_HOST || !env.ONBOARDING_SMTP_USER || !env.ONBOARDING_SMTP_PASS) {
    throw new HttpError(
      500,
      "Onboarding SMTP is not configured. Set ONBOARDING_SMTP_HOST, ONBOARDING_SMTP_USER, and ONBOARDING_SMTP_PASS.",
    );
  }

  const port = env.ONBOARDING_SMTP_PORT;
  cachedTransport = nodemailer.createTransport({
    host: env.ONBOARDING_SMTP_HOST,
    port,
    secure: env.ONBOARDING_SMTP_SECURE,
    auth: {
      user: env.ONBOARDING_SMTP_USER,
      pass: env.ONBOARDING_SMTP_PASS,
    },
  });

  return cachedTransport;
}

function parseEmailAddress(value: string): { email: string; name: string | null } {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*)<([^>]+)>$/);
  if (match) {
    const name = match[1]?.trim().replace(/^"|"$/g, "") ?? "";
    const email = match[2]?.trim() ?? "";
    return {
      email,
      name: name || null,
    };
  }

  return {
    email: trimmed,
    name: null,
  };
}

function parseRecipientList(value: string | null | undefined): MailRecipient[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((email) => ({
      email,
      name: null,
      contactId: null,
      businessAccountRecordId: null,
      businessAccountId: null,
    }));
}

function buildSenderIdentity(fromValue: string): {
  loginName: string;
  senderEmail: string;
  displayName: string;
} {
  const parsed = parseEmailAddress(fromValue);
  const email = parsed.email.trim();
  const loginName = email.split("@")[0] ?? "onboarding";
  const displayName = parsed.name || loginName;
  return {
    loginName,
    senderEmail: email,
    displayName,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPaymentTermsOverrideEmail(input: SendPaymentTermsOverrideEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const name = input.companyName?.trim() || input.businessAccountId;
  const subject = `Payment terms override requested: ${name}`;
  const textLines = [
    "Payment terms override requested.",
    `Account: ${name} (${input.businessAccountId})`,
    input.opportunityId ? `Opportunity: ${input.opportunityId}` : null,
    `Requested terms: ${input.requestedTermsId}`,
    `Default terms: ${input.defaultTermsId}`,
    `Invoice contact: ${input.invoiceContact.name} (${input.invoiceContact.email})`,
    `Payment inquiries contact: ${input.paymentContact.name} (${input.paymentContact.email})`,
  ].filter(Boolean);

  const htmlLines = [
    `<p><strong>Payment terms override requested.</strong></p>`,
    `<p>Account: ${escapeHtml(name)} (${escapeHtml(input.businessAccountId)})</p>`,
    input.opportunityId
      ? `<p>Opportunity: ${escapeHtml(input.opportunityId)}</p>`
      : "",
    `<p>Requested terms: ${escapeHtml(input.requestedTermsId)}</p>`,
    `<p>Default terms: ${escapeHtml(input.defaultTermsId)}</p>`,
    `<p>Invoice contact: ${escapeHtml(input.invoiceContact.name)} (${escapeHtml(
      input.invoiceContact.email,
    )})</p>`,
    `<p>Payment inquiries contact: ${escapeHtml(input.paymentContact.name)} (${escapeHtml(
      input.paymentContact.email,
    )})</p>`,
  ].filter(Boolean);

  return {
    subject,
    text: textLines.join("\n"),
    html: htmlLines.join(""),
  };
}

async function sendViaMailService(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  bcc: string | null;
  contactName: string | null;
}): Promise<{ messageId: string | null }> {
  const { serviceUrl } = ensureMailServiceConfigured();
  const sender = buildSenderIdentity(input.from);
  const token = buildMailServiceAssertion(sender);

  const payload: MailComposePayload = {
    threadId: null,
    draftId: null,
    subject: input.subject,
    htmlBody: input.html,
    textBody: input.text,
    to: [
      {
        email: input.to,
        name: input.contactName ?? null,
        contactId: null,
        businessAccountRecordId: null,
        businessAccountId: null,
      },
    ],
    cc: [],
    bcc: parseRecipientList(input.bcc),
    linkedContact: {
      contactId: null,
      businessAccountRecordId: null,
      businessAccountId: null,
      contactName: null,
      companyName: null,
    },
    attachments: [],
    sourceSurface: "accounts",
  };

  const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/api/mail/messages/send`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      (json && typeof json === "object" && "error" in json
        ? String((json as { error?: unknown }).error)
        : "Mail service send failed.") as string,
    );
  }

  const messageId =
    json && typeof json === "object" && "messageId" in json
      ? String((json as MailSendResponse).messageId ?? "")
      : null;

  return { messageId: messageId || null };
}

export async function sendOnboardingEmail(
  input: SendOnboardingEmailInput,
): Promise<{
  messageId: string | null;
  to: string;
  overrideTo: string | null;
  subject: string;
}> {
  const env = getEnv();
  if (!env.ONBOARDING_EMAIL_FROM) {
    throw new HttpError(500, "ONBOARDING_EMAIL_FROM is not configured.");
  }

  const overrideTo = env.ONBOARDING_EMAIL_OVERRIDE_TO ?? null;
  const to = overrideTo ?? input.contactEmail;
  const supportEmail = env.ONBOARDING_EMAIL_REPLY_TO || env.ONBOARDING_EMAIL_FROM;
  const email = buildOnboardingEmail({
    companyName: input.companyName,
    contactName: input.contactName,
    onboardingUrl: input.onboardingUrl,
    supportEmail,
    opportunityId: input.opportunityId,
  });

  if (isSmtpConfigured()) {
    const transporter = resolveTransport();
    const result = await transporter.sendMail({
      from: env.ONBOARDING_EMAIL_FROM,
      to,
      replyTo: env.ONBOARDING_EMAIL_REPLY_TO ?? undefined,
      bcc: env.ONBOARDING_EMAIL_BCC ?? undefined,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    return {
      messageId: typeof result.messageId === "string" ? result.messageId : null,
      to,
      overrideTo,
      subject: email.subject,
    };
  }

  const mailServiceConfigured = Boolean(env.MAIL_SERVICE_URL && env.MAIL_SERVICE_SHARED_SECRET);
  if (!mailServiceConfigured) {
    throw new HttpError(
      500,
      "Onboarding email is not configured. Set SMTP (ONBOARDING_SMTP_*) or MAIL_SERVICE_URL/MAIL_SERVICE_SHARED_SECRET.",
    );
  }

  const { messageId } = await sendViaMailService({
    from: env.ONBOARDING_EMAIL_FROM,
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    bcc: env.ONBOARDING_EMAIL_BCC ?? null,
    contactName: input.contactName,
  });

  return {
    messageId,
    to,
    overrideTo,
    subject: email.subject,
  };
}

export async function sendPaymentTermsOverrideEmail(
  input: SendPaymentTermsOverrideEmailInput,
): Promise<{
  messageId: string | null;
  to: string;
  overrideTo: string | null;
  subject: string;
}> {
  const env = getEnv();
  if (!env.ONBOARDING_EMAIL_FROM) {
    throw new HttpError(500, "ONBOARDING_EMAIL_FROM is not configured.");
  }

  const overrideTo = env.ONBOARDING_EMAIL_OVERRIDE_TO ?? null;
  const to = overrideTo ?? "ar@meadowb.com";
  const email = buildPaymentTermsOverrideEmail(input);

  if (isSmtpConfigured()) {
    const transporter = resolveTransport();
    const result = await transporter.sendMail({
      from: env.ONBOARDING_EMAIL_FROM,
      to,
      replyTo: env.ONBOARDING_EMAIL_REPLY_TO ?? undefined,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    return {
      messageId: typeof result.messageId === "string" ? result.messageId : null,
      to,
      overrideTo,
      subject: email.subject,
    };
  }

  const mailServiceConfigured = Boolean(env.MAIL_SERVICE_URL && env.MAIL_SERVICE_SHARED_SECRET);
  if (!mailServiceConfigured) {
    throw new HttpError(
      500,
      "Notification email is not configured. Set SMTP (ONBOARDING_SMTP_*) or MAIL_SERVICE_URL/MAIL_SERVICE_SHARED_SECRET.",
    );
  }

  const { messageId } = await sendViaMailService({
    from: env.ONBOARDING_EMAIL_FROM,
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    bcc: null,
    contactName: null,
  });

  return {
    messageId,
    to,
    overrideTo,
    subject: email.subject,
  };
}
