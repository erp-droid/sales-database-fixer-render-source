export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";
import { readSyncStatus } from "@/lib/read-model/sync";

export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString();

  try {
    const env = getEnv();
    const syncStatus = env.READ_MODEL_ENABLED ? readSyncStatus() : null;

    if (env.READ_MODEL_ENABLED) {
      getReadModelDb().prepare("SELECT 1").get();
    }

    return NextResponse.json({
      ok: true,
      timestamp,
      readModelEnabled: env.READ_MODEL_ENABLED,
      syncStatus,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        timestamp,
        error: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
