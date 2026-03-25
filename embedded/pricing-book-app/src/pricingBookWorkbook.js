import { google } from "googleapis";
import { buildFallbackPricingBookEstimators, resolvePricingBookEstimatorName } from "./estimators.js";

const MAIN_QUOTE_TABLE_HEADER = [
  "Trade",
  "Item",
  "Description",
  "LBR Hrs",
  "Mat Cost",
  "Subs",
  "Cost",
  "Mk percent",
  "Rate per Hr",
  "$ Material",
  "Subs",
  "$ Hrs",
  "Selling"
];

const MAIN_QUOTE_SHEET_TITLES = ["Main Quote", "Summary"];
const SCOPE_SHEET_TITLE = "Scope";
const GOOGLE_SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const PRICING_BOOK_MAIN_QUOTE_START_ROW = 9;
const PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN = 2;
const PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN = 18;
const PRICING_BOOK_MAIN_QUOTE_TABLE_START_COLUMN = 2;
const PRICING_BOOK_MAIN_QUOTE_TABLE_END_COLUMN = 14;
const PRICING_BOOK_MAIN_QUOTE_TOTAL_END_COLUMN = 17;
const PRICING_BOOK_STORY_START_ROW = 9;
const PRICING_BOOK_STORY_END_ROW = 40;
const PRICING_BOOK_NWE_ROWS = 24;
const PRICING_BOOK_SHEET_DEFAULT_COLUMN_WIDTH = 120;
const PRICING_BOOK_SUMMARY_HEADER_COLOR = "#D9E1F2";
const PRICING_BOOK_SUMMARY_SUBTOTAL_COLOR = "#E6E6E6";
const PRICING_BOOK_SUMMARY_SCOPE_COLOR = "#EFEFEF";
const PRICING_BOOK_DIVISION_COLORS = {
  CON: "#9DC3E6",
  ELE: "#F4B084",
  MEC: "#FFD966",
  PLU: "#B4C7E7",
  GLN: "#8FAADC"
};
const PRICING_BOOK_DEFAULT_NOTES = [
  "Client to provide free and clear work area.",
  "All work to be done during regular hours.",
  "Client to provide washroom access."
];
const PRICING_BOOK_DEFAULT_EXCLUSIONS = [
  "Weekends work or holiday work.",
  "Work or items not stated above.",
  "Fire alarm work.",
  "New gas pressure reducing valves.",
  "BAS controls connection.",
  "Roofing.",
  "Coring.",
  "Engineering, drawings, and permits.",
  "Furniture moving.",
  "Asbestos testing, remediation or removal.",
  "Contaminated soil testing, handling or removal."
];
const PRICING_BOOK_DIVISION_SHEETS = {
  CON: { title: "Construction", lineCount: 32 },
  ELE: { title: "Electrical", lineCount: 22 },
  MEC: { title: "HVAC", lineCount: 20 },
  PLU: { title: "Plumbing", lineCount: 28 },
  GLN: { title: "Glendale", lineCount: 24 }
};

function cleanString(value) {
  return String(value ?? "").trim();
}

function parseNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const raw = cleanString(value);
  if (!raw) return fallback;
  const normalized = raw.replace(/,/g, "");
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) return parsed;
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (match?.[0]) {
    const recovered = Number(match[0]);
    if (Number.isFinite(recovered)) return recovered;
  }
  return fallback;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(parseNumber(value, 0) * factor) / factor;
}

function formatMoney(value) {
  const amount = roundTo(value, 2);
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatHours(value) {
  return roundTo(value, 1).toFixed(1);
}

function formatPercent(value) {
  return `${roundTo(value, 1).toFixed(1)}%`;
}

function columnLetter(columnNumber) {
  let value = Math.max(1, Math.floor(parseNumber(columnNumber, 1)));
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function toA1(rowNumber, columnNumber) {
  return `${columnLetter(columnNumber)}${Math.max(1, Math.floor(parseNumber(rowNumber, 1)))}`;
}

function sentenceCase(value) {
  const text = cleanString(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function hexToRgbColor(hex = "#FFFFFF") {
  const normalized = cleanString(hex).replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return { red: 1, green: 1, blue: 1 };
  }
  return {
    red: parseInt(normalized.slice(0, 2), 16) / 255,
    green: parseInt(normalized.slice(2, 4), 16) / 255,
    blue: parseInt(normalized.slice(4, 6), 16) / 255
  };
}

function buildSolidBorders() {
  return {
    top: { style: "SOLID" },
    bottom: { style: "SOLID" },
    left: { style: "SOLID" },
    right: { style: "SOLID" }
  };
}

function normalizePricingBookDivisionKey(value) {
  const normalized = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  if (normalized.includes("construct") || normalized === "con") return "CON";
  if (normalized.includes("elect") || normalized === "ele") return "ELE";
  if (normalized.includes("hvac") || normalized.includes("mechanical") || normalized === "mec") return "MEC";
  if (normalized.includes("plumb") || normalized === "plu") return "PLU";
  if (normalized.includes("glendale") || normalized === "gln") return "GLN";
  return "";
}

function inferEstimatorIdFromBreakdown(breakdown = {}) {
  const estimateLines = Array.isArray(breakdown.estimateLines) ? breakdown.estimateLines : [];
  for (const line of estimateLines) {
    const estimatorId = cleanString(line?.estimator || line?.estimatorId || line?.Estimator);
    if (estimatorId) return estimatorId;
  }
  return "";
}

function splitPricingBookScopeLines(scopeText) {
  const raw = cleanString(scopeText);
  if (!raw) return [];

  const normalizedLines = raw
    .split(/\r?\n+/)
    .map((line) =>
      cleanString(line)
        .replace(/^[*•▪◦·-]+\s*/, "")
        .replace(/^\d+(?:\.\d+)?[\)\].:\-\s]*/, "")
    )
    .filter(Boolean);

  if (normalizedLines.length > 1) return normalizedLines;

  const sentenceLines = raw
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((line) =>
      cleanString(line)
        .replace(/^[*•▪◦·-]+\s*/, "")
        .replace(/^\d+(?:\.\d+)?[\)\].:\-\s]*/, "")
    )
    .filter(Boolean);

  return sentenceLines.length ? sentenceLines : normalizedLines;
}

function inferPricingBookSectionNumber(breakdown = {}, fallbackNumber = 1) {
  const explicitSectionNumber = parseNumber(breakdown?.sectionNumber, Number.NaN);
  if (Number.isFinite(explicitSectionNumber) && explicitSectionNumber > 0) {
    return Math.floor(explicitSectionNumber);
  }

  const scopeText = cleanString(breakdown?.scope);
  if (!scopeText) return Math.max(1, Math.floor(parseNumber(fallbackNumber, 1)));

  const firstNumberedLine = scopeText
    .split(/\r?\n+/)
    .map((line) => cleanString(line))
    .find((line) => /^\d+(?:\.\d+)*[\)\].:\-\s]/.test(line));
  const match = cleanString(firstNumberedLine || scopeText).match(/^(\d+)(?:\.\d+)*[\)\].:\-\s]/);
  if (match?.[1]) {
    const inferredNumber = parseNumber(match[1], Number.NaN);
    if (Number.isFinite(inferredNumber) && inferredNumber > 0) {
      return Math.floor(inferredNumber);
    }
  }

  return Math.max(1, Math.floor(parseNumber(fallbackNumber, 1)));
}

function orderPricingBookBreakdowns(breakdowns = []) {
  return (Array.isArray(breakdowns) ? breakdowns : [])
    .map((breakdown, originalIndex) => ({
      breakdown,
      originalIndex,
      sectionNumber: inferPricingBookSectionNumber(breakdown, originalIndex + 1)
    }))
    .sort((left, right) => {
      if (left.sectionNumber !== right.sectionNumber) {
        return left.sectionNumber - right.sectionNumber;
      }
      return left.originalIndex - right.originalIndex;
    });
}

