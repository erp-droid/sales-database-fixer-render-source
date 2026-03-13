export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { buildOpportunityCreateOptions } from "@/lib/opportunity-create";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(buildOpportunityCreateOptions());
}
