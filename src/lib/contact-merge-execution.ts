import {
  deleteContact as deleteAcumaticaContact,
  updateBusinessAccount,
  updateContact,
  type AuthCookieRefreshState,
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
  buildMergedContactPayload,
  normalizeRawBusinessAccountForMerge,
  normalizeRawContactForMerge,
  optimisticTimestampMatches,
} from "@/lib/contact-merge";
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
