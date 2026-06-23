import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

function readAppVersion(): string {
  const remotePackageJson = readGitText("origin/HEAD:package.json") || readGitText("origin/main:package.json");
  const remoteVersion = parsePackageVersion(remotePackageJson);
  if (remoteVersion) {
    return remoteVersion;
  }

  try {
    return parsePackageVersion(readFileSync(new URL("./package.json", import.meta.url), "utf8")) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parsePackageVersion(packageJsonText: string | null): string | null {
  if (!packageJsonText) {
    return null;
  }

  try {
    const packageJson = JSON.parse(packageJsonText) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : null;
  } catch {
    return null;
  }
}

function readGitText(ref: string): string | null {
  try {
    return execSync(`git show ${ref}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function readGitCommit(ref: string): string | null {
  try {
    const value = execSync(`git rev-parse --short=7 ${ref}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function readBuildCommit(): string {
  const envCommit =
    process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.GIT_COMMIT_SHA?.trim() ||
    process.env.NEXT_PUBLIC_APP_BUILD?.trim();
  if (envCommit) {
    return envCommit.slice(0, 7);
  }

  return readGitCommit("origin/HEAD") ?? readGitCommit("origin/main") ?? readGitCommit("HEAD") ?? "";
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: readAppVersion(),
    NEXT_PUBLIC_APP_BUILD: readBuildCommit(),
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
