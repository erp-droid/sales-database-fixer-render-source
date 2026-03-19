import type { BusinessAccountCreateRequest, BusinessAccountContactCreateRequest } from "@/types/business-account-create";
import type { MailComposePayload, MailRecipient, MailSendResponse } from "@/types/mail-compose";
import type { BusinessAccountRow } from "@/types/business-account";
import type { StoredDeferredActionRecord } from "@/lib/deferred-actions-store";
import type { CallSessionRecord } from "@/lib/call-analytics/types";
import type { StoredMeetingBooking } from "@/lib/meeting-bookings";

import { publishAuditLogChanged } from "@/lib/audit-log-live";
import type {
  AuditActionGroup,
  AuditAffectedField,
  AuditItemType,
  AuditLinkRole,
  AuditLogLink,
  AuditResultCode,
} from "@/lib/audit-log-types";
import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { getReadModelDb } from "@/lib/read-model/db";

type AuditActor = {
  loginName: string | null;
  name: string | null;
};

type AuditEventWriteInput = {
  id: string;
  occurredAt: string;
  itemType: AuditItemType;
  actionGroup: AuditActionGroup;
  resultCode: AuditResultCode;
  actorLoginName?: string | null;
  actorName?: string | null;
  sourceSurface?: string | null;
  summary: string;
  businessAccountRecordId?: string | null;
  businessAccountId?: string | null;
  companyName?: string | null;
  contactId?: number | null;
  contactName?: string | null;
  phoneNumber?: string | null;
  emailSubject?: string | null;
  emailThreadId?: string | null;
  emailMessageId?: string | null;
  callSessionId?: string | null;
  callDirection?: string | null;
  activitySyncStatus?: string | null;
  affectedFields?: AuditAffectedField[];
  links?: AuditLogLink[];
};

type WriteOptions = {
  notifyReason?: string | null;
};

type StoredAccountLink = {
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  contactId: number | null;
  contactName: string | null;
};

const BUSINESS_ACCOUNT_CREATE_FIELD_LABELS: Record<keyof BusinessAccountCreateRequest, string> = {
  companyName: "Company name",
  companyDescription: "Company description",
  classId: "Class",
  salesRepId: "Sales rep",
  salesRepName: "Sales rep",
  industryType: "Industry type",
  subCategory: "Sub-category",
  companyRegion: "Company region",
  week: "Week",
  category: "Category",
  addressLookupId: "Address lookup",
  addressLine1: "Address line 1",
  addressLine2: "Unit number",
  city: "City",
  state: "Province/State",
  postalCode: "Postal code",
  country: "Country",
};

const CONTACT_CREATE_FIELD_LABELS: Record<keyof BusinessAccountContactCreateRequest, string> = {
  displayName: "Display name",
  jobTitle: "Job title",
  email: "Email",
  phone1: "Phone",
  contactClass: "Contact class",
};

function cleanString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function cleanNullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fieldKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function dedupeFields(fields: AuditAffectedField[]): AuditAffectedField[] {
  const seen = new Set<string>();
  const normalized: AuditAffectedField[] = [];

  for (const field of fields) {
    const label = cleanString(field.label);
    if (!label) {
      continue;
    }

    const key = cleanString(field.key) ?? fieldKeyFromLabel(label);
    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({ key, label });
  }

  return normalized;
}

