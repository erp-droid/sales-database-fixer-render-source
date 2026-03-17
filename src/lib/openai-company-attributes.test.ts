import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HttpError } from "@/lib/errors";
import type { CompanyAttributeSuggestionRequest } from "@/types/company-attribute-suggestion";

function buildRequest(
  overrides: Partial<CompanyAttributeSuggestionRequest> = {},
): CompanyAttributeSuggestionRequest {
  return {
    companyName: "Acme Packaging",
    companyDescription: null,
    businessAccountId: "BACCT-100",
    addressLine1: "123 Industrial Way",
    city: "Mississauga",
    state: "ON",
    postalCode: "L4Z 1N4",
    country: "CA",
    contactEmail: "info@acmepackaging.com",
    companyRegion: null,
    industryType: null,
    subCategory: null,
    category: null,
    ...overrides,
  };
}

describe("openai-company-attributes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
    process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_SUMMARY_MODEL = "gpt-4o-mini";
  });

  it("returns a ready suggestion with canonical values and sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "web_search_call",
              action: {
                sources: [
                  {
                    title: "Acme Packaging | About",
                    url: "https://acmepackaging.com/about",
                  },
                  {
                    title: "Acme Packaging | About",
                    url: "https://acmepackaging.com/about",
                  },
                ],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    category: "A",
                    industryType: "Manufactur",
                    subCategory: "Package",
                    companyDescription:
                      "Acme Packaging is a Canadian packaging manufacturer serving industrial and consumer brands.",
                    confidence: "high",
                    reasoning:
                      "The company describes itself as a packaging manufacturer on its website.",
                  }),
                  annotations: [
                    {
                      title: "Acme Packaging | About",
                      url: "https://acmepackaging.com/about",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { suggestCompanyAttributesWithOpenAi } = await import(
      "@/lib/openai-company-attributes"
    );
    const result = await suggestCompanyAttributesWithOpenAi(buildRequest());

    expect(result).toEqual({
      status: "ready",
      suggestion: {
        companyRegion: "Region 6",
        companyRegionLabel: "Region 6",
        category: "A",
        categoryLabel: "A - Type Clients",
        industryType: "Manufactur",
        industryTypeLabel: "Manufacturing",
        subCategory: "Package",
        subCategoryLabel: "Packaging",
        companyDescription:
          "Acme Packaging is a Canadian packaging manufacturer serving industrial and consumer brands.",
        confidence: "high",
        reasoning: "The company describes itself as a packaging manufacturer on its website.",
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.model).toBe("gpt-4o-mini");
    expect(payload.include).toEqual(["web_search_call.action.sources"]);
  });

  it("returns need_more_context before calling OpenAI when company clues are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { suggestCompanyAttributesWithOpenAi } = await import(
      "@/lib/openai-company-attributes"
    );
    const result = await suggestCompanyAttributesWithOpenAi(
      buildRequest({
        companyName: null,
        contactEmail: null,
      }),
    );

    expect(result).toEqual({
      status: "need_more_context",
      message: "Add a company name or contact email before asking OpenAI to classify attributes.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns no_match when OpenAI cannot classify either field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      category: "NONE",
                      industryType: "NONE",
                      subCategory: "NONE",
                      companyDescription: "NONE",
                      confidence: "low",
                      reasoning: "The public web results were too generic to classify this company.",
                    }),
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const { suggestCompanyAttributesWithOpenAi } = await import(
      "@/lib/openai-company-attributes"
    );
    await expect(suggestCompanyAttributesWithOpenAi(buildRequest())).resolves.toEqual({
      status: "ready",
      suggestion: {
        companyRegion: "Region 6",
        companyRegionLabel: "Region 6",
        category: null,
        categoryLabel: null,
        industryType: null,
        industryTypeLabel: null,
        subCategory: null,
        subCategoryLabel: null,
        companyDescription: null,
        confidence: "low",
        reasoning: "The public web results were too generic to classify this company.",
        sources: [],
      },
      filledFieldKeys: ["companyRegion"],
    });
  });

  it("maps OpenAI 429 responses into a stable app error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Rate limit exceeded",
            },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const { suggestCompanyAttributesWithOpenAi } = await import(
      "@/lib/openai-company-attributes"
    );

    await expect(suggestCompanyAttributesWithOpenAi(buildRequest())).rejects.toMatchObject({
      status: 429,
      message: "OpenAI rate limited this request. Wait a moment and try again.",
    } satisfies Partial<HttpError>);
  });
});
