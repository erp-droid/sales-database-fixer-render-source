export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { redirectToMailOauthStart } from "@/app/api/mail/_helpers";

export async function GET(request: NextRequest) {
  return redirectToMailOauthStart(request);
}
