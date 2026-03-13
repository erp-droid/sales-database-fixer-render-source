import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  fetchContactMergeServerContext,
  fetchSelectedContactsForMerge,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";
import {
  buildContactMergePreviewContacts,
  buildContactMergePreviewFields,
  derivePrimaryRecommendation,
  normalizeRawBusinessAccountForMerge,
  normalizeRawContactForMerge,
  orderContactsForMerge,
} from "@/lib/contact-merge";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { parseContactMergePreviewQuery } from "@/lib/validation";
import type { ContactMergePreviewResponse } from "@/types/contact-merge";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const query = parseContactMergePreviewQuery(request.nextUrl.searchParams);
    const [context, selectedRawContacts] = await Promise.all([
      fetchContactMergeServerContext(
        cookieValue,
        query.businessAccountRecordId,
        authCookieRefresh,
        { includeContacts: false },
      ),
      fetchSelectedContactsForMerge(cookieValue, query.contactIds, authCookieRefresh),
    ]);
    const keepRawContact = selectedRawContacts.find(
      (contact) => normalizeRawContactForMerge(contact).contactId === query.keepContactId,
    );
    if (!keepRawContact) {
      throw new HttpError(422, "Keep contact ID must be included in the selected contacts.");
    }

    const scope = validateContactMergeScope(
      context.rawAccountWithContacts,
      keepRawContact,
      selectedRawContacts,
    );
    const account = normalizeRawBusinessAccountForMerge(context.rawAccountWithContacts);
    const orderedContacts = orderContactsForMerge(
      selectedRawContacts.map((rawContact) => normalizeRawContactForMerge(rawContact)),
      query.keepContactId,
    );
    const loserIsPrimary = orderedContacts.some(
      (contact) =>
        contact.contactId !== null &&
        contact.contactId !== query.keepContactId &&
        contact.contactId === scope.primaryContactId,
    );

    const responsePayload: ContactMergePreviewResponse = {
      businessAccountRecordId: context.resolvedRecordId,
      businessAccountId: account.businessAccountId ?? "",
      companyName: account.companyName ?? "",
      keepContactId: query.keepContactId,
      contacts: buildContactMergePreviewContacts(orderedContacts, scope.primaryContactId),
      recommendedSetKeptAsPrimary: derivePrimaryRecommendation(scope.keepIsPrimary, loserIsPrimary),
      expectedAccountLastModified: account.lastModifiedIso,
      warnings: scope.warnings,
      fields: buildContactMergePreviewFields(orderedContacts, query.keepContactId),
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
          error: "Invalid merge preview query.",
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
