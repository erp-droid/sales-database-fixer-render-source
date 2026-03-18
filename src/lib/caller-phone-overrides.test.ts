import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("caller phone overrides", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "caller-phone-overrides-"));
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

  it("stores and reads a normalized caller phone override", async () => {
    const { readCallerPhoneOverride, saveCallerPhoneOverride } = await import(
      "@/lib/caller-phone-overrides"
    );

    const saved = saveCallerPhoneOverride(" BKoczka ", "416-555-0100");
    const stored = readCallerPhoneOverride("bkoczka");

    expect(saved).toMatchObject({
      loginName: "bkoczka",
      phoneNumber: "+14165550100",
    });
    expect(stored).toMatchObject({
      loginName: "bkoczka",
      phoneNumber: "+14165550100",
    });
  });
});
