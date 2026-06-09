export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { runGeocodeBackfillBatch } from "@/lib/read-model/geocode-backfill";

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function assertAuthorized(request: NextRequest): void {
  const expected = process.env.STATE_TRANSFER_SYSTEM_KEY?.trim() ?? "";
  if (!expected) {
    throw new Error("STATE_TRANSFER_SYSTEM_KEY is not configured.");
  }

  const actual =
    readBearerToken(request) ??
    request.headers.get("x-state-transfer-key")?.trim() ??
    "";
  if (actual !== expected) {
    throw new Error("Unauthorized.");
  }
}

function readPositiveInteger(
  params: URLSearchParams,
  key: string,
  fallback: number,
  max: number,
): number {
  const raw = params.get(key);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertAuthorized(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }

  const limit = readPositiveInteger(request.nextUrl.searchParams, "limit", 50, 150);
  const maxAttempts = readPositiveInteger(
    request.nextUrl.searchParams,
    "maxAttempts",
    10,
    25,
  );
  const retryFailed = request.nextUrl.searchParams.get("retryFailed") !== "false";

  try {
    const result = await runGeocodeBackfillBatch({
      limit,
      maxAttempts,
      retryFailed,
    });

    return NextResponse.json(result, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Geocode backfill failed." },
      { status: 500 },
    );
  }
}
