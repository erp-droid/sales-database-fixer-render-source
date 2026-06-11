import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const ADMIN_TOKEN = "974a7830a84a313e4ee51d939684773476dc101f64dc3752447a9b5f65baa17b";
const SCRIPT_TIMEOUT_MS = 300_000;
const DEFAULT_BACKUP_PATH =
  "/app/data/read-model.justin-region6-preapply-2026-06-11T20-32-58-710Z.sqlite";
const REPORT_PATH = "/app/data/justin-c-restore-report.json";

function isAuthorized(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-justin-region6-admin-token");
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

  const mode = request.nextUrl.searchParams.get("mode") === "apply" ? "apply" : "dry-run";
  const backupPath =
    request.nextUrl.searchParams.get("backupPath")?.trim() || DEFAULT_BACKUP_PATH;

  const scriptPath = path.join(process.cwd(), "scripts", "restore-justin-c-categories.cjs");
  const args = [
    scriptPath,
    mode === "apply" ? "--apply" : "--dry-run",
    "--backup-path",
    backupPath,
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
  }
}