function getPricingBookDivisionSheetConfig(divisionKey = "") {
  return PRICING_BOOK_DIVISION_SHEETS[cleanString(divisionKey).toUpperCase()] || null;
}

function getPricingBookDivisionSheetLayout(divisionKey = "") {
  const config = getPricingBookDivisionSheetConfig(divisionKey);
  if (!config) return null;
  const dataRow = 14;
  const subtotalRow = dataRow + config.lineCount;
  const nweTop = subtotalRow + 2;
  const headerRow = nweTop + 1;
  return {
    dataRow,
    subtotalRow,
    storyStartRow: PRICING_BOOK_STORY_START_ROW,
    storyEndRow: PRICING_BOOK_STORY_END_ROW,
    notesStartRow: headerRow + 1,
    notesEndRow: headerRow + PRICING_BOOK_NWE_ROWS,
    warrantyStartRow: headerRow + 1,
    warrantyEndRow: headerRow + PRICING_BOOK_NWE_ROWS,
    exclusionsStartRow: headerRow + 1,
    exclusionsEndRow: headerRow + PRICING_BOOK_NWE_ROWS
  };
}

function buildPricingBookEstimatorNameLookup(divisions = []) {
  const lookup = new Map();
  (Array.isArray(divisions) ? divisions : []).forEach((division) => {
    const estimatorId = cleanString(
      division?.estimatorId ||
        division?.estimator ||
        division?.templateEstimator ||
        division?.templateMapping?.estimator
    ).toUpperCase();
    const estimatorName = cleanString(division?.estimatorName);
    if (!estimatorId || !estimatorName || lookup.has(estimatorId)) return;
    lookup.set(estimatorId, estimatorName);
  });
  buildFallbackPricingBookEstimators().forEach((item) => {
    const estimatorId = cleanString(item?.id).toUpperCase();
    const estimatorName = cleanString(item?.name);
    if (!estimatorId || !estimatorName || lookup.has(estimatorId)) return;
    lookup.set(estimatorId, estimatorName);
  });
  return lookup;
}

function buildPricingBookSectionEstimatorLookup(divisions = []) {
  const lookup = new Map();
  (Array.isArray(divisions) ? divisions : []).forEach((division) => {
    const sectionId = cleanString(division?.sectionId);
    if (!sectionId || lookup.has(sectionId)) return;
    lookup.set(sectionId, {
      estimatorId: cleanString(
        division?.estimatorId ||
          division?.estimator ||
          division?.templateEstimator ||
          division?.templateMapping?.estimator
      ).toUpperCase(),
      estimatorName: cleanString(division?.estimatorName)
    });
  });
  return lookup;
}

function normalizeExpenseGroup(value = "") {
  const normalized = cleanString(value).toUpperCase();
  if (normalized === "L") return "L";
  if (normalized === "S") return "S";
  return "M";
}

function buildLineRateSummary(breakdown = {}) {
  const estimateLines = Array.isArray(breakdown?.estimateLines) ? breakdown.estimateLines : [];
  const labourLines = estimateLines.filter((line) => normalizeExpenseGroup(line?.expenseGroup || line?.accountGroup) === "L");
  if (labourLines.length) {
    const labourHours = labourLines.reduce((sum, line) => sum + parseNumber(line?.quantity, 0), 0);
    const labourCost = labourLines.reduce(
      (sum, line) => sum + parseNumber(line?.quantity, 0) * parseNumber(line?.unitCost, 0),
      0
    );
    const labourSell = labourLines.reduce(
      (sum, line) => sum + parseNumber(line?.quantity, 0) * parseNumber(line?.unitPrice, 0),
      0
    );
    return {
      sellRate: labourHours > 0 ? roundTo(labourSell / labourHours, 2) : 0,
      costRate: labourHours > 0 ? roundTo(labourCost / labourHours, 2) : 0
    };
  }

  const labour = breakdown?.labour || {};
  const totalHours = parseNumber(labour?.totalHours, 0);
  const totalCost = parseNumber(labour?.totalCost, 0);
  const totalSelling = parseNumber(labour?.totalSelling, 0);
  return {
    sellRate: totalHours > 0 ? roundTo(totalSelling / totalHours, 2) : 0,
    costRate: totalHours > 0 ? roundTo(totalCost / totalHours, 2) : 0
  };
}

function finalizePricingBookDescription(value = "", fallback = "Scope Item") {
  const text = cleanString(value)
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;

  const compactWords = text.split(/\s+/).filter(Boolean);
  if (compactWords.length <= 6 && text.length <= 48) return text;
  return compactWords.slice(0, 6).join(" ");
}

function simplifyPricingBookScopeDescription(value = "") {
  const raw = cleanString(value);
  if (!raw) return "";
  const text = raw.toLowerCase();

  const replacements = [
    [/project manager|project management/, "Project management"],
    [/site supervision|site supervisor|supervision/, "Site supervision"],
    [/softwall|partition system/, "Softwall partition"],
    [/roof joist/, "Roof joist reinforcement"],
    [/roof openings?/, "Roof opening reinforcement"],
    [/fire watch/, "Fire watch"],
    [/(power supply|branch circuit|air handler power)/, "Air handler power"],
    [/(conduit|wiring|disconnect|junction)/, "Conduit and wiring"],
    [/light fixtures?|lighting rough-?in/, "Light fixture relocation"],
    [/\blifts?\b/, "Lift access"],
    [/esa|permit|inspection/, "ESA permit and inspection"],
    [/domestic water piping|humidifier.*water piping/, "Domestic water piping"],
    [/drainage piping|nearest drain|drain piping/, "Drainage piping"],
    [/packaged rooftop units?|rooftop units?/, "Packaged rooftop units"],
    [/ductwork|supply air|return air/, "Supply/return ductwork"],
    [/gas piping/, "Gas piping"],
    [/sprinkler/, "Sprinkler modifications"],
    [/equipment rental|rental equipment/, "Equipment rental"],
    [/structural steel/, "Structural steel"],
    [/electrical supervision/, "Electrical supervision"]
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) {
      return replacement;
    }
  }

  return finalizePricingBookDescription(
    raw
      .replace(/^material allowance\s*-\s*/i, "")
      .replace(/^(?:supply and install|furnish and install|provide and install|supply and installation of|supply and installation|installation of)\s+/i, "")
      .replace(/^(?:supply labour and materials for|supply labor and materials for|supply labour for|supply labor for)\s+/i, "")
      .replace(/^(?:includes? for|includes?|included)\s+/i, "")
      .replace(/^(?:relocation of|relocate)\s+/i, "")
      .replace(/^(?:modify existing|modify)\s+/i, "")
      .replace(/^(?:new|existing)\s+/i, "")
      .replace(/\bfor up to\b.*$/i, "")
      .replace(/\bup to\b.*$/i, "")
      .replace(/\bto nearest drain\b.*$/i, "")
      .replace(/\bin work area\b.*$/i, "")
      .replace(/\bto suit\b.*$/i, "")
      .replace(/\bincluded\.?$/i, "")
      .replace(/\s+/g, " ")
  );
}

