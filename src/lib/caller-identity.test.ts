import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchEmployeeProfileById = vi.fn();
const readCallEmployeeDirectory = vi.fn();
const readCallEmployeeDirectoryMeta = vi.fn();
const readEmployeeDirectory = vi.fn();
const searchEmployeeProfiles = vi.fn();
const searchContacts = vi.fn();
const searchEmployeesByDisplayName = vi.fn();
const syncCallEmployeeDirectory = vi.fn();
const upsertCallEmployeeDirectoryItem = vi.fn();
const readCallerPhoneOverride = vi.fn();
const saveCallerPhoneOverride = vi.fn();

vi.mock("@/lib/acumatica", async () => {
  const actual = await vi.importActual<typeof import("@/lib/acumatica")>("@/lib/acumatica");
  return {
    ...actual,
    fetchEmployeeProfileById,
    searchEmployeeProfiles,
    searchContacts,
    searchEmployeesByDisplayName,
  };
});

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory,
  readCallEmployeeDirectoryMeta,
  syncCallEmployeeDirectory,
  upsertCallEmployeeDirectoryItem,
}));

vi.mock("@/lib/read-model/employees", () => ({
  readEmployeeDirectory,
}));

vi.mock("@/lib/caller-phone-overrides", () => ({
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
}));

function setTestEnv(): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS = "86400000";
}

function buildEmployee(input: {
  loginName: string;
  displayName?: string;
  email?: string | null;
  normalizedPhone?: string | null;
  callerIdPhone?: string | null;
  contactId?: number | null;
}): {
  loginName: string;
  contactId: number | null;
  displayName: string;
  email: string | null;
  normalizedPhone: string | null;
  callerIdPhone: string | null;
  isActive: boolean;
  updatedAt: string;
} {
  return {
    loginName: input.loginName,
    contactId: input.contactId ?? 1,
    displayName: input.displayName ?? input.loginName,
    email: input.email ?? `${input.loginName}@meadowb.com`,
    normalizedPhone:
      input.normalizedPhone === undefined ? "+14165550100" : input.normalizedPhone,
    callerIdPhone:
      input.callerIdPhone === undefined
        ? (input.normalizedPhone === undefined ? "+14165550100" : input.normalizedPhone)
        : input.callerIdPhone,
    isActive: true,
    updatedAt: "2026-03-17T00:00:00.000Z",
  };
}

