import { describe, expect, it } from "vitest";

import { buildContactIdentityKey } from "@/lib/contact-identity";

describe("contact identity", () => {
  it("keys contacts by normalized company and contact name", () => {
    expect(
      buildContactIdentityKey({
        companyName: "  Adventec Inc. ",
        contactName: "Jim   Campbell",
      }),
    ).toBe("adventec inc|jim campbell");
  });

  it("does not key company-only placeholder rows", () => {
    expect(
      buildContactIdentityKey({
        companyName: "Adventec",
        contactName: "Adventec",
      }),
    ).toBeNull();
  });
});
