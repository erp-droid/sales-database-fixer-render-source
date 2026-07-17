export const runtime = "nodejs";

import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  normalizePasswordRecoveryUsername,
  requestAcumaticaPasswordReset,
} from "@/lib/acumatica-password-recovery";
import { getEnv } from "@/lib/env";

const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS_PER_USERNAME = 5;
const MAX_ATTEMPTS_PER_IP = 20;
const attemptHistory = new Map<string, number[]>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function consumeRateLimit(key: string, maximum: number, now: number): number | null {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (attemptHistory.get(key) ?? []).filter((value) => value > cutoff);
  if (recent.length >= maximum) {
    const retryAt = recent[0] + RATE_LIMIT_WINDOW_MS;
    attemptHistory.set(key, recent);
    return Math.max(1, Math.ceil((retryAt - now) / 1000));
  }

  recent.push(now);
  attemptHistory.set(key, recent);
  return null;
}

function readUsername(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }

  const value = (body as Record<string, unknown>).username;
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(
  body: Record<string, unknown>,
  init?: { status?: number; retryAfter?: number },
): NextResponse {
  const response = NextResponse.json(body, { status: init?.status ?? 200 });
  response.headers.set("Cache-Control", "no-store");
  if (init?.retryAfter) {
    response.headers.set("Retry-After", String(init.retryAfter));
  }
  return response;
}

function resolvePublicOrigin(request: NextRequest): string {
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.trim();
  if (!forwardedHost) {
    return request.nextUrl.origin;
  }

  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (forwardedHost.startsWith("localhost") || forwardedHost.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${forwardedProto}://${forwardedHost}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.redirect(new URL("/forgot-password", resolvePublicOrigin(request)));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const rawUsername = readUsername(body);
  const username = normalizePasswordRecoveryUsername(rawUsername);

  if (!username || username.length > 254 || /[\u0000-\u001f\u007f]/.test(username)) {
    return noStoreJson(
      { error: "Enter your MeadowBrook username or email address." },
      { status: 400 },
    );
  }

  const now = Date.now();
  const usernameRetryAfter = consumeRateLimit(
    `username:${hashKey(username.toLowerCase())}`,
    MAX_ATTEMPTS_PER_USERNAME,
    now,
  );
  const ipRetryAfter = consumeRateLimit(
    `ip:${hashKey(getClientIp(request))}`,
    MAX_ATTEMPTS_PER_IP,
    now,
  );
  const retryAfter = Math.max(usernameRetryAfter ?? 0, ipRetryAfter ?? 0);
  if (retryAfter > 0) {
    return noStoreJson(
      { error: "Too many reset requests. Please wait before trying again." },
      { status: 429, retryAfter },
    );
  }

  try {
    await requestAcumaticaPasswordReset(username, getEnv());
    return noStoreJson({
      ok: true,
      message:
        "If that username matches a MeadowBrook account, password-reset instructions will arrive at the email address on file.",
    });
  } catch (error) {
    console.warn("[password-recovery] request failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return noStoreJson(
      {
        error:
          "Password reset is temporarily unavailable. Please try again or contact your MeadowBrook administrator.",
      },
      { status: 502 },
    );
  }
}
