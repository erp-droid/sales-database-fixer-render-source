export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
import { applyDeferredMergeContactsToRows } from "@/lib/deferred-contact-operations";
import { enqueueDeferredMergeContactsAction } from "@/lib/deferred-actions-store";
import {
  buildAccountRowsFromRawAccount,
  buildDeletedContactRowKeys,
  fetchContactMergeServerContext,
  fetchSelectedContactsForMerge,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";
import {
  CONTACT_MERGE_FIELD_LABELS,
  buildSelectedMergeFieldMap,
  normalizeRawBusinessAccountForMerge,
  normalizeRawContactForMerge,
  optimisticTimestampMatches,
} from "@/lib/contact-merge";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { parseContactMergePayload } from "@/lib/validation";
import type {
  ContactMergeFieldKey,
  ContactMergeRequest,
  ContactMergeResponse,
} from "@/types/contact-merge";

function readSourceSurface(request: NextRequest): string {
  const source = request.nextUrl.searchParams.get("source")?.trim();
  return source || "merge";
}

function computeUpdatedFieldLabels(
  selectedContacts: Array<ReturnType<typeof normalizeRawContactForMerge>>,
  keepContactId: number,
  payload: ContactMergeRequest,
): string[] {
  const mergedFields = buildSelectedMergeFieldMap(
    selectedContacts,
    keepContactId,
    payload.fieldChoices,
  );
  const keptContact = selectedContacts.find((contact) => contact.contactId === keepContactId);
  if (!keptContact) {
    return [];
  }

  return (Object.keys(CONTACT_MERGE_FIELD_LABELS) as ContactMergeFieldKey[])
    .filter((field) => (mergedFields[field] ?? "") !== (keptContact.fields[field] ?? ""))
    .map((field) => CONTACT_MERGE_FIELD_LABELS[field]);
}

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
    const context = await fetchContactMergeServerContext(
      cookieValue,
      payload.businessAccountRecordId,
      authCookieRefresh,
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
      authCookieRefresh,
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
    const accountRows = buildAccountRowsFromRawAccount(context.rawAccountWithContacts);
    const mergedFields = buildSelectedMergeFieldMap(
      normalizedSelectedContacts,
      payload.keepContactId,
      payload.fieldChoices,
    );
    const preview = {
      actionType: "mergeContacts" as const,
      keepContactId: payload.keepContactId,
      loserContactIds,
      setKeptAsPrimary: payload.setKeptAsPrimary,
      mergedPrimaryContactName: mergedFields.displayName,
      mergedPrimaryContactPhone: mergedFields.phone1,
      mergedPrimaryContactEmail: mergedFields.email,
      mergedNotes: mergedFields.notes,
    };
    const previewRows = applyDeferredMergeContactsToRows(accountRows, preview);
    const updatedRow =
      previewRows.find((row) => row.contactId === payload.keepContactId) ?? previewRows[0];

    if (!updatedRow) {
      throw new HttpError(500, "Unable to prepare the queued merge preview.");
    }

    const actor = await resolveDeferredActionActor(
      request,
      cookieValue,
      authCookieRefresh,
    );
    const queued = enqueueDeferredMergeContactsAction({
      sourceSurface: readSourceSurface(request),
      businessAccountRecordId: context.resolvedRecordId,
      businessAccountId: account.businessAccountId ?? payload.businessAccountId,
      companyName: account.companyName ?? payload.businessAccountId,
      keptContactId: payload.keepContactId,
      keptContactName: updatedRow.primaryContactName ?? null,
      loserContactIds,
      loserContactNames: normalizedSelectedContacts
        .filter(
          (contact) =>
            contact.contactId !== null && loserContactIds.includes(contact.contactId),
        )
        .map(
          (contact) =>
            contact.fields.displayName ?? `Contact ${contact.contactId ?? "unknown"}`,
        ),
      affectedFields: computeUpdatedFieldLabels(
        normalizedSelectedContacts,
        payload.keepContactId,
        payload,
      ),
      actor,
      payloadJson: JSON.stringify(payload),
      preview,
    });

    const responsePayload: ContactMergeResponse = {
      queued: true,
      actionId: queued.id,
      businessAccountRecordId: context.resolvedRecordId,
      businessAccountId: account.businessAccountId ?? payload.businessAccountId,
      keptContactId: payload.keepContactId,
      deletedContactIds: loserContactIds,
      setKeptAsPrimary: payload.setKeptAsPrimary,
      updatedRow,
      deletedRowKeys,
      accountRows: previewRows,
      warnings: scope.warnings,
      executeAfterAt: queued.executeAfterAt,
    };

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
