export const runtime = "nodejs";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const CONFIRMATION_HEADER = "merge-contact-duplicates-v1";

type CleanupRequest = {
  apply?: boolean;
  includeExact?: boolean;
};

function parseCleanupRequest(value: unknown): CleanupRequest {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    apply: record.apply === true,
    includeExact: record.includeExact !== false,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("x-cleanup-confirm") !== CONFIRMATION_HEADER) {
    return NextResponse.json(
      { error: "Missing contact duplicate cleanup confirmation header." },
      { status: 403 },
    );
  }

  const body = parseCleanupRequest(await request.json().catch(() => ({})));
  const args = ["scripts/cleanup-contact-duplicate-rows.cjs"];
  if (body.includeExact) {
    args.push("--include-exact");
  }
  if (body.apply) {
    args.push("--apply");
  }

  try {
    const result = await execFileAsync("node", args, {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const parsed = JSON.parse(result.stdout) as unknown;
    return NextResponse.json(parsed, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const record = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return NextResponse.json(
      {
        error: record.message ?? "Contact duplicate cleanup failed.",
        exitCode: record.code ?? null,
        stdout: record.stdout ?? "",
        stderr: record.stderr ?? "",
      },
      { status: 500 },
    );
  }
}