function buildDisplayDescription(line = {}, breakdown = {}) {
  const raw = cleanString(line?.description);
  const taskDescription = cleanString(breakdown?.taskDescription);
  const expenseGroup = normalizeExpenseGroup(line?.expenseGroup || line?.accountGroup);
  if (!raw && !taskDescription) return "Scope Item";

  const escapedTaskDescription = taskDescription.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutTaskPrefix = cleanString(
    raw.replace(new RegExp(`^${escapedTaskDescription}\\s*-\\s*`, "i"), "")
  );
  const normalizedRaw = cleanString(
    withoutTaskPrefix.replace(/^(?:Material|Subtrade|Consultant)\s*-\s*/i, "")
  );
  const sourceText = normalizedRaw || raw || breakdown?.scope || taskDescription;
  const conciseSource = simplifyPricingBookScopeDescription(sourceText);
  const isMaterialAllowance = /^material allowance\s*-/i.test(raw) || /(?:^|-\s*)material\s*-\s*/i.test(withoutTaskPrefix);
  const isSubtradeAllowance = /(?:^|-\s*)(?:subtrade|consultant)\s*-\s*/i.test(withoutTaskPrefix);

  if (expenseGroup === "L") {
    const role = cleanString(withoutTaskPrefix);
    if (/^(technician|general labour)$/i.test(role)) {
      return "General labour";
    }
    if (role && role.split(/\s+/).filter(Boolean).length <= 4 && role.length <= 36) {
      return finalizePricingBookDescription(role);
    }
    return finalizePricingBookDescription(conciseSource || role || taskDescription || raw);
  }

  if (expenseGroup === "S" || isSubtradeAllowance) {
    if (/permit|inspection|rental/i.test(conciseSource)) {
      return finalizePricingBookDescription(conciseSource);
    }
    return finalizePricingBookDescription(`${conciseSource || sourceText} subtrade`);
  }

  if (expenseGroup === "M" || isMaterialAllowance) {
    if (/material|rental/i.test(conciseSource)) {
      return finalizePricingBookDescription(conciseSource);
    }
    return finalizePricingBookDescription(`${conciseSource || sourceText} materials`);
  }

  return finalizePricingBookDescription(conciseSource || sourceText);
}

function buildFallbackSeedRow(breakdown = {}, section = {}) {
  const divisionKey = normalizePricingBookDivisionKey(
    breakdown?.divisionKey || breakdown?.tradeDivision || breakdown?.division
  );
  if (!divisionKey) return null;

  const labour = breakdown?.labour || {};
  const materialTotals = breakdown?.material?.totals || {};
  const subcontractorTotals = breakdown?.subcontractor?.totals || {};
  const rateSummary = buildLineRateSummary(breakdown);
  const labourHours = roundTo(labour?.totalHours, 4);
  const labourCost = roundTo(labour?.totalCost, 2);
  const labourSell = roundTo(labour?.totalSelling, 2);
  const materialCost = roundTo(materialTotals?.costTotal, 2);
  const materialSell = roundTo(materialTotals?.sellTotal, 2);
  const subcontractorCost = roundTo(subcontractorTotals?.costTotal, 2);
  const subcontractorSell = roundTo(subcontractorTotals?.sellTotal, 2);
  const totalCost = roundTo(labourCost + materialCost + subcontractorCost, 2);
  const totalSell = roundTo(labourSell + materialSell + subcontractorSell, 2);

  return {
    divisionKey,
    divisionIndex: Math.max(1, parseNumber(section?.divisionIndex, 1)),
    sectionNumber: cleanString(section?.sectionNumber || "1.00"),
    sectionId: cleanString(breakdown?.sectionId),
    rowNumber: 1,
    tradeDivision: cleanString(breakdown?.tradeDivision || breakdown?.divisionKey || "Division"),
    taskCd: cleanString(breakdown?.taskCd),
    description: cleanString(
      breakdown?.taskDescription ||
        breakdown?.tradeDivision ||
        breakdown?.scope ||
        "Scope Item"
    ),
    scope: cleanString(breakdown?.scope),
    costCode: cleanString(breakdown?.costCode),
    accountGroup: "R",
    uom: "HOUR",
    labourHours,
    labourCost,
    labourSell,
    materialCost,
    materialSell,
    subcontractorCost,
    subcontractorSell,
    totalCost,
    totalSell,
    markup: totalCost > 0 ? roundTo((totalSell - totalCost) / totalCost, 6) : 0,
    sellRate: roundTo(rateSummary.sellRate, 2),
    costRate: roundTo(rateSummary.costRate, 2),
    estimatorId: inferEstimatorIdFromBreakdown(breakdown)
  };
}

function buildDetailedSeedRowsForBreakdown(breakdown = {}, section = {}) {
  const divisionKey = normalizePricingBookDivisionKey(
    breakdown?.divisionKey || breakdown?.tradeDivision || breakdown?.division
  );
  if (!divisionKey) return [];

  const estimateLines = Array.isArray(breakdown?.estimateLines) ? breakdown.estimateLines : [];
  if (!estimateLines.length) {
    const fallbackRow = buildFallbackSeedRow(breakdown, section);
    return fallbackRow ? [fallbackRow] : [];
  }

  const rateSummary = buildLineRateSummary(breakdown);
  return estimateLines
    .map((line, lineIndex) => {
      const quantity = Math.max(0, parseNumber(line?.quantity, 0));
      const unitCost = Math.max(0, parseNumber(line?.unitCost, 0));
      const unitPrice = Math.max(0, parseNumber(line?.unitPrice, 0));
      const lineCost = roundTo(quantity * unitCost, 2);
      const lineSell = roundTo(quantity * unitPrice, 2);
      const expenseGroup = normalizeExpenseGroup(line?.expenseGroup || line?.accountGroup);
      const labourHours = expenseGroup === "L" ? roundTo(quantity, 4) : 0;
      const labourCost = expenseGroup === "L" ? lineCost : 0;
      const labourSell = expenseGroup === "L" ? lineSell : 0;
      const materialCost = expenseGroup === "M" ? lineCost : 0;
      const materialSell = expenseGroup === "M" ? lineSell : 0;
      const subcontractorCost = expenseGroup === "S" ? lineCost : 0;
      const subcontractorSell = expenseGroup === "S" ? lineSell : 0;
      const totalCost = roundTo(labourCost + materialCost + subcontractorCost, 2);
      const totalSell = roundTo(labourSell + materialSell + subcontractorSell, 2);

      return {
        divisionKey,
        divisionIndex: Math.max(1, parseNumber(section?.divisionIndex, 1)),
        sectionNumber: cleanString(section?.sectionNumber || "1.00"),
        sectionId: cleanString(breakdown?.sectionId),
        rowNumber: lineIndex + 1,
        tradeDivision: cleanString(breakdown?.tradeDivision || breakdown?.divisionKey || "Division"),
        taskCd: cleanString(line?.taskCd || breakdown?.taskCd),
        description: buildDisplayDescription(line, breakdown),
        scope: cleanString(breakdown?.scope),
        costCode: cleanString(line?.costCode || breakdown?.costCode),
        accountGroup: "R",
        uom: cleanString(line?.uom || "HOUR").toUpperCase() || "HOUR",
        labourHours,
        labourCost,
        labourSell,
        materialCost,
        materialSell,
        subcontractorCost,
        subcontractorSell,
        totalCost,
        totalSell,
        markup: totalCost > 0 ? roundTo((totalSell - totalCost) / totalCost, 6) : 0,
        sellRate: roundTo(expenseGroup === "L" ? unitPrice : rateSummary.sellRate, 2),
        costRate: roundTo(expenseGroup === "L" ? unitCost : rateSummary.costRate, 2),
        estimatorId: cleanString(line?.estimator || inferEstimatorIdFromBreakdown(breakdown))
      };
    })
    .filter((row) => row.totalCost > 0 || row.totalSell > 0 || row.labourHours > 0 || row.description);
}

