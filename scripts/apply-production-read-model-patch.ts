import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Cookie = {
  name: string;
  value: string;
};

function readArgument(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function extractSetCookies(headers: Headers): string[] {
  const rawHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof rawHeaders.getSetCookie === "function") {
    return rawHeaders.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function parseCookie(setCookie: string): Cookie | null {
  const [pair] = setCookie.split(";");
  const separatorIndex = pair?.indexOf("=") ?? -1;
  if (!pair || separatorIndex < 0) {
    return null;
  }

  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  return name ? { name, value } : null;
}

function buildCookieHeader(setCookies: string[]): string {
  const cookies = setCookies
    .map(parseCookie)
    .filter((cookie): cookie is Cookie => cookie !== null);
  if (cookies.length === 0) {
    throw new Error("Login succeeded but no cookies were returned.");
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function login(appBaseUrl: string): Promise<string> {
  const username = process.env.ACUMATICA_USERNAME ?? process.env.ACUMATICA_SERVICE_USERNAME ?? "";
  const password = process.env.ACUMATICA_PASSWORD ?? process.env.ACUMATICA_SERVICE_PASSWORD ?? "";
  if (!username || !password) {
    throw new Error("ACUMATICA_USERNAME and ACUMATICA_PASSWORD are required.");
  }

  const response = await fetch(`${appBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`Login failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return buildCookieHeader(extractSetCookies(response.headers));
}

async function postPatch(input: {
  appBaseUrl: string;
  cookieHeader: string;
  plan: unknown;
  dryRun: boolean;
}): Promise<unknown> {
  const response = await fetch(`${input.appBaseUrl}/api/admin/read-model/blank-field-patch`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: input.cookieHeader,
    },
    body: JSON.stringify({
      dryRun: input.dryRun,
      plan: input.plan,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`Patch request failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function main(): Promise<void> {
  const appBaseUrl =
    readArgument("app-base-url") ?? process.env.APP_BASE_URL ?? "https://sales-meadowb.onrender.com";
  const planPath = readArgument("plan");
  if (!planPath) {
    throw new Error("Missing --plan=/path/to/read-model-production-patch-plan.json");
  }

  const dryRun = hasFlag("dry-run");
  const outputPath = readArgument("output");
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as unknown;
  const cookieHeader = await login(appBaseUrl.replace(/\/$/, ""));
  const result = await postPatch({
    appBaseUrl: appBaseUrl.replace(/\/$/, ""),
    cookieHeader,
    plan,
    dryRun,
  });

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
