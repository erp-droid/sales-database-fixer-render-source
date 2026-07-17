import { cleanString } from "./utils.js";

export const DEFAULT_SIGNATURE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export function shouldRefreshMailboxSignature(connection, options = {}) {
  if (options.force === true) {
    return true;
  }

  const syncedAt = Date.parse(cleanString(connection?.signatureSyncedAt));
  if (!Number.isFinite(syncedAt)) {
    return true;
  }

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const configuredInterval = Number(options.refreshIntervalMs);
  const refreshIntervalMs =
    Number.isFinite(configuredInterval) && configuredInterval >= 0
      ? configuredInterval
      : DEFAULT_SIGNATURE_REFRESH_INTERVAL_MS;

  return now - syncedAt >= refreshIntervalMs;
}
