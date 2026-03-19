import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("caller id verifications", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "caller-id-verifications-"));
    process.env.AUTH_PROVIDER = "acumatica";
    process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
    process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
    process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
    process.env.ACUMATICA_LOCALE = "en-US";
    process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
    process.env.AUTH_COOKIE_SECURE = "false";
    process.env.READ_MODEL_SQLITE_PATH = path.join(tempDir, "read-model.sqlite");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("stores and reads a pending caller id verification", async () => {
    const { readCallerIdVerification, savePendingCallerIdVerification } = await import(
      "@/lib/caller-id-verifications"
    );

    const saved = savePendingCallerIdVerification({
      loginName: " JLee ",
      phoneNumber: "416-729-3474",
      validationCode: "123456",
      callSid: "CA123",
    });
    const stored = readCallerIdVerification("jlee");

    expect(saved).toMatchObject({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: "123456",
      callSid: "CA123",
      status: "pending",
    });
    expect(stored).toMatchObject({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: "123456",
      callSid: "CA123",
      status: "pending",
    });
  });

  it("marks a caller id verification as verified", async () => {
    const {
      readCallerIdVerification,
      savePendingCallerIdVerification,
      saveVerifiedCallerIdVerification,
    } = await import("@/lib/caller-id-verifications");

    savePendingCallerIdVerification({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      validationCode: "123456",
      callSid: "CA123",
    });
    const verified = saveVerifiedCallerIdVerification({
      loginName: "jlee",
      phoneNumber: "+14167293474",
    });

    expect(verified).toMatchObject({
      loginName: "jlee",
      phoneNumber: "+14167293474",
      status: "verified",
    });
    expect(verified.validationCode).toBeNull();
    expect(readCallerIdVerification("jlee")?.status).toBe("verified");
  });
});