function buildPricingBookSectionModels(breakdowns = []) {
  return orderPricingBookBreakdowns(breakdowns)
    .map(({ breakdown, sectionNumber }, orderedIndex) => {
      const divisionKey = normalizePricingBookDivisionKey(
        breakdown?.divisionKey || breakdown?.tradeDivision || breakdown?.division
      );
      if (!divisionKey) return null;

      const divisionIndex = orderedIndex + 1;
      const formattedSectionNumber = `${sectionNumber}.00`;
      const scopeLines = splitPricingBookScopeLines(breakdown?.scope);
      const section = {
        divisionIndex,
        sectionNumber: formattedSectionNumber
      };
      const rows = buildDetailedSeedRowsForBreakdown(breakdown, section);
      const safeRows = rows.length ? rows : [buildFallbackSeedRow(breakdown, section)].filter(Boolean);

      return {
        sectionNumber: formattedSectionNumber,
        divisionIndex,
        divisionKey,
        sectionId: cleanString(breakdown?.sectionId),
        tradeDivision: cleanString(breakdown?.tradeDivision || breakdown?.divisionKey || "Division"),
        taskCd: cleanString(breakdown?.taskCd),
        taskDescription: cleanString(breakdown?.taskDescription),
        scope: cleanString(breakdown?.scope),
        scopeLines: (scopeLines.length ? scopeLines : ["No scope provided."]).map((line, lineIndex) => ({
          code: `${sectionNumber}.${String(lineIndex + 1).padStart(2, "0")}`,
          line
        })),
        rows: safeRows,
        subtotal: {
          labourHours: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.labourHours, 0), 0), 2),
          materialCost: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.materialCost, 0), 0), 2),
          subtradeCost: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.subcontractorCost, 0), 0), 2),
          totalCost: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.totalCost, 0), 0), 2),
          materialSell: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.materialSell, 0), 0), 2),
          subtradeSell: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.subcontractorSell, 0), 0), 2),
          labourSell: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.labourSell, 0), 0), 2),
          totalSell: roundTo(safeRows.reduce((sum, row) => sum + parseNumber(row?.totalSell, 0), 0), 2)
        }
      };
    })
    .filter(Boolean);
}

function buildPricingBookSeedRows(breakdowns = []) {
  return buildPricingBookSectionModels(breakdowns).flatMap((section) => section.rows);
}

function buildPricingBookScopeSections(breakdowns = []) {
  return buildPricingBookSectionModels(breakdowns).map((section) => ({
    sectionNumber: section.sectionNumber,
    divisionIndex: section.divisionIndex,
    divisionKey: section.divisionKey,
    tradeDivision: section.tradeDivision,
    taskCd: section.taskCd,
    taskDescription: section.taskDescription,
    scope: section.scope,
    scopeLines: section.scopeLines.map((scopeLine) => ({
      code: cleanString(scopeLine?.code),
      line: cleanString(scopeLine?.line)
    }))
  }));
}

function buildPricingBookSectionTitleLookup(divisions = []) {
  const lookup = new Map();
  (Array.isArray(divisions) ? divisions : []).forEach((division) => {
    const sectionId = cleanString(division?.sectionId);
    if (!sectionId) return;
    const title = cleanString(division?.title || division?.sectionTitle || division?.taskDescription);
    if (!title) return;
    lookup.set(sectionId, title);
  });
  return lookup;
}

function buildPricingBookDivisionStoryLines(sections = [], options = {}) {
  const items = Array.isArray(sections) ? sections : [];
  if (!items.length) return [];

  const multiSection = items.length > 1;
  const titleLookup = options?.sectionTitleLookup instanceof Map ? options.sectionTitleLookup : new Map();
  const lines = [];

  items.forEach((section, index) => {
    const sectionTitle =
      cleanString(titleLookup.get(cleanString(section?.sectionId))) ||
      cleanString(section?.taskDescription || section?.tradeDivision);
    if (multiSection && sectionTitle) {
      lines.push(sectionTitle);
    }
    (Array.isArray(section?.scopeLines) ? section.scopeLines : []).forEach((scopeLine) => {
      const line = cleanString(scopeLine?.line || scopeLine?.sourceText);
      if (line) lines.push(line);
    });
    if (multiSection && index < items.length - 1) {
      lines.push("");
    }
  });

  const compact = [];
  lines.forEach((line) => {
    const value = cleanString(line);
    const previous = compact[compact.length - 1];
    if (!value && !previous) return;
    compact.push(value);
  });

  while (compact.length && !cleanString(compact[compact.length - 1])) {
    compact.pop();
  }

  return compact;
}

function buildPricingBookDivisionSheetModels({
  payload,
  quoteSummary,
  opportunityId,
  breakdowns
}) {
  const sections = buildPricingBookSectionModels(breakdowns);
  const titleLookup = buildPricingBookSectionTitleLookup(payload?.divisions);
  const sectionEstimatorLookup = buildPricingBookSectionEstimatorLookup(payload?.divisions);
  const estimatorNameLookup = buildPricingBookEstimatorNameLookup(payload?.divisions);
  const grouped = new Map();

  sections.forEach((section) => {
    const config = getPricingBookDivisionSheetConfig(section?.divisionKey);
    if (!config) return;
    const key = cleanString(section?.divisionKey).toUpperCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        divisionKey: key,
        sheetTitle: config.title,
        sections: [],
        estimatorName: ""
      });
    }
    const group = grouped.get(key);
    group.sections.push(section);
    if (!group.estimatorName) {
      const sectionEstimator = sectionEstimatorLookup.get(cleanString(section?.sectionId)) || {};
      const estimatorId =
        cleanString(sectionEstimator?.estimatorId) ||
        cleanString(section?.rows?.find((row) => cleanString(row?.estimatorId))?.estimatorId) ||
        cleanString(section?.rows?.[0]?.estimatorId);
      group.estimatorName =
        cleanString(sectionEstimator?.estimatorName) ||
        resolvePricingBookEstimatorName(estimatorId, { lookup: estimatorNameLookup });
    }
  });

  return Array.from(grouped.values()).map((group) => ({
    ...group,
    clientName: cleanString(payload?.account?.name),
    projectName: cleanString(quoteSummary || payload?.account?.name),
    opportunityId: cleanString(opportunityId),
    rows: group.sections.flatMap((section) => (Array.isArray(section?.rows) ? section.rows : [])),
    storyLines: buildPricingBookDivisionStoryLines(group.sections, {
      sectionTitleLookup: titleLookup
    })
  }));
}

function buildPricingBookDivisionSheetValueRow(row = {}) {
  const labourHours = roundTo(row?.labourHours, 1);
  const materialCost = roundTo(row?.materialCost, 2);
  const subtradeCost = roundTo(row?.subcontractorCost, 2);
  const totalCost = roundTo(row?.totalCost, 2);
  const markup = parseNumber(row?.markup, 0);
  const sellRate = labourHours > 0 ? roundTo(row?.sellRate, 2) : 0;
  const materialSell = roundTo(row?.materialSell, 2);
  const subtradeSell = roundTo(row?.subcontractorSell, 2);
  const labourSell = roundTo(row?.labourSell, 2);
  const totalSell = roundTo(row?.totalSell, 2);

  return [
    labourHours > 0 ? labourHours : "",
    materialCost > 0 ? materialCost : "",
    subtradeCost > 0 ? subtradeCost : "",
    totalCost > 0 ? totalCost : "",
    totalCost > 0 ? markup : "",
    sellRate > 0 ? sellRate : "",
    materialSell > 0 ? materialSell : "",
    subtradeSell > 0 ? subtradeSell : "",
    labourSell > 0 ? labourSell : "",
    totalSell > 0 ? totalSell : ""
  ];
}

