import "dotenv/config";
import express from "express";
import next from "next";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { app as pricingBookApp, startPricingBookAutoSync } from "./embedded/pricing-book-app/src/index.js";

function normalizeMountPath(value, fallback = "/quotes") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed === "/" ? fallback : prefixed.replace(/\/+$/, "");
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function readFeatureEnabled(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readLocalDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const readPart = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: readPart("year"),
    month: readPart("month"),
    day: readPart("day"),
    hour: readPart("hour"),
    minute: readPart("minute"),
  };
}

function formatLocalDateKey(date, timeZone) {
  const parts = readLocalDateParts(date, timeZone);
  if (!parts.year || !parts.month || !parts.day) {
    return null;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(dateKey, offsetDays, timeZone) {
  const [year, month, day] = String(dateKey)
    .split("-")
    .map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) {
    return null;
  }

  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0));
  return formatLocalDateKey(shifted, timeZone);
}

function toMilliseconds(nanoseconds) {
  const numeric = Number(nanoseconds);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric / 1_000_000;
}

function roundMetric(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function percentileFromSorted(values, percentile) {
  if (values.length === 0) {
    return 0;
  }
  const boundedPercentile = Math.max(0, Math.min(100, percentile));
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil((boundedPercentile / 100) * values.length) - 1),
  );
  return values[index];
}

function normalizeRequestPathForMetrics(pathname) {
  const rawPath = String(pathname || "/").split("?")[0] || "/";
  const normalizedPath = rawPath
    .split("/")
    .map((segment) => {
      if (!segment) {
        return "";
      }
      if (/^\d+$/.test(segment)) {
        return ":id";
      }
      if (/^[0-9a-f]{16,}$/i.test(segment)) {
        return ":id";
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
        return ":id";
      }
      if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) {
        return ":token";
      }
      return segment;
    })
    .join("/");
  return normalizedPath || "/";
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const quotesMountPath = normalizeMountPath(process.env.MBQ_BASE_PATH, "/quotes");

const nextApp = next({
  dev,
  hostname,
  port,
});

await nextApp.prepare();

const handle = nextApp.getRequestHandler();
const server = express();
const startedAt = new Date();
const runtimeStallMonitorEnabled = readFeatureEnabled(
  process.env.RUNTIME_STALL_MONITOR_ENABLED,
  process.env.NODE_ENV === "production",
);
const pricingBookAutoSyncEnabled = readFeatureEnabled(
  process.env.PRICING_BOOK_AUTO_SYNC_ENABLED,
  process.env.NODE_ENV !== "production",
);
const RUNTIME_MONITOR_INTERVAL_MS = readBoundedInteger(
  process.env.RUNTIME_MONITOR_INTERVAL_MS,
  60_000,
  5_000,
  10 * 60_000,
);
const RUNTIME_MONITOR_EVENT_LOOP_RESOLUTION_MS = readBoundedInteger(
  process.env.RUNTIME_MONITOR_EVENT_LOOP_RESOLUTION_MS,
  20,
  5,
  1_000,
);
const RUNTIME_REQUEST_METRICS_WINDOW_MS = readBoundedInteger(
  process.env.RUNTIME_REQUEST_METRICS_WINDOW_MS,
  15 * 60_000,
  60_000,
  60 * 60_000,
);
const RUNTIME_REQUEST_MAX_SAMPLES_PER_ROUTE = readBoundedInteger(
  process.env.RUNTIME_REQUEST_MAX_SAMPLES_PER_ROUTE,
  800,
  100,
  20_000,
);
const RUNTIME_SLOW_REQUEST_WARN_MS = readBoundedInteger(
  process.env.RUNTIME_SLOW_REQUEST_WARN_MS,
  1_500,
  100,
  60_000,
);
const RUNTIME_HEALTHCHECK_WARN_MS = readBoundedInteger(
  process.env.RUNTIME_HEALTHCHECK_WARN_MS,
  4_000,
  100,
  60_000,
);
const RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS = readBoundedInteger(
  process.env.RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS,
  750,
  100,
  60_000,
);
const RUNTIME_BACKGROUND_WORK_COOLDOWN_MS = readBoundedInteger(
  process.env.RUNTIME_BACKGROUND_WORK_COOLDOWN_MS,
  120_000,
  0,
  60 * 60_000,
);
const RUNTIME_BACKGROUND_WORK_MAX_ACTIVE_REQUESTS = readBoundedInteger(
  process.env.RUNTIME_BACKGROUND_WORK_MAX_ACTIVE_REQUESTS,
  40,
  1,
  5_000,
);
const runtimeTailSampleByRoute = new Map();
const runtimeDeferralLogByTask = new Map();
let runtimeActiveRequestCount = 0;
let runtimeLastLagP99Ms = 0;
let runtimeLastLagMaxMs = 0;
let runtimeLastLagSpikeAtMs = 0;
const runtimeEventLoopLagHistogram = runtimeStallMonitorEnabled
  ? monitorEventLoopDelay({ resolution: RUNTIME_MONITOR_EVENT_LOOP_RESOLUTION_MS })
  : null;

