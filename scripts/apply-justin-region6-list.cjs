#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const WEEK_COUNT = 12;
const DEFAULT_SQLITE_PATH = "/app/data/read-model.sqlite";
const JUSTIN_REP_LABEL = "Justin Settle";
const ASSIGNMENT_VERSION_PREFIX = "justin-region6-109-ab";

function parseArgs(argv) {
  const options = {
    apply: false,
    sqlitePath: process.env.READ_MODEL_SQLITE_PATH || DEFAULT_SQLITE_PATH,
    sourceJsonPath: "",
    expectedSourceTotal: 109,
    expectedRouteTotal: 109,
    promoteSourceNonAbTo: "B",
    clusterIterations: 40,
    matchScope: "all",
    reportPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg === "--sqlite-path") {
      options.sqlitePath = argv[++index];
    } else if (arg === "--source-json") {
      options.sourceJsonPath = argv[++index];
    } else if (arg === "--expected-source-total") {
      options.expectedSourceTotal = Number(argv[++index]);
    } else if (arg === "--expected-route-total") {
      options.expectedRouteTotal = Number(argv[++index]);
    } else if (arg === "--promote-source-non-ab-to") {
      options.promoteSourceNonAbTo = normalizeCategory(argv[++index]) || "B";
    } else if (arg === "--cluster-iterations") {
      options.clusterIterations = Number(argv[++index]);
    } else if (arg === "--match-scope") {
      const matchScope = normalizeText(argv[++index])?.toLowerCase();
      options.matchScope = matchScope === "justin" ? "justin" : "all";
    } else if (arg === "--report") {
      options.reportPath = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.sourceJsonPath) {
    throw new Error("--source-json is required.");
  }
  if (!Number.isInteger(options.expectedSourceTotal) || options.expectedSourceTotal <= 0) {
    throw new Error("--expected-source-total must be a positive integer.");
  }
  if (!Number.isInteger(options.expectedRouteTotal) || options.expectedRouteTotal <= 0) {
    throw new Error("--expected-route-total must be a positive integer.");
  }
  if (!Number.isInteger(options.clusterIterations) || options.clusterIterations <= 0) {
    throw new Error("--cluster-iterations must be a positive integer.");
  }
  if (!["all", "justin"].includes(options.matchScope)) {
    throw new Error("--match-scope must be all or justin.");
  }

  return options;
}

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

function isJustinAccount(account) {
  const label = `${account.salesRepName || ""} ${account.salesRepId || ""}`.toLowerCase();
  return label.includes("justin") || label.includes("settle");
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

function resolveJustinRepIdentity(justinAccounts) {
  return {
    salesRepId: mostCommonText(justinAccounts.map((account) => account.salesRepId)),
    salesRepName: mostCommonText(justinAccounts.map((account) => account.salesRepName)) || JUSTIN_REP_LABEL,
  };
}

function normalizeCompanyForMatch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bm d a\b/g, " mda ")
    .replace(/\blogistix\b/g, "logistics")
    .replace(/\bpepsico\b/g, "pepsi")
    .replace(
      /\b(incorporated|inc|limited|ltd|corp|corporation|company|co|canada|canadian|the|aerospace)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phoneDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

function normalizeStreetForMatch(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(street|str)\b/g, "st")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(crescent)\b/g, "cres")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\b(parkway)\b/g, "pkwy")
    .replace(/\b(north)\b/g, "n")
    .replace(/\b(south)\b/g, "s")
    .replace(/\b(east)\b/g, "e")
    .replace(/\b(west)\b/g, "w")
    .replace(/\s+/g, " ")
    .trim();
}

function streetMatches(sourceStreet, accountStreet) {
  if (!sourceStreet || !accountStreet) {
    return false;
  }
  if (sourceStreet === accountStreet) {
    return true;
  }

  const sourceCompact = sourceStreet.replace(/\s+/g, "");
  const accountCompact = accountStreet.replace(/\s+/g, "");
  if (sourceCompact.length >= 6 && accountCompact.length >= 6) {
    return sourceCompact.includes(accountCompact) || accountCompact.includes(sourceCompact);
  }

  return false;
}

function tokenSet(value) {
  return new Set(normalizeCompanyForMatch(value).split(/\s+/).filter(Boolean));
}

function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

