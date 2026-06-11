import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const ADMIN_TOKEN = "974a7830a84a313e4ee51d939684773476dc101f64dc3752447a9b5f65baa17b";
const DEFAULT_EXPECTED_TOTAL = 1254;
const REPORT_PATH = "/app/data/route-week-assignment-report.json";

function parseExpectedTotal(value: string | null): number {
  if (!value) {
    return DEFAULT_EXPECTED_TOTAL;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_EXPECTED_TOTAL;
}

function readMode(value: string | null): "dry-run" | "apply" {
  return value === "apply" ? "apply" : "dry-run";
}

function isAuthorized(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-route-week-admin-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === ADMIN_TOKEN || queryToken === ADMIN_TOKEN;
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

  const mode = readMode(request.nextUrl.searchParams.get("mode"));
  const expectedTotal = parseExpectedTotal(request.nextUrl.searchParams.get("expectedTotal"));
  const scriptPath = path.join(process.cwd(), "scripts", "assign-account-route-weeks.cjs");
  const args = [
    scriptPath,
    mode === "apply" ? "--apply" : "--dry-run",
    "--expected-total",
    String(expectedTotal),
  ];
  if (mode === "apply") {
    args.push("--report", REPORT_PATH);
  }

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
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
