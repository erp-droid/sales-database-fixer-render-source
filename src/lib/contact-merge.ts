import { readWrappedNumber, readWrappedString } from "@/lib/acumatica";
import type { RawBusinessAccount, RawContact } from "@/lib/acumatica";
import type {
  ContactMergeFieldChoice,
  ContactMergeFieldKey,
  ContactMergePreviewContact,
  ContactMergePreviewField,
} from "@/types/contact-merge";

export type ContactMergeFieldMap = Record<ContactMergeFieldKey, string | null>;

export type NormalizedContactForMerge = {
  contactId: number | null;
  recordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  lastModifiedIso: string | null;
  fields: ContactMergeFieldMap;
};

export type ContactMergeAccountContext = {
  recordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  lastModifiedIso: string | null;
  contactIds: Set<number>;
};

export const CONTACT_MERGE_FIELD_LABELS: Record<ContactMergeFieldKey, string> = {
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  displayName: "Display name",
  jobTitle: "Job title",
  email: "Email",
  phone1: "Phone 1",
  phone2: "Phone 2",
  phone3: "Phone 3",
  website: "Website",
  notes: "Notes",
};

function emptyToNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeComparableValue(value: string | null | undefined): string {
  return emptyToNull(value)?.toLowerCase() ?? "";
}

function composeDisplayName(rawContact: RawContact): string | null {
  const explicit = emptyToNull(
    readWrappedString(rawContact, "DisplayName") ||
      readWrappedString(rawContact, "FullName") ||
      readWrappedString(rawContact, "ContactName") ||
      readWrappedString(rawContact, "Attention"),
  );
  if (explicit) {
    return explicit;
  }

  const composite = [
    emptyToNull(readWrappedString(rawContact, "FirstName")),
    emptyToNull(readWrappedString(rawContact, "MiddleName")),
    emptyToNull(readWrappedString(rawContact, "LastName")),
  ]
    .filter((value): value is string => value !== null)
    .join(" ")
    .trim();

  return composite || null;
}

function buildFieldMap(rawContact: RawContact): ContactMergeFieldMap {
  return {
    firstName: emptyToNull(readWrappedString(rawContact, "FirstName")),
    middleName: emptyToNull(readWrappedString(rawContact, "MiddleName")),
    lastName: emptyToNull(readWrappedString(rawContact, "LastName")),
    displayName: composeDisplayName(rawContact),
    jobTitle: emptyToNull(readWrappedString(rawContact, "JobTitle")),
    email: emptyToNull(
      readWrappedString(rawContact, "Email") || readWrappedString(rawContact, "EMail"),
    ),
    phone1: emptyToNull(readWrappedString(rawContact, "Phone1")),
    phone2: emptyToNull(readWrappedString(rawContact, "Phone2")),
    phone3: emptyToNull(readWrappedString(rawContact, "Phone3")),
    website: emptyToNull(readWrappedString(rawContact, "WebSite")),
    notes: emptyToNull(readWrappedString(rawContact, "note")),
  };
}

function normalizeDuplicateName(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !["mr", "mrs", "ms", "miss", "dr", "jr", "sr"].includes(token))
    .join(" ");
}

export function normalizeRawContactForMerge(rawContact: RawContact): NormalizedContactForMerge {
  const rawId =
    typeof rawContact.id === "string" && rawContact.id.trim() ? rawContact.id.trim() : null;
  const noteId = emptyToNull(readWrappedString(rawContact, "NoteID"));

  return {
    contactId: readWrappedNumber(rawContact, "ContactID"),
    recordId: rawId ?? noteId,
    businessAccountId: emptyToNull(
      readWrappedString(rawContact, "BusinessAccount") ||
        readWrappedString(rawContact, "BusinessAccountID") ||
        readWrappedString(rawContact, "BAccountID"),
    ),
    companyName: emptyToNull(readWrappedString(rawContact, "CompanyName")),
    lastModifiedIso: emptyToNull(readWrappedString(rawContact, "LastModifiedDateTime")),
    fields: buildFieldMap(rawContact),
  };
}

