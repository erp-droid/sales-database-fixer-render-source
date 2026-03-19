import {
  type AuthCookieRefreshState,
  fetchBusinessAccountById,
  fetchContactById,
  fetchContactsByBusinessAccountIds,
  invokeBusinessAccountAction,
  updateCustomer,
  updateBusinessAccount,
  type RawBusinessAccount,
  type RawContact,
} from "@/lib/acumatica";
import {
  buildBusinessAccountIdentityPayload,
  buildBusinessAccountUpdateIdentifiers,
  buildPrimaryContactFallbackPayloads,
  normalizeBusinessAccountRows,
  readRawBusinessAccountPrimaryContactId,
  resolveBusinessAccountRecordId,
  withAccountContacts,
} from "@/lib/business-accounts";
import {
  isStillDuplicateContactSelection,
  normalizeRawBusinessAccountForMerge,
  normalizeRawContactForMerge,
} from "@/lib/contact-merge";
import { HttpError } from "@/lib/errors";
import type { BusinessAccountRow } from "@/types/business-account";

function readAccountContacts(rawAccount: RawBusinessAccount): RawContact[] {
  const directContacts = rawAccount.Contacts;
  if (Array.isArray(directContacts)) {
    return directContacts as RawContact[];
  }

  if (
    directContacts &&
    typeof directContacts === "object" &&
    Array.isArray((directContacts as { value?: unknown[] }).value)
  ) {
    return ((directContacts as { value?: unknown[] }).value ?? []) as RawContact[];
  }

  return [];
}

function readWrappedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function findAccountScopedContact(
  rawAccount: RawBusinessAccount,
  targetContactId: number,
): RawContact | null {
  const contacts = readAccountContacts(rawAccount);
  for (const contact of contacts) {
    if (readWrappedNumber(contact, "ContactID") === targetContactId) {
      return contact;
    }
  }

  return null;
}

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type ContactMergeServerContext = {
  rawAccount: RawBusinessAccount;
  rawAccountWithContacts: RawBusinessAccount;
  resolvedRecordId: string;
  updateIdentifiers: string[];
  identityPayload: Record<string, unknown>;
};

