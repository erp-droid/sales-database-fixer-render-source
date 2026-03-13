export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailJson } from "@/app/api/mail/_helpers";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return proxyMailJson(request, {
    path: "/api/mail/drafts",
    method: "POST",
    body,
    resolveRecipients: false,
    timeoutMs: 5000,
    timeoutMessage: "Draft save is taking longer than expected. Retry in a few seconds.",
  });
}
