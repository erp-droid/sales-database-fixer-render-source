import { readWrappedNumber, readWrappedString } from "@/lib/acumatica";
import type { RawBusinessAccount, RawContact } from "@/lib/acumatica";
import type {
  ContactMergeFieldChoice,
  ContactMergeFieldKey,
  ContactMergeFieldSource,
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
  const rawId = typeof rawContact.id === "string" && rawContact.id.trim() ? rawContact.id.trim() : null;
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
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return normalizeComparableValue(left) !== normalizeComparableValue(right);
}

export function computeRecommendedFieldSource(
  keepValue: string | null | undefined,
  deleteValue: string | null | undefined,
): ContactMergeFieldSource {
  const normalizedKeep = emptyToNull(keepValue);
  const normalizedDelete = emptyToNull(deleteValue);

  if (normalizedKeep) {
    return "keep";
  }

  if (normalizedDelete) {
    return "delete";
  }

  return "keep";
}

export function buildContactMergePreviewFields(
  keepContact: NormalizedContactForMerge,
  deleteContact: NormalizedContactForMerge,
): ContactMergePreviewField[] {
  return (Object.keys(CONTACT_MERGE_FIELD_LABELS) as ContactMergeFieldKey[]).map((field) => {
    const keepValue = keepContact.fields[field];
    const deleteValue = deleteContact.fields[field];
    return {
      field,
      label: CONTACT_MERGE_FIELD_LABELS[field],
      keepValue,
      deleteValue,
      recommendedSource: computeRecommendedFieldSource(keepValue, deleteValue),
      valuesDiffer: contactMergeValuesDiffer(keepValue, deleteValue),
    };
  });
}

export function buildSelectedMergeFieldMap(
  keepContact: NormalizedContactForMerge,
  deleteContact: NormalizedContactForMerge,
  fieldChoices: ContactMergeFieldChoice[],
): ContactMergeFieldMap {
  const choicesByField = new Map<ContactMergeFieldKey, ContactMergeFieldSource>();
  fieldChoices.forEach((choice) => {
    choicesByField.set(choice.field, choice.source);
  });

  return (Object.keys(CONTACT_MERGE_FIELD_LABELS) as ContactMergeFieldKey[]).reduce(
    (fields, field) => {
      const source =
        choicesByField.get(field) ??
        computeRecommendedFieldSource(
          keepContact.fields[field],
          deleteContact.fields[field],
        );
      fields[field] =
        source === "delete" ? deleteContact.fields[field] : keepContact.fields[field];
      return fields;
    },
    {} as ContactMergeFieldMap,
  );
}

export function buildMergedContactPayload(
  keepRaw: RawContact,
  deleteRaw: RawContact,
  fieldChoices: ContactMergeFieldChoice[],
): Record<string, unknown> {
  const keepContact = normalizeRawContactForMerge(keepRaw);
  const deleteContact = normalizeRawContactForMerge(deleteRaw);
  const mergedFields = buildSelectedMergeFieldMap(keepContact, deleteContact, fieldChoices);

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

export function derivePrimaryRecommendation(
  keepIsPrimary: boolean,
  deleteIsPrimary: boolean,
): boolean {
  return !keepIsPrimary && deleteIsPrimary;
}

export function optimisticTimestampMatches(
  expected: string | null | undefined,
  actual: string | null | undefined,
): boolean {
  return (expected ?? null) === (actual ?? null);
}

export function isStillDuplicateContactPair(
  keepContact: NormalizedContactForMerge,
  deleteContact: NormalizedContactForMerge,
): boolean {
  return (
    normalizeDuplicateName(keepContact.fields.displayName) !== "" &&
    normalizeDuplicateName(keepContact.fields.displayName) ===
      normalizeDuplicateName(deleteContact.fields.displayName)
  );
}
