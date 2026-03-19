export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { readSyncStatus } from "@/lib/read-model/sync";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(readSyncStatus());
}
