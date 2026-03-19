import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureReadModelSchema } from "@/lib/read-model/schema";

describe("caller identity cache", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("stores and reads canonical caller identity profiles", async () => {
    const db = new Database(":memory:");
    ensureReadModelSchema(db);

    vi.doMock("@/lib/read-model/db", () => ({
      getReadModelDb: () => db,
    }));

    const {
      readAllCallerIdentityProfiles,
      readCallerIdentityProfile,
      saveCallerIdentityProfile,
    } = await import("@/lib/caller-identity-cache");

    const saved = saveCallerIdentityProfile({
      loginName: " JLEE ",
      employeeId: "E0000142",
      contactId: 142,
      displayName: "Jacky Lee",
      email: "JLEE@MEADOWB.COM",
      phoneNumber: "3653411781",
    });

    expect(saved).toEqual({
      loginName: "jlee",
      employeeId: "E0000142",
      contactId: 142,
      displayName: "Jacky Lee",
      email: "jlee@meadowb.com",
      phoneNumber: "+13653411781",
      updatedAt: expect.any(String),
    });

    expect(readCallerIdentityProfile("jlee")).toEqual(saved);
    expect(readAllCallerIdentityProfiles()).toEqual([saved]);
  });
});
