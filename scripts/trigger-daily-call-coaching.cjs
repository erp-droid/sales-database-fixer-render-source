#!/usr/bin/env node

function readEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when provided.`);
  }

  return parsed;
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

async function runScheduledDailyCallCoaching(endpoint, secret, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-daily-call-coaching-secret": secret,
      },
      signal: controller.signal,
    });

    const body = await response.text();
    if (!response.ok) {
      const error = new Error(
        `Scheduled daily coaching failed (${response.status}): ${body || "Unknown error"}`,
      );
      error.retryable = response.status >= 500 || response.status === 429 || response.status === 408;
      throw error;
    }

    console.log(body);
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Scheduled daily coaching request timed out after ${timeoutMs}ms`,
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

async function main() {
  const appBaseUrl = readEnv("APP_BASE_URL").replace(/\/$/, "");
  const secret = readEnv("DAILY_CALL_COACHING_SECRET");
  const endpoint = `${appBaseUrl}/api/scheduled/daily-call-coaching/run`;
  const maxAttempts = readPositiveIntegerEnv("DAILY_CALL_COACHING_TRIGGER_MAX_ATTEMPTS", 3);
  const retryDelayMs = readPositiveIntegerEnv("DAILY_CALL_COACHING_TRIGGER_RETRY_DELAY_MS", 15000);
  const timeoutMs = readPositiveIntegerEnv("DAILY_CALL_COACHING_TRIGGER_TIMEOUT_MS", 90000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runScheduledDailyCallCoaching(endpoint, secret, timeoutMs);
      return;
    } catch (error) {
      const retryable = error?.retryable === true;
      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }

      console.warn(
        `[trigger-daily-call-coaching] attempt ${attempt}/${maxAttempts} failed: ${readErrorMessage(error)}; retrying in ${retryDelayMs}ms`,
      );
      await sleep(retryDelayMs);
    }
  }
}

main().catch((error) => {
  console.error("[trigger-daily-call-coaching] failed", error);
  process.exitCode = 1;
});
