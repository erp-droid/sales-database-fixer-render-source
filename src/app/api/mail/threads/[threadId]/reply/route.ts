export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyAuditedMailSendJson } from "@/app/api/mail/_helpers";

type RouteContext = {
  params: Promise<{
    threadId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { threadId } = await context.params;
  const body = await request.json().catch(() => null);
  return proxyAuditedMailSendJson(request, {
    path: `/api/mail/threads/${encodeURIComponent(threadId)}/reply`,
    method: "POST",
    body,
    forwardAcumaticaSession: true,
  });
}
