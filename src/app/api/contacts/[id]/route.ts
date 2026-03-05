import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { deleteContact } from "@/lib/acumatica";
import { HttpError, getErrorMessage } from "@/lib/errors";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function parseContactId(value: string): number {
  const contactId = Number(value);
  if (!Number.isInteger(contactId) || contactId <= 0) {
    throw new HttpError(400, "Contact ID must be a positive integer.");
  }

  return contactId;
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const { id } = await context.params;
    const contactId = parseContactId(id);
    const cookieValue = requireAuthCookieValue(request);
    await deleteContact(cookieValue, contactId, authCookieRefresh);

    const response = NextResponse.json({ deleted: true, contactId });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json(
            {
              error: getErrorMessage(error),
            },
            { status: 500 },
          );

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
