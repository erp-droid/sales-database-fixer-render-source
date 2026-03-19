export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { importAppStateTransferSnapshot } from "@/lib/state-transfer";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function readSnapshotBody(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("snapshot");
    if (!(file instanceof File)) {
      throw new Error("Form upload must include a snapshot file.");
    }

    return JSON.parse(await file.text()) as unknown;
  }

  return request.json();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  requireAuthCookieValue(request);

  if (!isLocalHost(request.nextUrl.hostname)) {
    return NextResponse.json(
      {
        error: "Snapshot import is only allowed on localhost.",
      },
      { status: 403 },
    );
  }

  try {
    const snapshot = await readSnapshotBody(request);
    const result = await importAppStateTransferSnapshot(snapshot);
    return NextResponse.json(result, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Snapshot import failed.",
      },
      { status: 400 },
    );
  }
}
