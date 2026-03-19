import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthCookieValue = vi.fn();
const getStoredLoginName = vi.fn();
const normalizeSessionIdentity = vi.fn();
const setAuthCookie = vi.fn();
const validateSessionWithAcumatica = vi.fn();
const withServiceAcumaticaSession = vi.fn();
const resolveSignedInCallerIdentity = vi.fn();
const readCallerIdVerification = vi.fn();
const savePendingCallerIdVerification = vi.fn();
const saveVerifiedCallerIdVerification = vi.fn();
const saveFailedCallerIdVerification = vi.fn();
const readCallerPhoneOverride = vi.fn();
const saveCallerPhoneOverride = vi.fn();
const readCallerIdentityProfile = vi.fn();
const saveCallerIdentityProfile = vi.fn();
const readCallEmployeeDirectory = vi.fn();
const upsertCallEmployeeDirectoryItem = vi.fn();
const createTwilioRestClient = vi.fn();
const readTwilioPhoneInventory = vi.fn();
const clearTwilioPhoneInventoryCache = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthCookieValue,
  getStoredLoginName,
  normalizeSessionIdentity,
  setAuthCookie,
}));

vi.mock("@/lib/acumatica", () => ({
  validateSessionWithAcumatica,
}));

vi.mock("@/lib/acumatica-service-auth", () => ({
  withServiceAcumaticaSession,
}));

vi.mock("@/lib/caller-identity", () => ({
  resolveSignedInCallerIdentity,
}));

vi.mock("@/lib/caller-id-verifications", () => ({
  readCallerIdVerification,
  savePendingCallerIdVerification,
  saveVerifiedCallerIdVerification,
  saveFailedCallerIdVerification,
}));

vi.mock("@/lib/caller-phone-overrides", () => ({
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
}));

vi.mock("@/lib/caller-identity-cache", () => ({
  readCallerIdentityProfile,
  saveCallerIdentityProfile,
}));

vi.mock("@/lib/call-analytics/employee-directory", () => ({
  readCallEmployeeDirectory,
  upsertCallEmployeeDirectoryItem,
}));

vi.mock("@/lib/twilio", () => ({
  createTwilioRestClient,
  readTwilioPhoneInventory,
  clearTwilioPhoneInventoryCache,
}));

