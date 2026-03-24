import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import OpenAI from "openai";

import { config } from "./config.js";
import { normalizeDivisionId } from "./quoteBuilder.js";
import {
  deleteEstimateLibraryPreset,
  deleteEstimateLibraryQuote,
  getEstimateLibraryFileRecord,
  getEstimateLibraryStoreInfo,
  getEstimateLibrarySyncRun,
  getLatestEstimateLibrarySyncRun,
  listEstimateLibraryLineItemsByQuoteAndTrade,
  listEstimateLibraryLineItemsByPresetKey,
  listEstimateLibraryOpenReviews,
  listEstimateLibraryPresetsByTrade,
  listEstimateLibraryQuotesByTrade,
  replaceEstimateLibraryLineItemsForFile,
  replaceEstimateLibraryReviewsForFile,
  upsertEstimateLibraryFileRecord,
  upsertEstimateLibraryPreset,
  upsertEstimateLibraryQuote,
  upsertEstimateLibrarySyncRun
} from "./estimateLibraryStore.js";

const MAIN_QUOTE_SHEET_TITLE = "Main Quote";
const ESTIMATE_LIBRARY_PARSER_VERSION = "main-quote-v2";
const GOOGLE_ESTIMATE_LIBRARY_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly"
];
const GOOGLE_SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DIVISION_IDS = new Set(["construction", "electrical", "plumbing", "hvac", "glendale"]);

let openAiClient = null;
let activeEstimateLibrarySyncPromise = null;
let estimateLibraryAutoSyncHandle = null;

function cleanString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** Math.max(0, Number(decimals) || 0);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * factor) / factor;
}

function parseNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const raw = cleanString(value)
    .replace(/[$,%]/g, "")
    .replace(/\(([^)]+)\)/g, "-$1")
    .replace(/,/g, "");
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return parsed;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const recovered = Number(match[0]);
  return Number.isFinite(recovered) ? recovered : fallback;
}

function collapseWhitespace(value = "") {
  return cleanString(value).replace(/\s+/g, " ");
}

function hashText(value = "", length = 16) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, Math.max(6, length));
}

