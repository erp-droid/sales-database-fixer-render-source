#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const LOGIN_TIMEOUT_MS = 60000;
const VERIFY_TIMEOUT_MS = 180000;
const DEFAULT_APP_BASE_URL = "http://127.0.0.1:3000";
const COOKIE_JAR_PATH = path.join(process.cwd(), "data", "local-auth-cookie.jar");
const RESULT_PATH = path.join(process.cwd(), "data", "mail-activity-verification.json");

function stripWrappingQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values = {};

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
    const rawValue = line.slice(separatorIndex + 1).trim();
    values[key] = stripWrappingQuotes(rawValue);
  }

  return values;
}

function parseArgs(argv) {
  const options = {
    appBaseUrl: null,
    loginOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--login-only") {
      options.loginOnly = true;
      continue;
    }

    if (arg === "--app-base-url") {
      const value = argv[index + 1];
      if (!value || !value.trim()) {
        throw new Error("--app-base-url requires a value.");
      }
      options.appBaseUrl = value.trim().replace(/\/$/, "");
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage:",
          "  node scripts/mail-activity-smoke.cjs [--login-only] [--app-base-url http://127.0.0.1:3000]",
          "",
          "Behavior:",
          "  - logs into the local app using ACUMATICA_USERNAME / ACUMATICA_PASSWORD from .env.local",
          "  - writes a curl-compatible localhost cookie jar to data/local-auth-cookie.jar",
          "  - by default runs /api/mail/activities/test-log?mode=sender-match",
          "  - writes the JSON result to data/mail-activity-verification.json",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveConfig(options) {
  const envValues = parseEnvFile(path.join(process.cwd(), ".env.local"));
  return {
    appBaseUrl:
      options.appBaseUrl ||
      process.env.APP_BASE_URL ||
      envValues.APP_BASE_URL ||
      DEFAULT_APP_BASE_URL,
    username:
      process.env.ACUMATICA_USERNAME || envValues.ACUMATICA_USERNAME || "",
    password:
      process.env.ACUMATICA_PASSWORD || envValues.ACUMATICA_PASSWORD || "",
  };
}

function assertConfig(config) {
  const missing = [];
  if (!config.username.trim()) {
    missing.push("ACUMATICA_USERNAME");
  }
  if (!config.password.trim()) {
    missing.push("ACUMATICA_PASSWORD");
  }
  if (!config.appBaseUrl.trim()) {
    missing.push("APP_BASE_URL");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function parseSetCookieEntries(setCookies, fallbackHost) {
  return setCookies.flatMap((setCookie) => {
    const segments = String(setCookie || "")
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      return [];
    }

    const pair = segments[0];
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      return [];
    }

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) {
      return [];
    }

    let domain = fallbackHost;
    let includeSubdomains = "FALSE";
    let cookiePath = "/";
    let secure = "FALSE";
    let expiresAt = "0";

    for (const segment of segments.slice(1)) {
      const equalsIndex = segment.indexOf("=");
      const attrName =
        equalsIndex >= 0
          ? segment.slice(0, equalsIndex).trim().toLowerCase()
          : segment.toLowerCase();
      const attrValue = equalsIndex >= 0 ? segment.slice(equalsIndex + 1).trim() : "";

      if (attrName === "domain" && attrValue) {
        domain = attrValue.startsWith(".") ? attrValue.slice(1) : attrValue;
        includeSubdomains = attrValue.startsWith(".") ? "TRUE" : "FALSE";
      }

      if (attrName === "path" && attrValue) {
        cookiePath = attrValue;
      }

      if (attrName === "secure") {
        secure = "TRUE";
      }

      if (attrName === "expires" && attrValue) {
        const expiresMs = Date.parse(attrValue);
        if (Number.isFinite(expiresMs)) {
          expiresAt = String(Math.floor(expiresMs / 1000));
        }
      }
    }

    return [
      {
        domain,
        includeSubdomains,
        path: cookiePath,
        secure,
        expiresAt,
        name,
        value,
      },
    ];
  });
}

function writeCookieJar(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated by scripts/mail-activity-smoke.cjs",
    ...entries.map((entry) =>
      [
        entry.domain,
        entry.includeSubdomains,
        entry.path,
        entry.secure,
        entry.expiresAt,
        entry.name,
        entry.value,
      ].join("\t"),
    ),
    "",
  ];
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function buildCookieHeader(entries) {
  return entries.map((entry) => `${entry.name}=${entry.value}`).join("; ");
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJson(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json().catch(() => null);
}

async function loginToLocalApp(config) {
  const loginResponse = await fetchWithTimeout(
    `${config.appBaseUrl}/api/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        username: config.username,
        password: config.password,
      }),
    },
    LOGIN_TIMEOUT_MS,
  );

  const payload = await readJson(loginResponse);
  if (!loginResponse.ok) {
    throw new Error(
      `Local app login failed (${loginResponse.status}): ${payload && payload.error ? payload.error : "unknown error"}`,
    );
  }

  const fallbackHost = new URL(config.appBaseUrl).hostname;
  const setCookies = extractSetCookies(loginResponse.headers);
  const cookieEntries = parseSetCookieEntries(setCookies, fallbackHost);
  if (cookieEntries.length === 0) {
    throw new Error("Local app login succeeded but no cookies were returned.");
  }

  writeCookieJar(COOKIE_JAR_PATH, cookieEntries);
  return {
    cookieEntries,
    payload,
  };
}

async function runSenderMatchCheck(config, cookieEntries) {
  const response = await fetchWithTimeout(
    `${config.appBaseUrl}/api/mail/activities/test-log?mode=sender-match`,
    {
      method: "GET",
      headers: {
        Cookie: buildCookieHeader(cookieEntries),
        Accept: "application/json",
      },
    },
    VERIFY_TIMEOUT_MS,
  );
  const payload = await readJson(response);
  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
  fs.writeFileSync(
    RESULT_PATH,
    JSON.stringify(
      {
        status: response.status,
        payload,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  if (!response.ok) {
    throw new Error(
      `Sender-match activity check failed (${response.status}). See ${RESULT_PATH}`,
    );
  }

  return payload;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = resolveConfig(options);
  assertConfig(config);

  const { cookieEntries } = await loginToLocalApp(config);
  process.stdout.write(`Saved localhost auth cookie jar to ${COOKIE_JAR_PATH}\n`);

  if (options.loginOnly) {
    return;
  }

  const payload = await runSenderMatchCheck(config, cookieEntries);
  const matchedCount = Array.isArray(payload?.matchedContacts) ? payload.matchedContacts.length : 0;
  const syncStatus =
    payload && typeof payload === "object" && "logPayload" in payload && payload.logPayload
      ? payload.logPayload.activitySyncStatus
      : null;

  process.stdout.write(
    [
      `Mail activity verification saved to ${RESULT_PATH}`,
      `Matched contacts: ${matchedCount}`,
      `Activity sync status: ${syncStatus ?? "unknown"}`,
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
