export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { exportAppStateTransferSnapshot, PORTABLE_TABLES } from "@/lib/state-transfer";

const SYSTEM_KEY_HEADER = "x-system-key";

function readRuntimeEnv(name: string): string {
  const runtimeProcess = globalThis.process as NodeJS.Process | undefined;
  return String(runtimeProcess?.env?.[name] ?? "").trim();
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidSystemKey(request: NextRequest): boolean {
  const configuredKey =
    readRuntimeEnv("STATE_TRANSFER_SYSTEM_KEY") || readRuntimeEnv("SYSTEM_CRON_KEY");
  if (!configuredKey) {
    return false;
  }

  const providedKey = request.headers.get(SYSTEM_KEY_HEADER)?.trim() ?? "";
  if (!providedKey) {
    return false;
  }

  return safeEqual(configuredKey, providedKey);
}

function ensureAuthorized(request: NextRequest): void {
  if (hasValidSystemKey(request)) {
    return;
  }

  requireAuthCookieValue(request);
}

function parseRequestedTables(request: NextRequest): string[] {
  const raw = request.nextUrl.searchParams.get("tables")?.trim() ?? "";
  if (!raw) {
    return [];
  }

  const allowed = new Set<string>(PORTABLE_TABLES);
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && allowed.has(value));
}

function shouldIncludeHistory(request: NextRequest): boolean {
  const value = request.nextUrl.searchParams.get("includeHistory")?.trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "no";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  ensureAuthorized(request);

  const snapshot = await exportAppStateTransferSnapshot(request.nextUrl.origin, {
    includeDataQualityHistory: shouldIncludeHistory(request),
    tableNames: parseRequestedTables(request),
  });
  return NextResponse.json(snapshot, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="app-state-snapshot-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
