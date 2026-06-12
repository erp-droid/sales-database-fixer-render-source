import { NextRequest, NextResponse } from "next/server";

import {
  findCanadaPostAddressCompleteSuggestions,
  retrieveCanadaPostAddressCompleteAddress,
  type AddressInput,
} from "@/lib/address-complete";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_TOKEN = "974a7830a84a313e4ee51d939684773476dc101f64dc3752447a9b5f65baa17b";

function isAuthorized(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-justin-region6-admin-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === ADMIN_TOKEN || queryToken === ADMIN_TOKEN;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const searchTerm = readText(body.searchTerm);
  if (searchTerm.length < 3) {
    return NextResponse.json({ error: "searchTerm must be at least 3 characters." }, { status: 400 });
  }

  const fallback: AddressInput = {
    addressLine1: readText(body.addressLine1),
    addressLine2: "",
    city: readText(body.city),
    state: readText(body.state) || "ON",
    postalCode: readText(body.postalCode),
    country: "CA",
  };

  try {
    const suggestions = await findCanadaPostAddressCompleteSuggestions({
      searchTerm,
      country: "CA",
      limit: 5,
    });
    if (suggestions.length === 0) {
      return NextResponse.json({ status: "no_match", suggestions: [] });
    }

    const address = await retrieveCanadaPostAddressCompleteAddress({
      id: suggestions[0].id,
      fallback,
    });

    return NextResponse.json({
      status: "ready",
      address,
      suggestion: suggestions[0],
      suggestions,
    });
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