export function normalizeRawBusinessAccountForMerge(
  rawAccount: RawBusinessAccount,
): ContactMergeAccountContext {
  const rawId =
    typeof rawAccount.id === "string" && rawAccount.id.trim() ? rawAccount.id.trim() : null;
  const noteId = emptyToNull(readWrappedString(rawAccount, "NoteID"));
  const contacts = Array.isArray(rawAccount.Contacts)
    ? rawAccount.Contacts
    : Array.isArray((rawAccount.Contacts as { value?: unknown[] } | undefined)?.value)
      ? ((rawAccount.Contacts as { value?: unknown[] }).value ?? [])
      : [];

  return {
    recordId: rawId ?? noteId,
    businessAccountId: emptyToNull(
      readWrappedString(rawAccount, "BusinessAccountID") ||
        readWrappedString(rawAccount, "BAccountID") ||
        readWrappedString(rawAccount, "AccountCD"),
    ),
    companyName: emptyToNull(
      readWrappedString(rawAccount, "Name") ||
        readWrappedString(rawAccount, "CompanyName") ||
        readWrappedString(rawAccount, "AcctName"),
    ),
    lastModifiedIso: emptyToNull(readWrappedString(rawAccount, "LastModifiedDateTime")),
    contactIds: new Set(
      contacts
        .map((contact) => readWrappedNumber(contact, "ContactID"))
        .filter((value): value is number => value !== null),
    ),
  };
}

export function contactMergeValuesDiffer(
  values: Array<string | null | undefined>,
): boolean {
  if (values.length <= 1) {
    return false;
  }

  const normalizedValues = values.map((value) => normalizeComparableValue(value));
  return normalizedValues.some((value) => value !== normalizedValues[0]);
}

export function orderContactsForMerge<T extends { contactId: number | null }>(
  contacts: T[],
  keepContactId: number,
): T[] {
  const keepContact = contacts.find((contact) => contact.contactId === keepContactId);
  if (!keepContact) {
    return contacts.slice();
  }

  return [
    keepContact,
    ...contacts.filter((contact) => contact.contactId !== keepContactId),
  ];
}

function computeRecommendedFieldSourceContactId(
  orderedContacts: NormalizedContactForMerge[],
  field: ContactMergeFieldKey,
): number {
  const fallbackContactId = orderedContacts.find((contact) => contact.contactId !== null)?.contactId;
  if (fallbackContactId === null || fallbackContactId === undefined) {
    throw new Error("Selected contacts must include at least one contact ID.");
  }

  for (const contact of orderedContacts) {
    if (contact.contactId === null) {
      continue;
    }

    if (emptyToNull(contact.fields[field])) {
      return contact.contactId;
    }
  }

  return fallbackContactId;
}

export function buildContactMergePreviewContacts(
  orderedContacts: NormalizedContactForMerge[],
  primaryContactId: number | null,
): ContactMergePreviewContact[] {
  return orderedContacts
    .filter((contact): contact is NormalizedContactForMerge & { contactId: number } => {
      return contact.contactId !== null;
    })
    .map((contact) => ({
      contactId: contact.contactId,
      displayName: contact.fields.displayName,
      email: contact.fields.email,
      phone: contact.fields.phone1,
      isPrimary: primaryContactId === contact.contactId,
      lastModifiedIso: contact.lastModifiedIso,
    }));
}

export function buildContactMergePreviewFields(
  selectedContacts: NormalizedContactForMerge[],
  keepContactId: number,
): ContactMergePreviewField[] {
  const orderedContacts = orderContactsForMerge(selectedContacts, keepContactId).filter(
    (contact): contact is NormalizedContactForMerge & { contactId: number } => {
      return contact.contactId !== null;
    },
  );

  return (Object.keys(CONTACT_MERGE_FIELD_LABELS) as ContactMergeFieldKey[]).map((field) => {
    const values = orderedContacts.map((contact) => ({
      contactId: contact.contactId,
      value: contact.fields[field],
    }));

    return {
      field,
      label: CONTACT_MERGE_FIELD_LABELS[field],
      values,
      recommendedSourceContactId: computeRecommendedFieldSourceContactId(
        orderedContacts,
        field,
      ),
      valuesDiffer: contactMergeValuesDiffer(values.map((entry) => entry.value)),
    };
  });
}

