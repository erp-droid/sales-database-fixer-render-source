export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailJson } from "@/app/api/mail/_helpers";

type RouteContext = {
  params: Promise<{
    draftId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { draftId } = await context.params;
  const body = await request.json().catch(() => null);
  return proxyMailJson(request, {
    path: `/api/mail/drafts/${encodeURIComponent(draftId)}`,
    method: "PATCH",
    body,
    resolveRecipients: false,
    timeoutMs: 5000,
    timeoutMessage: "Draft save is taking longer than expected. Retry in a few seconds.",
  });
}
