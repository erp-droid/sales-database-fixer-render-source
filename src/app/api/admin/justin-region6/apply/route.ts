import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const ADMIN_TOKEN = "974a7830a84a313e4ee51d939684773476dc101f64dc3752447a9b5f65baa17b";
const SCRIPT_TIMEOUT_MS = 300_000;
const DEFAULT_EXPECTED_SOURCE_TOTAL = 109;
const DEFAULT_EXPECTED_ROUTE_TOTAL = 109;
const REPORT_PATH = "/app/data/justin-region6-list-report.json";

type SourceRow = {
  rowNumber?: number;
  companyName?: string;
  priority?: string | null;
  phoneNumber?: string | null;
  city?: string | null;
  streetAddress?: string | null;
};

function isAuthorized(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-justin-region6-admin-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === ADMIN_TOKEN || queryToken === ADMIN_TOKEN;
}

function readMode(value: string | null): "dry-run" | "apply" {
  return value === "apply" ? "apply" : "dry-run";
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReport(stdout: string): unknown {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    return null;
  }

  try {
    return JSON.parse(lastLine);
  } catch {
    return { raw: stdout };
  }
}

function normalizeRows(value: unknown): SourceRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }

    const input = row as Record<string, unknown>;
    const companyName = String(input.companyName ?? "").trim();
    if (!companyName) {
      return [];
    }

    return [
      {
        rowNumber:
          typeof input.rowNumber === "number" && Number.isFinite(input.rowNumber)
            ? input.rowNumber
            : undefined,
        companyName,
        priority:
          typeof input.priority === "string" && input.priority.trim()
            ? input.priority.trim()
            : null,
        phoneNumber:
          typeof input.phoneNumber === "string" && input.phoneNumber.trim()
            ? input.phoneNumber.trim()
            : null,
        city:
          typeof input.city === "string" && input.city.trim() ? input.city.trim() : null,
        streetAddress:
          typeof input.streetAddress === "string" && input.streetAddress.trim()
            ? input.streetAddress.trim()
            : null,
      },
    ];
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const mode = readMode(request.nextUrl.searchParams.get("mode"));
  const expectedSourceTotal = parsePositiveInteger(
    request.nextUrl.searchParams.get("expectedSourceTotal"),
    DEFAULT_EXPECTED_SOURCE_TOTAL,
  );
  const expectedRouteTotal = parsePositiveInteger(
    request.nextUrl.searchParams.get("expectedRouteTotal"),
    DEFAULT_EXPECTED_ROUTE_TOTAL,
  );
  const clusterIterations = parsePositiveInteger(
    request.nextUrl.searchParams.get("clusterIterations"),
    40,
  );
  const promoteSourceNonAbTo = request.nextUrl.searchParams.get("promoteSourceNonAbTo") || "B";
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  const rows = normalizeRows(body?.rows);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No source rows provided." }, { status: 400 });
  }

  const sourcePath = path.join(
    os.tmpdir(),
    `justin-region6-source-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  await fs.writeFile(sourcePath, `${JSON.stringify(rows)}\n`, "utf8");

  const scriptPath = path.join(process.cwd(), "scripts", "apply-justin-region6-list.cjs");
  const args = [
    scriptPath,
    mode === "apply" ? "--apply" : "--dry-run",
    "--source-json",
    sourcePath,
    "--expected-source-total",
    String(expectedSourceTotal),
    "--expected-route-total",
    String(expectedRouteTotal),
    "--promote-source-non-ab-to",
    promoteSourceNonAbTo,
    "--cluster-iterations",
    String(clusterIterations),
  ];
  if (mode === "apply") {
    args.push("--report", REPORT_PATH);
  }

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: SCRIPT_TIMEOUT_MS,
    });

    return NextResponse.json({
      ok: true,
      mode,
      report: parseReport(stdout),
      stderr: stderr.trim() || null,
    });
  } catch (error) {
    const execError = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return NextResponse.json(
      {
        error: execError.message,
        code: execError.code ?? null,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
      },
      { status: 500 },
    );
  } finally {
    await fs.unlink(sourcePath).catch(() => undefined);
  }
}
