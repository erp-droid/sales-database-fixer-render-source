import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactEnhanceRequest } from "@/types/contact-enhance";
import {
  buildContactEnhanceSuggestion,
  buildRankedRocketReachCandidates,
  buildRocketReachSearchRequest,
  buildRocketReachSearchRequests,
  enhanceContactWithRocketReach,
  resolveFilledFieldKeys,
  searchRocketReachPeople,
} from "@/lib/rocketreach";

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({
    ROCKETREACH_API_KEY: "rocketreach-test-key",
  })),
}));

function buildRequest(
  overrides: Partial<ContactEnhanceRequest> = {},
): ContactEnhanceRequest {
  return {
    companyName: "Acme Industrial",
    businessAccountId: "BA-100",
    contactName: "Casey Brown",
    contactEmail: null,
    contactPhone: null,
    city: "Toronto",
    state: "ON",
    country: "CA",
    candidatePersonId: null,
    ...overrides,
  };
}

describe("rocketreach helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds search input from contact, company, and location details", () => {
    expect(buildRocketReachSearchRequest(buildRequest())).toEqual({
      query: {
        name: ["Casey Brown"],
        current_employer: ["Acme Industrial"],
        location: ["Toronto, Ontario, Canada"],
      },
      start: 1,
      page_size: 10,
    });
  });

  it("builds fallback search requests from strictest to broadest", () => {
    expect(buildRocketReachSearchRequests(buildRequest())).toEqual([
      {
        query: {
          name: ["Casey Brown"],
          current_employer: ["Acme Industrial"],
          location: ["Toronto, Ontario, Canada"],
        },
        start: 1,
        page_size: 10,
      },
      {
        query: {
          name: ["Casey Brown"],
          current_employer: ["Acme Industrial"],
        },
        start: 1,
        page_size: 10,
      },
      {
        query: {
          name: ["Casey Brown"],
          location: ["Toronto, Ontario, Canada"],
        },
        start: 1,
        page_size: 10,
      },
      {
        query: {
          name: ["Casey Brown"],
        },
        start: 1,
        page_size: 10,
      },
    ]);
  });

  it("returns null for weak company-only searches", () => {
    expect(
      buildRocketReachSearchRequest(
        buildRequest({
          contactName: null,
          city: null,
          state: null,
          country: "CA",
        }),
      ),
    ).toBeNull();
  });

  it("maps lookup data into a fill-only suggestion and prefers professional email", () => {
    const suggestion = buildContactEnhanceSuggestion({
      name: "Casey Brown",
      current_title: "Account Executive",
      current_work_email: "casey.brown@acme.com",
      current_personal_email: "casey.brown@gmail.com",
      emails: [
        { email: "casey.brown@gmail.com", type: "personal" },
        { email: "casey.sales@acme.com", type: "professional" },
      ],
      phones: [
        { number: "+1 (416) 555-0100", type: "office" },
        { number: "+1 (416) 555-9999", type: "mobile" },
      ],
    });

    expect(suggestion).toEqual({
      name: "Casey Brown",
      jobTitle: "Account Executive",
      email: "casey.brown@acme.com",
      phone: "416-555-0100",
    });
    expect(
      resolveFilledFieldKeys(
        buildRequest({
          contactName: null,
          contactJobTitle: null,
          contactEmail: null,
          contactPhone: null,
        }),
        suggestion,
      ),
    ).toEqual(["name", "jobTitle", "email", "phone"]);
  });

  it("reads job title from alternate RocketReach title fields", () => {
    const suggestion = buildContactEnhanceSuggestion({
      name: "Casey Brown",
      title: "Vice President, Sales",
    });

    expect(suggestion.jobTitle).toBe("Vice President, Sales");
  });

  it("skips unsupported phone formats", () => {
    const suggestion = buildContactEnhanceSuggestion({
      name: "Casey Brown",
      phones: [
        { number: "+44 20 7946 0958", type: "office" },
        { number: "ext 55", type: "direct" },
      ],
    });

    expect(suggestion.phone).toBeNull();
  });

  it("limits candidate lists to 5 and ranks exact matches first", () => {
    const candidates = buildRankedRocketReachCandidates(
      [
        {
          id: 100,
          name: "Casey Brown",
          current_employer: "Acme Industrial",
          current_title: "Estimator",
          location: "Toronto, ON, Canada",
        },
        {
          id: 101,
          name: "Casey Brown",
          current_employer: "Different Company",
          current_title: "Estimator",
          location: "Toronto, ON, Canada",
        },
        {
          id: 102,
          name: "Casey Browne",
          current_employer: "Acme Industrial",
          current_title: "Estimator",
          location: "Toronto, ON, Canada",
        },
        { id: 103, name: "Alex Smith", current_employer: "Acme Industrial" },
        { id: 104, name: "Jordan Wu", current_employer: "Acme Industrial" },
        { id: 105, name: "Morgan Lee", current_employer: "Acme Industrial" },
        { id: 106, name: "Taylor King", current_employer: "Acme Industrial" },
      ],
      buildRequest(),
    );

    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toMatchObject({
      id: 100,
      name: "Casey Brown",
      currentEmployer: "Acme Industrial",
    });
    expect(candidates.map((candidate) => candidate.id)).not.toContain(106);
  });

  it("prefers true Ontario locations over substring false positives", () => {
    const candidates = buildRankedRocketReachCandidates(
      [
        {
          id: 100,
          name: "Casey Brown",
          current_employer: "Acme Industrial",
          location: "Moncton, NB, Canada",
        },
        {
          id: 101,
          name: "Casey Brown",
          current_employer: "Acme Industrial",
          location: "Toronto, ON, Canada",
        },
      ],
      buildRequest({
        city: null,
        state: "ON",
        country: "CA",
      }),
    );

    expect(candidates[0]?.id).toBe(101);
  });

  it.each([
    [401, 502, "RocketReach rejected the API key or this account cannot use the requested endpoint."],
    [403, 502, "RocketReach rejected the API key or this account cannot use the requested endpoint."],
    [429, 429, "RocketReach rate limited this request. Wait a moment and try again."],
    [500, 502, "RocketReach is unavailable right now. Try again later."],
  ])(
    "converts RocketReach %i responses into stable app errors",
    async (status, expectedStatus, expectedMessage) => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ error: "upstream failure" }), {
          status,
          headers: {
            "content-type": "application/json",
          },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(searchRocketReachPeople(buildRequest())).rejects.toMatchObject({
        status: expectedStatus,
        message: expectedMessage,
      });
    },
  );

  it("broadens the search when the strict query returns no results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profiles: [],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profiles: [],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profiles: [
              {
                id: 100,
                name: "Casey Brown",
                current_employer: "Acme Industrial",
                location: "Greater Toronto Area, Canada",
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

    await expect(searchRocketReachPeople(buildRequest())).resolves.toEqual([
      {
        id: 100,
        name: "Casey Brown",
        current_employer: "Acme Industrial",
        location: "Greater Toronto Area, Canada",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to the search result title when lookup omits it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profiles: [
              {
                id: 100,
                name: "Casey Brown",
                current_employer: "Acme Industrial",
                current_title: "Estimator",
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 100,
            name: "Casey Brown",
            current_work_email: "casey.brown@acme.com",
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

    await expect(
      enhanceContactWithRocketReach(
        buildRequest({
          contactJobTitle: null,
          contactEmail: null,
        }),
      ),
    ).resolves.toEqual({
      status: "ready",
      suggestion: {
        name: "Casey Brown",
        jobTitle: "Estimator",
        email: "casey.brown@acme.com",
        phone: null,
      },
      filledFieldKeys: ["jobTitle", "email"],
    });
  });

  it("falls back to the selected candidate title when lookup omits it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 100,
          name: "Casey Brown",
          current_work_email: "casey.brown@acme.com",
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

    await expect(
      enhanceContactWithRocketReach(
        buildRequest({
          candidatePersonId: 100,
          candidateCurrentTitle: "Senior Broker",
          contactJobTitle: null,
          contactEmail: null,
        }),
      ),
    ).resolves.toEqual({
      status: "ready",
      suggestion: {
        name: "Casey Brown",
        jobTitle: "Senior Broker",
        email: "casey.brown@acme.com",
        phone: null,
      },
      filledFieldKeys: ["jobTitle", "email"],
    });
  });
});
