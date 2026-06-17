export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { readGoogleCalendarSession } from "@/lib/google-calendar";
import { requireRequestLoginName } from "@/lib/request-login";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return NextResponse.json(readGoogleCalendarSession(requireRequestLoginName(request)));
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
