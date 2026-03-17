export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { requireAuthCookieValue } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { suggestCompanyAttributesWithOpenAi } from "@/lib/openai-company-attributes";
import type {
  CompanyAttributeSuggestionRequest,
  CompanyAttributeSuggestionResponse,
} from "@/types/company-attribute-suggestion";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const nullableStringSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const companyAttributeSuggestionRequestSchema = z.object({
  companyName: nullableStringSchema.default(null),
  businessAccountId: nullableStringSchema.default(null),
  addressLine1: nullableStringSchema.default(null),
  city: nullableStringSchema.default(null),
  state: nullableStringSchema.default(null),
  postalCode: nullableStringSchema.default(null),
  country: nullableStringSchema.default(null),
  contactEmail: nullableStringSchema.default(null),
  companyRegion: nullableStringSchema.default(null),
  industryType: nullableStringSchema.default(null),
  subCategory: nullableStringSchema.default(null),
  category: nullableStringSchema.default(null),
});

function parseAccountId(value: string): string {
  const accountId = value.trim();
  if (!accountId) {
    throw new HttpError(400, "Business account ID is required.");
  }

  return accountId;
}

function parseRequestBody(payload: unknown): CompanyAttributeSuggestionRequest {
  return companyAttributeSuggestionRequestSchema.parse(payload);
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
    const suggestionRequest = parseRequestBody(body);
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
