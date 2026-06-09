export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireStoredLoginName } from "@/lib/auth";
import { disconnectGoogleCalendar } from "@/lib/google-calendar";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const loginName = requireStoredLoginName(request);

    disconnectGoogleCalendar(loginName);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
