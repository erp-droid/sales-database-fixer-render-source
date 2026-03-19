import type { BusinessAccountRow } from "@/types/business-account";
import type {
  MailContactSuggestion,
  MailRecipient,
} from "@/types/mail-compose";
import type { MailLinkedContact } from "@/types/mail";

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function resolveRowBusinessAccountRecordId(row: BusinessAccountRow): string | null {
  const recordId = cleanText(row.accountRecordId) || cleanText(row.id);
  return recordId || null;
}

export function resolveRowContactId(row: BusinessAccountRow): number | null {
  return row.contactId ?? row.primaryContactId ?? null;
}

export function buildMailContactSuggestions(
  rows: BusinessAccountRow[],
): MailContactSuggestion[] {
  const byKey = new Map<string, MailContactSuggestion>();

  rows.forEach((row) => {
    const email = cleanText(row.primaryContactEmail).toLowerCase();
    if (!email) {
      return;
    }

    const contactId = resolveRowContactId(row);
    const businessAccountRecordId = resolveRowBusinessAccountRecordId(row);
    const key = `${email}::${contactId ?? "none"}::${businessAccountRecordId ?? "none"}`;
    const next: MailContactSuggestion = {
      key,
      email,
      name: cleanText(row.primaryContactName) || null,
      companyName: cleanText(row.companyName) || null,
      contactId,
      businessAccountRecordId,
      businessAccountId: cleanText(row.businessAccountId) || null,
    };

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, next);
      return;
    }

    byKey.set(key, {
      ...existing,
      name: next.name || existing.name,
      companyName: next.companyName || existing.companyName,
      contactId: next.contactId ?? existing.contactId,
      businessAccountRecordId:
        next.businessAccountRecordId ?? existing.businessAccountRecordId,
      businessAccountId: next.businessAccountId ?? existing.businessAccountId,
    });
  });

  return [...byKey.values()].sort((left, right) =>
    `${left.name ?? ""} ${left.email}`.localeCompare(
      `${right.name ?? ""} ${right.email}`,
      undefined,
      { sensitivity: "base", numeric: true },
    ),
  );
}

export function createMailRecipientFromSuggestion(
  suggestion: MailContactSuggestion,
): MailRecipient {
  return {
    email: suggestion.email,
    name: suggestion.name,
    contactId: suggestion.contactId,
    businessAccountRecordId: suggestion.businessAccountRecordId,
    businessAccountId: suggestion.businessAccountId,
  };
}

export function createLinkedContactFromSuggestion(
  suggestion: MailContactSuggestion | null,
): MailLinkedContact {
  if (!suggestion) {
    return {
      contactId: null,
      businessAccountRecordId: null,
      businessAccountId: null,
      contactName: null,
      companyName: null,
    };
  }

  return {
    contactId: suggestion.contactId,
    businessAccountRecordId: suggestion.businessAccountRecordId,
    businessAccountId: suggestion.businessAccountId,
    contactName: suggestion.name,
    companyName: suggestion.companyName,
  };
}

export function createLinkedContactFromRow(row: BusinessAccountRow): MailLinkedContact {
  return {
    contactId: resolveRowContactId(row),
    businessAccountRecordId: resolveRowBusinessAccountRecordId(row),
    businessAccountId: cleanText(row.businessAccountId) || null,
    contactName: cleanText(row.primaryContactName) || null,
    companyName: cleanText(row.companyName) || null,
  };
}

export function findSuggestionForLinkedContact(
  suggestions: MailContactSuggestion[],
  linkedContact: MailLinkedContact | null | undefined,
): MailContactSuggestion | null {
  if (!linkedContact) {
    return null;
  }

  if (linkedContact.contactId) {
    const byContactId =
      suggestions.find(
        (suggestion) =>
          suggestion.contactId === linkedContact.contactId &&
          suggestion.businessAccountRecordId === linkedContact.businessAccountRecordId,
      ) ?? suggestions.find((suggestion) => suggestion.contactId === linkedContact.contactId);
    if (byContactId) {
      return byContactId;
    }
  }

  const emailComparable = cleanText((linkedContact as { email?: string | null }).email).toLowerCase();
  if (emailComparable) {
    return (
      suggestions.find(
        (suggestion) => suggestion.email.toLowerCase() === emailComparable,
      ) ?? null
    );
  }

  return null;
}

export function dedupeMailRecipients(recipients: MailRecipient[]): MailRecipient[] {
  const byKey = new Map<string, MailRecipient>();

  recipients.forEach((recipient) => {
    const email = cleanText(recipient.email).toLowerCase();
    if (!email) {
      return;
    }

    const key = `${email}::${recipient.contactId ?? "none"}::${
      recipient.businessAccountRecordId ?? "none"
    }`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...recipient,
        email,
        name: cleanText(recipient.name) || null,
        businessAccountRecordId: cleanText(recipient.businessAccountRecordId) || null,
        businessAccountId: cleanText(recipient.businessAccountId) || null,
      });
    }
  });

  return [...byKey.values()];
}