describe("resolveSignedInCallerIdentity", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    fetchEmployeeProfileById.mockReset();
    readCallEmployeeDirectory.mockReset();
    readCallEmployeeDirectoryMeta.mockReset();
    readEmployeeDirectory.mockReset();
    searchEmployeeProfiles.mockReset();
    searchContacts.mockReset();
    searchEmployeesByDisplayName.mockReset();
    syncCallEmployeeDirectory.mockReset();
    upsertCallEmployeeDirectoryItem.mockReset();
    readCallerPhoneOverride.mockReset();
    saveCallerPhoneOverride.mockReset();
    fetchEmployeeProfileById.mockResolvedValue(null);
    readEmployeeDirectory.mockReturnValue([]);
    searchEmployeeProfiles.mockResolvedValue([]);
    searchContacts.mockResolvedValue([]);
    searchEmployeesByDisplayName.mockResolvedValue([]);
    readCallerPhoneOverride.mockReturnValue(null);
    setTestEnv();
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

  it("resolves an exact cached login match", async () => {
    readCallEmployeeDirectory.mockReturnValue([buildEmployee({ loginName: "jserrano" })]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: new Date().toISOString(),
    });

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "JSeRRano"),
    ).resolves.toEqual({
      loginName: "jserrano",
      contactId: 1,
      displayName: "jserrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14165550100",
    });
    expect(saveCallerPhoneOverride).toHaveBeenCalledWith("jserrano", "+14165550100");
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });

  it("rejects substring-only matches after refreshing the cache", async () => {
    readCallEmployeeDirectory.mockReturnValue([buildEmployee({ loginName: "alex-jserrano" })]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: new Date().toISOString(),
    });
    syncCallEmployeeDirectory.mockResolvedValue([buildEmployee({ loginName: "alex-jserrano" })]);

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(resolveSignedInCallerIdentity("cookie", "jserrano")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("must exactly match"),
    });
    expect(syncCallEmployeeDirectory).toHaveBeenCalledTimes(1);
  });

  it("rejects non-internal emails even on exact login matches", async () => {
    readCallEmployeeDirectory.mockReturnValue([
      buildEmployee({
        loginName: "jserrano",
        email: "jserrano@example.com",
      }),
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: new Date().toISOString(),
    });
    syncCallEmployeeDirectory.mockResolvedValue([
      buildEmployee({
        loginName: "jserrano",
        email: "jserrano@example.com",
      }),
    ]);

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(resolveSignedInCallerIdentity("cookie", "jserrano")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects matched internal contacts without a valid phone", async () => {
    readCallEmployeeDirectory.mockReturnValue([
      buildEmployee({
        loginName: "jserrano",
        normalizedPhone: null,
        callerIdPhone: null,
      }),
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: new Date().toISOString(),
    });

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(resolveSignedInCallerIdentity("cookie", "jserrano")).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("valid phone number"),
    });
  });

  it("refreshes when the cached directory is stale", async () => {
    readCallEmployeeDirectory.mockReturnValue([buildEmployee({ loginName: "jserrano" })]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: "2020-01-01T00:00:00.000Z",
    });
    syncCallEmployeeDirectory.mockResolvedValue([buildEmployee({ loginName: "jserrano" })]);

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await resolveSignedInCallerIdentity("cookie", "jserrano");
    expect(syncCallEmployeeDirectory).toHaveBeenCalledTimes(1);
  });

  it("uses a targeted direct employee lookup without a full directory sync when requested", async () => {
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    searchEmployeeProfiles.mockResolvedValue([
      {
        employeeId: "E0000045",
        contactId: null,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        phone: "4162304681",
        isActive: true,
      },
    ]);
    searchContacts.mockResolvedValue([
      {
        ContactID: { value: 12 },
        DisplayName: { value: "Jorge Serrano" },
        Email: { value: "jserrano@meadowb.com" },
      },
    ]);

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "jserrano", undefined, {
        allowFullDirectorySync: false,
      }),
    ).resolves.toEqual({
      loginName: "jserrano",
      contactId: 12,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14162304681",
    });
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
    expect(searchEmployeesByDisplayName).not.toHaveBeenCalled();
    expect(fetchEmployeeProfileById).not.toHaveBeenCalled();
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledTimes(1);
  });

  it("uses the exact internal contact phone immediately before doing slower employee lookups", async () => {
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    searchContacts.mockResolvedValue([
      {
        ContactID: { value: 159842 },
        DisplayName: { value: "Jacky Lee" },
        Email: { value: "jlee@meadowb.com" },
        Phone1: { value: "365-341-1781" },
      },
    ]);

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "jlee", undefined, {
        allowFullDirectorySync: false,
      }),
    ).resolves.toEqual({
      loginName: "jlee",
      contactId: 159842,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      userPhone: "+13653411781",
    });
    expect(searchEmployeeProfiles).not.toHaveBeenCalled();
    expect(fetchEmployeeProfileById).not.toHaveBeenCalled();
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledTimes(1);
  });

  it("prefers the authenticated employee id and reads phone 1 from the employee detail record", async () => {
    readCallEmployeeDirectory.mockReturnValue([
      buildEmployee({
        loginName: "jlee",
        displayName: "Wrong Cached Person",
        normalizedPhone: "+14165550000",
      }),
    ]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 1,
      latestUpdatedAt: new Date().toISOString(),
    });
    searchContacts.mockResolvedValue([
      {
        ContactID: { value: 142 },
        DisplayName: { value: "Jacky Lee" },
        Email: { value: "jlee@meadowb.com" },
      },
    ]);
    fetchEmployeeProfileById.mockResolvedValue({
      employeeId: "E0000142",
      contactId: 142,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      phone: "4167293474",
      isActive: true,
    });

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "jlee", undefined, {
        preferredEmployeeId: "E0000142",
      }),
    ).resolves.toEqual({
      loginName: "jlee",
      contactId: 142,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      userPhone: "+14167293474",
    });
    expect(fetchEmployeeProfileById).toHaveBeenCalledWith("cookie", "E0000142", undefined);
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });

  it("resolves from the authenticated employee id even when internal contact lookup is unavailable", async () => {
    const { HttpError } = await import("@/lib/errors");
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    searchContacts.mockRejectedValue(
      new HttpError(403, "You have insufficient rights to access Contact."),
    );
    fetchEmployeeProfileById.mockResolvedValue({
      employeeId: "E0000157",
      contactId: null,
      displayName: "Brock Koczka",
      email: null,
      phone: "3653411781",
      isActive: true,
    });

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "bkoczka", undefined, {
        preferredEmployeeId: "E0000157",
      }),
    ).resolves.toEqual({
      loginName: "bkoczka",
      contactId: null,
      displayName: "Brock Koczka",
      email: null,
      userPhone: "+13653411781",
    });
    expect(fetchEmployeeProfileById).toHaveBeenCalledWith("cookie", "E0000157", undefined);
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });

  it("derives the employee id from the cached employee directory login pattern", async () => {
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    readEmployeeDirectory.mockReturnValue([
      {
        id: "124894",
        name: "Brock Koczka",
      },
      {
        id: "E0000117",
        name: "Brock Koczka",
      },
    ]);
    fetchEmployeeProfileById.mockResolvedValue({
      employeeId: "E0000117",
      contactId: null,
      displayName: "Brock Koczka",
      email: null,
      phone: "3653411781",
      isActive: true,
    });

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "bkoczka", undefined, {
        allowFullDirectorySync: false,
      }),
    ).resolves.toEqual({
      loginName: "bkoczka",
      contactId: null,
      displayName: "Brock Koczka",
      email: null,
      userPhone: "+13653411781",
    });
    expect(fetchEmployeeProfileById).toHaveBeenCalledWith("cookie", "E0000117", undefined);
    expect(searchContacts).not.toHaveBeenCalled();
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });

  it("falls back to the stored caller phone override when the employee profile omits a phone", async () => {
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    readCallerPhoneOverride.mockReturnValue({
      loginName: "bkoczka",
      phoneNumber: "+14165550100",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });
    searchContacts.mockRejectedValue(
      new Error("No internal contact match."),
    );
    fetchEmployeeProfileById.mockResolvedValue({
      employeeId: "E0000157",
      contactId: null,
      displayName: "Brock Koczka",
      email: null,
      phone: null,
      isActive: true,
    });

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "bkoczka", undefined, {
        preferredEmployeeId: "E0000157",
      }),
    ).resolves.toEqual({
      loginName: "bkoczka",
      contactId: null,
      displayName: "Brock Koczka",
      email: null,
      userPhone: "+14165550100",
    });
    expect(saveCallerPhoneOverride).not.toHaveBeenCalledWith("bkoczka", "+14165550100");
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });

  it("resolves a direct employee email match even when no internal contact record is found", async () => {
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    searchEmployeeProfiles.mockResolvedValue([
      {
        employeeId: "E0000045",
        contactId: null,
        displayName: "Jorge Serrano",
        email: "jserrano@meadowb.com",
        phone: "4162304681",
        isActive: true,
      },
    ]);
    searchContacts.mockResolvedValue([]);

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "jserrano", undefined, {
        allowFullDirectorySync: false,
      }),
    ).resolves.toEqual({
      loginName: "jserrano",
      contactId: null,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14162304681",
    });
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });

  it("falls back to the linked internal contact email and phone when the employee contract omits them", async () => {
    readCallEmployeeDirectory.mockReturnValue([]);
    readCallEmployeeDirectoryMeta.mockReturnValue({
      total: 0,
      latestUpdatedAt: null,
    });
    readEmployeeDirectory.mockReturnValue([
      {
        id: "E0000045",
        name: "Jorge Serrano",
      },
    ]);
    searchEmployeeProfiles.mockResolvedValue([]);
    searchContacts.mockResolvedValue([
      {
        ContactID: { value: 157497 },
        DisplayName: { value: "Jorge Serrano" },
        Email: { value: "jserrano@meadowb.com" },
        Phone1: { value: "4162304681" },
      },
    ]);
    fetchEmployeeProfileById.mockResolvedValue({
      employeeId: "E0000045",
      contactId: null,
      displayName: "Jorge Serrano",
      email: null,
      phone: null,
      isActive: true,
    });

    const { resolveSignedInCallerIdentity } = await import("@/lib/caller-identity");

    await expect(
      resolveSignedInCallerIdentity("cookie", "jserrano", undefined, {
        allowFullDirectorySync: false,
      }),
    ).resolves.toEqual({
      loginName: "jserrano",
      contactId: 157497,
      displayName: "Jorge Serrano",
      email: "jserrano@meadowb.com",
      userPhone: "+14162304681",
    });
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledTimes(1);
    expect(syncCallEmployeeDirectory).not.toHaveBeenCalled();
  });
});