function buildPricingBookDivisionSheetWritePlan(sheet = {}) {
  const sheetTitle = cleanString(sheet?.sheetTitle);
  const divisionKey = cleanString(sheet?.divisionKey);
  const config = getPricingBookDivisionSheetConfig(divisionKey);
  const layout = getPricingBookDivisionSheetLayout(divisionKey);
  if (!sheetTitle || !config || !layout) return null;

  const allRows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const visibleRows = allRows.slice(0, config.lineCount);
  const storyValues = (Array.isArray(sheet?.storyLines) ? sheet.storyLines : [])
    .slice(0, layout.storyEndRow - layout.storyStartRow + 1)
    .map((line) => [cleanString(line)]);
  const descriptionValues = visibleRows.map((row) => [cleanString(row?.description)]);
  const dataValues = visibleRows.map((row) => buildPricingBookDivisionSheetValueRow(row));
  const updates = [
    {
      range: `'${sheetTitle}'!C2:C5`,
      values: [
        [cleanString(sheet.clientName)],
        [cleanString(sheet.projectName)],
        [cleanString(sheet.opportunityId)],
        [cleanString(sheet.estimatorName)]
      ]
    }
  ];

  if (descriptionValues.length) {
    updates.push({
      range: `'${sheetTitle}'!B${layout.dataRow}:B${layout.dataRow + descriptionValues.length - 1}`,
      values: descriptionValues
    });
  }
  if (dataValues.length) {
    updates.push({
      range: `'${sheetTitle}'!E${layout.dataRow}:N${layout.dataRow + dataValues.length - 1}`,
      values: dataValues
    });
  }
  if (storyValues.length) {
    updates.push({
      range: `'${sheetTitle}'!X${layout.storyStartRow}:X${layout.storyStartRow + storyValues.length - 1}`,
      values: storyValues
    });
  }

  return {
    sheetTitle,
    divisionKey,
    totalRows: allRows.length,
    writtenRows: visibleRows.length,
    overflowRows: Math.max(0, allRows.length - visibleRows.length),
    clearRanges: [
      `'${sheetTitle}'!B${layout.dataRow}:B${layout.subtotalRow - 1}`,
      `'${sheetTitle}'!E${layout.dataRow}:N${layout.subtotalRow - 1}`,
      `'${sheetTitle}'!X${layout.storyStartRow}:X${layout.storyEndRow}`
    ],
    updates
  };
}

function buildPricingBookMainEstimate({
  payload,
  quoteSummary,
  divisionRows,
  opportunityId,
  quoteNbr
}) {
  const rows = Array.isArray(divisionRows) ? divisionRows : [];
  const projectBudget = roundTo(rows.reduce((sum, row) => sum + parseNumber(row?.totalCost), 0), 2);
  const projectSellingPrice = roundTo(rows.reduce((sum, row) => sum + parseNumber(row?.totalSell), 0), 2);
  const grandTotal = projectSellingPrice;
  const markupPercent = projectBudget > 0 ? roundTo(((projectSellingPrice - projectBudget) / projectBudget) * 100, 1) : 0;
  const marginPercent = projectSellingPrice > 0 ? roundTo(((projectSellingPrice - projectBudget) / projectSellingPrice) * 100, 1) : 0;

  return {
    version: "v1",
    builtDate: new Date().toISOString().slice(0, 10),
    projectName: cleanString(quoteSummary || payload?.account?.name),
    accountName: cleanString(payload?.account?.name),
    opportunityId: cleanString(opportunityId),
    quoteNbr: cleanString(quoteNbr),
    projectBudget,
    projectSellingPrice,
    markupPercent,
    marginPercent,
    grandTotal
  };
}

function buildMainQuoteDataRow(row = {}) {
  return [
    cleanString(row?.tradeDivision),
    cleanString(row?.taskCd),
    cleanString(row?.description),
    formatHours(row?.labourHours),
    formatMoney(row?.materialCost),
    formatMoney(row?.subcontractorCost),
    formatMoney(row?.totalCost),
    formatPercent(parseNumber(row?.markup, 0) * 100),
    formatMoney(row?.sellRate),
    formatMoney(row?.materialSell),
    formatMoney(row?.subcontractorSell),
    formatMoney(row?.labourSell),
    formatMoney(row?.totalSell)
  ];
}

function buildMainQuoteSheetDataRow(row = {}) {
  const labourHours = roundTo(row?.labourHours, 1);
  const materialCost = roundTo(row?.materialCost, 2);
  const subcontractorCost = roundTo(row?.subcontractorCost, 2);
  const totalCost = roundTo(row?.totalCost, 2);
  const markup = parseNumber(row?.markup, 0);
  const sellRate = roundTo(row?.sellRate, 2);
  const materialSell = roundTo(row?.materialSell, 2);
  const subcontractorSell = roundTo(row?.subcontractorSell, 2);
  const labourSell = roundTo(row?.labourSell, 2);
  const totalSell = roundTo(row?.totalSell, 2);

  return [
    cleanString(row?.tradeDivision),
    cleanString(row?.taskCd),
    cleanString(row?.description),
    labourHours > 0 ? labourHours : "",
    materialCost > 0 ? materialCost : "",
    subcontractorCost > 0 ? subcontractorCost : "",
    totalCost > 0 ? totalCost : "",
    totalCost > 0 ? markup : "",
    sellRate > 0 ? sellRate : "",
    materialSell > 0 ? materialSell : "",
    subcontractorSell > 0 ? subcontractorSell : "",
    labourSell > 0 ? labourSell : "",
    totalSell > 0 ? totalSell : ""
  ];
}

function buildSubtotalRow(section = {}) {
  const subtotal = section?.subtotal || {};
  return [
    "Subtotals",
    "",
    "",
    formatHours(subtotal?.labourHours),
    formatMoney(subtotal?.materialCost),
    formatMoney(subtotal?.subtradeCost),
    formatMoney(subtotal?.totalCost),
    "",
    "",
    formatMoney(subtotal?.materialSell),
    formatMoney(subtotal?.subtradeSell),
    formatMoney(subtotal?.labourSell),
    formatMoney(subtotal?.totalSell)
  ];
}

function buildPricingBookStructuredMainQuoteRows({
  payload,
  quoteSummary,
  quoteNbr,
  opportunityId,
  breakdowns
}) {
  const divisionRows = buildPricingBookSeedRows(breakdowns);
  const mainEstimate = buildPricingBookMainEstimate({
    payload,
    quoteSummary,
    divisionRows,
    opportunityId,
    quoteNbr
  });
  const sections = buildPricingBookSectionModels(breakdowns);
  const rows = [
    ["", "", "", "", "Version", mainEstimate.version],
    ["", "", "", "", "Built", mainEstimate.builtDate],
    ["", "", "", "", "Grand Total", formatMoney(mainEstimate.grandTotal)],
    []
  ];

  sections.forEach((section) => {
    rows.push([`${section.sectionNumber} ${section.tradeDivision}`]);
    rows.push(["Scope of Work"]);
    section.scopeLines.forEach((scopeLine) => {
      rows.push([`${cleanString(scopeLine?.code)} ${cleanString(scopeLine?.line)}`.trim()]);
    });
    rows.push([...MAIN_QUOTE_TABLE_HEADER]);
    section.rows.forEach((row) => {
      rows.push(buildMainQuoteDataRow(row));
    });
    rows.push(buildSubtotalRow(section));
  });

  return rows;
}

