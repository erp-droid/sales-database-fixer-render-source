import { describe, expect, it, vi } from "vitest";

import {
  fetchSessionCheckOutcome,
  resolveSessionCheckOutcome,
  shouldForceLogoutForApiResponse,
} from "@/lib/session-guard";

describe("session-guard helpers", () => {
  it("treats authenticated false payloads as unauthenticated", () => {
    expect(
      resolveSessionCheckOutcome(200, {
        authenticated: false,
      }),
    ).toBe("unauthenticated");
  });

  it("treats authenticated true payloads as authenticated", () => {
    expect(
      resolveSessionCheckOutcome(200, {
        authenticated: true,
      }),
    ).toBe("authenticated");
  });

  it("leaves malformed session payloads indeterminate", () => {
    expect(
      resolveSessionCheckOutcome(200, {
        error: "unexpected",
      }),
    ).toBe("indeterminate");
  });

  it("does not force logout for auth session probes", () => {
    expect(shouldForceLogoutForApiResponse("/api/auth/session", 401)).toBe(false);
    expect(shouldForceLogoutForApiResponse("/api/auth/logout", 401)).toBe(false);
    expect(shouldForceLogoutForApiResponse("/api/contacts/merge", 401)).toBe(false);
  });

  it("reads the session outcome from the probe response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(fetchSessionCheckOutcome(fetchMock as typeof fetch)).resolves.toBe(
      "unauthenticated",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", { cache: "no-store" });
  });
});
