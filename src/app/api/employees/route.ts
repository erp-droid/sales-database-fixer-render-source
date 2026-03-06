export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  type AuthCookieRefreshState,
  fetchEmployees,
} from "@/lib/acumatica";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { readReadModelEmployeesOrFallback, maybeTriggerReadModelSync } from "@/lib/read-model/sync";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = {
    value: null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const { READ_MODEL_ENABLED } = getEnv();
    let items;
    if (READ_MODEL_ENABLED) {
      maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
      items = readReadModelEmployeesOrFallback();
    } else {
      items = await fetchEmployees(cookieValue, authCookieRefresh);
    }

    const response = NextResponse.json({ items });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