function buildPricingBookLegacyMainQuoteModel({
  payload,
  quoteSummary,
  quoteNbr,
  opportunityId,
  breakdowns
}) {
  const divisionRows = buildPricingBookSeedRows(breakdowns);
  const mainEstimate = buildPricingBookMainEstimate({
    payload,
    quoteSummary,
    divisionRows,
    opportunityId,
    quoteNbr
  });
  const sections = buildPricingBookSectionModels(breakdowns);
  const sectionPlans = [];
  const totalCostCells = [];
  const totalSellCells = [];
  let row = PRICING_BOOK_MAIN_QUOTE_START_ROW;

  sections.forEach((section) => {
    const sectionPlan = {
      ...section,
      sectionRow: row,
      scopeHeaderRow: row + 1
    };
    row += 2;
    sectionPlan.scopeRows = section.scopeLines.map((scopeLine) => {
      const result = {
        row,
        value: `${cleanString(scopeLine?.code)} ${cleanString(scopeLine?.line)}`.trim()
      };
      row += 1;
      return result;
    });
    row += 1;
    sectionPlan.tableHeaderRow = row;
    row += 1;
    sectionPlan.dataStartRow = row;
    sectionPlan.dataEndRow = row + section.rows.length - 1;
    row += section.rows.length;
    sectionPlan.subtotalRow = row;
    sectionPlan.costCell = toA1(sectionPlan.subtotalRow, 8);
    sectionPlan.sellCell = toA1(sectionPlan.subtotalRow, 14);
    totalCostCells.push(sectionPlan.costCell);
    totalSellCells.push(sectionPlan.sellCell);
    row += 2;
    sectionPlans.push(sectionPlan);
  });

  const footer = {
    headerRow: row,
    notesTitleRow: row + 2,
    noteRows: PRICING_BOOK_DEFAULT_NOTES.map((note, index) => ({
      row: row + 3 + index,
      value: `• ${cleanString(note)}`
    }))
  };
  footer.warrantyTitleRow = footer.noteRows[footer.noteRows.length - 1].row + 2;
  footer.warrantyRows = [{ row: footer.warrantyTitleRow + 1, value: "• —" }];
  footer.exclusionsTitleRow = footer.warrantyRows[footer.warrantyRows.length - 1].row + 2;
  footer.exclusionRows = PRICING_BOOK_DEFAULT_EXCLUSIONS.map((exclusion, index) => ({
    row: footer.exclusionsTitleRow + 1 + index,
    value: `• ${sentenceCase(exclusion)}`
  }));
  footer.endRow = footer.exclusionRows[footer.exclusionRows.length - 1].row;

  return {
    mainEstimate,
    sections: sectionPlans,
    totalCostCells,
    totalSellCells,
    footer
  };
}

function buildPricingBookLegacyMainQuoteUpdates(sheetTitle = "", model = {}) {
  const title = cleanString(sheetTitle);
  if (!title) return [];

  const sellFormula = model.totalSellCells?.length ? `=${model.totalSellCells.join("+")}` : "=0";
  const costFormula = model.totalCostCells?.length ? `=${model.totalCostCells.join("+")}` : "=0";
  const updates = [
    {
      range: `'${title}'!B1`,
      values: [["Main Estimate"]]
    },
    {
      range: `'${title}'!E1:F3`,
      values: [
        ["Version", cleanString(model.mainEstimate?.version || "v1")],
        ["Built", cleanString(model.mainEstimate?.builtDate)],
        ["Grand Total", sellFormula]
      ]
    },
    {
      range: `'${title}'!B2:C7`,
      values: [
        ["Project Name", cleanString(model.mainEstimate?.projectName)],
        ["Opportunity ID", cleanString(model.mainEstimate?.opportunityId)],
        ["Project Budget", costFormula],
        ["Project Selling Price", sellFormula],
        ["Markup", "=IF(C4>0,(C5-C4)/C4,\"\")"],
        ["Margin", "=IF(C5>0,(C5-C4)/C5,\"\")"]
      ]
    }
  ];

  (Array.isArray(model.sections) ? model.sections : []).forEach((section) => {
    updates.push({
      range: `'${title}'!B${section.sectionRow}`,
      values: [[`${cleanString(section.sectionNumber)} ${cleanString(section.tradeDivision)}`.trim()]]
    });
    updates.push({
      range: `'${title}'!B${section.scopeHeaderRow}`,
      values: [["Scope of Work"]]
    });
    section.scopeRows.forEach((scopeRow) => {
      updates.push({
        range: `'${title}'!B${scopeRow.row}`,
        values: [[cleanString(scopeRow.value)]]
      });
    });
    updates.push({
      range: `'${title}'!B${section.tableHeaderRow}:N${section.tableHeaderRow}`,
      values: [MAIN_QUOTE_TABLE_HEADER]
    });
    updates.push({
      range: `'${title}'!B${section.dataStartRow}:N${section.dataEndRow}`,
      values: section.rows.map((row) => buildMainQuoteSheetDataRow(row))
    });
    updates.push({
      range: `'${title}'!B${section.subtotalRow}:Q${section.subtotalRow}`,
      values: [[
        "Subtotals",
        "",
        "",
        `=SUM(E${section.dataStartRow}:E${section.dataEndRow})`,
        `=SUM(F${section.dataStartRow}:F${section.dataEndRow})`,
        `=SUM(G${section.dataStartRow}:G${section.dataEndRow})`,
        `=SUM(H${section.dataStartRow}:H${section.dataEndRow})`,
        "",
        `=SUM(J${section.dataStartRow}:J${section.dataEndRow})`,
        `=SUM(K${section.dataStartRow}:K${section.dataEndRow})`,
        `=SUM(L${section.dataStartRow}:L${section.dataEndRow})`,
        `=SUM(M${section.dataStartRow}:M${section.dataEndRow})`,
        `=SUM(N${section.dataStartRow}:N${section.dataEndRow})`,
        "",
        "Margin",
        `=IF(N${section.subtotalRow}>0,(N${section.subtotalRow}-H${section.subtotalRow})/N${section.subtotalRow},\"\")`
      ]]
    });
  });

  if (model.footer) {
    updates.push({
      range: `'${title}'!B${model.footer.headerRow}`,
      values: [["Notes & Exclusions (All divisions, unique + defaults)"]]
    });
    updates.push({
      range: `'${title}'!B${model.footer.notesTitleRow}`,
      values: [["Notes"]]
    });
    model.footer.noteRows.forEach((noteRow) => {
      updates.push({
        range: `'${title}'!B${noteRow.row}`,
        values: [[cleanString(noteRow.value)]]
      });
    });
    updates.push({
      range: `'${title}'!B${model.footer.warrantyTitleRow}`,
      values: [["Warranty"]]
    });
    model.footer.warrantyRows.forEach((warrantyRow) => {
      updates.push({
        range: `'${title}'!B${warrantyRow.row}`,
        values: [[cleanString(warrantyRow.value)]]
      });
    });
    updates.push({
      range: `'${title}'!B${model.footer.exclusionsTitleRow}`,
      values: [["Exclusions"]]
    });
    model.footer.exclusionRows.forEach((exclusionRow) => {
      updates.push({
        range: `'${title}'!B${exclusionRow.row}`,
        values: [[cleanString(exclusionRow.value)]]
      });
    });
  }

  return updates;
}