function matchScore(source, account) {
  const sourceName = normalizeCompanyForMatch(source.companyName);
  const accountName = normalizeCompanyForMatch(account.companyName);
  const sourceRawName = normalizeLoose(source.companyName);
  const accountRawName = normalizeLoose(account.companyName);
  const sourceCompact = sourceName.replace(/\s+/g, "");
  const accountCompact = accountName.replace(/\s+/g, "");
  let score = 0;
  const reasons = [];

  if (sourceName && sourceName === accountName) {
    score += 100;
    reasons.push("name_exact");
  } else if (sourceCompact && sourceCompact === accountCompact) {
    score += 96;
    reasons.push("name_compact");
  } else if (
    sourceName.length >= 3 &&
    sourceName.length <= 4 &&
    tokenSet(account.companyName).has(sourceName)
  ) {
    score += 82;
    reasons.push("name_acronym_token");
  } else if (
    sourceName.length >= 5 &&
    accountName.length >= 5 &&
    (sourceName.includes(accountName) || accountName.includes(sourceName))
  ) {
    score += 86;
    reasons.push("name_contains");
  } else {
    const overlap = jaccard(tokenSet(source.companyName), tokenSet(account.companyName));
    if (overlap >= 0.8) {
      score += 82;
      reasons.push("name_token_high");
    } else if (overlap >= 0.6) {
      score += 68;
      reasons.push("name_token_medium");
    } else if (overlap >= 0.45) {
      score += 50;
      reasons.push("name_token_low");
    }
  }

  if (sourceRawName && sourceRawName === accountRawName) {
    score += 4;
    reasons.push("raw_name_exact");
  }

  const sourceStreet = normalizeStreetForMatch(source.streetAddress);
  const accountStreet = normalizeStreetForMatch(account.addressLine1 || account.address);
  if (streetMatches(sourceStreet, accountStreet)) {
    score += 75;
    reasons.push("street_match");
  }

  const sourceCity = normalizeLoose(source.city);
  const accountCity = normalizeLoose(account.city);
  if (sourceCity && accountCity && sourceCity === accountCity) {
    score += 10;
    reasons.push("city_match");
  }

  const sourcePhone = phoneDigits(source.phoneNumber);
  const accountPhones = [account.companyPhone, account.phoneNumber, account.primaryContactPhone]
    .map(phoneDigits)
    .filter((value) => value.length >= 7);
  if (sourcePhone.length >= 7 && accountPhones.includes(sourcePhone)) {
    score += 15;
    reasons.push("phone_match");
  }

  return { score, reasons };
}

