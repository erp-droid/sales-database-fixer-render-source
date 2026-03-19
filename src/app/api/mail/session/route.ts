export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { proxyMailSessionJson } from "@/app/api/mail/_helpers";

export async function GET(request: NextRequest) {
  return proxyMailSessionJson(request);
}
