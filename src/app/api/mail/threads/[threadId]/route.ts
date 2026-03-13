export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailJson } from "@/app/api/mail/_helpers";

type RouteContext = {
  params: Promise<{
    threadId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { threadId } = await context.params;
  return proxyMailJson(request, {
    path: `/api/mail/threads/${encodeURIComponent(threadId)}`,
    timeoutMs: 5000,
    timeoutMessage: "Mailbox thread is taking longer than expected. Retry in a few seconds.",
  });
}