function normalizeKey(value = "") {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDescriptionKey(value = "") {
  return normalizeKey(value)
    .replace(/^\d+(?:\.\d+)+\s+/g, "")
    .replace(/^\d+\.\s+/g, "")
    .replace(/^(project manager|project coordinator|site supervisor)\b/g, "$1")
    .trim();
}

function buildDocId(prefix, parts = []) {
  return `${cleanString(prefix)}_${hashText(parts.join("|"), 24)}`;
}

function tokenize(value = "") {
  return normalizeKey(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function buildTokenSet(value = "") {
  return new Set(tokenize(value));
}

function computeDiceCoefficient(left = "", right = "") {
  const normalizedLeft = normalizeKey(left).replace(/\s+/g, "");
  const normalizedRight = normalizeKey(right).replace(/\s+/g, "");
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const buildBigrams = (text) => {
    if (text.length < 2) return [text];
    const bigrams = [];
    for (let index = 0; index < text.length - 1; index += 1) {
      bigrams.push(text.slice(index, index + 2));
    }
    return bigrams;
  };
  const leftBigrams = buildBigrams(normalizedLeft);
  const rightBigrams = buildBigrams(normalizedRight);
  const rightCounts = new Map();
  rightBigrams.forEach((gram) => {
    rightCounts.set(gram, (rightCounts.get(gram) || 0) + 1);
  });
  let overlap = 0;
  leftBigrams.forEach((gram) => {
    const current = rightCounts.get(gram) || 0;
    if (current > 0) {
      overlap += 1;
      rightCounts.set(gram, current - 1);
    }
  });
  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function computeTokenOverlapScore(left = "", right = "") {
  const leftTokens = buildTokenSet(left);
  const rightTokens = buildTokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function computeLexicalSimilarity(left = "", right = "") {
  const normalizedLeft = normalizeDescriptionKey(left);
  const normalizedRight = normalizeDescriptionKey(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const tokenScore = computeTokenOverlapScore(normalizedLeft, normalizedRight);
  const diceScore = computeDiceCoefficient(normalizedLeft, normalizedRight);
  const includesBoost =
    normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? 0.18 : 0;
  return Math.min(1, roundNumber(tokenScore * 0.55 + diceScore * 0.45 + includesBoost, 4));
}

function computeCosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue ** 2;
    rightMagnitude += rightValue ** 2;
  }
  if (leftMagnitude <= 0 || rightMagnitude <= 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  toArray(values)
    .map((item) => cleanString(item))
    .filter(Boolean)
    .forEach((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
  return result;
}

function median(values = []) {
  const numbers = toArray(values)
    .map((value) => parseNumber(value, Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 0) {
    return roundNumber((numbers[middle - 1] + numbers[middle]) / 2, 2);
  }
  return roundNumber(numbers[middle], 2);
}

function statRange(values = []) {
  const numbers = toArray(values)
    .map((value) => parseNumber(value, Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numbers.length) {
    return { count: 0, min: 0, max: 0, median: 0 };
  }
  return {
    count: numbers.length,
    min: roundNumber(numbers[0], 2),
    max: roundNumber(numbers[numbers.length - 1], 2),
    median: median(numbers)
  };
}

function normalizeTrade(raw = "") {
  const normalized = normalizeDivisionId(raw);
  return DIVISION_IDS.has(normalized) ? normalized : "";
}

function inferTradeFromText(raw = "") {
  const text = normalizeKey(raw);
  if (!text) return "";
  if (text.includes("construction") || text.includes("general labour") || text.includes("demolition")) return "construction";
  if (text.includes("electrical") || text.includes("wire") || text.includes("panel")) return "electrical";
  if (text.includes("plumbing") || text.includes("pipe") || text.includes("valve")) return "plumbing";
  if (text.includes("hvac") || text.includes("mechanical") || text.includes("duct") || text.includes("rtu")) return "hvac";
  if (text.includes("glendale") || text.includes("architect") || text.includes("engineer")) return "glendale";
  return "";
}

function normalizeSpreadsheetRows(values = []) {
  return toArray(values).map((row) => toArray(row).map((cell) => collapseWhitespace(cell)));
}

function getCell(row = [], index = -1) {
  if (!Array.isArray(row) || index < 0 || index >= row.length) return "";
  return cleanString(row[index]);
}

function normalizeHeaderCell(value = "") {
  return cleanString(value)
    .toLowerCase()
    .replace(/[\s$/%.-]+/g, "")
    .trim();
}

function findMainQuoteHeaderRow(rows = []) {
  let bestIndex = -1;
  let bestScore = 0;
  rows.forEach((row, index) => {
    const normalized = row.map((cell) => normalizeHeaderCell(cell));
    let score = 0;
    if (normalized.some((cell) => cell === "trade")) score += 2;
    if (normalized.some((cell) => cell === "item")) score += 2;
    if (normalized.some((cell) => cell === "description")) score += 3;
    if (normalized.some((cell) => cell === "lbrhrs" || cell === "labourhrs" || cell === "laborhrs")) score += 3;
    if (normalized.some((cell) => cell === "matcost" || cell === "materialcost")) score += 2;
    if (normalized.some((cell) => cell === "selling" || cell === "totalsell" || cell === "sell")) score += 2;
    if (normalized.some((cell) => cell === "mkpercent" || cell === "markup")) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= 6 ? bestIndex : -1;
}

function buildMainQuoteColumnMap(headerRow = []) {
  const normalizedHeaders = headerRow.map((cell) => normalizeHeaderCell(cell));
  const findIndices = (predicate) =>
    normalizedHeaders
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell, index }) => predicate(cell, index))
      .map(({ index }) => index);
  const findFirst = (predicate, fallback = -1) => {
    const match = normalizedHeaders.findIndex((cell, index) => predicate(cell, index));
    return match >= 0 ? match : fallback;
  };

  const materialIndices = findIndices((cell) => cell === "matcost" || cell === "materialcost" || cell === "material");
  const subIndices = findIndices((cell) => cell === "subs" || cell === "subtrade" || cell === "subcontractor");
  const costIndices = findIndices((cell) => cell === "cost" || cell === "totalcost");
  const sellIndices = findIndices((cell) => cell === "selling" || cell === "sell" || cell === "totalsell");

  const trade = findFirst((cell) => cell === "trade", 0);
  const itemCode = findFirst((cell) => cell === "item" || cell === "code" || cell === "itemcode", 1);
  const description = findFirst((cell) => cell === "description" || cell === "scope" || cell === "scopeofwork", 2);
  const labourHours = findFirst((cell) => cell === "lbrhrs" || cell === "labourhrs" || cell === "laborhrs" || cell === "hours", 3);
  const materialCost = materialIndices.find((index) => index > labourHours) ?? 4;
  const subtradeCost = subIndices.find((index) => index > materialCost) ?? 5;
  const totalCost = costIndices.find((index) => index > subtradeCost) ?? 6;
  const markupPercent = findFirst((cell) => cell === "mkpercent" || cell === "markup" || cell === "mk", 7);
  const ratePerHour = findFirst(
    (cell) => cell === "rateperhr" || cell === "rateperhour" || cell === "ratephr" || cell === "rate",
    8
  );
  const materialSell = materialIndices.find((index) => index > ratePerHour) ?? 9;
  const subtradeSell = subIndices.find((index) => index > materialSell) ?? 10;
  const labourSell = findFirst((cell) => cell === "hrs" || cell === "hrs" || cell === "laboursell" || cell === "hourssell", 11);
  const totalSell = sellIndices.find((index) => index > labourSell) ?? 12;

  return {
    trade,
    itemCode,
    description,
    labourHours,
    materialCost,
    subtradeCost,
    totalCost,
    markupPercent,
    ratePerHour,
    materialSell,
    subtradeSell,
    labourSell,
    totalSell
  };
}

function extractTradeFromSectionHeading(text = "") {
  const source = collapseWhitespace(text);
  const match = source.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
  const headingNumber = cleanString(match?.[1]);
  if (!headingNumber || !cleanString(match?.[2])) return "";
  if (headingNumber.includes(".") && !/\.0+$/.test(headingNumber)) return "";
  return normalizeTrade(match[2]) || inferTradeFromText(match[2]);
}

function isMainQuoteTableHeaderRow(row = []) {
  return findMainQuoteHeaderRow([toArray(row).map((cell) => collapseWhitespace(cell))]) === 0;
}

function extractScopeLineNumber(text = "") {
  const match = collapseWhitespace(text).match(/^(\d+(?:\.\d+)*\.?)\s+/);
  return cleanString(match?.[1]).replace(/\.$/, "");
}

function stripScopeLineNumber(text = "") {
  return collapseWhitespace(text)
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .trim();
}

function isScopeContinuationLine(text = "") {
  const body = stripScopeLineNumber(text);
  if (!body) return false;
  if (/^(and|or|including|plus|with|to)\b/i.test(body)) return true;
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  return wordCount <= 3 && /^[a-z]/.test(body);
}

function buildScopeLineRecord(text = "", index = 0) {
  const rawText = collapseWhitespace(text);
  const sourceText = stripScopeLineNumber(rawText) || rawText;
  const lineNumber = extractScopeLineNumber(rawText) || String(index + 1);
  return {
    scopeLineKey: buildDocId("scope", [lineNumber, sourceText, String(index + 1)]),
    lineNumber,
    sourceText,
    normalizedText: sourceText
  };
}

function normalizeTradeSectionScopeLines(rawLines = []) {
  const normalized = [];
  toArray(rawLines).forEach((line) => {
    const collapsed = collapseWhitespace(line);
    if (!collapsed || /^scope(?: of work)?$/i.test(collapsed)) return;
    if (normalized.length && isScopeContinuationLine(collapsed)) {
      const previous = normalized[normalized.length - 1];
      previous.sourceText = collapseWhitespace(`${previous.sourceText} ${stripScopeLineNumber(collapsed)}`);
      previous.normalizedText = previous.sourceText;
      return;
    }
    normalized.push(buildScopeLineRecord(collapsed, normalized.length));
  });
  return normalized.map((line, index) => ({
    ...line,
    scopeLineKey: cleanString(line.scopeLineKey || buildDocId("scope", [line.lineNumber, line.sourceText, String(index + 1)])),
    lineNumber: cleanString(line.lineNumber || String(index + 1)),
    sourceText: cleanString(line.sourceText),
    normalizedText: cleanString(line.normalizedText || line.sourceText)
  }));
}

function buildScopeMetaFromTradeSections(tradeSections = []) {
  const sectionScopes = {};
  const globalScopeLines = [];
  toArray(tradeSections).forEach((section) => {
    const trade = cleanString(section?.trade);
    const scopeLines = toArray(section?.scopeLines)
      .map((line) => cleanString(line?.sourceText || line?.text || line))
      .filter(Boolean);
    if (trade) {
      if (!Array.isArray(sectionScopes[trade])) {
        sectionScopes[trade] = [];
      }
      sectionScopes[trade].push(...scopeLines);
    } else {
      globalScopeLines.push(...scopeLines);
    }
  });
  return {
    sectionScopes,
    globalScopeLines
  };
}

function buildComputedSectionSubtotal(tableLineItems = []) {
  return {
    label: "Subtotals",
    labourHours: roundNumber(
      toArray(tableLineItems).reduce((sum, item) => sum + parseNumber(item?.labourHours, 0), 0),
      2
    ),
    materialCost: roundNumber(
      toArray(tableLineItems).reduce((sum, item) => sum + parseNumber(item?.materialCost, 0), 0),
      2
    ),
    subtradeCost: roundNumber(
      toArray(tableLineItems).reduce((sum, item) => sum + parseNumber(item?.subtradeCost, 0), 0),
      2
    ),
    totalCost: roundNumber(
      toArray(tableLineItems).reduce((sum, item) => sum + parseNumber(item?.totalCost, 0), 0),
      2
    ),
    totalSell: roundNumber(
      toArray(tableLineItems).reduce((sum, item) => sum + parseNumber(item?.totalSell, 0), 0),
      2
    )
  };
}

function parseMainQuoteTradeSections(rows = [], fileMeta = {}) {
  const normalizedRows = normalizeSpreadsheetRows(rows);
  const quoteId = cleanString(fileMeta.id);
  const sections = [];
  const lineItems = [];
  const reviews = [];
  const sectionRollups = [];
  const presetKeys = new Set();

  for (let rowIndex = 0; rowIndex < normalizedRows.length; ) {
    const row = normalizedRows[rowIndex];
    const joined = collapseWhitespace(row.filter(Boolean).join(" "));
    const trade = extractTradeFromSectionHeading(joined);
    if (!trade) {
      rowIndex += 1;
      continue;
    }

    const rowStart = rowIndex;
    const sectionHeading = joined;
    rowIndex += 1;

    const rawScopeLines = [];
    let tableHeaderRowIndex = -1;
    while (rowIndex < normalizedRows.length) {
      const currentRow = normalizedRows[rowIndex];
      const currentText = collapseWhitespace(currentRow.filter(Boolean).join(" "));
      if (!currentText) {
        rowIndex += 1;
        continue;
      }
      if (extractTradeFromSectionHeading(currentText)) break;
      if (isMainQuoteTableHeaderRow(currentRow)) {
        tableHeaderRowIndex = rowIndex;
        break;
      }
      if (!/^scope(?: of work)?$/i.test(currentText)) {
        rawScopeLines.push(currentText);
      }
      rowIndex += 1;
    }

    if (tableHeaderRowIndex < 0) {
      sections.push({
        id: buildDocId("section", [quoteId, trade, sectionHeading, String(rowStart)]),
        quoteId,
        trade,
        sectionHeading,
        scopeLines: normalizeTradeSectionScopeLines(rawScopeLines),
        scopeText: normalizeTradeSectionScopeLines(rawScopeLines)
          .map((line) => cleanString(line?.sourceText))
          .filter(Boolean)
          .join("\n"),
        normalizedScopeText: normalizeDescriptionKey(rawScopeLines.join(" ")),
        tableLineItems: [],
        subtotal: buildComputedSectionSubtotal([]),
        rowStart,
        rowEnd: Math.max(rowStart, rowIndex - 1),
        tableHeaderRowIndex: -1,
        sourceFileId: cleanString(fileMeta.id),
        fileName: cleanString(fileMeta.name),
        fileUrl: cleanString(fileMeta.webViewLink),
        updatedAt: nowIso()
      });
      continue;
    }

    const scopeLines = normalizeTradeSectionScopeLines(rawScopeLines);
    const columnMap = buildMainQuoteColumnMap(normalizedRows[tableHeaderRowIndex]);
    rowIndex = tableHeaderRowIndex + 1;
    const tableLineItems = [];
    let subtotal = null;

    while (rowIndex < normalizedRows.length) {
      const currentRow = normalizedRows[rowIndex];
      const currentText = collapseWhitespace(currentRow.filter(Boolean).join(" "));
      if (!currentText) {
        rowIndex += 1;
        continue;
      }
      if (extractTradeFromSectionHeading(currentText)) break;
      if (isMainQuoteTableHeaderRow(currentRow)) {
        rowIndex += 1;
        continue;
      }

      const rowTradeText = getCell(currentRow, columnMap.trade);
      const itemCode = getCell(currentRow, columnMap.itemCode);
      const description = collapseWhitespace(getCell(currentRow, columnMap.description) || itemCode || currentText);
      const numericFields = {
        labourHours: parseNumber(getCell(currentRow, columnMap.labourHours), 0),
        materialCost: parseNumber(getCell(currentRow, columnMap.materialCost), 0),
        subtradeCost: parseNumber(getCell(currentRow, columnMap.subtradeCost), 0),
        totalCost: parseNumber(getCell(currentRow, columnMap.totalCost), 0),
        markupPercent: parseNumber(getCell(currentRow, columnMap.markupPercent), 0),
        ratePerHour: parseNumber(getCell(currentRow, columnMap.ratePerHour), 0),
        materialSell: parseNumber(getCell(currentRow, columnMap.materialSell), 0),
        subtradeSell: parseNumber(getCell(currentRow, columnMap.subtradeSell), 0),
        labourSell: parseNumber(getCell(currentRow, columnMap.labourSell), 0),
        totalSell: parseNumber(getCell(currentRow, columnMap.totalSell), 0)
      };
      const numericCount = Object.values(numericFields).filter((value) => Math.abs(parseNumber(value, 0)) > 0).length;

      if (isRollupRow(`${rowTradeText} ${description}`)) {
        subtotal = {
          label: description || "Subtotals",
          rowIndex,
          rawRow: currentRow,
          ...buildComputedSectionSubtotal(tableLineItems),
          totalCost: roundNumber(
            numericFields.totalCost || numericFields.materialCost + numericFields.subtradeCost,
            2
          ),
          totalSell: roundNumber(
            numericFields.totalSell ||
              numericFields.materialSell + numericFields.subtradeSell + numericFields.labourSell,
            2
          )
        };
        sectionRollups.push({
          trade,
          label: cleanString(subtotal.label),
          rowIndex,
          rawRow: currentRow,
          totalCost: subtotal.totalCost,
          totalSell: subtotal.totalSell,
          updatedAt: nowIso()
        });
        rowIndex += 1;
        break;
      }

      if (numericCount === 0 || !description) {
        reviews.push(
          buildReviewRecord(fileMeta, quoteId, rowIndex, "Row had no measurable estimate values.", currentRow, {
            trade,
            description
          })
        );
        rowIndex += 1;
        continue;
      }

      const confidence = computeParseConfidence({
        trade,
        description,
        numericCount,
        row: currentRow
      });
      const lineItem = buildLineItemRecord(fileMeta, quoteId, rowIndex, currentRow, {
        trade,
        itemCode,
        description,
        confidence,
        ...numericFields
      });
      lineItems.push(lineItem);
      tableLineItems.push(lineItem);
      if (lineItem.presetKey) {
        presetKeys.add(lineItem.presetKey);
      }
      if (!lineItem.description || confidence < 0.55) {
        reviews.push(
          buildReviewRecord(fileMeta, quoteId, rowIndex, "Low-confidence line item extraction.", currentRow, {
            trade: lineItem.trade,
            description: lineItem.description,
            confidence: lineItem.confidence
          })
        );
      }
      rowIndex += 1;
    }

    const computedSubtotal = subtotal || buildComputedSectionSubtotal(tableLineItems);
    const scopeText = scopeLines.map((line) => cleanString(line?.sourceText)).filter(Boolean).join("\n");
    sections.push({
      id: buildDocId("section", [quoteId, trade, sectionHeading, String(rowStart)]),
      quoteId,
      trade,
      sectionHeading,
      scopeLines,
      scopeText,
      normalizedScopeText: normalizeDescriptionKey(scopeText),
      tableLineItems,
      subtotal: computedSubtotal,
      rowStart,
      rowEnd: Math.max(rowStart, rowIndex - 1),
      tableHeaderRowIndex,
      sourceFileId: cleanString(fileMeta.id),
      fileName: cleanString(fileMeta.name),
      fileUrl: cleanString(fileMeta.webViewLink),
      updatedAt: nowIso()
    });
  }

  return {
    tradeSections: sections,
    lineItems,
    reviews,
    sectionRollups,
    presetKeys: [...presetKeys]
  };
}

function collectScopeMetadata(rows = [], headerRowIndex = 0) {
  const sectionScopes = {};
  const globalScopeLines = [];
  let currentTrade = "";
  let collectingScope = false;

  rows.slice(0, Math.max(0, headerRowIndex)).forEach((row) => {
    const nonEmptyCells = row.map((cell) => cleanString(cell)).filter(Boolean);
    const joined = collapseWhitespace(nonEmptyCells.join(" "));
    if (!joined) return;

    const headingTrade = extractTradeFromSectionHeading(joined);
    if (headingTrade) {
      currentTrade = headingTrade;
      collectingScope = false;
      if (!Array.isArray(sectionScopes[currentTrade])) {
        sectionScopes[currentTrade] = [];
      }
      return;
    }

    if (/^scope of work$/i.test(joined) || /^scope$/i.test(joined)) {
      collectingScope = true;
      return;
    }

    if (!collectingScope) return;

    if (currentTrade) {
      if (!Array.isArray(sectionScopes[currentTrade])) {
        sectionScopes[currentTrade] = [];
      }
      sectionScopes[currentTrade].push(joined);
      return;
    }
    globalScopeLines.push(joined);
  });

  return {
    sectionScopes,
    globalScopeLines
  };
}

function isRollupRow(text = "") {
  const source = normalizeKey(text);
  return Boolean(source) && /\bsubtotal\b|\bsubtotals\b|\btotal\b|\bmargin\b/.test(source);
}

function isLikelyHeaderRepeat(text = "") {
  const source = normalizeHeaderCell(text);
  return source === "tradeitemdescriptionlbrhrsmatcostsubscostmkpercentrateperhrmaterialsubshrsselling";
}

function computeParseConfidence({ trade = "", description = "", numericCount = 0, row = [] } = {}) {
  let score = 0.25;
  if (trade && trade !== "unknown") score += 0.3;
  if (description) score += 0.25;
  if (numericCount >= 3) score += 0.15;
  if (toArray(row).length >= 6) score += 0.05;
  return roundNumber(Math.min(0.99, score), 2);
}

function buildReviewRecord(fileMeta = {}, quoteId = "", rowIndex = -1, reason = "", row = [], extra = {}) {
  return {
    id: buildDocId("review", [fileMeta.id, String(rowIndex), cleanString(reason), JSON.stringify(row)]),
    sourceFileId: cleanString(fileMeta.id),
    quoteId: cleanString(quoteId || fileMeta.id),
    fileName: cleanString(fileMeta.name),
    fileUrl: cleanString(fileMeta.webViewLink),
    rowIndex,
    reason: cleanString(reason),
    rawRow: toArray(row),
    status: "open",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...extra
  };
}

function buildLineItemRecord(fileMeta = {}, quoteId = "", rowIndex = -1, row = [], values = {}) {
  const trade = cleanString(values.trade || "unknown");
  const description = cleanString(values.description);
  const normalizedDescriptionKey = normalizeDescriptionKey(description);
  const presetKey = trade && DIVISION_IDS.has(trade) && normalizedDescriptionKey ? `${trade}|${normalizedDescriptionKey}` : "";
  return {
    id: buildDocId("line", [fileMeta.id, String(rowIndex), trade, normalizedDescriptionKey || description || JSON.stringify(row)]),
    sourceFileId: cleanString(fileMeta.id),
    quoteId: cleanString(quoteId || fileMeta.id),
    fileName: cleanString(fileMeta.name),
    fileUrl: cleanString(fileMeta.webViewLink),
    fileModifiedTime: cleanString(fileMeta.modifiedTime),
    drivePath: toArray(fileMeta.path),
    trade,
    itemCode: cleanString(values.itemCode),
    description,
    normalizedDescriptionKey,
    presetKey,
    labourHours: roundNumber(values.labourHours, 2),
    materialCost: roundNumber(values.materialCost, 2),
    subtradeCost: roundNumber(values.subtradeCost, 2),
    totalCost: roundNumber(values.totalCost, 2),
    markupPercent: roundNumber(values.markupPercent, 2),
    ratePerHour: roundNumber(values.ratePerHour, 2),
    materialSell: roundNumber(values.materialSell, 2),
    subtradeSell: roundNumber(values.subtradeSell, 2),
    labourSell: roundNumber(values.labourSell, 2),
    totalSell: roundNumber(values.totalSell, 2),
    confidence: roundNumber(values.confidence, 2),
    rawRow: toArray(row),
    sheetTitle: MAIN_QUOTE_SHEET_TITLE,
    rowIndex,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function parseMainQuoteSheet(rows = [], fileMeta = {}) {
  const normalizedRows = normalizeSpreadsheetRows(rows);
  const headerRowIndex = findMainQuoteHeaderRow(normalizedRows);
  const sectionParsed = parseMainQuoteTradeSections(normalizedRows, fileMeta);
  if (toArray(sectionParsed?.tradeSections).length) {
    const scopeMeta = buildScopeMetaFromTradeSections(sectionParsed.tradeSections);
    const quoteTotals = {
      labourHours: roundNumber(sectionParsed.lineItems.reduce((sum, item) => sum + parseNumber(item.labourHours, 0), 0), 2),
      materialCost: roundNumber(sectionParsed.lineItems.reduce((sum, item) => sum + parseNumber(item.materialCost, 0), 0), 2),
      subtradeCost: roundNumber(sectionParsed.lineItems.reduce((sum, item) => sum + parseNumber(item.subtradeCost, 0), 0), 2),
      totalCost: roundNumber(sectionParsed.lineItems.reduce((sum, item) => sum + parseNumber(item.totalCost, 0), 0), 2),
      totalSell: roundNumber(sectionParsed.lineItems.reduce((sum, item) => sum + parseNumber(item.totalSell, 0), 0), 2)
    };
    return {
      quoteRecord: {
        id: cleanString(fileMeta.id),
        fileId: cleanString(fileMeta.id),
        fileName: cleanString(fileMeta.name),
        fileUrl: cleanString(fileMeta.webViewLink),
        fileModifiedTime: cleanString(fileMeta.modifiedTime),
        drivePath: toArray(fileMeta.path),
        sheetTitle: MAIN_QUOTE_SHEET_TITLE,
        parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION,
        headerRowIndex,
        sectionScopes: scopeMeta.sectionScopes,
        globalScopeLines: scopeMeta.globalScopeLines,
        sectionRollups: sectionParsed.sectionRollups,
        tradeSections: sectionParsed.tradeSections,
        sectionTrades: uniqueStrings(sectionParsed.tradeSections.map((section) => cleanString(section?.trade))),
        lineItemCount: sectionParsed.lineItems.length,
        reviewCount: sectionParsed.reviews.length,
        totals: quoteTotals,
        updatedAt: nowIso()
      },
      lineItems: sectionParsed.lineItems,
      reviews: sectionParsed.reviews,
      presetKeys: sectionParsed.presetKeys
    };
  }
  const scopeMeta = collectScopeMetadata(normalizedRows, headerRowIndex >= 0 ? headerRowIndex : normalizedRows.length);
  const quoteId = cleanString(fileMeta.id);
  const reviews = [];
  const lineItems = [];
  const sectionRollups = [];
  const presetKeys = new Set();

  if (headerRowIndex < 0) {
    reviews.push(
      buildReviewRecord(fileMeta, quoteId, -1, "Main Quote header row was not detected.", normalizedRows[0] || [])
    );
    return {
      quoteRecord: {
        id: quoteId,
        fileId: quoteId,
        fileName: cleanString(fileMeta.name),
        fileUrl: cleanString(fileMeta.webViewLink),
        fileModifiedTime: cleanString(fileMeta.modifiedTime),
        drivePath: toArray(fileMeta.path),
        sheetTitle: MAIN_QUOTE_SHEET_TITLE,
        parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION,
        headerRowIndex,
        sectionScopes: scopeMeta.sectionScopes,
        globalScopeLines: scopeMeta.globalScopeLines,
        sectionRollups,
        tradeSections: [],
        sectionTrades: uniqueStrings(Object.keys(scopeMeta.sectionScopes)),
        lineItemCount: 0,
        reviewCount: reviews.length,
        totals: {
          labourHours: 0,
          materialCost: 0,
          subtradeCost: 0,
          totalCost: 0,
          totalSell: 0
        },
        updatedAt: nowIso()
      },
      lineItems,
      reviews,
      presetKeys: []
    };
  }

  const columnMap = buildMainQuoteColumnMap(normalizedRows[headerRowIndex]);
  const scopeTrades = Object.keys(scopeMeta.sectionScopes).filter(Boolean);
  const defaultTrade =
    scopeTrades.length === 1 ? scopeTrades[0] : inferTradeFromText(fileMeta.name || scopeMeta.globalScopeLines.join(" "));
  let currentTrade = defaultTrade;

  for (let rowIndex = headerRowIndex + 1; rowIndex < normalizedRows.length; rowIndex += 1) {
    const row = normalizedRows[rowIndex];
    const joined = collapseWhitespace(row.filter(Boolean).join(" "));
    if (!joined || isLikelyHeaderRepeat(joined)) continue;

    const rowTradeText = getCell(row, columnMap.trade);
    const rowTrade = normalizeTrade(rowTradeText) || extractTradeFromSectionHeading(joined) || inferTradeFromText(rowTradeText);
    const itemCode = getCell(row, columnMap.itemCode);
    const description = collapseWhitespace(getCell(row, columnMap.description) || itemCode || joined);
    const numericFields = {
      labourHours: parseNumber(getCell(row, columnMap.labourHours), 0),
      materialCost: parseNumber(getCell(row, columnMap.materialCost), 0),
      subtradeCost: parseNumber(getCell(row, columnMap.subtradeCost), 0),
      totalCost: parseNumber(getCell(row, columnMap.totalCost), 0),
      markupPercent: parseNumber(getCell(row, columnMap.markupPercent), 0),
      ratePerHour: parseNumber(getCell(row, columnMap.ratePerHour), 0),
      materialSell: parseNumber(getCell(row, columnMap.materialSell), 0),
      subtradeSell: parseNumber(getCell(row, columnMap.subtradeSell), 0),
      labourSell: parseNumber(getCell(row, columnMap.labourSell), 0),
      totalSell: parseNumber(getCell(row, columnMap.totalSell), 0)
    };
    const numericCount = Object.values(numericFields).filter((value) => Math.abs(parseNumber(value, 0)) > 0).length;

    if (rowTrade && numericCount === 0 && description.split(/\s+/).length <= 6 && description.toLowerCase() === rowTradeText.toLowerCase()) {
      currentTrade = rowTrade;
      continue;
    }
    if (rowTrade) {
      currentTrade = rowTrade;
    }

    if (isRollupRow(`${rowTradeText} ${description}`)) {
      sectionRollups.push({
        trade: currentTrade || rowTrade || "unknown",
        label: description,
        rowIndex,
        rawRow: row,
        totalCost: roundNumber(numericFields.totalCost || numericFields.materialCost + numericFields.subtradeCost, 2),
        totalSell: roundNumber(numericFields.totalSell || numericFields.materialSell + numericFields.subtradeSell + numericFields.labourSell, 2),
        updatedAt: nowIso()
      });
      continue;
    }

    if (numericCount === 0) {
      reviews.push(
        buildReviewRecord(fileMeta, quoteId, rowIndex, "Row had no measurable estimate values.", row, {
          trade: currentTrade || rowTrade || "unknown",
          description
        })
      );
      continue;
    }

    if (!description) {
      continue;
    }

    const effectiveTrade =
      normalizeTrade(currentTrade) ||
      normalizeTrade(rowTrade) ||
      normalizeTrade(defaultTrade) ||
      inferTradeFromText(description) ||
      "unknown";
    const confidence = computeParseConfidence({
      trade: effectiveTrade,
      description,
      numericCount,
      row
    });
    const lineItem = buildLineItemRecord(fileMeta, quoteId, rowIndex, row, {
      trade: effectiveTrade,
      itemCode,
      description,
      confidence,
      ...numericFields
    });
    lineItems.push(lineItem);
    if (lineItem.presetKey) {
      presetKeys.add(lineItem.presetKey);
    }

    if (!DIVISION_IDS.has(lineItem.trade) || !lineItem.description || confidence < 0.55) {
      reviews.push(
        buildReviewRecord(fileMeta, quoteId, rowIndex, "Low-confidence line item extraction.", row, {
          trade: lineItem.trade,
          description: lineItem.description,
          confidence: lineItem.confidence
        })
      );
    }
  }

  if (!lineItems.length) {
    reviews.push(
      buildReviewRecord(fileMeta, quoteId, headerRowIndex, "No reusable line items were parsed from Main Quote.", normalizedRows[headerRowIndex] || [])
    );
  }

  const quoteTotals = {
    labourHours: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item.labourHours, 0), 0), 2),
    materialCost: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item.materialCost, 0), 0), 2),
    subtradeCost: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item.subtradeCost, 0), 0), 2),
    totalCost: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item.totalCost, 0), 0), 2),
    totalSell: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item.totalSell, 0), 0), 2)
  };

  return {
    quoteRecord: {
      id: quoteId,
      fileId: quoteId,
      fileName: cleanString(fileMeta.name),
      fileUrl: cleanString(fileMeta.webViewLink),
      fileModifiedTime: cleanString(fileMeta.modifiedTime),
      drivePath: toArray(fileMeta.path),
      sheetTitle: MAIN_QUOTE_SHEET_TITLE,
      parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION,
      headerRowIndex,
      sectionScopes: scopeMeta.sectionScopes,
      globalScopeLines: scopeMeta.globalScopeLines,
      sectionRollups,
      tradeSections: [],
      sectionTrades: uniqueStrings(Object.keys(scopeMeta.sectionScopes)),
      lineItemCount: lineItems.length,
      reviewCount: reviews.length,
      totals: quoteTotals,
      updatedAt: nowIso()
    },
    lineItems,
    reviews,
    presetKeys: [...presetKeys]
  };
}

