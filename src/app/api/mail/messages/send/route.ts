export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyAuditedMailSendJson } from "@/app/api/mail/_helpers";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return proxyAuditedMailSendJson(request, {
    path: "/api/mail/messages/send",
    method: "POST",
    body,
    forwardAcumaticaSession: true,
  });
}