function buildPricingBookLegacyMainQuoteRequests(sheetId, model = {}) {
  if (!Number.isFinite(sheetId)) return [];

  const requests = [
    {
      unmergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: Math.max(250, parseNumber(model.footer?.endRow, 250)),
          startColumnIndex: 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
        }
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 7
          }
        },
        fields: "gridProperties.frozenRowCount"
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 60
        },
        properties: {
          pixelSize: PRICING_BOOK_SHEET_DEFAULT_COLUMN_WIDTH
        },
        fields: "pixelSize"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 1,
          endColumnIndex: 2
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
              fontSize: 13
            }
          }
        },
        fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 4,
          endColumnIndex: 5
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true
            }
          }
        },
        fields: "userEnteredFormat.textFormat.bold"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 7,
          startColumnIndex: 1,
          endColumnIndex: 2
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true
            }
          }
        },
        fields: "userEnteredFormat.textFormat.bold"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 2,
          endRowIndex: 3,
          startColumnIndex: 5,
          endColumnIndex: 6
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
              fontSize: 12
            },
            numberFormat: {
              type: "CURRENCY",
              pattern: "$#,##0.00"
            },
            borders: buildSolidBorders()
          }
        },
        fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize,userEnteredFormat.numberFormat,userEnteredFormat.borders"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 3,
          endRowIndex: 5,
          startColumnIndex: 2,
          endColumnIndex: 3
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "CURRENCY",
              pattern: "$#,##0.00"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 5,
          endRowIndex: 7,
          startColumnIndex: 2,
          endColumnIndex: 3
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "PERCENT",
              pattern: "0.0%"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    }
  ];

  (Array.isArray(model.sections) ? model.sections : []).forEach((section) => {
    const divisionColor = hexToRgbColor(
      PRICING_BOOK_DIVISION_COLORS[cleanString(section.divisionKey).toUpperCase()] || "#E2E2E2"
    );
    const headerColor = hexToRgbColor(PRICING_BOOK_SUMMARY_HEADER_COLOR);
    const subtotalColor = hexToRgbColor(PRICING_BOOK_SUMMARY_SUBTOTAL_COLOR);
    const scopeColor = hexToRgbColor(PRICING_BOOK_SUMMARY_SCOPE_COLOR);

    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: section.sectionRow - 1,
          endRowIndex: section.sectionRow,
          startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
        },
        mergeType: "MERGE_ALL"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.sectionRow - 1,
          endRowIndex: section.sectionRow,
          startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: divisionColor,
            textFormat: {
              bold: true
            },
            borders: buildSolidBorders()
          }
        },
        fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.borders"
      }
    });
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: section.scopeHeaderRow - 1,
          endRowIndex: section.scopeHeaderRow,
          startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
        },
        mergeType: "MERGE_ALL"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.scopeHeaderRow - 1,
          endRowIndex: section.scopeHeaderRow,
          startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: scopeColor,
            textFormat: {
              bold: true
            },
            borders: buildSolidBorders()
          }
        },
        fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.borders"
      }
    });
    section.scopeRows.forEach((scopeRow) => {
      requests.push({
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: scopeRow.row - 1,
            endRowIndex: scopeRow.row,
            startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
            endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
          },
          mergeType: "MERGE_ALL"
        }
      });
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: scopeRow.row - 1,
            endRowIndex: scopeRow.row,
            startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
            endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
          },
          cell: {
            userEnteredFormat: {
              wrapStrategy: "WRAP"
            }
          },
          fields: "userEnteredFormat.wrapStrategy"
        }
      });
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.tableHeaderRow - 1,
          endRowIndex: section.tableHeaderRow,
          startColumnIndex: PRICING_BOOK_MAIN_QUOTE_TABLE_START_COLUMN - 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_TABLE_END_COLUMN
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: headerColor,
            textFormat: {
              bold: true
            },
            horizontalAlignment: "CENTER",
            borders: buildSolidBorders()
          }
        },
        fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment,userEnteredFormat.borders"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.dataStartRow - 1,
          endRowIndex: section.dataEndRow,
          startColumnIndex: 3,
          endColumnIndex: 4
        },
        cell: {
          userEnteredFormat: {
            wrapStrategy: "WRAP"
          }
        },
        fields: "userEnteredFormat.wrapStrategy"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.dataStartRow - 1,
          endRowIndex: section.dataEndRow + 1,
          startColumnIndex: 4,
          endColumnIndex: 5
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "NUMBER",
              pattern: "0.0"
            },
            horizontalAlignment: "RIGHT"
          }
        },
        fields: "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.dataStartRow - 1,
          endRowIndex: section.dataEndRow + 1,
          startColumnIndex: 8,
          endColumnIndex: 9
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "PERCENT",
              pattern: "0.0%"
            },
            horizontalAlignment: "RIGHT"
          }
        },
        fields: "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      }
    });
    [5, 6, 7, 9, 10, 11, 12, 13].forEach((columnIndexZeroBased) => {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: section.dataStartRow - 1,
            endRowIndex: section.dataEndRow + 1,
            startColumnIndex: columnIndexZeroBased,
            endColumnIndex: columnIndexZeroBased + 1
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: "CURRENCY",
                pattern: "$#,##0.00"
              },
              horizontalAlignment: "RIGHT"
            }
          },
          fields: "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
        }
      });
    });
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: section.subtotalRow - 1,
          endRowIndex: section.subtotalRow,
          startColumnIndex: 1,
          endColumnIndex: 3
        },
        mergeType: "MERGE_ALL"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.subtotalRow - 1,
          endRowIndex: section.subtotalRow,
          startColumnIndex: 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_TOTAL_END_COLUMN
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: subtotalColor,
            textFormat: {
              bold: true
            },
            borders: buildSolidBorders()
          }
        },
        fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.borders"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: section.subtotalRow - 1,
          endRowIndex: section.subtotalRow,
          startColumnIndex: 16,
          endColumnIndex: 17
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "PERCENT",
              pattern: "0.0%"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    });
  });

  if (model.footer) {
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: model.footer.headerRow - 1,
          endRowIndex: model.footer.headerRow,
          startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
        },
        mergeType: "MERGE_ALL"
      }
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: model.footer.headerRow - 1,
          endRowIndex: model.footer.headerRow,
          startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
          endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(PRICING_BOOK_SUMMARY_SCOPE_COLOR),
            textFormat: {
              bold: true
            },
            borders: buildSolidBorders()
          }
        },
        fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.borders"
      }
    });
    [model.footer.notesTitleRow, model.footer.warrantyTitleRow, model.footer.exclusionsTitleRow].forEach((rowNumber) => {
      requests.push({
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: rowNumber - 1,
            endRowIndex: rowNumber,
            startColumnIndex: 1,
            endColumnIndex: 3
          },
          mergeType: "MERGE_ALL"
        }
      });
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: rowNumber - 1,
            endRowIndex: rowNumber,
            startColumnIndex: 1,
            endColumnIndex: 3
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                bold: true
              }
            }
          },
          fields: "userEnteredFormat.textFormat.bold"
        }
      });
    });
    [...model.footer.noteRows, ...model.footer.warrantyRows, ...model.footer.exclusionRows].forEach((row) => {
      requests.push({
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: row.row - 1,
            endRowIndex: row.row,
            startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
            endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
          },
          mergeType: "MERGE_ALL"
        }
      });
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: row.row - 1,
            endRowIndex: row.row,
            startColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_START_COLUMN - 1,
            endColumnIndex: PRICING_BOOK_MAIN_QUOTE_MERGE_END_COLUMN
          },
          cell: {
            userEnteredFormat: {
              wrapStrategy: "WRAP"
            }
          },
          fields: "userEnteredFormat.wrapStrategy"
        }
      });
    });
  }

  return requests;
}

