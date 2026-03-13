export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { queryAuditLog } from "@/lib/audit-log-query";
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ITEM_TYPES,
  AUDIT_RESULT_CODES,
  type AuditQuery,
} from "@/lib/audit-log-types";
import { HttpError, getErrorMessage } from "@/lib/errors";

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAuditQuery(searchParams: URLSearchParams): AuditQuery {
  const itemType = searchParams.get("itemType")?.trim() ?? "all";
  const actionGroup = searchParams.get("actionGroup")?.trim() ?? "all";
  const result = searchParams.get("result")?.trim() ?? "all";

  if (itemType !== "all" && !AUDIT_ITEM_TYPES.includes(itemType as (typeof AUDIT_ITEM_TYPES)[number])) {
    throw new HttpError(400, "Invalid itemType filter.");
  }
  if (
    actionGroup !== "all" &&
    !AUDIT_ACTION_GROUPS.includes(actionGroup as (typeof AUDIT_ACTION_GROUPS)[number])
  ) {
    throw new HttpError(400, "Invalid actionGroup filter.");
  }
  if (result !== "all" && !AUDIT_RESULT_CODES.includes(result as (typeof AUDIT_RESULT_CODES)[number])) {
    throw new HttpError(400, "Invalid result filter.");
  }

  return {
    q: searchParams.get("q")?.trim() ?? "",
    itemType: itemType as AuditQuery["itemType"],
    actionGroup: actionGroup as AuditQuery["actionGroup"],
    result: result as AuditQuery["result"],
    actor: searchParams.get("actor")?.trim() ?? "",
    dateFrom: searchParams.get("dateFrom")?.trim() || null,
    dateTo: searchParams.get("dateTo")?.trim() || null,
    businessAccountRecordId: searchParams.get("businessAccountRecordId")?.trim() || null,
    contactId: parseOptionalInteger(searchParams.get("contactId")),
    page: parsePositiveInteger(searchParams.get("page"), 1),
    pageSize: parsePositiveInteger(searchParams.get("pageSize"), 50),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);
    const query = parseAuditQuery(request.nextUrl.searchParams);
    return NextResponse.json(queryAuditLog(query));
  } catch (error) {
    return error instanceof HttpError
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
  }
}
