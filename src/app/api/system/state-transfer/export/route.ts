export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { exportAppStateTransferSnapshot, type AppStateTransferSnapshot } from "@/lib/state-transfer";

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function timingSafeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function readAllowedKeys(): string[] {
  return [
    process.env.STATE_TRANSFER_SYSTEM_KEY,
    process.env.CALL_ACTIVITY_SYNC_SECRET,
    process.env.DAILY_CALL_COACHING_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function isAuthorized(request: NextRequest): boolean {
  const actual =
    request.headers.get("x-system-key")?.trim() ??
    request.headers.get("x-state-transfer-key")?.trim() ??
    readBearerToken(request) ??
    "";
  if (!actual) return false;

  return readAllowedKeys().some((expected) => timingSafeEquals(actual, expected));
}

function readRequestedTables(request: NextRequest): string[] | null {
  const raw = request.nextUrl.searchParams.get("tables");
  if (!raw) return null;

  const tables = raw
    .split(",")
    .map((table) => table.trim())
    .filter(Boolean);
  return tables.length > 0 ? tables : null;
}

function shouldIncludeHistory(request: NextRequest): boolean {
  const raw = request.nextUrl.searchParams.get("includeHistory")?.trim().toLowerCase();
  return !raw || !["0", "false", "no", "off"].includes(raw);
}

function filterSnapshot(
  snapshot: AppStateTransferSnapshot,
  requestedTables: string[] | null,
  includeHistory: boolean,
): AppStateTransferSnapshot {
  const tables =
    requestedTables === null
      ? snapshot.tables
      : Object.fromEntries(requestedTables.map((tableName) => [tableName, snapshot.tables[tableName] ?? []]));

  return {
    ...snapshot,
    tables,
    dataQualityHistory: includeHistory ? snapshot.dataQualityHistory : null,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const snapshot = await exportAppStateTransferSnapshot(request.nextUrl.origin);
  const filteredSnapshot = filterSnapshot(snapshot, readRequestedTables(request), shouldIncludeHistory(request));

  return NextResponse.json(filteredSnapshot, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="app-state-snapshot-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