function extractGoogleErrorMessage(error) {
  const responseData = error?.response?.data;
  if (typeof responseData === "string") return cleanString(responseData);
  const nestedMessage =
    responseData?.error?.message ||
    responseData?.error_description ||
    responseData?.message ||
    responseData?.error;
  if (nestedMessage) return cleanString(nestedMessage);
  if (error instanceof Error) return cleanString(error.message);
  return cleanString(error || "Unknown Google API error.");
}

function isGoogleQuotaError(error) {
  const message = extractGoogleErrorMessage(error).toLowerCase();
  return /quota exceeded|rate limit|userratelimitexceeded|resourc_exhausted|resource_exhausted|too many requests/.test(
    message
  );
}

function isMissingMainQuoteError(error) {
  const message = extractGoogleErrorMessage(error).toLowerCase();
  return /unable to parse range|range .*main quote.*not found|sheet.*main quote.*not found|requested entity was not found/.test(
    message
  );
}

function isGoogleReauthError(error) {
  const message = extractGoogleErrorMessage(error).toLowerCase();
  return /invalid_rapt|invalid_grant|reauth/.test(message);
}

function parseServiceAccountCredentialsFromEnv() {
  const raw = cleanString(
    process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GCP_SERVICE_ACCOUNT_JSON
  );
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new Error("QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  const clientEmail = cleanString(parsed?.client_email);
  const privateKey = String(parsed?.private_key || "").replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) {
    throw new Error("Service-account JSON must include client_email and private_key.");
  }
  return {
    client_email: clientEmail,
    private_key: privateKey
  };
}

