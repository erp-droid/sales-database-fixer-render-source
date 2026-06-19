export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { createAccountNote, listAccountNotes } from "@/lib/read-model/account-notes";
import { readStoredBusinessAccountRowsFromReadModel } from "@/lib/read-model/accounts";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_NOTE_LENGTH = 5000;

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const { id } = await context.params;
    const accountRecordId = id.trim();
    if (!accountRecordId) {
      throw new HttpError(400, "Business account ID is required.");
    }

    return NextResponse.json({ notes: listAccountNotes(accountRecordId) });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const { id } = await context.params;
    const accountRecordId = id.trim();
    if (!accountRecordId) {
      throw new HttpError(400, "Business account ID is required.");
    }

    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) {
      throw new HttpError(400, "Note text is required.");
    }
    if (note.length > MAX_NOTE_LENGTH) {
      throw new HttpError(400, `Note text must be ${MAX_NOTE_LENGTH} characters or fewer.`);
    }

    // Optional contact scope: when contactId is provided the note belongs to
    // that contact; otherwise it is a company-wide note.
    const rawContactId = body?.contactId;
    const contactId =
      typeof rawContactId === "number" && Number.isInteger(rawContactId) && rawContactId > 0
        ? rawContactId
        : null;

    // Derive company/contact metadata from the local snapshot so notes stay
    // readable even if the account is later edited.
    const storedRows = readStoredBusinessAccountRowsFromReadModel(accountRecordId);
    const representativeRow = storedRows[0] ?? null;
    const contactRow =
      contactId !== null
        ? storedRows.find(
            (row) => row.contactId === contactId || row.primaryContactId === contactId,
          ) ?? null
        : null;

    const created = createAccountNote({
      accountRecordId,
      businessAccountId: representativeRow?.businessAccountId ?? null,
      companyName: representativeRow?.companyName ?? null,
      contactId,
      contactName: contactRow?.primaryContactName ?? null,
      note,
      author: getStoredLoginName(request),
    });

    return NextResponse.json({ note: created }, { status: 201 });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
