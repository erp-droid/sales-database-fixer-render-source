export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyAuditedMailSendJson } from "@/app/api/mail/_helpers";

type RouteContext = {
  params: Promise<{
    draftId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { draftId } = await context.params;
  const body = await request.json().catch(() => null);
  return proxyAuditedMailSendJson(request, {
    path: `/api/mail/drafts/${encodeURIComponent(draftId)}/send`,
    method: "POST",
    body,
    forwardAcumaticaSession: true,
  });
}
