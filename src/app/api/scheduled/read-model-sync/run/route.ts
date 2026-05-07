export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  readManualSyncBlockedReason,
  readSyncStatus,
  triggerReadModelSync,
  waitForReadModelSync,
} from "@/lib/read-model/sync";

function isInternalHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

function readRuntimeEnv(name: string): string {
  const runtimeProcess = globalThis.process as NodeJS.Process | undefined;
  return String(runtimeProcess?.env?.[name] ?? "").trim();
}

function hasValidSecret(request: NextRequest): boolean {
  const secret = readRuntimeEnv("CALL_ACTIVITY_SYNC_SECRET");
  if (!secret) {
    return false;
  }

  const provided =
    request.headers.get("x-call-activity-sync-secret") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  return provided === secret;
}

function ensureAuthorized(request: NextRequest): void {
  if (isInternalHost(request) || hasValidSecret(request)) {
    return;
  }

  throw new HttpError(401, "Not authenticated.");
}

function readBooleanFlag(value: string | null | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function readBoundedInteger(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function timeoutAfter(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("timeout");
    }, ms);
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureAuthorized(request);

    const forceUnlock = readBooleanFlag(request.nextUrl.searchParams.get("forceUnlock"), false);
    const waitForCompletion = readBooleanFlag(request.nextUrl.searchParams.get("wait"), true);
    const timeoutMs = readBoundedInteger(
      request.nextUrl.searchParams.get("timeoutMs"),
      55 * 60_000,
      10_000,
      2 * 60 * 60_000,
    );

    if (forceUnlock) {
      const staleRunningAfterMs = getEnv().READ_MODEL_SYNC_STALE_RUNNING_AFTER_MS;
      readManualSyncBlockedReason(Date.now() + staleRunningAfterMs + 1);
    }

    const blockedReason = readManualSyncBlockedReason();
    if (blockedReason) {
      throw new HttpError(409, blockedReason);
    }

    const triggered = await withServiceAcumaticaSession(null, (cookieValue, authCookieRefresh) =>
      triggerReadModelSync(cookieValue, {
        authCookieRefresh,
        force: true,
      }),
    );

    if (triggered.alreadyRunning) {
      throw new HttpError(409, "A full account sync is already running.");
    }

    if (!waitForCompletion) {
      return NextResponse.json({
        ok: true,
        status: "started",
        sync: triggered.status,
      });
    }

    const completed = await Promise.race([waitForReadModelSync(), timeoutAfter(timeoutMs)]);
    if (completed === "timeout") {
      return NextResponse.json(
        {
          ok: true,
          status: "running",
          timeoutMs,
          sync: readSyncStatus(),
        },
        { status: 202 },
      );
    }

    const statusCode = completed.status === "failed" ? 409 : 200;
    return NextResponse.json(
      {
        ok: completed.status !== "failed",
        status: completed.status,
        sync: completed,
      },
      { status: statusCode },
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
