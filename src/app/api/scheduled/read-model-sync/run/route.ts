export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";
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

function normalizeOptionalLoginName(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function readStoredCredentialLoginNames(limit = 25): string[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT login_name
      FROM user_auth_credentials
      ORDER BY updated_at DESC
      LIMIT ?
      `,
    )
    .all(Math.max(1, Math.min(limit, 200))) as Array<{ login_name?: string | null }>;

  const deduped = new Set<string>();
  for (const row of rows) {
    const loginName = normalizeOptionalLoginName(row.login_name);
    if (loginName) {
      deduped.add(loginName);
    }
  }

  return Array.from(deduped);
}

function buildCredentialCandidates(input: {
  preferredLoginName: string | null;
  includeStoredFallback: boolean;
}): Array<string | null> {
  const candidates: Array<string | null> = [];
  const pushCandidate = (candidate: string | null): void => {
    if (candidate === null) {
      if (!candidates.includes(null)) {
        candidates.push(null);
      }
      return;
    }
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (input.preferredLoginName) {
    pushCandidate(input.preferredLoginName);
  }

  pushCandidate(null);

  if (input.includeStoredFallback) {
    for (const storedLoginName of readStoredCredentialLoginNames()) {
      pushCandidate(storedLoginName);
    }
  }

  return candidates;
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
    const preferredLoginName = normalizeOptionalLoginName(
      request.nextUrl.searchParams.get("loginName"),
    );
    const includeStoredFallback = readBooleanFlag(
      request.nextUrl.searchParams.get("tryStoredCredentials"),
      true,
    );
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

    let triggered: Awaited<ReturnType<typeof triggerReadModelSync>> | null = null;
    let credentialSource: string | null = null;
    const credentialErrors: string[] = [];
    const candidates = buildCredentialCandidates({
      preferredLoginName,
      includeStoredFallback,
    });

    for (const candidate of candidates) {
      try {
        const response = await withServiceAcumaticaSession(
          candidate,
          (cookieValue, authCookieRefresh) =>
            triggerReadModelSync(cookieValue, {
              authCookieRefresh,
              force: true,
            }),
        );
        triggered = response;
        credentialSource = candidate;
        break;
      } catch (error) {
        credentialErrors.push(
          `${candidate ?? "__service__"}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!triggered) {
      throw new HttpError(
        500,
        `Unable to establish an Acumatica session for full sync. ${credentialErrors.join(" | ")}`,
      );
    }

    if (triggered.alreadyRunning) {
      throw new HttpError(409, "A full account sync is already running.");
    }

    if (!waitForCompletion) {
      return NextResponse.json({
        ok: true,
        status: "started",
        credentialSource: credentialSource ?? "__service__",
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
        credentialSource: credentialSource ?? "__service__",
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
