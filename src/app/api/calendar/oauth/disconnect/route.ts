export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { disconnectGoogleCalendar } from "@/lib/google-calendar";
import { requireRequestLoginName } from "@/lib/request-login";
import { HttpError, getErrorMessage } from "@/lib/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const loginName = requireRequestLoginName(request);

    disconnectGoogleCalendar(loginName);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
