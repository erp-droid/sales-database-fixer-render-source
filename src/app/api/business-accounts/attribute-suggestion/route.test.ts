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

describe("POST /api/business-accounts/attribute-suggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthCookieValue.mockReturnValue("cookie");
  });

  it("returns a ready response for create-company suggestions", async () => {
    suggestCompanyAttributesWithOpenAi.mockResolvedValue({
      status: "ready",
      suggestion: {
        companyRegion: "Region 6",
        companyRegionLabel: "Region 6",
        category: "B",
        categoryLabel: "B - Type Clients",
        industryType: "Manufactur",
        industryTypeLabel: "Manufacturing",
        subCategory: "Package",
        subCategoryLabel: "Packaging",
        companyDescription: "Acme Packaging manufactures packaging products for industrial customers.",
        confidence: "high",
        reasoning: "The company website describes industrial packaging manufacturing services.",
        sources: [
          {
            title: "Acme Packaging | About",
            url: "https://acmepackaging.com/about",
            domain: "acmepackaging.com",
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

    const { POST } = await import("@/app/api/business-accounts/attribute-suggestion/route");
    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts/attribute-suggestion", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Packaging",
          city: "Mississauga",
          state: "ON",
          postalCode: "L4Z 1N4",
          country: "CA",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      suggestion: {
        companyRegion: "Region 6",
        companyRegionLabel: "Region 6",
        category: "B",
        categoryLabel: "B - Type Clients",
        industryType: "Manufactur",
        industryTypeLabel: "Manufacturing",
        subCategory: "Package",
        subCategoryLabel: "Packaging",
        companyDescription: "Acme Packaging manufactures packaging products for industrial customers.",
        confidence: "high",
        reasoning: "The company website describes industrial packaging manufacturing services.",
        sources: [
          {
            title: "Acme Packaging | About",
            url: "https://acmepackaging.com/about",
            domain: "acmepackaging.com",
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

  it("returns 503 when OpenAI is not configured", async () => {
    suggestCompanyAttributesWithOpenAi.mockRejectedValue(
      new HttpError(503, "OpenAI is not configured for company attribute suggestions."),
    );

    const { POST } = await import("@/app/api/business-accounts/attribute-suggestion/route");
    const response = await POST(
      new NextRequest("http://localhost/api/business-accounts/attribute-suggestion", {
        method: "POST",
        body: JSON.stringify({
          companyName: "Acme Packaging",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI is not configured for company attribute suggestions.",
      details: undefined,
    });
  });
});