export function resolveEstimateLibraryServiceAccountEmailHint() {
  const directJson = cleanString(
    process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GCP_SERVICE_ACCOUNT_JSON
  );
  if (directJson) {
    try {
      const parsed = JSON.parse(directJson);
      const fromJson = cleanString(parsed?.client_email);
      if (fromJson) return fromJson;
    } catch (_error) {
      // Ignore hint parsing errors.
    }
  }

  const keyFile = cleanString(
    process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
  if (!keyFile) return "";
  try {
    const parsed = JSON.parse(readFileSync(keyFile, "utf8"));
    return cleanString(parsed?.client_email);
  } catch (_error) {
    return "";
  }
}

function buildGoogleAuth() {
  const credentials = parseServiceAccountCredentialsFromEnv();
  if (credentials) {
    return new google.auth.GoogleAuth({
      scopes: GOOGLE_ESTIMATE_LIBRARY_SCOPES,
      credentials
    });
  }

  const keyFile = cleanString(
    process.env.QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
  if (keyFile) {
    return new google.auth.GoogleAuth({
      scopes: GOOGLE_ESTIMATE_LIBRARY_SCOPES,
      keyFile
    });
  }

  return new google.auth.GoogleAuth({
    scopes: GOOGLE_ESTIMATE_LIBRARY_SCOPES
  });
}

async function buildGoogleClients() {
  const auth = buildGoogleAuth();
  const client = await auth.getClient();
  return {
    drive: google.drive({ version: "v3", auth: client }),
    sheets: google.sheets({ version: "v4", auth: client })
  };
}

async function getEmbedding(text = "") {
  const input = collapseWhitespace(text);
  if (!config.openaiApiKey || !input) return null;
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  try {
    const response = await openAiClient.embeddings.create({
      model: cleanString(config.estimateLibrary.embeddingModel || "text-embedding-3-small"),
      input
    });
    return Array.isArray(response.data?.[0]?.embedding) ? response.data[0].embedding : null;
  } catch (_error) {
    return null;
  }
}

function buildPresetStats(lineItems = []) {
  return {
    labourHours: statRange(lineItems.map((item) => item?.labourHours)),
    materialCost: statRange(lineItems.map((item) => item?.materialCost)),
    subtradeCost: statRange(lineItems.map((item) => item?.subtradeCost)),
    totalCost: statRange(lineItems.map((item) => item?.totalCost)),
    totalSell: statRange(lineItems.map((item) => item?.totalSell)),
    markupPercent: statRange(lineItems.map((item) => item?.markupPercent)),
    ratePerHour: statRange(lineItems.map((item) => item?.ratePerHour))
  };
}

function pickRepresentativeDescription(lineItems = []) {
  const counts = new Map();
  toArray(lineItems).forEach((item) => {
    const description = cleanString(item?.description);
    if (!description) return;
    const current = counts.get(description) || 0;
    counts.set(description, current + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([description]) => description)[0] || cleanString(lineItems[0]?.description);
}

function buildPresetSamples(lineItems = []) {
  return [...toArray(lineItems)]
    .sort((left, right) => cleanString(right?.fileModifiedTime).localeCompare(cleanString(left?.fileModifiedTime)))
    .slice(0, 3)
    .map((item) => ({
      fileId: cleanString(item?.sourceFileId),
      fileName: cleanString(item?.fileName),
      fileUrl: cleanString(item?.fileUrl),
      modifiedTime: cleanString(item?.fileModifiedTime),
      description: cleanString(item?.description),
      itemCode: cleanString(item?.itemCode),
      labourHours: roundNumber(item?.labourHours, 2),
      materialCost: roundNumber(item?.materialCost, 2),
      subtradeCost: roundNumber(item?.subtradeCost, 2),
      totalSell: roundNumber(item?.totalSell, 2)
    }));
}

async function rebuildPresetByKey(presetKey = "") {
  const key = cleanString(presetKey);
  if (!key) return null;
  const lineItems = (await listEstimateLibraryLineItemsByPresetKey(key)).filter(
    (item) => cleanString(item?.presetKey) === key
  );
  const presetId = buildDocId("preset", [key]);
  if (!lineItems.length) {
    await deleteEstimateLibraryPreset(presetId);
    return null;
  }
  const trade = cleanString(lineItems[0]?.trade);
  if (!DIVISION_IDS.has(trade)) {
    await deleteEstimateLibraryPreset(presetId);
    return null;
  }
  const displayDescription = pickRepresentativeDescription(lineItems);
  const representativeText = `${trade} ${displayDescription}`;
  const embedding = await getEmbedding(representativeText);
  const payload = {
    id: presetId,
    presetKey: key,
    trade,
    normalizedDescriptionKey: cleanString(lineItems[0]?.normalizedDescriptionKey),
    displayDescription,
    representativeText,
    sampleCount: lineItems.length,
    stats: buildPresetStats(lineItems),
    samples: buildPresetSamples(lineItems),
    embedding: Array.isArray(embedding) ? embedding : [],
    updatedAt: nowIso()
  };
  await upsertEstimateLibraryPreset(payload);
  return payload;
}

function buildSyncRunSummary(run = {}) {
  return {
    id: cleanString(run.id),
    status: cleanString(run.status || "idle"),
    startedAt: cleanString(run.startedAt),
    updatedAt: cleanString(run.updatedAt),
    completedAt: cleanString(run.completedAt),
    filesProcessed: parseNumber(run.filesProcessed, 0),
    filesImported: parseNumber(run.filesImported, 0),
    filesSkipped: parseNumber(run.filesSkipped, 0),
    filesFailed: parseNumber(run.filesFailed, 0),
    reviewCount: parseNumber(run.reviewCount, 0),
    presetCountUpdated: parseNumber(run.presetCountUpdated, 0),
    latestMessage: cleanString(run.latestMessage)
  };
}

function canSkipSpreadsheetImport(existingFile = {}, fileMeta = {}) {
  const stableStatuses = new Set(["imported", "needs_review", "skipped_missing_main_quote"]);
  return (
    stableStatuses.has(cleanString(existingFile?.status)) &&
    cleanString(existingFile?.modifiedTime) &&
    cleanString(existingFile?.modifiedTime) === cleanString(fileMeta?.modifiedTime) &&
    cleanString(existingFile?.parserVersion) === ESTIMATE_LIBRARY_PARSER_VERSION
  );
}

function normalizeFileReference(file = {}, parentPath = []) {
  return {
    id: cleanString(file.id),
    name: cleanString(file.name),
    mimeType: cleanString(file.mimeType),
    modifiedTime: cleanString(file.modifiedTime),
    webViewLink: cleanString(file.webViewLink),
    driveId: cleanString(file.driveId),
    parents: toArray(file.parents).map((item) => cleanString(item)).filter(Boolean),
    path: [...toArray(parentPath), cleanString(file.name)].filter(Boolean)
  };
}

async function resolveDriveImportRoot(drive, rootId = "") {
  const normalizedId = cleanString(rootId);
  if (!normalizedId) {
    throw new Error("Estimate library Drive folder id is not configured.");
  }

  try {
    const response = await drive.files.get({
      fileId: normalizedId,
      supportsAllDrives: true,
      fields: "id,name,mimeType,driveId,webViewLink"
    });
    const file = response.data || {};
    const mimeType = cleanString(file.mimeType);
    if (mimeType && mimeType !== GOOGLE_FOLDER_MIME_TYPE) {
      throw new Error(`Estimate library root "${cleanString(file.name || normalizedId)}" is not a folder.`);
    }
    return {
      kind: "folder",
      id: cleanString(file.id || normalizedId),
      name: cleanString(file.name || normalizedId),
      path: [cleanString(file.name || normalizedId)].filter(Boolean),
      driveId: cleanString(file.driveId)
    };
  } catch (_fileError) {
    // Fall through and try shared-drive resolution.
  }

  try {
    const response = await drive.drives.get({
      driveId: normalizedId
    });
    const sharedDrive = response.data || {};
    return {
      kind: "drive",
      id: normalizedId,
      name: cleanString(sharedDrive.name || normalizedId),
      path: [cleanString(sharedDrive.name || normalizedId)].filter(Boolean),
      driveId: normalizedId
    };
  } catch (_driveError) {
    throw new Error(
      `Estimate library root "${normalizedId}" was not found. Share the Drive folder or shared drive with the backend service account and verify the id.`
    );
  }
}

async function importSpreadsheetFile(fileRef = {}, clients = {}, runId = "") {
  const fileMeta = normalizeFileReference(fileRef, fileRef.path);
  if (!fileMeta.id) {
    return {
      status: "failed",
      message: "Drive file id is missing.",
      touchedPresetKeys: []
    };
  }

  const existingFile = await getEstimateLibraryFileRecord(fileMeta.id);
  const previousPresetKeys = uniqueStrings(existingFile?.presetKeys || []);
  if (canSkipSpreadsheetImport(existingFile, fileMeta)) {
    return {
      status: "skipped",
      message: `${fileMeta.name}: unchanged.`,
      touchedPresetKeys: []
    };
  }

  let valuesResponse;
  try {
    valuesResponse = await clients.sheets.spreadsheets.values.get({
      spreadsheetId: fileMeta.id,
      range: `'${MAIN_QUOTE_SHEET_TITLE}'!A:AZ`
    });
  } catch (error) {
    if (isGoogleQuotaError(error)) {
      return {
        status: "rate_limited",
        message: extractGoogleErrorMessage(error),
        touchedPresetKeys: previousPresetKeys
      };
    }
    if (isMissingMainQuoteError(error)) {
      await replaceEstimateLibraryLineItemsForFile(fileMeta.id, []);
      await replaceEstimateLibraryReviewsForFile(fileMeta.id, []);
      await deleteEstimateLibraryQuote(fileMeta.id);
      await upsertEstimateLibraryFileRecord({
        id: fileMeta.id,
        fileId: fileMeta.id,
        name: fileMeta.name,
        webViewLink: fileMeta.webViewLink,
        modifiedTime: fileMeta.modifiedTime,
        drivePath: fileMeta.path,
        parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION,
        status: "skipped_missing_main_quote",
        presetKeys: [],
        updatedAt: nowIso(),
        lastRunId: cleanString(runId)
      });
      return {
        status: "skipped",
        message: `${fileMeta.name}: no Main Quote sheet found.`,
        touchedPresetKeys: previousPresetKeys
      };
    }
    return {
      status: "failed",
      message: extractGoogleErrorMessage(error),
      touchedPresetKeys: previousPresetKeys
    };
  }

  const rows = normalizeSpreadsheetRows(valuesResponse.data?.values || []);
  const contentHash = hashText(JSON.stringify({
    rows,
    parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION
  }), 32);
  if (
    cleanString(existingFile?.contentHash) === contentHash &&
    cleanString(existingFile?.parserVersion) === ESTIMATE_LIBRARY_PARSER_VERSION
  ) {
    return {
      status: "skipped",
      message: `${fileMeta.name}: unchanged.`,
      touchedPresetKeys: []
    };
  }

  const parsed = parseMainQuoteSheet(rows, fileMeta);
  const newPresetKeys = uniqueStrings(parsed.presetKeys);
  const touchedPresetKeys = uniqueStrings([...previousPresetKeys, ...newPresetKeys]);

  await upsertEstimateLibraryQuote({
    ...parsed.quoteRecord,
    contentHash,
    importRunId: cleanString(runId)
  });
  await replaceEstimateLibraryLineItemsForFile(fileMeta.id, parsed.lineItems);
  await replaceEstimateLibraryReviewsForFile(fileMeta.id, parsed.reviews);
  await upsertEstimateLibraryFileRecord({
    id: fileMeta.id,
    fileId: fileMeta.id,
    name: fileMeta.name,
    webViewLink: fileMeta.webViewLink,
    modifiedTime: fileMeta.modifiedTime,
    drivePath: fileMeta.path,
    parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION,
    contentHash,
    status: parsed.lineItems.length ? "imported" : "needs_review",
    presetKeys: newPresetKeys,
    lineItemCount: parsed.lineItems.length,
    reviewCount: parsed.reviews.length,
    updatedAt: nowIso(),
    lastRunId: cleanString(runId)
  });

  return {
    status: parsed.lineItems.length ? "imported" : "needs_review",
    message: `${fileMeta.name}: ${parsed.lineItems.length} line(s) parsed.`,
    touchedPresetKeys,
    lineItemCount: parsed.lineItems.length,
    reviewCount: parsed.reviews.length
  };
}

async function listDriveFolderPage(drive, folder = {}, pageToken = "", pageSize = 100) {
  const normalizedFolder = folder && typeof folder === "object" ? folder : { id: cleanString(folder) };
  const folderId = cleanString(normalizedFolder.id);
  const folderKind = cleanString(normalizedFolder.kind || "folder");
  const sharedDriveId = cleanString(normalizedFolder.driveId);
  const request = {
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageToken: cleanString(pageToken) || undefined,
    pageSize: Math.max(10, Math.min(200, Number(pageSize) || 100)),
    fields: "nextPageToken, files(id,name,mimeType,modifiedTime,webViewLink,driveId,parents)"
  };
  if (folderKind === "drive" && sharedDriveId) {
    request.corpora = "drive";
    request.driveId = sharedDriveId;
  } else {
    request.q = `'${folderId}' in parents and trashed = false`;
    request.corpora = "allDrives";
  }
  const response = await drive.files.list(request);
  return {
    nextPageToken: cleanString(response.data?.nextPageToken),
    files: toArray(response.data?.files)
  };
}

export async function syncHistoricalEstimateLibrary(options = {}) {
  const folderId = cleanString(config.estimateLibrary.driveFolderId);
  if (!folderId) {
    throw new Error("Estimate library Drive folder id is not configured.");
  }

  const maxFiles = Math.max(1, parseNumber(options.maxFiles, config.estimateLibrary.syncMaxFilesPerRun || 25));
  const existingRun = cleanString(options.runId) ? await getEstimateLibrarySyncRun(options.runId) : null;
  const serviceAccountEmail = resolveEstimateLibraryServiceAccountEmailHint();
  const clients = await buildGoogleClients().catch((error) => {
    if (isGoogleReauthError(error)) {
      throw new Error(
        "Estimate library sync failed. Google auth reauthentication is required for the backend service account."
      );
    }
    const detail = extractGoogleErrorMessage(error);
    const shareHint = serviceAccountEmail
      ? `Share the Drive folder with ${serviceAccountEmail}.`
      : "Share the Drive folder with the backend Google service account.";
    throw new Error(`Estimate library sync failed. ${detail}. ${shareHint}`);
  });

  const importRoot = await resolveDriveImportRoot(clients.drive, folderId).catch((error) => {
    const detail = extractGoogleErrorMessage(error);
    const shareHint = serviceAccountEmail
      ? `Share it with ${serviceAccountEmail}.`
      : "Share it with the backend Google service account.";
    throw new Error(`${detail} ${shareHint}`);
  });

  const run = existingRun
    ? {
        ...existingRun,
        status: "running",
        updatedAt: nowIso()
      }
    : {
        id: cleanString(options.runId) || crypto.randomUUID(),
        status: "running",
        startedAt: nowIso(),
        updatedAt: nowIso(),
        folderQueue: [
          {
            kind: cleanString(importRoot.kind || "folder"),
            id: cleanString(importRoot.id || folderId),
            driveId: cleanString(importRoot.driveId),
            path: toArray(importRoot.path)
          }
        ],
        currentFolder: null,
        pendingFiles: [],
        filesProcessed: 0,
        filesImported: 0,
        filesSkipped: 0,
        filesFailed: 0,
        reviewCount: 0,
        presetCountUpdated: 0,
        latestMessage: "Starting estimate-library sync."
      };

  const touchedPresetKeys = new Set();
  let processedThisCall = 0;

  while (processedThisCall < maxFiles) {
    if (toArray(run.pendingFiles).length > 0) {
      const nextFile = run.pendingFiles.shift();
      const result = await importSpreadsheetFile(nextFile, clients, run.id);
      if (result.status === "rate_limited") {
        run.pendingFiles.unshift(nextFile);
        run.latestMessage =
          "Sheets API read quota is temporarily exhausted. Resume this sync in about a minute.";
        break;
      }
      result.touchedPresetKeys?.forEach((item) => touchedPresetKeys.add(item));
      run.filesProcessed = parseNumber(run.filesProcessed, 0) + 1;
      run.reviewCount = parseNumber(run.reviewCount, 0) + parseNumber(result.reviewCount, 0);
      if (result.status === "imported" || result.status === "needs_review") {
        run.filesImported = parseNumber(run.filesImported, 0) + 1;
      } else if (result.status === "skipped") {
        run.filesSkipped = parseNumber(run.filesSkipped, 0) + 1;
      } else {
        run.filesFailed = parseNumber(run.filesFailed, 0) + 1;
      }
      run.latestMessage = cleanString(result.message);
      processedThisCall += 1;
      continue;
    }

    if (!run.currentFolder && toArray(run.folderQueue).length) {
      run.currentFolder = run.folderQueue.shift();
    }
    if (!run.currentFolder) break;

    let page;
    try {
      page = await listDriveFolderPage(
        clients.drive,
        run.currentFolder,
        cleanString(run.currentFolder.pageToken),
        Math.max(25, Math.min(150, maxFiles * 4))
      );
    } catch (error) {
      if (isGoogleQuotaError(error)) {
        run.latestMessage =
          "Google Drive API quota is temporarily exhausted. Resume this sync in about a minute.";
        break;
      }
      throw error;
    }
    const currentPath = toArray(run.currentFolder.path);
    page.files.forEach((file) => {
      const normalized = normalizeFileReference(file, [...currentPath]);
      if (cleanString(run.currentFolder?.kind) === "drive") {
        if (normalized.mimeType === GOOGLE_SPREADSHEET_MIME_TYPE) {
          run.pendingFiles.push(normalized);
        }
      } else if (normalized.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
        run.folderQueue.push({
          kind: "folder",
          id: normalized.id,
          driveId: normalized.driveId,
          path: normalized.path
        });
      } else if (normalized.mimeType === GOOGLE_SPREADSHEET_MIME_TYPE) {
        run.pendingFiles.push(normalized);
      }
    });
    if (page.nextPageToken) {
      run.currentFolder = {
        ...run.currentFolder,
        pageToken: page.nextPageToken
      };
    } else {
      run.currentFolder = null;
    }
  }

  for (const presetKey of touchedPresetKeys) {
    await rebuildPresetByKey(presetKey);
  }
  run.presetCountUpdated = parseNumber(run.presetCountUpdated, 0) + touchedPresetKeys.size;

  if (!run.currentFolder && !toArray(run.folderQueue).length && !toArray(run.pendingFiles).length) {
    run.status = "completed";
    run.completedAt = nowIso();
    if (!cleanString(run.latestMessage)) {
      run.latestMessage = "Estimate library sync completed.";
    }
  } else {
    run.status = "running";
    run.latestMessage = cleanString(run.latestMessage) || "Estimate library sync paused and can be resumed.";
  }
  run.updatedAt = nowIso();
  await upsertEstimateLibrarySyncRun(run);

  return {
    run: buildSyncRunSummary(run),
    serviceAccountEmail,
    ...getEstimateLibraryStoreInfo()
  };
}

function buildFeedbackScopeLines(scopeText = "", explicitScopeLines = []) {
  const directLines = toArray(explicitScopeLines)
    .map((line, index) => ({
      scopeLineKey: cleanString(line?.scopeLineKey || `feedback-scope-${index + 1}`),
      lineNumber: cleanString(line?.lineNumber || String(index + 1)),
      sourceText: collapseWhitespace(line?.sourceText || line?.text || line?.normalizedText)
    }))
    .filter((line) => line.sourceText);
  if (directLines.length) return directLines;
  return normalizeSuggestScopeLines(scopeText).map((line) => ({
    scopeLineKey: cleanString(line?.scopeLineKey),
    lineNumber: cleanString(line?.lineNumber),
    sourceText: cleanString(line?.sourceText)
  }));
}

function buildFeedbackItemCode(prefix = "", description = "") {
  const normalizedPrefix = cleanString(prefix || "FB").replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "FB";
  const normalizedDescription = cleanString(description)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return `${normalizedPrefix}${normalizedDescription}`.slice(0, 16) || normalizedPrefix;
}

function buildFeedbackLabourRoleConfigs(trade = "") {
  if (cleanString(trade) === "glendale") {
    return [
      { label: "Design", hoursField: "technicianHours", rateField: "technicianRate", sellField: "technicianSellingPrice" },
      { label: "Architect", hoursField: "supervisionHours", rateField: "supervisionRate", sellField: "supervisionSellingPrice" },
      { label: "Engineer", hoursField: "engineerHours", rateField: "engineerRate", sellField: "engineerSellingPrice" },
      { label: "Sr. Engineer", hoursField: "seniorEngineerHours", rateField: "seniorEngineerRate", sellField: "seniorEngineerSellingPrice" },
      { label: "Project Manager", hoursField: "projectManagerHours", rateField: "projectManagerRate", sellField: "projectManagerSellingPrice" }
    ];
  }
  return [
    { label: "General Labour", hoursField: "technicianHours", rateField: "technicianRate", sellField: "technicianSellingPrice" },
    { label: "Supervision", hoursField: "supervisionHours", rateField: "supervisionRate", sellField: "supervisionSellingPrice" },
    { label: "Project Manager", hoursField: "projectManagerHours", rateField: "projectManagerRate", sellField: "projectManagerSellingPrice" }
  ];
}

function buildFeedbackFileMeta(payload = {}, feedbackId = "", timestamp = "") {
  const accountName = cleanString(payload?.account?.name || "Manual Feedback");
  const quoteDescription = cleanString(payload?.quoteDescription || payload?.quoteBody || cleanString(payload?.quoteType || "Estimate"));
  const shortDescription = collapseWhitespace(quoteDescription).slice(0, 96);
  return {
    id: cleanString(feedbackId),
    name: [accountName, shortDescription].filter(Boolean).join(" - ") || `Manual Feedback ${cleanString(feedbackId)}`,
    webViewLink: cleanString(payload?.opportunity?.linkToDrive || payload?.account?.linkToDrive),
    modifiedTime: cleanString(timestamp || nowIso()),
    path: ["Estimate Library", "Manual Feedback", cleanString(payload?.quoteType || "production") || "production"]
  };
}

function normalizeFeedbackCostLine(line = {}) {
  const quantity = Math.max(0, parseNumber(line?.quantity, 0)) || 1;
  const unitCost = Math.max(0, parseNumber(line?.unitCost, 0));
  const cost = Math.max(0, parseNumber(line?.cost, 0)) || (quantity > 0 ? unitCost * quantity : 0);
  const sell = Math.max(0, parseNumber(line?.sellingPrice, 0));
  const markupPercent =
    cost > 0 && sell > 0 ? roundNumber(((sell - cost) / cost) * 100, 2) : Math.max(0, parseNumber(line?.markup, 0));
  return {
    description: cleanString(line?.description),
    quantity,
    unitCost: unitCost > 0 ? unitCost : quantity > 0 && cost > 0 ? cost / quantity : 0,
    cost,
    sell,
    markupPercent,
    uom: cleanString(line?.uom || "EACH"),
    costCode: cleanString(line?.costCode)
  };
}

function buildFeedbackSectionData(fileMeta = {}, quoteId = "", division = {}, startRowIndex = 1) {
  const trade = normalizeTrade(division?.id || division?.title);
  if (!trade) {
    return {
      trade: "",
      lineItems: [],
      section: null,
      nextRowIndex: startRowIndex
    };
  }

  const sectionId = cleanString(division?.sectionId || buildDocId("feedback_section", [quoteId, trade, cleanString(division?.title)]));
  const sectionHeading = cleanString(division?.title || trade);
  const scopeLines = buildFeedbackScopeLines(division?.scope, division?.scopeLines);
  const lineItems = [];
  let rowIndex = Math.max(1, parseNumber(startRowIndex, 1));
  const labour = division?.labour || {};

  buildFeedbackLabourRoleConfigs(trade).forEach((role) => {
    const hours = Math.max(0, parseNumber(labour?.[role.hoursField], 0));
    const ratePerHour = Math.max(0, parseNumber(labour?.[role.rateField], 0));
    const labourSell = Math.max(0, parseNumber(labour?.[role.sellField], 0));
    if (hours <= 0 && labourSell <= 0) return;
    const totalCost = roundNumber(hours * ratePerHour, 2);
    const totalSell = roundNumber(labourSell > 0 ? labourSell : totalCost, 2);
    lineItems.push(
      buildLineItemRecord(fileMeta, quoteId, rowIndex, [role.label], {
        trade,
        itemCode: buildFeedbackItemCode(trade, role.label),
        description: role.label,
        labourHours: hours,
        materialCost: 0,
        subtradeCost: 0,
        totalCost,
        markupPercent: totalCost > 0 && totalSell > 0 ? roundNumber(((totalSell - totalCost) / totalCost) * 100, 2) : 0,
        ratePerHour,
        materialSell: 0,
        subtradeSell: 0,
        labourSell: totalSell,
        totalSell,
        confidence: 0.98
      })
    );
    rowIndex += 1;
  });

  toArray(division?.materials?.lines).forEach((line) => {
    const normalized = normalizeFeedbackCostLine(line);
    if (!normalized.description || (normalized.cost <= 0 && normalized.sell <= 0)) return;
    lineItems.push(
      buildLineItemRecord(fileMeta, quoteId, rowIndex, [normalized.description], {
        trade,
        itemCode: buildFeedbackItemCode(normalized.costCode || trade, normalized.description),
        description: normalized.description,
        labourHours: 0,
        materialCost: normalized.cost,
        subtradeCost: 0,
        totalCost: normalized.cost,
        markupPercent: normalized.markupPercent,
        ratePerHour: 0,
        materialSell: normalized.sell,
        subtradeSell: 0,
        labourSell: 0,
        totalSell: normalized.sell,
        confidence: 0.98
      })
    );
    rowIndex += 1;
  });

  toArray(division?.subcontractor?.lines).forEach((line) => {
    const normalized = normalizeFeedbackCostLine(line);
    if (!normalized.description || (normalized.cost <= 0 && normalized.sell <= 0)) return;
    lineItems.push(
      buildLineItemRecord(fileMeta, quoteId, rowIndex, [normalized.description], {
        trade,
        itemCode: buildFeedbackItemCode(normalized.costCode || trade, normalized.description),
        description: normalized.description,
        labourHours: 0,
        materialCost: 0,
        subtradeCost: normalized.cost,
        totalCost: normalized.cost,
        markupPercent: normalized.markupPercent,
        ratePerHour: 0,
        materialSell: 0,
        subtradeSell: normalized.sell,
        labourSell: 0,
        totalSell: normalized.sell,
        confidence: 0.98
      })
    );
    rowIndex += 1;
  });

  return {
    trade,
    lineItems,
    section: {
      id: buildDocId("section", [quoteId, sectionId, trade]),
      quoteId,
      trade,
      sectionHeading,
      scopeLines,
      scopeText: scopeLines.map((line) => cleanString(line?.sourceText)).filter(Boolean).join("\n"),
      normalizedScopeText: normalizeDescriptionKey(scopeLines.map((line) => cleanString(line?.sourceText)).join("\n")),
      tableLineItems: lineItems,
      subtotal: buildComputedSectionSubtotal(lineItems),
      rowStart: Math.max(1, parseNumber(startRowIndex, 1)),
      rowEnd: Math.max(1, rowIndex - 1),
      tableHeaderRowIndex: 0,
      sourceFileId: cleanString(fileMeta.id),
      fileName: cleanString(fileMeta.name),
      fileUrl: cleanString(fileMeta.webViewLink),
      updatedAt: nowIso()
    },
    nextRowIndex: rowIndex
  };
}

export async function recordHistoricalEstimateFeedback(payload = {}) {
  const feedbackId = cleanString(payload?.feedbackId || payload?.id) || `feedback_${crypto.randomUUID()}`;
  const timestamp = nowIso();
  const fileMeta = buildFeedbackFileMeta(payload, feedbackId, timestamp);
  const quoteId = cleanString(feedbackId);
  const divisions = toArray(payload?.divisions).filter((division) => normalizeTrade(division?.id || division?.title));
  const lineItems = [];
  const tradeSections = [];
  let rowIndex = 1;

  divisions.forEach((division) => {
    const sectionData = buildFeedbackSectionData(fileMeta, quoteId, division, rowIndex);
    rowIndex = sectionData.nextRowIndex;
    if (sectionData.section) tradeSections.push(sectionData.section);
    lineItems.push(...toArray(sectionData.lineItems));
  });

  if (!lineItems.length) {
    throw new Error("Approved feedback must include at least one labour, material, or subtrade value.");
  }

  const sectionScopes = {};
  tradeSections.forEach((section) => {
    const trade = cleanString(section?.trade);
    if (!trade) return;
    if (!Array.isArray(sectionScopes[trade])) sectionScopes[trade] = [];
    sectionScopes[trade].push(...toArray(section?.scopeLines).map((line) => cleanString(line?.sourceText)).filter(Boolean));
  });

  const totals = {
    labourHours: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item?.labourHours, 0), 0), 2),
    materialCost: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item?.materialCost, 0), 0), 2),
    subtradeCost: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item?.subtradeCost, 0), 0), 2),
    totalCost: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item?.totalCost, 0), 0), 2),
    totalSell: roundNumber(lineItems.reduce((sum, item) => sum + parseNumber(item?.totalSell, 0), 0), 2)
  };
  const presetKeys = uniqueStrings(lineItems.map((item) => cleanString(item?.presetKey)).filter(Boolean));
  const contentHash = hashText(JSON.stringify({
    divisions,
    quoteBody: cleanString(payload?.quoteBody),
    quoteDescription: cleanString(payload?.quoteDescription),
    pricingPosture: cleanString(payload?.pricingPosture),
    sourceKind: cleanString(payload?.sourceKind || "manual_feedback")
  }), 32);

  const quoteRecord = {
    id: quoteId,
    fileId: quoteId,
    fileName: cleanString(fileMeta.name),
    fileUrl: cleanString(fileMeta.webViewLink),
    fileModifiedTime: cleanString(fileMeta.modifiedTime),
    drivePath: toArray(fileMeta.path),
    sheetTitle: MAIN_QUOTE_SHEET_TITLE,
    parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION,
    headerRowIndex: 0,
    sectionScopes,
    globalScopeLines: [],
    sectionRollups: tradeSections.map((section) => ({
      trade: cleanString(section?.trade),
      label: cleanString(section?.sectionHeading),
      rowIndex: parseNumber(section?.rowStart, 0),
      totalCost: parseNumber(section?.subtotal?.totalCost, 0),
      totalSell: parseNumber(section?.subtotal?.totalSell, 0),
      updatedAt: nowIso()
    })),
    tradeSections,
    sectionTrades: uniqueStrings(tradeSections.map((section) => cleanString(section?.trade))),
    lineItemCount: lineItems.length,
    reviewCount: 0,
    totals,
    contentHash,
    quoteType: cleanString(payload?.quoteType),
    quoteDescription: cleanString(payload?.quoteDescription),
    quoteBody: cleanString(payload?.quoteBody),
    pricingPosture: cleanString(payload?.pricingPosture),
    sourceKind: cleanString(payload?.sourceKind || "manual_feedback"),
    feedbackMetadata: {
      prototypeDraftId: cleanString(payload?.prototypeDraftId),
      quoteMetadata: payload?.quoteMetadata || {}
    },
    updatedAt: timestamp
  };

  await upsertEstimateLibraryQuote(quoteRecord);
  await replaceEstimateLibraryLineItemsForFile(fileMeta.id, lineItems);
  await replaceEstimateLibraryReviewsForFile(fileMeta.id, []);
  await upsertEstimateLibraryFileRecord({
    id: fileMeta.id,
    fileId: fileMeta.id,
    name: fileMeta.name,
    webViewLink: fileMeta.webViewLink,
    modifiedTime: fileMeta.modifiedTime,
    drivePath: fileMeta.path,
    parserVersion: ESTIMATE_LIBRARY_PARSER_VERSION,
    contentHash,
    status: "manual_feedback",
    sourceKind: "manual_feedback",
    presetKeys,
    lineItemCount: lineItems.length,
    reviewCount: 0,
    updatedAt: timestamp
  });

  for (const presetKey of presetKeys) {
    await rebuildPresetByKey(presetKey);
  }

  return {
    feedbackId: quoteId,
    fileName: cleanString(fileMeta.name),
    sectionCount: tradeSections.length,
    lineItemCount: lineItems.length,
    presetCountUpdated: presetKeys.length,
    trades: uniqueStrings(tradeSections.map((section) => cleanString(section?.trade))),
    totals,
    storedAt: timestamp
  };
}

