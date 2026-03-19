export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAuthCookieValue } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { suggestCompanyAttributesWithOpenAi } from "@/lib/openai-company-attributes";
import { parseCompanyAttributeSuggestionPayload } from "@/lib/validation";
import type {
  CompanyAttributeSuggestionResponse,
} from "@/types/company-attribute-suggestion";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function parseAccountId(value: string): string {
  const accountId = value.trim();
  if (!accountId) {
    throw new HttpError(400, "Business account ID is required.");
  }

  return accountId;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    parseAccountId(id);
    requireAuthCookieValue(request);

    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const suggestionRequest = parseCompanyAttributeSuggestionPayload(body);
    const result = await suggestCompanyAttributesWithOpenAi(suggestionRequest);

    return NextResponse.json(result satisfies CompanyAttributeSuggestionResponse);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid company attribute suggestion request payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    if (error instanceof HttpError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
