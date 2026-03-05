import {
  type AuthCookieRefreshState,
  fetchBusinessAccountById,
  fetchContactsByBusinessAccountIds,
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
  isStillDuplicateContactPair,
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

export type ContactMergeServerContext = {
  rawAccount: RawBusinessAccount;
  rawAccountWithContacts: RawBusinessAccount;
  resolvedRecordId: string;
  updateIdentifiers: string[];
  identityPayload: Record<string, unknown>;
};

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
  deleteRawContact: RawContact,
): {
  warnings: string[];
  keepIsPrimary: boolean;
  deleteIsPrimary: boolean;
} {
  const account = normalizeRawBusinessAccountForMerge(rawAccountWithContacts);
  const keepContact = normalizeRawContactForMerge(keepRawContact);
  const deleteContact = normalizeRawContactForMerge(deleteRawContact);

  if (!account.businessAccountId) {
    throw new HttpError(422, "Business account ID is missing on this account.");
  }

  if (!keepContact.contactId || !deleteContact.contactId) {
    throw new HttpError(
      422,
      "One of the selected contacts has no ContactID. Contact merge cannot continue.",
    );
  }

  if (keepContact.contactId === deleteContact.contactId) {
    throw new HttpError(422, "Keep and delete contact IDs must be different.");
  }

  if (keepContact.businessAccountId && keepContact.businessAccountId !== account.businessAccountId) {
    throw new HttpError(
      422,
      "The selected keep contact no longer belongs to this business account.",
    );
  }

  if (deleteContact.businessAccountId && deleteContact.businessAccountId !== account.businessAccountId) {
    throw new HttpError(
      422,
      "The selected delete contact no longer belongs to this business account.",
    );
  }

  if (
    account.contactIds.size > 0 &&
    (!account.contactIds.has(keepContact.contactId) || !account.contactIds.has(deleteContact.contactId))
  ) {
    throw new HttpError(
      422,
      "Both contacts must belong to the selected business account before they can be merged.",
    );
  }

  const keepPrimaryContactId = readRawBusinessAccountPrimaryContactId(rawAccountWithContacts);
  const keepIsPrimary = keepPrimaryContactId === keepContact.contactId;
  const deleteIsPrimary = keepPrimaryContactId === deleteContact.contactId;
  const warnings: string[] = [];

  if (!isStillDuplicateContactPair(keepContact, deleteContact)) {
    warnings.push(
      "These records no longer match duplicate rules, but they can still be merged.",
    );
  }

  return {
    warnings,
    keepIsPrimary,
    deleteIsPrimary,
  };
}

export async function setBusinessAccountPrimaryContact(
  cookieValue: string,
  context: ContactMergeServerContext,
  targetContactId: number,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawBusinessAccount> {
  let verificationRaw = await fetchBusinessAccountById(
    cookieValue,
    context.resolvedRecordId,
    authCookieRefresh,
  );
  let verifiedPrimaryContactId = readRawBusinessAccountPrimaryContactId(verificationRaw);

  if (verifiedPrimaryContactId !== targetContactId) {
    const fallbackPayloads = buildPrimaryContactFallbackPayloads(
      verificationRaw,
      targetContactId,
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

export function buildAccountRowsFromRawAccount(
  rawAccountWithContacts: RawBusinessAccount,
): BusinessAccountRow[] {
  return normalizeBusinessAccountRows(rawAccountWithContacts);
}
