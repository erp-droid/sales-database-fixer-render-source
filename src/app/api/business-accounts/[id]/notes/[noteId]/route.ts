export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { deleteAccountNote, updateAccountNote } from "@/lib/read-model/account-notes";

type RouteContext = {
  params: Promise<{ id: string; noteId: string }>;
};

const MAX_NOTE_LENGTH = 5000;

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const { id, noteId } = await context.params;
    const accountRecordId = id.trim();
    const trimmedNoteId = noteId.trim();
    if (!accountRecordId || !trimmedNoteId) {
      throw new HttpError(400, "Business account ID and note ID are required.");
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

    const updated = updateAccountNote({ id: trimmedNoteId, accountRecordId, note });
    if (!updated) {
      throw new HttpError(404, "Note was not found.");
    }

    return NextResponse.json({ note: updated });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const { id, noteId } = await context.params;
    const accountRecordId = id.trim();
    const trimmedNoteId = noteId.trim();
    if (!accountRecordId || !trimmedNoteId) {
      throw new HttpError(400, "Business account ID and note ID are required.");
    }

    const deleted = deleteAccountNote({ id: trimmedNoteId, accountRecordId });
    if (!deleted) {
      throw new HttpError(404, "Note was not found.");
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
