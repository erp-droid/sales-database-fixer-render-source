#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { buildCookieHeader } from "@/lib/auth";
import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { getEnv } from "@/lib/env";

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function loadLocalEnv(rootDir: string): void {
  const envValues = parseEnvFile(path.join(rootDir, ".env.local"));
  for (const [key, value] of Object.entries(envValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, "..");
  loadLocalEnv(rootDir);

  await withServiceAcumaticaSession(null, async (cookieValue) => {
    const env = getEnv();
    const url = `${env.ACUMATICA_BASE_URL}${env.ACUMATICA_ENTITY_PATH}/swagger.json`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Cookie: buildCookieHeader(cookieValue),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch swagger.json (${response.status}).`);
    }

    const data = (await response.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(data.paths ?? {});
    const termPaths = paths.filter((p) => p.toLowerCase().includes("term"));
    console.log("Paths containing 'term':");
    console.log(termPaths);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
