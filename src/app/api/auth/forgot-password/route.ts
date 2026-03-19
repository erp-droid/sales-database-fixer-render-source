import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";

export async function GET(): Promise<NextResponse> {
  const env = getEnv();

  const fallbackUrl = `${env.ACUMATICA_BASE_URL}/Frames/Login.aspx`;
  const destination = env.AUTH_FORGOT_PASSWORD_URL ?? fallbackUrl;

  return NextResponse.redirect(destination);
}