if (runtimeEventLoopLagHistogram) {
  runtimeEventLoopLagHistogram.enable();
}

function pruneRuntimeRouteSamples(routeSamples, nowMs) {
  const cutoffMs = nowMs - RUNTIME_REQUEST_METRICS_WINDOW_MS;
  while (routeSamples.length > 0 && routeSamples[0].timestampMs < cutoffMs) {
    routeSamples.shift();
  }

  if (routeSamples.length > RUNTIME_REQUEST_MAX_SAMPLES_PER_ROUTE) {
    routeSamples.splice(0, routeSamples.length - RUNTIME_REQUEST_MAX_SAMPLES_PER_ROUTE);
  }
}

function summarizeRuntimeRoute(routeKey, routeSamples, nowMs) {
  pruneRuntimeRouteSamples(routeSamples, nowMs);
  if (routeSamples.length === 0) {
    return null;
  }

  const durations = routeSamples
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const count = durations.length;
  const p50Ms = roundMetric(percentileFromSorted(durations, 50));
  const p95Ms = roundMetric(percentileFromSorted(durations, 95));
  const p99Ms = roundMetric(percentileFromSorted(durations, 99));
  const maxMs = roundMetric(durations[count - 1] ?? 0);
  const status5xxCount = routeSamples.filter((sample) => sample.statusCode >= 500).length;

  return {
    route: routeKey,
    count,
    p50Ms,
    p95Ms,
    p99Ms,
    maxMs,
    status5xxCount,
  };
}

function collectRuntimeRouteSummaries(nowMs) {
  const routeSummaries = [];
  for (const [routeKey, routeSamples] of runtimeTailSampleByRoute.entries()) {
    const summary = summarizeRuntimeRoute(routeKey, routeSamples, nowMs);
    if (!summary) {
      runtimeTailSampleByRoute.delete(routeKey);
      continue;
    }

    routeSummaries.push(summary);
  }

  return routeSummaries;
}

function shouldDeferBackgroundWork(taskName) {
  if (!runtimeStallMonitorEnabled) {
    return false;
  }

  const nowMs = Date.now();
  const lagExceeded =
    runtimeLastLagP99Ms >= RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS ||
    runtimeLastLagMaxMs >= RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS;
  if (lagExceeded) {
    runtimeLastLagSpikeAtMs = nowMs;
  }

  const inCooldown =
    runtimeLastLagSpikeAtMs > 0 && nowMs - runtimeLastLagSpikeAtMs < RUNTIME_BACKGROUND_WORK_COOLDOWN_MS;
  const overloaded = runtimeActiveRequestCount >= RUNTIME_BACKGROUND_WORK_MAX_ACTIVE_REQUESTS;

  if (!lagExceeded && !inCooldown && !overloaded) {
    return false;
  }

  const lastLogAtMs = runtimeDeferralLogByTask.get(taskName) ?? 0;
  if (nowMs - lastLogAtMs >= 30_000) {
    runtimeDeferralLogByTask.set(taskName, nowMs);
    console.warn("[runtime-stall] deferring background cycle", {
      task: taskName,
      lagP99Ms: runtimeLastLagP99Ms,
      lagMaxMs: runtimeLastLagMaxMs,
      activeRequests: runtimeActiveRequestCount,
      lagThresholdMs: RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS,
      requestThreshold: RUNTIME_BACKGROUND_WORK_MAX_ACTIVE_REQUESTS,
      cooldownRemainingMs:
        runtimeLastLagSpikeAtMs > 0
          ? Math.max(0, RUNTIME_BACKGROUND_WORK_COOLDOWN_MS - (nowMs - runtimeLastLagSpikeAtMs))
          : 0,
    });
  }

  return true;
}

