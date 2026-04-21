import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn();
const buildCookieHeader = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
  buildCookieHeader,
}));

describe("GET /api/activities/debug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    requireAuthCookieValue.mockReturnValue("cookie");
    buildCookieHeader.mockReturnValue("session=cookie");
  });

  it("returns 401 instead of 500 when the request is unauthenticated", async () => {
    const { HttpError } = await import("@/lib/errors");
    requireAuthCookieValue.mockImplementation(() => {
      throw new HttpError(401, "Not authenticated");
    });

    const { GET } = await import("@/app/api/activities/debug/route");
    const response = await GET(
      new NextRequest("http://localhost/api/activities/debug?path=/BusinessAccount"),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Not authenticated");
  });

  it("returns 400 when path is missing", async () => {
    const { GET } = await import("@/app/api/activities/debug/route");
    const response = await GET(new NextRequest("http://localhost/api/activities/debug"));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("path is required");
  });
});
