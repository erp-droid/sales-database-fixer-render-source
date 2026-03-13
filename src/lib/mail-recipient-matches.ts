import { requireAuthCookieValue } from "@/lib/auth";
import {
  findContactsByEmailSubstring,
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import {
  filterSuppressedBusinessAccountRows,
} from "@/lib/business-accounts";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import type {
  MailComposePayload,
  MailMatchedContact,
  MailRecipient,
} from "@/types/mail-compose";
import type { NextRequest } from "next/server";

type AuthCookieRefreshState = {
  value: string | null;
};

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function splitEmails(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[;,]/)
    .map((part) => normalizeEmail(part))
    .filter(Boolean);
}

function isComposePayload(value: unknown): value is MailComposePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Array.isArray(record.to) && Array.isArray(record.cc) && Array.isArray(record.bcc);
}

function matchedContactKey(contact: MailMatchedContact): string {
  return `${contact.contactId}::${contact.businessAccountRecordId ?? contact.businessAccountId ?? "none"}`;
}

function buildMatchedContactFromRecipient(
  recipient: MailRecipient,
  companyName: string | null = null,
): MailMatchedContact | null {
  if (!recipient.contactId) {
    return null;
  }

  return {
    contactId: recipient.contactId,
    businessAccountRecordId: recipient.businessAccountRecordId ?? null,
    businessAccountId: recipient.businessAccountId ?? null,
    contactName: recipient.name ?? null,
    companyName,
    email: recipient.email ?? null,
  };
}

function buildMatchedContactFromRow(
  row: ReturnType<typeof filterSuppressedBusinessAccountRows>[number],
): MailMatchedContact | null {
  if (!row.contactId) {
    return null;
  }

  return {
    contactId: row.contactId,
    businessAccountRecordId: row.accountRecordId ?? row.id ?? null,
    businessAccountId: row.businessAccountId ?? null,
    contactName: row.primaryContactName ?? null,
    companyName: row.companyName ?? null,
    email: row.primaryContactEmail ?? null,
  };
}

function buildMatchedContactFromLiveContact(
  contact: Record<string, unknown>,
  recipientEmail: string,
): MailMatchedContact | null {
  const contactId = readWrappedNumber(contact, "ContactID");
  if (!contactId) {
    return null;
  }

  const exactEmails = splitEmails(
    readWrappedString(contact, "Email") || readWrappedString(contact, "EMail"),
  );
  if (exactEmails.length > 0 && !exactEmails.includes(recipientEmail)) {
    return null;
  }

  return {
    contactId,
    businessAccountRecordId: null,
    businessAccountId:
      readWrappedString(contact, "BusinessAccountID") ||
      readWrappedString(contact, "BAccountID") ||
      readWrappedString(contact, "BusinessAccount") ||
      null,
    contactName:
      readWrappedString(contact, "DisplayName") ||
      readWrappedString(contact, "FullName") ||
      readWrappedString(contact, "ContactName") ||
      null,
    companyName:
      readWrappedString(contact, "CompanyName") ||
      readWrappedString(contact, "AccountName") ||
      null,
    email: exactEmails.find((email) => email === recipientEmail) ?? recipientEmail,
  };
}

function pushMatchedContactByEmail(
  matchedContactsByEmail: Map<string, MailMatchedContact[]>,
  contact: MailMatchedContact,
): void {
  const comparableEmail = normalizeEmail(contact.email);
  if (!comparableEmail) {
    return;
  }

  const existing = matchedContactsByEmail.get(comparableEmail) ?? [];
  matchedContactsByEmail.set(comparableEmail, [...existing, contact]);
}

function hydrateRecipients(
  recipients: MailRecipient[],
  matchedContactsByEmail: Map<string, MailMatchedContact[]>,
): MailRecipient[] {
  return recipients.map((recipient) => {
    if (recipient.contactId) {
      return recipient;
    }

    const comparableEmail = normalizeEmail(recipient.email);
    const matchedContact = comparableEmail
      ? (matchedContactsByEmail.get(comparableEmail) ?? [])[0] ?? null
      : null;
    if (!matchedContact) {
      return recipient;
    }

    return {
      ...recipient,
      name: recipient.name ?? matchedContact.contactName ?? null,
      contactId: matchedContact.contactId,
      businessAccountRecordId:
        recipient.businessAccountRecordId ?? matchedContact.businessAccountRecordId ?? null,
      businessAccountId: recipient.businessAccountId ?? matchedContact.businessAccountId ?? null,
    };
  });
}

function collectMatchedContactsForRecipients(
  recipients: MailRecipient[],
  matchedContactsByEmail: Map<string, MailMatchedContact[]>,
): MailMatchedContact[] {
  const deduped = new Map<string, MailMatchedContact>();

  for (const recipient of recipients) {
    const comparableEmail = normalizeEmail(recipient.email);
    const emailMatches = comparableEmail
      ? matchedContactsByEmail.get(comparableEmail) ?? []
      : [];

    if (emailMatches.length > 0) {
      for (const matchedContact of emailMatches) {
        deduped.set(matchedContactKey(matchedContact), matchedContact);
      }
      continue;
    }

    const recipientMatch = buildMatchedContactFromRecipient(recipient);
    if (recipientMatch) {
      deduped.set(matchedContactKey(recipientMatch), recipientMatch);
    }
  }

  return [...deduped.values()];
}

