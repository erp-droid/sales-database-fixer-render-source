export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { disconnectGoogleCalendar } from "@/lib/google-calendar";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const loginName = getStoredLoginName(request);
    if (!loginName) {
      throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
    }

    disconnectGoogleCalendar(loginName);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