function readSourceRows(sourceJsonPath, promoteSourceNonAbTo) {
  const rows = JSON.parse(fs.readFileSync(sourceJsonPath, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error("Source JSON must be an array.");
  }

  return rows
    .map((row, index) => {
      const companyName = normalizeText(row.companyName ?? row.company_name ?? row.A);
      const priority = normalizeCategory(row.priority ?? row.category ?? row.D);
      const sourceCategory =
        priority === "A" || priority === "B" ? priority : normalizeCategory(promoteSourceNonAbTo);
      return {
        rowNumber: Number(row.rowNumber ?? row.row_number ?? index + 2),
        companyName,
        priority,
        sourceCategory,
        city: normalizeText(row.city ?? row.F),
        streetAddress: normalizeText(row.streetAddress ?? row.street_address ?? row.G),
        phoneNumber: normalizeText(row.phoneNumber ?? row.phone_number ?? row.E),
      };
    })
    .filter((row) => row.companyName);
}

function buildMatches(sourceRows, justinAccounts) {
  const usedAccountIds = new Set();
  const matches = [];
  const unmatched = [];
  const ambiguous = [];

  for (const source of sourceRows) {
    const rankedAll = justinAccounts
      .map((account) => {
        const score = matchScore(source, account);
        return { account, ...score };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        const leftJustin = isJustinAccount(left.account) ? 0 : 1;
        const rightJustin = isJustinAccount(right.account) ? 0 : 1;
        if (leftJustin !== rightJustin) {
          return leftJustin - rightJustin;
        }
        const leftCategory = left.account.category === source.sourceCategory ? 0 : 1;
        const rightCategory = right.account.category === source.sourceCategory ? 0 : 1;
        if (leftCategory !== rightCategory) {
          return leftCategory - rightCategory;
        }
        return String(left.account.companyName).localeCompare(String(right.account.companyName));
      });
    const ranked = rankedAll.filter((candidate) => candidate.score >= 80);

    const unusedRanked = ranked.filter((candidate) => !usedAccountIds.has(candidate.account.accountRecordId));
    const best = unusedRanked[0];
    if (!best) {
      unmatched.push({
        source,
        duplicateOnly: ranked.length > 0,
        topCandidates: rankedAll.slice(0, 5).map(summarizeMatchCandidate),
      });
      continue;
    }

    const second = unusedRanked[1] || ranked.find((candidate) => candidate.account !== best.account);
    if (second && best.score - second.score <= 5) {
      ambiguous.push({
        source,
        best: summarizeMatchCandidate(best),
        second: summarizeMatchCandidate(second),
      });
    }

    usedAccountIds.add(best.account.accountRecordId);
    matches.push({
      source,
      account: best.account,
      score: best.score,
      reasons: best.reasons,
    });
  }

  return { matches, unmatched, ambiguous };
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

function summarizeMatchCandidate(candidate) {
  return {
    score: candidate.score,
    reasons: candidate.reasons,
    account: summarizeAccount(candidate.account),
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

function summarizeCluster(points) {
  const farthestPair = findFarthestPair(points);
  return {
    points,
    centroid: averageCentroid(points),
    currentWeekCounts: countCurrentWeeks(points),
    diameterKm: farthestPair.distanceKm,
  };
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

function assignRouteWeeks(routeAccounts, iterations) {
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
          ? "kept_existing_justin_region6_geo_cluster"
          : "justin_region6_geo_rebalanced",
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
      assignmentReason: "justin_region6_unmapped_balanced",
    });
  }
  return assignments;
}

function computeSpatialStats(assignments) {
  const grouped = new Map();
  for (const assignment of assignments) {
    if (!hasCoordinate(assignment)) {
      continue;
    }
    const group = grouped.get(assignment.assignedWeek) || {
      week: assignment.assignedWeek,
      points: [],
    };
    group.points.push(assignment);
    grouped.set(assignment.assignedWeek, group);
  }
  return [...grouped.values()]
    .map((group) => {
      const farthestPair = findFarthestPair(group.points);
      return {
        salesRep: JUSTIN_REP_LABEL,
        week: `Week ${group.week}`,
        count: group.points.length,
        diameterKm: Number(farthestPair.distanceKm.toFixed(2)),
        farthestPair: farthestPair.accounts.length
          ? {
              distanceKm: Number(farthestPair.distanceKm.toFixed(2)),
              accounts: farthestPair.accounts.map(summarizeAccount),
            }
          : null,
      };
    })
    .sort((left, right) => Number(left.week.replace(/\D/g, "")) - Number(right.week.replace(/\D/g, "")));
}

async function createBackup(db, sqlitePath, timestamp) {
  const backupPath = path.join(
    path.dirname(sqlitePath),
    `read-model.justin-region6-preapply-${timestamp}.sqlite`,
  );
  await db.backup(backupPath);
  return backupPath;
}

function ensureTables(db) {
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

function applyUpdates(db, plan, sourceTables, assignmentVersion, timestamp) {
  ensureTables(db);
  const upsertMetadata = db.prepare(`
    INSERT INTO account_local_metadata (
      account_record_id,
      business_account_id,
      company_description,
      category,
      marketing_eligible,
      updated_at
    ) VALUES (
      @account_record_id,
      @business_account_id,
      @company_description,
      @category,
      @marketing_eligible,
      @updated_at
    )
    ON CONFLICT(account_record_id) DO UPDATE SET
      business_account_id = excluded.business_account_id,
      company_description = COALESCE(account_local_metadata.company_description, excluded.company_description),
      category = excluded.category,
      marketing_eligible = account_local_metadata.marketing_eligible,
      updated_at = excluded.updated_at
  `);
  const insertRouteWeek = db.prepare(`
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
  const routeWeekByAccountRecordId = new Map(
    plan.routeAssignments.map((assignment) => [
      assignment.accountRecordId,
      `Week ${assignment.assignedWeek}`,
    ]),
  );
  const txn = db.transaction(() => {
    db.prepare("CREATE TEMP TABLE justin_account_ids (account_record_id TEXT PRIMARY KEY)").run();
    db.prepare("CREATE TEMP TABLE justin_route_candidate_ids (account_record_id TEXT PRIMARY KEY)").run();
    const insertJustinId = db.prepare("INSERT OR IGNORE INTO justin_account_ids VALUES (?)");
    const insertCandidateId = db.prepare("INSERT OR IGNORE INTO justin_route_candidate_ids VALUES (?)");

    for (const update of plan.categoryUpdates) {
      insertJustinId.run(update.account.accountRecordId);
      const existingMetadata = update.account.metadata || {};
      upsertMetadata.run({
        account_record_id: update.account.accountRecordId,
        business_account_id: update.account.businessAccountId,
        company_description: existingMetadata.companyDescription || null,
        category: update.targetCategory,
        marketing_eligible: existingMetadata.marketingEligible === false ? 0 : 1,
        updated_at: timestamp,
      });
      for (const tableName of sourceTables) {
        updateSourceRowsForAccount(db, tableName, {
          account: update.account,
          category: update.targetCategory,
          week: routeWeekByAccountRecordId.get(update.account.accountRecordId) || null,
          salesRepId: update.targetSalesRepId,
          salesRepName: update.targetSalesRepName,
          timestamp,
        });
      }
    }

    for (const assignment of plan.routeAssignments) {
      insertCandidateId.run(assignment.accountRecordId);
      insertRouteWeek.run({
        account_record_id: assignment.accountRecordId,
        business_account_id: assignment.businessAccountId,
        sales_rep_id: assignment.salesRepId,
        sales_rep_name: assignment.salesRepName,
        category: assignment.targetCategory,
        route_week: assignment.assignedWeek,
        route_week_label: `Week ${assignment.assignedWeek}`,
        latitude: assignment.latitude,
        longitude: assignment.longitude,
        assignment_version: assignmentVersion,
        assignment_reason: assignment.assignmentReason,
        updated_at: timestamp,
      });
    }

    db.prepare(
      `
      DELETE FROM account_route_weeks
      WHERE account_record_id IN (SELECT account_record_id FROM justin_account_ids)
        AND account_record_id NOT IN (SELECT account_record_id FROM justin_route_candidate_ids)
      `,
    ).run();
    db.prepare("DROP TABLE justin_account_ids").run();
    db.prepare("DROP TABLE justin_route_candidate_ids").run();

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
  return sourceTables;
}

function updateSourceRowsForAccount(db, tableName, update) {
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
    params.account_record_id = update.account.accountRecordId;
  }
  if (columns.has("business_account_id") && update.account.businessAccountId) {
    matchClauses.push("business_account_id = @business_account_id");
    params.business_account_id = update.account.businessAccountId;
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
  if (columns.has("category")) {
    setClauses.push("category = @category");
  }
  if (columns.has("week")) {
    setClauses.push("week = @week");
  }
  if (columns.has("sales_rep_id")) {
    setClauses.push("sales_rep_id = @sales_rep_id");
  }
  if (columns.has("sales_rep_name")) {
    setClauses.push("sales_rep_name = @sales_rep_name");
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

  const statement = db.prepare(`
    UPDATE ${quoteIdentifier(tableName)}
    SET ${setClauses.join(", ")}
    WHERE rowid = @row_id
  `);
  let updated = 0;
  for (const row of rows) {
    const payload = parsePayload(row.payload_json);
    const nextPayload =
      payload && typeof payload === "object"
        ? JSON.stringify({
            ...payload,
            category: update.category,
            week: update.week,
            salesRepId: update.salesRepId,
            salesRepName: update.salesRepName,
          })
        : row.payload_json;
    updated += statement.run({
      row_id: row.row_id,
      category: update.category,
      week: update.week,
      sales_rep_id: update.salesRepId,
      sales_rep_name: update.salesRepName,
      payload_json: nextPayload,
      updated_at: update.timestamp,
    }).changes;
  }

  return updated;
}

function buildPlan(sourceRows, accounts, options) {
  const justinAccounts = accounts.filter(isJustinAccount);
  const matchAccounts = options.matchScope === "justin" ? justinAccounts : accounts;
  const justinRepIdentity = resolveJustinRepIdentity(justinAccounts);
  const { matches, unmatched, ambiguous } = buildMatches(sourceRows, matchAccounts);
  const matchedAccountIds = new Set(matches.map((match) => match.account.accountRecordId));
  const matchedSourceByAccountId = new Map(
    matches.map((match) => [match.account.accountRecordId, match.source]),
  );
  const categoryUpdateMap = new Map();
  for (const account of justinAccounts) {
    const source = matchedSourceByAccountId.get(account.accountRecordId);
    categoryUpdateMap.set(account.accountRecordId, {
      account,
      source: source || null,
      previousCategory: account.category || null,
      targetCategory: source ? source.sourceCategory : "D",
      targetSalesRepId: account.salesRepId || justinRepIdentity.salesRepId,
      targetSalesRepName: account.salesRepName || justinRepIdentity.salesRepName,
      reason: source ? "matched_source_list" : "justin_not_in_source_list",
    });
  }
  for (const match of matches) {
    if (categoryUpdateMap.has(match.account.accountRecordId)) {
      continue;
    }
    categoryUpdateMap.set(match.account.accountRecordId, {
      account: match.account,
      source: match.source,
      previousCategory: match.account.category || null,
      targetCategory: match.source.sourceCategory,
      targetSalesRepId: justinRepIdentity.salesRepId,
      targetSalesRepName: justinRepIdentity.salesRepName,
      reason: "matched_source_list_reassigned_to_justin",
    });
  }
  const categoryUpdates = [...categoryUpdateMap.values()];
  const routeAccounts = categoryUpdates
    .filter((update) => update.targetCategory === "A" || update.targetCategory === "B")
    .map((update) => ({
      ...update.account,
      targetCategory: update.targetCategory,
      salesRepId: update.targetSalesRepId,
      salesRepName: update.targetSalesRepName,
    }));
  const routeAssignments = assignRouteWeeks(routeAccounts, options.clusterIterations);

  return {
    justinAccounts,
    matchAccounts,
    justinRepIdentity,
    matches,
    unmatched,
    ambiguous,
    matchedAccountIds,
    categoryUpdates,
    routeAccounts,
    routeAssignments,
  };
}

function buildReport(options, sourceRows, plan, assignmentVersion, backupPath) {
  const sourcePriorityCounts = {};
  const targetCategoryCounts = {};
  const previousCategoryCounts = {};
  const weekCounts = {};
  for (const source of sourceRows) {
    const key = source.priority || "blank";
    sourcePriorityCounts[key] = (sourcePriorityCounts[key] || 0) + 1;
  }
  for (const update of plan.categoryUpdates) {
    const previousKey = update.previousCategory || "blank";
    previousCategoryCounts[previousKey] = (previousCategoryCounts[previousKey] || 0) + 1;
    targetCategoryCounts[update.targetCategory] =
      (targetCategoryCounts[update.targetCategory] || 0) + 1;
  }
  for (const assignment of plan.routeAssignments) {
    const key = `Week ${assignment.assignedWeek}`;
    weekCounts[key] = (weekCounts[key] || 0) + 1;
  }
  const spatialStats = computeSpatialStats(plan.routeAssignments);
  const minExpected =
    plan.routeAssignments.length >= WEEK_COUNT
      ? Math.floor(plan.routeAssignments.length / WEEK_COUNT)
      : 0;
  const maxExpected =
    plan.routeAssignments.length >= WEEK_COUNT
      ? Math.ceil(plan.routeAssignments.length / WEEK_COUNT)
      : 0;
  const countBalanceViolations = Object.entries(weekCounts)
    .filter(([, count]) => count < minExpected || count > maxExpected)
    .map(([week, count]) => ({ week, count, minExpected, maxExpected }));

  return {
    ok: true,
    mode: options.apply ? "apply" : "dry-run",
    assignmentVersion,
    backupPath,
    options: {
      expectedSourceTotal: options.expectedSourceTotal,
      expectedRouteTotal: options.expectedRouteTotal,
      promoteSourceNonAbTo: options.promoteSourceNonAbTo,
      clusterIterations: options.clusterIterations,
      matchScope: options.matchScope,
    },
    sourceTotal: sourceRows.length,
    sourcePriorityCounts,
    justinAccountTotal: plan.justinAccounts.length,
    matchAccountTotal: plan.matchAccounts.length,
    justinRepIdentity: plan.justinRepIdentity,
    matchedSourceTotal: plan.matches.length,
    uniqueMatchedAccountTotal: plan.matchedAccountIds.size,
    unmatchedSourceTotal: plan.unmatched.length,
    ambiguousMatchTotal: plan.ambiguous.length,
    previousCategoryCounts,
    targetCategoryCounts,
    movedJustinAccountsToD: plan.categoryUpdates.filter(
      (update) => update.reason === "justin_not_in_source_list",
    ).length,
    movedSourceAccountsToJustin: plan.categoryUpdates.filter(
      (update) => update.reason === "matched_source_list_reassigned_to_justin",
    ).length,
    routeAccountTotal: plan.routeAssignments.length,
    routeGeocodedTotal: plan.routeAssignments.filter(hasCoordinate).length,
    routeUnmappedTotal: plan.routeAssignments.filter((assignment) => !hasCoordinate(assignment)).length,
    weekCounts,
    countBalanceViolations,
    unmatchedSources: plan.unmatched.map((entry) => ({
      ...entry.source,
      duplicateOnly: entry.duplicateOnly || false,
      topCandidates: entry.topCandidates,
    })),
    duplicateAccountMatches: (() => {
      const sourcesByAccountId = new Map();
      for (const match of plan.matches) {
        const sources = sourcesByAccountId.get(match.account.accountRecordId) || [];
        sources.push(match.source);
        sourcesByAccountId.set(match.account.accountRecordId, sources);
      }
      return [...sourcesByAccountId.entries()]
        .filter(([, sources]) => sources.length > 1)
        .map(([accountId, sources]) => ({ accountId, sources }))
        .slice(0, 25);
    })(),
    ambiguousMatches: plan.ambiguous.slice(0, 25),
    categoryChangeSamples: plan.categoryUpdates
      .filter((update) => update.previousCategory !== update.targetCategory)
      .slice(0, 50)
      .map((update) => ({
        account: summarizeAccount(update.account),
        source: update.source,
        previousCategory: update.previousCategory,
        targetCategory: update.targetCategory,
        reason: update.reason,
      })),
    matchedSamples: plan.matches.slice(0, 25).map((match) => ({
      source: match.source,
      account: summarizeAccount(match.account),
      score: match.score,
      reasons: match.reasons,
    })),
    spatialStats,
    widestWeeks: [...spatialStats].sort((left, right) => right.diameterKm - left.diameterKm),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sqlitePath = path.resolve(options.sqlitePath);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }
  const sourceRows = readSourceRows(options.sourceJsonPath, options.promoteSourceNonAbTo);
  if (sourceRows.length !== options.expectedSourceTotal) {
    throw new Error(
      `Expected ${options.expectedSourceTotal} source rows but found ${sourceRows.length}.`,
    );
  }

  const db = new Database(sqlitePath);
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const assignmentVersion = `${ASSIGNMENT_VERSION_PREFIX}-${safeTimestamp}`;
  let backupPath = null;

  try {
    ensureTables(db);
    const accounts = readAccounts(db);
    const sourceTables = ["account_rows", ...(tableExists(db, "local_account_rows") ? ["local_account_rows"] : [])];
    const plan = buildPlan(sourceRows, accounts, options);
    const routeTotal = plan.routeAssignments.length;
    if (plan.unmatched.length > 0) {
      const message = `${plan.unmatched.length} source companies did not match Justin accounts.`;
      if (options.apply) {
        throw new Error(message);
      }
      process.stderr.write(`${message}\n`);
    }
    if (routeTotal !== options.expectedRouteTotal) {
      const message = `Expected ${options.expectedRouteTotal} Justin route accounts but found ${routeTotal}.`;
      if (options.apply) {
        throw new Error(message);
      }
      process.stderr.write(`${message}\n`);
    }

    if (options.apply) {
      backupPath = await createBackup(db, sqlitePath, safeTimestamp);
      applyUpdates(db, plan, sourceTables, assignmentVersion, timestamp);
    }

    const report = buildReport(options, sourceRows, plan, assignmentVersion, backupPath);
    const output = JSON.stringify(report);
    if (options.reportPath) {
      fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${output}\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
