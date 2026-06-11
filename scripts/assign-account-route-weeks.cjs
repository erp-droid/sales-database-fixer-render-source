#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const WEEK_COUNT = 12;
const DEFAULT_SQLITE_PATH = "/app/data/read-model.sqlite";
const CANDIDATE_CATEGORIES = new Set(["A", "B"]);
const ASSIGNMENT_VERSION_PREFIX = "route-weeks-12-contiguous";

function parseArgs(argv) {
  const options = {
    apply: false,
    sqlitePath: process.env.READ_MODEL_SQLITE_PATH || DEFAULT_SQLITE_PATH,
    reportPath: "",
    expectedTotal: 1269,
    includeUnmapped: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg === "--sqlite-path") {
      options.sqlitePath = argv[++index];
    } else if (arg === "--report") {
      options.reportPath = argv[++index];
    } else if (arg === "--expected-total") {
      options.expectedTotal = Number(argv[++index]);
    } else if (arg === "--exclude-unmapped") {
      options.includeUnmapped = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.expectedTotal) || options.expectedTotal <= 0) {
    throw new Error("--expected-total must be a positive integer.");
  }

  return options;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeText(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCategory(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function parsePayload(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function tableExists(db, tableName) {
  const row = db
    .prepare(
      `
      SELECT 1 AS found
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1
      `,
    )
    .get(tableName);
  return Boolean(row);
}

function readTableColumns(db, tableName) {
  if (!tableExists(db, tableName)) {
    return new Set();
  }
  const rows = db
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all();
  return new Set(rows.map((row) => row.name));
}

function selectExpression(columns, columnName) {
  if (columns.has(columnName)) {
    return quoteIdentifier(columnName);
  }
  return `NULL AS ${quoteIdentifier(columnName)}`;
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
    "updated_at",
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

function accountKey(row) {
  return (
    normalizeText(row.accountRecordId) ||
    normalizeText(row.id) ||
    normalizeText(row.businessAccountId) ||
    normalizeText(row.companyName)
  );
}

function salesRepKey(account) {
  return account.salesRepName
    ? `name:${account.salesRepName.toLowerCase()}`
    : account.salesRepId
      ? `id:${account.salesRepId.toLowerCase()}`
      : "unassigned";
}

function salesRepLabel(account) {
  return account.salesRepName || account.salesRepId || "Unassigned";
}

function parseWeekNumber(value) {
  const match = String(value ?? "").trim().match(/^week\s*(\d+)$/i);
  if (!match) {
    return null;
  }

  const numeric = Number(match[1]);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= WEEK_COUNT
    ? numeric
    : null;
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

function readLocalCategoryMap(db) {
  if (!tableExists(db, "account_local_metadata")) {
    return new Map();
  }

  const rows = db
    .prepare(
      `
      SELECT account_record_id, business_account_id, category
      FROM account_local_metadata
      WHERE category IS NOT NULL
        AND TRIM(category) <> ''
      `,
    )
    .all();
  const categories = new Map();
  for (const row of rows) {
    const category = normalizeCategory(row.category);
    if (!category) {
      continue;
    }

    const accountRecordId = normalizeText(row.account_record_id);
    const businessAccountId = normalizeText(row.business_account_id);
    if (accountRecordId) {
      categories.set(`record:${accountRecordId}`, category);
    }
    if (businessAccountId) {
      categories.set(`business:${businessAccountId}`, category);
    }
  }

  return categories;
}

function readExistingRouteWeekMap(db) {
  if (!tableExists(db, "account_route_weeks")) {
    return new Map();
  }

  const rows = db
    .prepare(
      `
      SELECT account_record_id, route_week, route_week_label
      FROM account_route_weeks
      WHERE route_week BETWEEN 1 AND 12
      `,
    )
    .all();
  return new Map(
    rows.flatMap((row) => {
      const accountRecordId = normalizeText(row.account_record_id);
      const weekNumber = parseWeekNumber(row.route_week_label) || Number(row.route_week);
      return accountRecordId && Number.isInteger(weekNumber)
        ? [[accountRecordId, weekNumber]]
        : [];
    }),
  );
}

function readReadyGeocodeMap(db) {
  if (!tableExists(db, "address_geocodes")) {
    return new Map();
  }

  const rows = db
    .prepare(
      `
      SELECT address_key, latitude, longitude, provider, status
      FROM address_geocodes
      WHERE status = 'ready'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      `,
    )
    .all();
  return new Map(rows.map((row) => [row.address_key, row]));
}

function readAccounts(db) {
  const sourceTables = ["account_rows"];
  if (tableExists(db, "local_account_rows")) {
    sourceTables.push("local_account_rows");
  }

  const sourceRows = sourceTables.flatMap((tableName) => readSourceTableRows(db, tableName));
  const localCategories = readLocalCategoryMap(db);
  const existingRouteWeeks = readExistingRouteWeekMap(db);
  const geocodes = readReadyGeocodeMap(db);
  const grouped = new Map();

  for (const row of sourceRows) {
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
    const category =
      (accountRecordId ? localCategories.get(`record:${accountRecordId}`) : null) ||
      (businessAccountId ? localCategories.get(`business:${businessAccountId}`) : null) ||
      normalizeCategory(row.category) ||
      normalizeCategory(payload?.category);
    const normalized = {
      sourceTable: row.source_table,
      rowKey: normalizeText(row.row_key),
      id: normalizeText(row.id) || normalizeText(payload?.id),
      accountRecordId,
      businessAccountId,
      companyName: normalizeText(row.company_name) || normalizeText(payload?.companyName),
      address: normalizeText(row.address) || normalizeText(payload?.address),
      addressKey:
        normalizeText(row.address_key) ||
        (addressParts.addressLine1 || addressParts.city || addressParts.postalCode
          ? buildAddressKey(addressParts)
          : null),
      salesRepId: normalizeText(row.sales_rep_id) || normalizeText(payload?.salesRepId),
      salesRepName: normalizeText(row.sales_rep_name) || normalizeText(payload?.salesRepName),
      category,
      week: normalizeText(row.week) || normalizeText(payload?.week),
      isPrimaryContact: Number(row.is_primary_contact) === 1 || payload?.isPrimaryContact === true,
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

  const accounts = [];
  for (const rows of grouped.values()) {
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
      rows.find((row) => row.addressKey && row.salesRepName) ||
      rows.find((row) => row.addressKey) ||
      rows[0];
    if (!representative) {
      continue;
    }

    const category = rows.find((row) => CANDIDATE_CATEGORIES.has(row.category))?.category;
    const accountRecordId = representative.accountRecordId;
    const existingRouteWeek = accountRecordId ? existingRouteWeeks.get(accountRecordId) : null;
    const currentWeek =
      existingRouteWeek ||
      parseWeekNumber(representative.week) ||
      rows.map((row) => parseWeekNumber(row.week)).find((week) => week !== null) ||
      null;
    const geocode = representative.addressKey
      ? geocodes.get(representative.addressKey)
      : undefined;

    accounts.push({
      accountRecordId,
      businessAccountId: representative.businessAccountId,
      companyName: representative.companyName,
      address: representative.address,
      addressKey: representative.addressKey,
      salesRepId: representative.salesRepId,
      salesRepName: representative.salesRepName,
      category,
      currentWeek,
      currentWeekLabel: currentWeek ? `Week ${currentWeek}` : representative.week,
      latitude: geocode ? Number(geocode.latitude) : null,
      longitude: geocode ? Number(geocode.longitude) : null,
      geocodeProvider: geocode ? normalizeText(geocode.provider) : null,
      rows,
    });
  }

  const categoryAccounts = accounts.filter(
    (account) => account.accountRecordId && CANDIDATE_CATEGORIES.has(account.category),
  );
  const noSalesRepAccounts = categoryAccounts.filter(
    (account) => !account.salesRepId && !account.salesRepName,
  );
  const assignedSalesRepAccounts = categoryAccounts.filter(
    (account) => account.salesRepId || account.salesRepName,
  );

  return {
    accounts: assignedSalesRepAccounts,
    sourceTables,
    diagnostics: {
      groupedAccountTotal: accounts.length,
      categoryAccountTotal: categoryAccounts.length,
      noSalesRepTotal: noSalesRepAccounts.length,
      categoryCounts: Object.fromEntries(
        ["A", "B", "C", "D", null].map((category) => [
          category || "blank",
          accounts.filter((account) => (account.category ?? null) === category).length,
        ]),
      ),
      noSalesRepSamples: noSalesRepAccounts.slice(0, 10).map((account) => ({
        accountRecordId: account.accountRecordId,
        businessAccountId: account.businessAccountId,
        companyName: account.companyName,
        category: account.category,
      })),
    },
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

function averageCentroid(points) {
  if (points.length === 0) {
    return null;
  }

  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function compareProjectedPoints(axis) {
  const primary = axis === "x" ? "x" : "y";
  const secondary = axis === "x" ? "y" : "x";
  return (left, right) => {
    const primaryDelta = left[primary] - right[primary];
    if (Math.abs(primaryDelta) > 0.000001) {
      return primaryDelta;
    }

    const secondaryDelta = left[secondary] - right[secondary];
    if (Math.abs(secondaryDelta) > 0.000001) {
      return secondaryDelta;
    }

    return (left.companyName || left.accountRecordId).localeCompare(
      right.companyName || right.accountRecordId,
      undefined,
      { sensitivity: "base", numeric: true },
    );
  };
}

function pointSpread(points, axis) {
  if (points.length <= 1) {
    return 0;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    min = Math.min(min, point[axis]);
    max = Math.max(max, point[axis]);
  }

  return max - min;
}

function chooseSpatialSplit(points, leftClusterCount, rightClusterCount, targetPerCluster) {
  const totalClusterCount = leftClusterCount + rightClusterCount;
  const targetLeftCount = Math.round((points.length * leftClusterCount) / totalClusterCount);
  const validMinLeftCount = leftClusterCount;
  const validMaxLeftCount = points.length - rightClusterCount;
  const minClusterSize = 1;
  const maxClusterSize = Math.max(minClusterSize, Math.ceil(targetPerCluster * 1.65));
  let minLeftCount = Math.max(
    validMinLeftCount,
    leftClusterCount * minClusterSize,
    points.length - rightClusterCount * maxClusterSize,
  );
  let maxLeftCount = Math.min(
    validMaxLeftCount,
    leftClusterCount * maxClusterSize,
    points.length - rightClusterCount * minClusterSize,
  );
  if (minLeftCount > maxLeftCount) {
    minLeftCount = validMinLeftCount;
    maxLeftCount = validMaxLeftCount;
  }
  let bestSplit = null;

  for (const axis of ["x", "y"]) {
    const spread = pointSpread(points, axis);
    if (spread <= 0) {
      continue;
    }

    const sorted = [...points].sort(compareProjectedPoints(axis));
    const averageSpacing = spread / Math.max(points.length - 1, 1);
    for (let splitIndex = minLeftCount; splitIndex <= maxLeftCount; splitIndex += 1) {
      const gap = sorted[splitIndex][axis] - sorted[splitIndex - 1][axis];
      const balancePenalty = Math.abs(splitIndex - targetLeftCount) * averageSpacing * 0.2;
      const score = gap - balancePenalty;
      if (
        !bestSplit ||
        score > bestSplit.score ||
        (Math.abs(score - bestSplit.score) < 0.000001 &&
          Math.abs(splitIndex - targetLeftCount) <
            Math.abs(bestSplit.splitIndex - targetLeftCount))
      ) {
        bestSplit = {
          axis,
          score,
          splitIndex,
          sorted,
        };
      }
    }
  }

  if (bestSplit) {
    return bestSplit;
  }

  const axis = pointSpread(points, "x") >= pointSpread(points, "y") ? "x" : "y";
  const sorted = [...points].sort(compareProjectedPoints(axis));
  return {
    axis,
    score: 0,
    splitIndex: Math.min(Math.max(targetLeftCount, minLeftCount), maxLeftCount),
    sorted,
  };
}

function partitionProjectedPoints(points, clusterCount, targetPerCluster) {
  if (clusterCount <= 1 || points.length <= 1) {
    return [
      {
        points,
        targetSize: points.length,
      },
    ];
  }

  const leftClusterCount = Math.floor(clusterCount / 2);
  const rightClusterCount = clusterCount - leftClusterCount;
  const split = chooseSpatialSplit(
    points,
    leftClusterCount,
    rightClusterCount,
    targetPerCluster,
  );

  return [
    ...partitionProjectedPoints(
      split.sorted.slice(0, split.splitIndex),
      leftClusterCount,
      targetPerCluster,
    ),
    ...partitionProjectedPoints(
      split.sorted.slice(split.splitIndex),
      rightClusterCount,
      targetPerCluster,
    ),
  ];
}

function countCurrentWeeks(points) {
  const counts = new Map();
  for (const point of points) {
    if (
      Number.isInteger(point.currentWeek) &&
      point.currentWeek >= 1 &&
      point.currentWeek <= WEEK_COUNT
    ) {
      counts.set(point.currentWeek, (counts.get(point.currentWeek) || 0) + 1);
    }
  }

  return counts;
}

function scoreClusterWeek(cluster, week, clusterIndex) {
  const keptCount = cluster.currentWeekCounts.get(week) || 0;
  const spatialOrderWeek = Math.min(clusterIndex + 1, WEEK_COUNT);
  const orderPenalty = Math.abs(week - spatialOrderWeek) * 0.001;
  return keptCount - orderPenalty;
}

function assignWeeksToClusters(clusters) {
  const memo = new Map();

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
      if (
        !best ||
        score > best.score ||
        (Math.abs(score - best.score) < 0.000001 && week < best.weeks[0])
      ) {
        best = {
          score,
          weeks: [week, ...rest.weeks],
        };
      }
    }

    const result = best || { score: Number.NEGATIVE_INFINITY, weeks: [] };
    memo.set(memoKey, result);
    return result;
  }

  return solve(0, 0).weeks;
}

function assignProjectedPoints(projectedPoints) {
  if (projectedPoints.length === 0) {
    return [];
  }

  const clusterCount = Math.min(WEEK_COUNT, projectedPoints.length);
  const targetPerCluster = projectedPoints.length / clusterCount;
  const clusters = partitionProjectedPoints(projectedPoints, clusterCount, targetPerCluster)
    .map((cluster) => ({
      ...cluster,
      centroid: averageCentroid(cluster.points),
      currentWeekCounts: countCurrentWeeks(cluster.points),
    }))
    .sort((left, right) => {
      const leftCentroid = left.centroid || { x: 0, y: 0 };
      const rightCentroid = right.centroid || { x: 0, y: 0 };
      const xDelta = leftCentroid.x - rightCentroid.x;
      if (Math.abs(xDelta) > 0.000001) {
        return xDelta;
      }
      return rightCentroid.y - leftCentroid.y;
    });
  const assignedWeeks = assignWeeksToClusters(clusters);

  return clusters.flatMap((cluster, index) => {
    const assignedWeek = assignedWeeks[index] || index + 1;
    return cluster.points.map((point) => ({
      ...point,
      assignedWeek,
      assignmentReason:
        point.currentWeek === assignedWeek
          ? "kept_existing_in_contiguous_cluster"
          : "geographic_contiguous_rebalanced",
    }));
  });
}

function assignUnmapped(unmappedPoints, existingCountsByWeek) {
  const counts = new Map(existingCountsByWeek);
  return [...unmappedPoints]
    .sort((left, right) =>
      (left.companyName || left.accountRecordId).localeCompare(
        right.companyName || right.accountRecordId,
        undefined,
        { sensitivity: "base", numeric: true },
      ),
    )
    .map((point) => {
      const assignedWeek = Array.from({ length: WEEK_COUNT }, (_, index) => index + 1).sort(
        (left, right) => {
          const countDelta = (counts.get(left) || 0) - (counts.get(right) || 0);
          return countDelta !== 0 ? countDelta : left - right;
        },
      )[0];
      counts.set(assignedWeek, (counts.get(assignedWeek) || 0) + 1);
      return {
        ...point,
        assignedWeek,
        assignmentReason:
          point.currentWeek === assignedWeek
            ? "kept_existing_unmapped_balanced"
            : "unmapped_balanced",
      };
    });
}

function distanceKm(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function computeSpatialStats(assignments) {
  const grouped = new Map();
  for (const assignment of assignments) {
    if (!hasCoordinate(assignment)) {
      continue;
    }

    const key = `${salesRepLabel(assignment)}::${assignment.assignedWeek}`;
    const group = grouped.get(key) || {
      salesRep: salesRepLabel(assignment),
      week: assignment.assignedWeek,
      points: [],
    };
    group.points.push(assignment);
    grouped.set(key, group);
  }

  return [...grouped.values()]
    .map((group) => {
      const centroid = averageCentroid(group.points) || { x: 0, y: 0 };
      const distances = group.points.map((point) => distanceKm(point, centroid));
      const maxDistanceKm = distances.length > 0 ? Math.max(...distances) : 0;
      const xSpreadKm = pointSpread(group.points, "x");
      const ySpreadKm = pointSpread(group.points, "y");
      const bboxDiagonalKm = Math.sqrt(xSpreadKm * xSpreadKm + ySpreadKm * ySpreadKm);
      const farthestPoint = group.points
        .map((point, index) => ({ point, distance: distances[index] || 0 }))
        .sort((left, right) => right.distance - left.distance)[0]?.point;

      return {
        salesRep: group.salesRep,
        week: `Week ${group.week}`,
        count: group.points.length,
        centroidLatitude: Number((centroid.y / 110.57).toFixed(6)),
        centroidLongitude: Number(
          (
            group.points.reduce((sum, point) => sum + point.longitude, 0) /
            Math.max(group.points.length, 1)
          ).toFixed(6),
        ),
        maxDistanceKm: Number(maxDistanceKm.toFixed(2)),
        bboxDiagonalKm: Number(bboxDiagonalKm.toFixed(2)),
        farthestAccount: farthestPoint
          ? {
              accountRecordId: farthestPoint.accountRecordId,
              businessAccountId: farthestPoint.businessAccountId,
              companyName: farthestPoint.companyName,
              latitude: farthestPoint.latitude,
              longitude: farthestPoint.longitude,
            }
          : null,
      };
    })
    .sort((left, right) => {
      const repDelta = left.salesRep.localeCompare(right.salesRep, undefined, {
        sensitivity: "base",
      });
      if (repDelta !== 0) {
        return repDelta;
      }

      const leftWeek = Number(left.week.replace(/\D/g, ""));
      const rightWeek = Number(right.week.replace(/\D/g, ""));
      return leftWeek - rightWeek;
    });
}

function buildAssignments(accounts, includeUnmapped) {
  const grouped = new Map();
  for (const account of accounts) {
    const key = salesRepKey(account);
    const group = grouped.get(key) || {
      key,
      label: salesRepLabel(account),
      accounts: [],
    };
    group.accounts.push(account);
    grouped.set(key, group);
  }

  const assignments = [];
  const summaries = [];

  for (const group of [...grouped.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
  )) {
    const geocoded = group.accounts.filter(hasCoordinate);
    const unmapped = group.accounts.filter((account) => !hasCoordinate(account));
    const projected = projectPoints(geocoded);
    const geocodedAssignments = assignProjectedPoints(projected);
    const existingCounts = new Map();
    for (const assignment of geocodedAssignments) {
      existingCounts.set(
        assignment.assignedWeek,
        (existingCounts.get(assignment.assignedWeek) || 0) + 1,
      );
    }
    const unmappedAssignments = includeUnmapped
      ? assignUnmapped(unmapped, existingCounts)
      : [];
    const groupAssignments = [...geocodedAssignments, ...unmappedAssignments];

    assignments.push(...groupAssignments);
    summaries.push({
      salesRep: group.label,
      total: group.accounts.length,
      targetPerWeek: group.accounts.length / WEEK_COUNT,
      geocoded: geocoded.length,
      unmapped: unmapped.length,
      assigned: groupAssignments.length,
      weekCounts: Object.fromEntries(
        Array.from({ length: WEEK_COUNT }, (_, index) => {
          const week = index + 1;
          return [
            `Week ${week}`,
            groupAssignments.filter((assignment) => assignment.assignedWeek === week).length,
          ];
        }),
      ),
    });
  }

  return {
    assignments,
    summaries,
    spatialStats: computeSpatialStats(assignments),
  };
}

function ensureRouteWeekTable(db) {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_account_route_weeks_business_account_id
      ON account_route_weeks(business_account_id);
    CREATE INDEX IF NOT EXISTS idx_account_route_weeks_sales_rep_name
      ON account_route_weeks(sales_rep_name);
    CREATE INDEX IF NOT EXISTS idx_account_route_weeks_route_week
      ON account_route_weeks(route_week);
  `);
}

async function createBackup(db, sqlitePath, timestamp) {
  const backupPath = path.join(
    path.dirname(sqlitePath),
    `read-model.route-weeks-preapply-${timestamp}.sqlite`,
  );
  await db.backup(backupPath);
  return backupPath;
}

function updateAccountRowsForAssignment(db, tableName, assignment, timestamp) {
  const columns = readTableColumns(db, tableName);
  if (columns.size === 0) {
    return 0;
  }

  const matchClauses = [];
  const params = {};
  if (columns.has("account_record_id") || columns.has("id")) {
    const recordExpr =
      columns.has("account_record_id") && columns.has("id")
        ? "COALESCE(NULLIF(account_record_id, ''), id)"
        : columns.has("account_record_id")
          ? "account_record_id"
          : "id";
    matchClauses.push(`${recordExpr} = @account_record_id`);
    params.account_record_id = assignment.accountRecordId;
  }
  if (columns.has("business_account_id") && assignment.businessAccountId) {
    matchClauses.push("business_account_id = @business_account_id");
    params.business_account_id = assignment.businessAccountId;
  }
  if (matchClauses.length === 0) {
    return 0;
  }

  const rows = db
    .prepare(
      `
      SELECT rowid AS row_id,
        ${columns.has("payload_json") ? "payload_json" : "'{}' AS payload_json"}
      FROM ${quoteIdentifier(tableName)}
      WHERE ${matchClauses.join(" OR ")}
      `,
    )
    .all(params);
  if (rows.length === 0) {
    return 0;
  }

  const setClauses = [];
  if (columns.has("week")) {
    setClauses.push("week = @week");
  }
  if (columns.has("payload_json")) {
    setClauses.push("payload_json = @payload_json");
  }
  if (columns.has("updated_at")) {
    setClauses.push("updated_at = @updated_at");
  }
  if (setClauses.length === 0) {
    return 0;
  }

  const update = db.prepare(`
    UPDATE ${quoteIdentifier(tableName)}
    SET ${setClauses.join(", ")}
    WHERE rowid = @row_id
  `);
  const week = `Week ${assignment.assignedWeek}`;
  let updated = 0;

  for (const row of rows) {
    const payload = parsePayload(row.payload_json);
    const nextPayload =
      payload && typeof payload === "object"
        ? JSON.stringify({ ...payload, week })
        : row.payload_json;
    updated += update.run({
      row_id: row.row_id,
      week,
      payload_json: nextPayload,
      updated_at: timestamp,
    }).changes;
  }

  return updated;
}

function applyAssignments(db, assignments, sourceTables, assignmentVersion, timestamp) {
  ensureRouteWeekTable(db);
  const insert = db.prepare(`
    INSERT INTO account_route_weeks (
      account_record_id,
      business_account_id,
      sales_rep_id,
      sales_rep_name,
      category,
      route_week,
      route_week_label,
      latitude,
      longitude,
      assignment_version,
      assignment_reason,
      updated_at
    ) VALUES (
      @account_record_id,
      @business_account_id,
      @sales_rep_id,
      @sales_rep_name,
      @category,
      @route_week,
      @route_week_label,
      @latitude,
      @longitude,
      @assignment_version,
      @assignment_reason,
      @updated_at
    )
    ON CONFLICT(account_record_id) DO UPDATE SET
      business_account_id = excluded.business_account_id,
      sales_rep_id = excluded.sales_rep_id,
      sales_rep_name = excluded.sales_rep_name,
      category = excluded.category,
      route_week = excluded.route_week,
      route_week_label = excluded.route_week_label,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      assignment_version = excluded.assignment_version,
      assignment_reason = excluded.assignment_reason,
      updated_at = excluded.updated_at
  `);

  const txn = db.transaction(() => {
    db.prepare("CREATE TEMP TABLE IF NOT EXISTS route_week_candidate_ids (account_record_id TEXT PRIMARY KEY)").run();
    db.prepare("DELETE FROM route_week_candidate_ids").run();
    const insertCandidate = db.prepare(
      "INSERT OR IGNORE INTO route_week_candidate_ids (account_record_id) VALUES (?)",
    );

    for (const assignment of assignments) {
      const routeWeekLabel = `Week ${assignment.assignedWeek}`;
      insert.run({
        account_record_id: assignment.accountRecordId,
        business_account_id: assignment.businessAccountId,
        sales_rep_id: assignment.salesRepId,
        sales_rep_name: assignment.salesRepName,
        category: assignment.category,
        route_week: assignment.assignedWeek,
        route_week_label: routeWeekLabel,
        latitude: assignment.latitude,
        longitude: assignment.longitude,
        assignment_version: assignmentVersion,
        assignment_reason: assignment.assignmentReason,
        updated_at: timestamp,
      });
      insertCandidate.run(assignment.accountRecordId);
      for (const tableName of sourceTables) {
        updateAccountRowsForAssignment(db, tableName, assignment, timestamp);
      }
    }

    db.prepare(
      `
      DELETE FROM account_route_weeks
      WHERE account_record_id NOT IN (
        SELECT account_record_id
        FROM route_week_candidate_ids
      )
      `,
    ).run();
    db.prepare("DROP TABLE route_week_candidate_ids").run();

    if (tableExists(db, "sync_state")) {
      db.prepare(
        `
        UPDATE sync_state
        SET completed_at = ?,
            last_successful_sync_at = ?,
            last_error = NULL,
            phase = NULL,
            progress_json = NULL
        WHERE scope = 'full'
        `,
      ).run(timestamp, timestamp);
    }
  });

  txn();
}

function buildReport(
  options,
  sourceTables,
  diagnostics,
  accounts,
  assignmentResult,
  assignmentVersion,
  backupPath,
) {
  const assignedByWeek = Object.fromEntries(
    Array.from({ length: WEEK_COUNT }, (_, index) => {
      const week = index + 1;
      return [
        `Week ${week}`,
        assignmentResult.assignments.filter((assignment) => assignment.assignedWeek === week)
          .length,
      ];
    }),
  );

  const currentWeekKept = assignmentResult.assignments.filter(
    (assignment) => assignment.currentWeek === assignment.assignedWeek,
  ).length;

  return {
    ok: true,
    mode: options.apply ? "apply" : "dry-run",
    assignmentVersion,
    sqlitePath: options.sqlitePath,
    sourceTables,
    diagnostics,
    backupPath,
    expectedTotal: options.expectedTotal,
    candidateTotal: accounts.length,
    assignedTotal: assignmentResult.assignments.length,
    geocodedTotal: accounts.filter(hasCoordinate).length,
    unmappedTotal: accounts.filter((account) => !hasCoordinate(account)).length,
    currentWeekKept,
    assignedByWeek,
    reps: assignmentResult.summaries,
    spatialStats: assignmentResult.spatialStats,
    widestWeeks: [...assignmentResult.spatialStats]
      .sort((left, right) => right.bboxDiagonalKm - left.bboxDiagonalKm)
      .slice(0, 12),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(options.sqlitePath);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }

  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const assignmentVersion = `${ASSIGNMENT_VERSION_PREFIX}-${safeTimestamp}`;
  const db = new Database(sqlitePath);

  try {
    ensureRouteWeekTable(db);
    const { accounts, sourceTables, diagnostics } = readAccounts(db);
    const assignmentResult = buildAssignments(accounts, options.includeUnmapped);
    if (accounts.length !== options.expectedTotal) {
      const message =
        `Expected ${options.expectedTotal} A/B accounts but found ${accounts.length}. ` +
        "Review report before applying.";
      if (options.apply) {
        throw new Error(message);
      }
      process.stderr.write(`${message}\n`);
    }

    let backupPath = null;
    if (options.apply) {
      backupPath = await createBackup(db, sqlitePath, safeTimestamp);
      applyAssignments(db, assignmentResult.assignments, sourceTables, assignmentVersion, timestamp);
    }

    const report = buildReport(
      options,
      sourceTables,
      diagnostics,
      accounts,
      assignmentResult,
      assignmentVersion,
      backupPath,
    );

    if (options.reportPath) {
      const reportPath = path.resolve(options.reportPath);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      report.reportPath = reportPath;
    }

    console.log(JSON.stringify(report));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
