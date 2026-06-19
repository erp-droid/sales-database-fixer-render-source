export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, requireStoredLoginName } from "@/lib/auth";
import { deleteAccountList } from "@/lib/account-lists";
import { HttpError, getErrorMessage } from "@/lib/errors";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function buildErrorResponse(error: unknown): NextResponse {
  return error instanceof HttpError
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
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = requireStoredLoginName(request);
    const { id } = await context.params;
    deleteAccountList(id, loginName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
