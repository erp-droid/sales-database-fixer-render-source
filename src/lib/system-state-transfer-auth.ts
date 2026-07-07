import crypto from "node:crypto";

import type { NextRequest } from "next/server";

function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function timingSafeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function readAllowedKeys(): string[] {
  return [
    process.env.STATE_TRANSFER_SYSTEM_KEY,
    process.env.CALL_ACTIVITY_SYNC_SECRET,
    process.env.DAILY_CALL_COACHING_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function isAuthorizedStateTransferSystemRequest(request: NextRequest): boolean {
  const actual =
    request.headers.get("x-system-key")?.trim() ??
    request.headers.get("x-state-transfer-key")?.trim() ??
    readBearerToken(request) ??
    "";
  if (!actual) return false;

  return readAllowedKeys().some((expected) => timingSafeEquals(actual, expected));
}
