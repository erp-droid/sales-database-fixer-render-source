import { describe, expect, it } from "vitest";

import {
  normalizeDeployCommit,
  readDeployCommit,
  shouldReloadForDeployVersion,
} from "@/lib/deploy-refresh";

describe("deploy refresh helpers", () => {
  it("normalizes deploy commits", () => {
    expect(normalizeDeployCommit(" 6a822d5 ")).toBe("6a822d5");
    expect(normalizeDeployCommit("")).toBeNull();
    expect(normalizeDeployCommit(null)).toBeNull();
  });

  it("prefers the runtime commit header over the health payload", () => {
    expect(
      readDeployCommit({
        headerCommit: "header-commit",
        payload: {
          runtimeIdentity: {
            gitCommit: "payload-commit",
          },
        },
      }),
    ).toBe("header-commit");
  });

  it("falls back to the health payload runtime identity", () => {
    expect(
      readDeployCommit({
        headerCommit: null,
        payload: {
          runtimeIdentity: {
            gitCommit: "payload-commit",
          },
        },
      }),
    ).toBe("payload-commit");
  });

  it("reloads only when both commits are known and different", () => {
    expect(
      shouldReloadForDeployVersion({
        currentCommit: "old",
        latestCommit: "new",
      }),
    ).toBe(true);
    expect(
      shouldReloadForDeployVersion({
        currentCommit: "old",
        latestCommit: "old",
      }),
    ).toBe(false);
    expect(
      shouldReloadForDeployVersion({
        currentCommit: null,
        latestCommit: "new",
      }),
    ).toBe(false);
    expect(
      shouldReloadForDeployVersion({
        currentCommit: "old",
        latestCommit: null,
      }),
    ).toBe(false);
  });
});
