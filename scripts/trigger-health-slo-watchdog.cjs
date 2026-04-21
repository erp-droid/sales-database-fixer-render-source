#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");

function readRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readOptionalEnv(name) {
  const value = String(process.env[name] || "").trim();
  return value || null;
}

function readBoundedInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const clamped = Math.max(min, Math.min(max, parsed));
  return clamped;
}

function readBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return fallback;
}

function normalizeBaseUrl(url) {
  return String(url).trim().replace(/\/+$/, "");
}

function normalizePath(pathname, fallback) {
  const raw = String(pathname || "").trim();
  if (!raw) {
    return fallback;
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildPayloadShape(value) {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    return [buildPayloadShape(value[0])];
  }

  const valueType = typeof value;
  if (valueType === "string") {
    return "__string";
  }
  if (valueType === "number") {
    return "__number";
  }
  if (valueType === "boolean") {
    return "__boolean";
  }
  if (valueType !== "object") {
    return `__${valueType}`;
  }

  const shaped = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    shaped[key] = buildPayloadShape(value[key]);
  }
  return shaped;
}

function computePayloadShapeHash(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const shape = buildPayloadShape(payload);
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(shape))
    .digest("hex");
  return digest.slice(0, 16);
}

const WATCHDOG_PROBE_HEADERS = [
  "rndr-id",
  "date",
  "x-render-origin-server",
  "x-mb-runtime-instance-id",
  "x-mb-runtime-booted-at",
  "x-mb-runtime-service-id",
  "x-mb-runtime-git-commit",
  "x-mb-runtime-git-branch",
];

function pickResponseHeaders(headers, includeHeaders) {
  if (!headers || !Array.isArray(includeHeaders) || includeHeaders.length === 0) {
    return null;
  }

  const picked = {};
  for (const name of includeHeaders) {
    const value = headers.get(name);
    if (value !== null && value !== undefined && value !== "") {
      picked[name] = value;
    }
  }

  return Object.keys(picked).length > 0 ? picked : null;
}

function safeErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function parseIsoMs(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function percentileFromSorted(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const bounded = Math.max(0, Math.min(100, percentile));
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil((bounded / 100) * values.length) - 1),
  );
  return values[index] || 0;
}

function roundMetric(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function computeMaxConsecutiveTimeouts(samples) {
  let current = 0;
  let max = 0;

  for (const sample of samples) {
    if (sample && sample.timedOut) {
      current += 1;
      if (current > max) {
        max = current;
      }
      continue;
    }

    current = 0;
  }

  return max;
}

function summarizeProbeSeries(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      status5xxCount: 0,
      timedOutCount: 0,
      statusCodes: [],
    };
  }

  const durations = samples
    .map((sample) => Number(sample.durationMs) || 0)
    .sort((left, right) => left - right);

  return {
    count: samples.length,
    p50Ms: roundMetric(percentileFromSorted(durations, 50)),
    p95Ms: roundMetric(percentileFromSorted(durations, 95)),
    p99Ms: roundMetric(percentileFromSorted(durations, 99)),
    maxMs: roundMetric(durations[durations.length - 1] || 0),
    status5xxCount: samples.filter((sample) => Number(sample.statusCode) >= 500).length,
    timedOutCount: samples.filter((sample) => sample.timedOut).length,
    statusCodes: samples.map((sample) => sample.statusCode),
  };
}

function buildProbeWindow(groups) {
  const samples = groups
    .flatMap((group) => (Array.isArray(group) ? group : []))
    .filter(Boolean)
    .sort((left, right) => {
      const leftMs = parseIsoMs(left.startedAt) || 0;
      const rightMs = parseIsoMs(right.startedAt) || 0;
      return leftMs - rightMs;
    });

  if (samples.length === 0) {
    return {
      from: null,
      to: null,
      count: 0,
    };
  }

  return {
    from: samples[0]?.startedAt || null,
    to: samples[samples.length - 1]?.finishedAt || null,
    count: samples.length,
  };
}

