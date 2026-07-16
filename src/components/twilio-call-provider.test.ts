import { describe, expect, it } from "vitest";

import { shouldRestoreCallerVerification } from "@/components/twilio-call-provider";

describe("shouldRestoreCallerVerification", () => {
  it("restores an in-progress verification", () => {
    expect(shouldRestoreCallerVerification("pending")).toBe(true);
  });

  it("restores a failed verification so it can be retried", () => {
    expect(shouldRestoreCallerVerification("failed")).toBe(true);
  });

  it.each(["idle", "verified"] as const)(
    "does not restore %s status on every page load",
    (status) => {
      expect(shouldRestoreCallerVerification(status)).toBe(false);
    },
  );
});