export function buildSelectedMergeFieldMap(
  selectedContacts: NormalizedContactForMerge[],
  keepContactId: number,
  fieldChoices: ContactMergeFieldChoice[],
): ContactMergeFieldMap {
  const orderedContacts = orderContactsForMerge(selectedContacts, keepContactId);
  const contactsById = new Map<number, NormalizedContactForMerge>();

  orderedContacts.forEach((contact) => {
    if (contact.contactId !== null) {
      contactsById.set(contact.contactId, contact);
    }
  });

  const choicesByField = new Map<ContactMergeFieldKey, number>();
  fieldChoices.forEach((choice) => {
    choicesByField.set(choice.field, choice.sourceContactId);
  });

  return (Object.keys(CONTACT_MERGE_FIELD_LABELS) as ContactMergeFieldKey[]).reduce(
    (fields, field) => {
      const sourceContactId =
        choicesByField.get(field) ??
        computeRecommendedFieldSourceContactId(orderedContacts, field);
      fields[field] = contactsById.get(sourceContactId)?.fields[field] ?? null;
      return fields;
    },
    {} as ContactMergeFieldMap,
  );
}

export function buildMergedContactPayloadFromFieldMap(
  mergedFields: ContactMergeFieldMap,
): Record<string, unknown> {
  return {
    FirstName: {
      value: mergedFields.firstName ?? "",
    },
    MiddleName: {
      value: mergedFields.middleName ?? "",
    },
    LastName: {
      value: mergedFields.lastName ?? "",
    },
    DisplayName: {
      value: mergedFields.displayName ?? "",
    },
    JobTitle: {
      value: mergedFields.jobTitle ?? "",
    },
    Email: {
      value: mergedFields.email ?? "",
    },
    Phone1: {
      value: mergedFields.phone1 ?? "",
    },
    Phone2: {
      value: mergedFields.phone2 ?? "",
    },
    Phone3: {
      value: mergedFields.phone3 ?? "",
    },
    WebSite: {
      value: mergedFields.website ?? "",
    },
    note: {
      value: mergedFields.notes ?? "",
    },
  };
}

export function buildMergedContactPayload(
  selectedRawContacts: RawContact[],
  keepContactId: number,
  fieldChoices: ContactMergeFieldChoice[],
): Record<string, unknown> {
  const selectedContacts = selectedRawContacts.map((rawContact) =>
    normalizeRawContactForMerge(rawContact),
  );
  const mergedFields = buildSelectedMergeFieldMap(
    selectedContacts,
    keepContactId,
    fieldChoices,
  );
  return buildMergedContactPayloadFromFieldMap(mergedFields);
}

export function derivePrimaryRecommendation(
  keepIsPrimary: boolean,
  loserIsPrimary: boolean,
): boolean {
  return !keepIsPrimary && loserIsPrimary;
}

export function optimisticTimestampMatches(
  expected: string | null | undefined,
  actual: string | null | undefined,
): boolean {
  const normalizedExpected = expected?.trim() || null;
  const normalizedActual = actual?.trim() || null;

  if (normalizedExpected === normalizedActual) {
    return true;
  }

  if (normalizedExpected === null || normalizedActual === null) {
    return false;
  }

  const expectedMs = Date.parse(normalizedExpected);
  const actualMs = Date.parse(normalizedActual);

  if (Number.isNaN(expectedMs) || Number.isNaN(actualMs)) {
    return false;
  }

  if (expectedMs === actualMs) {
    return true;
  }

  return Math.trunc(expectedMs / 1000) === Math.trunc(actualMs / 1000);
}

export function isStillDuplicateContactSelection(
  selectedContacts: NormalizedContactForMerge[],
): boolean {
  if (selectedContacts.length < 2) {
    return false;
  }

  const normalizedNames = selectedContacts.map((contact) =>
    normalizeDuplicateName(contact.fields.displayName),
  );

  return normalizedNames.every((name) => name !== "") && new Set(normalizedNames).size === 1;
}

export function isStillDuplicateContactPair(
  keepContact: NormalizedContactForMerge,
  deleteContact: NormalizedContactForMerge,
): boolean {
  return isStillDuplicateContactSelection([keepContact, deleteContact]);
}
