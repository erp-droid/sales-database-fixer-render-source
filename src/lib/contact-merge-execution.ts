import {
  deleteContact as deleteAcumaticaContact,
  fetchContactById,
  readWrappedString,
  updateBusinessAccount,
  updateContact,
  type AuthCookieRefreshState,
  type RawContact,
} from "@/lib/acumatica";
import { buildPrimaryContactFallbackPayloads } from "@/lib/business-accounts";
import {
  buildAccountRowsFromRawAccount,
  buildDeletedContactRowKeys,
  fetchContactMergeServerContext,
  fetchSelectedContactsForMerge,
  setBusinessAccountPrimaryContact,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";
import {
  type ContactMergeFieldMap,
  type NormalizedContactForMerge,
  buildMergedContactPayloadFromFieldMap,
  buildSelectedMergeFieldMap,
  buildMergedContactPayload,
  normalizeRawBusinessAccountForMerge,
  normalizeRawContactForMerge,
  optimisticTimestampMatches,
} from "@/lib/contact-merge";
import type { DeferredMergeContactsPreview } from "@/lib/deferred-contact-operations";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { replaceReadModelAccountRows } from "@/lib/read-model/accounts";
import type { ContactMergeRequest, ContactMergeResponse } from "@/types/contact-merge";

export async function executeContactMergeRequest(
  cookieValue: string,
  payload: ContactMergeRequest,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ContactMergeResponse> {
  const activeAuthCookieRefresh = authCookieRefresh ?? { value: null };
  const context = await fetchContactMergeServerContext(
    cookieValue,
    payload.businessAccountRecordId,
    activeAuthCookieRefresh,
  );
  const account = normalizeRawBusinessAccountForMerge(context.rawAccountWithContacts);

  if (account.businessAccountId !== payload.businessAccountId) {
    throw new HttpError(
      409,
      "This account changed after you opened the merge flow. Reload and try again.",
    );
  }

  const selectedRawContacts = await fetchSelectedContactsForMerge(
    cookieValue,
    payload.selectedContactIds,
    activeAuthCookieRefresh,
  );
  const keepRawContact =
    selectedRawContacts.find(
      (contact) =>
        normalizeRawContactForMerge(contact).contactId === payload.keepContactId,
    ) ?? null;
  if (!keepRawContact) {
    throw new HttpError(422, "Keep contact ID must be included in the selected contacts.");
  }

  const scope = validateContactMergeScope(
    context.rawAccountWithContacts,
    keepRawContact,
    selectedRawContacts,
  );
  const normalizedSelectedContacts = selectedRawContacts.map((rawContact) =>
    normalizeRawContactForMerge(rawContact),
  );
  const expectedLastModifiedByContactId = new Map(
    payload.expectedContactLastModifieds.map((entry) => [entry.contactId, entry.lastModified]),
  );

  if (
    !optimisticTimestampMatches(
      payload.expectedAccountLastModified,
      account.lastModifiedIso,
    ) ||
    !normalizedSelectedContacts.every((contact) => {
      if (contact.contactId === null) {
        return false;
      }

      return optimisticTimestampMatches(
        expectedLastModifiedByContactId.get(contact.contactId),
        contact.lastModifiedIso,
      );
    })
  ) {
    throw new HttpError(
      409,
      "These records were modified in Acumatica after you loaded the merge preview. Reload and try again.",
    );
  }

  const loserContactIds = payload.selectedContactIds.filter(
    (contactId) => contactId !== payload.keepContactId,
  );
  const deletedRowKeys = buildDeletedContactRowKeys(
    context.rawAccountWithContacts,
    loserContactIds,
  );
  const mergedPayload = buildMergedContactPayload(
    selectedRawContacts,
    payload.keepContactId,
    payload.fieldChoices,
  );

  await updateContact(
    cookieValue,
    payload.keepContactId,
    mergedPayload,
    activeAuthCookieRefresh,
  );

  if (payload.setKeptAsPrimary) {
    const primaryPayload = buildPrimaryContactFallbackPayloads(
      context.rawAccount,
      payload.keepContactId,
      keepRawContact,
    )[0];
    await updateBusinessAccount(
      cookieValue,
      context.updateIdentifiers,
      {
        ...context.identityPayload,
        ...primaryPayload,
      },
      activeAuthCookieRefresh,
    );
    await setBusinessAccountPrimaryContact(
      cookieValue,
      context,
      payload.keepContactId,
      activeAuthCookieRefresh,
      keepRawContact,
    );
  }

  const deletedContactIds: number[] = [];
  for (const loserContactId of loserContactIds) {
    await deleteAcumaticaContact(cookieValue, loserContactId, activeAuthCookieRefresh);
    deletedContactIds.push(loserContactId);
  }

  const refreshedContext = await fetchContactMergeServerContext(
    cookieValue,
    context.resolvedRecordId,
    activeAuthCookieRefresh,
  );
  const refreshedAccount = normalizeRawBusinessAccountForMerge(
    refreshedContext.rawAccountWithContacts,
  );
  const accountRows = buildAccountRowsFromRawAccount(refreshedContext.rawAccountWithContacts);
  const updatedRow =
    accountRows.find((row) => row.contactId === payload.keepContactId) ?? accountRows[0];

  if (!updatedRow) {
    throw new HttpError(
      500,
      "Merge completed, but the updated contact could not be reloaded from Acumatica.",
    );
  }

  const responsePayload: ContactMergeResponse = {
    merged: true,
    businessAccountRecordId: refreshedContext.resolvedRecordId,
    businessAccountId: refreshedAccount.businessAccountId ?? payload.businessAccountId,
    keptContactId: payload.keepContactId,
    deletedContactIds,
    setKeptAsPrimary: payload.setKeptAsPrimary,
    updatedRow,
    deletedRowKeys,
    accountRows,
    warnings: scope.warnings,
  };

  if (getEnv().READ_MODEL_ENABLED) {
    replaceReadModelAccountRows(
      refreshedContext.resolvedRecordId,
      responsePayload.accountRows,
    );
  }

  return responsePayload;
}

function isMissingEntityError(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  if (error.status === 404) {
    return true;
  }

  return error.message.toLowerCase().includes("no entity satisfies the condition");
}

async function fetchContactByIdIfExists(
  cookieValue: string,
  contactId: number,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<RawContact | null> {
  try {
    return await fetchContactById(cookieValue, contactId, authCookieRefresh);
  } catch (error) {
    if (isMissingEntityError(error)) {
      return null;
    }

    throw error;
  }
}

function buildEmptyMergeFieldMap(): ContactMergeFieldMap {
  return {
    firstName: null,
    middleName: null,
    lastName: null,
    displayName: null,
    jobTitle: null,
    email: null,
    phone1: null,
    phone2: null,
    phone3: null,
    website: null,
    notes: null,
  };
}

function buildDeferredMergeFieldMap(
  preview: DeferredMergeContactsPreview,
  keepContact: NormalizedContactForMerge,
  availableContacts: NormalizedContactForMerge[],
  payload: ContactMergeRequest,
): ContactMergeFieldMap {
  if (preview.mergedFields && Object.keys(preview.mergedFields).length > 0) {
    const mergedFields = {
      ...buildEmptyMergeFieldMap(),
      ...keepContact.fields,
    };
    for (const [field, value] of Object.entries(preview.mergedFields)) {
      mergedFields[field as keyof ContactMergeFieldMap] = value ?? null;
    }
    return mergedFields;
  }

  if (availableContacts.length === payload.selectedContactIds.length) {
    return buildSelectedMergeFieldMap(availableContacts, payload.keepContactId, payload.fieldChoices);
  }

  return {
    ...keepContact.fields,
    displayName: preview.mergedPrimaryContactName ?? keepContact.fields.displayName ?? null,
    jobTitle: preview.mergedPrimaryContactJobTitle ?? keepContact.fields.jobTitle ?? null,
    email: preview.mergedPrimaryContactEmail ?? keepContact.fields.email ?? null,
    phone1: preview.mergedPrimaryContactPhone ?? keepContact.fields.phone1 ?? null,
    notes: preview.mergedNotes ?? keepContact.fields.notes ?? null,
  };
}

export async function executeDeferredContactMergeRequest(
  cookieValue: string,
  payload: ContactMergeRequest,
  preview: DeferredMergeContactsPreview,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ContactMergeResponse> {
  const activeAuthCookieRefresh = authCookieRefresh ?? { value: null };
  const context = await fetchContactMergeServerContext(
    cookieValue,
    payload.businessAccountRecordId,
    activeAuthCookieRefresh,
  );

  const account = normalizeRawBusinessAccountForMerge(context.rawAccountWithContacts);
  const accountContacts = Array.isArray(context.rawAccountWithContacts.Contacts)
    ? context.rawAccountWithContacts.Contacts
    : Array.isArray((context.rawAccountWithContacts.Contacts as { value?: unknown[] } | undefined)?.value)
      ? (((context.rawAccountWithContacts.Contacts as { value?: unknown[] }).value ?? []) as RawContact[])
      : [];
  const accountContactsById = new Map<number, RawContact>();
  for (const contact of accountContacts) {
    const normalized = normalizeRawContactForMerge(contact);
    if (normalized.contactId !== null) {
      accountContactsById.set(normalized.contactId, contact);
    }
  }

  const selectedRawContacts: RawContact[] = [];
  const missingLoserContactIds = new Set<number>();
  let keepRawContact: RawContact | null = accountContactsById.get(payload.keepContactId) ?? null;

  if (!keepRawContact) {
    const fetchedKeepContact = await fetchContactByIdIfExists(
      cookieValue,
      payload.keepContactId,
      activeAuthCookieRefresh,
    );
    if (!fetchedKeepContact) {
      throw new HttpError(
        409,
        "The kept contact no longer exists in Acumatica. Reload and queue the merge again.",
      );
    }

    const keepContactAccountId =
      normalizeRawContactForMerge(fetchedKeepContact).businessAccountId ??
      readWrappedString(fetchedKeepContact, "BusinessAccountID") ??
      readWrappedString(fetchedKeepContact, "BAccountID");
    if (keepContactAccountId && account.businessAccountId && keepContactAccountId !== account.businessAccountId) {
      throw new HttpError(
        409,
        "The kept contact no longer belongs to this business account. Reload and queue the merge again.",
      );
    }

    keepRawContact = fetchedKeepContact;
  }

  selectedRawContacts.push(keepRawContact);

  const loserContactIds = payload.selectedContactIds.filter(
    (contactId) => contactId !== payload.keepContactId,
  );
  for (const loserContactId of loserContactIds) {
    const accountScopedLoser = accountContactsById.get(loserContactId);
    if (accountScopedLoser) {
      selectedRawContacts.push(accountScopedLoser);
      continue;
    }

    const fetchedLoser = await fetchContactByIdIfExists(
      cookieValue,
      loserContactId,
      activeAuthCookieRefresh,
    );
    if (!fetchedLoser) {
      missingLoserContactIds.add(loserContactId);
      continue;
    }

    const loserBusinessAccountId = normalizeRawContactForMerge(fetchedLoser).businessAccountId;
    if (loserBusinessAccountId && account.businessAccountId && loserBusinessAccountId !== account.businessAccountId) {
      throw new HttpError(
        409,
        "One of the queued loser contacts was moved to another account before the merge ran. Reload and queue the merge again.",
      );
    }

    selectedRawContacts.push(fetchedLoser);
  }

  const normalizedSelectedContacts = selectedRawContacts.map((rawContact) =>
    normalizeRawContactForMerge(rawContact),
  );
  const keepContact = normalizedSelectedContacts.find(
    (contact) => contact.contactId === payload.keepContactId,
  );
  if (!keepContact) {
    throw new HttpError(
      409,
      "The kept contact could not be reloaded from Acumatica. Reload and queue the merge again.",
    );
  }

  const liveWarnings =
    normalizedSelectedContacts.length >= 2
      ? validateContactMergeScope(context.rawAccountWithContacts, keepRawContact, selectedRawContacts).warnings
      : [];
  const deletedRowKeys = buildDeletedContactRowKeys(
    context.rawAccountWithContacts,
    loserContactIds,
  );
  const mergedFields = buildDeferredMergeFieldMap(
    preview,
    keepContact,
    normalizedSelectedContacts,
    payload,
  );

  await updateContact(
    cookieValue,
    payload.keepContactId,
    buildMergedContactPayloadFromFieldMap(mergedFields),
    activeAuthCookieRefresh,
  );

  if (payload.setKeptAsPrimary) {
    const primaryPayload = buildPrimaryContactFallbackPayloads(
      context.rawAccount,
      payload.keepContactId,
      keepRawContact,
    )[0];
    await updateBusinessAccount(
      cookieValue,
      context.updateIdentifiers,
      {
        ...context.identityPayload,
        ...primaryPayload,
      },
      activeAuthCookieRefresh,
    );
    await setBusinessAccountPrimaryContact(
      cookieValue,
      context,
      payload.keepContactId,
      activeAuthCookieRefresh,
      keepRawContact,
    );
  }

  const deletedContactIds: number[] = [];
  for (const loserContactId of loserContactIds) {
    if (missingLoserContactIds.has(loserContactId)) {
      deletedContactIds.push(loserContactId);
      continue;
    }

    try {
      await deleteAcumaticaContact(cookieValue, loserContactId, activeAuthCookieRefresh);
    } catch (error) {
      if (!isMissingEntityError(error)) {
        throw error;
      }
    }

    deletedContactIds.push(loserContactId);
  }

  const refreshedContext = await fetchContactMergeServerContext(
    cookieValue,
    context.resolvedRecordId,
    activeAuthCookieRefresh,
  );
  const refreshedAccount = normalizeRawBusinessAccountForMerge(
    refreshedContext.rawAccountWithContacts,
  );
  const accountRows = buildAccountRowsFromRawAccount(refreshedContext.rawAccountWithContacts);
  const updatedRow =
    accountRows.find((row) => row.contactId === payload.keepContactId) ?? accountRows[0];

  if (!updatedRow) {
    throw new HttpError(
      500,
      "Merge completed, but the updated contact could not be reloaded from Acumatica.",
    );
  }

  const responsePayload: ContactMergeResponse = {
    merged: true,
    businessAccountRecordId: refreshedContext.resolvedRecordId,
    businessAccountId: refreshedAccount.businessAccountId ?? payload.businessAccountId,
    keptContactId: payload.keepContactId,
    deletedContactIds,
    setKeptAsPrimary: payload.setKeptAsPrimary,
    updatedRow,
    deletedRowKeys,
    accountRows,
    warnings: liveWarnings,
  };

  if (getEnv().READ_MODEL_ENABLED) {
    replaceReadModelAccountRows(
      refreshedContext.resolvedRecordId,
      responsePayload.accountRows,
    );
  }

  return responsePayload;
}
