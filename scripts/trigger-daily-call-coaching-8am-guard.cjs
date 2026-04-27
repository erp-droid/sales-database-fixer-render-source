#!/usr/bin/env node

function readEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readOptionalEnv(name, fallback) {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

function readBoundedIntegerEnv(name, fallback, min, max) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function readLocalDateParts(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const readPart = (type) => parts.find((part) => part.type === type)?.value ?? "";

  const year = readPart("year");
  const month = readPart("month");
  const day = readPart("day");
  const hour = readPart("hour");
  const minute = readPart("minute");
  const second = readPart("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

function formatLocalDateKey(date, timeZone) {
  const parts = readLocalDateParts(date, timeZone);
  if (!parts) {
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

function isAlreadySentDetail(detail) {
  const normalized = String(detail || "");
  return (
    /Already sent for this date and recipient\./i.test(normalized) ||
    /Already processed for this date and recipient\./i.test(normalized) ||
    /No outbound calls were found for this day\./i.test(normalized)
  );
}

function normalizeRunItems(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  return rawItems.map((item) => ({
    subjectLoginName: String(item?.subjectLoginName || "").trim(),
    recipientEmail: String(item?.recipientEmail || "").trim().toLowerCase(),
    status: String(item?.status || "").trim().toLowerCase(),
    detail: String(item?.detail || ""),
  }));
}

function listMissingLogins(items) {
  const missing = new Set();
  for (const item of items) {
    if (!item.subjectLoginName) {
      continue;
    }

    if (item.status === "sent") {
      continue;
    }

    if (item.status === "skipped" && isAlreadySentDetail(item.detail)) {
      continue;
    }

    missing.add(item.subjectLoginName);
  }

  return Array.from(missing);
}

function readJsonSafely(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function postDailyCallCoachingRun(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const endpoint = `${input.baseUrl}/api/call-coaching/daily/run`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-daily-call-coaching-secret": input.secret,
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = readJsonSafely(text);
    if (!response.ok && response.status !== 207) {
      const error = new Error(
        `Daily coaching API failed (${response.status}): ${text || "Unknown error"}`,
      );
      error.retryable =
        response.status >= 500 || response.status === 429 || response.status === 408;
      throw error;
    }

    return {
      status: response.status,
      payload: payload ?? {},
      rawBody: text,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Daily coaching API request timed out after ${input.timeoutMs}ms`,
      );
      timeoutError.retryable = true;
      throw timeoutError;
    }

    if (!(error instanceof Error)) {
      const wrapped = new Error(readErrorMessage(error));
      wrapped.retryable = true;
      throw wrapped;
    }

    if (typeof error.retryable !== "boolean") {
      error.retryable = true;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWithRetry(input) {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      return await postDailyCallCoachingRun(input);
    } catch (error) {
      const retryable = error?.retryable === true;
      if (!retryable || attempt >= input.maxAttempts) {
        throw error;
      }

      console.warn(
        `[daily-call-coaching-8am-guard] attempt ${attempt}/${input.maxAttempts} failed: ${readErrorMessage(error)}; retrying in ${input.retryDelayMs}ms`,
      );
      await sleep(input.retryDelayMs);
    }
  }

  throw new Error("Guard retry loop exited unexpectedly.");
}

function ensureCoverageComplete(payload) {
  const coverage = payload?.dataCoverage;
  if (!coverage) {
    return;
  }

  if (coverage.complete === true) {
    return;
  }

  throw new Error(
    `Daily coaching coverage is not complete (${coverage.status || "unknown"}): ${coverage.detail || "No detail provided."}`,
  );
}

async function main() {
  const appBaseUrl = readEnv("APP_BASE_URL").replace(/\/$/, "");
  const secret = readEnv("DAILY_CALL_COACHING_SECRET");
  const timeZone = readOptionalEnv("DAILY_CALL_COACHING_TIME_ZONE", "America/Toronto");
  const lookbackDays = readBoundedIntegerEnv("DAILY_CALL_COACHING_LOOKBACK_DAYS", 1, 1, 14);
  const guardHour = readBoundedIntegerEnv("DAILY_CALL_COACHING_GUARD_HOUR", 8, 0, 23);
  const timeoutMs = readBoundedIntegerEnv(
    "DAILY_CALL_COACHING_GUARD_TIMEOUT_MS",
    120000,
    1000,
    600000,
  );
  const maxAttempts = readBoundedIntegerEnv(
    "DAILY_CALL_COACHING_GUARD_MAX_ATTEMPTS",
    3,
    1,
    10,
  );
  const retryDelayMs = readBoundedIntegerEnv(
    "DAILY_CALL_COACHING_GUARD_RETRY_DELAY_MS",
    15000,
    1000,
    300000,
  );

  const now = new Date();
  const localParts = readLocalDateParts(now, timeZone);
  const currentDateKey = formatLocalDateKey(now, timeZone);
  if (!localParts || !currentDateKey) {
    throw new Error(
      `Unable to resolve local date/time for timezone ${timeZone}.`,
    );
  }

  const localHour = Number.parseInt(localParts.hour, 10);
  if (!Number.isFinite(localHour)) {
    throw new Error(
      `Unable to parse local hour (${localParts.hour}) for timezone ${timeZone}.`,
    );
  }

  if (localHour !== guardHour) {
    console.log(
      `[daily-call-coaching-8am-guard] skipped localTime=${localParts.year}-${localParts.month}-${localParts.day}T${localParts.hour}:${localParts.minute}:${localParts.second} timeZone=${timeZone} guardHour=${guardHour}`,
    );
    return;
  }

  const reportDate = shiftDateKey(currentDateKey, -lookbackDays, timeZone);
  if (!reportDate) {
    throw new Error(
      `Unable to resolve report date from ${currentDateKey} with lookback ${lookbackDays}.`,
    );
  }

  const requestConfig = {
    baseUrl: appBaseUrl,
    secret,
    timeoutMs,
    maxAttempts,
    retryDelayMs,
  };

  console.log(
    `[daily-call-coaching-8am-guard] checking reportDate=${reportDate} localDate=${currentDateKey} timeZone=${timeZone}`,
  );

  const initial = await runWithRetry({
    ...requestConfig,
    body: {
      reportDate,
    },
  });
  ensureCoverageComplete(initial.payload);
  const initialItems = normalizeRunItems(initial.payload);
  const initialMissing = listMissingLogins(initialItems);

  if (initialMissing.length === 0) {
    console.log(
      `[daily-call-coaching-8am-guard] healthy reportDate=${reportDate} items=${initialItems.length}`,
    );
    return;
  }

  console.warn(
    `[daily-call-coaching-8am-guard] missing deliveries detected reportDate=${reportDate} loginNames=${initialMissing.join(",")}`,
  );

  for (const loginName of initialMissing) {
    const forced = await runWithRetry({
      ...requestConfig,
      body: {
        reportDate,
        loginName,
        force: true,
      },
    });
    ensureCoverageComplete(forced.payload);
    const forcedItems = normalizeRunItems(forced.payload);
    const forcedItem = forcedItems.find((item) => item.subjectLoginName === loginName) ?? null;
    console.log(
      `[daily-call-coaching-8am-guard] forced login=${loginName} status=${forcedItem?.status || "unknown"} detail=${forcedItem?.detail || "No detail returned."}`,
    );
  }

  const verification = await runWithRetry({
    ...requestConfig,
    body: {
      reportDate,
    },
  });
  ensureCoverageComplete(verification.payload);
  const verificationItems = normalizeRunItems(verification.payload);
  const remainingMissing = listMissingLogins(verificationItems);

  if (remainingMissing.length > 0) {
    throw new Error(
      `Guard completed with unresolved recipients for ${reportDate}: ${remainingMissing.join(",")}.`,
    );
  }

  console.log(
    `[daily-call-coaching-8am-guard] repaired reportDate=${reportDate} forcedCount=${initialMissing.length}`,
  );
}

main().catch((error) => {
  console.error("[daily-call-coaching-8am-guard] failed", error);
  process.exitCode = 1;
});
