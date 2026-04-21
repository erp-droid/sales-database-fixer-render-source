export const runtime = "nodejs";

import { writeFile } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { buildCookieHeader, requireAuthCookieValue } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";

function buildAcumaticaUrl(resourcePath: string): string {
  const { ACUMATICA_BASE_URL, ACUMATICA_ENTITY_PATH } = getEnv();
  const normalizedResource = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
  return `${ACUMATICA_BASE_URL}${ACUMATICA_ENTITY_PATH}${normalizedResource}`;
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return await response.text();
  }
  return response.json().catch(async () => await response.text());
}

async function proxyRequest(
  request: NextRequest,
  method: "GET" | "POST" | "PUT",
): Promise<NextResponse> {
  const cookieValue = requireAuthCookieValue(request);
  const path = request.nextUrl.searchParams.get("path")?.trim();
  if (!path) {
    throw new HttpError(400, "path is required");
  }

  const body = method === "GET" ? undefined : await request.json().catch(() => null);

  const response = await fetch(buildAcumaticaUrl(path), {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      Cookie: buildCookieHeader(cookieValue),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const payload = await readPayload(response);
  const result = {
    ok: response.ok,
    status: response.status,
    path,
    payload,
  };
  if (request.nextUrl.searchParams.get("dump") === "1") {
    await writeFile("/tmp/acumatica-activity-debug.json", JSON.stringify(result, null, 2), "utf8");
  }
  return NextResponse.json(
    result,
    { status: response.ok ? 200 : response.status },
  );
}

function buildErrorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json(
      {
        error: error.message,
        details: error.details ?? null,
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      error: getErrorMessage(error),
    },
    { status: 500 },
  );
}

async function handleProxyRequest(
  request: NextRequest,
  method: "GET" | "POST" | "PUT",
): Promise<NextResponse> {
  try {
    return await proxyRequest(request, method);
  } catch (error) {
    return buildErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  return handleProxyRequest(request, "GET");
}

export async function POST(request: NextRequest) {
  return handleProxyRequest(request, "POST");
}

export async function PUT(request: NextRequest) {
  return handleProxyRequest(request, "PUT");
}