function createLinkedContactFromMatchedContact(
  contact: MailMatchedContact | null | undefined,
): MailComposePayload["linkedContact"] {
  if (!contact) {
    return {
      contactId: null,
      businessAccountRecordId: null,
      businessAccountId: null,
      contactName: null,
      companyName: null,
    };
  }

  return {
    contactId: contact.contactId,
    businessAccountRecordId: contact.businessAccountRecordId ?? null,
    businessAccountId: contact.businessAccountId ?? null,
    contactName: contact.contactName ?? null,
    companyName: contact.companyName ?? null,
  };
}

function collectEmailsNeedingLookup(recipients: MailRecipient[]): Set<string> {
  return new Set(
    recipients
      .filter((recipient) => !recipient.contactId)
      .map((recipient) => normalizeEmail(recipient.email))
      .filter(Boolean),
  );
}

function appendMatchedContactsFromRows(
  rows: ReturnType<typeof filterSuppressedBusinessAccountRows>,
  recipientEmails: Set<string>,
  matchedContactsByEmail: Map<string, MailMatchedContact[]>,
): void {
  for (const row of rows) {
    const emails = splitEmails(row.primaryContactEmail);
    if (emails.length === 0 || !emails.some((email) => recipientEmails.has(email))) {
      continue;
    }

    const matchedContact = buildMatchedContactFromRow(row);
    if (!matchedContact) {
      continue;
    }

    pushMatchedContactByEmail(matchedContactsByEmail, matchedContact);
  }
}

export async function attachMatchedContactsToMailPayload(
  request: NextRequest,
  payload: unknown,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<Record<string, unknown>> {
  if (!isComposePayload(payload)) {
    return (payload ?? {}) as Record<string, unknown>;
  }

  const allRecipients = [...payload.to, ...payload.cc, ...payload.bcc];
  const recipientEmails = new Set(
    allRecipients.map((recipient) => normalizeEmail(recipient.email)).filter(Boolean),
  );
  if (recipientEmails.size === 0) {
    return payload as unknown as Record<string, unknown>;
  }

  const matchedContactsByEmail = new Map<string, MailMatchedContact[]>();
  let nextTo = payload.to;
  let nextCc = payload.cc;
  let nextBcc = payload.bcc;

  const unresolvedRecipientEmails = collectEmailsNeedingLookup(allRecipients);
  if (unresolvedRecipientEmails.size > 0) {
    try {
      appendMatchedContactsFromRows(
        filterSuppressedBusinessAccountRows(readAllAccountRowsFromReadModel(), {
          includeInternalRows: true,
        }),
        unresolvedRecipientEmails,
        matchedContactsByEmail,
      );
    } catch {
      // Fall back to live Acumatica lookup below.
    }

    nextTo = hydrateRecipients(payload.to, matchedContactsByEmail);
    nextCc = hydrateRecipients(payload.cc, matchedContactsByEmail);
    nextBcc = hydrateRecipients(payload.bcc, matchedContactsByEmail);

    const remainingUnresolvedEmails = collectEmailsNeedingLookup([
      ...nextTo,
      ...nextCc,
      ...nextBcc,
    ]);

    if (remainingUnresolvedEmails.size > 0) {
      const cookieValue = requireAuthCookieValue(request);
      const liveMatches = await Promise.all(
        [...remainingUnresolvedEmails].map(async (email) => ({
          email,
          contacts: await findContactsByEmailSubstring(
            cookieValue,
            email,
            authCookieRefresh,
          ),
        })),
      );

      for (const match of liveMatches) {
        for (const contact of match.contacts) {
          const matchedContact = buildMatchedContactFromLiveContact(
            contact as Record<string, unknown>,
            match.email,
          );
          if (!matchedContact) {
            continue;
          }

          pushMatchedContactByEmail(matchedContactsByEmail, matchedContact);
        }
      }

      nextTo = hydrateRecipients(nextTo, matchedContactsByEmail);
      nextCc = hydrateRecipients(nextCc, matchedContactsByEmail);
      nextBcc = hydrateRecipients(nextBcc, matchedContactsByEmail);
    }
  }
  const matchedContacts = collectMatchedContactsForRecipients(nextTo, matchedContactsByEmail);
  const nextLinkedContact =
    matchedContacts[0] != null
      ? createLinkedContactFromMatchedContact(matchedContacts[0])
      : payload.linkedContact;

  return {
    ...payload,
    to: nextTo,
    cc: nextCc,
    bcc: nextBcc,
    linkedContact: nextLinkedContact,
    matchedContacts,
  } as Record<string, unknown>;
}
