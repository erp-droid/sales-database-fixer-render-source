import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthCookieValue = vi.fn(() => "cookie");
const subscribeToBusinessAccountLive = vi.fn(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  requireAuthCookieValue,
}));

vi.mock("@/lib/business-account-live", () => ({
  subscribeToBusinessAccountLive,
}));

const originalEnv = { ...process.env };

function buildRequest(forwardedFor: string): NextRequest {
  return new NextRequest("http://localhost/api/business-accounts/stream", {
    headers: {
      "x-forwarded-for": forwardedFor,
    },
  });
}

async function closeBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }
  await response.body.cancel();
}

describe("GET /api/business-accounts/stream limits", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAuthCookieValue.mockReset();
    requireAuthCookieValue.mockReturnValue("cookie");
    subscribeToBusinessAccountLive.mockReset();
    subscribeToBusinessAccountLive.mockReturnValue(() => undefined);

    process.env.BUSINESS_ACCOUNTS_STREAM_MAX_GLOBAL = "48";
    process.env.BUSINESS_ACCOUNTS_STREAM_MAX_PER_IP = "4";
    process.env.BUSINESS_ACCOUNTS_STREAM_RETRY_AFTER_SECONDS = "5";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("enforces a per-ip stream cap and releases the slot on disconnect", async () => {
    process.env.BUSINESS_ACCOUNTS_STREAM_MAX_GLOBAL = "10";
    process.env.BUSINESS_ACCOUNTS_STREAM_MAX_PER_IP = "1";
    process.env.BUSINESS_ACCOUNTS_STREAM_RETRY_AFTER_SECONDS = "7";

    const { GET } = await import("@/app/api/business-accounts/stream/route");

    const first = await GET(buildRequest("203.0.113.10"));
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("text/event-stream");

    const second = await GET(buildRequest("203.0.113.10"));
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("7");
    await expect(second.json()).resolves.toMatchObject({
      scope: "ip",
      limits: {
        global: 10,
        perIp: 1,
      },
    });

    await closeBody(first);

    const third = await GET(buildRequest("203.0.113.10"));
    expect(third.status).toBe(200);
    await closeBody(third);
  });

  it("enforces a global stream cap across different client ips", async () => {
    process.env.BUSINESS_ACCOUNTS_STREAM_MAX_GLOBAL = "1";
    process.env.BUSINESS_ACCOUNTS_STREAM_MAX_PER_IP = "5";

    const { GET } = await import("@/app/api/business-accounts/stream/route");

    const first = await GET(buildRequest("203.0.113.20"));
    expect(first.status).toBe(200);

    const second = await GET(buildRequest("198.51.100.44"));
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("5");
    await expect(second.json()).resolves.toMatchObject({
      scope: "global",
      limits: {
        global: 1,
        perIp: 5,
      },
    });

    await closeBody(first);
  });
});
