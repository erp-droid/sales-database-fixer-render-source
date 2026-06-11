/* eslint-disable @typescript-eslint/no-require-imports */
// Shared helpers for route-week admin scripts, extracted from
// apply-justin-region6-list.cjs so new scripts reuse identical
// account reading, geo clustering, and week assignment behavior.

const path = require("node:path");

const WEEK_COUNT = 12;
const DEFAULT_SQLITE_PATH = "/app/data/read-model.sqlite";

function normalizeText(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCategory(value) {
  const normalized = normalizeText(value)?.toUpperCase() ?? null;
  return ["A", "B", "C", "D"].includes(normalized) ? normalized : null;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableExists(db, tableName) {
  return Boolean(
    db
      .prepare(
        `
        SELECT 1 AS found
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
        LIMIT 1
        `,
      )
      .get(tableName),
  );
}

function readTableColumns(db, tableName) {
  if (!tableExists(db, tableName)) {
    return new Set();
  }

  return new Set(
    db
      .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all()
      .map((row) => row.name),
  );
}

function selectExpression(columns, columnName) {
  return columns.has(columnName)
    ? quoteIdentifier(columnName)
    : `NULL AS ${quoteIdentifier(columnName)}`;
}

function parsePayload(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildAddressKey(parts) {
  return [
    parts.addressLine1,
    parts.addressLine2,
    parts.city,
    parts.state,
    parts.postalCode,
    parts.country,
  ]
    .map((part) => String(part ?? "").trim().toLowerCase())
    .join("|");
}

function readSourceTableRows(db, tableName) {
  const columns = readTableColumns(db, tableName);
  if (columns.size === 0) {
    return [];
  }

  const requiredColumns = [
    "row_key",
    "id",
    "account_record_id",
    "business_account_id",
    "company_name",
    "address",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "address_key",
    "sales_rep_id",
    "sales_rep_name",
    "category",
    "week",
    "is_primary_contact",
    "payload_json",
  ];
  const selectColumns = requiredColumns.map((columnName) =>
    columnName === "payload_json" && !columns.has(columnName)
      ? "'{}' AS payload_json"
      : selectExpression(columns, columnName),
  );

  return db
    .prepare(
      `
      SELECT
        '${tableName}' AS source_table,
        ${selectColumns.join(",\n        ")}
      FROM ${quoteIdentifier(tableName)}
      `,
    )
    .all();
}

function readLocalMetadataMap(db) {
  if (!tableExists(db, "account_local_metadata")) {
    return new Map();
  }

  const rows = db
    .prepare(
      `
      SELECT
        account_record_id,
        business_account_id,
        company_description,
        category,
        marketing_eligible
      FROM account_local_metadata
      `,
    )
    .all();
  return new Map(
    rows.flatMap((row) => {
      const accountRecordId = normalizeText(row.account_record_id);
      return accountRecordId
        ? [
            [
              accountRecordId,
              {
                businessAccountId: normalizeText(row.business_account_id),
                companyDescription: normalizeText(row.company_description),
                category: normalizeCategory(row.category),
                marketingEligible: Number(row.marketing_eligible) !== 0,
              },
            ],
          ]
        : [];
    }),
  );
}

function readReadyGeocodeMap(db) {
  if (!tableExists(db, "address_geocodes")) {
    return new Map();
  }

  return new Map(
    db
      .prepare(
        `
        SELECT address_key, latitude, longitude, provider
        FROM address_geocodes
        WHERE status = 'ready'
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
        `,
      )
      .all()
      .map((row) => [row.address_key, row]),
  );
}

function accountKey(row) {
  return (
    normalizeText(row.accountRecordId) ||
    normalizeText(row.id) ||
    normalizeText(row.businessAccountId) ||
    normalizeText(row.companyName)
  );
}

function readAccounts(db) {
  const sourceTables = ["account_rows"];
  if (tableExists(db, "local_account_rows")) {
    sourceTables.push("local_account_rows");
  }

  const localMetadata = readLocalMetadataMap(db);
  const geocodes = readReadyGeocodeMap(db);
  const grouped = new Map();

  for (const row of sourceTables.flatMap((tableName) => readSourceTableRows(db, tableName))) {
    const payload = parsePayload(row.payload_json);
    const addressParts = {
      addressLine1: normalizeText(row.address_line1) || normalizeText(payload?.addressLine1),
      addressLine2: normalizeText(row.address_line2) || normalizeText(payload?.addressLine2),
      city: normalizeText(row.city) || normalizeText(payload?.city),
      state: normalizeText(row.state) || normalizeText(payload?.state),
      postalCode: normalizeText(row.postal_code) || normalizeText(payload?.postalCode),
      country: normalizeText(row.country) || normalizeText(payload?.country),
    };
    const accountRecordId =
      normalizeText(row.account_record_id) ||
      normalizeText(payload?.accountRecordId) ||
      normalizeText(row.id) ||
      normalizeText(payload?.id);
    const businessAccountId =
      normalizeText(row.business_account_id) || normalizeText(payload?.businessAccountId);
    const normalized = {
      sourceTable: row.source_table,
      rowKey: normalizeText(row.row_key),
      id: normalizeText(row.id) || normalizeText(payload?.id),
      accountRecordId,
      businessAccountId,
      companyName: normalizeText(row.company_name) || normalizeText(payload?.companyName),
      address: normalizeText(row.address) || normalizeText(payload?.address),
      addressLine1: addressParts.addressLine1,
      city: addressParts.city,
      state: addressParts.state,
      postalCode: addressParts.postalCode,
      country: addressParts.country,
      addressKey:
        normalizeText(row.address_key) ||
        (addressParts.addressLine1 || addressParts.city || addressParts.postalCode
          ? buildAddressKey(addressParts)
          : null),
      salesRepId: normalizeText(row.sales_rep_id) || normalizeText(payload?.salesRepId),
      salesRepName: normalizeText(row.sales_rep_name) || normalizeText(payload?.salesRepName),
      category: normalizeCategory(row.category) || normalizeCategory(payload?.category),
      week: normalizeText(row.week) || normalizeText(payload?.week),
      isPrimaryContact: Number(row.is_primary_contact) === 1 || payload?.isPrimaryContact === true,
      companyPhone: normalizeText(payload?.companyPhone),
      phoneNumber: normalizeText(payload?.phoneNumber),
      primaryContactPhone: normalizeText(payload?.primaryContactPhone),
      payload,
    };
    const key = accountKey(normalized);
    if (!key) {
      continue;
    }
    const rows = grouped.get(key) || [];
    rows.push(normalized);
    grouped.set(key, rows);
  }

  return [...grouped.values()].flatMap((rows) => {
    rows.sort((left, right) => {
      if (left.sourceTable !== right.sourceTable) {
        return left.sourceTable === "local_account_rows" ? -1 : 1;
      }
      if (left.isPrimaryContact !== right.isPrimaryContact) {
        return left.isPrimaryContact ? -1 : 1;
      }
      return String(left.rowKey ?? "").localeCompare(String(right.rowKey ?? ""));
    });
    const representative =
      rows.find((row) => row.addressKey && geocodes.has(row.addressKey) && row.salesRepName) ||
      rows.find((row) => row.addressKey && geocodes.has(row.addressKey)) ||
      rows.find((row) => row.salesRepName) ||
      rows[0];
    if (!representative?.accountRecordId) {
      return [];
    }

    const metadata = localMetadata.get(representative.accountRecordId);
    const geocode = representative.addressKey ? geocodes.get(representative.addressKey) : null;
    return [
      {
        ...representative,
        category: metadata?.category || representative.category,
        metadata,
        rows,
        latitude: geocode ? Number(geocode.latitude) : null,
        longitude: geocode ? Number(geocode.longitude) : null,
        geocodeProvider: geocode ? normalizeText(geocode.provider) : null,
      },
    ];
  });
}

function mostCommonText(values) {
  const counts = new Map();
  for (const value of values.map(normalizeText).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return (
    [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]?.[0] || null
  );
}

function summarizeAccount(account) {
  return {
    accountRecordId: account.accountRecordId,
    businessAccountId: account.businessAccountId,
    companyName: account.companyName,
    address: account.address,
    city: account.city,
    salesRepName: account.salesRepName,
    category: account.category,
    week: account.week,
    latitude: account.latitude,
    longitude: account.longitude,
  };
}

function hasCoordinate(account) {
  return Number.isFinite(account.latitude) && Number.isFinite(account.longitude);
}

function projectPoints(points) {
  const meanLat =
    points.reduce((sum, point) => sum + point.latitude, 0) / Math.max(points.length, 1);
  const cosLat = Math.max(0.2, Math.cos((meanLat * Math.PI) / 180));
  return points.map((point) => ({
    ...point,
    x: point.longitude * 111.32 * cosLat,
    y: point.latitude * 110.57,
  }));
}

function distanceKm(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function averageCentroid(points) {
  if (points.length === 0) {
    return null;
  }
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function comparePointIdentity(left, right) {
  return String(left.companyName || left.accountRecordId).localeCompare(
    String(right.companyName || right.accountRecordId),
    undefined,
    { sensitivity: "base", numeric: true },
  );
}

function findFarthestPair(points) {
  if (points.length <= 1) {
    return {
      distanceKm: 0,
      accounts: points.length === 1 ? [points[0], points[0]] : [],
    };
  }
  let farthest = {
    distanceKm: 0,
    accounts: [points[0], points[1]],
  };
  for (let leftIndex = 0; leftIndex < points.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const distance = distanceKm(points[leftIndex], points[rightIndex]);
      if (distance > farthest.distanceKm) {
        farthest = {
          distanceKm: distance,
          accounts: [points[leftIndex], points[rightIndex]],
        };
      }
    }
  }
  return farthest;
}

function nearestCenter(point, centers) {
  let nearest = { index: 0, distanceKm: Number.POSITIVE_INFINITY };
  for (let index = 0; index < centers.length; index += 1) {
    const distance = distanceKm(point, centers[index]);
    if (distance < nearest.distanceKm) {
      nearest = { index, distanceKm: distance };
    }
  }
  return nearest;
}

function chooseInitialCenters(points, clusterCount) {
  if (clusterCount <= 1) {
    return [averageCentroid(points) || points[0]];
  }
  const farthestPair = findFarthestPair(points);
  const centers =
    farthestPair.accounts.length >= 2 && farthestPair.distanceKm > 0
      ? [...farthestPair.accounts]
      : [points[0]];
  while (centers.length < clusterCount) {
    let bestPoint = null;
    let bestDistance = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      if (centers.includes(point)) {
        continue;
      }
      const nearest = nearestCenter(point, centers);
      if (
        nearest.distanceKm > bestDistance ||
        (Math.abs(nearest.distanceKm - bestDistance) < 0.000001 &&
          bestPoint &&
          comparePointIdentity(point, bestPoint) < 0)
      ) {
        bestPoint = point;
        bestDistance = nearest.distanceKm;
      }
    }
    if (!bestPoint) {
      break;
    }
    centers.push(bestPoint);
  }
  return centers;
}

function buildBalancedClusterSizes(pointCount, clusterCount) {
  const baseSize = Math.floor(pointCount / clusterCount);
  const extraCount = pointCount % clusterCount;
  return Array.from({ length: clusterCount }, (_, index) =>
    index < extraCount ? baseSize + 1 : baseSize,
  );
}

function allocateCapacitiesToCenters(points, centers) {
  const sizes = buildBalancedClusterSizes(points.length, centers.length).sort((left, right) => right - left);
  const centerDemand = centers.map((center, index) => ({
    index,
    center,
    nearestCount: 0,
    nearestDistanceTotal: 0,
  }));
  for (const point of points) {
    const nearest = nearestCenter(point, centers);
    centerDemand[nearest.index].nearestCount += 1;
    centerDemand[nearest.index].nearestDistanceTotal += nearest.distanceKm;
  }
  const capacities = Array.from({ length: centers.length }, () => 0);
  centerDemand
    .sort((left, right) => {
      const countDelta = right.nearestCount - left.nearestCount;
      if (countDelta !== 0) {
        return countDelta;
      }
      const distanceDelta = right.nearestDistanceTotal - left.nearestDistanceTotal;
      if (Math.abs(distanceDelta) > 0.000001) {
        return distanceDelta;
      }
      return left.index - right.index;
    })
    .forEach((entry, orderIndex) => {
      capacities[entry.index] = sizes[orderIndex] || 0;
    });
  return capacities;
}

function pointCenterRankings(point, centers) {
  return centers
    .map((center, index) => ({ index, distanceKm: distanceKm(point, center) }))
    .sort((left, right) => left.distanceKm - right.distanceKm || left.index - right.index);
}

function assignPointsToCenters(points, centers, capacities) {
  const clusters = centers.map((center, index) => ({
    center,
    targetSize: capacities[index],
    points: [],
  }));
  const remainingCapacities = [...capacities];
  const rankedPoints = [...points]
    .map((point) => {
      const rankings = pointCenterRankings(point, centers);
      const firstDistance = rankings[0]?.distanceKm || 0;
      const secondDistance = rankings[1]?.distanceKm ?? firstDistance;
      return {
        point,
        rankings,
        nearestDistance: firstDistance,
        regretDistance: secondDistance - firstDistance,
      };
    })
    .sort((left, right) => {
      if (Math.abs(right.regretDistance - left.regretDistance) > 0.000001) {
        return right.regretDistance - left.regretDistance;
      }
      if (Math.abs(right.nearestDistance - left.nearestDistance) > 0.000001) {
        return right.nearestDistance - left.nearestDistance;
      }
      return comparePointIdentity(left.point, right.point);
    });
  for (const rankedPoint of rankedPoints) {
    const ranking = rankedPoint.rankings.find((entry) => remainingCapacities[entry.index] > 0);
    const bestIndex = ranking?.index ?? 0;
    clusters[bestIndex].points.push(rankedPoint.point);
    remainingCapacities[bestIndex] -= 1;
  }
  return clusters;
}

function chooseMedoid(points) {
  if (points.length <= 1) {
    return points[0] || null;
  }
  const centroid = averageCentroid(points);
  return [...points].sort((left, right) => {
    const distanceDelta = distanceKm(left, centroid) - distanceKm(right, centroid);
    return Math.abs(distanceDelta) > 0.000001
      ? distanceDelta
      : comparePointIdentity(left, right);
  })[0];
}

function countCurrentWeeks(points) {
  const counts = new Map();
  for (const point of points) {
    const match = String(point.week ?? "").match(/^week\s*(\d+)$/i);
    const week = match ? Number(match[1]) : null;
    if (Number.isInteger(week) && week >= 1 && week <= WEEK_COUNT) {
      counts.set(week, (counts.get(week) || 0) + 1);
    }
  }
  return counts;
}

function summarizeCluster(points) {
  const farthestPair = findFarthestPair(points);
  return {
    points,
    centroid: averageCentroid(points),
    currentWeekCounts: countCurrentWeeks(points),
    diameterKm: farthestPair.distanceKm,
  };
}

function scoreClusterSet(clusters) {
  const summaries = clusters.map((cluster) => summarizeCluster(cluster.points));
  const maxDiameterKm = Math.max(...summaries.map((cluster) => cluster.diameterKm));
  const totalDiameterKm = summaries.reduce((sum, cluster) => sum + cluster.diameterKm, 0);
  return { score: maxDiameterKm * 1000 + totalDiameterKm, clusters: summaries };
}

function buildCompactGeoClusters(points, clusterCount, iterations) {
  if (clusterCount <= 1 || points.length <= 1) {
    return [summarizeCluster(points)];
  }
  let centers = chooseInitialCenters(points, clusterCount);
  let best = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const capacities = allocateCapacitiesToCenters(points, centers);
    const assignedClusters = assignPointsToCenters(points, centers, capacities);
    const scored = scoreClusterSet(assignedClusters);
    if (!best || scored.score < best.score) {
      best = scored;
    }
    const nextCenters = assignedClusters.map(
      (cluster) => chooseMedoid(cluster.points) || cluster.center,
    );
    const unchanged = nextCenters.every((center, index) => center === centers[index]);
    centers = nextCenters;
    if (unchanged) {
      break;
    }
  }
  return best ? best.clusters : [summarizeCluster(points)];
}

function assignWeeksToClusters(clusters) {
  const memo = new Map();
  function scoreClusterWeek(cluster, week, clusterIndex) {
    const keptCount = cluster.currentWeekCounts.get(week) || 0;
    const spatialOrderWeek = Math.min(clusterIndex + 1, WEEK_COUNT);
    return keptCount - Math.abs(week - spatialOrderWeek) * 0.001;
  }
  function solve(clusterIndex, usedMask) {
    if (clusterIndex >= clusters.length) {
      return { score: 0, weeks: [] };
    }
    const memoKey = `${clusterIndex}:${usedMask}`;
    const cached = memo.get(memoKey);
    if (cached) {
      return cached;
    }
    let best = null;
    for (let week = 1; week <= WEEK_COUNT; week += 1) {
      const bit = 1 << (week - 1);
      if ((usedMask & bit) !== 0) {
        continue;
      }
      const rest = solve(clusterIndex + 1, usedMask | bit);
      const score = scoreClusterWeek(clusters[clusterIndex], week, clusterIndex) + rest.score;
      if (!best || score > best.score) {
        best = { score, weeks: [week, ...rest.weeks] };
      }
    }
    const result = best || { score: Number.NEGATIVE_INFINITY, weeks: [] };
    memo.set(memoKey, result);
    return result;
  }
  return solve(0, 0).weeks;
}

function assignRouteWeeks(routeAccounts, iterations, reasonPrefix) {
  const geocoded = routeAccounts.filter(hasCoordinate);
  const unmapped = routeAccounts.filter((account) => !hasCoordinate(account));
  const projected = projectPoints(geocoded);
  const clusterCount = Math.min(WEEK_COUNT, Math.max(1, projected.length));
  const clusters = buildCompactGeoClusters(projected, clusterCount, iterations).sort((left, right) => {
    const leftCentroid = left.centroid || { x: 0, y: 0 };
    const rightCentroid = right.centroid || { x: 0, y: 0 };
    const xDelta = leftCentroid.x - rightCentroid.x;
    return Math.abs(xDelta) > 0.000001 ? xDelta : rightCentroid.y - leftCentroid.y;
  });
  const assignedWeeks = assignWeeksToClusters(clusters);
  const assignments = clusters.flatMap((cluster, index) =>
    cluster.points.map((point) => ({
      ...point,
      assignedWeek: assignedWeeks[index] || index + 1,
      assignmentReason:
        point.week === `Week ${assignedWeeks[index] || index + 1}`
          ? `${reasonPrefix}_geo_cluster_kept`
          : `${reasonPrefix}_geo_rebalanced`,
    })),
  );
  const counts = new Map();
  for (const assignment of assignments) {
    counts.set(assignment.assignedWeek, (counts.get(assignment.assignedWeek) || 0) + 1);
  }
  for (const account of unmapped.sort((left, right) => comparePointIdentity(left, right))) {
    const week = Array.from({ length: WEEK_COUNT }, (_, index) => index + 1).sort(
      (left, right) => (counts.get(left) || 0) - (counts.get(right) || 0) || left - right,
    )[0];
    counts.set(week, (counts.get(week) || 0) + 1);
    assignments.push({
      ...account,
      assignedWeek: week,
      assignmentReason: `${reasonPrefix}_unmapped_balanced`,
    });
  }
  return assignments;
}

async function createBackup(db, sqlitePath, safeTimestamp, label) {
  const backupPath = path.join(
    path.dirname(sqlitePath),
    `read-model.${label}-${safeTimestamp}.sqlite`,
  );
  await db.backup(backupPath);
  return backupPath;
}

function ensureRouteWeekTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_local_metadata (
      account_record_id TEXT PRIMARY KEY,
      business_account_id TEXT,
      company_description TEXT,
      category TEXT,
      marketing_eligible INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_account_local_metadata_business_account_id
      ON account_local_metadata(business_account_id);

    CREATE TABLE IF NOT EXISTS account_route_weeks (
      account_record_id TEXT PRIMARY KEY,
      business_account_id TEXT,
      sales_rep_id TEXT,
      sales_rep_name TEXT,
      category TEXT,
      route_week INTEGER NOT NULL CHECK(route_week BETWEEN 1 AND 12),
      route_week_label TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      assignment_version TEXT NOT NULL,
      assignment_reason TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

module.exports = {
  WEEK_COUNT,
  DEFAULT_SQLITE_PATH,
  normalizeText,
  normalizeCategory,
  quoteIdentifier,
  tableExists,
  readTableColumns,
  parsePayload,
  buildAddressKey,
  readSourceTableRows,
  readLocalMetadataMap,
  readReadyGeocodeMap,
  accountKey,
  readAccounts,
  mostCommonText,
  summarizeAccount,
  hasCoordinate,
  projectPoints,
  distanceKm,
  averageCentroid,
  comparePointIdentity,
  findFarthestPair,
  buildCompactGeoClusters,
  assignWeeksToClusters,
  assignRouteWeeks,
  createBackup,
  ensureRouteWeekTables,
};