server.disable("x-powered-by");
if (runtimeStallMonitorEnabled) {
  server.use((req, res, next) => {
    const startedAtNs = process.hrtime.bigint();
    const routeKey = `${req.method.toUpperCase()} ${normalizeRequestPathForMetrics(req.path || req.originalUrl || req.url)}`;
    runtimeActiveRequestCount += 1;
    let finalized = false;

    const finalize = () => {
      if (finalized) {
        return;
      }
      finalized = true;

      runtimeActiveRequestCount = Math.max(0, runtimeActiveRequestCount - 1);
      const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
      const nowMs = Date.now();
      const routeSamples = runtimeTailSampleByRoute.get(routeKey) ?? [];
      routeSamples.push({
        timestampMs: nowMs,
        durationMs,
        statusCode: res.statusCode,
      });
      pruneRuntimeRouteSamples(routeSamples, nowMs);
      runtimeTailSampleByRoute.set(routeKey, routeSamples);

      const isHealthRoute = routeKey === "GET /api/healthz" || routeKey === "HEAD /api/healthz";
      if (durationMs >= RUNTIME_SLOW_REQUEST_WARN_MS || (isHealthRoute && durationMs >= RUNTIME_HEALTHCHECK_WARN_MS)) {
        console.warn("[runtime-stall] slow request", {
          route: routeKey,
          statusCode: res.statusCode,
          durationMs: roundMetric(durationMs),
          activeRequests: runtimeActiveRequestCount,
        });
      }
    };

    res.on("finish", finalize);
    res.on("close", finalize);
    next();
  });
}
server.get("/api/healthz", (req, res) => {
  res.status(200).json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
    timestamp: new Date().toISOString(),
  });
});
server.head("/api/healthz", (req, res) => {
  res.status(200).end();
});
server.get("/api/runtime/health-slo", (req, res) => {
  const nowMs = Date.now();
  const routeSummaries = collectRuntimeRouteSummaries(nowMs);
  const routeSummaryMap = Object.fromEntries(
    routeSummaries.map((summary) => [summary.route, summary]),
  );

  res.status(200).json({
    ok: true,
    timestamp: new Date(nowMs).toISOString(),
    monitorEnabled: runtimeStallMonitorEnabled,
    lagP99Ms: runtimeLastLagP99Ms,
    lagMaxMs: runtimeLastLagMaxMs,
    lagAlertThresholdMs: RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS,
    activeRequests: runtimeActiveRequestCount,
    requestWindowSeconds: Math.round(RUNTIME_REQUEST_METRICS_WINDOW_MS / 1000),
    routes: {
      healthzGet: routeSummaryMap["GET /api/healthz"] ?? null,
      healthzHead: routeSummaryMap["HEAD /api/healthz"] ?? null,
      syncStatusGet: routeSummaryMap["GET /api/sync/status"] ?? null,
    },
  });
});
server.use(quotesMountPath, pricingBookApp);
server.all("*", (req, res) => handle(req, res));

if (runtimeStallMonitorEnabled && runtimeEventLoopLagHistogram) {
  const runtimeMonitorTimer = setInterval(() => {
    const nowMs = Date.now();
    const lagP95Ms = roundMetric(toMilliseconds(runtimeEventLoopLagHistogram.percentile(95)));
    const lagP99Ms = roundMetric(toMilliseconds(runtimeEventLoopLagHistogram.percentile(99)));
    const lagMaxMs = roundMetric(toMilliseconds(runtimeEventLoopLagHistogram.max));

    runtimeLastLagP99Ms = lagP99Ms;
    runtimeLastLagMaxMs = lagMaxMs;
    if (
      lagP99Ms >= RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS ||
      lagMaxMs >= RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS
    ) {
      runtimeLastLagSpikeAtMs = nowMs;
    }

    const routeSummaries = collectRuntimeRouteSummaries(nowMs);

    const priorityRoutes = ["GET /api/healthz", "HEAD /api/healthz", "GET /api/sync/status"];
    const prioritySummaries = priorityRoutes
      .map((route) => routeSummaries.find((summary) => summary.route === route))
      .filter(Boolean);
    const hotTailSummaries = routeSummaries
      .filter((summary) => !priorityRoutes.includes(summary.route))
      .sort((left, right) => right.p99Ms - left.p99Ms)
      .slice(0, 3);
    const combinedSummaries = [...prioritySummaries, ...hotTailSummaries];

    const lagLog = {
      lagP95Ms,
      lagP99Ms,
      lagMaxMs,
      activeRequests: runtimeActiveRequestCount,
      sampledRoutes: routeSummaries.length,
      windowSeconds: Math.round(RUNTIME_REQUEST_METRICS_WINDOW_MS / 1000),
    };
    if (
      lagP99Ms >= RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS ||
      lagMaxMs >= RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS
    ) {
      console.warn("[runtime-stall] event-loop", lagLog);
    } else {
      console.log("[runtime-stall] event-loop", lagLog);
    }

    if (combinedSummaries.length > 0) {
      console.log("[runtime-stall] request-tail", {
        windowSeconds: Math.round(RUNTIME_REQUEST_METRICS_WINDOW_MS / 1000),
        routes: combinedSummaries,
      });
    }

    runtimeEventLoopLagHistogram.reset();
  }, RUNTIME_MONITOR_INTERVAL_MS);

  if (typeof runtimeMonitorTimer.unref === "function") {
    runtimeMonitorTimer.unref();
  }
}

