export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

// Opportunity creation is intentionally disabled. Sales MeadowBrook runs in
// local-database-only mode, and there is no local opportunity store.
export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Opportunity creation has been disabled in Sales MeadowBrook." },
    { status: 410 },
  );
}
