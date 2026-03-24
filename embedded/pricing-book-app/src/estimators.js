import { google } from "googleapis";

import { config } from "./config.js";

const GOOGLE_SHEETS_READONLY_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const ESTIMATOR_CACHE_TTL_MS = 15 * 60 * 1000;
const FALLBACK_PRICING_BOOK_ESTIMATORS = [
  { id: "E0000024", name: "Derek Yu" },
  { id: "E0000028", name: "Firhaj Bahadur" },
  { id: "E0000050", name: "Julio Alonso Reyes" },
  { id: "E0000077", name: "Shashank Patel" },
  { id: "E0000148", name: "Alexander Gerlewych" }
];

let cachedEstimatorCatalog = null;
let cachedEstimatorCatalogAt = 0;
let googleEstimatorAccessDisableReason = "";
let googleEstimatorAccessDisableLogged = false;

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeEstimatorId(value = "") {
  return cleanString(value).toUpperCase();
}

function normalizeHeaderKey(value = "") {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeEstimatorOption(item = {}, source = "fallback") {
  const id = normalizeEstimatorId(item?.id || item?.estimatorId || item?.employeeId || item?.EstimatorID);
  const name = cleanString(item?.name || item?.estimatorName || item?.employeeName || item?.EstimatorName);
  if (!id || !name) return null;
  return {
    id,
    name,
    label: `${name} (${id})`,
    source: cleanString(item?.source || source)
  };
}

function dedupeEstimatorOptions(items = []) {
  const seen = new Set();
  return items
    .map((item) => normalizeEstimatorOption(item, item?.source))
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeEstimatorId(item.id);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => cleanString(left.name).localeCompare(cleanString(right.name)));
}

function buildFallbackPricingBookEstimators() {
  return dedupeEstimatorOptions(FALLBACK_PRICING_BOOK_ESTIMATORS.map((item) => ({ ...item, source: "fallback" })));
}

