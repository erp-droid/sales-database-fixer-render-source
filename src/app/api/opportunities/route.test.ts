import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

function buildRequest(): NextRequest {
  return new NextRequest("http://localhost/api/opportunities", {
    method: "POST",
    body: JSON.stringify({
      businessAccountRecordId: "record-1",
      businessAccountId: "02670D2595",
      contactId: 157497,
      subject: "Warehouse electrical upgrade",
    }),
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("POST /api/opportunities", () => {
  it("does not create opportunities without a local opportunity store", async () => {
    const { POST } = await import("@/app/api/opportunities/route");

    const response = await POST(buildRequest());

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Opportunity creation has been disabled in Sales MeadowBrook.",
    });
  });
});
