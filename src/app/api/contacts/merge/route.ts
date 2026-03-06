export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  fetchContactById,
  updateBusinessAccount,
  updateContact,
  deleteContact as deleteAcumaticaContact,
} from "@/lib/acumatica";
import {
  buildDeletedContactRowKey,
  buildAccountRowsFromRawAccount,
  fetchContactMergeServerContext,
  setBusinessAccountPrimaryContact,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";
import {
  buildMergedContactPayload,
  normalizeRawBusinessAccountForMerge,
  normalizeRawContactForMerge,
  optimisticTimestampMatches,
} from "@/lib/contact-merge";
import { buildPrimaryContactFallbackPayloads } from "@/lib/business-accounts";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { replaceReadModelAccountRows } from "@/lib/read-model/accounts";
import { parseContactMergePayload } from "@/lib/validation";
import type { ContactMergeResponse } from "@/types/contact-merge";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const payload = parseContactMergePayload(body);
    const [context, keepRawContact, deleteRawContact] = await Promise.all([
      fetchContactMergeServerContext(
        cookieValue,
        payload.businessAccountRecordId,
        authCookieRefresh,
        { includeContacts: false },
      ),
      fetchContactById(cookieValue, payload.keepContactId, authCookieRefresh),
      fetchContactById(cookieValue, payload.deleteContactId, authCookieRefresh),
    ]);

    const scope = validateContactMergeScope(
      context.rawAccountWithContacts,
      keepRawContact,
      deleteRawContact,
    );
    const account = normalizeRawBusinessAccountForMerge(context.rawAccountWithContacts);
    const keepContact = normalizeRawContactForMerge(keepRawContact);
    const deleteMergeContact = normalizeRawContactForMerge(deleteRawContact);

    if (account.businessAccountId !== payload.businessAccountId) {
      const response = NextResponse.json(
        {
          error: "This account changed after you opened the merge flow. Reload and try again.",
        },
        { status: 409 },
      );
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      return response;
    }

    if (
      !optimisticTimestampMatches(
        payload.expectedAccountLastModified,
        account.lastModifiedIso,
      ) ||
      !optimisticTimestampMatches(
        payload.expectedKeepContactLastModified,
        keepContact.lastModifiedIso,
      ) ||
      !optimisticTimestampMatches(
        payload.expectedDeleteContactLastModified,
        deleteMergeContact.lastModifiedIso,
      )
    ) {
      const response = NextResponse.json(
        {
          error:
            "These records were modified in Acumatica after you loaded the merge preview. Reload and try again.",
        },
        { status: 409 },
      );
      if (authCookieRefresh.value) {
        setAuthCookie(response, authCookieRefresh.value);
      }
      return response;
    }

    const deletedRowKey = buildDeletedContactRowKey(
      context.rawAccountWithContacts,
      payload.deleteContactId,
    );
    const mergedPayload = buildMergedContactPayload(
      keepRawContact,
      deleteRawContact,
      payload.fieldChoices,
    );

    await updateContact(
      cookieValue,
      payload.keepContactId,
      mergedPayload,
      authCookieRefresh,
    );

    if (payload.setKeptAsPrimary) {
      try {
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
          authCookieRefresh,
        );
        await setBusinessAccountPrimaryContact(
          cookieValue,
          context,
          payload.keepContactId,
          authCookieRefresh,
          keepRawContact,
        );
      } catch (error) {
        if (error instanceof HttpError) {
          const response = NextResponse.json(
            {
              error: `Kept contact updated, but primary switch failed. ${error.message}`,
              partial: true,
              stage: "primary",
            },
            { status: error.status },
          );
          if (authCookieRefresh.value) {
            setAuthCookie(response, authCookieRefresh.value);
          }
          return response;
        }
        throw error;
      }
    }

    try {
      await deleteAcumaticaContact(cookieValue, payload.deleteContactId, authCookieRefresh);
    } catch (error) {
      if (error instanceof HttpError) {
        const response = NextResponse.json(
          {
            error: `Kept contact updated, but loser contact was not deleted. ${error.message}`,
            partial: true,
            stage: "delete",
          },
          { status: error.status },
        );
        if (authCookieRefresh.value) {
          setAuthCookie(response, authCookieRefresh.value);
        }
        return response;
      }
      throw error;
    }

    const refreshedContext = await fetchContactMergeServerContext(
      cookieValue,
      context.resolvedRecordId,
      authCookieRefresh,
    );
    const refreshedAccount = normalizeRawBusinessAccountForMerge(
      refreshedContext.rawAccountWithContacts,
    );
    const accountRows = buildAccountRowsFromRawAccount(refreshedContext.rawAccountWithContacts);
    const updatedRow =
      accountRows.find((row) => row.contactId === payload.keepContactId) ??
      accountRows[0];

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
      deletedContactId: payload.deleteContactId,
      setKeptAsPrimary: payload.setKeptAsPrimary,
      updatedRow,
      deletedRowKey,
      accountRows,
      warnings: scope.warnings,
    };

    if (getEnv().READ_MODEL_ENABLED) {
      replaceReadModelAccountRows(
        refreshedContext.resolvedRecordId,
        responsePayload.accountRows,
      );
    }

    const response = NextResponse.json(responsePayload);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid contact merge payload.",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
