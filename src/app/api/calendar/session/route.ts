export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireStoredLoginName } from "@/lib/auth";
import { readGoogleCalendarSession } from "@/lib/google-calendar";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return NextResponse.json(readGoogleCalendarSession(requireStoredLoginName(request)));
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