export async function getHistoricalEstimateLibraryStatus(runId = "latest") {
  const effectiveRun =
    cleanString(runId).toLowerCase() === "latest"
      ? await getLatestEstimateLibrarySyncRun()
      : await getEstimateLibrarySyncRun(runId);
  const openReviews = await listEstimateLibraryOpenReviews(25);
  return {
    run: effectiveRun ? buildSyncRunSummary(effectiveRun) : null,
    serviceAccountEmail: resolveEstimateLibraryServiceAccountEmailHint(),
    driveFolderId: cleanString(config.estimateLibrary.driveFolderId),
    reviews: openReviews,
    ...getEstimateLibraryStoreInfo()
  };
}

function isHistoricalEstimateLibraryRunActive(run = {}) {
  return cleanString(run?.status).toLowerCase() === "running" && cleanString(run?.id);
}

function isHistoricalEstimateLibraryQuotaPause(message = "") {
  return /quota.*temporarily exhausted|resume this sync in about a minute/i.test(cleanString(message));
}

async function resolveHistoricalEstimateLibraryRunId(requestedRunId = "") {
  const directRunId = cleanString(requestedRunId);
  if (directRunId) return directRunId;
  const latestRun = await getLatestEstimateLibrarySyncRun();
  return isHistoricalEstimateLibraryRunActive(latestRun) ? cleanString(latestRun.id) : "";
}

