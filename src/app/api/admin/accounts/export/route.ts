import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const ADMIN_TOKEN = "974a7830a84a313e4ee51d939684773476dc101f64dc3752447a9b5f65baa17b";
const SCRIPT_TIMEOUT_MS = 120_000;

function isAuthorized(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-justin-region6-admin-token");
  const queryToken = request.nextUrl.searchParams.get("token");
  return headerToken === ADMIN_TOKEN || queryToken === ADMIN_TOKEN;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const scriptPath = path.join(process.cwd(), "scripts", "export-accounts.cjs");

  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: SCRIPT_TIMEOUT_MS,
    });

    return new NextResponse(stdout, {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const execError = error as Error & { stderr?: string };
    return NextResponse.json(
      { error: execError.message, stderr: execError.stderr ?? "" },
      { status: 500 },
    );
  }
}
