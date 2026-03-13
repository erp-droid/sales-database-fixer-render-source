import { NextRequest } from "next/server";

import {
  createActivity,
  fetchBusinessAccountById,
  fetchContactById,
  readWrappedString,
} from "@/lib/acumatica";
import { requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import {
  serviceCreateActivity,
  serviceFetchBusinessAccountById,
  serviceFetchContactById,
} from "@/lib/acumatica-service-auth";
import type { MailComposePayload, MailMatchedContact } from "@/types/mail-compose";

type AuthCookieRefreshState = {
  value: string | null;
};

type MailActivityPayload = {
  activitySyncStatus?: string | null;
  activityId?: string | null;
  activityIds?: string[] | null;
  activityError?: string | null;
  threadId?: string | null;
  messageId?: string | null;
};

type ActivityTargetHint = {
  contactId: number | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  contactName: string | null;
  companyName: string | null;
  email: string | null;
};

type ResolvedActivityTarget = {
  relatedEntityNoteId: string;
  relatedEntityType: "PX.Objects.CR.Contact" | "PX.Objects.CR.BAccount";
  label: string;
};

type MailActivityResolver = {
  fetchContactById: (contactId: number) => Promise<Record<string, unknown>>;
  fetchBusinessAccountById: (businessAccountId: string) => Promise<Record<string, unknown>>;
  createActivity: (
    input: {
      summary: string;
      bodyHtml: string;
      relatedEntityNoteId: string;
      relatedEntityType: "PX.Objects.CR.Contact" | "PX.Objects.CR.BAccount";
      type: string;
      status: string;
    },
  ) => Promise<Record<string, unknown>>;
};

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildRecipientSummary(
  label: string,
  recipients: MailComposePayload["to"] | MailComposePayload["cc"] | MailComposePayload["bcc"] | undefined,
): string {
  const parts = (recipients ?? [])
    .map((recipient) => {
      const email = cleanText(recipient.email);
      if (!email) {
        return "";
      }

      const name = cleanText(recipient.name);
      return name ? `${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;` : escapeHtml(email);
    })
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  return `<div><strong>${escapeHtml(label)}:</strong> ${parts.join("; ")}</div>`;
}

function buildActivityBodyHtml(
  payload: Partial<MailComposePayload>,
  response: MailActivityPayload,
): string {
  const metadata = [
    buildRecipientSummary("To", payload.to),
    buildRecipientSummary("Cc", payload.cc),
    buildRecipientSummary("Bcc", payload.bcc),
    response.messageId
      ? `<div><strong>Gmail Message ID:</strong> ${escapeHtml(response.messageId)}</div>`
      : "",
    response.threadId
      ? `<div><strong>Gmail Thread ID:</strong> ${escapeHtml(response.threadId)}</div>`
      : "",
  ].filter(Boolean);

  const htmlBody = cleanText(payload.htmlBody);
  if (htmlBody) {
    return `${metadata.join("")}${htmlBody}`;
  }

  const textBody = cleanText(payload.textBody);
  if (textBody) {
    return `${metadata.join("")}<p>${escapeHtml(textBody)}</p>`;
  }

  return metadata.join("") || "<p>Email sent from the MeadowBrook web app.</p>";
}

function readRecordIdentity(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) {
    return null;
  }

  const rawId = typeof record.id === "string" ? record.id.trim() : "";
  if (rawId) {
    return rawId;
  }

  return cleanText(readWrappedString(record, "NoteID")) || null;
}

export function isRepairableMailActivityPayload(value: unknown): value is MailActivityPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "activitySyncStatus" in value;
}

function shouldAttemptLocalRepair(payload: MailActivityPayload): boolean {
  const status = cleanText(payload.activitySyncStatus);
  return status === "failed" || status === "not_linked";
}

function asMatchedContacts(value: unknown): MailMatchedContact[] {
  return Array.isArray(value) ? (value as MailMatchedContact[]) : [];
}

function buildHintKey(hint: ActivityTargetHint): string {
  return [
    hint.contactId ?? "none",
    hint.businessAccountRecordId ?? "none",
    hint.businessAccountId ?? "none",
    cleanText(hint.email).toLowerCase() || "none",
  ].join("::");
}

function collectActivityTargetHints(payload: Partial<MailComposePayload>): ActivityTargetHint[] {
  const hints: ActivityTargetHint[] = [];
  const toEmails = new Set(
    (payload.to ?? [])
      .map((recipient) => normalizeEmail(recipient.email))
      .filter(Boolean),
  );

  for (const contact of asMatchedContacts(payload.matchedContacts)) {
    const comparableEmail = normalizeEmail(contact.email);
    if (toEmails.size > 0 && comparableEmail && !toEmails.has(comparableEmail)) {
      continue;
    }

    hints.push({
      contactId: contact.contactId ?? null,
      businessAccountRecordId: contact.businessAccountRecordId ?? null,
      businessAccountId: contact.businessAccountId ?? null,
      contactName: contact.contactName ?? null,
      companyName: contact.companyName ?? null,
      email: contact.email ?? null,
    });
  }

  const deduped = new Map<string, ActivityTargetHint>();
  for (const hint of hints) {
    deduped.set(buildHintKey(hint), hint);
  }

  return [...deduped.values()];
}

async function resolveContactTarget(
  resolver: MailActivityResolver,
  hint: ActivityTargetHint,
): Promise<ResolvedActivityTarget | null> {
  if (!hint.contactId) {
    return null;
  }

  const contact = await resolver.fetchContactById(hint.contactId);
  const contactRecordId = readRecordIdentity(contact);
  if (!contactRecordId) {
    return null;
  }

  return {
    relatedEntityNoteId: contactRecordId,
    relatedEntityType: "PX.Objects.CR.Contact",
    label: cleanText(hint.contactName) || `contact ${hint.contactId}`,
  };
}

