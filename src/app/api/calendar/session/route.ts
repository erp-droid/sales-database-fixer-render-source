export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { readGoogleCalendarSession } from "@/lib/google-calendar";

export async function GET(request: NextRequest): Promise<NextResponse> {
  requireAuthCookieValue(request);

  return NextResponse.json(readGoogleCalendarSession(getStoredLoginName(request)));
}
