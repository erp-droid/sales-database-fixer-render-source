import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveSignedInCallerIdentity = vi.fn();
const withServiceAcumaticaSession = vi.fn();
const readCallerPhoneOverride = vi.fn();
const saveCallerPhoneOverride = vi.fn();
const createTwilioRestClient = vi.fn();
const readTwilioPhoneInventory = vi.fn();
const normalizeTwilioPhoneNumber = vi.fn((value: string | null | undefined) => value ?? null);
const readCallEmployeeDirectory = vi.fn();
const upsertCallEmployeeDirectoryItem = vi.fn();

vi.mock("@/lib/caller-identity", () => ({
  resolveSignedInCallerIdentity,
}));

vi.mock("@/lib/caller-phone-overrides", () => ({
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  withServiceAcumaticaSession,
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory,
  upsertCallEmployeeDirectoryItem,
}));

vi.mock("@/lib/twilio", () => ({
  createTwilioRestClient,
  readTwilioPhoneInventory,
  normalizeTwilioPhoneNumber,
}));

function setTestEnv(): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.TWILIO_CALLER_ID = "+14165551234";
}

describe("resolveCallerProfile", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    resolveSignedInCallerIdentity.mockReset();
    withServiceAcumaticaSession.mockReset();
    readCallerPhoneOverride.mockReset();
    saveCallerPhoneOverride.mockReset();
    createTwilioRestClient.mockReset();
    readTwilioPhoneInventory.mockReset();
    normalizeTwilioPhoneNumber.mockClear();
    readCallEmployeeDirectory.mockReset();
    upsertCallEmployeeDirectoryItem.mockReset();
    setTestEnv();
    createTwilioRestClient.mockReturnValue({});
    readCallerPhoneOverride.mockReturnValue(null);
    readCallEmployeeDirectory.mockReturnValue([]);
    withServiceAcumaticaSession.mockImplementation(async (_preferredLoginName, operation) =>
      operation("service-cookie", { value: null }),
    );
    readTwilioPhoneInventory.mockResolvedValue({
      accountType: "full",
      allowedCallerIds: new Set<string>([
        "+13653411781",
        "+14162304681",
        "+14165550100",
        "+14165551234",
      ]),
      voiceNumbers: ["+16475550123"],
    });
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

  it("uses the matched signed-in user phone from the shared caller identity", async () => {
    resolveSignedInCallerIdentity.mockResolvedValue({
      loginName: "jserrano",
      contactId: 157497,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14162304681",
    });

    const { resolveCallerProfile } = await import("@/lib/twilio-outbound");

    await expect(resolveCallerProfile("cookie", "jserrano")).resolves.toEqual({
      loginName: "jserrano",
      contactId: 157497,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14162304681",
      callerId: "+14162304681",
      bridgeNumber: "+16475550123",
    });
    expect(resolveSignedInCallerIdentity).toHaveBeenCalledWith(
      "cookie",
      "jserrano",
      undefined,
      {
        preferredEmployeeId: null,
      },
    );
    expect(saveCallerPhoneOverride).toHaveBeenCalledWith("jserrano", "+14162304681");
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledWith({
      loginName: "jserrano",
      contactId: 157497,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      normalizedPhone: "+14162304681",
      callerIdPhone: "+14162304681",
      isActive: true,
      updatedAt: expect.any(String),
    });
  });

  it("uses the cached caller phone override before going back to Acumatica", async () => {
    readCallerPhoneOverride.mockReturnValue({
      loginName: "jlee",
      phoneNumber: "+13653411781",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });
    readCallEmployeeDirectory.mockReturnValue([
      {
        loginName: "jlee",
        contactId: 159842,
        displayName: "Jacky Lee",
        email: "jlee@meadowb.com",
        normalizedPhone: null,
        callerIdPhone: null,
        isActive: true,
        updatedAt: "2026-03-18T00:00:00.000Z",
      },
    ]);

    const { resolveCallerProfile } = await import("@/lib/twilio-outbound");

    await expect(resolveCallerProfile("cookie", "jlee")).resolves.toEqual({
      loginName: "jlee",
      contactId: 159842,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      userPhone: "+13653411781",
      callerId: "+13653411781",
      bridgeNumber: "+16475550123",
    });
    expect(resolveSignedInCallerIdentity).not.toHaveBeenCalled();
    expect(withServiceAcumaticaSession).not.toHaveBeenCalled();
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledWith({
      loginName: "jlee",
      contactId: 159842,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      normalizedPhone: "+13653411781",
      callerIdPhone: "+13653411781",
      isActive: true,
      updatedAt: expect.any(String),
    });
  });

  it("fails when the employee phone is not verified in Twilio for caller ID", async () => {
    resolveSignedInCallerIdentity.mockResolvedValue({
      loginName: "jserrano",
      contactId: 157497,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14167293474",
    });

    const { resolveCallerProfile } = await import("@/lib/twilio-outbound");
    await expect(resolveCallerProfile("cookie", "jserrano")).rejects.toMatchObject({
      status: 422,
      message:
        "Twilio cannot present +14167293474 as caller ID for 'jserrano'. Verify that employee number in Twilio first.",
    });
  });

  it("falls back to a service-backed Acumatica session when the signed-in user lacks Employee form rights", async () => {
    const { HttpError } = await import("@/lib/errors");
    resolveSignedInCallerIdentity
      .mockRejectedValueOnce(
        new HttpError(403, "You have insufficient rights to access the Employee (EP203000) form."),
      )
      .mockResolvedValueOnce({
        loginName: "bkoczka",
        contactId: 154327,
        displayName: "Brock Koczka",
        email: "bkoczka@meadowb.com",
        userPhone: "+14165550100",
      });

    const { resolveCallerProfile } = await import("@/lib/twilio-outbound");
    const result = await resolveCallerProfile("user-cookie", "bkoczka", undefined, {
      employeeId: "E0000142",
    });

    expect(withServiceAcumaticaSession).toHaveBeenCalledWith(
      null,
      expect.any(Function),
    );
    expect(resolveSignedInCallerIdentity).toHaveBeenNthCalledWith(
      1,
      "user-cookie",
      "bkoczka",
      undefined,
      {
        preferredEmployeeId: "E0000142",
      },
    );
    expect(resolveSignedInCallerIdentity).toHaveBeenNthCalledWith(
      2,
      "service-cookie",
      "bkoczka",
      expect.any(Object),
      {
        allowFullDirectorySync: false,
        preferredEmployeeId: "E0000142",
      },
    );
    expect(result).toEqual({
      loginName: "bkoczka",
      contactId: 154327,
      displayName: "Brock Koczka",
      email: "bkoczka@meadowb.com",
      userPhone: "+14165550100",
      callerId: "+14165550100",
      bridgeNumber: "+16475550123",
    });
  });

  it("fails when caller identity cannot be read from Acumatica", async () => {
    const { HttpError } = await import("@/lib/errors");
    resolveSignedInCallerIdentity.mockRejectedValue(
      new HttpError(403, "Calling is unavailable."),
    );

    const { resolveCallerProfile } = await import("@/lib/twilio-outbound");
    await expect(resolveCallerProfile("cookie", "bkoczka")).rejects.toMatchObject({
      status: 403,
      message: "Calling is unavailable.",
    });
  });
});
