import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readCallEmployeeDirectory = vi.fn();
const readCallEmployeeDirectoryMeta = vi.fn();
const syncCallEmployeeDirectory = vi.fn();

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory,
  readCallEmployeeDirectoryMeta,
  syncCallEmployeeDirectory,
}));

function setMailEnv(): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.MAIL_SERVICE_URL = "https://mail-service.example.com";
  process.env.MAIL_SERVICE_SHARED_SECRET = "shared-secret";
  process.env.MAIL_INTERNAL_DOMAIN = "meadowb.com";
  process.env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS = "86400000";
}

describe("mail auth helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    readCallEmployeeDirectory.mockReset();
    readCallEmployeeDirectoryMeta.mockReset();
    syncCallEmployeeDirectory.mockReset();
    setMailEnv();
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

  it("builds a signed assertion for the mail service", async () => {
    const { buildMailServiceAssertion } = await import("@/lib/mail-auth");

    const token = buildMailServiceAssertion({
      loginName: "jserrano",
      displayName: "Jorge Serrano",
      senderEmail: "jserrano@meadowb.com",
    });

    expect(token.startsWith("mbmail.v1.")).toBe(true);
    const [, , encodedPayload] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    expect(decoded.loginName).toBe("jserrano");
    expect(decoded.displayName).toBe("Jorge Serrano");
    expect(decoded.senderEmail).toBe("jserrano@meadowb.com");
    expect(decoded.sourceApp).toBe("sales-database-fixer");
  });

  it("resolves the signed-in sender from the employee directory", async () => {
    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "jserrano",
        contactId: 12,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        normalizedPhone: "+14162304681",
        callerIdPhone: "+14162304681",
        isActive: true,
        updatedAt: "2026-03-10T12:00:00.000Z",
      },
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: new Date().toISOString(),
    });

    const { resolveMailSenderForRequest } = await import("@/lib/mail-auth");
    const request = new NextRequest("http://localhost/api/mail/session", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie; mb_login_name=jserrano",
      },
    });

    await expect(resolveMailSenderForRequest(request)).resolves.toEqual({
      loginName: "jserrano",
      senderEmail: "jserrano@meadowb.com",
      displayName: "Jorge Serrano",
    });
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });

  it("refreshes the employee directory when the cached data is stale", async () => {
    readCallEmployeeDirectory
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          loginName: "jserrano",
          contactId: 12,
          displayName: "Jorge Serrano",
          email: "jserrano@meadowb.com",
          normalizedPhone: "+14162304681",
          callerIdPhone: "+14162304681",
          isActive: true,
          updatedAt: "2026-03-10T12:00:00.000Z",
        },
      ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    syncCallEmployeeDirectory.mockResolvedValue([]);

    const { resolveMailSenderForRequest } = await import("@/lib/mail-auth");
    const request = new NextRequest("http://localhost/api/mail/session", {
      headers: {
        cookie: ".ASPXAUTH=session-cookie; mb_login_name=jserrano",
      },
    });

    const result = await resolveMailSenderForRequest(request);

    expect(syncCallEmployeeDirectory).toHaveBeenCalledTimes(1);
    expect(result.senderEmail).toBe("jserrano@meadowb.com");
  });
});