function dedupeLinks(links: AuditLogLink[]): AuditLogLink[] {
  const seen = new Set<string>();
  const normalized: AuditLogLink[] = [];

  for (const link of links) {
    const next: AuditLogLink = {
      linkType: link.linkType,
      role: link.role,
      businessAccountRecordId: cleanString(link.businessAccountRecordId),
      businessAccountId: cleanString(link.businessAccountId),
      companyName: cleanString(link.companyName),
      contactId: cleanNullableNumber(link.contactId),
      contactName: cleanString(link.contactName),
    };
    const key = [
      next.linkType,
      next.role,
      next.businessAccountRecordId ?? "",
      next.businessAccountId ?? "",
      next.contactId ?? "",
      next.contactName ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function buildSearchText(input: AuditEventWriteInput, fields: AuditAffectedField[], links: AuditLogLink[]): string {
  return [
    input.summary,
    input.itemType,
    input.actionGroup,
    input.resultCode,
    input.actorLoginName,
    input.actorName,
    input.sourceSurface,
    input.businessAccountRecordId,
    input.businessAccountId,
    input.companyName,
    input.contactName,
    input.contactId !== undefined && input.contactId !== null ? String(input.contactId) : "",
    input.phoneNumber,
    input.emailSubject,
    input.emailThreadId,
    input.emailMessageId,
    input.callSessionId,
    input.callDirection,
    input.activitySyncStatus,
    ...fields.map((field) => field.label),
    ...links.flatMap((link) => [
      link.linkType,
      link.role,
      link.businessAccountRecordId,
      link.businessAccountId,
      link.companyName,
      link.contactName,
      link.contactId !== null ? String(link.contactId) : null,
    ]),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function writeAuditEvent(input: AuditEventWriteInput, options: WriteOptions = {}): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const fields = dedupeFields(input.affectedFields ?? []);
  const links = dedupeLinks(input.links ?? []);
  const searchText = buildSearchText(input, fields, links);
  const transaction = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO audit_events (
        id,
        occurred_at,
        item_type,
        action_group,
        result_code,
        actor_login_name,
        actor_name,
        source_surface,
        summary,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name,
        phone_number,
        email_subject,
        email_thread_id,
        email_message_id,
        call_session_id,
        call_direction,
        activity_sync_status,
        search_text,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @occurred_at,
        @item_type,
        @action_group,
        @result_code,
        @actor_login_name,
        @actor_name,
        @source_surface,
        @summary,
        @business_account_record_id,
        @business_account_id,
        @company_name,
        @contact_id,
        @contact_name,
        @phone_number,
        @email_subject,
        @email_thread_id,
        @email_message_id,
        @call_session_id,
        @call_direction,
        @activity_sync_status,
        @search_text,
        COALESCE((SELECT created_at FROM audit_events WHERE id = @id), @updated_at),
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        occurred_at = excluded.occurred_at,
        item_type = excluded.item_type,
        action_group = excluded.action_group,
        result_code = excluded.result_code,
        actor_login_name = excluded.actor_login_name,
        actor_name = excluded.actor_name,
        source_surface = excluded.source_surface,
        summary = excluded.summary,
        business_account_record_id = excluded.business_account_record_id,
        business_account_id = excluded.business_account_id,
        company_name = excluded.company_name,
        contact_id = excluded.contact_id,
        contact_name = excluded.contact_name,
        phone_number = excluded.phone_number,
        email_subject = excluded.email_subject,
        email_thread_id = excluded.email_thread_id,
        email_message_id = excluded.email_message_id,
        call_session_id = excluded.call_session_id,
        call_direction = excluded.call_direction,
        activity_sync_status = excluded.activity_sync_status,
        search_text = excluded.search_text,
        updated_at = excluded.updated_at
      `,
    ).run({
      id: input.id,
      occurred_at: input.occurredAt,
      item_type: input.itemType,
      action_group: input.actionGroup,
      result_code: input.resultCode,
      actor_login_name: cleanString(input.actorLoginName),
      actor_name: cleanString(input.actorName),
      source_surface: cleanString(input.sourceSurface),
      summary: input.summary.trim(),
      business_account_record_id: cleanString(input.businessAccountRecordId),
      business_account_id: cleanString(input.businessAccountId),
      company_name: cleanString(input.companyName),
      contact_id: cleanNullableNumber(input.contactId),
      contact_name: cleanString(input.contactName),
      phone_number: cleanString(input.phoneNumber),
      email_subject: cleanString(input.emailSubject),
      email_thread_id: cleanString(input.emailThreadId),
      email_message_id: cleanString(input.emailMessageId),
      call_session_id: cleanString(input.callSessionId),
      call_direction: cleanString(input.callDirection),
      activity_sync_status: cleanString(input.activitySyncStatus),
      search_text: searchText,
      updated_at: now,
    });

    db.prepare(`DELETE FROM audit_event_fields WHERE audit_event_id = ?`).run(input.id);
    db.prepare(`DELETE FROM audit_event_links WHERE audit_event_id = ?`).run(input.id);

    const insertField = db.prepare(
      `
      INSERT INTO audit_event_fields (audit_event_id, field_key, field_label)
      VALUES (?, ?, ?)
      `,
    );
    for (const field of fields) {
      insertField.run(input.id, field.key, field.label);
    }

    const insertLink = db.prepare(
      `
      INSERT INTO audit_event_links (
        audit_event_id,
        link_type,
        role,
        business_account_record_id,
        business_account_id,
        company_name,
        contact_id,
        contact_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    for (const link of links) {
      insertLink.run(
        input.id,
        link.linkType,
        link.role,
        link.businessAccountRecordId,
        link.businessAccountId,
        link.companyName,
        link.contactId,
        link.contactName,
      );
    }
  });

  transaction();
  invalidateReadModelCaches();
  if (options.notifyReason) {
    publishAuditLogChanged(options.notifyReason);
  }
}

export function createAuditActor(input: AuditActor): AuditActor {
  return {
    loginName: cleanString(input.loginName),
    name: cleanString(input.name),
  };
}

export function createAuditEventId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function countAuditEvents(): number {
  const db = getReadModelDb();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM audit_events`).get() as { count: number };
  return row.count;
}

function buildAccountLink(
  role: AuditLinkRole,
  input: {
    businessAccountRecordId?: string | null;
    businessAccountId?: string | null;
    companyName?: string | null;
  },
): AuditLogLink | null {
  const businessAccountRecordId = cleanString(input.businessAccountRecordId);
  const businessAccountId = cleanString(input.businessAccountId);
  const companyName = cleanString(input.companyName);

  if (!businessAccountRecordId && !businessAccountId && !companyName) {
    return null;
  }

  return {
    linkType: "business_account",
    role,
    businessAccountRecordId,
    businessAccountId,
    companyName,
    contactId: null,
    contactName: null,
  };
}

function buildContactLink(
  role: AuditLinkRole,
  input: {
    businessAccountRecordId?: string | null;
    businessAccountId?: string | null;
    companyName?: string | null;
    contactId?: number | null;
    contactName?: string | null;
  },
): AuditLogLink | null {
  const contactId = cleanNullableNumber(input.contactId);
  const contactName = cleanString(input.contactName);
  if (contactId === null && !contactName) {
    return null;
  }

  return {
    linkType: "contact",
    role,
    businessAccountRecordId: cleanString(input.businessAccountRecordId),
    businessAccountId: cleanString(input.businessAccountId),
    companyName: cleanString(input.companyName),
    contactId,
    contactName,
  };
}

function buildFieldsFromCreateRequest<T extends Record<string, unknown>>(
  input: T,
  labels: Record<keyof T, string>,
  omittedKeys: ReadonlySet<string> = new Set(),
): AuditAffectedField[] {
  return (Object.keys(labels) as Array<keyof T>)
    .filter((key) => !omittedKeys.has(String(key)))
    .filter((key) => {
      const value = input[key];
      if (value === null || value === undefined) {
        return false;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return true;
    })
    .map((key) => ({
      key: String(key),
      label: labels[key],
    }));
}

function summarizeBusinessAccountCreate(
  resultCode: AuditResultCode,
  companyName: string,
  businessAccountId: string | null,
): string {
  if (resultCode === "failed") {
    return `Failed to create business account ${companyName}`;
  }

  return businessAccountId
    ? `Created business account ${companyName} (${businessAccountId})`
    : `Created business account ${companyName}`;
}

export function logBusinessAccountCreateAudit(input: {
  actor: AuditActor;
  request: BusinessAccountCreateRequest;
  resultCode: "succeeded" | "failed";
  sourceSurface?: string | null;
  businessAccountRecordId?: string | null;
  businessAccountId?: string | null;
  companyName?: string | null;
  createdRow?: BusinessAccountRow | null;
}): void {
  const companyName = cleanString(input.companyName) ?? input.request.companyName.trim();
  const businessAccountId = cleanString(input.businessAccountId) ?? input.createdRow?.businessAccountId ?? null;
  const businessAccountRecordId =
    cleanString(input.businessAccountRecordId) ??
    input.createdRow?.accountRecordId ??
    input.createdRow?.id ??
    null;
  const affectedFields = buildFieldsFromCreateRequest(
    input.request,
    BUSINESS_ACCOUNT_CREATE_FIELD_LABELS,
    new Set(["addressLookupId", "salesRepId"]),
  );
  const links = [
    buildAccountLink("primary", {
      businessAccountRecordId,
      businessAccountId,
      companyName,
    }),
    buildContactLink("primary", {
      businessAccountRecordId,
      businessAccountId,
      companyName,
      contactId: input.createdRow?.primaryContactId ?? null,
      contactName: input.createdRow?.primaryContactName ?? null,
    }),
  ].filter((link): link is AuditLogLink => link !== null);

  writeAuditEvent(
    {
      id: createAuditEventId("business-account-create"),
      occurredAt: new Date().toISOString(),
      itemType: "business_account",
      actionGroup: "business_account_create",
      resultCode: input.resultCode,
      actorLoginName: input.actor.loginName,
      actorName: input.actor.name,
      sourceSurface: input.sourceSurface ?? "accounts",
      summary: summarizeBusinessAccountCreate(input.resultCode, companyName, businessAccountId),
      businessAccountRecordId,
      businessAccountId,
      companyName,
      contactId: input.createdRow?.primaryContactId ?? null,
      contactName: input.createdRow?.primaryContactName ?? null,
      affectedFields,
      links,
    },
    { notifyReason: "business-account-create" },
  );
}

function summarizeContactCreate(resultCode: AuditResultCode, contactName: string, companyName: string | null): string {
  if (resultCode === "failed") {
    return companyName
      ? `Failed to create contact ${contactName} for ${companyName}`
      : `Failed to create contact ${contactName}`;
  }

  if (resultCode === "partial") {
    return companyName
      ? `Created contact ${contactName} for ${companyName}, but follow-up updates only partially completed`
      : `Created contact ${contactName}, but follow-up updates only partially completed`;
  }

  return companyName
    ? `Created contact ${contactName} for ${companyName}`
    : `Created contact ${contactName}`;
}

export function logContactCreateAudit(input: {
  actor: AuditActor;
  request: BusinessAccountContactCreateRequest;
  resultCode: "succeeded" | "partial" | "failed";
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  createdRow?: BusinessAccountRow | null;
  contactId?: number | null;
}): void {
  const contactName = cleanString(input.createdRow?.primaryContactName) ?? input.request.displayName.trim();
  const contactId = input.createdRow?.contactId ?? input.contactId ?? null;
  const affectedFields = buildFieldsFromCreateRequest(input.request, CONTACT_CREATE_FIELD_LABELS);
  const links = [
    buildAccountLink("primary", {
      businessAccountRecordId: input.businessAccountRecordId,
      businessAccountId: input.businessAccountId,
      companyName: input.companyName,
    }),
    buildContactLink("primary", {
      businessAccountRecordId: input.businessAccountRecordId,
      businessAccountId: input.businessAccountId,
      companyName: input.companyName,
      contactId,
      contactName,
    }),
  ].filter((link): link is AuditLogLink => link !== null);

  writeAuditEvent(
    {
      id: createAuditEventId("contact-create"),
      occurredAt: new Date().toISOString(),
      itemType: "contact",
      actionGroup: "contact_create",
      resultCode: input.resultCode,
      actorLoginName: input.actor.loginName,
      actorName: input.actor.name,
      sourceSurface: "accounts",
      summary: summarizeContactCreate(input.resultCode, contactName, input.companyName),
      businessAccountRecordId: input.businessAccountRecordId,
      businessAccountId: input.businessAccountId,
      companyName: input.companyName,
      contactId,
      contactName,
      phoneNumber: cleanString(input.createdRow?.primaryContactPhone) ?? cleanString(input.request.phone1),
      affectedFields,
      links,
    },
    { notifyReason: "contact-create" },
  );
}

function buildMailAffectedFields(payload: Partial<MailComposePayload>): AuditAffectedField[] {
  const fields: AuditAffectedField[] = [];
  if (cleanString(payload.subject)) {
    fields.push({ key: "subject", label: "Subject" });
  }
  if ((payload.to ?? []).length > 0) {
    fields.push({ key: "to", label: "To" });
  }
  if ((payload.cc ?? []).length > 0) {
    fields.push({ key: "cc", label: "Cc" });
  }
  if ((payload.bcc ?? []).length > 0) {
    fields.push({ key: "bcc", label: "Bcc" });
  }
  if ((payload.attachments ?? []).length > 0) {
    fields.push({ key: "attachments", label: "Attachments" });
  }
  if (payload.linkedContact?.contactId || cleanString(payload.linkedContact?.contactName)) {
    fields.push({ key: "linked_contact", label: "Linked contact" });
  }
  return fields;
}

function recipientToLink(recipient: MailRecipient): AuditLogLink | null {
  return buildContactLink("recipient", {
    businessAccountRecordId: recipient.businessAccountRecordId,
    businessAccountId: recipient.businessAccountId,
    contactId: recipient.contactId,
    contactName: recipient.name ?? recipient.email,
  });
}

function summarizeMailSend(
  resultCode: AuditResultCode,
  subject: string | null,
  recipientCount: number,
  activitySyncStatus: string | null,
): string {
  const subjectLabel = subject ? `"${subject}"` : "email";
  if (resultCode === "failed") {
    return `Failed to send ${subjectLabel}`;
  }
  if (resultCode === "partial" || activitySyncStatus === "failed") {
    return `Sent ${subjectLabel} to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}, but Acumatica activity sync failed`;
  }
  return `Sent ${subjectLabel} to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}`;
}

function summarizeMeetingCreate(booking: StoredMeetingBooking): string {
  const summary = cleanString(booking.meetingSummary) ?? "Meeting";
  const recordLabel =
    cleanString(booking.companyName) ??
    cleanString(booking.relatedContactName) ??
    null;
  const categoryLabel = cleanString(booking.category);
  const itemLabel =
    categoryLabel === "Drop Off"
      ? "drop off"
      : categoryLabel === "Meeting"
        ? "meeting"
        : "meeting";

  if (booking.inviteAuthority === null && booking.calendarInviteStatus === null) {
    return recordLabel
      ? `Imported historical ${itemLabel} "${summary}" for ${recordLabel}`
      : `Imported historical ${itemLabel} "${summary}"`;
  }

  return recordLabel ? `Booked ${itemLabel} "${summary}" for ${recordLabel}` : `Booked ${itemLabel} "${summary}"`;
}

export function upsertMeetingAuditEvent(
  booking: StoredMeetingBooking,
  options: WriteOptions = {},
): void {
  const attendeeLinks = booking.attendees
    .map((attendee) => {
      const resolved =
        attendee.contactId !== null
          ? resolveStoredAccountLink({
              contactId: attendee.contactId,
              businessAccountId: attendee.businessAccountId,
              companyName: attendee.companyName,
            })
          : {
              businessAccountRecordId: attendee.businessAccountRecordId,
              businessAccountId: attendee.businessAccountId,
              companyName: attendee.companyName,
              contactId: null,
              contactName: null,
            };

      return buildContactLink("attendee", {
        businessAccountRecordId:
          resolved.businessAccountRecordId ?? attendee.businessAccountRecordId,
        businessAccountId: resolved.businessAccountId ?? attendee.businessAccountId,
        companyName: resolved.companyName ?? attendee.companyName,
        contactId: attendee.contactId,
        contactName: attendee.contactName ?? attendee.email,
      });
    })
    .filter((link): link is AuditLogLink => link !== null);

  const links = [
    buildAccountLink("primary", {
      businessAccountRecordId: booking.businessAccountRecordId,
      businessAccountId: booking.businessAccountId,
      companyName: booking.companyName,
    }),
    buildContactLink("primary", {
      businessAccountRecordId: booking.businessAccountRecordId,
      businessAccountId: booking.businessAccountId,
      companyName: booking.companyName,
      contactId: booking.relatedContactId,
      contactName: booking.relatedContactName,
    }),
    ...attendeeLinks,
  ].filter((link): link is AuditLogLink => link !== null);

  const affectedFields: AuditAffectedField[] = [
    { key: "meeting_summary", label: "Meeting summary" },
    ...(booking.category ? [{ key: "category", label: "Category" } satisfies AuditAffectedField] : []),
    ...(booking.relatedContactName || booking.relatedContactId !== null
      ? [{ key: "related_contact", label: "Related contact" } satisfies AuditAffectedField]
      : []),
    ...(booking.companyName ? [{ key: "company", label: "Company" } satisfies AuditAffectedField] : []),
    ...(booking.attendees.length > 0
      ? [{ key: "attendees", label: "Attendees" } satisfies AuditAffectedField]
      : []),
  ];

  writeAuditEvent(
    {
      id: `meeting:${booking.eventId}`,
      occurredAt: booking.occurredAt,
      itemType: "meeting",
      actionGroup: "meeting_create",
      resultCode: booking.calendarInviteStatus === "failed" ? "partial" : "succeeded",
      actorLoginName: booking.actorLoginName,
      actorName: booking.actorName,
      sourceSurface:
        booking.inviteAuthority === null && booking.calendarInviteStatus === null
          ? "historical_import"
          : "accounts",
      summary: summarizeMeetingCreate(booking),
      businessAccountRecordId: booking.businessAccountRecordId,
      businessAccountId: booking.businessAccountId,
      companyName: booking.companyName,
      contactId: booking.relatedContactId,
      contactName: booking.relatedContactName,
      affectedFields,
      links,
    },
    options,
  );
}

export function logMailSendAudit(input: {
  actor: AuditActor;
  payload: Partial<MailComposePayload>;
  resultCode: "succeeded" | "partial" | "failed";
  response?: Partial<MailSendResponse> | null;
  auditEventId?: string | null;
}): void {
  const recipients = [...(input.payload.to ?? []), ...(input.payload.cc ?? []), ...(input.payload.bcc ?? [])];
  const linkedContact = input.payload.linkedContact ?? null;
  const businessAccountRecordId =
    cleanString(linkedContact?.businessAccountRecordId) ??
    cleanString(recipients.find((recipient) => recipient.businessAccountRecordId)?.businessAccountRecordId) ??
    null;
  const businessAccountId =
    cleanString(linkedContact?.businessAccountId) ??
    cleanString(recipients.find((recipient) => recipient.businessAccountId)?.businessAccountId) ??
    null;
  const contactId =
    cleanNullableNumber(linkedContact?.contactId) ??
    cleanNullableNumber(recipients.find((recipient) => recipient.contactId !== null)?.contactId) ??
    null;
  const contactName = cleanString(linkedContact?.contactName) ?? cleanString(recipients[0]?.name ?? null);
  const companyName = cleanString(linkedContact?.companyName) ?? null;
  const links = [
    buildAccountLink("primary", {
      businessAccountRecordId,
      businessAccountId,
      companyName,
    }),
    buildContactLink("linked_contact", {
      businessAccountRecordId,
      businessAccountId,
      companyName,
      contactId: linkedContact?.contactId ?? null,
      contactName: linkedContact?.contactName ?? null,
    }),
    ...recipients.map((recipient) => recipientToLink(recipient)),
  ].filter((link): link is AuditLogLink => link !== null);

  writeAuditEvent(
    {
      id: cleanString(input.auditEventId) ?? createAuditEventId("email-send"),
      occurredAt: new Date().toISOString(),
      itemType: "email",
      actionGroup: "email_send",
      resultCode: input.resultCode,
      actorLoginName: input.actor.loginName,
      actorName: input.actor.name,
      sourceSurface: input.payload.sourceSurface ?? "mail",
      summary: summarizeMailSend(
        input.resultCode,
        cleanString(input.payload.subject),
        recipients.length,
        cleanString(input.response?.activitySyncStatus),
      ),
      businessAccountRecordId,
      businessAccountId,
      companyName,
      contactId,
      contactName,
      emailSubject: cleanString(input.payload.subject),
      emailThreadId: cleanString(input.response?.threadId ?? null),
      emailMessageId: cleanString(input.response?.messageId ?? null),
      activitySyncStatus: cleanString(input.response?.activitySyncStatus ?? null),
      affectedFields: buildMailAffectedFields(input.payload),
      links,
    },
    { notifyReason: "email-send" },
  );
}

function resolveStoredAccountLink(input: {
  rowKey?: string | null;
  contactId?: number | null;
  businessAccountId?: string | null;
  companyName?: string | null;
}): StoredAccountLink {
  const db = getReadModelDb();

  const byRowKey =
    cleanString(input.rowKey) !== null
      ? (db
          .prepare(
            `
            SELECT
              account_record_id,
              business_account_id,
              company_name,
              contact_id,
              primary_contact_name
            FROM account_rows
            WHERE row_key = ?
            LIMIT 1
            `,
          )
          .get(input.rowKey) as
          | {
              account_record_id: string | null;
              business_account_id: string | null;
              company_name: string | null;
              contact_id: number | null;
              primary_contact_name: string | null;
            }
          | undefined)
      : undefined;

  if (byRowKey) {
    return {
      businessAccountRecordId: byRowKey.account_record_id,
      businessAccountId: byRowKey.business_account_id,
      companyName: byRowKey.company_name,
      contactId: byRowKey.contact_id,
      contactName: byRowKey.primary_contact_name,
    };
  }

  const byContact =
    cleanNullableNumber(input.contactId) !== null
      ? (db
          .prepare(
            `
            SELECT
              account_record_id,
              business_account_id,
              company_name,
              contact_id,
              primary_contact_name
            FROM account_rows
            WHERE contact_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            `,
          )
          .get(input.contactId) as
          | {
              account_record_id: string | null;
              business_account_id: string | null;
              company_name: string | null;
              contact_id: number | null;
              primary_contact_name: string | null;
            }
          | undefined)
      : undefined;

  if (byContact) {
    return {
      businessAccountRecordId: byContact.account_record_id,
      businessAccountId: byContact.business_account_id,
      companyName: byContact.company_name,
      contactId: byContact.contact_id,
      contactName: byContact.primary_contact_name,
    };
  }

  const byAccount =
    cleanString(input.businessAccountId) !== null
      ? (db
          .prepare(
            `
            SELECT
              account_record_id,
              business_account_id,
              company_name,
              contact_id,
              primary_contact_name
            FROM account_rows
            WHERE business_account_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            `,
          )
          .get(input.businessAccountId) as
          | {
              account_record_id: string | null;
              business_account_id: string | null;
              company_name: string | null;
              contact_id: number | null;
              primary_contact_name: string | null;
            }
          | undefined)
      : undefined;

  return {
    businessAccountRecordId: byAccount?.account_record_id ?? null,
    businessAccountId: byAccount?.business_account_id ?? cleanString(input.businessAccountId),
    companyName: byAccount?.company_name ?? cleanString(input.companyName),
    contactId: byAccount?.contact_id ?? null,
    contactName: byAccount?.primary_contact_name ?? null,
  };
}

function summarizeCall(session: CallSessionRecord): string {
  const outcomeLabel = session.answered ? "Answered" : "Not answered";
  const directionLabel =
    session.direction === "inbound"
      ? "inbound"
      : session.direction === "outbound"
        ? "outbound"
        : "call";
  const target =
    cleanString(session.matchedContactName) ??
    cleanString(session.matchedCompanyName) ??
    cleanString(session.counterpartyPhone) ??
    cleanString(session.targetPhone) ??
    cleanString(session.presentedCallerId);

  return target ? `${outcomeLabel} ${directionLabel} call with ${target}` : `${outcomeLabel} ${directionLabel} call`;
}

export function upsertCallAuditEvent(session: CallSessionRecord, options: WriteOptions = {}): void {
  const actorLoginName =
    cleanString(session.employeeLoginName) ??
    cleanString(session.recipientEmployeeLoginName) ??
    null;
  const actorName =
    cleanString(session.employeeDisplayName) ??
    cleanString(session.recipientEmployeeDisplayName) ??
    null;
  const resolved = resolveStoredAccountLink({
    rowKey: session.linkedAccountRowKey,
    contactId: session.matchedContactId ?? session.linkedContactId ?? null,
    businessAccountId: session.matchedBusinessAccountId ?? session.linkedBusinessAccountId ?? null,
    companyName: session.matchedCompanyName ?? null,
  });
  const links = [
    buildAccountLink("primary", resolved),
    buildContactLink("matched_contact", {
      businessAccountRecordId: resolved.businessAccountRecordId,
      businessAccountId: resolved.businessAccountId,
      companyName: resolved.companyName,
      contactId: session.matchedContactId,
      contactName: session.matchedContactName,
    }),
    buildContactLink("linked_contact", {
      businessAccountRecordId: resolved.businessAccountRecordId,
      businessAccountId: resolved.businessAccountId,
      companyName: resolved.companyName,
      contactId: session.linkedContactId,
      contactName: session.matchedContactName,
    }),
  ].filter((link): link is AuditLogLink => link !== null);

  writeAuditEvent(
    {
      id: `call:${session.sessionId}`,
      occurredAt: session.startedAt ?? session.updatedAt,
      itemType: "call",
      actionGroup: "call",
      resultCode: session.answered ? "answered" : "not_answered",
      actorLoginName,
      actorName,
      sourceSurface: session.initiatedFromSurface,
      summary: summarizeCall(session),
      businessAccountRecordId: resolved.businessAccountRecordId,
      businessAccountId: resolved.businessAccountId,
      companyName: resolved.companyName ?? cleanString(session.matchedCompanyName),
      contactId: session.matchedContactId ?? session.linkedContactId ?? null,
      contactName: cleanString(session.matchedContactName) ?? resolved.contactName,
      phoneNumber: cleanString(session.counterpartyPhone) ?? cleanString(session.targetPhone),
      callSessionId: session.sessionId,
      callDirection: session.direction,
      links,
    },
    options,
  );
}

function buildDeferredActionFields(record: StoredDeferredActionRecord): AuditAffectedField[] {
  const labels = record.affectedFields.length > 0 ? record.affectedFields : ["Contact record"];
  return labels.map((label) => ({
    key: fieldKeyFromLabel(label),
    label,
  }));
}

function buildDeferredActionLinks(record: StoredDeferredActionRecord): AuditLogLink[] {
  const links: AuditLogLink[] = [];
  const accountLink = buildAccountLink("primary", {
    businessAccountRecordId: record.businessAccountRecordId,
    businessAccountId: record.businessAccountId,
    companyName: record.companyName,
  });
  if (accountLink) {
    links.push(accountLink);
  }

  if (record.actionType === "deleteContact") {
    const contactLink = buildContactLink("primary", {
      businessAccountRecordId: record.businessAccountRecordId,
      businessAccountId: record.businessAccountId,
      companyName: record.companyName,
      contactId: record.contactId,
      contactName: record.contactName,
    });
    if (contactLink) {
      links.push(contactLink);
    }
    return links;
  }

  const keptLink = buildContactLink("merged_into", {
    businessAccountRecordId: record.businessAccountRecordId,
    businessAccountId: record.businessAccountId,
    companyName: record.companyName,
    contactId: record.keptContactId,
    contactName: record.keptContactName,
  });
  if (keptLink) {
    links.push(keptLink);
  }

  record.loserContactIds.forEach((contactId, index) => {
    const link = buildContactLink("merged_from", {
      businessAccountRecordId: record.businessAccountRecordId,
      businessAccountId: record.businessAccountId,
      companyName: record.companyName,
      contactId,
      contactName: record.loserContactNames[index] ?? `Contact ${contactId}`,
    });
    if (link) {
      links.push(link);
    }
  });

  return links;
}

function summarizeDeferredAction(
  record: StoredDeferredActionRecord,
  resultCode: AuditResultCode,
): string {
  if (record.actionType === "deleteContact") {
    const name = cleanString(record.contactName) ?? (record.contactId !== null ? `Contact ${record.contactId}` : "contact");
    const company = cleanString(record.companyName);
    const target = company ? `${name} at ${company}` : name;
    const reason = cleanString(record.reason);
    const withReason = (summary: string): string =>
      reason ? `${summary}. Reason: ${reason}` : summary;
    switch (resultCode) {
      case "queued":
        return withReason(`Queued contact deletion for ${target}`);
      case "approved":
        return withReason(`Approved queued contact deletion for ${target}`);
      case "cancelled":
        return withReason(`Cancelled queued contact deletion for ${target}`);
      case "executed":
        return withReason(`Executed contact deletion for ${target}`);
      default:
        return withReason(`Failed queued contact deletion for ${target}`);
    }
  }

  const keptName =
    cleanString(record.keptContactName) ??
    (record.keptContactId !== null ? `Contact ${record.keptContactId}` : "kept contact");
  const company = cleanString(record.companyName);
  const loserCount = record.loserContactIds.length;
  const target = company ? `${keptName} at ${company}` : keptName;
  switch (resultCode) {
    case "queued":
      return `Queued merge of ${loserCount} contact${loserCount === 1 ? "" : "s"} into ${target}`;
    case "approved":
      return `Approved queued merge into ${target}`;
    case "cancelled":
      return `Cancelled queued merge into ${target}`;
    case "executed":
      return `Executed merge into ${target}`;
    default:
      return `Failed queued merge into ${target}`;
  }
}

function writeDeferredLifecycleEvent(
  record: StoredDeferredActionRecord,
  resultCode: Exclude<AuditResultCode, "answered" | "not_answered" | "succeeded" | "partial">,
  occurredAt: string | null,
  actor: AuditActor,
): void {
  if (!occurredAt) {
    return;
  }

  writeAuditEvent(
    {
      id: `deferred:${record.id}:${resultCode}`,
      occurredAt,
      itemType: "contact",
      actionGroup: record.actionType === "deleteContact" ? "contact_delete" : "contact_merge",
      resultCode,
      actorLoginName: actor.loginName,
      actorName: actor.name,
      sourceSurface: record.sourceSurface,
      summary: summarizeDeferredAction(record, resultCode),
      businessAccountRecordId: record.businessAccountRecordId,
      businessAccountId: record.businessAccountId,
      companyName: record.companyName,
      contactId: record.actionType === "deleteContact" ? record.contactId : record.keptContactId,
      contactName:
        record.actionType === "deleteContact" ? record.contactName : record.keptContactName,
      affectedFields: buildDeferredActionFields(record),
      links: buildDeferredActionLinks(record),
    },
    { notifyReason: `deferred-${record.actionType}-${resultCode}` },
  );
}

export function upsertDeferredActionAuditEvents(record: StoredDeferredActionRecord): void {
  writeDeferredLifecycleEvent(
    record,
    "queued",
    record.requestedAt,
    createAuditActor({
      loginName: record.requestedByLoginName,
      name: record.requestedByName,
    }),
  );
  writeDeferredLifecycleEvent(
    record,
    "approved",
    record.approvedAt,
    createAuditActor({
      loginName: record.approvedByLoginName,
      name: record.approvedByName,
    }),
  );
  writeDeferredLifecycleEvent(
    record,
    "cancelled",
    record.cancelledAt,
    createAuditActor({
      loginName: record.cancelledByLoginName,
      name: record.cancelledByName,
    }),
  );
  writeDeferredLifecycleEvent(
    record,
    "executed",
    record.executedAt,
    createAuditActor({
      loginName: record.executedByLoginName,
      name: record.executedByName,
    }),
  );
  if (record.status === "failed" || cleanString(record.failureMessage)) {
    writeDeferredLifecycleEvent(
      record,
      "failed",
      record.updatedAt,
      createAuditActor({
        loginName: record.executedByLoginName,
        name: record.executedByName,
      }),
    );
  }
}
