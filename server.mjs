import "dotenv/config";
import express from "express";
import next from "next";

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

server.disable("x-powered-by");
server.use(quotesMountPath, pricingBookApp);
server.all("*", (req, res) => handle(req, res));

server.listen(port, hostname, () => {
  console.log(`sales-database-fixer listening on http://${hostname}:${port}`);
  console.log(`embedded pricing-book-app mounted at ${quotesMountPath}`);
  startPricingBookAutoSync(console);

  const dailyCallCoachingEnabled =
    process.env.DAILY_CALL_COACHING_ENABLED !== undefined
      ? String(process.env.DAILY_CALL_COACHING_ENABLED).trim().toLowerCase() === "true"
      : process.env.NODE_ENV === "production";
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

  async function runDailyCallCoachingCycle(trigger) {
    if (!dailyCallCoachingEnabled) {
      return;
    }

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

      console.log(
        `[daily-call-coaching] ${trigger}; report ${reportDate}; ${sent} sent, ${skipped} skipped, ${failed} failed`,
      );

      for (const item of items) {
        console.log(
          `[daily-call-coaching]   ${item.subjectLoginName}: ${item.status} - ${item.detail}`,
        );
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
  }

  if (dailyCallCoachingEnabled) {
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
  } else {
    console.log("[daily-call-coaching] disabled");
  }
});
