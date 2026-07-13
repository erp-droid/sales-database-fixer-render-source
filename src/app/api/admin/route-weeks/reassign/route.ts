import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const ADMIN_TOKEN = "974a7830a84a313e4ee51d939684773476dc101f64dc3752447a9b5f65baa17b";
const SCRIPT_TIMEOUT_MS = 300_000;
const REPORT_PATH = "/app/data/rep-route-weeks-report.json";

function isAuthorized(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-justin-region6-admin-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === ADMIN_TOKEN || queryToken === ADMIN_TOKEN;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "dry-run";
  const clusterIterations = parsePositiveInteger(
    request.nextUrl.searchParams.get("clusterIterations"),
    40,
  );
  const salesRepId = parseOptionalText(request.nextUrl.searchParams.get("salesRepId"));
  const salesRepName = parseOptionalText(request.nextUrl.searchParams.get("salesRepName"));
  const targeted = Boolean(salesRepId || salesRepName);
  const clearNonAbWeeksValue = request.nextUrl.searchParams.get("clearNonAbWeeks");
  const clearNonAbWeeks = clearNonAbWeeksValue
    ? clearNonAbWeeksValue.trim().toLowerCase() !== "false"
    : !targeted;
  const includeAssignments =
    request.nextUrl.searchParams.get("includeAssignments")?.trim().toLowerCase() === "true";

  const scriptPath = path.join(process.cwd(), "scripts", "reassign-route-weeks-by-rep.cjs");
  const args = [
    scriptPath,
    mode === "apply" ? "--apply" : "--dry-run",
    "--cluster-iterations",
    String(clusterIterations),
    clearNonAbWeeks ? "--clear-non-ab-weeks" : "--keep-non-ab-weeks",
  ];
  if (salesRepId) {
    args.push("--sales-rep-id", salesRepId);
  }
  if (salesRepName) {
    args.push("--sales-rep-name", salesRepName);
  }
  if (includeAssignments) {
    args.push("--include-assignments");
  }
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
  }
}
