export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailThreadListJson } from "@/app/api/mail/_helpers";

export async function GET(request: NextRequest) {
  return proxyMailThreadListJson(request);
}
