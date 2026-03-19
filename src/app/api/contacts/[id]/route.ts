export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { resolveDeferredActionActor } from "@/lib/deferred-action-actor";
import { enqueueDeferredContactDeleteAction } from "@/lib/deferred-actions-store";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";
import { parseDeleteReasonPayload } from "@/lib/validation";
import type { BusinessAccountRow } from "@/types/business-account";
import type { DeferredDeleteContactResponse } from "@/types/deferred-action";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function parseContactId(value: string): number {
  const contactId = Number(value);
  if (!Number.isInteger(contactId) || contactId <= 0) {
    throw new HttpError(400, "Contact ID must be a positive integer.");
  }

  return contactId;
}

function readQueuedDeleteSummary(contactId: number): {
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  contactName: string | null;
  rowKey: string | null;
} {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT payload_json
      FROM account_rows
      WHERE contact_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
      `,
    )
    .get(contactId) as { payload_json: string } | undefined;

  if (!row) {
    return {
      businessAccountRecordId: null,
      businessAccountId: null,
      companyName: null,
      contactName: null,
      rowKey: null,
    };
  }

  try {
    const parsed = JSON.parse(row.payload_json) as BusinessAccountRow;
    return {
      businessAccountRecordId: parsed.accountRecordId?.trim() || parsed.id.trim() || null,
      businessAccountId: parsed.businessAccountId?.trim() || null,
      companyName: parsed.companyName?.trim() || null,
      contactName: parsed.primaryContactName?.trim() || null,
      rowKey: parsed.rowKey?.trim() || null,
    };
  } catch {
    return {
      businessAccountRecordId: null,
      businessAccountId: null,
      companyName: null,
      contactName: null,
      rowKey: null,
    };
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const { id } = await context.params;
    const contactId = parseContactId(id);
    const cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const { reason } = parseDeleteReasonPayload(body);
    const actor = await resolveDeferredActionActor(
      request,
      cookieValue,
      authCookieRefresh,
    );
    const summary = readQueuedDeleteSummary(contactId);
    const queued = enqueueDeferredContactDeleteAction({
      sourceSurface: request.nextUrl.searchParams.get("source")?.trim() || "accounts",
      businessAccountRecordId: summary.businessAccountRecordId,
      businessAccountId: summary.businessAccountId,
      companyName: summary.companyName,
      contactId,
      contactName: summary.contactName,
      contactRowKey: summary.rowKey,
      reason,
      actor,
    });

    const response = NextResponse.json({
      queued: true,
      actionId: queued.id,
      actionType: "deleteContact",
      contactId,
      reason,
      executeAfterAt: queued.executeAfterAt,
      status: "pending_review",
    } satisfies DeferredDeleteContactResponse);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const response =
      error instanceof ZodError
        ? NextResponse.json(
            {
              error: "Invalid delete request payload",
              details: error.flatten(),
            },
            { status: 400 },
          )
        : error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
              details: error.details,
            },
            { status: error.status },
          )
        : NextResponse.json(
            {
              error: getErrorMessage(error),
            },
            { status: 500 },
          );

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
