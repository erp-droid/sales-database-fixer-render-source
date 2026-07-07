export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedStateTransferSystemRequest } from "@/lib/system-state-transfer-auth";
import { exportAppStateTransferSnapshot, type AppStateTransferSnapshot } from "@/lib/state-transfer";

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
  if (!isAuthorizedStateTransferSystemRequest(request)) {
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
