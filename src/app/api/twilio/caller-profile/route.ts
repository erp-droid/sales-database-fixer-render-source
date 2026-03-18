export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import {
  getAuthCookieValue,
  getStoredLoginName,
  setAuthCookie,
} from "@/lib/auth";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import {
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
} from "@/lib/caller-phone-overrides";
import { HttpError, getErrorMessage } from "@/lib/errors";

function readRequestPhoneNumber(body: unknown): string {
  return typeof (body as { phoneNumber?: unknown } | null)?.phoneNumber === "string"
    ? ((body as { phoneNumber: string }).phoneNumber ?? "")
    : "";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  const loginName = getStoredLoginName(request);
  if (!cookieValue || !loginName) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  return NextResponse.json({
    phoneNumber: readCallerPhoneOverride(loginName)?.phoneNumber ?? null,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieValue = getAuthCookieValue(request);
  const loginName = getStoredLoginName(request);
  if (!cookieValue || !loginName) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const authCookieRefresh: AuthCookieRefreshState = { value: null };

  try {
    await validateSessionWithAcumatica(cookieValue, authCookieRefresh);

    const body = await request.json().catch(() => null);
    const saved = saveCallerPhoneOverride(loginName, readRequestPhoneNumber(body));
    const response = NextResponse.json({
      ok: true,
      phoneNumber: saved.phoneNumber,
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 422 });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