server.listen(port, hostname, () => {
  console.log(`sales-meadowb listening on http://${hostname}:${port}`);
  console.log(`embedded pricing-book-app mounted at ${quotesMountPath}`);
  if (pricingBookAutoSyncEnabled) {
    startPricingBookAutoSync(console);
    console.log("[pricing-book-auto-sync] enabled");
  } else {
    console.log("[pricing-book-auto-sync] disabled on this runtime");
  }
  if (runtimeStallMonitorEnabled) {
    console.log(
      `[runtime-stall] monitor started; interval ${Math.round(RUNTIME_MONITOR_INTERVAL_MS / 1000)}s; lag defer ${RUNTIME_BACKGROUND_WORK_LAG_DEFER_MS}ms; request slow warn ${RUNTIME_SLOW_REQUEST_WARN_MS}ms`,
    );
  }

  const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
  let watchdogInFlight = false;
  setInterval(async () => {
    if (watchdogInFlight) {
      console.warn("[watchdog] previous cycle still running; skipping overlap");
      return;
    }
    if (shouldDeferBackgroundWork("watchdog")) {
      return;
    }

    watchdogInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/watchdog/run`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(process.env.WATCHDOG_SECRET
            ? { "x-watchdog-secret": process.env.WATCHDOG_SECRET }
            : {}),
        },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok && response.status !== 207) {
        console.error("[watchdog] cycle request failed", {
          status: response.status,
          body: payload,
        });
        return;
      }

      const report = payload && typeof payload === "object" ? payload : null;
      if (!report || !Array.isArray(report.actions)) {
        console.error("[watchdog] cycle returned an invalid payload", payload);
        return;
      }

      if (report.actions.length === 0) {
        console.log(`[watchdog] all clear; checked ${report.checked} jobs in ${report.durationMs}ms`);
        return;
      }

      const fixed = report.actions.filter((a) => a.result === "fixed").length;
      const requeued = report.actions.filter((a) => a.result === "requeued").length;
      const skipped = report.actions.filter((a) => a.result === "skipped").length;
      const failed = report.actions.filter((a) => a.result === "failed").length;

      const parts = [];
      if (fixed > 0) parts.push(`${fixed} fixed`);
      if (requeued > 0) parts.push(`${requeued} requeued`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (failed > 0) parts.push(`${failed} failed`);

      console.log(
        `[watchdog] ${parts.join(", ")}; checked ${report.checked} jobs in ${report.durationMs}ms`,
      );

      for (const action of report.actions) {
        console.log(
          `[watchdog]   ${action.sessionId}: ${action.issue} -> ${action.result} - ${action.detail}`,
        );
      }
    } catch (error) {
      console.error("[watchdog] cycle failed", error);
    } finally {
      clearTimeout(timeoutId);
      watchdogInFlight = false;
    }
  }, WATCHDOG_INTERVAL_MS);
  console.log(`[watchdog] started; checking every ${WATCHDOG_INTERVAL_MS / 1000}s`);

  const dailyCallCoachingEnabled = readFeatureEnabled(
    process.env.DAILY_CALL_COACHING_ENABLED,
    process.env.NODE_ENV === "production",
  );
  const dailyCallCoachingExternalSchedulerEnabled = readFeatureEnabled(
    process.env.DAILY_CALL_COACHING_EXTERNAL_SCHEDULER_ENABLED,
    false,
  );
  const dailyCallCoachingTimeZone = String(
    process.env.DAILY_CALL_COACHING_TIME_ZONE || "America/Toronto",
  ).trim();
  const dailyCallCoachingScheduleHour = readBoundedInteger(
    process.env.DAILY_CALL_COACHING_SCHEDULE_HOUR,
    7,
    0,
    23,
  );
  const dailyCallCoachingScheduleMinute = readBoundedInteger(
    process.env.DAILY_CALL_COACHING_SCHEDULE_MINUTE,
    0,
    0,
    59,
  );
  const dailyCallCoachingLookbackDays = readPositiveInteger(
    process.env.DAILY_CALL_COACHING_LOOKBACK_DAYS,
    1,
  );
  const DAILY_CALL_COACHING_INTERVAL_MS = 60 * 1000;
  let lastDailyCallCoachingWindow = null;
  let dailyCallCoachingInFlight = false;

  async function runDailyCallCoachingCycle(trigger) {
    if (!dailyCallCoachingEnabled || dailyCallCoachingInFlight) {
      return;
    }
    if (shouldDeferBackgroundWork(`daily-call-coaching:${trigger}`)) {
      return;
    }

    dailyCallCoachingInFlight = true;
    try {
      const now = new Date();
      const localParts = readLocalDateParts(now, dailyCallCoachingTimeZone);
      const currentDateKey = formatLocalDateKey(now, dailyCallCoachingTimeZone);
      const localHour = Number.parseInt(localParts.hour, 10);
      const localMinute = Number.parseInt(localParts.minute, 10);

      if (!currentDateKey || !Number.isFinite(localHour) || !Number.isFinite(localMinute)) {
        console.error("[daily-call-coaching] unable to resolve local schedule window", {
          timeZone: dailyCallCoachingTimeZone,
        });
        return;
      }

      const beforeSchedule =
        localHour < dailyCallCoachingScheduleHour ||
        (localHour === dailyCallCoachingScheduleHour &&
          localMinute < dailyCallCoachingScheduleMinute);
      if (beforeSchedule || lastDailyCallCoachingWindow === currentDateKey) {
        return;
      }

      const reportDate = shiftDateKey(
        currentDateKey,
        -dailyCallCoachingLookbackDays,
        dailyCallCoachingTimeZone,
      );
      if (!reportDate) {
        console.error("[daily-call-coaching] unable to resolve report date", {
          currentDateKey,
          lookbackDays: dailyCallCoachingLookbackDays,
        });
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/call-coaching/daily/run`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(process.env.DAILY_CALL_COACHING_SECRET
              ? { "x-daily-call-coaching-secret": process.env.DAILY_CALL_COACHING_SECRET }
              : {}),
          },
          body: JSON.stringify({ reportDate }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok && response.status !== 207) {
          console.error("[daily-call-coaching] cycle request failed", {
            trigger,
            reportDate,
            status: response.status,
            body: payload,
          });
          return;
        }

        const report = payload && typeof payload === "object" ? payload : null;
        const items = Array.isArray(report?.items) ? report.items : [];
        const sent = items.filter((item) => item.status === "sent").length;
        const skipped = items.filter((item) => item.status === "skipped").length;
        const failed = items.filter((item) => item.status === "failed").length;
        const coverageComplete = report?.dataCoverage?.complete === true;
        const coverageStatus =
          report?.dataCoverage && typeof report.dataCoverage.status === "string"
            ? report.dataCoverage.status
            : "unknown";
        const coverageDetail =
          report?.dataCoverage && typeof report.dataCoverage.detail === "string"
            ? report.dataCoverage.detail
            : "Call import coverage was not confirmed.";

        console.log(
          `[daily-call-coaching] ${trigger}; report ${reportDate}; ${sent} sent, ${skipped} skipped, ${failed} failed; coverage ${coverageComplete ? coverageStatus : `blocked:${coverageStatus}`}`,
        );

        for (const item of items) {
          console.log(
            `[daily-call-coaching]   ${item.subjectLoginName}: ${item.status} - ${item.detail}`,
          );
        }

        if (!coverageComplete) {
          console.warn("[daily-call-coaching] waiting for full call import coverage", {
            trigger,
            reportDate,
            status: coverageStatus,
            detail: coverageDetail,
            snapshotLastRecentSyncAt: report?.dataCoverage?.snapshotLastRecentSyncAt ?? null,
            snapshotLatestSeenStartTime: report?.dataCoverage?.snapshotLatestSeenStartTime ?? null,
            snapshotLastError: report?.dataCoverage?.snapshotLastError ?? null,
            confirmedThroughDate: report?.dataCoverage?.confirmedThroughDate ?? null,
            staleDays: report?.dataCoverage?.staleDays ?? null,
            remainingCallSyncCount: report?.dataCoverage?.remainingCallSyncCount ?? null,
          });
          return;
        }

        if (failed === 0) {
          lastDailyCallCoachingWindow = currentDateKey;
        }
      } catch (error) {
        console.error("[daily-call-coaching] cycle failed", {
          trigger,
          reportDate,
          error,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } finally {
      dailyCallCoachingInFlight = false;
    }
  }

  if (dailyCallCoachingEnabled && !dailyCallCoachingExternalSchedulerEnabled) {
    const minuteAlignedDelayMs = 60_000 - (Date.now() % 60_000);
    setTimeout(() => {
      void runDailyCallCoachingCycle("startup");
      setInterval(() => {
        void runDailyCallCoachingCycle("interval");
      }, DAILY_CALL_COACHING_INTERVAL_MS);
    }, minuteAlignedDelayMs);
    console.log(
      `[daily-call-coaching] started; daily schedule ${String(dailyCallCoachingScheduleHour).padStart(2, "0")}:${String(dailyCallCoachingScheduleMinute).padStart(2, "0")} ${dailyCallCoachingTimeZone}; lookback ${dailyCallCoachingLookbackDays} day(s)`,
    );
  } else if (dailyCallCoachingEnabled) {
    console.log("[daily-call-coaching] external scheduler enabled; in-process scheduler disabled", {
      raw: process.env.DAILY_CALL_COACHING_EXTERNAL_SCHEDULER_ENABLED ?? null,
    });
  } else {
    console.log("[daily-call-coaching] disabled", {
      raw: process.env.DAILY_CALL_COACHING_ENABLED ?? null,
    });
  }

  const callActivitySyncEnabled = readFeatureEnabled(
    process.env.CALL_ACTIVITY_SYNC_ENABLED,
    process.env.NODE_ENV === "production",
  );
  const callActivitySyncTimeZone = String(
    process.env.CALL_ACTIVITY_SYNC_TIME_ZONE || "America/Toronto",
  ).trim();
  const callActivitySyncScheduleHour = readBoundedInteger(
    process.env.CALL_ACTIVITY_SYNC_SCHEDULE_HOUR,
    17,
    0,
    23,
  );
  const callActivitySyncScheduleMinute = readBoundedInteger(
    process.env.CALL_ACTIVITY_SYNC_SCHEDULE_MINUTE,
    0,
    0,
    59,
  );
  const callActivitySyncMaxBatchesPerWindow = readBoundedInteger(
    process.env.CALL_ACTIVITY_SYNC_MAX_BATCHES_PER_WINDOW,
    20,
    1,
    500,
  );
  const CALL_ACTIVITY_SYNC_REFRESH_MIN_INTERVAL_MS = readBoundedInteger(
    process.env.CALL_ACTIVITY_SYNC_REFRESH_MIN_INTERVAL_MS,
    10 * 60_000,
    60_000,
    60 * 60_000,
  );
  const callActivitySyncUsesScheduledWindow =
    process.env.CALL_ACTIVITY_SYNC_SCHEDULE_HOUR !== undefined ||
    process.env.CALL_ACTIVITY_SYNC_SCHEDULE_MINUTE !== undefined ||
    process.env.CALL_ACTIVITY_SYNC_TIME_ZONE !== undefined ||
    process.env.CALL_ACTIVITY_SYNC_MAX_BATCHES_PER_WINDOW !== undefined;
  const callActivitySyncExternalSchedulerEnabled = readFeatureEnabled(
    process.env.CALL_ACTIVITY_SYNC_EXTERNAL_SCHEDULER_ENABLED,
    false,
  );
  const CALL_ACTIVITY_SYNC_INTERVAL_MS = readBoundedInteger(
    process.env.CALL_ACTIVITY_SYNC_INTERVAL_MS,
    30_000,
    5_000,
    5 * 60_000,
  );
  const CALL_ACTIVITY_SYNC_SCHEDULE_CHECK_INTERVAL_MS = 60_000;
  const CALL_ACTIVITY_SYNC_BATCH_SIZE = readBoundedInteger(
    process.env.CALL_ACTIVITY_SYNC_BATCH_SIZE,
    2,
    1,
    25,
  );
  const CALL_ACTIVITY_SYNC_TIMEOUT_MS = readBoundedInteger(
    process.env.CALL_ACTIVITY_SYNC_TIMEOUT_MS,
    55_000,
    5_000,
    5 * 60_000,
  );
  let callActivitySyncInFlight = false;
  let lastCallActivitySyncWindow = null;
  let activeCallActivitySyncDateKey = null;
  let lastCallActivityRefreshAtMs = 0;

  async function runCallAnalyticsRefresh(trigger) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CALL_ACTIVITY_SYNC_TIMEOUT_MS);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/calls/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(process.env.CALL_ACTIVITY_SYNC_SECRET
            ? { "x-call-activity-sync-secret": process.env.CALL_ACTIVITY_SYNC_SECRET }
            : {}),
        },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("[call-activity-sync] refresh request failed", {
          trigger,
          status: response.status,
          body: payload,
        });
        return false;
      }

      console.log("[call-activity-sync] refresh completed", {
        trigger,
        status: payload?.importState?.status ?? null,
        latestSeenStartTime: payload?.importState?.latestSeenStartTime ?? null,
        lastRecentSyncAt: payload?.importState?.lastRecentSyncAt ?? null,
      });
      return true;
    } catch (error) {
      console.error("[call-activity-sync] refresh failed", {
        trigger,
        error,
      });
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function runCallActivitySyncBatch(trigger, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CALL_ACTIVITY_SYNC_TIMEOUT_MS);

    try {
      const params = new URLSearchParams({
        limit: String(CALL_ACTIVITY_SYNC_BATCH_SIZE),
      });
      if (options.dateKey) {
        params.set("dateKey", options.dateKey);
      }
      if (options.timeZone) {
        params.set("timeZone", options.timeZone);
      }
      const response = await fetch(
        `http://127.0.0.1:${port}/api/dashboard/calls/postcall/run-due?${params.toString()}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            ...(process.env.CALL_ACTIVITY_SYNC_SECRET
              ? { "x-call-activity-sync-secret": process.env.CALL_ACTIVITY_SYNC_SECRET }
              : {}),
          },
          signal: controller.signal,
        },
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("[call-activity-sync] worker request failed", {
          trigger,
          status: response.status,
          body: payload,
        });
        return null;
      }

      const processed = payload?.processedCount ?? 0;
      const synced = payload?.syncedCount ?? 0;
      const failed = payload?.failedCount ?? 0;
      const skipped = payload?.skippedCount ?? 0;
      console.log(
        `[call-activity-sync] worker ${trigger}; processed ${processed} (synced ${synced}, failed ${failed}, skipped ${skipped})`,
      );
      return {
        processedCount: processed,
        syncedCount: synced,
        failedCount: failed,
        skippedCount: skipped,
      };
    } catch (error) {
      console.error("[call-activity-sync] worker failed", {
        trigger,
        error,
      });
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function runScheduledCallActivitySyncCycle(trigger) {
    if (!callActivitySyncEnabled || callActivitySyncInFlight) {
      return;
    }
    if (shouldDeferBackgroundWork(`call-activity-sync:${trigger}`)) {
      return;
    }

    const now = new Date();
    const localParts = readLocalDateParts(now, callActivitySyncTimeZone);
    const currentDateKey = formatLocalDateKey(now, callActivitySyncTimeZone);
    const localHour = Number.parseInt(localParts.hour, 10);
    const localMinute = Number.parseInt(localParts.minute, 10);

    if (!currentDateKey || !Number.isFinite(localHour) || !Number.isFinite(localMinute)) {
      console.error("[call-activity-sync] unable to resolve local schedule window", {
        timeZone: callActivitySyncTimeZone,
      });
      return;
    }

    const beforeSchedule =
      localHour < callActivitySyncScheduleHour ||
      (localHour === callActivitySyncScheduleHour &&
        localMinute < callActivitySyncScheduleMinute);
    const previousDateKey = shiftDateKey(currentDateKey, -1, callActivitySyncTimeZone);
    const targetDateKey =
      activeCallActivitySyncDateKey ||
      (!beforeSchedule && lastCallActivitySyncWindow !== currentDateKey
        ? currentDateKey
        : beforeSchedule && previousDateKey && lastCallActivitySyncWindow !== previousDateKey
          ? previousDateKey
          : null);

    if (!targetDateKey) {
      return;
    }

    callActivitySyncInFlight = true;

    try {
      const nowMs = Date.now();
      const continuingActiveTarget = activeCallActivitySyncDateKey === targetDateKey;
      if (
        !continuingActiveTarget ||
        nowMs - lastCallActivityRefreshAtMs >= CALL_ACTIVITY_SYNC_REFRESH_MIN_INTERVAL_MS
      ) {
        await runCallAnalyticsRefresh(`${trigger}:refresh:${targetDateKey}`);
        lastCallActivityRefreshAtMs = nowMs;
      }

      let processedCount = 0;
      let syncedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let remainingCount = 0;
      let batchCount = 0;
      let executedBatches = 0;
      let sawResult = false;
      let batchFailed = false;

      for (; batchCount < callActivitySyncMaxBatchesPerWindow; batchCount += 1) {
        if (batchCount > 0 && shouldDeferBackgroundWork(`call-activity-sync:${trigger}:catchup`)) {
          break;
        }

        executedBatches += 1;
        const result = await runCallActivitySyncBatch(`${trigger}:batch-${batchCount + 1}`, {
          dateKey: targetDateKey,
          timeZone: callActivitySyncTimeZone,
        });
        if (!result) {
          batchFailed = true;
          break;
        }

        sawResult = true;
        processedCount += result.processedCount;
        syncedCount += result.syncedCount;
        failedCount += result.failedCount;
        skippedCount += result.skippedCount;
        remainingCount = result.remainingCount ?? 0;

        if (result.completed || result.processedCount < CALL_ACTIVITY_SYNC_BATCH_SIZE) {
          break;
        }
      }

      if (sawResult && !batchFailed && remainingCount === 0) {
        console.log(
          `[call-activity-sync] scheduled ${trigger}; date ${targetDateKey}; complete after ${executedBatches} batch(es) (processed ${processedCount}, synced ${syncedCount}, failed ${failedCount}, skipped ${skippedCount})`,
        );
        lastCallActivitySyncWindow = targetDateKey;
        activeCallActivitySyncDateKey = null;
      } else {
        console.log(
          `[call-activity-sync] scheduled ${trigger}; date ${targetDateKey}; remaining ${remainingCount} after ${executedBatches} batch(es) (processed ${processedCount}, synced ${syncedCount}, failed ${failedCount}, skipped ${skippedCount}); will retry next minute`,
        );
        activeCallActivitySyncDateKey = targetDateKey;
      }
    } finally {
      callActivitySyncInFlight = false;
    }
  }

  async function runIntervalCallActivitySyncCycle(trigger) {
    if (!callActivitySyncEnabled || callActivitySyncInFlight) {
      return;
    }
    if (shouldDeferBackgroundWork(`call-activity-sync:${trigger}`)) {
      return;
    }

    callActivitySyncInFlight = true;
    try {
      await runCallActivitySyncBatch(trigger);
    } finally {
      callActivitySyncInFlight = false;
    }
  }

  if (callActivitySyncEnabled && !callActivitySyncExternalSchedulerEnabled) {
    if (callActivitySyncUsesScheduledWindow) {
      const minuteAlignedDelayMs = 60_000 - (Date.now() % 60_000);
      setTimeout(() => {
        void runScheduledCallActivitySyncCycle("startup");
        setInterval(() => {
          void runScheduledCallActivitySyncCycle("interval");
        }, CALL_ACTIVITY_SYNC_SCHEDULE_CHECK_INTERVAL_MS);
      }, minuteAlignedDelayMs);
      console.log(
        `[call-activity-sync] worker started; daily schedule ${String(callActivitySyncScheduleHour).padStart(2, "0")}:${String(callActivitySyncScheduleMinute).padStart(2, "0")} ${callActivitySyncTimeZone}; batch ${CALL_ACTIVITY_SYNC_BATCH_SIZE}; max batches ${callActivitySyncMaxBatchesPerWindow}; refresh every ${Math.round(CALL_ACTIVITY_SYNC_REFRESH_MIN_INTERVAL_MS / 1000)}s while catching up; retries every ${Math.round(CALL_ACTIVITY_SYNC_SCHEDULE_CHECK_INTERVAL_MS / 1000)}s until complete`,
      );
    } else {
      const initialDelayMs = 10_000;
      setTimeout(() => {
        void runIntervalCallActivitySyncCycle("startup");
        setInterval(() => {
          void runIntervalCallActivitySyncCycle("interval");
        }, CALL_ACTIVITY_SYNC_INTERVAL_MS);
      }, initialDelayMs);
      console.log(
        `[call-activity-sync] worker started; every ${Math.round(CALL_ACTIVITY_SYNC_INTERVAL_MS / 1000)}s, batch ${CALL_ACTIVITY_SYNC_BATCH_SIZE}`,
      );
    }
  } else if (callActivitySyncEnabled) {
    console.log("[call-activity-sync] external scheduler enabled; in-process worker disabled", {
      raw: process.env.CALL_ACTIVITY_SYNC_EXTERNAL_SCHEDULER_ENABLED ?? null,
    });
  } else {
    console.log("[call-activity-sync] worker disabled");
  }
});