async function resolveBusinessAccountTarget(
  resolver: MailActivityResolver,
  hint: ActivityTargetHint,
): Promise<ResolvedActivityTarget | null> {
  const recordId = cleanText(hint.businessAccountRecordId);
  if (recordId) {
    return {
      relatedEntityNoteId: recordId,
      relatedEntityType: "PX.Objects.CR.BAccount",
      label: cleanText(hint.businessAccountId) || cleanText(hint.companyName) || recordId,
    };
  }

  const businessAccountId = cleanText(hint.businessAccountId);
  if (!businessAccountId) {
    return null;
  }

  const businessAccount = await resolver.fetchBusinessAccountById(businessAccountId);
  const businessAccountRecordId = readRecordIdentity(businessAccount);
  if (!businessAccountRecordId) {
    return null;
  }

  return {
    relatedEntityNoteId: businessAccountRecordId,
    relatedEntityType: "PX.Objects.CR.BAccount",
    label: businessAccountId,
  };
}

async function resolveActivityTarget(
  resolver: MailActivityResolver,
  hint: ActivityTargetHint,
): Promise<ResolvedActivityTarget | null> {
  try {
    return (
      (await resolveContactTarget(resolver, hint)) ??
      (await resolveBusinessAccountTarget(resolver, hint))
    );
  } catch {
    try {
      return await resolveBusinessAccountTarget(resolver, hint);
    } catch {
      return null;
    }
  }
}

function mergeFailureMessage(existing: string | null | undefined, next: string): string {
  const current = cleanText(existing);
  return current ? `${current} | ${next}` : next;
}

async function repairMailActivitySyncWithResolver(
  resolver: MailActivityResolver,
  composePayload: Partial<MailComposePayload>,
  upstreamPayload: unknown,
): Promise<unknown> {
  if (!isRepairableMailActivityPayload(upstreamPayload)) {
    return upstreamPayload;
  }

  if (!shouldAttemptLocalRepair(upstreamPayload)) {
    return upstreamPayload;
  }

  const targetHints = collectActivityTargetHints(composePayload);
  if (targetHints.length === 0) {
    return upstreamPayload;
  }
  const resolvedTargets: ResolvedActivityTarget[] = [];
  const seenTargets = new Set<string>();

  for (const hint of targetHints) {
    const target = await resolveActivityTarget(resolver, hint);
    if (!target) {
      continue;
    }

    const dedupeKey = `${target.relatedEntityType}:${target.relatedEntityNoteId}`;
    if (seenTargets.has(dedupeKey)) {
      continue;
    }

    seenTargets.add(dedupeKey);
    resolvedTargets.push(target);
  }

  if (resolvedTargets.length === 0) {
    return upstreamPayload;
  }

  const activityIds: string[] = [];
  let mergedError = cleanText(upstreamPayload.activityError) || null;
  const bodyHtml = buildActivityBodyHtml(composePayload, upstreamPayload);
  const summary = cleanText(composePayload.subject) || "Email from MeadowBrook web app";

  for (const target of resolvedTargets) {
    try {
      const created = await resolver.createActivity({
        summary,
        bodyHtml,
        relatedEntityNoteId: target.relatedEntityNoteId,
        relatedEntityType: target.relatedEntityType,
        type: "M",
        status: "Completed",
      });

      const createdActivityId = readRecordIdentity(created);
      if (createdActivityId) {
        activityIds.push(createdActivityId);
      }
    } catch (error) {
      mergedError = mergeFailureMessage(
        mergedError,
        `Local Acumatica fallback failed for ${target.label}: ${getErrorMessage(error)}`,
      );
    }
  }

  if (activityIds.length === 0) {
    return {
      ...upstreamPayload,
      activityError:
        mergedError ??
        "Acumatica activity sync failed in both the mail service and the local fallback.",
    };
  }

  return {
    ...upstreamPayload,
    activitySyncStatus: "synced",
    activityId: activityIds[0] ?? upstreamPayload.activityId ?? null,
    activityIds,
    activityError: null,
  };
}

export async function repairMailActivitySync(
  request: NextRequest,
  composePayload: Partial<MailComposePayload>,
  upstreamPayload: unknown,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<unknown> {
  const cookieValue = requireAuthCookieValue(request);

  return repairMailActivitySyncWithResolver(
    {
      fetchContactById: (contactId) =>
        fetchContactById(cookieValue, contactId, authCookieRefresh),
      fetchBusinessAccountById: (businessAccountId) =>
        fetchBusinessAccountById(cookieValue, businessAccountId, authCookieRefresh),
      createActivity: (input) => createActivity(cookieValue, input, authCookieRefresh),
    },
    composePayload,
    upstreamPayload,
  );
}

export async function repairMailActivitySyncWithServiceSession(
  preferredLoginName: string | null | undefined,
  composePayload: Partial<MailComposePayload>,
  upstreamPayload: unknown,
): Promise<unknown> {
  return repairMailActivitySyncWithResolver(
    {
      fetchContactById: (contactId) =>
        serviceFetchContactById(preferredLoginName, contactId),
      fetchBusinessAccountById: (businessAccountId) =>
        serviceFetchBusinessAccountById(preferredLoginName, businessAccountId),
      createActivity: (input) => serviceCreateActivity(preferredLoginName, input),
    },
    composePayload,
    upstreamPayload,
  );
}