async function probeEndpoint(url, timeoutMs, options = {}) {
  const captureJson = options.captureJson === true;
  const includeHeaders = Array.isArray(options.includeHeaders) ? options.includeHeaders : [];
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const bodyText = await response.text().catch(() => "");
    const headers = pickResponseHeaders(response.headers, includeHeaders);
    let bodyJson = null;
    let bodyJsonParseError = null;
    let bodyShapeHash = null;

    if (captureJson && bodyText) {
      try {
        bodyJson = JSON.parse(bodyText);
        bodyShapeHash = computePayloadShapeHash(bodyJson);
      } catch (error) {
        bodyJsonParseError = safeErrorMessage(error);
      }
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      statusCode: response.status,
      timedOut: false,
      ok: response.ok,
      error: null,
      headers,
      bodyJson,
      bodyJsonParseError,
      bodyShapeHash,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      statusCode: 0,
      timedOut,
      ok: false,
      error: safeErrorMessage(error),
      headers: null,
      bodyJson: null,
      bodyJsonParseError: null,
      bodyShapeHash: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runProbeSeries(config) {
  const healthEndpoint = `${config.baseUrl}${config.healthcheckPath}`;
  const healthPayloadEndpoint = `${config.baseUrl}${config.healthPayloadPath}`;
  const syncEndpoint = `${config.baseUrl}${config.syncStatusPath}`;
  const healthProbes = [];
  const healthPayloadProbes = [];
  const syncStatusProbes = [];

  for (let attempt = 1; attempt <= config.probeAttempts; attempt += 1) {
    const healthSample = await probeEndpoint(healthEndpoint, config.timeoutMs);
    healthProbes.push({
      attempt,
      endpoint: healthEndpoint,
      ...healthSample,
    });

    const healthPayloadSample = await probeEndpoint(healthPayloadEndpoint, config.timeoutMs, {
      captureJson: true,
      includeHeaders: WATCHDOG_PROBE_HEADERS,
    });
    healthPayloadProbes.push({
      attempt,
      endpoint: healthPayloadEndpoint,
      ...healthPayloadSample,
    });

    const syncSample = await probeEndpoint(syncEndpoint, config.timeoutMs, {
      captureJson: true,
      includeHeaders: WATCHDOG_PROBE_HEADERS,
    });
    syncStatusProbes.push({
      attempt,
      endpoint: syncEndpoint,
      ...syncSample,
    });

    if (attempt < config.probeAttempts && config.probePauseMs > 0) {
      await sleep(config.probePauseMs);
    }
  }

  return {
    healthProbes,
    healthPayloadProbes,
    syncStatusProbes,
  };
}

async function fetchRenderServerFailedEvents(config) {
  if (!config.renderServiceId || !config.renderApiKey) {
    return {
      enabled: false,
      error: null,
      events: [],
    };
  }

  const cutoffMs = Date.now() - config.eventLookbackMinutes * 60_000;

  try {
    const response = await fetch(
      `https://api.render.com/v1/services/${encodeURIComponent(config.renderServiceId)}/events?limit=20`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.renderApiKey}`,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        enabled: true,
        error: `Render events request failed (${response.status}): ${body.slice(0, 300)}`,
        events: [],
      };
    }

    const payload = await response.json().catch(() => []);
    const records = Array.isArray(payload) ? payload : [];
    const events = records
      .map((record) => (record && typeof record === "object" ? record.event || record : null))
      .filter((event) => event && typeof event === "object")
      .filter((event) => String(event.type || "").toLowerCase() === "server_failed")
      .map((event) => ({
        id: event.id ?? null,
        timestamp: event.timestamp ?? null,
        reason: event.details?.reason ?? null,
      }))
      .filter((event) => {
        const ts = parseIsoMs(event.timestamp);
        return ts === null ? true : ts >= cutoffMs;
      });

    return {
      enabled: true,
      error: null,
      events,
    };
  } catch (error) {
    return {
      enabled: true,
      error: safeErrorMessage(error),
      events: [],
    };
  }
}

async function fetchRuntimeHealthMetrics(config) {
  const runtimeMetricsEndpoint = `${config.baseUrl}${config.runtimeMetricsPath}`;
  const metricsTimeoutMs = Math.max(500, Math.min(10_000, config.timeoutMs));
  const sample = await probeEndpoint(runtimeMetricsEndpoint, metricsTimeoutMs);

  if (sample.statusCode === 0) {
    return {
      endpoint: runtimeMetricsEndpoint,
      ok: false,
      error: sample.error,
      statusCode: 0,
      payload: null,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), metricsTimeoutMs);
    const response = await fetch(runtimeMetricsEndpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        endpoint: runtimeMetricsEndpoint,
        ok: false,
        error: `Runtime metrics request failed (${response.status}): ${body.slice(0, 300)}`,
        statusCode: response.status,
        payload: null,
      };
    }

    const payload = await response.json().catch(() => null);
    return {
      endpoint: runtimeMetricsEndpoint,
      ok: true,
      error: null,
      statusCode: response.status,
      payload,
    };
  } catch (error) {
    return {
      endpoint: runtimeMetricsEndpoint,
      ok: false,
      error: safeErrorMessage(error),
      statusCode: 0,
      payload: null,
    };
  }
}

function readNumericMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readNullableNumericMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toSyncPayloadSnapshot(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    status: typeof payload.status === "string" ? payload.status : null,
    rowsCount: readNullableNumericMetric(payload.rowsCount),
    accountsCount: readNullableNumericMetric(payload.accountsCount),
    contactsCount: readNullableNumericMetric(payload.contactsCount),
  };
}

function collectUniqueHeaderValues(samples, headerName) {
  return Array.from(
    new Set(
      (Array.isArray(samples) ? samples : [])
        .map((sample) => sample?.headers?.[headerName])
        .filter((value) => typeof value === "string" && value.length > 0),
    ),
  );
}

function collectUniqueHealthRuntimeIdentityValues(samples, field) {
  return Array.from(
    new Set(
      (Array.isArray(samples) ? samples : [])
        .map((sample) => sample?.bodyJson?.runtimeIdentity?.[field])
        .filter((value) => typeof value === "string" && value.length > 0),
    ),
  );
}

function evaluateHealthPayloadParity(healthPayloadProbes, syncStatusProbes) {
  const checkedSamples = Math.min(
    Array.isArray(healthPayloadProbes) ? healthPayloadProbes.length : 0,
    Array.isArray(syncStatusProbes) ? syncStatusProbes.length : 0,
  );
  const anomalies = [];

  for (let index = 0; index < checkedSamples; index += 1) {
    const healthProbe = healthPayloadProbes[index];
    const syncProbe = syncStatusProbes[index];
    if (!healthProbe || !syncProbe) {
      continue;
    }
    if (healthProbe.statusCode !== 200 || syncProbe.statusCode !== 200) {
      continue;
    }

    const healthPayload =
      healthProbe.bodyJson && typeof healthProbe.bodyJson === "object"
        ? healthProbe.bodyJson
        : null;
    const syncPayload = syncProbe.bodyJson && typeof syncProbe.bodyJson === "object"
      ? syncProbe.bodyJson
      : null;
    const syncSnapshot = toSyncPayloadSnapshot(syncPayload);
    if (!syncSnapshot || !syncSnapshot.status) {
      continue;
    }

    const healthSyncPayload =
      healthPayload &&
      Object.prototype.hasOwnProperty.call(healthPayload, "syncStatus")
        ? healthPayload.syncStatus
        : undefined;
    const healthSyncSnapshot = toSyncPayloadSnapshot(healthSyncPayload);
    const healthReadModelEnabled =
      healthPayload && typeof healthPayload.readModelEnabled === "boolean"
        ? healthPayload.readModelEnabled
        : null;
    const healthRuntimeIdentity =
      healthPayload && healthPayload.runtimeIdentity && typeof healthPayload.runtimeIdentity === "object"
        ? healthPayload.runtimeIdentity
        : null;
    const healthRuntimeInstanceId =
      healthProbe.headers?.["x-mb-runtime-instance-id"] ||
      (typeof healthRuntimeIdentity?.instanceId === "string"
        ? healthRuntimeIdentity.instanceId
        : null);
    const syncRuntimeInstanceId = syncProbe.headers?.["x-mb-runtime-instance-id"] || null;
    const healthRuntimeBootedAt =
      healthProbe.headers?.["x-mb-runtime-booted-at"] ||
      (typeof healthRuntimeIdentity?.bootedAt === "string" ? healthRuntimeIdentity.bootedAt : null);
    const syncRuntimeBootedAt = syncProbe.headers?.["x-mb-runtime-booted-at"] || null;
    const healthRuntimeServiceId =
      healthProbe.headers?.["x-mb-runtime-service-id"] ||
      (typeof healthRuntimeIdentity?.serviceId === "string" ? healthRuntimeIdentity.serviceId : null);
    const syncRuntimeServiceId = syncProbe.headers?.["x-mb-runtime-service-id"] || null;
    const healthRuntimeGitCommit =
      healthProbe.headers?.["x-mb-runtime-git-commit"] ||
      (typeof healthRuntimeIdentity?.gitCommit === "string" ? healthRuntimeIdentity.gitCommit : null);
    const syncRuntimeGitCommit = syncProbe.headers?.["x-mb-runtime-git-commit"] || null;
    const healthRuntimeGitBranch =
      healthProbe.headers?.["x-mb-runtime-git-branch"] ||
      (typeof healthRuntimeIdentity?.gitBranch === "string" ? healthRuntimeIdentity.gitBranch : null);
    const syncRuntimeGitBranch = syncProbe.headers?.["x-mb-runtime-git-branch"] || null;
    const syncHasCounts =
      (syncSnapshot.rowsCount || 0) > 0 ||
      (syncSnapshot.accountsCount || 0) > 0 ||
      (syncSnapshot.contactsCount || 0) > 0;

    let reason = null;
    if (!healthPayload) {
      reason = `health payload was not JSON (${healthProbe.bodyJsonParseError || "parse failed"})`;
    } else if (healthSyncPayload === undefined) {
      reason = "health payload missing syncStatus field";
    } else if (healthSyncPayload === null) {
      reason = "health payload syncStatus is null";
    } else if (!healthSyncSnapshot || !healthSyncSnapshot.status) {
      reason = "health payload syncStatus is malformed";
    } else if (
      healthSyncSnapshot.status !== syncSnapshot.status ||
      healthSyncSnapshot.rowsCount !== syncSnapshot.rowsCount ||
      healthSyncSnapshot.accountsCount !== syncSnapshot.accountsCount ||
      healthSyncSnapshot.contactsCount !== syncSnapshot.contactsCount
    ) {
      reason = "health payload syncStatus diverges from /api/sync/status";
    }

    if (!reason && healthReadModelEnabled === false && syncHasCounts) {
      reason = "health payload reports readModelEnabled=false while sync counters are populated";
    }

    if (reason) {
      anomalies.push({
        attempt: Number(healthProbe.attempt) || index + 1,
        reason,
        healthRndrId: healthProbe.headers?.["rndr-id"] || null,
        syncRndrId: syncProbe.headers?.["rndr-id"] || null,
        healthRuntimeInstanceId,
        syncRuntimeInstanceId,
        healthRuntimeBootedAt,
        syncRuntimeBootedAt,
        healthRuntimeServiceId,
        syncRuntimeServiceId,
        healthRuntimeGitCommit,
        syncRuntimeGitCommit,
        healthRuntimeGitBranch,
        syncRuntimeGitBranch,
        healthPayloadShapeHash: healthProbe.bodyShapeHash || null,
        syncPayloadShapeHash: syncProbe.bodyShapeHash || null,
        healthReadModelEnabled,
        healthSyncStatus: healthSyncSnapshot,
        syncStatus: syncSnapshot,
      });
    }
  }

  const healthPayloadShapeHashes = Array.from(
    new Set(
      (Array.isArray(healthPayloadProbes) ? healthPayloadProbes : [])
        .map((sample) => sample?.bodyShapeHash)
        .filter((hash) => typeof hash === "string" && hash.length > 0),
    ),
  );
  const syncPayloadShapeHashes = Array.from(
    new Set(
      (Array.isArray(syncStatusProbes) ? syncStatusProbes : [])
        .map((sample) => sample?.bodyShapeHash)
        .filter((hash) => typeof hash === "string" && hash.length > 0),
    ),
  );
  const healthRuntimeInstanceIds = Array.from(
    new Set([
      ...collectUniqueHeaderValues(healthPayloadProbes, "x-mb-runtime-instance-id"),
      ...collectUniqueHealthRuntimeIdentityValues(healthPayloadProbes, "instanceId"),
    ]),
  );
  const syncRuntimeInstanceIds = collectUniqueHeaderValues(syncStatusProbes, "x-mb-runtime-instance-id");
  const healthRuntimeBootedAtValues = Array.from(
    new Set([
      ...collectUniqueHeaderValues(healthPayloadProbes, "x-mb-runtime-booted-at"),
      ...collectUniqueHealthRuntimeIdentityValues(healthPayloadProbes, "bootedAt"),
    ]),
  );
  const syncRuntimeBootedAtValues = collectUniqueHeaderValues(syncStatusProbes, "x-mb-runtime-booted-at");
  const healthRuntimeServiceIds = Array.from(
    new Set([
      ...collectUniqueHeaderValues(healthPayloadProbes, "x-mb-runtime-service-id"),
      ...collectUniqueHealthRuntimeIdentityValues(healthPayloadProbes, "serviceId"),
    ]),
  );
  const syncRuntimeServiceIds = collectUniqueHeaderValues(syncStatusProbes, "x-mb-runtime-service-id");
  const healthRuntimeGitCommits = Array.from(
    new Set([
      ...collectUniqueHeaderValues(healthPayloadProbes, "x-mb-runtime-git-commit"),
      ...collectUniqueHealthRuntimeIdentityValues(healthPayloadProbes, "gitCommit"),
    ]),
  );
  const syncRuntimeGitCommits = collectUniqueHeaderValues(syncStatusProbes, "x-mb-runtime-git-commit");
  const healthRuntimeGitBranches = Array.from(
    new Set([
      ...collectUniqueHeaderValues(healthPayloadProbes, "x-mb-runtime-git-branch"),
      ...collectUniqueHealthRuntimeIdentityValues(healthPayloadProbes, "gitBranch"),
    ]),
  );
  const syncRuntimeGitBranches = collectUniqueHeaderValues(syncStatusProbes, "x-mb-runtime-git-branch");

  return {
    checkedSamples,
    anomalyCount: anomalies.length,
    anomalies,
    healthPayloadShapeHashes,
    syncPayloadShapeHashes,
    healthRuntimeInstanceIds,
    syncRuntimeInstanceIds,
    healthRuntimeBootedAtValues,
    syncRuntimeBootedAtValues,
    healthRuntimeServiceIds,
    syncRuntimeServiceIds,
    healthRuntimeGitCommits,
    syncRuntimeGitCommits,
    healthRuntimeGitBranches,
    syncRuntimeGitBranches,
  };
}

function isRouteAnomalous(summary, p99ThresholdMs, status5xxThresholdCount) {
  if (!summary || typeof summary !== "object") {
    return false;
  }

  const p99Ms = Number(summary.p99Ms);
  const status5xxCount = Number(summary.status5xxCount);
  return (
    (Number.isFinite(p99Ms) && p99Ms >= p99ThresholdMs) ||
    (Number.isFinite(status5xxCount) && status5xxCount >= status5xxThresholdCount)
  );
}

function buildIncidentPayload(input) {
  const requestLogWindowUtc = buildProbeWindow([
    input.healthProbes,
    input.healthPayloadProbes,
    input.syncStatusProbes,
  ]);

  return {
    source: "health-slo-watchdog",
    severity: "critical",
    destination: input.incidentPath,
    productionTarget: input.baseUrl,
    triggeredAt: new Date().toISOString(),
    summary: [
      `Health-check SLO watchdog triggered at ${input.baseUrl}.`,
      `Timeout streak: ${input.maxConsecutiveTimeouts} (threshold ${input.timeoutThreshold}, budget ${input.timeoutMs}ms).`,
      input.reasons.length > 0 ? `Reasons: ${input.reasons.join("; ")}.` : null,
      input.forceIncident ? "Trigger mode: forced (dry run or test)." : null,
    ]
      .filter(Boolean)
      .join(" "),
    sloRule: {
      type: "timeout_and_runtime_anomaly_watchdog",
      timeoutMs: input.timeoutMs,
      timeoutThreshold: input.timeoutThreshold,
      probeAttempts: input.probeAttempts,
      probePauseMs: input.probePauseMs,
      healthcheckPath: input.healthcheckPath,
      healthPayloadPath: input.healthPayloadPath,
      syncStatusPath: input.syncStatusPath,
      routeP99ThresholdMs: input.routeP99ThresholdMs,
      route5xxThresholdCount: input.route5xxThresholdCount,
      eventLoopP99ThresholdMs: input.eventLoopP99ThresholdMs,
      eventLoopMaxThresholdMs: input.eventLoopMaxThresholdMs,
      eventLoopMaxSpikeAgeMs: input.eventLoopMaxSpikeAgeMs,
    },
    evidence: {
      reasons: input.reasons,
      requestLogWindowUtc,
      timeoutBreach: input.timeoutBreach,
      maxConsecutiveTimeouts: input.maxConsecutiveTimeouts,
      healthz: {
        summary: input.healthSummary,
        probes: input.healthProbes,
      },
      healthPayload: {
        path: input.healthPayloadPath,
        parity: input.healthPayloadParity,
        probes: input.healthPayloadProbes,
      },
      syncStatus: {
        summary: input.syncSummary,
        probes: input.syncStatusProbes,
      },
      runtimeMetrics: input.runtimeMetrics,
      renderServerFailedEventIds: input.render.events
        .map((event) => event.id)
        .filter(Boolean),
      renderServerFailedEvents: input.render.events,
      renderEventsFetchError: input.render.error,
      renderEventsLookbackMinutes: input.eventLookbackMinutes,
    },
  };
}

async function dispatchPaging(payload, config) {
  if (config.dryRun) {
    return {
      sent: false,
      mode: "dry-run",
      destination: config.pagingWebhookUrl || config.incidentPath,
      status: null,
    };
  }

  if (!config.pagingWebhookUrl) {
    throw new Error(
      "HEALTH_SLO_PAGING_WEBHOOK_URL is required to page incidents when HEALTH_SLO_DRY_RUN is false.",
    );
  }

  const response = await fetch(config.pagingWebhookUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(config.pagingWebhookToken
        ? { Authorization: `Bearer ${config.pagingWebhookToken}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Paging webhook failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return {
    sent: true,
    mode: "webhook",
    destination: config.pagingWebhookUrl,
    status: response.status,
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(readRequiredEnv("APP_BASE_URL"));
  const healthcheckPath = normalizePath(
    readOptionalEnv("HEALTH_SLO_HEALTHCHECK_PATH"),
    "/api/healthz",
  );
  const healthPayloadPath = normalizePath(
    readOptionalEnv("HEALTH_SLO_HEALTH_PAYLOAD_PATH"),
    "/api/health",
  );
  const syncStatusPath = normalizePath(
    readOptionalEnv("HEALTH_SLO_SYNC_STATUS_PATH"),
    "/api/sync/status",
  );
  const runtimeMetricsPath = normalizePath(
    readOptionalEnv("HEALTH_SLO_RUNTIME_METRICS_PATH"),
    "/api/runtime/health-slo",
  );
  const timeoutMs = readBoundedInteger("HEALTH_SLO_TIMEOUT_MS", 3000, 250, 60_000);
  const probeAttempts = readBoundedInteger("HEALTH_SLO_PROBE_ATTEMPTS", 3, 1, 20);
  const timeoutThreshold = readBoundedInteger(
    "HEALTH_SLO_CONSECUTIVE_TIMEOUTS",
    2,
    1,
    probeAttempts,
  );
  const probePauseMs = readBoundedInteger("HEALTH_SLO_PROBE_PAUSE_MS", 1000, 0, 60_000);
  const routeP99ThresholdMs = readBoundedInteger(
    "HEALTH_SLO_ROUTE_P99_THRESHOLD_MS",
    3000,
    100,
    60_000,
  );
  const route5xxThresholdCount = readBoundedInteger(
    "HEALTH_SLO_ROUTE_5XX_THRESHOLD_COUNT",
    1,
    1,
    100,
  );
  const eventLoopP99ThresholdMs = readBoundedInteger(
    "HEALTH_SLO_EVENT_LOOP_P99_THRESHOLD_MS",
    750,
    10,
    60_000,
  );
  const eventLoopMaxThresholdMs = readBoundedInteger(
    "HEALTH_SLO_EVENT_LOOP_MAX_THRESHOLD_MS",
    750,
    10,
    60_000,
  );
  const eventLoopMaxSpikeAgeMs = readBoundedInteger(
    "HEALTH_SLO_EVENT_LOOP_MAX_SPIKE_AGE_MS",
    6 * 60_000,
    1_000,
    60 * 60_000,
  );
  const suppressMaxOnlyEventLoopSpikes = readBoolean(
    "HEALTH_SLO_SUPPRESS_MAX_ONLY_EVENT_LOOP_SPIKES",
    true,
  );
  const requireRuntimeMetrics = readBoolean("HEALTH_SLO_REQUIRE_RUNTIME_METRICS", false);
  const eventLookbackMinutes = readBoundedInteger(
    "HEALTH_SLO_RENDER_EVENT_LOOKBACK_MINUTES",
    30,
    1,
    24 * 60,
  );

  const config = {
    baseUrl,
    healthcheckPath,
    healthPayloadPath,
    syncStatusPath,
    runtimeMetricsPath,
    timeoutMs,
    probeAttempts,
    timeoutThreshold,
    probePauseMs,
    routeP99ThresholdMs,
    route5xxThresholdCount,
    eventLoopP99ThresholdMs,
    eventLoopMaxThresholdMs,
    eventLoopMaxSpikeAgeMs,
    suppressMaxOnlyEventLoopSpikes,
    requireRuntimeMetrics,
    eventLookbackMinutes,
    incidentPath:
      readOptionalEnv("HEALTH_SLO_INCIDENT_PATH") ||
      "CTO + DevOps & SRE Engineer incident path",
    renderServiceId: readOptionalEnv("RENDER_SERVICE_ID"),
    renderApiKey: readOptionalEnv("RENDER_API_KEY"),
    pagingWebhookUrl: readOptionalEnv("HEALTH_SLO_PAGING_WEBHOOK_URL"),
    pagingWebhookToken: readOptionalEnv("HEALTH_SLO_PAGING_WEBHOOK_TOKEN"),
    dryRun: readBoolean("HEALTH_SLO_DRY_RUN", false),
    forceIncident: readBoolean("HEALTH_SLO_FORCE_INCIDENT", false),
  };

  const { healthProbes, healthPayloadProbes, syncStatusProbes } = await runProbeSeries(config);
  const healthSummary = summarizeProbeSeries(healthProbes);
  const syncSummary = summarizeProbeSeries(syncStatusProbes);
  const healthPayloadParity = evaluateHealthPayloadParity(
    healthPayloadProbes,
    syncStatusProbes,
  );
  const maxConsecutiveTimeouts = computeMaxConsecutiveTimeouts(healthProbes);
  const timeoutBreach = maxConsecutiveTimeouts >= config.timeoutThreshold;

  const runtimeMetrics = await fetchRuntimeHealthMetrics(config);
  const render = await fetchRenderServerFailedEvents(config);

  const runtimePayload =
    runtimeMetrics.ok && runtimeMetrics.payload && typeof runtimeMetrics.payload === "object"
      ? runtimeMetrics.payload
      : null;
  const nowMs = Date.now();
  const runtimeLagP99Ms = readNumericMetric(runtimePayload?.lagP99Ms);
  const runtimeLagMaxMs = readNumericMetric(runtimePayload?.lagMaxMs);
  const runtimeLagLastSpikeAtMs = parseIsoMs(runtimePayload?.lagLastSpikeAt);
  const runtimeLagLastSpikeAgeMsRaw = readNullableNumericMetric(runtimePayload?.lagLastSpikeAgeMs);
  const runtimeLagLastSpikeAgeMs =
    runtimeLagLastSpikeAgeMsRaw !== null
      ? Math.max(0, runtimeLagLastSpikeAgeMsRaw)
      : runtimeLagLastSpikeAtMs !== null
        ? Math.max(0, nowMs - runtimeLagLastSpikeAtMs)
        : null;
  const runtimeHealthRoute = runtimePayload?.routes?.healthzGet ?? null;
  const runtimeSyncRoute = runtimePayload?.routes?.syncStatusGet ?? null;
  const healthProbeRouteImpact = isRouteAnomalous(
    healthSummary,
    config.routeP99ThresholdMs,
    config.route5xxThresholdCount,
  );
  const syncProbeRouteImpact = isRouteAnomalous(
    syncSummary,
    config.routeP99ThresholdMs,
    config.route5xxThresholdCount,
  );
  const runtimeHealthRouteImpact = isRouteAnomalous(
    runtimeHealthRoute,
    config.routeP99ThresholdMs,
    config.route5xxThresholdCount,
  );
  const runtimeSyncRouteImpact = isRouteAnomalous(
    runtimeSyncRoute,
    config.routeP99ThresholdMs,
    config.route5xxThresholdCount,
  );
  const priorityRouteImpactDetected =
    timeoutBreach ||
    healthProbeRouteImpact ||
    syncProbeRouteImpact ||
    runtimeHealthRouteImpact ||
    runtimeSyncRouteImpact;

  const reasons = [];
  if (timeoutBreach) {
    reasons.push(
      `consecutive timeout breach on ${config.healthcheckPath}: ${maxConsecutiveTimeouts} >= ${config.timeoutThreshold}`,
    );
  }
  if (healthSummary.p99Ms >= config.routeP99ThresholdMs) {
    reasons.push(`healthz p99 latency ${healthSummary.p99Ms}ms >= ${config.routeP99ThresholdMs}ms`);
  }
  if (healthSummary.status5xxCount >= config.route5xxThresholdCount) {
    reasons.push(
      `healthz 5xx count ${healthSummary.status5xxCount} >= ${config.route5xxThresholdCount}`,
    );
  }
  if (syncSummary.p99Ms >= config.routeP99ThresholdMs) {
    reasons.push(`sync-status p99 latency ${syncSummary.p99Ms}ms >= ${config.routeP99ThresholdMs}ms`);
  }
  if (syncSummary.status5xxCount >= config.route5xxThresholdCount) {
    reasons.push(
      `sync-status 5xx count ${syncSummary.status5xxCount} >= ${config.route5xxThresholdCount}`,
    );
  }
  if (healthPayloadParity.anomalyCount > 0) {
    reasons.push(
      `health payload parity regression detected on ${config.healthPayloadPath} (${healthPayloadParity.anomalyCount}/${healthPayloadParity.checkedSamples} samples)`,
    );
  }
  const eventLoopP99Breached = runtimePayload && runtimeLagP99Ms >= config.eventLoopP99ThresholdMs;
  const eventLoopMaxBreached = runtimePayload && runtimeLagMaxMs >= config.eventLoopMaxThresholdMs;
  const eventLoopMaxRecent =
    eventLoopMaxBreached &&
    runtimeLagLastSpikeAgeMs !== null &&
    runtimeLagLastSpikeAgeMs <= config.eventLoopMaxSpikeAgeMs;
  let maxOnlySpikeSuppressed = false;

  if (eventLoopP99Breached) {
    reasons.push(
      `event-loop lag spike p99=${runtimeLagP99Ms}ms max=${runtimeLagMaxMs}ms (p99 threshold ${config.eventLoopP99ThresholdMs}ms)`,
    );
  } else if (eventLoopMaxRecent) {
    if (config.suppressMaxOnlyEventLoopSpikes && !priorityRouteImpactDetected) {
      maxOnlySpikeSuppressed = true;
    } else {
      reasons.push(
        `event-loop lag max=${runtimeLagMaxMs}ms breached threshold ${config.eventLoopMaxThresholdMs}ms within ${Math.round(
          runtimeLagLastSpikeAgeMs,
        )}ms`,
      );
    }
  } else if (eventLoopMaxBreached && runtimeLagLastSpikeAgeMs === null) {
    if (config.suppressMaxOnlyEventLoopSpikes && !priorityRouteImpactDetected) {
      maxOnlySpikeSuppressed = true;
    } else {
      reasons.push(
        `event-loop lag max=${runtimeLagMaxMs}ms breached threshold ${config.eventLoopMaxThresholdMs}ms (spike timestamp unavailable)`,
      );
    }
  }
  if (
    runtimeHealthRouteImpact
  ) {
    reasons.push("runtime tail anomaly detected on GET /api/healthz");
  }
  if (
    runtimeSyncRouteImpact
  ) {
    reasons.push("runtime tail anomaly detected on GET /api/sync/status");
  }
  if (!runtimeMetrics.ok && config.requireRuntimeMetrics) {
    reasons.push(`runtime metrics unavailable: ${runtimeMetrics.error}`);
  }

  const incidentDetected = reasons.length > 0 || config.forceIncident;

  const healthySummary = {
    source: "health-slo-watchdog",
    timestamp: new Date().toISOString(),
    productionTarget: config.baseUrl,
    timeoutMs: config.timeoutMs,
    probeAttempts: config.probeAttempts,
    timeoutThreshold: config.timeoutThreshold,
    maxConsecutiveTimeouts,
    healthz: healthSummary,
    healthPayload: {
      path: config.healthPayloadPath,
      checkedSamples: healthPayloadParity.checkedSamples,
      anomalyCount: healthPayloadParity.anomalyCount,
      anomalies: healthPayloadParity.anomalies.slice(0, 3),
      healthPayloadShapeHashes: healthPayloadParity.healthPayloadShapeHashes,
      syncPayloadShapeHashes: healthPayloadParity.syncPayloadShapeHashes,
    },
    syncStatus: syncSummary,
    runtime: {
      endpoint: runtimeMetrics.endpoint,
      ok: runtimeMetrics.ok,
      lagP99Ms: runtimeLagP99Ms,
      lagMaxMs: runtimeLagMaxMs,
      lagLastSpikeAt: runtimeLagLastSpikeAtMs ? new Date(runtimeLagLastSpikeAtMs).toISOString() : null,
      lagLastSpikeAgeMs: runtimeLagLastSpikeAgeMs,
      lagMaxSpikeAgeThresholdMs: config.eventLoopMaxSpikeAgeMs,
      suppressMaxOnlyEventLoopSpikes: config.suppressMaxOnlyEventLoopSpikes,
      priorityRouteImpactDetected,
      maxOnlySpikeSuppressed,
    },
    renderServerFailedEvents: render.events.length,
  };

  if (!incidentDetected) {
    console.log("[health-slo-watchdog] healthy", JSON.stringify(healthySummary));
    return;
  }

  const payload = buildIncidentPayload({
    baseUrl: config.baseUrl,
    incidentPath: config.incidentPath,
    timeoutMs: config.timeoutMs,
    timeoutThreshold: config.timeoutThreshold,
    probeAttempts: config.probeAttempts,
    probePauseMs: config.probePauseMs,
    healthcheckPath: config.healthcheckPath,
    healthPayloadPath: config.healthPayloadPath,
    syncStatusPath: config.syncStatusPath,
    routeP99ThresholdMs: config.routeP99ThresholdMs,
    route5xxThresholdCount: config.route5xxThresholdCount,
    eventLoopP99ThresholdMs: config.eventLoopP99ThresholdMs,
    eventLoopMaxThresholdMs: config.eventLoopMaxThresholdMs,
    eventLoopMaxSpikeAgeMs: config.eventLoopMaxSpikeAgeMs,
    eventLookbackMinutes: config.eventLookbackMinutes,
    timeoutBreach,
    maxConsecutiveTimeouts,
    reasons,
    healthSummary,
    healthPayloadParity,
    syncSummary,
    healthProbes,
    healthPayloadProbes,
    syncStatusProbes,
    runtimeMetrics,
    render,
    forceIncident: config.forceIncident,
  });

  const pagingResult = await dispatchPaging(payload, config);
  console.log(
    "[health-slo-watchdog] incident",
    JSON.stringify({
      forceIncident: config.forceIncident,
      reasons,
      pagingResult,
      payload,
    }),
  );
}

main().catch((error) => {
  console.error("[trigger-health-slo-watchdog] failed", {
    error: safeErrorMessage(error),
  });
  process.exitCode = 1;
});
