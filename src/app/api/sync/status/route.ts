export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { readSyncStatus } from "@/lib/read-model/sync";
import { applyRuntimeIdentityHeaders } from "@/lib/runtime-identity";

export async function GET(): Promise<NextResponse> {
  const response = NextResponse.json(readSyncStatus());
  applyRuntimeIdentityHeaders(response);
  return response;
}
