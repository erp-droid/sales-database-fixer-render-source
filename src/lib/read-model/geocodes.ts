import { geocodeAddress } from "@/lib/geocode";
import { getReadModelDb } from "@/lib/read-model/db";
import type { BusinessAccountRow } from "@/types/business-account";

type ReadyGeocode = {
  latitude: number;
  longitude: number;
  provider: "nominatim" | "arcgis";
};

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function buildAddressKeyFromRow(row: BusinessAccountRow): string {
  return [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((part) => normalizeText(part))
    .join("|");
}

export function queueGeocodesForRows(rows: BusinessAccountRow[]): number {
  const db = getReadModelDb();
  const now = new Date().toISOString();
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
    ON CONFLICT(address_key) DO UPDATE SET
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      city = excluded.city,
      state = excluded.state,
      postal_code = excluded.postal_code,
      country = excluded.country,
      updated_at = excluded.updated_at
    `,
  );

  let count = 0;
  for (const row of rows) {
    if (!row.addressLine1.trim() || !row.city.trim()) {
      continue;
    }

    const result = insert.run(
      buildAddressKeyFromRow(row),
      row.addressLine1,
      row.addressLine2,
      row.city,
      row.state,
      row.postalCode,
      row.country,
      now,
    );
    count += Number(result.changes > 0);
  }

  return count;
}

export function readReadyGeocodeMap(addressKeys: string[]): Map<string, ReadyGeocode> {
  const uniqueKeys = [...new Set(addressKeys.map((key) => key.trim()).filter(Boolean))];
  if (uniqueKeys.length === 0) {
    return new Map();
  }

  const db = getReadModelDb();
  const placeholders = uniqueKeys.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT address_key, latitude, longitude, provider
      FROM address_geocodes
      WHERE address_key IN (${placeholders})
        AND status = 'ready'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      `,
    )
    .all(...uniqueKeys) as Array<{
    address_key: string;
    latitude: number;
    longitude: number;
    provider: "nominatim" | "arcgis";
  }>;

  return new Map(
    rows.map((row) => [
      row.address_key,
      {
        latitude: row.latitude,
        longitude: row.longitude,
        provider: row.provider,
      },
    ]),
  );
}

export async function geocodePendingAddresses(limit: number = 150): Promise<number> {
  const db = getReadModelDb();
  const pending = db
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
      ORDER BY updated_at ASC
      LIMIT ?
      `,
    )
    .all(limit) as Array<{
    address_key: string;
    address_line1: string;
    address_line2: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    attempt_count: number;
  }>;

  if (pending.length === 0) {
    return 0;
  }

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

  let processed = 0;
  for (const item of pending) {
    const attemptedAt = new Date().toISOString();
    const nextAttemptCount = item.attempt_count + 1;
    try {
      const result = await geocodeAddress({
        addressLine1: item.address_line1,
        addressLine2: item.address_line2,
        city: item.city,
        state: item.state,
        postalCode: item.postal_code,
        country: item.country,
      });

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
      } else {
        markFailed.run(nextAttemptCount, attemptedAt, attemptedAt, item.address_key);
      }
    } catch {
      markFailed.run(nextAttemptCount, attemptedAt, attemptedAt, item.address_key);
    }
    processed += 1;
  }

  return processed;
}
