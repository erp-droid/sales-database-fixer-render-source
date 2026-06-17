import type { NextRequest } from "next/server";

import {
  getStoredLoginName,
  requireAuthCookieValue,
  requireStoredLoginName,
} from "@/lib/auth";

function normalizeLoginName(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed || null;
}

function readLoginNameHint(request: NextRequest): string | null {
  return (
    normalizeLoginName(request.nextUrl.searchParams.get("loginName")) ??
    normalizeLoginName(request.headers.get("x-mb-login-name"))
  );
}

export function requireRequestLoginName(request: NextRequest): string {
  const storedLoginName = normalizeLoginName(getStoredLoginName(request));
  if (storedLoginName) {
    return storedLoginName;
  }

  const hintedLoginName = readLoginNameHint(request);
  if (hintedLoginName) {
    requireAuthCookieValue(request);
    return hintedLoginName;
  }

  return requireStoredLoginName(request);
}
