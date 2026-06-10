export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireStoredLoginName } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { listCalendarEventsFromGoogleCalendar } from "@/lib/google-calendar";

function parseIsoInstant(value: string | null, label: string): string {
  const parsedMs = Date.parse(value ?? "");
  if (!Number.isFinite(parsedMs)) {
    throw new HttpError(400, `${label} must be a valid ISO date-time.`);
  }

  return new Date(parsedMs).toISOString();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const storedLoginName = requireStoredLoginName(request);
    const timeMinIso = parseIsoInstant(request.nextUrl.searchParams.get("timeMin"), "timeMin");
    const timeMaxIso = parseIsoInstant(request.nextUrl.searchParams.get("timeMax"), "timeMax");
    if (Date.parse(timeMaxIso) <= Date.parse(timeMinIso)) {
      throw new HttpError(400, "timeMax must be after timeMin.");
    }
    if (Date.parse(timeMaxIso) - Date.parse(timeMinIso) > 1000 * 60 * 60 * 24 * 62) {
      throw new HttpError(400, "Calendar ranges longer than 62 days are not supported.");
    }

    const events = await listCalendarEventsFromGoogleCalendar(storedLoginName, {
      timeMinIso,
      timeMaxIso,
    });

    return NextResponse.json(events);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
