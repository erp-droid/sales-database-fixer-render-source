import crypto from "node:crypto";
import os from "node:os";

type RuntimeIdentitySnapshot = {
  instanceId: string;
  bootedAt: string;
  serviceId: string | null;
  gitCommit: string | null;
  gitBranch: string | null;
};

const PROCESS_BOOTED_AT = new Date().toISOString();

function readOptionalRuntimeEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function createRuntimeIdentitySnapshot(): RuntimeIdentitySnapshot {
  const hostname = os.hostname();
  const processId = process.pid;
  const serviceId = readOptionalRuntimeEnv(["RENDER_SERVICE_ID", "RENDER_EXTERNAL_SERVICE_ID"]);
  const gitCommit = readOptionalRuntimeEnv(["RENDER_GIT_COMMIT", "GIT_COMMIT_SHA"]);
  const gitBranch = readOptionalRuntimeEnv(["RENDER_GIT_BRANCH", "GIT_BRANCH"]);

  const instanceSeed = [hostname, String(processId), PROCESS_BOOTED_AT, serviceId, gitCommit]
    .filter(Boolean)
    .join("|");
  const instanceId = crypto.createHash("sha256").update(instanceSeed).digest("hex").slice(0, 16);

  return {
    instanceId,
    bootedAt: PROCESS_BOOTED_AT,
    serviceId,
    gitCommit,
    gitBranch,
  };
}

const runtimeIdentitySnapshot = createRuntimeIdentitySnapshot();

export function getRuntimeIdentitySnapshot(): RuntimeIdentitySnapshot {
  return runtimeIdentitySnapshot;
}

export function applyRuntimeIdentityHeaders(target: { headers: Headers }): void {
  target.headers.set("x-mb-runtime-instance-id", runtimeIdentitySnapshot.instanceId);
  target.headers.set("x-mb-runtime-booted-at", runtimeIdentitySnapshot.bootedAt);
  if (runtimeIdentitySnapshot.serviceId) {
    target.headers.set("x-mb-runtime-service-id", runtimeIdentitySnapshot.serviceId);
  }
  if (runtimeIdentitySnapshot.gitCommit) {
    target.headers.set("x-mb-runtime-git-commit", runtimeIdentitySnapshot.gitCommit);
  }
  if (runtimeIdentitySnapshot.gitBranch) {
    target.headers.set("x-mb-runtime-git-branch", runtimeIdentitySnapshot.gitBranch);
  }
}