function buildPricingBookStructuredScopeRows({
  quoteSummary,
  quoteBackupSummary,
  quoteNbr,
  opportunityId,
  breakdowns
}) {
  const sections = buildPricingBookSectionModels(breakdowns);
  const rows = [
    ["Scope Summary"],
    ["Quote Summary", cleanString(quoteSummary)],
    ["Backup Summary", cleanString(quoteBackupSummary)],
    ["Quote #", cleanString(quoteNbr)],
    ["Opportunity ID", cleanString(opportunityId)],
    []
  ];

  sections.forEach((section) => {
    rows.push([`${section.sectionNumber} ${section.tradeDivision}`]);
    section.scopeLines.forEach((scopeLine) => {
      rows.push([cleanString(scopeLine?.code), cleanString(scopeLine?.line)]);
    });
    rows.push([]);
  });

  return rows;
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

function buildSheetsGoogleAuth() {
  const credentials = parseServiceAccountCredentialsFromEnv();
  if (credentials) {
    return new google.auth.GoogleAuth({
      scopes: GOOGLE_SHEETS_SCOPES,
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
      scopes: GOOGLE_SHEETS_SCOPES,
      keyFile
    });
  }

  return new google.auth.GoogleAuth({
    scopes: GOOGLE_SHEETS_SCOPES
  });
}

async function buildSheetsClient() {
  const auth = buildSheetsGoogleAuth();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
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

async function applyStructuredPricingBookWorkbook({
  fileId,
  payload,
  quoteSummary,
  quoteNbr,
  opportunityId,
  breakdowns,
  quoteBackupSummary
}) {
  const spreadsheetId = cleanString(fileId);
  if (!spreadsheetId) {
    return {
      attempted: false,
      seeded: false,
      summaryApplied: false,
      rowsWritten: 0,
      sheetsTouched: 0,
      message: "Pricing book file id is missing; skipped structured workbook write."
    };
  }

  try {
    const sheets = await buildSheetsClient();
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
      includeGridData: false
    });
    const existingTitles = new Set(
      (spreadsheet.data.sheets || []).map((sheet) => cleanString(sheet?.properties?.title)).filter(Boolean)
    );
    const sheetIdByTitle = new Map(
      (spreadsheet.data.sheets || [])
        .map((sheet) => [cleanString(sheet?.properties?.title), parseNumber(sheet?.properties?.sheetId, NaN)])
        .filter((entry) => entry[0] && Number.isFinite(entry[1]))
    );
    const legacyMainQuoteModel = buildPricingBookLegacyMainQuoteModel({
      payload,
      quoteSummary,
      quoteNbr,
      opportunityId,
      breakdowns
    });

    const scopeRows = buildPricingBookStructuredScopeRows({
      quoteSummary,
      quoteBackupSummary,
      quoteNbr,
      opportunityId,
      breakdowns
    });
    const divisionSheetModels = buildPricingBookDivisionSheetModels({
      payload,
      quoteSummary,
      opportunityId,
      breakdowns
    });

    const clearRanges = [];
    const updates = [];
    const formatRequests = [];
    const expectedMainQuoteSheets = MAIN_QUOTE_SHEET_TITLES.filter((title) => existingTitles.has(title));
    MAIN_QUOTE_SHEET_TITLES.forEach((title) => {
      if (!existingTitles.has(title)) return;
      clearRanges.push(`'${title}'!A1:R500`);
      updates.push(...buildPricingBookLegacyMainQuoteUpdates(title, legacyMainQuoteModel));
      formatRequests.push(
        ...buildPricingBookLegacyMainQuoteRequests(sheetIdByTitle.get(title), legacyMainQuoteModel)
      );
    });
    if (existingTitles.has(SCOPE_SHEET_TITLE)) {
      clearRanges.push(`'${SCOPE_SHEET_TITLE}'!A1:F250`);
      updates.push({
        range: `'${SCOPE_SHEET_TITLE}'!A1`,
        values: scopeRows
      });
    }
    const divisionSheetPlans = divisionSheetModels
      .filter((sheet) => existingTitles.has(sheet.sheetTitle))
      .map((sheet) => buildPricingBookDivisionSheetWritePlan(sheet))
      .filter(Boolean);
    divisionSheetPlans.forEach((plan) => {
      clearRanges.push(...plan.clearRanges);
      updates.push(...plan.updates);
    });

    if (!updates.length) {
      return {
        attempted: true,
        seeded: false,
        summaryApplied: false,
        rowsWritten: 0,
        sheetsTouched: 0,
        message: "Pricing book workbook did not include Main Quote, Summary, or Scope sheets."
      };
    }

    if (formatRequests.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: formatRequests
        }
      });
    }
    const uniqueClearRanges = Array.from(new Set(clearRanges.filter(Boolean)));
    if (uniqueClearRanges.length) {
      await sheets.spreadsheets.values.batchClear({
        spreadsheetId,
        requestBody: {
          ranges: uniqueClearRanges
        }
      });
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates
      }
    });

    const touchedSheets = new Set(
      updates
        .map((update) => cleanString(update?.range).match(/^'([^']+)'!/))
        .map((match) => cleanString(match?.[1]))
        .filter(Boolean)
    );
    const rowsWritten = updates.reduce(
      (sum, update) => sum + (Array.isArray(update?.values) ? update.values.length : 0),
      0
    );
    const mainQuoteSheetsTouched = expectedMainQuoteSheets.filter((title) => touchedSheets.has(title));
    const scopeExpected = existingTitles.has(SCOPE_SHEET_TITLE);
    const scopeApplied = !scopeExpected || touchedSheets.has(SCOPE_SHEET_TITLE);
    const divisionRowsWritten = divisionSheetPlans.reduce((sum, plan) => sum + parseNumber(plan?.writtenRows, 0), 0);
    const divisionOverflowRows = divisionSheetPlans.reduce((sum, plan) => sum + parseNumber(plan?.overflowRows, 0), 0);
    const divisionApplied =
      !divisionSheetPlans.length ||
      divisionSheetPlans.every((plan) => touchedSheets.has(plan.sheetTitle) && (plan.writtenRows > 0 || plan.totalRows === 0));
    const summaryApplied =
      mainQuoteSheetsTouched.length === expectedMainQuoteSheets.length &&
      mainQuoteSheetsTouched.length > 0 &&
      scopeApplied &&
      divisionApplied;
    const seeded = rowsWritten > 0 && (mainQuoteSheetsTouched.length > 0 || divisionRowsWritten > 0 || scopeApplied);
    const messageParts = [
      "Structured workbook write completed.",
      `mainQuoteSheets=${mainQuoteSheetsTouched.length}/${expectedMainQuoteSheets.length}`,
      `divisionRows=${divisionRowsWritten}`,
      `divisionSheets=${divisionSheetPlans.length}`,
      scopeExpected ? `scope=${scopeApplied ? "yes" : "no"}` : "scope=n/a"
    ];
    if (divisionOverflowRows > 0) {
      messageParts.push(`overflowRows=${divisionOverflowRows}`);
    }

    return {
      attempted: true,
      seeded,
      summaryApplied,
      rowsWritten,
      divisionRowsWritten,
      sheetsTouched: touchedSheets.size,
      message: messageParts.join(" ")
    };
  } catch (error) {
    return {
      attempted: true,
      seeded: false,
      summaryApplied: false,
      rowsWritten: 0,
      divisionRowsWritten: 0,
      sheetsTouched: 0,
      message: `Structured workbook write failed: ${extractGoogleErrorMessage(error)}`
    };
  }
}

export {
  MAIN_QUOTE_TABLE_HEADER,
  applyStructuredPricingBookWorkbook,
  buildPricingBookMainEstimate,
  buildPricingBookDivisionSheetModels,
  buildPricingBookDivisionSheetWritePlan,
  buildPricingBookScopeSections,
  buildPricingBookSeedRows,
  buildPricingBookDivisionStoryLines,
  buildPricingBookLegacyMainQuoteModel,
  buildPricingBookStructuredMainQuoteRows,
  buildPricingBookStructuredScopeRows,
  normalizePricingBookDivisionKey
};

export const __test__ = {
  MAIN_QUOTE_TABLE_HEADER,
  buildPricingBookMainEstimate,
  buildPricingBookDivisionSheetModels,
  buildPricingBookDivisionSheetWritePlan,
  buildPricingBookDivisionStoryLines,
  buildPricingBookLegacyMainQuoteModel,
  buildPricingBookScopeSections,
  buildPricingBookSeedRows,
  buildPricingBookSectionModels,
  buildPricingBookStructuredMainQuoteRows,
  buildPricingBookStructuredScopeRows,
  normalizePricingBookDivisionKey,
  splitPricingBookScopeLines
};
