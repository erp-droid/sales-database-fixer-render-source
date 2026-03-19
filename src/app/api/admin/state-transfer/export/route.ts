export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { exportAppStateTransferSnapshot } from "@/lib/state-transfer";

export async function GET(request: NextRequest): Promise<NextResponse> {
  requireAuthCookieValue(request);

  const snapshot = await exportAppStateTransferSnapshot(request.nextUrl.origin);
  return NextResponse.json(snapshot, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="app-state-snapshot-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
