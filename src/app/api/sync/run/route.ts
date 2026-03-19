export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { validateSessionWithAcumatica } from "@/lib/acumatica";
import { getErrorMessage, HttpError } from "@/lib/errors";
import { triggerReadModelSync } from "@/lib/read-model/sync";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
    const responseBody = await triggerReadModelSync(cookieValue, {
      authCookieRefresh,
      force: true,
    });
    const response = NextResponse.json(responseBody);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  } catch (error) {
    const response =
      error instanceof HttpError
        ? NextResponse.json(
            { error: error.message, details: error.details },
            { status: error.status },
          )
        : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }
    return response;
  }
}