describe("twilio caller verification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getAuthCookieValue.mockReturnValue("cookie");
    getStoredLoginName.mockReturnValue("jlee");
    normalizeSessionIdentity.mockReturnValue({
      id: "jlee",
      name: "Jacky Lee",
      employeeId: "E0000142",
    });
    readCallerIdentityProfile.mockReturnValue(null);
    readCallerPhoneOverride.mockReturnValue(null);
    readCallEmployeeDirectory.mockReturnValue([]);
    validateSessionWithAcumatica.mockResolvedValue({ ok: true });
    withServiceAcumaticaSession.mockImplementation(async (_preferredLoginName, operation) =>
      operation("service-cookie", { value: null }),
    );
  });

  it("starts a Twilio caller verification call for the signed-in employee phone", async () => {
    resolveSignedInCallerIdentity.mockResolvedValue({
      loginName: "jlee",
      employeeId: "E0000142",
      contactId: 123,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      userPhone: "+14167293474",
    });
    readTwilioPhoneInventory.mockResolvedValue({
      accountType: "full",
      allowedCallerIds: new Set<string>(),
      voiceNumbers: ["+16475550123"],
    });
    readCallerIdVerification.mockReturnValue(null);
    createTwilioRestClient.mockReturnValue({
      validationRequests: {
        create: vi.fn().mockResolvedValue({
          phoneNumber: "+14167293474",
          validationCode: "123456",
          callSid: "CA123",
        }),
      },
    });
    savePendingCallerIdVerification.mockReturnValue({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: "123456",
      callSid: "CA123",
      status: "pending",
      failureMessage: null,
      verifiedAt: null,
      updatedAt: "2026-03-18T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/twilio/caller-verification/route");
    const response = await POST(
      new NextRequest("http://localhost/api/twilio/caller-verification", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      phoneNumber: "+14167293474",
      validationCode: "123456",
      callSid: "CA123",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });
    expect(resolveSignedInCallerIdentity).toHaveBeenCalledWith(
      "cookie",
      "jlee",
      expect.any(Object),
      {
        preferredEmployeeId: "E0000142",
      },
    );
    expect(savePendingCallerIdVerification).toHaveBeenCalledWith({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: "123456",
      callSid: "CA123",
    });
    expect(saveCallerPhoneOverride).toHaveBeenCalledWith("jlee", "+14167293474");
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledWith({
      loginName: "jlee",
      contactId: 123,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      normalizedPhone: "+14167293474",
      callerIdPhone: "+14167293474",
      isActive: true,
      updatedAt: expect.any(String),
    });
  });

  it("returns verified immediately when the employee number is already allowed in Twilio", async () => {
    resolveSignedInCallerIdentity.mockResolvedValue({
      loginName: "jlee",
      employeeId: "E0000142",
      contactId: 123,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      userPhone: "+14167293474",
    });
    readTwilioPhoneInventory.mockResolvedValue({
      accountType: "full",
      allowedCallerIds: new Set<string>(["+14167293474"]),
      voiceNumbers: ["+16475550123"],
    });
    saveVerifiedCallerIdVerification.mockReturnValue({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: null,
      callSid: null,
      status: "verified",
      failureMessage: null,
      verifiedAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/twilio/caller-verification/route");
    const response = await POST(
      new NextRequest("http://localhost/api/twilio/caller-verification", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "verified",
      phoneNumber: "+14167293474",
      verifiedAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });
    expect(saveVerifiedCallerIdVerification).toHaveBeenCalledWith({
      loginName: "jlee",
      phoneNumber: "+14167293474",
    });
    expect(saveCallerPhoneOverride).toHaveBeenCalledWith("jlee", "+14167293474");
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledWith({
      loginName: "jlee",
      contactId: 123,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      normalizedPhone: "+14167293474",
      callerIdPhone: "+14167293474",
      isActive: true,
      updatedAt: expect.any(String),
    });
    expect(clearTwilioPhoneInventoryCache).toHaveBeenCalled();
  });

  it("promotes a pending verification to verified once Twilio allows the number", async () => {
    readCallerIdVerification.mockReturnValue({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: "123456",
      callSid: "CA123",
      status: "pending",
      failureMessage: null,
      verifiedAt: null,
      updatedAt: "2026-03-18T00:00:00.000Z",
    });
    readTwilioPhoneInventory.mockResolvedValue({
      accountType: "full",
      allowedCallerIds: new Set<string>(["+14167293474"]),
      voiceNumbers: ["+16475550123"],
    });
    saveVerifiedCallerIdVerification.mockReturnValue({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: null,
      callSid: null,
      status: "verified",
      failureMessage: null,
      verifiedAt: "2026-03-18T00:00:05.000Z",
      updatedAt: "2026-03-18T00:00:05.000Z",
    });

    const { GET } = await import("@/app/api/twilio/caller-verification/route");
    const response = await GET(
      new NextRequest("http://localhost/api/twilio/caller-verification"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "verified",
      phoneNumber: "+14167293474",
      verifiedAt: "2026-03-18T00:00:05.000Z",
      updatedAt: "2026-03-18T00:00:05.000Z",
    });
    expect(saveVerifiedCallerIdVerification).toHaveBeenCalledWith({
      loginName: "jlee",
      phoneNumber: "+14167293474",
    });
    expect(saveCallerPhoneOverride).toHaveBeenCalledWith("jlee", "+14167293474");
    expect(upsertCallEmployeeDirectoryItem).toHaveBeenCalledWith({
      loginName: "jlee",
      contactId: null,
      displayName: "jlee",
      email: null,
      normalizedPhone: "+14167293474",
      callerIdPhone: "+14167293474",
      isActive: true,
      updatedAt: expect.any(String),
    });
    expect(clearTwilioPhoneInventoryCache).toHaveBeenCalled();
  });

  it("uses the stored caller phone override when Acumatica does not expose the employee phone", async () => {
    getStoredLoginName.mockReturnValue("bkoczka");
    readCallerPhoneOverride.mockReturnValue({
      loginName: "bkoczka",
      phoneNumber: "+14167293474",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });
    readTwilioPhoneInventory.mockResolvedValue({
      accountType: "full",
      allowedCallerIds: new Set<string>(),
      voiceNumbers: ["+16475550123"],
    });
    readCallerIdVerification.mockReturnValue(null);
    createTwilioRestClient.mockReturnValue({
      validationRequests: {
        create: vi.fn().mockResolvedValue({
          phoneNumber: "+14167293474",
          validationCode: "654321",
          callSid: "CA456",
        }),
      },
    });
    savePendingCallerIdVerification.mockReturnValue({
      loginName: "bkoczka",
      phoneNumber: "+14167293474",
      validationCode: "654321",
      callSid: "CA456",
      status: "pending",
      failureMessage: null,
      verifiedAt: null,
      updatedAt: "2026-03-18T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/twilio/caller-verification/route");
    const response = await POST(
      new NextRequest("http://localhost/api/twilio/caller-verification", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      phoneNumber: "+14167293474",
      validationCode: "654321",
      callSid: "CA456",
      updatedAt: "2026-03-18T00:00:00.000Z",
    });
    expect(validateSessionWithAcumatica).not.toHaveBeenCalled();
    expect(resolveSignedInCallerIdentity).not.toHaveBeenCalled();
    expect(savePendingCallerIdVerification).toHaveBeenCalledWith({
      loginName: "bkoczka",
      phoneNumber: "+14167293474",
      validationCode: "654321",
      callSid: "CA456",
    });
  });
});
