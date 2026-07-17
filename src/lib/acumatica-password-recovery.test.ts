import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizePasswordRecoveryUsername,
  requestAcumaticaPasswordReset,
} from "@/lib/acumatica-password-recovery";
import type { AppEnv } from "@/lib/env";

const RECOVERY_PAGE = `
  <form>
    <input name="__VIEWSTATE" value="view-state&amp;token" />
    <input name="__VIEWSTATEGENERATOR" value="generator-token" />
    <input name="ctl00$txtLoginBgIndex" value="login_bg4.jpg" />
  </form>
`;

const SUCCESS_PAGE = `
  <span id="lblMsg">
    An email with further instructions will be sent to this address if it matches an existing user.
  </span>
`;

function buildEnv(): AppEnv {
  return {
    AUTH_PROVIDER: "acumatica",
    ACUMATICA_BASE_URL: "https://example.acumatica.com",
    ACUMATICA_COMPANY: "MeadowBrook Live",
  } as AppEnv;
}

describe("Acumatica password recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes MeadowBrook email addresses to Acumatica login names", () => {
    expect(normalizePasswordRecoveryUsername(" jdoe@meadowb.com ")).toBe("jdoe");
    expect(normalizePasswordRecoveryUsername(" JDOE ")).toBe("JDOE");
  });

  it("submits the hidden form state, company, username, and session cookie", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(RECOVERY_PAGE, {
          status: 200,
          headers: {
            "set-cookie": "ASP.NET_SessionId=session-123; Path=/; Secure; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(SUCCESS_PAGE, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await requestAcumaticaPasswordReset("jdoe@meadowb.com", buildEnv());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://example.acumatica.com/Frames/PasswordRemind.aspx?ReturnUrl=%2fPasswordRemind.aspx",
    );

    const submitInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const submitted = new URLSearchParams(String(submitInit.body));
    expect(submitInit.method).toBe("POST");
    expect(submitted.get("__VIEWSTATE")).toBe("view-state&token");
    expect(submitted.get("ctl00$phUser$edLogin")).toBe("jdoe");
    expect(submitted.get("ctl00$phUser$cmbCompany")).toBe("MeadowBrook Live");
    expect(new Headers(submitInit.headers).get("cookie")).toBe(
      "ASP.NET_SessionId=session-123",
    );
  });

  it("rejects a recovery page that does not contain the expected form state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })),
    );

    await expect(
      requestAcumaticaPasswordReset("jdoe", buildEnv()),
    ).rejects.toThrow("expected form state");
  });

  it("rejects an upstream response that did not accept the request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(RECOVERY_PAGE, { status: 200 }))
      .mockResolvedValueOnce(
        new Response('<span id="lblMsg">Invalid recovery request.</span>', {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestAcumaticaPasswordReset("jdoe", buildEnv()),
    ).rejects.toThrow("Invalid recovery request");
  });
});