export async function fetchSelectedContactsForMerge(
  cookieValue: string,
  contactIds: number[],
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawContact[]> {
  const uniqueContactIds = [...new Set(contactIds)];
  const contactsById = new Map<number, RawContact>();

  await Promise.all(
    uniqueContactIds.map(async (contactId) => {
      contactsById.set(
        contactId,
        await fetchContactById(cookieValue, contactId, authCookieRefresh),
      );
    }),
  );

  return contactIds.map((contactId) => {
    const rawContact = contactsById.get(contactId);
    if (!rawContact) {
      throw new HttpError(422, `Contact ${contactId} could not be loaded.`);
    }
    return rawContact;
  });
}

export async function fetchContactMergeServerContext(
  cookieValue: string,
  businessAccountRecordId: string,
  authCookieRefresh?: AuthCookieRefreshState,
  options?: {
    includeContacts?: boolean;
  },
): Promise<ContactMergeServerContext> {
  const rawAccount = await fetchBusinessAccountById(
    cookieValue,
    businessAccountRecordId,
    authCookieRefresh,
  );
  const accountContext = normalizeRawBusinessAccountForMerge(rawAccount);

  if (!accountContext.businessAccountId) {
    throw new HttpError(
      422,
      "Business account ID is missing on this account. Contact merge cannot continue.",
    );
  }

  let rawAccountWithContacts = rawAccount;
  if (options?.includeContacts !== false) {
    let accountContacts = readAccountContacts(rawAccount);
    if (accountContacts.length === 0) {
      accountContacts = await fetchContactsByBusinessAccountIds(
        cookieValue,
        [accountContext.businessAccountId],
        authCookieRefresh,
      );
    }
    rawAccountWithContacts = withAccountContacts(rawAccount, accountContacts) as RawBusinessAccount;
  }

  return {
    rawAccount,
    rawAccountWithContacts,
    resolvedRecordId: resolveBusinessAccountRecordId(rawAccount, businessAccountRecordId),
    updateIdentifiers: buildBusinessAccountUpdateIdentifiers(rawAccount, businessAccountRecordId),
    identityPayload: buildBusinessAccountIdentityPayload(rawAccount),
  };
}

export function validateContactMergeScope(
  rawAccountWithContacts: RawBusinessAccount,
  keepRawContact: RawContact,
  selectedRawContacts: RawContact[],
): {
  warnings: string[];
  keepIsPrimary: boolean;
  primaryContactId: number | null;
} {
  const account = normalizeRawBusinessAccountForMerge(rawAccountWithContacts);
  const keepContact = normalizeRawContactForMerge(keepRawContact);
  const selectedContacts = selectedRawContacts.map((rawContact) =>
    normalizeRawContactForMerge(rawContact),
  );

  if (!account.businessAccountId) {
    throw new HttpError(422, "Business account ID is missing on this account.");
  }

  if (selectedContacts.length < 2) {
    throw new HttpError(422, "Select at least 2 contacts to merge.");
  }

  if (!keepContact.contactId) {
    throw new HttpError(
      422,
      "The kept contact has no ContactID. Contact merge cannot continue.",
    );
  }

  const selectedContactIds = new Set<number>();
  for (const contact of selectedContacts) {
    if (!contact.contactId) {
      throw new HttpError(
        422,
        "One of the selected contacts has no ContactID. Contact merge cannot continue.",
      );
    }

    if (selectedContactIds.has(contact.contactId)) {
      throw new HttpError(422, "Selected contact IDs must be unique.");
    }

    selectedContactIds.add(contact.contactId);
  }

  if (!selectedContactIds.has(keepContact.contactId)) {
    throw new HttpError(422, "Keep contact ID must be included in the selected contacts.");
  }

  if (
    keepContact.businessAccountId &&
    keepContact.businessAccountId !== account.businessAccountId
  ) {
    throw new HttpError(
      422,
      "The selected keep contact no longer belongs to this business account.",
    );
  }

  for (const contact of selectedContacts) {
    if (
      contact.businessAccountId &&
      contact.businessAccountId !== account.businessAccountId
    ) {
      throw new HttpError(
        422,
        "All selected contacts must belong to the selected business account before they can be merged.",
      );
    }
  }

  if (
    account.contactIds.size > 0 &&
    [...selectedContactIds].some((contactId) => !account.contactIds.has(contactId))
  ) {
    throw new HttpError(
      422,
      "All selected contacts must belong to the selected business account before they can be merged.",
    );
  }

  const primaryContactId = readRawBusinessAccountPrimaryContactId(rawAccountWithContacts);
  const keepIsPrimary = primaryContactId === keepContact.contactId;
  const warnings: string[] = [];

  if (!isStillDuplicateContactSelection(selectedContacts)) {
    warnings.push(
      "These records no longer match duplicate rules, but they can still be merged.",
    );
  }

  return {
    warnings,
    keepIsPrimary,
    primaryContactId,
  };
}

export async function setBusinessAccountPrimaryContact(
  cookieValue: string,
  context: ContactMergeServerContext,
  targetContactId: number,
  authCookieRefresh?: AuthCookieRefreshState,
  targetRawContact?: RawContact | null,
): Promise<RawBusinessAccount> {
  let verificationRaw = await fetchBusinessAccountById(
    cookieValue,
    context.resolvedRecordId,
    authCookieRefresh,
  );
  let verifiedPrimaryContactId = readRawBusinessAccountPrimaryContactId(verificationRaw);
  const accountScopedTargetRawContact =
    findAccountScopedContact(verificationRaw, targetContactId) ??
    findAccountScopedContact(context.rawAccountWithContacts, targetContactId) ??
    findAccountScopedContact(context.rawAccount, targetContactId) ??
    targetRawContact ??
    null;
  const customerId =
    readWrappedString(verificationRaw, "BusinessAccountID") ??
    readWrappedString(context.rawAccountWithContacts, "BusinessAccountID") ??
    readWrappedString(context.rawAccount, "BusinessAccountID");

  if (verifiedPrimaryContactId !== targetContactId && customerId) {
    try {
      await updateCustomer(
        cookieValue,
        {
          CustomerID: {
            value: customerId,
          },
          PrimaryContactID: {
            value: targetContactId,
          },
        },
        authCookieRefresh,
      );

      verificationRaw = await fetchBusinessAccountById(
        cookieValue,
        context.resolvedRecordId,
        authCookieRefresh,
      );
      verifiedPrimaryContactId = readRawBusinessAccountPrimaryContactId(verificationRaw);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
    }
  }

  if (verifiedPrimaryContactId !== targetContactId) {
    const targetContactRecordId =
      accountScopedTargetRawContact &&
      typeof accountScopedTargetRawContact === "object" &&
      typeof accountScopedTargetRawContact.id === "string"
        ? accountScopedTargetRawContact.id.trim()
        : null;

    try {
      await invokeBusinessAccountAction(
        cookieValue,
        "makeContactPrimary",
        {
          ...buildBusinessAccountIdentityPayload(verificationRaw),
          Contacts: [
            {
              ...(targetContactRecordId ? { id: targetContactRecordId } : {}),
              ContactID: {
                value: targetContactId,
              },
            },
          ],
        },
        {},
        authCookieRefresh,
      );

      verificationRaw = await fetchBusinessAccountById(
        cookieValue,
        context.resolvedRecordId,
        authCookieRefresh,
      );
      verifiedPrimaryContactId = readRawBusinessAccountPrimaryContactId(verificationRaw);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
    }
  }

  if (verifiedPrimaryContactId !== targetContactId) {
    const fallbackPayloads = buildPrimaryContactFallbackPayloads(
      verificationRaw,
      targetContactId,
      accountScopedTargetRawContact,
    );

    for (const fallbackPayload of fallbackPayloads) {
      await updateBusinessAccount(
        cookieValue,
        context.updateIdentifiers,
        {
          ...context.identityPayload,
          ...fallbackPayload,
        },
        authCookieRefresh,
      );

      verificationRaw = await fetchBusinessAccountById(
        cookieValue,
        context.resolvedRecordId,
        authCookieRefresh,
      );
      verifiedPrimaryContactId = readRawBusinessAccountPrimaryContactId(verificationRaw);

      if (verifiedPrimaryContactId === targetContactId) {
        break;
      }
    }
  }

  if (verifiedPrimaryContactId !== targetContactId) {
    throw new HttpError(
      422,
      "Acumatica accepted the update but did not switch the primary contact. Please sync records and try again.",
    );
  }

  return verificationRaw;
}

export function buildDeletedContactRowKey(
  rawAccountWithContacts: RawBusinessAccount,
  contactId: number,
): string | null {
  const matched = normalizeBusinessAccountRows(rawAccountWithContacts).find(
    (row) => row.contactId === contactId,
  );
  if (matched?.rowKey) {
    return matched.rowKey;
  }

  const account = normalizeRawBusinessAccountForMerge(rawAccountWithContacts);
  return account.recordId ? `${account.recordId}:contact:${contactId}` : null;
}

export function buildDeletedContactRowKeys(
  rawAccountWithContacts: RawBusinessAccount,
  contactIds: number[],
): string[] {
  return contactIds
    .map((contactId) => buildDeletedContactRowKey(rawAccountWithContacts, contactId))
    .filter((rowKey): rowKey is string => Boolean(rowKey));
}

export function buildAccountRowsFromRawAccount(
  rawAccountWithContacts: RawBusinessAccount,
): BusinessAccountRow[] {
  return normalizeBusinessAccountRows(rawAccountWithContacts);
}
