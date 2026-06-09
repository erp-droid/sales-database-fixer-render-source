import { queryBusinessAccounts } from "@/lib/business-accounts";
import { invalidateReadModelCaches } from "@/lib/read-model/cache";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { getReadModelDb } from "@/lib/read-model/db";
import {
  buildAddressKeyFromRow,
  geocodePendingAddresses,
  queueGeocodesForRows,
} from "@/lib/read-model/geocodes";
import type { BusinessAccountRow } from "@/types/business-account";

type GeocodeCoverage = {
  total: number;
  ready: number;
  missing: number;
  pending: number;
  failed: number;
  otherNotReady: number;
  notReady: number;
};

export type GeocodeBackfillResult = {
  accountRows: number;
  distinctMappableAddresses: number;
  before: GeocodeCoverage;
  queueStats: {
    insertedOrUpdated: number;
    retriedFailed: number;
  };
  processed: number;
  after: GeocodeCoverage;
  done: boolean;
};

type GeocodeBackfillOptions = {
  limit: number;
  retryFailed: boolean;
  maxAttempts: number;
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMappableAddressRow(row: BusinessAccountRow): boolean {
  return hasText(row.addressLine1) && hasText(row.city);
}

function readDistinctMappableRows(): BusinessAccountRow[] {
  const rows = queryBusinessAccounts(readAllAccountRowsFromReadModel(), {
    includeInternalRows: true,
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER,
  }).items;
  const byAddressKey = new Map<string, BusinessAccountRow>();

  for (const row of rows) {
    if (!isMappableAddressRow(row)) {
      continue;
    }

    const key = buildAddressKeyFromRow(row);
    if (key && !byAddressKey.has(key)) {
      byAddressKey.set(key, row);
    }
  }

  return [...byAddressKey.values()];
}

function readGeocodeRows(addressKeys: string[]) {
  const uniqueKeys = [...new Set(addressKeys.map((key) => key.trim()).filter(Boolean))];
  const db = getReadModelDb();
  const rows: Array<{
    address_key: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
  }> = [];
  const chunkSize = 750;

  for (let index = 0; index < uniqueKeys.length; index += chunkSize) {
    const chunk = uniqueKeys.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    rows.push(
      ...(db
        .prepare(
          `
          SELECT address_key, status, latitude, longitude
          FROM address_geocodes
          WHERE address_key IN (${placeholders})
          `,
        )
        .all(...chunk) as Array<{
        address_key: string;
        status: string;
        latitude: number | null;
        longitude: number | null;
      }>),
    );
  }

  return new Map(rows.map((row) => [row.address_key, row]));
}

function summarizeCoverage(rows: BusinessAccountRow[]): GeocodeCoverage {
  const geocodeRows = readGeocodeRows(rows.map((row) => buildAddressKeyFromRow(row)));
  const summary: GeocodeCoverage = {
    total: rows.length,
    ready: 0,
    missing: 0,
    pending: 0,
    failed: 0,
    otherNotReady: 0,
    notReady: 0,
  };

  for (const row of rows) {
    const geocode = geocodeRows.get(buildAddressKeyFromRow(row));
    if (!geocode) {
      summary.missing += 1;
      continue;
    }

    const ready =
      geocode.status === "ready" &&
      Number.isFinite(Number(geocode.latitude)) &&
      Number.isFinite(Number(geocode.longitude));
    if (ready) {
      summary.ready += 1;
      continue;
    }

    if (geocode.status === "pending") {
      summary.pending += 1;
    } else if (geocode.status === "failed") {
      summary.failed += 1;
    } else {
      summary.otherNotReady += 1;
    }
  }

  summary.notReady = summary.total - summary.ready;
  return summary;
}

function retryFailedGeocodes(rows: BusinessAccountRow[], maxAttempts: number): number {
  const addressKeys = [...new Set(rows.map((row) => buildAddressKeyFromRow(row)))];
  if (addressKeys.length === 0) {
    return 0;
  }

  const db = getReadModelDb();
  let updated = 0;
  const chunkSize = 750;
  for (let index = 0; index < addressKeys.length; index += chunkSize) {
    const chunk = addressKeys.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = db
      .prepare(
        `
        UPDATE address_geocodes
        SET status = 'pending',
            latitude = NULL,
            longitude = NULL,
            provider = NULL,
            updated_at = ?
        WHERE status = 'failed'
          AND attempt_count < ?
          AND address_key IN (${placeholders})
        `,
      )
      .run(new Date().toISOString(), maxAttempts, ...chunk);
    updated += Number(result.changes);
  }

  return updated;
}

export async function runGeocodeBackfillBatch(
  options: GeocodeBackfillOptions,
): Promise<GeocodeBackfillResult> {
  const mappableRows = readDistinctMappableRows();
  const before = summarizeCoverage(mappableRows);
  const insertedOrUpdated = queueGeocodesForRows(mappableRows);
  const retriedFailed = options.retryFailed
    ? retryFailedGeocodes(mappableRows, options.maxAttempts)
    : 0;
  const processed = await geocodePendingAddresses(options.limit);
  const after = summarizeCoverage(mappableRows);

  if (insertedOrUpdated > 0 || retriedFailed > 0 || processed > 0) {
    invalidateReadModelCaches();
  }

  return {
    accountRows: readAllAccountRowsFromReadModel().length,
    distinctMappableAddresses: mappableRows.length,
    before,
    queueStats: {
      insertedOrUpdated,
      retriedFailed,
    },
    processed,
    after,
    done: after.notReady === 0 || (processed === 0 && after.pending === 0),
  };
}
