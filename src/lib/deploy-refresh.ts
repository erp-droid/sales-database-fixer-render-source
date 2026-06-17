export type DeployVersionPayload = {
  runtimeIdentity?: {
    gitCommit?: unknown;
  } | null;
} | null;

export function normalizeDeployCommit(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function readDeployCommit(input: {
  headerCommit?: string | null;
  payload?: unknown;
}): string | null {
  const headerCommit = normalizeDeployCommit(input.headerCommit);
  if (headerCommit) {
    return headerCommit;
  }

  const payload = input.payload as DeployVersionPayload;
  return normalizeDeployCommit(payload?.runtimeIdentity?.gitCommit);
}

export function shouldReloadForDeployVersion(input: {
  currentCommit: string | null | undefined;
  latestCommit: string | null | undefined;
}): boolean {
  const currentCommit = normalizeDeployCommit(input.currentCommit);
  const latestCommit = normalizeDeployCommit(input.latestCommit);

  return currentCommit !== null && latestCommit !== null && currentCommit !== latestCommit;
}
