export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailJson } from "@/app/api/mail/_helpers";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return proxyMailJson(request, {
    path: "/api/mail/activities/log",
    method: "POST",
    body,
    forwardAcumaticaSession: true,
  });
}
