#!/usr/bin/env node

const path = require("node:path");

const Database = require("better-sqlite3");
const dotenv = require("dotenv");

const DEFAULT_TIMEOUT_MS = 5000;

function loadLocalEnv(rootDir) {
  dotenv.config({ path: path.join(rootDir, ".env.local"), override: false });
  dotenv.config({ path: path.join(rootDir, ".env"), override: false });
}

function printHelp() {
  console.log(
    [
      "Usage:",
      "  node scripts/backfill-address-geocodes.cjs [--apply] [--limit N] [--concurrency N] [--max-attempts N] [--no-retry-failed]",
      "",
      "Behavior:",
      "  - dry-run by default",
      "  - queues every distinct account address from account_rows into address_geocodes",
      "  - with --apply, geocodes pending addresses and stores latitude/longitude",
      "  - ready coordinates are preserved; failed rows are retried by default until --max-attempts",
    ].join("\n"),
  );
}

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
    apply: false,
    help: false,
    limit: null,
    concurrency: 4,
    maxAttempts: 6,
    retryFailed: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    progressEvery: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--no-retry-failed") {
      options.retryFailed = false;
      continue;
    }
    if (arg === "--limit") {
      options.limit = readPositiveInteger(argv[index + 1], null, "--limit");
      index += 1;
      continue;
    }
    if (arg === "--concurrency") {
      options.concurrency = readPositiveInteger(argv[index + 1], 4, "--concurrency", 10);
      index += 1;
      continue;
    }
    if (arg === "--max-attempts") {
      options.maxAttempts = readPositiveInteger(argv[index + 1], 6, "--max-attempts", 25);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = readPositiveInteger(argv[index + 1], DEFAULT_TIMEOUT_MS, "--timeout-ms", 30000);
      index += 1;
      continue;
    }
    if (arg === "--progress-every") {
      options.progressEvery = readPositiveInteger(argv[index + 1], 25, "--progress-every", 500);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveDatabasePath(rootDir) {
  const input = process.env.READ_MODEL_SQLITE_PATH || "./data/read-model.sqlite";
  return path.isAbsolute(input) ? input : path.join(rootDir, input);
}

function ensureAddressGeocodeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS address_geocodes (
      address_key TEXT PRIMARY KEY,
      address_line1 TEXT NOT NULL,
      address_line2 TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      provider TEXT,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      last_attempted_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function clean(value) {
  return String(value || "").trim();
}

function buildAddressKey(row) {
  return [
    row.address_line1,
    row.address_line2,
    row.city,
    row.state,
    row.postal_code,
    row.country,
  ]
    .map(normalizeText)
    .join("|");
}

function readStatusCounts(db) {
  const rows = db
    .prepare(
      `
      SELECT status, COUNT(*) AS count
      FROM address_geocodes
      GROUP BY status
      ORDER BY status
      `,
    )
    .all();

  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function readGeocodeRowsForKeys(db, keys) {
  const uniqueKeys = [...new Set(keys.map((key) => clean(key)).filter(Boolean))];
  const rows = [];
  const chunkSize = 750;
  for (let index = 0; index < uniqueKeys.length; index += chunkSize) {
    const chunk = uniqueKeys.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    rows.push(
      ...db
        .prepare(
          `
          SELECT address_key, status, latitude, longitude, attempt_count
          FROM address_geocodes
          WHERE address_key IN (${placeholders})
          `,
        )
        .all(...chunk),
    );
  }

  return new Map(rows.map((row) => [row.address_key, row]));
}

function summarizeCurrentAddressCoverage(db, addresses) {
  const existing = readGeocodeRowsForKeys(
    db,
    addresses.map((row) => row.address_key),
  );
  const summary = {
    total: addresses.length,
    ready: 0,
    missing: 0,
    pending: 0,
    failed: 0,
    otherNotReady: 0,
  };

  for (const row of addresses) {
    const current = existing.get(row.address_key);
    if (!current) {
      summary.missing += 1;
      continue;
    }

    const hasReadyCoordinates =
      current.status === "ready" &&
      Number.isFinite(Number(current.latitude)) &&
      Number.isFinite(Number(current.longitude));
    if (hasReadyCoordinates) {
      summary.ready += 1;
      continue;
    }

    if (current.status === "pending") {
      summary.pending += 1;
    } else if (current.status === "failed") {
      summary.failed += 1;
    } else {
      summary.otherNotReady += 1;
    }
  }

  return {
    ...summary,
    notReady: summary.total - summary.ready,
  };
}

function readDistinctAccountAddresses(db) {
  const rows = db
    .prepare(
      `
      SELECT
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        COUNT(*) AS row_count,
        COUNT(DISTINCT COALESCE(NULLIF(account_record_id, ''), NULLIF(id, ''), NULLIF(business_account_id, ''), company_name)) AS account_count
      FROM account_rows
      WHERE TRIM(address_line1) <> ''
        AND TRIM(city) <> ''
      GROUP BY
        LOWER(TRIM(address_line1)),
        LOWER(TRIM(address_line2)),
        LOWER(TRIM(city)),
        LOWER(TRIM(state)),
        LOWER(TRIM(postal_code)),
        LOWER(TRIM(country))
      ORDER BY LOWER(TRIM(city)), LOWER(TRIM(address_line1))
      `,
    )
    .all();

  return rows.map((row) => ({
    ...row,
    address_key: buildAddressKey(row),
  }));
}

function queueAddresses(db, addresses, options) {
  const now = new Date().toISOString();
  const existing = db.prepare(
    `
    SELECT status, latitude, longitude, attempt_count
    FROM address_geocodes
    WHERE address_key = ?
    `,
  );
  const insert = db.prepare(
    `
    INSERT INTO address_geocodes (
      address_key,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country,
      latitude,
      longitude,
      provider,
      status,
      attempt_count,
      last_attempted_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending', 0, NULL, ?)
    `,
  );
  const updateReady = db.prepare(
    `
    UPDATE address_geocodes
    SET address_line1 = ?,
        address_line2 = ?,
        city = ?,
        state = ?,
        postal_code = ?,
        country = ?,
        updated_at = ?
    WHERE address_key = ?
    `,
  );
  const updatePending = db.prepare(
    `
    UPDATE address_geocodes
    SET address_line1 = ?,
        address_line2 = ?,
        city = ?,
        state = ?,
        postal_code = ?,
        country = ?,
        latitude = NULL,
        longitude = NULL,
        provider = NULL,
        status = 'pending',
        updated_at = ?
    WHERE address_key = ?
    `,
  );
  const updateMetadataOnly = db.prepare(
    `
    UPDATE address_geocodes
    SET address_line1 = ?,
        address_line2 = ?,
        city = ?,
        state = ?,
        postal_code = ?,
        country = ?,
        updated_at = ?
    WHERE address_key = ?
    `,
  );

  const stats = {
    insertedPending: 0,
    retriedFailed: 0,
    preservedReady: 0,
    alreadyPending: 0,
    skippedFailed: 0,
    refreshedOther: 0,
  };

  const transaction = db.transaction(() => {
    for (const row of addresses) {
      const current = existing.get(row.address_key);
      if (!current) {
        insert.run(
          row.address_key,
          clean(row.address_line1),
          clean(row.address_line2),
          clean(row.city),
          clean(row.state),
          clean(row.postal_code),
          clean(row.country),
          now,
        );
        stats.insertedPending += 1;
        continue;
      }

      const hasReadyCoordinates =
        current.status === "ready" &&
        Number.isFinite(Number(current.latitude)) &&
        Number.isFinite(Number(current.longitude));
      if (hasReadyCoordinates) {
        updateReady.run(
          clean(row.address_line1),
          clean(row.address_line2),
          clean(row.city),
          clean(row.state),
          clean(row.postal_code),
          clean(row.country),
          now,
          row.address_key,
        );
        stats.preservedReady += 1;
        continue;
      }

      if (
        current.status === "failed" &&
        (!options.retryFailed || Number(current.attempt_count || 0) >= options.maxAttempts)
      ) {
        updateMetadataOnly.run(
          clean(row.address_line1),
          clean(row.address_line2),
          clean(row.city),
          clean(row.state),
          clean(row.postal_code),
          clean(row.country),
          now,
          row.address_key,
        );
        stats.skippedFailed += 1;
        continue;
      }

      updatePending.run(
        clean(row.address_line1),
        clean(row.address_line2),
        clean(row.city),
        clean(row.state),
        clean(row.postal_code),
        clean(row.country),
        now,
        row.address_key,
      );
      if (current.status === "failed") {
        stats.retriedFailed += 1;
      } else if (current.status === "pending") {
        stats.alreadyPending += 1;
      } else {
        stats.refreshedOther += 1;
      }
    }
  });

  transaction();
  return stats;
}

function readPendingAddresses(db, options) {
  const limitSql = options.limit ? "LIMIT ?" : "";
  const params = options.limit ? [options.maxAttempts, options.limit] : [options.maxAttempts];
  return db
    .prepare(
      `
      SELECT
        address_key,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        attempt_count
      FROM address_geocodes
      WHERE status = 'pending'
        AND attempt_count < ?
        AND TRIM(address_line1) <> ''
        AND TRIM(city) <> ''
      ORDER BY updated_at ASC
      ${limitSql}
      `,
    )
    .all(...params);
}

function buildSearchTerm(input) {
  return [
    input.address_line1,
    input.address_line2,
    input.city,
    input.state,
    input.postal_code,
    input.country,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeWithArcGIS(input, timeoutMs) {
  const query = buildSearchTerm(input);
  if (!query) {
    return null;
  }

  const url =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates" +
    `?f=json&maxLocations=1&singleLine=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
    timeoutMs,
  );
  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  const location = payload?.candidates?.[0]?.location;
  const latitude = parseNumber(location?.y);
  const longitude = parseNumber(location?.x);
  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    provider: "arcgis",
  };
}

async function geocodeWithNominatim(input, timeoutMs) {
  const query = buildSearchTerm(input);
  if (!query) {
    return null;
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    query,
  )}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "SalesDatabaseFixer/1.0 (internal geocode backfill)",
      },
      cache: "no-store",
    },
    timeoutMs,
  );
  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  const first = Array.isArray(payload) ? payload[0] : null;
  const latitude = parseNumber(first?.lat);
  const longitude = parseNumber(first?.lon);
  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    provider: "nominatim",
  };
}

async function geocodeAddress(input, timeoutMs) {
  if (!clean(input.address_line1) || !clean(input.city)) {
    return null;
  }

  const arcgis = await geocodeWithArcGIS(input, timeoutMs).catch(() => null);
  if (arcgis) {
    return arcgis;
  }

  return geocodeWithNominatim(input, timeoutMs).catch(() => null);
}

async function processPendingGeocodes(db, pending, options) {
  const markReady = db.prepare(
    `
    UPDATE address_geocodes
    SET latitude = ?,
        longitude = ?,
        provider = ?,
        status = 'ready',
        attempt_count = ?,
        last_attempted_at = ?,
        updated_at = ?
    WHERE address_key = ?
    `,
  );
  const markFailed = db.prepare(
    `
    UPDATE address_geocodes
    SET status = 'failed',
        attempt_count = ?,
        last_attempted_at = ?,
        updated_at = ?
    WHERE address_key = ?
    `,
  );

  const summary = {
    processed: 0,
    ready: 0,
    failed: 0,
  };
  let cursor = 0;

  async function worker(workerId) {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) {
        return;
      }

      const item = pending[index];
      const attemptedAt = new Date().toISOString();
      const nextAttemptCount = Number(item.attempt_count || 0) + 1;
      const result = await geocodeAddress(item, options.timeoutMs);

      if (result) {
        markReady.run(
          result.latitude,
          result.longitude,
          result.provider,
          nextAttemptCount,
          attemptedAt,
          attemptedAt,
          item.address_key,
        );
        summary.ready += 1;
      } else {
        markFailed.run(nextAttemptCount, attemptedAt, attemptedAt, item.address_key);
        summary.failed += 1;
      }

      summary.processed += 1;
      if (
        summary.processed === pending.length ||
        summary.processed % options.progressEvery === 0
      ) {
        console.log("[geocode-backfill] progress", {
          workerId,
          processed: summary.processed,
          total: pending.length,
          ready: summary.ready,
          failed: summary.failed,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, pending.length) }, (_, index) =>
      worker(index + 1),
    ),
  );

  return summary;
}

async function main() {
  const rootDir = process.cwd();
  loadLocalEnv(rootDir);
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sqlitePath = resolveDatabasePath(rootDir);
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  ensureAddressGeocodeSchema(db);

  const accountRowCount = db.prepare("SELECT COUNT(*) AS count FROM account_rows").get().count;
  const addresses = readDistinctAccountAddresses(db);
  const before = readStatusCounts(db);
  const beforeCoverage = summarizeCurrentAddressCoverage(db, addresses);

  console.log("[geocode-backfill] start", {
    apply: options.apply,
    sqlitePath,
    accountRowCount,
    distinctMappableAddresses: addresses.length,
    before,
    beforeCoverage,
    retryFailed: options.retryFailed,
    maxAttempts: options.maxAttempts,
    limit: options.limit,
    concurrency: options.concurrency,
  });

  if (!options.apply) {
    console.log("[geocode-backfill] dry-run complete", {
      queuedWouldCoverAddresses: addresses.length,
      readyCurrentAddressesBefore: beforeCoverage.ready,
      missingOrNotReadyCurrentAddresses: beforeCoverage.notReady,
    });
    db.close();
    return;
  }

  const queueStats = queueAddresses(db, addresses, options);
  const queued = readStatusCounts(db);
  const pending = readPendingAddresses(db, options);
  console.log("[geocode-backfill] queued", {
    queueStats,
    queued,
    pendingToProcess: pending.length,
  });

  const processed = await processPendingGeocodes(db, pending, options);
  const after = readStatusCounts(db);
  const afterCoverage = summarizeCurrentAddressCoverage(db, addresses);
  console.log("[geocode-backfill] complete", {
    processed,
    after,
    afterCoverage,
  });

  db.close();
}

main().catch((error) => {
  console.error("[geocode-backfill] failed", error);
  process.exitCode = 1;
});
