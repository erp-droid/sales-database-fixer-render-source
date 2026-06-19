export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, requireStoredLoginName } from "@/lib/auth";
import { createAccountList, listVisibleAccountLists } from "@/lib/account-lists";
import { HttpError, getErrorMessage } from "@/lib/errors";
import type { AccountListCreateRequest } from "@/types/account-list";

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = requireStoredLoginName(request);
    return NextResponse.json({ items: listVisibleAccountLists(loginName) });
  } catch (error) {
    return buildErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = requireStoredLoginName(request);
    const body = (await request.json()) as AccountListCreateRequest;
    return NextResponse.json(
      {
        item: createAccountList(loginName, body),
      },
      { status: 201 },
    );
  } catch (error) {
    return buildErrorResponse(error);
  }
}
