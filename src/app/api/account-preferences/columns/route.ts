export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, requireStoredLoginName } from "@/lib/auth";
import {
  readAccountColumnPreferences,
  saveAccountColumnPreferences,
} from "@/lib/account-column-preferences";
import { HttpError, getErrorMessage } from "@/lib/errors";
import type { AccountColumnPreferencesRequest } from "@/types/account-column-preferences";

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
    return NextResponse.json({
      preferences: readAccountColumnPreferences(loginName),
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = requireStoredLoginName(request);
    const body = (await request.json()) as AccountColumnPreferencesRequest;
    return NextResponse.json({
      preferences: saveAccountColumnPreferences(loginName, body),
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
