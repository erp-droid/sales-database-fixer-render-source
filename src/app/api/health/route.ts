export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import { readSyncStatus } from "@/lib/read-model/sync";
import { applyRuntimeIdentityHeaders, getRuntimeIdentitySnapshot } from "@/lib/runtime-identity";

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString();
  const runtimeIdentity = getRuntimeIdentitySnapshot();

  try {
    const env = getEnv();
    const syncStatus = readSyncStatus();
    const response = NextResponse.json({
      ok: true,
      timestamp,
      readModelEnabled: env.READ_MODEL_ENABLED,
      syncStatus,
      runtimeIdentity,
    });

    applyRuntimeIdentityHeaders(response);
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        ok: false,
        timestamp,
        error: getErrorMessage(error),
        runtimeIdentity,
      },
      { status: 500 },
    );

    applyRuntimeIdentityHeaders(response);
    return response;
  }
}
