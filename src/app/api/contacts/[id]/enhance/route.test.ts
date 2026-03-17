import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/errors";

const requireAuthCookieValue = vi.fn(() => "cookie");
const enhanceContactWithRocketReach = vi.fn();
const updateContact = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
}));

vi.mock("@/lib/rocketreach", () => ({
  enhanceContactWithRocketReach,
}));

vi.mock("@/lib/acumatica", () => ({
  updateContact,
}));

describe("POST /api/contacts/[id]/enhance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
  });

  it("returns 503 when RocketReach is not configured", async () => {
    enhanceContactWithRocketReach.mockRejectedValue(
      new HttpError(503, "RocketReach is not configured for this environment."),
    );

    const { POST } = await import("@/app/api/contacts/[id]/enhance/route");
    const response = await POST(
      new NextRequest("http://localhost/api/contacts/157497/enhance", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Industrial",
          contactName: "Casey Brown",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "157497",
        }),
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "RocketReach is not configured for this environment.",
      details: undefined,
    });
  });

  it("returns a ready response for a single match", async () => {
    enhanceContactWithRocketReach.mockResolvedValue({
      status: "ready",
      suggestion: {
        name: "Casey Brown",
        jobTitle: "Account Executive",
        email: "casey.brown@acme.com",
        phone: "416-555-0100",
      },
      filledFieldKeys: ["jobTitle", "email", "phone"],
    });

    const { POST } = await import("@/app/api/contacts/[id]/enhance/route");
    const response = await POST(
      new NextRequest("http://localhost/api/contacts/157497/enhance", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Industrial",
          contactName: "Casey Brown",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "157497",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      suggestion: {
        name: "Casey Brown",
        jobTitle: "Account Executive",
        email: "casey.brown@acme.com",
        phone: "416-555-0100",
      },
      filledFieldKeys: ["jobTitle", "email", "phone"],
    });
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("returns candidate selection when multiple matches exist", async () => {
    enhanceContactWithRocketReach.mockResolvedValue({
      status: "needs_selection",
      candidates: [
        {
          id: 100,
          name: "Casey Brown",
          currentTitle: "Estimator",
          currentEmployer: "Acme Industrial",
          location: "Toronto, ON, Canada",
          linkedinUrl: "https://www.linkedin.com/in/casey-brown",
        },
      ],
    });

    const { POST } = await import("@/app/api/contacts/[id]/enhance/route");
    const response = await POST(
      new NextRequest("http://localhost/api/contacts/157497/enhance", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Industrial",
          city: "Toronto",
          state: "ON",
          country: "CA",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "157497",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "needs_selection",
      candidates: [
        {
          id: 100,
          name: "Casey Brown",
          currentTitle: "Estimator",
          currentEmployer: "Acme Industrial",
          location: "Toronto, ON, Canada",
          linkedinUrl: "https://www.linkedin.com/in/casey-brown",
        },
      ],
    });
  });

  it("returns need_more_context for weak company-only requests", async () => {
    enhanceContactWithRocketReach.mockResolvedValue({
      status: "need_more_context",
      message: "Add a contact name or more location details before enhancing with RocketReach.",
    });

    const { POST } = await import("@/app/api/contacts/[id]/enhance/route");
    const response = await POST(
      new NextRequest("http://localhost/api/contacts/157497/enhance", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Industrial",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "157497",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "need_more_context",
      message: "Add a contact name or more location details before enhancing with RocketReach.",
    });
  });

  it("returns no_match when search results are empty", async () => {
    enhanceContactWithRocketReach.mockResolvedValue({
      status: "no_match",
      message: "RocketReach did not find a matching contact from the available details.",
    });

    const { POST } = await import("@/app/api/contacts/[id]/enhance/route");
    const response = await POST(
      new NextRequest("http://localhost/api/contacts/157497/enhance", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Industrial",
          contactName: "Casey Brown",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "157497",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "no_match",
      message: "RocketReach did not find a matching contact from the available details.",
    });
  });
});
