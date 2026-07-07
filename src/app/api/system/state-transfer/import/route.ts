export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { importAppStateTransferSnapshot } from "@/lib/state-transfer";
import { isAuthorizedStateTransferSystemRequest } from "@/lib/system-state-transfer-auth";

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
  if (!isAuthorizedStateTransferSystemRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
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
