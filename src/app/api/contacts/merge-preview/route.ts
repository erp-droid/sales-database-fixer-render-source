import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { fetchContactById } from "@/lib/acumatica";
import {
  fetchContactMergeServerContext,
  validateContactMergeScope,
} from "@/lib/contact-merge-server";
import {
  buildContactMergePreviewFields,
  derivePrimaryRecommendation,
  normalizeRawBusinessAccountForMerge,
  normalizeRawContactForMerge,
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
    const [context, keepRawContact, deleteRawContact] = await Promise.all([
      fetchContactMergeServerContext(
        cookieValue,
        query.businessAccountRecordId,
        authCookieRefresh,
        { includeContacts: false },
      ),
      fetchContactById(cookieValue, query.keepContactId, authCookieRefresh),
      fetchContactById(cookieValue, query.deleteContactId, authCookieRefresh),
    ]);

    const scope = validateContactMergeScope(
      context.rawAccountWithContacts,
      keepRawContact,
      deleteRawContact,
    );
    const account = normalizeRawBusinessAccountForMerge(context.rawAccountWithContacts);
    const keepContact = normalizeRawContactForMerge(keepRawContact);
    const deleteContact = normalizeRawContactForMerge(deleteRawContact);

    const responsePayload: ContactMergePreviewResponse = {
      businessAccountRecordId: context.resolvedRecordId,
      businessAccountId: account.businessAccountId ?? "",
      companyName: account.companyName ?? "",
      keepContactId: keepContact.contactId ?? query.keepContactId,
      deleteContactId: deleteContact.contactId ?? query.deleteContactId,
      keepIsPrimary: scope.keepIsPrimary,
      deleteIsPrimary: scope.deleteIsPrimary,
      recommendedSetKeptAsPrimary: derivePrimaryRecommendation(
        scope.keepIsPrimary,
        scope.deleteIsPrimary,
      ),
      expectedAccountLastModified: account.lastModifiedIso,
      expectedKeepContactLastModified: keepContact.lastModifiedIso,
      expectedDeleteContactLastModified: deleteContact.lastModifiedIso,
      warnings: scope.warnings,
      fields: buildContactMergePreviewFields(keepContact, deleteContact),
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
