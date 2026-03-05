import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import {
  findCanadaPostAddressCompleteSuggestions,
  retrieveCanadaPostAddressCompleteAddress,
  type AddressInput,
} from "@/lib/address-complete";
import { HttpError, getErrorMessage } from "@/lib/errors";

function empty(value: string | null): string {
  return (value ?? "").trim();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);

    const searchParams = request.nextUrl.searchParams;
    const id = empty(searchParams.get("id"));

    if (id) {
      const fallback: AddressInput = {
        addressLine1: empty(searchParams.get("addressLine1")),
        addressLine2: empty(searchParams.get("addressLine2")),
        city: empty(searchParams.get("city")),
        state: empty(searchParams.get("state")),
        postalCode: empty(searchParams.get("postalCode")),
        country: "CA",
      };

      const address = await retrieveCanadaPostAddressCompleteAddress({
        id,
        fallback,
      });

      return NextResponse.json({ address });
    }

    const items = await findCanadaPostAddressCompleteSuggestions({
      searchTerm: empty(searchParams.get("q")),
      country: "CA",
      limit: 8,
    });

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
