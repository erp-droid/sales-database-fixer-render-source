export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailJson } from "@/app/api/mail/_helpers";

export async function POST(request: NextRequest) {
  return proxyMailJson(request, {
    path: "/api/mail/oauth/disconnect",
    method: "POST",
  });
}
