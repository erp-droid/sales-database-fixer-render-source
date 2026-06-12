import { NextRequest, NextResponse } from "next/server";

import { suggestCompanyAttributesWithOpenAi } from "@/lib/openai-company-attributes";
import { HttpError } from "@/lib/errors";
import type { CompanyAttributeSuggestionRequest } from "@/types/company-attribute-suggestion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_TOKEN = "974a7830a84a313e4ee51d939684773476dc101f64dc3752447a9b5f65baa17b";

function isAuthorized(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-justin-region6-admin-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === ADMIN_TOKEN || queryToken === ADMIN_TOKEN;
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const suggestionRequest: CompanyAttributeSuggestionRequest = {
    companyName: readText(body.companyName),
    companyDescription: readText(body.companyDescription),
    businessAccountId: readText(body.businessAccountId),
    addressLine1: readText(body.addressLine1),
    city: readText(body.city),
    state: readText(body.state),
    postalCode: readText(body.postalCode),
    country: readText(body.country),
    contactEmail: readText(body.contactEmail),
    industryType: readText(body.industryType),
    subCategory: readText(body.subCategory),
    category: readText(body.category),
    companyRegion: readText(body.companyRegion),
  };

  try {
    const result = await suggestCompanyAttributesWithOpenAi(suggestionRequest);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 },
    );
  }
}
