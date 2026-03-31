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

async function fetchWithCookie(url: string, cookieValue: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: buildCookieHeader(cookieValue),
    },
    cache: "no-store",
  });

  const text = await response.text();
  console.log(`\n${response.status} ${url}`);
  console.log(text.slice(0, 2000));
}

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, "..");
  loadLocalEnv(rootDir);

  await withServiceAcumaticaSession(null, async (cookieValue) => {
    const env = getEnv();
    const base = `${env.ACUMATICA_BASE_URL}${env.ACUMATICA_ENTITY_PATH}`;

    await fetchWithCookie(base, cookieValue);
    await fetchWithCookie(`${base}/swagger`, cookieValue);
    await fetchWithCookie(`${base}/swagger.json`, cookieValue);
    await fetchWithCookie(`${base}/$metadata`, cookieValue);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
