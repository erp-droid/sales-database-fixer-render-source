#!/usr/bin/env node

function readEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function main() {
  const appBaseUrl = readEnv("APP_BASE_URL").replace(/\/$/, "");
  const secret = readEnv("DAILY_CALL_COACHING_SECRET");
  const response = await fetch(`${appBaseUrl}/api/scheduled/daily-call-coaching/run`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-daily-call-coaching-secret": secret,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Scheduled daily coaching failed (${response.status}): ${body || "Unknown error"}`);
  }

  console.log(body);
}

main().catch((error) => {
  console.error("[trigger-daily-call-coaching] failed", error);
  process.exitCode = 1;
});
