#!/usr/bin/env node

function readPositiveInteger(value, fallback, label, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}.`);
  }

  return parsed;
}

function parseArgs(argv) {
  const options = {
    help: false,
    limit: 50,
    maxAttempts: 10,
    maxBatches: 100,
    sleepMs: 750,
    baseUrl:
      process.env.APP_BASE_URL?.trim() ||
      process.env.RENDER_EXTERNAL_URL?.trim() ||
      "https://sales-meadowb.onrender.com",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--limit") {
      options.limit = readPositiveInteger(argv[index + 1], 50, "--limit", 150);
      index += 1;
      continue;
    }
    if (arg === "--max-attempts") {
      options.maxAttempts = readPositiveInteger(
        argv[index + 1],
        10,
        "--max-attempts",
        25,
      );
      index += 1;
      continue;
    }
    if (arg === "--max-batches") {
      options.maxBatches = readPositiveInteger(
        argv[index + 1],
        100,
        "--max-batches",
        500,
      );
      index += 1;
      continue;
    }
    if (arg === "--sleep-ms") {
      options.sleepMs = readPositiveInteger(argv[index + 1], 750, "--sleep-ms", 30000);
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      const raw = argv[index + 1]?.trim();
      if (!raw) {
        throw new Error("--base-url requires a value.");
      }
      options.baseUrl = raw.replace(/\/+$/, "");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  node scripts/trigger-geocode-backfill.cjs [--limit N] [--max-attempts N] [--max-batches N] [--sleep-ms N] [--base-url URL]",
      "",
      "Behavior:",
      "  - calls /api/admin/geocode-backfill in batches",
      "  - requires STATE_TRANSFER_SYSTEM_KEY in the environment",
      "  - does not print the secret",
    ].join("\n"),
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const secret = process.env.STATE_TRANSFER_SYSTEM_KEY?.trim();
  if (!secret) {
    throw new Error("STATE_TRANSFER_SYSTEM_KEY is required.");
  }

  let latest = null;
  for (let batch = 1; batch <= options.maxBatches; batch += 1) {
    const url = new URL("/api/admin/geocode-backfill", options.baseUrl);
    url.searchParams.set("limit", String(options.limit));
    url.searchParams.set("maxAttempts", String(options.maxAttempts));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `Backfill batch ${batch} failed with ${response.status}: ${JSON.stringify(payload)}`,
      );
    }

    latest = payload;
    console.log("[geocode-trigger] batch", {
      batch,
      processed: payload.processed,
      before: payload.before,
      after: payload.after,
      done: payload.done,
    });

    if (payload.done) {
      console.log("[geocode-trigger] complete", payload);
      return;
    }

    await sleep(options.sleepMs);
  }

  console.error("[geocode-trigger] incomplete", latest);
  process.exitCode = 1;
}

run().catch((error) => {
  console.error("[geocode-trigger] failed", error);
  process.exitCode = 1;
});
