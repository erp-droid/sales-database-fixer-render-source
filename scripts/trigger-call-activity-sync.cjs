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
  const secret = readEnv("CALL_ACTIVITY_SYNC_SECRET");
  const response = await fetch(`${appBaseUrl}/api/scheduled/call-activity-sync/run`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-call-activity-sync-secret": secret,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Scheduled call-activity sync failed (${response.status}): ${body || "Unknown error"}`);
  }

  console.log(body);
}

main().catch((error) => {
  console.error("[trigger-call-activity-sync] failed", error);
  process.exitCode = 1;
});
