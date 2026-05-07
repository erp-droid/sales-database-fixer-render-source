export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { HttpError, getErrorMessage } from "@/lib/errors";
import { getReadModelDb } from "@/lib/read-model/db";

type StoredAccountRow = {
  row_key: string;
  company_name: string;
  payload_json: string;
};

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

function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function readCategory(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "D";
  if (!normalized) {
    return "D";
  }
  if (!/^[A-Z]$/.test(normalized)) {
    throw new HttpError(400, "category must be a single letter.");
  }
  return normalized;
}

function readCompanyNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "companyNames must be an array of strings.");
  }

  const names = value
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (names.length === 0) {
    throw new HttpError(400, "companyNames must include at least one value.");
  }

  return names;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    ensureAuthorized(request);

    const rawBody = (await request.json()) as Record<string, unknown>;
    const category = readCategory(rawBody.category);
    const companyNames = readCompanyNames(rawBody.companyNames);
    const normalizedTargetNames = new Set(companyNames.map((name) => normalizeName(name)));

    const db = getReadModelDb();
    const rows = db
      .prepare(
        `
        SELECT row_key, company_name, payload_json
        FROM account_rows
        `,
      )
      .all() as StoredAccountRow[];

    const now = new Date().toISOString();
    const matchedCompanies = new Set<string>();
    let matchedRows = 0;

    const update = db.prepare(
      `
      UPDATE account_rows
      SET category = ?,
          payload_json = ?,
          updated_at = ?
      WHERE row_key = ?
      `,
    );

    const applyUpdates = db.transaction(() => {
      for (const row of rows) {
        const normalizedCompanyName = normalizeName(row.company_name);
        if (!normalizedTargetNames.has(normalizedCompanyName)) {
          continue;
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        } catch {
          continue;
        }

        payload.category = category;
        update.run(category, JSON.stringify(payload), now, row.row_key);
        matchedRows += 1;
        matchedCompanies.add(normalizedCompanyName);
      }
    });

    applyUpdates();

    return NextResponse.json({
      ok: true,
      category,
      requestedCompanies: normalizedTargetNames.size,
      matchedCompanies: matchedCompanies.size,
      updatedRows: matchedRows,
      updatedAt: now,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
