export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailJson } from "@/app/api/mail/_helpers";

type RouteContext = {
  params: Promise<{
    threadId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { threadId } = await context.params;
  const body = await request.json().catch(() => null);
  return proxyMailJson(request, {
    path: `/api/mail/threads/${encodeURIComponent(threadId)}/link`,
    method: "POST",
    body,
    forwardAcumaticaSession: true,
  });
}
