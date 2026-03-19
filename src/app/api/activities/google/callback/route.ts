export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { ensureMailServiceConfigured } from "@/lib/mail-auth";

export async function GET(request: NextRequest) {
  const { serviceUrl } = ensureMailServiceConfigured();
  const callbackUrl = new URL(`${serviceUrl.replace(/\/$/, "")}/api/mail/oauth/callback`);
  callbackUrl.search = request.nextUrl.searchParams.toString();
  return NextResponse.redirect(callbackUrl);
}