function isGoogleReauthError(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.response?.data || {})}`.toLowerCase();
  return /invalid_rapt|invalid_grant|reauth/.test(message);
}

function looksLikeEstimatorId(value = "") {
  return /^e\d{4,}$/i.test(cleanString(value));
}

function buildEstimatorOptionFromRow(row = [], idIndex = -1, nameIndex = -1, sheetTitle = "") {
  const safeRow = Array.isArray(row) ? row.map((cell) => cleanString(cell)) : [];
  const id =
    idIndex >= 0
      ? normalizeEstimatorId(safeRow[idIndex])
      : normalizeEstimatorId(safeRow.find((cell) => looksLikeEstimatorId(cell)));
  if (!looksLikeEstimatorId(id)) return null;
  let name = nameIndex >= 0 ? cleanString(safeRow[nameIndex]) : "";
  if (!name) {
    name = safeRow.find(
      (cell, index) =>
        index !== idIndex &&
        cleanString(cell) &&
        !looksLikeEstimatorId(cell) &&
        !/\bestimator\b/i.test(cell) &&
        /[a-z]/i.test(cell)
    );
  }
  const normalized = normalizeEstimatorOption({ id, name, source: `sheet:${sheetTitle}` }, `sheet:${sheetTitle}`);
  return normalized;
}

function parseEstimatorRows(rows = [], sheetTitle = "") {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row.map((cell) => cleanString(cell)) : []))
    .filter((row) => row.some(Boolean));
  if (!normalizedRows.length) return [];

  let headerIdIndex = -1;
  let headerNameIndex = -1;
  let dataStartIndex = 0;

  for (let rowIndex = 0; rowIndex < Math.min(normalizedRows.length, 8); rowIndex += 1) {
    const headerKeys = normalizedRows[rowIndex].map((cell) => normalizeHeaderKey(cell));
    const candidateIdIndex = headerKeys.findIndex(
      (cell) => cell === "estimatorid" || cell === "employeeid" || cell === "id" || cell === "estimatorcode"
    );
    const candidateNameIndex = headerKeys.findIndex(
      (cell) => cell === "estimatorname" || cell === "name" || cell === "employee" || cell === "employeename" || cell === "estimator"
    );
    if (candidateIdIndex >= 0 && candidateNameIndex >= 0) {
      headerIdIndex = candidateIdIndex;
      headerNameIndex = candidateNameIndex;
      dataStartIndex = rowIndex + 1;
      break;
    }
  }

  const items = [];
  for (let rowIndex = dataStartIndex; rowIndex < normalizedRows.length; rowIndex += 1) {
    const option = buildEstimatorOptionFromRow(normalizedRows[rowIndex], headerIdIndex, headerNameIndex, sheetTitle);
    if (option) items.push(option);
  }

  return dedupeEstimatorOptions(items);
}

function scoreEstimatorSheetTitle(title = "") {
  const normalized = cleanString(title).toLowerCase();
  if (!normalized) return 0;
  if (/estimators?/.test(normalized)) return 100;
  if (/employees?|staff|team|people|lookup|lists?/.test(normalized)) return 60;
  if (/master|summary|setup|config/.test(normalized)) return 20;
  return 0;
}

function escapeSheetTitle(title = "") {
  return cleanString(title).replace(/'/g, "''");
}

async function loadEstimatorsFromGoogleSheet() {
  const auth = new google.auth.GoogleAuth({
    scopes: GOOGLE_SHEETS_READONLY_SCOPES
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: config.masterSheetId,
    fields: "sheets.properties(title)"
  });
  const titles = (Array.isArray(spreadsheet.data?.sheets) ? spreadsheet.data.sheets : [])
    .map((sheet) => cleanString(sheet?.properties?.title))
    .filter(Boolean);
  if (!titles.length) return [];

  const prioritizedTitles = [...titles].sort((left, right) => scoreEstimatorSheetTitle(right) - scoreEstimatorSheetTitle(left));
  const firstPassTitles = prioritizedTitles.filter((title) => scoreEstimatorSheetTitle(title) > 0);
  const scanTitles = (firstPassTitles.length ? firstPassTitles : prioritizedTitles).slice(0, 24);
  const batchRanges = scanTitles.map((title) => `'${escapeSheetTitle(title)}'!A1:H200`);
  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.masterSheetId,
    ranges: batchRanges,
    majorDimension: "ROWS"
  });
  const firstPassItems = [];
  (Array.isArray(batch.data?.valueRanges) ? batch.data.valueRanges : []).forEach((valueRange, index) => {
    firstPassItems.push(...parseEstimatorRows(valueRange?.values || [], scanTitles[index]));
  });
  const uniqueFirstPass = dedupeEstimatorOptions(firstPassItems);
  if (uniqueFirstPass.length) return uniqueFirstPass;

  if (scanTitles.length >= prioritizedTitles.length) return [];

  const remainingTitles = prioritizedTitles.filter((title) => !scanTitles.includes(title)).slice(0, 24);
  if (!remainingTitles.length) return [];
  const remainingBatch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.masterSheetId,
    ranges: remainingTitles.map((title) => `'${escapeSheetTitle(title)}'!A1:H200`),
    majorDimension: "ROWS"
  });
  const remainingItems = [];
  (Array.isArray(remainingBatch.data?.valueRanges) ? remainingBatch.data.valueRanges : []).forEach((valueRange, index) => {
    remainingItems.push(...parseEstimatorRows(valueRange?.values || [], remainingTitles[index]));
  });
  return dedupeEstimatorOptions(remainingItems);
}

export async function loadPricingBookEstimatorCatalog({ force = false, logger = console } = {}) {
  const now = Date.now();
  if (!force && cachedEstimatorCatalog && now - cachedEstimatorCatalogAt < ESTIMATOR_CACHE_TTL_MS) {
    return cachedEstimatorCatalog;
  }

  let catalog = [];
  try {
    catalog = await loadEstimatorsFromGoogleSheet();
    googleEstimatorAccessDisableReason = "";
    googleEstimatorAccessDisableLogged = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown Google Sheets error");
    if (isGoogleReauthError(error)) {
      googleEstimatorAccessDisableReason = "Google OAuth re-authentication is required for live estimator catalog reads.";
    } else {
      googleEstimatorAccessDisableReason = message;
    }
    if (!googleEstimatorAccessDisableLogged && typeof logger?.warn === "function") {
      logger.warn(`[estimators] Unable to load live pricing-book estimators. Using fallback list. ${googleEstimatorAccessDisableReason}`);
      googleEstimatorAccessDisableLogged = true;
    }
  }

  if (!catalog.length) {
    catalog = buildFallbackPricingBookEstimators();
  }

  cachedEstimatorCatalog = dedupeEstimatorOptions(catalog);
  cachedEstimatorCatalogAt = now;
  return cachedEstimatorCatalog;
}

export function resolvePricingBookEstimatorName(value = "", options = {}) {
  const estimatorId = normalizeEstimatorId(value);
  if (!estimatorId) return "";
  const directCatalog = Array.isArray(options?.catalog) ? options.catalog : [];
  const catalogMatch = directCatalog.find((item) => normalizeEstimatorId(item?.id) === estimatorId);
  if (catalogMatch?.name) return cleanString(catalogMatch.name);
  const lookup = options?.lookup instanceof Map ? options.lookup : null;
  if (lookup?.has(estimatorId)) {
    return cleanString(lookup.get(estimatorId));
  }
  const fallbackMatch = buildFallbackPricingBookEstimators().find((item) => normalizeEstimatorId(item?.id) === estimatorId);
  return cleanString(fallbackMatch?.name || estimatorId);
}

export { buildFallbackPricingBookEstimators };

export const __test__ = {
  buildFallbackPricingBookEstimators,
  parseEstimatorRows,
  resolvePricingBookEstimatorName
};
