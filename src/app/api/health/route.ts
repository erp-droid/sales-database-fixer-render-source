export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";
import { readSyncStatus } from "@/lib/read-model/sync";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const timestamp = new Date().toISOString();
  const deep = request.nextUrl.searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json({
      ok: true,
      timestamp,
      mode: "liveness",
    });
  }

  try {
    const env = getEnv();
    const syncStatus = env.READ_MODEL_ENABLED ? readSyncStatus() : null;

    if (env.READ_MODEL_ENABLED) {
      getReadModelDb().prepare("SELECT 1").get();
    }

    return NextResponse.json({
      ok: true,
      timestamp,
      mode: "deep",
      readModelEnabled: env.READ_MODEL_ENABLED,
      syncStatus,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        timestamp,
        mode: "deep",
        error: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
