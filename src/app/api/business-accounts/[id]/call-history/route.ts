export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  type AuthCookieRefreshState,
  fetchBusinessAccountById,
} from "@/lib/acumatica";
import { buildBusinessAccountCallHistoryResponse } from "@/lib/business-account-call-history";
import {
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
} from "@/lib/business-accounts";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  readBusinessAccountDetailFromReadModel,
} from "@/lib/read-model/accounts";
import { maybeTriggerReadModelSync } from "@/lib/read-model/sync";
import type { BusinessAccountRow } from "@/types/business-account";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

function selectDetailRow(
  rows: BusinessAccountRow[],
  requestedContactId: number | null,
  fallbackRow: BusinessAccountRow | null,
): BusinessAccountRow | null {
  if (requestedContactId !== null) {
    const requestedRow = rows.find((row) => row.contactId === requestedContactId);
    if (requestedRow) {
      return requestedRow;
    }
  }

  return rows.find((row) => row.isPrimaryContact) ?? fallbackRow ?? rows[0] ?? null;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const { id } = await context.params;
    const cookieValue = requireAuthCookieValue(request);
    const requestedContactId = parseOptionalInteger(request.nextUrl.searchParams.get("contactId"));
    const limit = parsePositiveInteger(request.nextUrl.searchParams.get("limit"), 10);
    let selectedRow: BusinessAccountRow | null = null;

    if (getEnv().READ_MODEL_ENABLED) {
      maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
      selectedRow = readBusinessAccountDetailFromReadModel(id, requestedContactId)?.row ?? null;
    }

    if (!selectedRow) {
      const rawAccount = await fetchBusinessAccountById(
        cookieValue,
        id,
        authCookieRefresh as AuthCookieRefreshState,
      );
      const normalizedRows = normalizeBusinessAccountRows(rawAccount);
      selectedRow = selectDetailRow(
        normalizedRows,
        requestedContactId,
        normalizeBusinessAccount(rawAccount),
      );
    }

    if (!selectedRow) {
      throw new HttpError(404, "Business account not found.");
    }

    const response = NextResponse.json(
      buildBusinessAccountCallHistoryResponse(selectedRow, { limit }),
    );
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json({ error: error.message }, { status: error.status })
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