export async function runHistoricalEstimateLibrarySync(options = {}) {
  if (activeEstimateLibrarySyncPromise) {
    return await activeEstimateLibrarySyncPromise;
  }

  activeEstimateLibrarySyncPromise = (async () => {
    const runId = await resolveHistoricalEstimateLibraryRunId(options.runId);
    return await syncHistoricalEstimateLibrary({
      ...options,
      runId,
      maxFiles: Math.max(
        1,
        parseNumber(options.maxFiles, config.estimateLibrary.syncMaxFilesPerRun || 25)
      )
    });
  })();

  try {
    return await activeEstimateLibrarySyncPromise;
  } finally {
    activeEstimateLibrarySyncPromise = null;
  }
}

function resolveEstimateLibraryAutoSyncLogger(logger = console) {
  return {
    info: typeof logger?.info === "function" ? logger.info.bind(logger) : console.log.bind(console),
    error: typeof logger?.error === "function" ? logger.error.bind(logger) : console.error.bind(console)
  };
}

export function startHistoricalEstimateLibraryAutoSync(logger = console) {
  if (estimateLibraryAutoSyncHandle) {
    return estimateLibraryAutoSyncHandle;
  }

  const log = resolveEstimateLibraryAutoSyncLogger(logger);
  if (!config.estimateLibrary.autoSyncEnabled) {
    log.info("[estimate-library] Auto-sync disabled.");
    estimateLibraryAutoSyncHandle = {
      started: false,
      stop() {}
    };
    return estimateLibraryAutoSyncHandle;
  }

  let stopped = false;
  const startupDelayMs = Math.max(0, parseNumber(config.estimateLibrary.autoSyncStartupDelayMs, 15000));
  const intervalMs = Math.max(1000 * 60 * 60, parseNumber(config.estimateLibrary.autoSyncIntervalMs, 1000 * 60 * 60));
  const resumeDelayMs = Math.max(5000, parseNumber(config.estimateLibrary.autoSyncResumeDelayMs, 15000));
  const quotaBackoffMs = Math.max(15000, parseNumber(config.estimateLibrary.autoSyncQuotaBackoffMs, 70000));
  const errorBackoffMs = Math.max(15000, parseNumber(config.estimateLibrary.autoSyncErrorBackoffMs, 1000 * 60 * 5));
  const maxFiles = Math.max(1, parseNumber(config.estimateLibrary.autoSyncMaxFilesPerRun, 1000));

  const workerPromise = (async () => {
    if (startupDelayMs > 0) {
      await delay(startupDelayMs);
    }

    while (!stopped) {
      try {
        const result = await runHistoricalEstimateLibrarySync({ maxFiles });
        const run = result?.run || {};
        const runId = cleanString(run?.id || "new");
        const status = cleanString(run?.status || "idle");
        const processed = parseNumber(run?.filesProcessed, 0);
        const imported = parseNumber(run?.filesImported, 0);
        const skipped = parseNumber(run?.filesSkipped, 0);
        const failed = parseNumber(run?.filesFailed, 0);
        log.info(
          `[estimate-library] Auto-sync run ${runId} ${status}. processed=${processed} imported=${imported} skipped=${skipped} failed=${failed}. ${cleanString(run?.latestMessage)}`
        );

        const nextDelayMs =
          status === "running"
            ? isHistoricalEstimateLibraryQuotaPause(run?.latestMessage)
              ? quotaBackoffMs
              : resumeDelayMs
            : intervalMs;
        await delay(nextDelayMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown auto-sync error.";
        log.error(`[estimate-library] Auto-sync failed: ${message}`);
        await delay(errorBackoffMs);
      }
    }
  })().finally(() => {
    estimateLibraryAutoSyncHandle = null;
  });

  estimateLibraryAutoSyncHandle = {
    started: true,
    stop() {
      stopped = true;
    },
    workerPromise
  };

  log.info(
    `[estimate-library] Auto-sync enabled. intervalMs=${intervalMs} resumeDelayMs=${resumeDelayMs} maxFiles=${maxFiles}.`
  );
  return estimateLibraryAutoSyncHandle;
}

export async function listHistoricalEstimateLibraryReviews(limit = 25) {
  return await listEstimateLibraryOpenReviews(limit);
}

function getWorksheetSupervisionRatio(divisionId = "") {
  if (cleanString(divisionId) === "construction") return 0.15;
  return 0.125;
}

function isSupervisionScope(text = "") {
  return /(project manager|project coordinator|site supervisor|coordination|scheduling|quality|safety|oversight)/i.test(
    cleanString(text)
  );
}

function isProjectManagerScope(text = "") {
  return /(project manager|project coordinator|project management|project admin|project administration|coordination|scheduling|submittal|closeout)/i.test(
    cleanString(text)
  );
}

function normalizeSuggestScopeLines(scopeText = "", explicitScopeLines = []) {
  const directLines = toArray(explicitScopeLines)
    .map((line, index) => ({
      scopeLineKey: cleanString(line?.scopeLineKey || `scope-line-${index + 1}`),
      lineNumber: cleanString(line?.lineNumber || String(index + 1)),
      sourceText: collapseWhitespace(line?.sourceText || line?.text || line?.normalizedText)
    }))
    .filter((line) => line.sourceText);
  if (directLines.length) return directLines;
  return collapseWhitespace(scopeText)
    .split(/\r?\n+/)
    .map((line) => collapseWhitespace(line).replace(/^\d+(?:\.\d+)*\.?\s*/, ""))
    .filter(Boolean)
    .map((line, index) => ({
      scopeLineKey: buildDocId("scope", [line, String(index + 1)]),
      lineNumber: String(index + 1),
      sourceText: line
    }));
}

function buildMatchConfidence(score = 0, sampleCount = 0) {
  const countBoost = Math.min(0.18, Math.log10(Math.max(1, sampleCount)) * 0.08);
  return roundNumber(Math.max(0.05, Math.min(0.99, score + countBoost)), 2);
}

function buildHistoricalApplyPreview(preset = {}, trade = "") {
  const labourMedian = parseNumber(preset?.stats?.labourHours?.median, 0);
  const materialMedian = parseNumber(preset?.stats?.materialCost?.median, 0);
  const subtradeMedian = parseNumber(preset?.stats?.subtradeCost?.median, 0);
  const projectManagerOnly = isProjectManagerScope(preset?.displayDescription || preset?.representativeText);
  const supervisionOnly = !projectManagerOnly && isSupervisionScope(preset?.displayDescription || preset?.representativeText);
  const generalLabourHours = projectManagerOnly || supervisionOnly ? 0 : labourMedian;
  const supervisionHours = projectManagerOnly
    ? 0
    : supervisionOnly
      ? labourMedian
      : roundNumber(labourMedian * getWorksheetSupervisionRatio(trade), 2);
  const projectManagerHours = projectManagerOnly ? labourMedian : 0;
  return {
    description: cleanString(preset?.displayDescription),
    generalLabourHours,
    supervisionHours,
    projectManagerHours,
    materialAllowanceCost: roundNumber(materialMedian, 2),
    subtradeAllowanceCost: roundNumber(subtradeMedian, 2),
    assumptions: [
      `ASSUMED: Historical preset built from ${parseNumber(preset?.sampleCount, 0)} matching estimate line(s).`
    ]
  };
}

function buildDivisionScopeSearchText(division = {}) {
  return normalizeSuggestScopeLines(division?.scope, division?.scopeLines)
    .map((line) => cleanString(line?.sourceText))
    .filter(Boolean)
    .join("\n");
}

function buildTradeSectionSearchText(section = {}) {
  return toArray(section?.scopeLines)
    .map((line) => cleanString(line?.sourceText || line?.text || line))
    .filter(Boolean)
    .join("\n");
}

function computeLineCoverageSimilarity(sourceLines = [], candidateLines = []) {
  const normalizedSourceLines = toArray(sourceLines)
    .map((line) => cleanString(line))
    .filter(Boolean);
  const normalizedCandidateLines = toArray(candidateLines)
    .map((line) => cleanString(line))
    .filter(Boolean);
  if (!normalizedSourceLines.length || !normalizedCandidateLines.length) return 0;
  const scores = normalizedSourceLines.map((sourceLine) => {
    return normalizedCandidateLines.reduce((best, candidateLine) => {
      return Math.max(best, computeLexicalSimilarity(sourceLine, candidateLine));
    }, 0);
  });
  return roundNumber(
    scores.reduce((sum, score) => sum + parseNumber(score, 0), 0) / Math.max(1, scores.length),
    4
  );
}

function resolveHistoricalSectionAnchorMode(confidence = 0) {
  if (confidence >= 0.45) return "hard";
  if (confidence >= 0.25) return "soft";
  return "ignore";
}

async function hydrateHistoricalTradeSection(section = {}) {
  const quoteId = cleanString(section?.quoteId);
  const trade = cleanString(section?.trade);
  const tableLineItems = toArray(section?.tableLineItems);
  if (tableLineItems.length || !quoteId || !trade) {
    return {
      ...section,
      tableLineItems,
      subtotal: section?.subtotal || buildComputedSectionSubtotal(tableLineItems)
    };
  }
  const hydratedLineItems = await listEstimateLibraryLineItemsByQuoteAndTrade(quoteId, trade, 250);
  return {
    ...section,
    tableLineItems: hydratedLineItems,
    subtotal: section?.subtotal || buildComputedSectionSubtotal(hydratedLineItems)
  };
}

async function rankHistoricalTradeSections(division = {}, tradeSections = []) {
  const scopeLines = normalizeSuggestScopeLines(division?.scope, division?.scopeLines);
  const queryScopeText = scopeLines.map((line) => cleanString(line?.sourceText)).filter(Boolean).join("\n");
  if (!queryScopeText) return [];

  const lexicalCandidates = toArray(tradeSections)
    .map((section) => {
      const candidateScopeText = buildTradeSectionSearchText(section);
      const lexicalScore = computeLexicalSimilarity(queryScopeText, candidateScopeText);
      const lineCoverageScore = computeLineCoverageSimilarity(
        scopeLines.map((line) => line?.sourceText),
        toArray(section?.scopeLines).map((line) => line?.sourceText || line?.text || line)
      );
      const headingScore = computeLexicalSimilarity(
        cleanString(division?.title || division?.id),
        cleanString(section?.sectionHeading || section?.trade)
      );
      const combinedScore = roundNumber(lexicalScore * 0.55 + lineCoverageScore * 0.35 + headingScore * 0.1, 4);
      return {
        section,
        lexicalScore,
        lineCoverageScore,
        headingScore,
        combinedScore
      };
    })
    .filter((candidate) => candidate.combinedScore >= 0.12)
    .sort((left, right) => right.combinedScore - left.combinedScore)
    .slice(0, 24);

  let queryEmbedding = null;
  if (
    config.openaiApiKey &&
    lexicalCandidates.some((candidate) => Array.isArray(candidate?.section?.scopeEmbedding) && candidate.section.scopeEmbedding.length)
  ) {
    queryEmbedding = await getEmbedding(queryScopeText);
  }

  const scored = [];
  for (const candidate of lexicalCandidates) {
    const semanticScore =
      Array.isArray(queryEmbedding) && Array.isArray(candidate?.section?.scopeEmbedding)
        ? computeCosineSimilarity(queryEmbedding, candidate.section.scopeEmbedding)
        : 0;
    const confidence = roundNumber(
      Math.max(0.05, Math.min(0.99, candidate.combinedScore * 0.82 + semanticScore * 0.18)),
      2
    );
    scored.push({
      ...candidate,
      semanticScore: roundNumber(semanticScore, 4),
      confidence,
      mode: resolveHistoricalSectionAnchorMode(confidence)
    });
  }
  return scored.sort((left, right) => right.confidence - left.confidence);
}

export async function suggestHistoricalTradeSectionAnchors(payload = {}) {
  const divisions = toArray(payload?.divisions);
  const tradeSectionCache = new Map();
  const anchors = [];

  for (const division of divisions) {
    const trade = normalizeTrade(division?.id || division?.title);
    if (!trade) continue;
    if (!tradeSectionCache.has(trade)) {
      const quotes = await listEstimateLibraryQuotesByTrade(
        trade,
        Math.max(10, parseNumber(config.estimateLibrary.presetTradeLimit, 500))
      );
      const sections = quotes.flatMap((quote) =>
        toArray(quote?.tradeSections)
          .filter((section) => cleanString(section?.trade) === trade)
          .map((section) => ({
            ...section,
            quoteId: cleanString(section?.quoteId || quote?.id),
            fileName: cleanString(section?.fileName || quote?.fileName),
            fileUrl: cleanString(section?.fileUrl || quote?.fileUrl),
            sourceFileId: cleanString(section?.sourceFileId || quote?.fileId)
          }))
      );
      tradeSectionCache.set(trade, sections);
    }
    const ranked = await rankHistoricalTradeSections(division, tradeSectionCache.get(trade) || []);
    const best = ranked[0];
    if (!best || cleanString(best?.mode) === "ignore") continue;
    const hydratedSection = await hydrateHistoricalTradeSection(best.section);
    anchors.push({
      sectionId: cleanString(division?.sectionId),
      divisionId: trade,
      title: cleanString(division?.title || division?.id),
      confidence: best.confidence,
      mode: cleanString(best.mode),
      lexicalScore: roundNumber(best.lexicalScore, 4),
      lineCoverageScore: roundNumber(best.lineCoverageScore, 4),
      semanticScore: roundNumber(best.semanticScore, 4),
      matchedQuoteId: cleanString(hydratedSection?.quoteId),
      matchedFileName: cleanString(hydratedSection?.fileName),
      matchedFileUrl: cleanString(hydratedSection?.fileUrl),
      matchedSectionHeading: cleanString(hydratedSection?.sectionHeading),
      scopeText: buildDivisionScopeSearchText(division),
      archivedSection: hydratedSection,
      topMatches: ranked.slice(0, 3).map((match) => ({
        confidence: match.confidence,
        mode: cleanString(match.mode),
        matchedQuoteId: cleanString(match?.section?.quoteId),
        matchedFileName: cleanString(match?.section?.fileName),
        matchedSectionHeading: cleanString(match?.section?.sectionHeading)
      }))
    });
  }

  const latestRun = await getLatestEstimateLibrarySyncRun();
  return {
    generatedAt: nowIso(),
    anchors,
    anchoredSectionCount: anchors.filter((anchor) => cleanString(anchor?.mode) === "hard").length,
    libraryStatus: latestRun ? buildSyncRunSummary(latestRun) : null
  };
}

async function rankHistoricalPresetMatches(scopeLine = {}, presets = [], trade = "") {
  const queryText = cleanString(scopeLine?.sourceText);
  if (!queryText) return [];
  const lexicalCandidates = toArray(presets)
    .map((preset) => {
      const lexicalScore = computeLexicalSimilarity(queryText, preset?.displayDescription || preset?.representativeText);
      return {
        preset,
        lexicalScore
      };
    })
    .filter((item) => item.lexicalScore > 0.08)
    .sort((left, right) => right.lexicalScore - left.lexicalScore)
    .slice(0, 24);

  let queryEmbedding = null;
  if (config.openaiApiKey && lexicalCandidates.some((item) => Array.isArray(item?.preset?.embedding) && item.preset.embedding.length)) {
    queryEmbedding = await getEmbedding(queryText);
  }

  return lexicalCandidates
    .map((candidate) => {
      const semanticScore =
        Array.isArray(queryEmbedding) && Array.isArray(candidate?.preset?.embedding)
          ? computeCosineSimilarity(queryEmbedding, candidate.preset.embedding)
          : 0;
      const combinedScore = roundNumber(candidate.lexicalScore * 0.72 + semanticScore * 0.28, 4);
      return {
        id: cleanString(candidate?.preset?.id),
        presetId: cleanString(candidate?.preset?.id),
        presetKey: cleanString(candidate?.preset?.presetKey),
        displayDescription: cleanString(candidate?.preset?.displayDescription),
        sampleCount: parseNumber(candidate?.preset?.sampleCount, 0),
        confidence: buildMatchConfidence(combinedScore, candidate?.preset?.sampleCount),
        score: combinedScore,
        lexicalScore: roundNumber(candidate.lexicalScore, 4),
        semanticScore: roundNumber(semanticScore, 4),
        stats: candidate?.preset?.stats || {},
        sourceExamples: toArray(candidate?.preset?.samples),
        applyPreview: buildHistoricalApplyPreview(candidate?.preset, trade)
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, parseNumber(config.estimateLibrary.suggestMatchLimit, 3)));
}

export async function suggestHistoricalEstimateMatches(payload = {}) {
  const divisions = toArray(payload?.divisions);
  const presetCache = new Map();
  const sections = [];
  const sectionAnchorResult = await suggestHistoricalTradeSectionAnchors(payload);

  for (const division of divisions) {
    const trade = normalizeTrade(division?.id || division?.title);
    if (!trade) continue;
    if (!presetCache.has(trade)) {
      presetCache.set(
        trade,
        await listEstimateLibraryPresetsByTrade(trade, Math.max(10, parseNumber(config.estimateLibrary.presetTradeLimit, 500)))
      );
    }
    const presets = presetCache.get(trade) || [];
    const scopeLines = normalizeSuggestScopeLines(division?.scope, division?.scopeLines);
    const suggestions = [];
    for (const scopeLine of scopeLines) {
      const matches = await rankHistoricalPresetMatches(scopeLine, presets, trade);
      suggestions.push({
        scopeLineKey: cleanString(scopeLine.scopeLineKey),
        lineNumber: cleanString(scopeLine.lineNumber),
        sourceText: cleanString(scopeLine.sourceText),
        matches
      });
    }
    sections.push({
      sectionId: cleanString(division?.sectionId),
      divisionId: trade,
      title: cleanString(division?.title || division?.id),
      suggestions
    });
  }

  const latestRun = await getLatestEstimateLibrarySyncRun();
  return {
    generatedAt: nowIso(),
    sections,
    historicalSectionAnchors: sectionAnchorResult.anchors,
    anchoredSectionCount: sectionAnchorResult.anchoredSectionCount,
    libraryStatus: latestRun ? buildSyncRunSummary(latestRun) : null
  };
}

export const __test__ = {
  parseMainQuoteSheet,
  parseMainQuoteTradeSections,
  normalizeTradeSectionScopeLines,
  rankHistoricalTradeSections
};
