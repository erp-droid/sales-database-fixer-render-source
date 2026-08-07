export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedStateTransferSystemRequest } from "@/lib/system-state-transfer-auth";
import { queryReadModelBusinessAccounts } from "@/lib/read-model/accounts";
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

function shouldExportCanonicalDirectory(request: NextRequest): boolean {
  const raw = request.nextUrl.searchParams.get("canonicalDirectory")?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw ?? "");
}

function readCanonicalDirectoryRows(): Record<string, unknown>[] {
  const total = queryReadModelBusinessAccounts({
    includeInternalRows: true,
    page: 1,
    pageSize: 1,
  }).total;
  const result = queryReadModelBusinessAccounts({
    includeInternalRows: true,
    page: 1,
    pageSize: Math.max(1, total),
  });

  return result.items.map((row, index) => ({
    row_key:
      row.rowKey ??
      `${row.accountRecordId ?? row.id}:${row.contactId ?? row.primaryContactId ?? "account"}:${index}`,
    account_record_id: row.accountRecordId ?? row.id,
    business_account_id: row.businessAccountId,
    contact_id: row.contactId,
    primary_contact_id: row.primaryContactId,
    payload_json: JSON.stringify(row),
    updated_at: row.lastModifiedIso ?? new Date().toISOString(),
  }));
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
  if (shouldExportCanonicalDirectory(request)) {
    snapshot.tables.account_rows = readCanonicalDirectoryRows();
  }
  const filteredSnapshot = filterSnapshot(snapshot, readRequestedTables(request), shouldIncludeHistory(request));

  return NextResponse.json(filteredSnapshot, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="app-state-snapshot-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
