import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/errors";

const requireAuthCookieValue = vi.fn(() => "cookie");
const suggestCompanyAttributesWithOpenAi = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
}));

vi.mock("@/lib/openai-company-attributes", () => ({
  suggestCompanyAttributesWithOpenAi,
}));

describe("POST /api/business-accounts/[id]/attribute-suggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
  });

  it("returns 503 when OpenAI is not configured", async () => {
    suggestCompanyAttributesWithOpenAi.mockRejectedValue(
      new HttpError(503, "OpenAI is not configured for company attribute suggestions."),
    );

    const { POST } = await import("@/app/api/business-accounts/[id]/attribute-suggestion/route");
    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts/0001/attribute-suggestion", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Packaging",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "0001",
        }),
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI is not configured for company attribute suggestions.",
      details: undefined,
    });
  });

  it("returns a ready response when OpenAI finds attribute values", async () => {
    suggestCompanyAttributesWithOpenAi.mockResolvedValue({
      status: "ready",
      suggestion: {
        companyRegion: "Region 6",
        companyRegionLabel: "Region 6",
        category: "A",
        categoryLabel: "A - Type Clients",
        industryType: "Service",
        industryTypeLabel: "Service",
        subCategory: "General",
        subCategoryLabel: "General",
        companyDescription: "CBRE is a commercial real estate services and investment firm.",
        confidence: "medium",
        reasoning: "The company appears to be a commercial property services business.",
        sources: [
          {
            title: "CBRE | About",
            url: "https://www.cbre.com/about",
            domain: "cbre.com",
          },
        ],
      },
      filledFieldKeys: [
        "companyRegion",
        "category",
        "industryType",
        "subCategory",
        "companyDescription",
      ],
    });

    const { POST } = await import("@/app/api/business-accounts/[id]/attribute-suggestion/route");
    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts/0001/attribute-suggestion", {
        method: "POST",
        body: JSON.stringify({
          companyName: "CBRE Limited",
          city: "Kitchener",
          state: "ON",
          country: "CA",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "0001",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      suggestion: {
        companyRegion: "Region 6",
        companyRegionLabel: "Region 6",
        category: "A",
        categoryLabel: "A - Type Clients",
        industryType: "Service",
        industryTypeLabel: "Service",
        subCategory: "General",
        subCategoryLabel: "General",
        companyDescription: "CBRE is a commercial real estate services and investment firm.",
        confidence: "medium",
        reasoning: "The company appears to be a commercial property services business.",
        sources: [
          {
            title: "CBRE | About",
            url: "https://www.cbre.com/about",
            domain: "cbre.com",
          },
        ],
      },
      filledFieldKeys: [
        "companyRegion",
        "category",
        "industryType",
        "subCategory",
        "companyDescription",
      ],
    });
  });

  it("returns need_more_context for weak requests", async () => {
    suggestCompanyAttributesWithOpenAi.mockResolvedValue({
      status: "need_more_context",
      message: "Add a company name or contact email before asking OpenAI to classify attributes.",
    });

    const { POST } = await import("@/app/api/business-accounts/[id]/attribute-suggestion/route");
    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts/0001/attribute-suggestion", {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "0001",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "need_more_context",
      message: "Add a company name or contact email before asking OpenAI to classify attributes.",
    });
  });

  it("returns no_match when OpenAI cannot classify the company", async () => {
    suggestCompanyAttributesWithOpenAi.mockResolvedValue({
      status: "no_match",
      message: "The public web results were too generic to classify this company.",
    });

    const { POST } = await import("@/app/api/business-accounts/[id]/attribute-suggestion/route");
    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts/0001/attribute-suggestion", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Packaging",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({
          id: "0001",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "no_match",
      message: "The public web results were too generic to classify this company.",
    });
  });
});
