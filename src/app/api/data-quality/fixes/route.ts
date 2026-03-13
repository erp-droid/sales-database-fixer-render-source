import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import {
  getStoredLoginName,
  normalizeSessionUser,
  requireAuthCookieValue,
  setAuthCookie,
} from "@/lib/auth";
import { recordFixedIssues } from "@/lib/data-quality-history";
import { type AuthCookieRefreshState, validateSessionWithAcumatica } from "@/lib/acumatica";
import { HttpError, getErrorMessage } from "@/lib/errors";

const payloadSchema = z.object({
  issueKeys: z.array(z.string().trim().min(1)).min(1).max(50),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = {
    value: null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const { issueKeys } = payloadSchema.parse(body);
    const storedLoginName = getStoredLoginName(request);
    let user =
      storedLoginName
        ? {
            id: storedLoginName,
            name: storedLoginName,
          }
        : null;

    if (!user) {
      const sessionPayload = await validateSessionWithAcumatica(cookieValue, authCookieRefresh);
      user = normalizeSessionUser(sessionPayload);
    }

    if (!user) {
      throw new HttpError(401, "Unable to resolve the signed-in user for fix attribution.");
    }

    await recordFixedIssues(issueKeys, {
      userId: user.id,
      userName: user.name,
    });

    const response = NextResponse.json({
      ok: true,
      attributed: issueKeys.length,
      user,
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof ZodError) {
      response = NextResponse.json(
        {
          error: "Invalid fix payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    } else if (error instanceof HttpError) {
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
