import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEnv = vi.fn(() => ({
  ADDRESS_COMPLETE_API_KEY: "test-key",
  ADDRESS_COMPLETE_FIND_URL: "https://example.com/find",
  ADDRESS_COMPLETE_RETRIEVE_URL: "https://example.com/retrieve",
}));

vi.mock("@/lib/env", () => ({
  getEnv,
}));

describe("address complete", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("expands Canada Post container suggestions into retrievable address suggestions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname !== "example.com" || url.pathname !== "/find") {
        throw new Error(`Unexpected request: ${url.toString()}`);
      }

      const lastId = url.searchParams.get("LastId");
      if (!lastId) {
        return new Response(
          JSON.stringify({
            Items: [
              {
                Id: "container-1",
                Type: "Street",
                Text: "50 Royal Group Cres",
                Description: "Vaughan, ON",
                Next: "Find",
                Error: "0",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      expect(lastId).toBe("container-1");
      return new Response(
        JSON.stringify({
          Items: [
            {
              Id: "address-1",
              Type: "Address",
              Text: "50 Royal Group Cres",
              Description: "Vaughan, ON L4H 1X9",
              Next: "Retrieve",
              Error: "0",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    global.fetch = fetchMock as typeof global.fetch;

    const { findCanadaPostAddressCompleteSuggestions } = await import("@/lib/address-complete");

    const suggestions = await findCanadaPostAddressCompleteSuggestions({
      searchTerm: "50 Royal Group Cres",
      country: "CA",
      limit: 8,
    });

    expect(suggestions).toEqual([
      {
        id: "address-1",
        type: "Address",
        text: "50 Royal Group Cres",
        description: "Vaughan, ON L4H 1X9",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
