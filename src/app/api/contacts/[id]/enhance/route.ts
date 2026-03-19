export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { requireAuthCookieValue } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { enhanceContactWithRocketReach } from "@/lib/rocketreach";
import type { ContactEnhanceRequest, ContactEnhanceResponse } from "@/types/contact-enhance";

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

const contactEnhanceRequestSchema = z.object({
  companyName: nullableStringSchema.default(null),
  businessAccountId: nullableStringSchema.default(null),
  contactName: nullableStringSchema.default(null),
  contactJobTitle: nullableStringSchema.default(null),
  candidateCurrentTitle: nullableStringSchema.default(null),
  contactEmail: nullableStringSchema.default(null),
  contactPhone: nullableStringSchema.default(null),
  city: nullableStringSchema.default(null),
  state: nullableStringSchema.default(null),
  country: nullableStringSchema.default(null),
  candidatePersonId: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }

      const numeric = Number(value);
      return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
    })
    .default(null),
});

function parseContactId(value: string): number {
  const contactId = Number(value);
  if (!Number.isInteger(contactId) || contactId <= 0) {
    throw new HttpError(400, "Contact ID must be a positive integer.");
  }

  return contactId;
}

function parseRequestBody(payload: unknown): ContactEnhanceRequest {
  return contactEnhanceRequestSchema.parse(payload);
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    parseContactId(id);
    requireAuthCookieValue(request);

    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const enhanceRequest = parseRequestBody(body);
    const result = await enhanceContactWithRocketReach(enhanceRequest);

    return NextResponse.json(result satisfies ContactEnhanceResponse);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid contact enhancement request payload",
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
