import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStoredLoginName = vi.fn();
const requireAuthCookieValue = vi.fn();
const requireStoredLoginName = vi.fn();

vi.mock("@/lib/auth", () => ({
  getStoredLoginName,
  requireAuthCookieValue,
  requireStoredLoginName,
}));

describe("requireRequestLoginName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("uses the stored login cookie when present", async () => {
    getStoredLoginName.mockReturnValue(" JSerrano ");

    const { requireRequestLoginName } = await import("@/lib/request-login");

    expect(
      requireRequestLoginName(new NextRequest("http://localhost/api/calendar/session")),
    ).toBe("jserrano");
    expect(requireAuthCookieValue).not.toHaveBeenCalled();
    expect(requireStoredLoginName).not.toHaveBeenCalled();
  });

  it("accepts a login hint only when the main auth cookie is present", async () => {
    getStoredLoginName.mockReturnValue(null);
    requireAuthCookieValue.mockReturnValue("auth-cookie");

    const { requireRequestLoginName } = await import("@/lib/request-login");

    expect(
      requireRequestLoginName(
        new NextRequest("http://localhost/api/calendar/session?loginName=JSerrano"),
      ),
    ).toBe("jserrano");
    expect(requireAuthCookieValue).toHaveBeenCalledTimes(1);
    expect(requireStoredLoginName).not.toHaveBeenCalled();
  });

  it("falls back to the strict stored-login requirement when no hint exists", async () => {
    getStoredLoginName.mockReturnValue(null);
    requireStoredLoginName.mockReturnValue("jserrano");

    const { requireRequestLoginName } = await import("@/lib/request-login");

    expect(
      requireRequestLoginName(new NextRequest("http://localhost/api/calendar/session")),
    ).toBe("jserrano");
  });
});
