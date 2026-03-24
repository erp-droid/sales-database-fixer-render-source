import OpenAI from "openai";

import { suggestHistoricalEstimateMatches } from "./estimateLibrary.js";

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
  if (match) {
    const recovered = Number(match[0]);
    if (Number.isFinite(recovered)) return recovered;
  }
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStringList(values = []) {
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

function normalizeClarifications(value = []) {
  return toArray(value)
    .map((entry) => ({
      question: cleanString(entry?.question),
      answer: cleanString(entry?.answer)
    }))
    .filter((entry) => entry.question && entry.answer);
}

function extractJsonObject(rawText) {
  const text = cleanString(rawText);
  if (!text) return null;

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  const candidate = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    return null;
  }
}

function collapseWhitespace(value) {
  return cleanString(value).replace(/\s+/g, " ");
}

function truncateText(value, max = 85) {
  const text = collapseWhitespace(value);
  if (!text) return "";
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const safeSlice = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return safeSlice.trimEnd();
}

function toTitleCase(value) {
  const text = cleanString(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stripDescriptionNoise(raw = "") {
  return collapseWhitespace(raw)
    .replace(/[\u2022•▪◦·]/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/^\d+\s*[\.\)\-:]\s*/g, "")
    .replace(/^(construction|electrical|plumbing|hvac|glendale)\s*/i, "")
    .replace(/^(scope of work|statement of work|scope)\s*[:\-]\s*/i, "")
    .trim();
}

function limitWords(value, maxWords = 10) {
  const words = cleanString(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join(" ");
}

function extractPrimaryScopePhrase(rawScope) {
  const cleaned = stripDescriptionNoise(rawScope);
  if (!cleaned) return "";

  let phrase = cleaned.split(/(?<=[.!?;:])\s+|\s+-\s+/)[0];
  phrase = phrase.replace(/\b(?:including|includes?)\b.*$/i, "").trim();
  phrase = phrase.replace(/^supply\s+and\s+install\s+/i, "Install ");
  phrase = phrase.replace(/^furnish\s+and\s+install\s+/i, "Install ");
  phrase = phrase.replace(/\s+/g, " ").trim();
  return phrase;
}

function sanitizeBriefDescription(raw, fallback = "") {
  const candidate = extractPrimaryScopePhrase(raw) || extractPrimaryScopePhrase(fallback) || cleanString(fallback);
  if (!candidate) return "Project scope";
  const noTrailingPunctuation = candidate.replace(/[,:;.\-]+$/g, "").trim();
  const shortWords = limitWords(noTrailingPunctuation, 10);
  const shortText = truncateText(shortWords, 85);
  return toTitleCase(shortText || "Project scope");
}

function normalizeScopeNumbering(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/^(\d+)\.\s*\.\s*(?=[A-Za-z(])/gm, "$1. ")
    .replace(/(\b\d+)\.\.(?=\s*[A-Za-z(])/g, "$1. ")
    .replace(/\b(\d+)\s*\.\s*(\d+)\b/g, "$1.$2")
    .replace(/(\b\d+(?:\.\d+)*\.?)\s*\n\s*(?=[A-Za-z(])/g, "$1 ")
    .replace(/(\b\d+(?:\.\d+)+)(?=[A-Za-z(])/g, "$1 ")
    .replace(/(\b\d+\.)(?=[A-Za-z(])/g, "$1 ")
    .replace(/\b(\d+)\s*\.\s*(?=[A-Za-z])/g, "$1. ")
    .replace(/(\d+\.\s*[A-Za-z][^\n]*?)\s+(?=\d+\.\s*[A-Za-z])/g, "$1\n")
    .replace(/\s+(?=\d+\.\d{1,3}(?:\.\d{1,3})*\s*[A-Za-z(])/g, "\n")
    .replace(/\s+(?=\d+\.\s*[A-Za-z(])/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

function stripScopeLinePrefix(line = "") {
  return cleanString(line)
    .replace(/^[*•▪◦·-]\s*/, "")
    .replace(/^\d+(?:\.\d+)+\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^\d+[)\]:-]\s+/, "")
    .replace(/^\d+\s+(?=[A-Za-z(])/, "")
    .trim();
}

function normalizeScopeFormatting(text) {
  const toLineKey = (line = "") => {
    const headingMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (headingMatch) {
      const headingNumber = cleanString(headingMatch[1]);
      const headingTitle = cleanString(headingMatch[2])
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      return `heading:${headingNumber}:${headingTitle}`;
    }
    return cleanString(line)
      .replace(/[.:;,\-]+$/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  };

  const isStructuredLine = (line = "") =>
    /^-\s+/.test(line) || /^\d+(?:\.\d+)*\.?\s+[A-Za-z(]/.test(line);
  const actionVerbPattern =
    /\b(remove|supply|install|provide|clean|repair|replace|paint|assign|demolish|prepare|furnish|test|commission|apply|seal|upgrade|relocate|dispose|maintain)\b/i;
  const knownDivisionPattern = /^(construction|electrical|plumbing|hvac|glendale|service|production)\b/i;
  const sentenceSplitPattern = /(?<=[.!?;])\s+(?=[A-Z0-9])/;
  const splitByActionVerbs = (value = "") => {
    const text = cleanString(value);
    if (!text) return [];
    const verbRegex =
      /\b(?:provide|supply(?:\s+and\s+install)?|install|remove|clean|repair|replace|assign|demolish|prepare|furnish|test|commission|apply|seal|upgrade|relocate|dispose|maintain)\b/gi;
    const starts = [];
    let match;
    while ((match = verbRegex.exec(text)) !== null) {
      starts.push(match.index);
    }
    verbRegex.lastIndex = 0;
    if (starts.length <= 1) return [text];

    const segments = [];
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : text.length;
      const prefix = i === 0 ? cleanString(text.slice(0, start)) : "";
      let piece = cleanString(text.slice(start, end));
      if (prefix) piece = `${prefix} ${piece}`.replace(/\s+/g, " ").trim();
      if (piece) segments.push(piece);
    }
    return mergeContinuationScopeLines(segments);
  };
  const toSentenceList = (value = "") =>
    cleanString(value)
      .split(sentenceSplitPattern)
      .map((item) => cleanString(item))
      .filter(Boolean)
      .flatMap((item) => splitByActionVerbs(item))
      .map((item) => cleanString(item))
      .filter(Boolean);

  const raw = normalizeScopeNumbering(text);
  const lines = raw
    .split(/\r?\n/)
    .map((line) =>
      repairScopeLineText(
        cleanString(line)
        .replace(/^[*•▪◦·]\s*/, "- ")
        .replace(/^(\d+)\.\s*\.\s*/g, "$1. ")
        .replace(/^(\d+(?:\.\d+)+)\.\s*/g, "$1 ")
        .replace(/\s+/g, " ")
      )
    )
    .filter(Boolean)
    .filter((line) => !isOrphanDivisionHeadingLine(line));

  const reflowed = [];
  for (const line of lines) {
    const previous = reflowed[reflowed.length - 1];
    if (!previous) {
      reflowed.push(line);
      continue;
    }
    const shouldAppend =
      !isStructuredLine(line) &&
      !/^[A-Z0-9][A-Z0-9 &/().,#:'"-]{2,}$/.test(line);
    if (shouldAppend) {
      reflowed[reflowed.length - 1] = `${previous} ${line}`.replace(/\s+/g, " ").trim();
      continue;
    }
    reflowed.push(line);
  }

  const compact = [];
  for (const line of reflowed) {
    const key = toLineKey(line);
    if (!key) continue;
    const previousKey = toLineKey(compact[compact.length - 1] || "");
    if (previousKey && previousKey === key) continue;
    compact.push(line);
  }

  const expanded = [];
  for (let i = 0; i < compact.length; i += 1) {
    const line = compact[i];
    const headingWithBody = line.match(/^(\d+)\.\s+(.+)$/);
    if (!headingWithBody) {
      expanded.push(line);
      continue;
    }

    const sectionNo = cleanString(headingWithBody[1]);
    const fullHeadingBody = cleanString(headingWithBody[2]);
    const hasChildItemsAhead = compact
      .slice(i + 1)
      .some((nextLine) => new RegExp(`^${sectionNo}\\.\\d+\\s+`).test(nextLine));
    if (hasChildItemsAhead) {
      expanded.push(line);
      continue;
    }

    let headingLabel = "";
    let bodyText = "";
    const knownDivisionMatch = fullHeadingBody.match(knownDivisionPattern);
    if (knownDivisionMatch) {
      headingLabel = toTitleCase(cleanString(knownDivisionMatch[1]).toLowerCase());
      if (headingLabel.toLowerCase() === "hvac") headingLabel = "HVAC";
      bodyText = cleanString(fullHeadingBody.slice(cleanString(knownDivisionMatch[0]).length));
    } else {
      const actionVerbMatch = fullHeadingBody.match(actionVerbPattern);
      const actionVerbIndex = Number.isInteger(actionVerbMatch?.index) ? actionVerbMatch.index : -1;
      if (actionVerbIndex > 0) {
        headingLabel = cleanString(fullHeadingBody.slice(0, actionVerbIndex));
        bodyText = cleanString(fullHeadingBody.slice(actionVerbIndex));
      }
    }

    const sentenceLines = toSentenceList(bodyText);
    if (!headingLabel || !sentenceLines.length) {
      expanded.push(line);
      continue;
    }

    expanded.push(`${sectionNo}. ${headingLabel}`);
    sentenceLines.forEach((sentence, sentenceIndex) => {
      expanded.push(`${sectionNo}.${String(sentenceIndex + 1).padStart(2, "0")} ${sentence}`);
    });
  }

  const normalizedLines = expanded
    .map((line) => stripScopeLinePrefix(line))
    .map((line) => repairScopeLineText(line))
    .filter(Boolean)
    .flatMap((line) => {
      const sentenceItems = toSentenceList(line)
        .map((item) => stripScopeLinePrefix(item))
        .map((item) => repairScopeLineText(item))
        .filter(Boolean);
      if (sentenceItems.length < 2) {
        return [line];
      }

      const dedupedItems = [];
      const seenItems = new Set();
      sentenceItems.forEach((item) => {
        const key = cleanString(item).toLowerCase();
        if (!key || seenItems.has(key)) return;
        seenItems.add(key);
        dedupedItems.push(item);
      });
      return dedupedItems.length ? dedupedItems : [line];
    })
    .filter(Boolean)
    .filter((line) => !isOrphanDivisionHeadingLine(line));

  return mergeContinuationScopeLines(normalizedLines).join("\n");
}

function resolveDivisionLabel(divisions = [], quoteType = "") {
  const ids = Array.from(
    new Set(
      toArray(divisions)
        .map((division) => cleanString(division?.id || division?.title).toLowerCase())
        .filter(Boolean)
    )
  );
  if (ids.length > 1) return "Multi-Trade";
  if (ids.length === 1) {
    const id = ids[0];
    if (id === "construction") return "Construction";
    if (id === "electrical") return "Electrical";
    if (id === "plumbing") return "Plumbing";
    if (id === "hvac") return "HVAC";
    if (id === "glendale") return "Glendale";
  }

  const mode = cleanString(quoteType).toLowerCase();
  if (mode === "service") return "Service";
  if (mode === "glendale") return "Glendale";
  return "Production";
}

function extractScopeHeadline(rawScope) {
  const source = stripDescriptionNoise(rawScope);
  if (!source) return "";

  const firstSentence = source.split(/(?<=[.!?;:])\s+/)[0].replace(/[.!?]+$/, "");
  return sanitizeBriefDescription(firstSentence, source);
}

function buildFallbackQuoteDescription({
  quoteType,
  accountName,
  quoteBody,
  divisions
}) {
  const divisionLabel = resolveDivisionLabel(divisions, quoteType);
  const scopeSource =
    collapseWhitespace(quoteBody) ||
    toArray(divisions)
      .map((division) => cleanString(division?.scope))
      .filter(Boolean)
      .join(" ");
  const scopeHeadline = extractScopeHeadline(scopeSource);
  if (scopeHeadline) return sanitizeBriefDescription(scopeHeadline, `${divisionLabel} scope`);
  return sanitizeBriefDescription("", `${divisionLabel} scope`);
}

function buildFallbackTaskPlan(divisions = []) {
  const worksheetRows = buildFallbackWorksheetRows(divisions);
  const tasks = toArray(divisions).flatMap((division) => {
    const sectionId = cleanString(division?.sectionId);
    const divisionId = normalizeDivisionKey(division?.id || division?.title);
    const scope = cleanString(division?.scope) || "Complete scope as discussed.";
    const baseName = cleanString(division?.title || division?.id || "Division Work");
    const scopeLineItems = buildScopeLineItems(scope, division?.scopeLines);
    const scopeItems = scopeLineItems.length ? scopeLineItems.map((item) => item.sourceText) : normalizeScopeItems(scope);
    const itemTasks = (scopeItems.length ? scopeItems : [scope]).map((scopeItem, index) => {
      const detailSuggestions = buildDetailedTaskLineSuggestions(
        scopeItem,
        `${baseName} - Scope Item ${index + 1}`
      ).map((line) => {
        if (divisionId === "glendale" && line.type === "material") {
          return { ...line, type: "subtrade" };
        }
        return line;
      });
      return {
        id: `${sectionId || divisionId || "division"}-item-${index + 1}`,
        sectionId,
        divisionId,
        taskName: `${baseName} - Scope Item ${index + 1}`,
        scopeNote: scopeItem,
        lineSuggestions: detailSuggestions.length
          ? detailSuggestions
          : [
              normalizeLineSuggestion(
                {
                  type: divisionId === "glendale" ? "subtrade" : inferTaskLineType(scopeItem),
                  description: scopeItem,
                  quantity: 0,
                  quantityStatus: "missing",
                  cost: 0,
                  markup: 0,
                  sellingPrice: 0
                },
                {
                  scopeNote: scopeItem,
                  taskName: `${baseName} - Scope Item ${index + 1}`
                }
              )
            ]
      };
    });

    const labourTask = {
      id: `${sectionId || divisionId || "division"}-labour-plan`,
      sectionId,
      divisionId,
      taskName: `${baseName} - Labour Allocation`,
      scopeNote: "Allocate labour hours by scope item.",
      lineSuggestions: [
        normalizeLineSuggestion(
            {
              type: "labour",
              description: "General labour",
              quantity: 0,
              quantityStatus: "provided",
              cost: 0,
              markup: 0,
              sellingPrice: 0
          },
          {
            taskName: `${baseName} - Labour Allocation`,
            scopeNote: "General labour"
          }
        ),
        normalizeLineSuggestion(
            {
              type: "labour",
              description: "Supervision",
              quantity: 0,
              quantityStatus: "provided",
              cost: 0,
              markup: 0,
              sellingPrice: 0
          },
          {
            taskName: `${baseName} - Labour Allocation`,
            scopeNote: "Supervision"
          }
        ),
        normalizeLineSuggestion(
          {
            type: "labour",
            description: "Project Manager",
            quantity: 0,
            quantityStatus: "provided",
            cost: 0,
            markup: 0,
            sellingPrice: 0
          },
          {
            taskName: `${baseName} - Labour Allocation`,
            scopeNote: "Project Manager"
          }
        )
      ]
    };

    return [...itemTasks, labourTask];
  });

  return {
    strategy:
      "Estimator worksheet generated from each scope item. Labour, material, and subtrade lines are prebuilt for estimator pricing inputs.",
    tasks,
    worksheetRows
  };
}

function getConservativenessMultiplier(estimatorConfig = {}) {
  const level = Math.min(100, Math.max(0, parseNumber(estimatorConfig?.conservativeness, 100)));
  return 0.85 + level * 0.005;
}

function roundCurrency(value) {
  return Math.round(parseNumber(value, 0) * 100) / 100;
}

const HISTORICAL_AUTO_APPLY_MIN_CONFIDENCE = 0.2;
const HISTORICAL_PROMPT_MATCH_LIMIT = 2;
const HISTORICAL_SECTION_HARD_MIN_CONFIDENCE = 0.45;

const HISTORICAL_MATCH_GROUPS = [
  { id: "admin", pattern: /project manager|project coordinator|site supervis|supervision|coordination|scheduling|quality|safety|oversight/i },
  { id: "permit", pattern: /permit|inspection|esa/i },
  { id: "rental", pattern: /rental|lift/i },
  { id: "partition", pattern: /softwall|partition|tarp|tarping|wall/i },
  { id: "structural", pattern: /structural|steel|reinforcement|joist|opening/i },
  { id: "fire", pattern: /fire|sprinkler|caulk|watch/i },
  { id: "power", pattern: /power|branch circuit|conduit|wiring|disconnect|junction|air handler/i },
  { id: "lighting", pattern: /lighting|light|fixture/i },
  { id: "hvac_equipment", pattern: /rooftop|packaged|rtu|hvac equipment|air handler|unit/i },
  { id: "duct", pattern: /duct|diffuser|grill|register|supply air|return air/i },
  { id: "piping", pattern: /gas piping|domestic water|drainage|san piping|sanitary|piping|pipe|valve|humidifier|drain/i },
  { id: "roofing", pattern: /roof|roofing/i }
];

function buildWorksheetHistoryKey(sectionId = "", scopeLineKey = "") {
  return `${cleanString(sectionId)}|${cleanString(scopeLineKey)}`;
}

function hasNonZeroHistoricalPreview(preview = {}) {
  return (
    Math.max(0, parseNumber(preview?.generalLabourHours, 0)) > 0 ||
    Math.max(0, parseNumber(preview?.supervisionHours, 0)) > 0 ||
    Math.max(0, parseNumber(preview?.projectManagerHours, 0)) > 0 ||
    Math.max(0, parseNumber(preview?.materialAllowanceCost, 0)) > 0 ||
    Math.max(0, parseNumber(preview?.subtradeAllowanceCost, 0)) > 0
  );
}

function getHistoricalBlendWeight(confidence = 0) {
  const normalized = Math.max(0.05, Math.min(0.99, parseNumber(confidence, 0)));
  return Math.max(0.35, Math.min(0.82, 0.28 + normalized * 0.6));
}

function blendHistoricalEstimateValue(baseValue, historicalValue, confidence = 0, options = {}) {
  const base = Math.max(0, parseNumber(baseValue, 0));
  const historical = Math.max(0, parseNumber(historicalValue, 0));
  if (historical <= 0) return roundCurrency(base);
  if (base <= 0) return roundCurrency(historical);

  const ratio = Math.max(base, historical) / Math.max(1, Math.min(base, historical));
  const preferHistorical = Boolean(options?.preferHistorical);
  if (preferHistorical && historical > base && confidence >= 0.55 && ratio >= 2) {
    return roundCurrency(historical);
  }

  const weight = getHistoricalBlendWeight(confidence);
  return roundCurrency(base * (1 - weight) + historical * weight);
}

function buildHistoricalWorksheetRowFromMatch(section = {}, suggestion = {}, match = {}) {
  const preview = match?.applyPreview || {};
  if (!hasNonZeroHistoricalPreview(preview)) return null;

  const displayDescription = cleanString(match?.displayDescription || match?.presetKey || "historical preset");
  const sampleCount = Math.max(0, parseNumber(match?.sampleCount, 0));
  const confidence = Math.max(0.05, Math.min(0.99, parseNumber(match?.confidence, 0.2)));
  const sampleSuffix = sampleCount > 0 ? ` from ${sampleCount} matching estimate line(s)` : "";

  return {
    sectionId: cleanString(section?.sectionId),
    divisionId: normalizeDivisionKey(section?.divisionId || section?.id || section?.title),
    scopeLineKey: cleanString(suggestion?.scopeLineKey),
    lineNumber: cleanString(suggestion?.lineNumber),
    sourceText: cleanString(suggestion?.sourceText),
    normalizedText: collapseWhitespace(suggestion?.sourceText),
    generalLabourHours: Math.max(0, parseNumber(preview?.generalLabourHours, 0)),
    supervisionHours: Math.max(0, parseNumber(preview?.supervisionHours, 0)),
    projectManagerHours: Math.max(0, parseNumber(preview?.projectManagerHours, 0)),
    materialAllowanceCost: Math.max(0, parseNumber(preview?.materialAllowanceCost, 0)),
    subtradeAllowanceCost: Math.max(0, parseNumber(preview?.subtradeAllowanceCost, 0)),
    materialSuggestions: [],
    confidence,
    assumptions: uniqueStringList([
      ...toArray(preview?.assumptions),
      `ASSUMED: Historical pricing anchor "${displayDescription}"${sampleSuffix}.`
    ]),
    missingInputs: [],
    riskFlags: uniqueStringList([
      "Confirm historical anchor still matches access, phasing, exclusions, and procurement scope."
    ]),
    needsReview: confidence < 0.6
  };
}

function buildHistoricalWorksheetRowsFromSuggestions(result = {}) {
  const rows = [];
  toArray(result?.sections).forEach((section) => {
    toArray(section?.suggestions).forEach((suggestion) => {
      const bestMatch = toArray(suggestion?.matches).find((match) => {
        const confidence = Math.max(0.05, Math.min(0.99, parseNumber(match?.confidence, 0)));
        return confidence >= HISTORICAL_AUTO_APPLY_MIN_CONFIDENCE && hasNonZeroHistoricalPreview(match?.applyPreview);
      });
      if (!bestMatch) return;
      const row = buildHistoricalWorksheetRowFromMatch(section, suggestion, bestMatch);
      if (!row) return;
      rows.push(row);
    });
  });
  return rows;
}

function buildHistoricalTaskPlanPromptContext(result = {}) {
  const sectionAnchors = toArray(result?.historicalSectionAnchors)
    .map((anchor) => {
      const archivedSection = anchor?.archivedSection || {};
      const subtotal = archivedSection?.subtotal || {};
      const tableLineItems = toArray(archivedSection?.tableLineItems)
        .slice(0, 8)
        .map((item) => ({
          description: cleanString(item?.description),
          labourHours: Math.max(0, parseNumber(item?.labourHours, 0)),
          materialCost: Math.max(0, parseNumber(item?.materialCost, 0)),
          subtradeCost: Math.max(0, parseNumber(item?.subtradeCost, 0)),
          totalCost: Math.max(0, parseNumber(item?.totalCost, 0))
        }))
        .filter((item) => item.description);
      if (!cleanString(anchor?.sectionId) || !cleanString(anchor?.mode)) return null;
      return {
        sectionId: cleanString(anchor?.sectionId),
        divisionId: normalizeDivisionKey(anchor?.divisionId),
        confidence: Math.max(0.05, Math.min(0.99, parseNumber(anchor?.confidence, 0.05))),
        mode: cleanString(anchor?.mode),
        matchedFileName: cleanString(anchor?.matchedFileName),
        matchedSectionHeading: cleanString(anchor?.matchedSectionHeading),
        archivedSubtotal: {
          labourHours: Math.max(0, parseNumber(subtotal?.labourHours, 0)),
          materialCost: Math.max(0, parseNumber(subtotal?.materialCost, 0)),
          subtradeCost: Math.max(0, parseNumber(subtotal?.subtradeCost, 0)),
          totalCost: Math.max(0, parseNumber(subtotal?.totalCost, 0)),
          totalSell: Math.max(0, parseNumber(subtotal?.totalSell, 0))
        },
        tableLineItems
      };
    })
    .filter(Boolean);

  const sections = toArray(result?.sections)
    .map((section) => {
      const scopeLines = toArray(section?.suggestions)
        .map((suggestion) => {
          const matches = toArray(suggestion?.matches)
            .slice(0, HISTORICAL_PROMPT_MATCH_LIMIT)
            .map((match) => {
              const confidence = Math.max(0.05, Math.min(0.99, parseNumber(match?.confidence, 0.05)));
              return {
                displayDescription: cleanString(match?.displayDescription),
                confidence,
                sampleCount: Math.max(0, parseNumber(match?.sampleCount, 0)),
                generalLabourHours: Math.max(0, parseNumber(match?.applyPreview?.generalLabourHours, 0)),
                supervisionHours: Math.max(0, parseNumber(match?.applyPreview?.supervisionHours, 0)),
                projectManagerHours: Math.max(0, parseNumber(match?.applyPreview?.projectManagerHours, 0)),
                materialAllowanceCost: Math.max(0, parseNumber(match?.applyPreview?.materialAllowanceCost, 0)),
                subtradeAllowanceCost: Math.max(0, parseNumber(match?.applyPreview?.subtradeAllowanceCost, 0))
              };
            })
            .filter(
              (match) =>
                match.confidence >= 0.15 &&
                cleanString(match?.displayDescription) &&
                (match.generalLabourHours > 0 ||
                  match.supervisionHours > 0 ||
                  match.projectManagerHours > 0 ||
                  match.materialAllowanceCost > 0 ||
                  match.subtradeAllowanceCost > 0)
            );
          if (!matches.length) return null;
          return {
            scopeLineKey: cleanString(suggestion?.scopeLineKey),
            lineNumber: cleanString(suggestion?.lineNumber),
            sourceText: cleanString(suggestion?.sourceText),
            matches
          };
        })
        .filter(Boolean);
      if (!scopeLines.length) return null;
      return {
        sectionId: cleanString(section?.sectionId),
        divisionId: normalizeDivisionKey(section?.divisionId || section?.id || section?.title),
        title: cleanString(section?.title || section?.divisionId),
        scopeLines
      };
    })
    .filter(Boolean);

  const contextBlocks = [];
  if (sectionAnchors.length) {
    contextBlocks.push(
      `Historical quote-section anchors (primary priors; hard anchors should keep section cost within 10% of archived subtotal):\n${JSON.stringify(sectionAnchors, null, 2)}`
    );
  }
  if (sections.length) {
    contextBlocks.push(
      `Historical row-level presets (secondary hints only):\n${JSON.stringify(sections, null, 2)}`
    );
  }
  return contextBlocks.join("\n\n");
}

function buildDivisionContextMap(divisions = []) {
  const map = new Map();
  toArray(divisions).forEach((division) => {
    const sectionId = cleanString(division?.sectionId);
    if (!sectionId) return;
    const labour = division?.labour || {};
    const technicianCostRate = Math.max(
      1,
      parseNumber(labour?.technicianCostRate || labour?.technicianRate || labour?.costRate, 85)
    );
    const supervisionCostRate = Math.max(
      1,
      parseNumber(labour?.supervisionCostRate || labour?.supervisionRate, technicianCostRate)
    );
    const projectManagerCostRate = Math.max(
      1,
      parseNumber(labour?.projectManagerCostRate || labour?.projectManagerRate, supervisionCostRate)
    );
    map.set(sectionId, {
      sectionId,
      divisionId: normalizeDivisionKey(division?.id || division?.title),
      technicianCostRate,
      supervisionCostRate,
      projectManagerCostRate
    });
  });
  return map;
}

function detectHistoricalMatchGroups(text = "") {
  const groups = new Set();
  const source = cleanString(text);
  if (!source) return groups;
  HISTORICAL_MATCH_GROUPS.forEach((group) => {
    if (group.pattern.test(source)) groups.add(group.id);
  });
  return groups;
}

function computeHistoricalGroupOverlap(leftText = "", rightText = "") {
  const leftGroups = detectHistoricalMatchGroups(leftText);
  const rightGroups = detectHistoricalMatchGroups(rightText);
  if (!leftGroups.size || !rightGroups.size) return 0;
  let overlap = 0;
  leftGroups.forEach((group) => {
    if (rightGroups.has(group)) overlap += 1;
  });
  return overlap / Math.max(leftGroups.size, rightGroups.size);
}

function computeHistoricalLexicalSimilarity(leftText = "", rightText = "") {
  const leftTokens = normalizeWorksheetScopeKey(leftText).split("-").filter(Boolean);
  const rightTokens = normalizeWorksheetScopeKey(rightText).split("-").filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightTokenSet = new Set(rightTokens);
  const overlap = leftTokens.reduce((count, token) => count + (rightTokenSet.has(token) ? 1 : 0), 0);
  const includesBoost =
    cleanString(leftText).toLowerCase().includes(cleanString(rightText).toLowerCase()) ||
    cleanString(rightText).toLowerCase().includes(cleanString(leftText).toLowerCase())
      ? 0.15
      : 0;
  return Math.min(1, overlap / Math.max(leftTokens.length, rightTokens.length) + includesBoost);
}

function isSectionWideHistoricalLineItem(text = "") {
  return /(project manager|project coordinator|site supervis|supervision|coordination|scheduling|quality|safety|permit|inspection|esa|rental|analysis|engineer|roofing)/i.test(
    cleanString(text)
  );
}

function calculateWorksheetRowCost(row = {}, divisionContext = {}) {
  const technicianCostRate = Math.max(1, parseNumber(divisionContext?.technicianCostRate, 85));
  const supervisionCostRate = Math.max(1, parseNumber(divisionContext?.supervisionCostRate, technicianCostRate));
  const projectManagerCostRate = Math.max(1, parseNumber(divisionContext?.projectManagerCostRate, supervisionCostRate));
  return roundCurrency(
    Math.max(0, parseNumber(row?.generalLabourHours, 0)) * technicianCostRate +
      Math.max(0, parseNumber(row?.supervisionHours, 0)) * supervisionCostRate +
      Math.max(0, parseNumber(row?.projectManagerHours, 0)) * projectManagerCostRate +
      Math.max(0, parseNumber(row?.materialAllowanceCost, 0)) +
      Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0))
  );
}

function scaleAnchoredRowsToTarget(rows = [], targetTotalCost = 0, divisionContext = {}) {
  const normalizedRows = toArray(rows).map((row) => normalizeWorksheetRow(row, row)).filter(Boolean);
  const target = Math.max(0, parseNumber(targetTotalCost, 0));
  if (!normalizedRows.length || target <= 0) return normalizedRows;
  const currentTotal = normalizedRows.reduce(
    (sum, row) => sum + calculateWorksheetRowCost(row, divisionContext),
    0
  );
  if (currentTotal <= 0) return normalizedRows;
  const ratio = target / currentTotal;
  const scaledRows = normalizedRows.map((row) => ({
    ...row,
    generalLabourHours: roundCurrency(Math.max(0, parseNumber(row?.generalLabourHours, 0)) * ratio),
    supervisionHours: roundCurrency(Math.max(0, parseNumber(row?.supervisionHours, 0)) * ratio),
    projectManagerHours: roundCurrency(Math.max(0, parseNumber(row?.projectManagerHours, 0)) * ratio),
    materialAllowanceCost: roundCurrency(Math.max(0, parseNumber(row?.materialAllowanceCost, 0)) * ratio),
    subtradeAllowanceCost: roundCurrency(Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0)) * ratio)
  }));
  const adjustedTotal = scaledRows.reduce(
    (sum, row) => sum + calculateWorksheetRowCost(row, divisionContext),
    0
  );
  const delta = roundCurrency(target - adjustedTotal);
  if (Math.abs(delta) < 0.01) return scaledRows;
  const targetIndex = Math.max(
    0,
    scaledRows.reduce((bestIndex, row, index, array) => {
      const rowCost = calculateWorksheetRowCost(row, divisionContext);
      const bestCost = calculateWorksheetRowCost(array[bestIndex] || {}, divisionContext);
      return rowCost > bestCost ? index : bestIndex;
    }, 0)
  );
  scaledRows[targetIndex] = {
    ...scaledRows[targetIndex],
    materialAllowanceCost: roundCurrency(
      Math.max(0, parseNumber(scaledRows[targetIndex]?.materialAllowanceCost, 0) + delta)
    )
  };
  return scaledRows;
}

function scoreHistoricalLineItemForWorksheetRow(lineItem = {}, row = {}) {
  const lineItemText = cleanString(lineItem?.description);
  const rowText = cleanString(row?.sourceText);
  const lexicalScore = lineItemText && rowText ? computeHistoricalLexicalSimilarity(lineItemText, rowText) : 0;
  const groupScore = computeHistoricalGroupOverlap(lineItemText, rowText);
  return roundCurrency(lexicalScore * 0.45 + groupScore * 0.55);
}

function applyHistoricalLineItemAllocation(accumulator, lineItem = {}, share = 1, divisionContext = {}, forceSupervision = false) {
  if (!accumulator || share <= 0) return;
  const totalCost = Math.max(0, parseNumber(lineItem?.totalCost, 0));
  const materialCost = Math.max(0, parseNumber(lineItem?.materialCost, 0));
  const subtradeCost = Math.max(0, parseNumber(lineItem?.subtradeCost, 0));
  const directLabourCost = Math.max(0, totalCost - materialCost - subtradeCost);
  const technicianCostRate = Math.max(1, parseNumber(divisionContext?.technicianCostRate, 85));
  const supervisionCostRate = Math.max(1, parseNumber(divisionContext?.supervisionCostRate, technicianCostRate));
  const projectManagerCostRate = Math.max(1, parseNumber(divisionContext?.projectManagerCostRate, supervisionCostRate));
  const useProjectManager = isProjectManagerWorksheetScope(lineItem?.description);
  const useSupervision = !useProjectManager && (forceSupervision || isAdministrativeWorksheetScope(lineItem?.description));

  accumulator.materialAllowanceCost += materialCost * share;
  accumulator.subtradeAllowanceCost += subtradeCost * share;
  if (directLabourCost > 0) {
    if (useProjectManager) {
      accumulator.projectManagerHours += directLabourCost * share / projectManagerCostRate;
    } else if (useSupervision) {
      accumulator.supervisionHours += directLabourCost * share / supervisionCostRate;
    } else {
      accumulator.generalLabourHours += directLabourCost * share / technicianCostRate;
    }
  } else if (Math.max(0, parseNumber(lineItem?.labourHours, 0)) > 0) {
    if (useProjectManager) {
      accumulator.projectManagerHours += Math.max(0, parseNumber(lineItem?.labourHours, 0)) * share;
    } else if (useSupervision) {
      accumulator.supervisionHours += Math.max(0, parseNumber(lineItem?.labourHours, 0)) * share;
    } else {
      accumulator.generalLabourHours += Math.max(0, parseNumber(lineItem?.labourHours, 0)) * share;
    }
  }
}

function buildAnchoredSectionRows(sectionRows = [], anchor = {}, divisionContext = {}) {
  const archivedSection = anchor?.archivedSection || {};
  const archivedLineItems = toArray(archivedSection?.tableLineItems);
  const baseRows = toArray(sectionRows).map((row) => normalizeWorksheetRow(row, row)).filter(Boolean);
  if (!baseRows.length) return [];
  const seededRows = baseRows.map((row) => ({
    ...row,
    generalLabourHours: Math.max(0, parseNumber(row?.generalLabourHours, 0)),
    supervisionHours: Math.max(0, parseNumber(row?.supervisionHours, 0)),
    projectManagerHours: Math.max(0, parseNumber(row?.projectManagerHours, 0)),
    materialAllowanceCost: Math.max(0, parseNumber(row?.materialAllowanceCost, 0)),
    subtradeAllowanceCost: Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0))
  }));

  archivedLineItems.forEach((lineItem) => {
    const scores = seededRows.map((row) => scoreHistoricalLineItemForWorksheetRow(lineItem, row));
    const bestScore = Math.max(...scores, 0);
    const bestIndex = scores.findIndex((score) => score === bestScore);
    const directMatch = bestIndex >= 0 && bestScore >= 0.45;
    if (directMatch && !isSectionWideHistoricalLineItem(lineItem?.description)) {
      applyHistoricalLineItemAllocation(seededRows[bestIndex], lineItem, 1, divisionContext);
      return;
    }

    const candidateIndexes = seededRows
      .map((row, index) => ({ row, index, score: scores[index] || 0 }))
      .filter(({ row, score, index }) => {
        if (directMatch && index === bestIndex) return true;
        if (isAdministrativeWorksheetScope(lineItem?.description)) {
          return isAdministrativeWorksheetScope(row?.sourceText) || score >= 0.2;
        }
        return !isAdministrativeWorksheetScope(row?.sourceText) || score >= 0.2;
      });

    const usableCandidates = candidateIndexes.length
      ? candidateIndexes
      : seededRows.map((row, index) => ({ row, index, score: scores[index] || 0 }));
    const totalWeight = usableCandidates.reduce((sum, candidate) => sum + Math.max(candidate.score, 0.25), 0);
    usableCandidates.forEach((candidate, candidateIndex) => {
      const share =
        candidateIndex === usableCandidates.length - 1
          ? 1 -
            usableCandidates
              .slice(0, candidateIndex)
              .reduce((sum, priorCandidate) => sum + Math.max(priorCandidate.score, 0.25) / Math.max(1, totalWeight), 0)
          : Math.max(candidate.score, 0.25) / Math.max(1, totalWeight);
      applyHistoricalLineItemAllocation(
        seededRows[candidate.index],
        lineItem,
        Math.max(0, share),
        divisionContext,
        isAdministrativeWorksheetScope(lineItem?.description)
      );
    });
  });

  const targetTotalCost = Math.max(0, parseNumber(archivedSection?.subtotal?.totalCost, 0));
  const scaledRows = scaleAnchoredRowsToTarget(seededRows, targetTotalCost, divisionContext);
  const anchorConfidence = Math.max(0.05, Math.min(0.99, parseNumber(anchor?.confidence, 0.45)));
  return scaledRows.map((row) => {
    const fallbackConfidence = Math.max(0.05, Math.min(0.99, parseNumber(row?.confidence, 0.5)));
    const confidenceFloor = Math.max(fallbackConfidence, Math.round(anchorConfidence * 70) / 100);
    return {
      ...row,
      confidence: confidenceFloor,
      assumptions: uniqueStringList([
        ...toArray(row?.assumptions),
        `ASSUMED: Section anchored to archived quote "${cleanString(anchor?.matchedFileName || anchor?.matchedQuoteId)}" (${cleanString(anchor?.matchedSectionHeading)}).`
      ]),
      riskFlags: uniqueStringList([
        ...toArray(row?.riskFlags),
        "Confirm archived section still matches access, phasing, exclusions, and procurement scope."
      ]),
      needsReview: Boolean(row?.needsReview) || anchorConfidence < 0.6
    };
  });
}

function mergeWorksheetRowWithHistorical(baseRow = {}, historicalRow = {}) {
  const base = normalizeWorksheetRow(baseRow, baseRow);
  const historical = normalizeWorksheetRow(historicalRow, historicalRow);
  if (!base) return { row: historical, usedHistorical: Boolean(historical) };
  if (!historical) return { row: base, usedHistorical: false };

  const historicalConfidence = Math.max(0.05, Math.min(0.99, parseNumber(historical?.confidence, 0.2)));
  const mergedRow = {
    ...base,
    generalLabourHours: blendHistoricalEstimateValue(
      base?.generalLabourHours,
      historical?.generalLabourHours,
      historicalConfidence
    ),
    supervisionHours: blendHistoricalEstimateValue(
      base?.supervisionHours,
      historical?.supervisionHours,
      historicalConfidence
    ),
    projectManagerHours: blendHistoricalEstimateValue(
      base?.projectManagerHours,
      historical?.projectManagerHours,
      historicalConfidence
    ),
    materialAllowanceCost: blendHistoricalEstimateValue(
      base?.materialAllowanceCost,
      historical?.materialAllowanceCost,
      historicalConfidence,
      { preferHistorical: true }
    ),
    subtradeAllowanceCost: blendHistoricalEstimateValue(
      base?.subtradeAllowanceCost,
      historical?.subtradeAllowanceCost,
      historicalConfidence,
      { preferHistorical: true }
    ),
    confidence: Math.max(
      Math.max(0.05, Math.min(0.99, parseNumber(base?.confidence, 0.5))),
      Math.round((Math.max(0.05, Math.min(0.99, parseNumber(base?.confidence, 0.5))) * 0.6 + historicalConfidence * 0.4) * 100) / 100
    ),
    assumptions: uniqueStringList([...toArray(base?.assumptions), ...toArray(historical?.assumptions)]),
    missingInputs: uniqueStringList([...toArray(base?.missingInputs), ...toArray(historical?.missingInputs)]),
    riskFlags: uniqueStringList([...toArray(base?.riskFlags), ...toArray(historical?.riskFlags)]),
    needsReview: Boolean(base?.needsReview) || historicalConfidence < 0.45
  };

  const usedHistorical =
    mergedRow.generalLabourHours !== Math.max(0, parseNumber(base?.generalLabourHours, 0)) ||
    mergedRow.supervisionHours !== Math.max(0, parseNumber(base?.supervisionHours, 0)) ||
    mergedRow.projectManagerHours !== Math.max(0, parseNumber(base?.projectManagerHours, 0)) ||
    mergedRow.materialAllowanceCost !== Math.max(0, parseNumber(base?.materialAllowanceCost, 0)) ||
    mergedRow.subtradeAllowanceCost !== Math.max(0, parseNumber(base?.subtradeAllowanceCost, 0));

  return { row: mergedRow, usedHistorical };
}

function enrichTaskPlanWithHistoricalData(plan = {}, historicalSuggestions = {}, divisions = []) {
  const historicalSectionAnchors = toArray(historicalSuggestions?.historicalSectionAnchors);
  const hardAnchorMap = new Map(
    historicalSectionAnchors
      .filter((anchor) => parseNumber(anchor?.confidence, 0) >= HISTORICAL_SECTION_HARD_MIN_CONFIDENCE && cleanString(anchor?.mode) === "hard")
      .map((anchor) => [cleanString(anchor?.sectionId), anchor])
  );
  const historicalRows = buildHistoricalWorksheetRowsFromSuggestions(historicalSuggestions);
  const historicalRowMap = new Map(
    historicalRows.map((row) => [buildWorksheetHistoryKey(row?.sectionId, row?.scopeLineKey), row])
  );
  const divisionContextMap = buildDivisionContextMap(divisions);
  if (!historicalRowMap.size && !hardAnchorMap.size) {
    return {
      plan,
      historicalRowsApplied: 0,
      historicalSectionAnchors,
      anchoredSectionCount: 0,
      usedHistoricalLibrary: toArray(historicalSuggestions?.sections).some((section) =>
        toArray(section?.suggestions).some((suggestion) => toArray(suggestion?.matches).length > 0)
      ) || historicalSectionAnchors.length > 0
    };
  }

  const sectionRowsMap = new Map();
  toArray(plan?.worksheetRows).forEach((row) => {
    const normalizedRow = normalizeWorksheetRow(row, row);
    if (!normalizedRow) return;
    const sectionId = cleanString(normalizedRow?.sectionId);
    if (!sectionRowsMap.has(sectionId)) {
      sectionRowsMap.set(sectionId, []);
    }
    sectionRowsMap.get(sectionId).push(normalizedRow);
  });

  const worksheetRows = [];
  const seenKeys = new Set();
  let historicalRowsApplied = 0;
  let anchoredSectionCount = 0;

  sectionRowsMap.forEach((sectionRows, sectionId) => {
    const hardAnchor = hardAnchorMap.get(sectionId);
    if (!hardAnchor) return;
    const anchoredRows = buildAnchoredSectionRows(
      sectionRows,
      hardAnchor,
      divisionContextMap.get(sectionId) || {}
    );
    anchoredRows.forEach((row) => {
      const rowKey = buildWorksheetHistoryKey(row?.sectionId, row?.scopeLineKey);
      if (!rowKey || seenKeys.has(rowKey)) return;
      seenKeys.add(rowKey);
      worksheetRows.push(row);
      historicalRowsApplied += 1;
    });
    anchoredSectionCount += 1;
  });

  toArray(plan?.worksheetRows).forEach((row) => {
    if (hardAnchorMap.has(cleanString(row?.sectionId))) return;
    const rowKey = buildWorksheetHistoryKey(row?.sectionId, row?.scopeLineKey);
    const historicalRow = historicalRowMap.get(rowKey);
    const { row: mergedRow, usedHistorical } = historicalRow
      ? mergeWorksheetRowWithHistorical(row, historicalRow)
      : { row: normalizeWorksheetRow(row, row), usedHistorical: false };
    if (!mergedRow || !rowKey || seenKeys.has(rowKey)) return;
    if (usedHistorical) historicalRowsApplied += 1;
    seenKeys.add(rowKey);
    worksheetRows.push(mergedRow);
  });

  historicalRows.forEach((historicalRow) => {
    if (hardAnchorMap.has(cleanString(historicalRow?.sectionId))) return;
    const rowKey = buildWorksheetHistoryKey(historicalRow?.sectionId, historicalRow?.scopeLineKey);
    if (!rowKey || seenKeys.has(rowKey)) return;
    seenKeys.add(rowKey);
    worksheetRows.push(historicalRow);
    historicalRowsApplied += 1;
  });

  worksheetRows.sort((a, b) => {
    const sectionDiff = cleanString(a?.sectionId).localeCompare(cleanString(b?.sectionId));
    if (sectionDiff !== 0) return sectionDiff;
    return parseNumber(a?.lineNumber, 0) - parseNumber(b?.lineNumber, 0);
  });

  const strategy = cleanString(plan?.strategy);
  const historicalStrategyNotes = [];
  if (anchoredSectionCount > 0) {
    historicalStrategyNotes.push(
      `${anchoredSectionCount} section(s) were anchored to archived quotes and scaled to the archived section subtotal.`
    );
  }
  if (historicalRowsApplied > anchoredSectionCount) {
    historicalStrategyNotes.push(
      " Secondary row-level historical presets were blended where section anchors were not strong enough."
    );
  }

  return {
    plan: {
      ...plan,
      strategy: `${strategy}${historicalStrategyNotes.length ? ` ${historicalStrategyNotes.join(" ")}` : ""}`.trim(),
      worksheetRows
    },
    historicalRowsApplied,
    historicalSectionAnchors,
    anchoredSectionCount,
    usedHistoricalLibrary: true
  };
}

const TASK_PLAN_LINE_TYPES = new Set(["labour", "material", "subtrade"]);
const TASK_PLAN_QUANTITY_STATUSES = new Set(["provided", "extracted", "assumed", "missing"]);
const TASK_PLAN_SPEC_STATUSES = new Set([
  "complete",
  "missing_finish",
  "missing_brand",
  "missing_method",
  "missing_location"
]);
const TASK_PLAN_APPROVED_UOM_VALUES = new Set([
  "BOTTLE",
  "CAN",
  "EA",
  "EACH",
  "HOUR",
  "ITEM",
  "KG",
  "KM",
  "LB",
  "LFT",
  "LITER",
  "M3",
  "METER",
  "MINUTE",
  "PACK",
  "PALLET",
  "PIECE",
  "SQFT",
  "TONNES",
  "Y3"
]);
const TASK_PLAN_APPROVED_UOM_LIST = Array.from(TASK_PLAN_APPROVED_UOM_VALUES).join(", ");
const NUMBER_WORD_TO_INT = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20]
]);
const WORKSHEET_SUPERVISION_RATIO_BY_DIVISION = {
  construction: 0.15,
  electrical: 0.125,
  plumbing: 0.125,
  hvac: 0.125
};
const COUNT_BASED_SCOPE_NOUNS = [
  "bay doors?",
  "single doors?",
  "man doors?",
  "doors?",
  "windows?",
  "fixtures?",
  "lights?",
  "panels?",
  "carriages?",
  "units?",
  "static units?",
  "systems?",
  "sections?",
  "stalls?",
  "outlets?",
  "washrooms?",
  "fans?",
  "pumps?",
  "valves?",
  "diffusers?"
];
const COUNT_BASED_SCOPE_NOUN_PATTERN = COUNT_BASED_SCOPE_NOUNS.join("|");

function normalizeTaskLineUom(rawUom = "") {
  const compact = cleanString(rawUom)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";

  const aliasMap = {
    HR: "HOUR",
    HRS: "HOUR",
    HUR: "HOUR",
    SF: "SQFT",
    FT2: "SQFT",
    SQUAREFOOT: "SQFT",
    SQUAREFEET: "SQFT",
    MTR: "METER",
    METER: "METER",
    METRE: "METER",
    LTR: "LITER",
    LITRE: "LITER",
    LITER: "LITER",
    KGM: "KG",
    TNE: "TONNES",
    TON: "TONNES",
    TONNE: "TONNES",
    TONNES: "TONNES",
    MIN: "MINUTE",
    MINS: "MINUTE",
    NMP: "PACK",
    PCB: "PIECE",
    YD3: "Y3",
    CY: "Y3"
  };
  const normalized = aliasMap[compact] || compact;
  return TASK_PLAN_APPROVED_UOM_VALUES.has(normalized) ? normalized : "";
}

function inferTaskLineUom(rawText = "", fallbackUom = "EACH") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) {
    return normalizeTaskLineUom(fallbackUom) || "EACH";
  }

  if (/\b(square\s*feet|square\s*foot|sq\.?\s*ft|sqft|sf)\b/.test(text)) return "SQFT";
  if (/\b(hours?|hrs?)\b/.test(text)) return "HOUR";
  if (/\b(minutes?|mins?)\b/.test(text)) return "MINUTE";
  if (/\b(cubic\s*yard|cu\.?\s*yd|yd3|y3)\b/.test(text)) return "Y3";
  if (/\b(cubic\s*meter|cubic\s*metre|m3|cu\.?\s*m)\b/.test(text)) return "M3";
  if (/\b(linear\s*feet?|lineal\s*feet?|lin\.?\s*ft|lft)\b/.test(text)) return "LFT";
  if (/\b(kilometers?|kilometres?|km)\b/.test(text)) return "KM";
  if (/\b(meters?|metres?|mtr)\b/.test(text)) return "METER";
  if (/\b(liters?|litres?|ltr)\b/.test(text)) return "LITER";
  if (/\b(tonnes?|tons?|tne)\b/.test(text)) return "TONNES";
  if (/\b(kilograms?|kilogrammes?|kg)\b/.test(text)) return "KG";
  if (/\b(pounds?|lbs?|lb)\b/.test(text)) return "LB";
  if (/\bbottles?\b/.test(text)) return "BOTTLE";
  if (/\bcans?\b/.test(text)) return "CAN";
  if (/\bpallets?\b/.test(text)) return "PALLET";
  if (/\bpacks?\b/.test(text)) return "PACK";
  if (/\bpieces?\b/.test(text)) return "PIECE";
  if (/\bitems?\b/.test(text)) return "ITEM";

  return normalizeTaskLineUom(fallbackUom) || "EACH";
}

function resolveTaskLineUom(rawUom = "", contextText = "", fallbackUom = "EACH") {
  const normalizedRaw = normalizeTaskLineUom(rawUom);
  const measuredUom = cleanString(extractMeasuredQuantityFromText(contextText)?.uom);
  const inferredUom = measuredUom || inferTaskLineUom(contextText, fallbackUom);
  if (!normalizedRaw) {
    return inferredUom || normalizeTaskLineUom(fallbackUom) || "EACH";
  }
  if (["EA", "EACH", "ITEM"].includes(normalizedRaw) && inferredUom && inferredUom !== normalizedRaw) {
    return inferredUom;
  }
  return normalizedRaw;
}

function parseNumericToken(rawToken = "") {
  const token = cleanString(rawToken).toLowerCase();
  if (!token) return null;
  if (NUMBER_WORD_TO_INT.has(token)) {
    return NUMBER_WORD_TO_INT.get(token);
  }

  const rangeMatch = token.match(
    /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)$/
  );
  if (rangeMatch?.[1] && rangeMatch?.[2]) {
    const low = parseNumber(rangeMatch[1], 0);
    const high = parseNumber(rangeMatch[2], 0);
    if (high > 0) {
      return Math.max(low, high);
    }
  }

  const numeric = parseNumber(token, Number.NaN);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return null;
}

function extractCountQuantityFromText(rawText = "") {
  const text = cleanString(rawText);
  if (!text) return null;

  const numericTokenPattern =
    "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
  const countRegex = new RegExp(
    `\\b(${numericTokenPattern})(?:\\s*\\(\\s*(${numericTokenPattern})\\s*\\))?(?:\\s*(?:-|to|–|—)\\s*(${numericTokenPattern}))?\\s+(?:bay\\s+|single\\s+|man\\s+|double\\s+|existing\\s+|new\\s+|powered\\s+|static\\s+|mobile\\s+|double-powered\\s+|mechanically\\s+assisted\\s+)?(${COUNT_BASED_SCOPE_NOUN_PATTERN})\\b`,
    "i"
  );
  const match = text.match(countRegex);
  if (!match) return null;

  const first = parseNumericToken(match[1]);
  const parenthetical = parseNumericToken(match[2]);
  const second = parseNumericToken(match[3]);
  const quantity = Math.max(first || 0, parenthetical || 0, second || 0);
  if (quantity <= 0) return null;

  return {
    quantity,
    uom: "EACH",
    basis: "count"
  };
}

function extractDimensionAreaFromText(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return null;
  const dimensionMatch = text.match(
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:x|×)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:'|ft|feet)?/
  );
  if (!dimensionMatch?.[1] || !dimensionMatch?.[2]) return null;

  const width = parseNumber(dimensionMatch[1], 0);
  const height = parseNumber(dimensionMatch[2], 0);
  if (width <= 0 || height <= 0) return null;

  const countMatch = text.match(
    /\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:bay\s+|single\s+|man\s+|double\s+)?(?:doors?|windows?|panels?|units?)\b/
  );
  const count = Math.max(1, parseNumericToken(countMatch?.[1]) || 1);
  const quantity = Math.round(width * height * count * 100) / 100;
  if (quantity <= 0) return null;

  return {
    quantity,
    uom: "SQFT",
    basis: "dimension"
  };
}

function extractMeasuredQuantityFromText(rawText = "") {
  const text = cleanString(rawText);
  if (!text) return null;
  const patterns = [
    {
      uom: "SQFT",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square\s*feet|square\s*foot|sf)\b/i
    },
    {
      uom: "HOUR",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i
    },
    {
      uom: "TONNES",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:tonnes?|tons?|tne)\b/i
    },
    {
      uom: "LFT",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:linear\s*feet?|lineal\s*feet?|lin\.?\s*ft|lft)\b/i
    },
    {
      uom: "M3",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:m3|cubic\s*meters?|cubic\s*metres?)\b/i
    },
    {
      uom: "Y3",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:y3|yd3|cubic\s*yards?)\b/i
    }
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match?.[1]) continue;
    const quantity = parseNumber(match[1], 0);
    if (quantity > 0) {
      return {
        quantity,
        uom: pattern.uom
      };
    }
  }

  const dimensionArea = extractDimensionAreaFromText(text);
  if (dimensionArea) return dimensionArea;

  const countQuantity = extractCountQuantityFromText(text);
  if (countQuantity) return countQuantity;

  return null;
}

function buildDefaultRequiredInputs(type = "material", description = "", quantityStatus = "missing") {
  const text = cleanString(description).toLowerCase();
  const requiredInputs = [];
  const assumptions = [];
  const riskFlags = [];

  if (type !== "labour" && quantityStatus === "missing") {
    requiredInputs.push("Quantity and measurable basis are required (EACH/SQFT/LFT/etc).");
  }
  if (/\bpaint|primer|repaint|coats?\b/.test(text)) {
    requiredInputs.push("Provide quantity basis: door count by type or total paintable SQFT.");
    requiredInputs.push("Provide coats, prep level, paint system, and side coverage.");
    assumptions.push("ASSUMED: One-side painting unless specified otherwise.");
  }
  if (/\bdoor|doors|window|windows\b/.test(text) && quantityStatus === "missing") {
    requiredInputs.push("Specify count by opening type (e.g., bay doors, single doors).");
  }
  if (/\basphalt|concrete|grading|striping|line painting|parking lines?\b/.test(text) && quantityStatus === "missing") {
    requiredInputs.push("Specify measured quantity (SQFT/LFT) and applicable depth/layer details.");
  }
  if (/\bhvac|unit|air handler|rtu|furnace|diffuser\b/.test(text) && quantityStatus === "missing") {
    requiredInputs.push("Specify quantity (EACH), capacity, and connection scope.");
  }
  if (/\bovernight|night|after hours|shutdown|operational\b/.test(text)) {
    riskFlags.push("access");
  }
  if (/\blift|scissor|boom\b/.test(text)) {
    riskFlags.push("lift_required");
  }
  if (/\bhazard|asbestos|lead|mould|mold\b/.test(text)) {
    riskFlags.push("hazardous");
  }
  if (/\bunknown|existing condition|as required\b/.test(text)) {
    riskFlags.push("unknown substrate");
  }

  return { requiredInputs, assumptions, riskFlags };
}

function inferSpecStatus(description = "") {
  const text = cleanString(description).toLowerCase();
  if (!text) return "missing_method";
  const hasLocation = /\b(area|level|room|parking|corridor|wall|roof|site|lot|zone|building|bay)\b/.test(text);
  const hasMethod = /\b(remove|supply|install|replace|paint|repair|grade|compact|apply|seal|test|commission)\b/.test(text);
  const hasFinish = /\b(finish|coat|colour|color|surface|hl3|hl8|primer|topcoat|spec)\b/.test(text);
  const hasBrandOrSpec = /\b(spec|approved|manufacturer|brand|equivalent)\b/.test(text);

  if (!hasMethod) return "missing_method";
  if (!hasLocation) return "missing_location";
  if (!hasFinish) return "missing_finish";
  if (!hasBrandOrSpec && /\bpaint|sealant|fixture|equipment|material\b/.test(text)) return "missing_brand";
  return "complete";
}

function inferLineConfidence({ quantityStatus = "missing", specStatus = "missing_method", requiredInputs = [] } = {}) {
  let score = quantityStatus === "provided" ? 0.92 : quantityStatus === "extracted" ? 0.8 : quantityStatus === "assumed" ? 0.62 : 0.35;
  if (specStatus !== "complete") {
    score -= 0.18;
  }
  if (requiredInputs.length >= 3) {
    score -= 0.12;
  }
  if (requiredInputs.length >= 5) {
    score -= 0.08;
  }
  return Math.max(0.05, Math.min(0.99, Math.round(score * 100) / 100));
}

function hasNamedProjectLocation(text = "") {
  return /\b(boardroom|office|conference room|meeting room|corridor|hallway|lobby|reception|warehouse|loading dock|dock|suite|unit|level|floor|room|washroom|kitchen|server room|mechanical room|electrical room|north(?:-| )side|south(?:-| )side|east(?:-| )side|west(?:-| )side|building [a-z0-9]+|area [a-z0-9]+)\b/i.test(
    cleanString(text)
  );
}

function hasFinishSensitiveScope(text = "") {
  return /\b(paint|primer|topcoat|colour|color|finish|carpet|flooring|tile|vinyl|baseboard|door|frame|hardware|glass|glazing|drywall|partition|wall system|ceiling|fixture|equipment|unit)\b/i.test(
    cleanString(text)
  );
}

function hasCoordinationSensitiveScope(text = "") {
  return /\b(project manager|project coordinator|site supervisor|coordination|phasing|sequence|sequencing|occupied|after hours|shutdown|access|office layout|maintain operations|mobiliz|temporary protection)\b/i.test(
    cleanString(text)
  );
}

function hasPermitOrCloseoutSensitiveScope(text = "") {
  return /\b(permit|engineering|engineer|design|consult|inspection|testing|test|commission|shutdown|closeout|startup|balancing|owner supplied|by others|landlord|utility)\b/i.test(
    cleanString(text)
  );
}

function buildEstimatorClarifyingQuestionsFromDivisions(divisions = [], quoteBody = "") {
  const divisionScopes = toArray(divisions)
    .map((division) => cleanString(division?.scope))
    .filter(Boolean);
  const combinedSource = [cleanString(quoteBody), ...divisionScopes].filter(Boolean).join("\n");
  const scopeLines = uniqueStringList(
    toArray(divisions)
      .flatMap((division) => splitScopeLinesPreservingInputRows(division?.scope))
      .concat(splitScopeLinesPreservingInputRows(combinedSource))
      .map((line) => repairScopeLineText(stripScopeLinePrefix(line)))
      .filter(Boolean)
  );
  const actionableLines = scopeLines.filter((line) =>
    /\b(remove|supply|install|provide|repair|replace|modify|paint|clean|relocate|upgrade|test|commission|assign)\b/i.test(line)
  );
  const sourceText = collapseWhitespace([combinedSource, ...actionableLines].join(" "));
  if (!sourceText) return [];

  const locationCoverageCount = actionableLines.filter((line) => hasNamedProjectLocation(line)).length;
  const needsLocationQuestion =
    actionableLines.length > 0 && locationCoverageCount < Math.max(1, Math.ceil(actionableLines.length / 2));
  const finishSensitive = hasFinishSensitiveScope(sourceText);
  const coordinationSensitive = hasCoordinationSensitiveScope(sourceText);
  const permitOrCloseoutSensitive =
    hasPermitOrCloseoutSensitiveScope(sourceText) ||
    toArray(divisions).some((division) => normalizeDivisionKey(division?.id || division?.title) === "glendale");

  const questions = [];
  if (needsLocationQuestion) {
    questions.push("Which room names, floors, areas, or named locations should the final scope reference, if any?");
  }
  if (finishSensitive) {
    questions.push("What product, finish, colour, manufacturer, or approved-equivalent requirements should the final scope name, if known?");
  }
  if (coordinationSensitive) {
    questions.push("Are there phasing, after-hours, occupied-space, access, or sequencing constraints AI should mention in the final scope?");
  }
  if (permitOrCloseoutSensitive) {
    questions.push("Are there permit, engineering, testing, shutdown, closeout, or owner-coordination requirements that should be called out?");
  }
  if (questions.length < 3) {
    questions.push("Are any items owner-supplied, by others, or explicitly excluded from this scope?");
  }

  return uniqueStringList(questions).slice(0, 4);
}

function normalizeDivisionKey(value) {
  const raw = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!raw) return "";
  if (raw.includes("construct") || raw === "con") return "construction";
  if (raw.includes("elect") || raw === "ele") return "electrical";
  if (raw.includes("plumb") || raw === "plu") return "plumbing";
  if (raw.includes("hvac") || raw.includes("mechanical") || raw === "mec") return "hvac";
  if (raw.includes("glendale") || raw === "gln") return "glendale";
  return raw;
}

function cleanScopeFragment(value = "") {
  return cleanString(value)
    .replace(/^(including|consisting of|with|and)\s+/i, "")
    .replace(/[;.,:\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractScopeAreaLabel(text = "") {
  const source = cleanString(text);
  if (!source) return "";
  const mediumMatch = source.match(/\bmedium\s+duty\s+area(?:\s*\([^)]*\))?/i);
  if (mediumMatch?.[0]) return cleanScopeFragment(mediumMatch[0]);
  const heavyMatch = source.match(/\bheavy\s+duty\s+area(?:\s*\([^)]*\))?/i);
  if (heavyMatch?.[0]) return cleanScopeFragment(heavyMatch[0]);
  return "";
}

function appendScopeAreaLabel(fragment = "", areaLabel = "") {
  const text = cleanScopeFragment(fragment);
  const area = cleanScopeFragment(areaLabel);
  if (!text || !area) return text;
  if (new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
    return text;
  }
  if (/(base course|surface course|asphalt|compaction|placement|grading|line painting|parking lines?)/i.test(text)) {
    return `${text} (${area})`;
  }
  return text;
}

function splitDetailTailSegments(value = "") {
  const source = cleanScopeFragment(value);
  if (!source) return [];
  const prepared = source
    .replace(/\bplaced and mechanically compacted\b/gi, "placement and mechanical compaction")
    .replace(/\s*,\s*and\s+/gi, ", ");
  const commaParts = prepared
    .split(/,(?!\d)/)
    .map((part) => cleanScopeFragment(part))
    .filter(Boolean);
  const splitSafe = (part = "") => {
    if (!/\s+\band\b\s+/i.test(part)) return [part];
    if (/\b(supply and install|furnish and install)\b/i.test(part)) return [part];
    if (/\bplacement and mechanical compaction\b/i.test(part)) return [part];
    return part
      .split(/\s+\band\b\s+/i)
      .map((item) => cleanScopeFragment(item))
      .filter(Boolean);
  };
  return commaParts.flatMap((part) => splitSafe(part));
}

function buildDoorSubtypeFragments(value = "") {
  const source = cleanScopeFragment(value);
  if (!source || !/\bdoors?\b/i.test(source)) return [];
  const detectedTypes = [];
  if (/\bbay\s+doors?\b/i.test(source)) detectedTypes.push("bay doors");
  if (/\bsingle\s+doors?\b/i.test(source)) detectedTypes.push("single doors");
  if (/\bman\s+doors?\b/i.test(source)) detectedTypes.push("man doors");
  if (/\boverhead\s+doors?\b/i.test(source)) detectedTypes.push("overhead doors");
  if (detectedTypes.length < 2) return [];

  const actionPrefixMatch = source.match(/^(.*?\bfor\b)\s+/i);
  const actionPrefix = cleanScopeFragment(actionPrefixMatch?.[1] || "");
  if (!actionPrefix) return [];

  return detectedTypes.map((doorType) => cleanScopeFragment(`${actionPrefix} ${doorType}`));
}

function buildDetailedScopeFragments(scopeText = "", taskName = "") {
  const source = cleanScopeFragment(scopeText || taskName);
  if (!source) return [];
  const fragments = [];
  const pushUnique = (value) => {
    const clean = cleanScopeFragment(value);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (fragments.some((item) => item.toLowerCase() === key)) return;
    fragments.push(clean);
  };

  const normalized = source.replace(/\s+/g, " ");
  const areaLabel = extractScopeAreaLabel(normalized);
  const hasActionVerb = (value = "") =>
    /\b(remove|supply|install|provide|demolish|paint|repair|replace|prepare|grade|clean|test|commission|haul|load|dispose|sawcut)\b/i.test(
      cleanString(value)
    );
  let head = normalized;
  let tail = "";
  let combinedIncludingLine = "";
  const consistingMatch = normalized.match(/^(.*?)(?:,\s*)?consisting of\s+(.+)$/i);
  if (consistingMatch) {
    head = cleanScopeFragment(consistingMatch[1]);
    tail = cleanScopeFragment(consistingMatch[2]);
  } else {
    const includingMatch = normalized.match(/^(.*?)(?:,\s*)?including\s+(.+)$/i);
    if (includingMatch) {
      head = cleanScopeFragment(includingMatch[1]);
      tail = cleanScopeFragment(includingMatch[2]);
      const tailSegments = splitDetailTailSegments(tail);
      if (head && tailSegments.length === 1 && !hasActionVerb(tailSegments[0])) {
        combinedIncludingLine = `${head} (${tailSegments[0]})`;
        tail = "";
      }
    }
  }

  if (combinedIncludingLine) {
    pushUnique(combinedIncludingLine);
  } else {
    pushUnique(head || normalized);
  }

  splitDetailTailSegments(tail).forEach((segment) => {
    pushUnique(appendScopeAreaLabel(segment, areaLabel));
  });

  if (/mechanically compacted|mechanical compaction/i.test(normalized)) {
    pushUnique(appendScopeAreaLabel("Placement and mechanical compaction", areaLabel));
  }
  if (/surface grading/i.test(normalized)) {
    pushUnique(appendScopeAreaLabel("Final surface grading", areaLabel));
  }
  if (/repaint|repainting|painting/i.test(normalized) && /parking lines?/i.test(normalized)) {
    pushUnique("Repaint parking lines");
  }
  buildDoorSubtypeFragments(normalized).forEach((fragment) => {
    pushUnique(fragment);
  });

  return fragments;
}

function normalizeScopeItems(rawScope = "") {
  const sourceLines = String(rawScope || "")
    .replace(/\r\n/g, "\n")
    .split(/\r?\n+/)
    .map((line) => cleanString(line))
    .filter(Boolean);
  const linesToProcess =
    sourceLines.length > 1
      ? sourceLines
      : cleanString(sourceLines[0] || "")
          .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
          .map((line) => cleanString(line))
          .filter(Boolean);

  const normalizedLines = linesToProcess
    .map((line) =>
      cleanString(line)
        .replace(/^-\s+/, "")
        .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
        .replace(/\s+/g, " ")
    )
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();
  for (const line of normalizedLines) {
    const key = cleanString(line).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }
  return deduped;
}

function repairScopeLineText(line = "") {
  return cleanString(line)
    .replace(/\bandi\b/gi, "and")
    .replace(/\bsupply and install install\b/gi, "supply and install")
    .replace(/\s+:/g, ":")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function isOrphanDivisionHeadingLine(line = "") {
  return /^(construction|electrical|plumbing|hvac|glendale|service|production)\s*:?\s*$/i.test(cleanString(line));
}

function isScopeContinuationFragment(line = "") {
  const source = repairScopeLineText(line);
  if (!source) return false;
  if (/^(and|or|including|plus|with|to)\b/i.test(source)) return true;
  const wordCount = source.split(/\s+/).filter(Boolean).length;
  return wordCount <= 3 && /^[a-z]/.test(source);
}

function shouldMergeScopeContinuation(previous = "", current = "") {
  const prior = repairScopeLineText(previous);
  const next = repairScopeLineText(current);
  if (!prior || !next || isOrphanDivisionHeadingLine(next)) return false;
  if (isScopeContinuationFragment(next)) return true;
  return (
    /^(maintain|repair|install|remove|reinstall|replace|paint|clean|provide|supply|assign|modify|relocate|upgrade|seal|test|commission|apply)\b/i.test(
      next
    ) &&
    /\b(to|and|for|with|including|plus)\s*$/i.test(prior)
  );
}

function mergeContinuationScopeLines(lines = []) {
  const merged = [];
  toArray(lines).forEach((line) => {
    const normalized = repairScopeLineText(line);
    if (!normalized || isOrphanDivisionHeadingLine(normalized)) return;
    if (merged.length && shouldMergeScopeContinuation(merged[merged.length - 1], normalized)) {
      merged[merged.length - 1] = repairScopeLineText(`${merged[merged.length - 1]} ${normalized}`);
      return;
    }
    merged.push(normalized);
  });
  return merged;
}

function splitScopeLinesPreservingInputRows(rawScope = "") {
  const rawLines = normalizeScopeNumbering(rawScope)
    .split(/\r?\n/)
    .map((line) => repairScopeLineText(line))
    .filter(Boolean);
  if (!rawLines.length) return [];

  const mergedRows = [];
  rawLines.forEach((line) => {
    const isStructuredRow = /^(?:\d+(?:\.\d+)*\.?\s+|[-*•▪◦·]\s+)/.test(line);
    if (!mergedRows.length || isStructuredRow) {
      mergedRows.push(line);
      return;
    }
    mergedRows[mergedRows.length - 1] = `${mergedRows[mergedRows.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
  });

  const cleanedRows = mergedRows
    .map((line) => stripScopeLinePrefix(line))
    .map((line) => repairScopeLineText(line))
    .filter(Boolean);
  if (cleanedRows.length > 1) {
    return mergeContinuationScopeLines(cleanedRows).filter((line) => !isOrphanDivisionHeadingLine(line));
  }

  return mergeContinuationScopeLines(
    normalizeScopeFormatting(rawScope)
    .split(/\r?\n+/)
    .map((line) => repairScopeLineText(line))
    .filter(Boolean)
  ).filter((line) => !isOrphanDivisionHeadingLine(line));
}

function normalizeWorksheetScopeKey(value = "") {
  return cleanString(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildScopeLineItems(rawScope = "", providedScopeLines = []) {
  const explicitLines = toArray(providedScopeLines)
    .map((line, index) => ({
      scopeLineKey: cleanString(line?.scopeLineKey || `scope-line-${index + 1}`),
      lineNumber: cleanString(line?.lineNumber || String(index + 1)),
      sourceText: cleanString(line?.sourceText || line?.text),
      normalizedText: cleanString(line?.normalizedText || line?.sourceText || line?.text)
    }))
    .filter((line) => line.sourceText);
  if (explicitLines.length) return explicitLines;

  const normalizedLines = splitScopeLinesPreservingInputRows(rawScope);
  const occurrenceByLine = new Map();
  return normalizedLines.map((line, index) => {
    const normalizedText = cleanString(line).replace(/\s+/g, " ");
    const keyBase = normalizeWorksheetScopeKey(normalizedText) || "scope-line";
    const occurrence = (occurrenceByLine.get(keyBase) || 0) + 1;
    occurrenceByLine.set(keyBase, occurrence);
    return {
      scopeLineKey: `${keyBase}-${occurrence}`,
      lineNumber: String(index + 1),
      sourceText: normalizedText,
      normalizedText
    };
  });
}

function getWorksheetSupervisionRatio(divisionId = "") {
  return WORKSHEET_SUPERVISION_RATIO_BY_DIVISION[normalizeDivisionKey(divisionId)] || 0.125;
}

function hasWorksheetMeasurement(text = "") {
  const source = cleanString(text);
  if (!source) return false;
  if (extractMeasuredQuantityFromText(source)) return true;
  return /\b\d+(?:\.\d+)?\s*(?:each|ea|qty|nos?|no\.?)\b/i.test(source);
}

function isSpecializedSystemScope(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return false;
  return /(?:space\s*saver|spacesaver|mechanically assisted|mobile system|mobile storage|mobile shelving|compact shelving|high[-\s]?density shelving|powered carriage|static unit|rolling storage|movable shelving|storage carriage|filing system)/.test(
    text
  );
}

function extractSpecializedSystemComponentCount(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return 0;
  const numericTokenPattern =
    "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
  const countRegex = new RegExp(
    `\\b(${numericTokenPattern})(?:\\s*\\(\\s*(${numericTokenPattern})\\s*\\))?(?:\\s*(?:-|to|–|—)\\s*(${numericTokenPattern}))?\\s+(?:bay\\s+|single\\s+|double\\s+|existing\\s+|new\\s+|powered\\s+|static\\s+|mobile\\s+|double-powered\\s+|mechanically\\s+assisted\\s+)*(carriages?|sections?|static\\s+units?)\\b`,
    "gi"
  );
  let total = 0;
  let match;
  while ((match = countRegex.exec(text))) {
    const first = parseNumericToken(match[1]);
    const parenthetical = parseNumericToken(match[2]);
    const second = parseNumericToken(match[3]);
    total += Math.max(first || 0, parenthetical || 0, second || 0);
  }
  return Math.max(0, total);
}

function inferFallbackWorksheetLabourHours(rawText = "", divisionId = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return 0;
  const measurement = extractMeasuredQuantityFromText(text);
  const quantity = Math.max(0, parseNumber(measurement?.quantity, 0));
  const specializedSystemComponentCount = extractSpecializedSystemComponentCount(text);
  const isRemovalScope = /(remov|demolish|demolition|dispose|tear[\s-]?out)/.test(text);

  if (/(project manager|project coordinator|coordination|scheduling|submittal|closeout)/.test(text)) {
    return roundCurrency(Math.max(1, quantity > 0 ? quantity * 0.25 : 2));
  }
  if (/(site supervisor|supervis|quality standards|safety protocols|safety oversight)/.test(text)) {
    return roundCurrency(Math.max(1, quantity > 0 ? quantity * 0.25 : 2));
  }
  if (isSpecializedSystemScope(text) && isRemovalScope) {
    if (specializedSystemComponentCount > 0) {
      return roundCurrency(Math.max(1, specializedSystemComponentCount * 0.25));
    }
    return 2;
  }
  if (isRemovalScope) {
    if (measurement?.uom === "EACH" && quantity > 0) return roundCurrency(Math.max(1.5, quantity * 1.5));
    if (measurement?.uom === "SQFT" && quantity > 0) return roundCurrency(Math.max(2, quantity * 0.04));
    return 6;
  }
  if (/(install|replace|provide|furnish|assemble|set)/.test(text)) {
    if (measurement?.uom === "EACH" && quantity > 0) return roundCurrency(Math.max(1.5, quantity * 2));
    if (measurement?.uom === "SQFT" && quantity > 0) return roundCurrency(Math.max(2, quantity * 0.05));
    return 6;
  }
  if (/(paint|repaint|prime|seal)/.test(text)) {
    if (measurement?.uom === "SQFT" && quantity > 0) return roundCurrency(Math.max(1.5, quantity * 0.015));
    if (measurement?.uom === "EACH" && quantity > 0) return roundCurrency(Math.max(1, quantity * 0.75));
    return 4;
  }
  if (/(test|commission|startup)/.test(text)) {
    return roundCurrency(Math.max(1, quantity > 0 ? quantity * 0.5 : 2));
  }

  const baseHours = normalizeDivisionKey(divisionId) === "construction" ? 4 : 3;
  if (quantity > 0) {
    return roundCurrency(Math.max(1, quantity * 0.75));
  }
  return baseHours;
}

function inferFallbackWorksheetMaterialCost(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return 0;
  const measurement = extractMeasuredQuantityFromText(text);
  const quantity = Math.max(0, parseNumber(measurement?.quantity, 0));
  const specializedSystemComponentCount = extractSpecializedSystemComponentCount(text);
  const isRemovalScope = /(remov|demolish|demolition|dispose|tear[\s-]?out)/.test(text);

  if (/(project manager|project coordinator|coordination|site supervisor|scheduling|quality standards|safety protocols)/.test(text)) {
    return 0;
  }
  if (isSpecializedSystemScope(text) && isRemovalScope) {
    if (specializedSystemComponentCount > 0) return roundCurrency(Math.max(150, specializedSystemComponentCount * 20));
    return 150;
  }
  if (isRemovalScope) {
    if (measurement?.uom === "EACH" && quantity > 0) return roundCurrency(quantity * 25);
    return 75;
  }
  if (/(paint|repaint|prime|sealant|seal)/.test(text)) {
    if (measurement?.uom === "SQFT" && quantity > 0) return roundCurrency(quantity * 0.65);
    if (measurement?.uom === "EACH" && quantity > 0) return roundCurrency(quantity * 35);
    return 120;
  }
  if (/(material|supply|fixture|equipment|unit|pipe|wire|panel|valve|pump|fan|carriage|section)/.test(text)) {
    if (measurement?.uom === "EACH" && quantity > 0) return roundCurrency(quantity * 150);
    if (measurement?.uom === "SQFT" && quantity > 0) return roundCurrency(quantity * 2.5);
    return 250;
  }
  if (/(test|commission|startup|cleanup|clean up)/.test(text)) {
    return 40;
  }
  return 0;
}

function inferFallbackWorksheetSubtradeCost(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text || !isSpecializedSystemScope(text)) return 0;
  const specializedSystemComponentCount = extractSpecializedSystemComponentCount(text);
  const isRemovalScope = /(remov|demolish|demolition|dispose|tear[\s-]?out|disassembl)/.test(text);
  const isSupplyScope = /(provide|furnish|install|replace|relocate|reinstall|repair|modify)/.test(text);
  if (!isRemovalScope && !isSupplyScope) return 0;
  if (specializedSystemComponentCount > 0) {
    return roundCurrency(specializedSystemComponentCount * (isRemovalScope ? 3200 : 4200));
  }
  if (/(space\s*saver|spacesaver|mechanically assisted|mobile system|mobile shelving|compact shelving|filing system)/.test(text)) {
    return roundCurrency(isRemovalScope ? 8000 : 15000);
  }
  return roundCurrency(isRemovalScope ? 5000 : 10000);
}

function buildFallbackWorksheetRow(division = {}, scopeLine = {}) {
  const sourceText = cleanString(scopeLine?.sourceText || scopeLine?.normalizedText);
  if (!sourceText) return null;
  const fallbackHours = inferFallbackWorksheetLabourHours(sourceText, division?.id);
  const specializedSystemComponentCount = extractSpecializedSystemComponentCount(sourceText);
  const isProjectManagerOnlyScope =
    /(project manager|project coordinator|project management|project admin|project administration|coordination|scheduling|submittal|closeout)/i.test(
      sourceText
    );
  const isSupervisionOnlyScope =
    /(site supervisor|supervis|quality standards|safety protocols|oversight)/i.test(
      sourceText
    );
  const generalLabourHours = isProjectManagerOnlyScope || isSupervisionOnlyScope ? 0 : fallbackHours;
  const supervisionHours = isSupervisionOnlyScope
    ? fallbackHours
    : roundCurrency(generalLabourHours * getWorksheetSupervisionRatio(division?.id));
  const projectManagerHours = isProjectManagerOnlyScope ? fallbackHours : 0;
  const materialAllowanceCost = inferFallbackWorksheetMaterialCost(sourceText);
  const subtradeAllowanceCost = inferFallbackWorksheetSubtradeCost(sourceText);
  const missingInputs = [];
  if (!hasWorksheetMeasurement(sourceText) && /(remove|install|replace|paint|repaint|repair|supply|demolish|dispose)/i.test(sourceText)) {
    missingInputs.push("Add quantity/UOM details to tighten this estimate.");
  }
  const assumptions = [];
  const riskFlags = [];
  if (subtradeAllowanceCost > 0) {
    if (specializedSystemComponentCount > 0) {
      assumptions.push("ASSUMED: Specialized system/vendor allowance applied from component counts in scope text.");
    } else {
      assumptions.push("ASSUMED: Specialized system/vendor allowance applied without a full inventory count.");
      missingInputs.push("Confirm full mobile-system inventory or vendor quote.");
    }
    riskFlags.push("Confirm proprietary system vendor pricing, salvage value, and disposal responsibility before final pricing.");
  }
  const baseConfidence = missingInputs.length ? 0.48 : 0.72;
  const confidence =
    subtradeAllowanceCost > 0
      ? Math.min(baseConfidence, specializedSystemComponentCount > 0 ? 0.64 : 0.52)
      : baseConfidence;
  return {
    sectionId: cleanString(division?.sectionId),
    divisionId: normalizeDivisionKey(division?.id || division?.title),
    scopeLineKey: cleanString(scopeLine?.scopeLineKey),
    lineNumber: cleanString(scopeLine?.lineNumber),
    sourceText,
    normalizedText: cleanString(scopeLine?.normalizedText || sourceText),
    generalLabourHours,
    supervisionHours,
    projectManagerHours,
    materialAllowanceCost,
    subtradeAllowanceCost,
    materialSuggestions: [],
    confidence,
    assumptions: uniqueStringList([
      ...assumptions,
      ...(missingInputs.length ? ["ASSUMED: Estimate generated from text without a full measured takeoff."] : [])
    ]),
    missingInputs,
    riskFlags: uniqueStringList([
      ...riskFlags,
      ...(missingInputs.length ? ["Review quantity, access, and disposal assumptions before final pricing."] : [])
    ]),
    needsReview: missingInputs.length > 0 || confidence < 0.6
  };
}

function buildFallbackWorksheetRows(divisions = []) {
  return toArray(divisions).flatMap((division) => {
    if (normalizeDivisionKey(division?.id || division?.title) === "glendale") return [];
    const scopeLines = buildScopeLineItems(division?.scope, division?.scopeLines);
    return scopeLines.map((scopeLine) => buildFallbackWorksheetRow(division, scopeLine)).filter(Boolean);
  });
}

function normalizeWorksheetMaterialSuggestion(suggestion = {}, sourceText = "") {
  const description = cleanString(suggestion?.description || sourceText);
  if (!description) return null;
  const quantity = Math.max(0, parseNumber(suggestion?.quantity, 0));
  const cost = Math.max(0, parseNumber(suggestion?.cost, 0));
  const unitCost = Math.max(0, parseNumber(suggestion?.unitCost, 0));
  const markup = Math.max(0, parseNumber(suggestion?.markup, 25));
  const resolvedQuantity = quantity > 0 ? quantity : cost > 0 || unitCost > 0 ? 1 : 0;
  return {
    description,
    quantity: resolvedQuantity,
    uom: resolveTaskLineUom(suggestion?.uom, `${description} ${sourceText}`, "EACH"),
    unitCost: unitCost > 0 ? unitCost : resolvedQuantity > 0 && cost > 0 ? cost / resolvedQuantity : 0,
    cost: cost > 0 ? cost : resolvedQuantity > 0 && unitCost > 0 ? unitCost * resolvedQuantity : 0,
    markup,
    sellingPrice:
      Math.max(0, parseNumber(suggestion?.sellingPrice, 0)) ||
      (cost > 0 ? roundCurrency(cost * (1 + markup / 100)) : 0),
    assumptions: uniqueStringList(suggestion?.assumptions),
    riskFlags: uniqueStringList(suggestion?.riskFlags),
    confidence: Math.max(0.05, Math.min(0.99, parseNumber(suggestion?.confidence, 0.6)))
  };
}

function normalizeWorksheetRow(row = {}, fallbackRow = {}) {
  const divisionId = normalizeDivisionKey(row?.divisionId || fallbackRow?.divisionId);
  const sourceText = cleanString(row?.sourceText || row?.scopeText || fallbackRow?.sourceText);
  if (!sourceText) return null;
  let generalLabourHours = Math.max(0, parseNumber(row?.generalLabourHours, fallbackRow?.generalLabourHours));
  const rawSupervisionHours = parseNumber(row?.supervisionHours, Number.NaN);
  const rawProjectManagerHours = parseNumber(row?.projectManagerHours, Number.NaN);
  const isProjectManagerScope =
    /(project manager|project coordinator|project management|project admin|project administration|coordination|scheduling|submittal|closeout)/i.test(
      sourceText
    );
  const isSupervisionOnlyScope =
    /(site supervisor|supervis|quality standards|safety protocols|oversight)/i.test(
      sourceText
    );
  let supervisionHours =
    Number.isFinite(rawSupervisionHours) && rawSupervisionHours > 0
      ? rawSupervisionHours
      : roundCurrency(generalLabourHours * getWorksheetSupervisionRatio(divisionId));
  let projectManagerHours =
    Number.isFinite(rawProjectManagerHours) && rawProjectManagerHours > 0 ? rawProjectManagerHours : 0;
  if (isSupervisionOnlyScope && generalLabourHours > 0 && (!Number.isFinite(rawSupervisionHours) || rawSupervisionHours <= 0)) {
    supervisionHours = generalLabourHours;
    generalLabourHours = 0;
  }
  if (isProjectManagerScope && supervisionHours > 0 && projectManagerHours <= 0) {
    projectManagerHours = supervisionHours;
    supervisionHours = 0;
  }
  if (isProjectManagerScope && generalLabourHours > 0 && projectManagerHours <= 0) {
    projectManagerHours = generalLabourHours;
    generalLabourHours = 0;
  }
  const materialSuggestions = toArray(row?.materialSuggestions)
    .map((suggestion) => normalizeWorksheetMaterialSuggestion(suggestion, sourceText))
    .filter(Boolean);
  const materialAllowanceCost = Math.max(
    0,
    parseNumber(row?.materialAllowanceCost, fallbackRow?.materialAllowanceCost || 0)
  );
  const rawSubtradeAllowanceCost = parseNumber(row?.subtradeAllowanceCost, Number.NaN);
  const fallbackSubtradeAllowanceCost = Math.max(0, parseNumber(fallbackRow?.subtradeAllowanceCost, 0));
  const explicitSubtradeAllowanceCost =
    Number.isFinite(rawSubtradeAllowanceCost) && rawSubtradeAllowanceCost > 0 ? rawSubtradeAllowanceCost : 0;
  const subtradeAllowanceCost = Math.max(explicitSubtradeAllowanceCost, fallbackSubtradeAllowanceCost);
  const suggestedMaterialTotal = materialSuggestions.reduce((sum, item) => sum + Math.max(0, parseNumber(item?.cost, 0)), 0);
  const usedFallbackSubtradeFloor =
    fallbackSubtradeAllowanceCost > 0 && fallbackSubtradeAllowanceCost > explicitSubtradeAllowanceCost;
  const assumptions = uniqueStringList([
    ...toArray(fallbackRow?.assumptions),
    ...toArray(row?.assumptions),
    ...(usedFallbackSubtradeFloor
      ? ["ASSUMED: Specialized system vendor allowance floor applied from deterministic scope review."]
      : [])
  ]);
  const missingInputs = uniqueStringList([...toArray(fallbackRow?.missingInputs), ...toArray(row?.missingInputs)]);
  const riskFlags = uniqueStringList([
    ...toArray(fallbackRow?.riskFlags),
    ...toArray(row?.riskFlags),
    ...(usedFallbackSubtradeFloor
      ? ["Confirm proprietary system vendor pricing against takeoff or supplier quote."]
      : [])
  ]);
  const fallbackConfidence = Math.max(0.05, Math.min(0.99, parseNumber(fallbackRow?.confidence, 0.5)));
  const explicitConfidence = parseNumber(row?.confidence, Number.NaN);
  const confidence = Number.isFinite(explicitConfidence)
    ? Math.max(fallbackConfidence, Math.max(0.05, Math.min(0.99, explicitConfidence)))
    : fallbackConfidence;
  return {
    sectionId: cleanString(row?.sectionId || fallbackRow?.sectionId),
    divisionId,
    scopeLineKey: cleanString(row?.scopeLineKey || fallbackRow?.scopeLineKey || `${normalizeWorksheetScopeKey(sourceText) || "scope-line"}-1`),
    lineNumber: cleanString(row?.lineNumber || fallbackRow?.lineNumber || "1"),
    sourceText,
    normalizedText: cleanString(row?.normalizedText || fallbackRow?.normalizedText || sourceText),
    generalLabourHours,
    supervisionHours,
    projectManagerHours,
    materialAllowanceCost: materialAllowanceCost > 0 ? materialAllowanceCost : suggestedMaterialTotal,
    subtradeAllowanceCost,
    materialSuggestions,
    confidence,
    assumptions,
    missingInputs,
    riskFlags,
    needsReview: Boolean(row?.needsReview) || missingInputs.length > 0 || confidence < 0.6 || usedFallbackSubtradeFloor
  };
}

function isAdministrativeWorksheetScope(text = "") {
  return /(project manager|project coordinator|site supervisor|coordination|scheduling|quality|safety|oversight|permit|inspection|esa)/i.test(
    cleanString(text)
  );
}

function isProjectManagerWorksheetScope(text = "") {
  return /(project manager|project coordinator|project management|project admin|project administration|coordination|scheduling|submittal|closeout)/i.test(
    cleanString(text)
  );
}

function isSubstantiveWorksheetScope(text = "") {
  return /(install|replace|provide|furnish|remove|modify|repair|relocate|reinforcement|partition|piping|duct|unit|fixture|sprinkler|fire watch|wiring|conduit|drain)/i.test(
    cleanString(text)
  );
}

function violatesWorksheetGuardrails(row = {}) {
  const sourceText = cleanString(row?.sourceText);
  if (!sourceText) return false;
  const generalLabourHours = Math.max(0, parseNumber(row?.generalLabourHours, 0));
  const supervisionHours = Math.max(0, parseNumber(row?.supervisionHours, 0));
  const projectManagerHours = Math.max(0, parseNumber(row?.projectManagerHours, 0));
  const materialAllowanceCost = Math.max(0, parseNumber(row?.materialAllowanceCost, 0));
  const subtradeAllowanceCost = Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0));

  if (
    isSubstantiveWorksheetScope(sourceText) &&
    !isAdministrativeWorksheetScope(sourceText) &&
    generalLabourHours <= 0 &&
    supervisionHours > 0 &&
    projectManagerHours <= 0
  ) {
    return true;
  }

  if (
    isSubstantiveWorksheetScope(sourceText) &&
    generalLabourHours <= 0 &&
    supervisionHours <= 0 &&
    projectManagerHours <= 0 &&
    materialAllowanceCost <= 0 &&
    subtradeAllowanceCost <= 0
  ) {
    return true;
  }

  return false;
}

function choosePreferredWorksheetRow(aiRow = {}, fallbackRow = {}) {
  const normalizedFallback = normalizeWorksheetRow(fallbackRow, fallbackRow);
  const normalizedAi = normalizeWorksheetRow(aiRow, fallbackRow);
  if (!normalizedAi) return normalizedFallback;
  if (!normalizedFallback) return normalizedAi;

  const explicitAiConfidence = parseNumber(aiRow?.confidence, Number.NaN);
  const fallbackConfidence = Math.max(0.05, Math.min(0.99, parseNumber(normalizedFallback?.confidence, 0.5)));
  if (Number.isFinite(explicitAiConfidence) && explicitAiConfidence < fallbackConfidence) {
    return normalizedFallback;
  }
  if (violatesWorksheetGuardrails(normalizedAi)) {
    return normalizedFallback;
  }
  return normalizedAi;
}

function inferTaskLineType(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return "material";
  if (
    /(subtrade|sub[-\s]?contract|consultant|architect|engineering|permit|inspection|testing|commission)/.test(
      text
    )
  ) {
    return "subtrade";
  }
  if (
    /(material|supply|asphalt|concrete|aggregate|pipe|wire|fixture|equipment|paint|sealant|fitting|grout|insulation)/.test(
      text
    )
  ) {
    return "material";
  }
  if (
    /(labou?r|supervis|foreman|crew|demolish|remove|install|prepare|grade|compact|repair|paint|clean)/.test(
      text
    )
  ) {
    return "labour";
  }
  return "material";
}

function normalizeLineSuggestion(line, fallback = {}) {
  const inferredType = inferTaskLineType(
    `${cleanString(line?.description)} ${cleanString(fallback.scopeNote)} ${cleanString(fallback.taskName)}`
  );
  const lineTypeRaw = cleanString(line?.type).toLowerCase();
  const type = TASK_PLAN_LINE_TYPES.has(lineTypeRaw) ? lineTypeRaw : inferredType;
  const description = cleanString(line?.description || fallback.scopeNote || fallback.taskName || "Scope line item");
  const fallbackUom = type === "labour" ? "HOUR" : "EACH";
  let uom = resolveTaskLineUom(
    line?.uom,
    `${description} ${cleanString(fallback.scopeNote)} ${cleanString(fallback.taskName)}`,
    fallbackUom
  );
  const providedQuantityRaw = cleanString(line?.quantity);
  const providedQuantity = parseNumber(providedQuantityRaw, Number.NaN);
  const hasProvidedQuantity = providedQuantityRaw !== "" && Number.isFinite(providedQuantity);
  let quantity = hasProvidedQuantity ? Math.max(0, providedQuantity) : 0;
  const rawQuantityStatus = cleanString(line?.quantityStatus).toLowerCase();
  let quantityStatus = TASK_PLAN_QUANTITY_STATUSES.has(rawQuantityStatus)
    ? rawQuantityStatus
    : hasProvidedQuantity
      ? "provided"
      : "missing";
  const measuredQuantity = extractMeasuredQuantityFromText(
    `${description} ${cleanString(fallback.scopeNote)} ${cleanString(fallback.taskName)}`
  );
  if (measuredQuantity) {
    if (!cleanString(line?.uom) || uom === "EACH") {
      uom = measuredQuantity.uom;
    }
    const isSameMeasurement = uom === measuredQuantity.uom;
    if (type !== "labour" && isSameMeasurement && (!hasProvidedQuantity || quantity <= 0)) {
      quantity = measuredQuantity.quantity;
      quantityStatus = "extracted";
    } else if (type === "labour" && quantity <= 0 && measuredQuantity.uom === "HOUR" && !hasProvidedQuantity) {
      quantity = measuredQuantity.quantity;
      quantityStatus = "extracted";
    }
  }
  if (/\ballowance|assumed|tbd|to be confirmed\b/i.test(description) && quantityStatus === "missing") {
    quantityStatus = "assumed";
  }
  if (type !== "labour" && quantity <= 0 && quantityStatus === "provided") {
    quantityStatus = "missing";
  }

  const rawSpecStatus = cleanString(line?.specStatus).toLowerCase();
  const specStatus = TASK_PLAN_SPEC_STATUSES.has(rawSpecStatus) ? rawSpecStatus : inferSpecStatus(description);
  const defaultMeta = buildDefaultRequiredInputs(type, description, quantityStatus);
  const requiredInputs = uniqueStringList([
    ...toArray(line?.requiredInputs),
    ...defaultMeta.requiredInputs,
    specStatus === "missing_location" ? "Add location/area where work will occur." : "",
    specStatus === "missing_method" ? "Add execution method (remove/install/repair/apply)." : "",
    specStatus === "missing_finish" ? "Add finish/system details (coats/spec/finish type)." : "",
    specStatus === "missing_brand" ? "Add manufacturer/approved equivalent requirement." : ""
  ]);
  const assumptions = uniqueStringList([...toArray(line?.assumptions), ...defaultMeta.assumptions]);
  const riskFlags = uniqueStringList([...toArray(line?.riskFlags), ...defaultMeta.riskFlags]);
  const rawConfidence = parseNumber(line?.confidence, Number.NaN);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0.05, Math.min(0.99, rawConfidence))
    : inferLineConfidence({
        quantityStatus,
        specStatus,
        requiredInputs
      });

  return {
    type,
    description: truncateText(description, 120),
    quantity,
    quantityStatus,
    uom,
    unitCost: Math.max(0, parseNumber(line?.unitCost, 0)),
    cost: Math.max(0, parseNumber(line?.cost, 0)),
    markup: parseNumber(line?.markup, 0),
    sellingPrice: Math.max(0, parseNumber(line?.sellingPrice, 0)),
    specStatus,
    confidence,
    requiredInputs,
    assumptions,
    riskFlags
  };
}

const PLAN_SUGGESTION_STOP_WORDS = new Set([
  "and",
  "for",
  "with",
  "the",
  "all",
  "within",
  "including",
  "required",
  "completion",
  "works",
  "area",
  "course",
  "final",
  "ensure"
]);

function normalizePlanSuggestionKey(description = "") {
  const source = cleanString(description)
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\s*/, "")
    .replace(
      /^(?:supply\s+and\s+install|furnish\s+and\s+install|provide\s+and\s+install|provide|install|remove\s+and\s+dispose\s+of|remove|repainting\s+of|repaint)\s+/,
      ""
    )
    .replace(/\bas required\b/g, " ")
    .replace(/\bfollowing completion of [^,.;]+/g, " ")
    .replace(/\bto ensure [^,.;]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");

  const tokens = source
    .split(/\s+/)
    .map((token) => cleanString(token))
    .filter((token) => token.length >= 3 && !PLAN_SUGGESTION_STOP_WORDS.has(token));
  return tokens.join(" ");
}

function getPlanSuggestionScore(lineSuggestion = {}) {
  const quantity = Math.max(0, parseNumber(lineSuggestion.quantity, 0));
  const quantityStatus = cleanString(lineSuggestion.quantityStatus).toLowerCase();
  const uom = cleanString(lineSuggestion.uom).toUpperCase();
  const description = cleanString(lineSuggestion.description);
  const wordCount = description.split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (quantity > 0) score += 100;
  if (quantityStatus === "provided" || quantityStatus === "extracted") score += 30;
  if (quantityStatus === "assumed") score += 10;
  if (uom && uom !== "EACH") score += 8;
  if (/(hl8|hl3|base course|surface course|parking lines?|line paint|gravel|asphalt)/i.test(description)) {
    score += 18;
  }
  if (/^(supply and install|furnish and install|provide and install)\b/i.test(description)) {
    score -= 12;
  }
  score += Math.max(0, 24 - wordCount);
  return score;
}

function isLowValuePlanFragment(lineSuggestion = {}) {
  const description = cleanString(lineSuggestion.description);
  if (!description) return true;
  const quantity = Math.max(0, parseNumber(lineSuggestion.quantity, 0));
  const quantityStatus = cleanString(lineSuggestion.quantityStatus).toLowerCase();
  const wordCount = description.split(/\s+/).filter(Boolean).length;
  if (quantity > 0 || quantityStatus === "assumed") return false;
  if (wordCount <= 2) return true;
  return /^(loading|hauling|support|placement|grading|fine leveling|sawcutting as required|legal disposal of all debris off site)$/i.test(
    description
  );
}

function sanitizeTaskLineSuggestionsForPlan(lineSuggestions = []) {
  const grouped = new Map();
  toArray(lineSuggestions).forEach((lineSuggestion, index) => {
    if (!lineSuggestion || !cleanString(lineSuggestion.description)) return;
    const type = cleanString(lineSuggestion.type).toLowerCase() || "material";
    const key = normalizePlanSuggestionKey(lineSuggestion.description) || cleanString(lineSuggestion.description).toLowerCase();
    const groupKey = `${type}|${key}`;
    const candidate = {
      ...lineSuggestion,
      __score: getPlanSuggestionScore(lineSuggestion),
      __index: index
    };
    const existing = grouped.get(groupKey);
    if (!existing || candidate.__score > existing.__score || (candidate.__score === existing.__score && candidate.__index < existing.__index)) {
      grouped.set(groupKey, candidate);
    }
  });

  const deduped = Array.from(grouped.values());
  const courseAreaKeys = new Set(
    deduped
      .filter((line) => /(hl8|hl3|base course|surface course)/i.test(cleanString(line.description)))
      .map((line) => normalizePlanSuggestionKey(extractScopeAreaLabel(line.description)))
      .filter(Boolean)
  );

  return deduped
    .filter((line) => {
      const description = cleanString(line.description);
      const lineType = cleanString(line.type).toLowerCase();
      const quantity = Math.max(0, parseNumber(line.quantity, 0));
      const quantityStatus = cleanString(line.quantityStatus).toLowerCase();
      const areaKey = normalizePlanSuggestionKey(extractScopeAreaLabel(description));

      if (isLowValuePlanFragment(line)) return false;
      if (
        /\bhot mix asphalt\b/i.test(description) &&
        !/(hl8|hl3|base course|surface course)/i.test(description) &&
        areaKey &&
        courseAreaKeys.has(areaKey)
      ) {
        return false;
      }
      if (
        lineType !== "labour" &&
        quantity <= 0 &&
        quantityStatus === "missing" &&
        !/\ballowance|assumed|tbd|to be confirmed\b/i.test(description)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const typeOrder = { material: 0, subtrade: 1, labour: 2 };
      const typeDiff = (typeOrder[cleanString(a.type).toLowerCase()] ?? 99) - (typeOrder[cleanString(b.type).toLowerCase()] ?? 99);
      if (typeDiff !== 0) return typeDiff;
      return cleanString(a.description).toLowerCase().localeCompare(cleanString(b.description).toLowerCase());
    })
    .map((line) => {
      const cleaned = { ...line };
      delete cleaned.__score;
      delete cleaned.__index;
      return cleaned;
    });
}

function buildDetailedTaskLineSuggestions(scopeNote = "", taskName = "") {
  const detailedFragments = buildDetailedScopeFragments(scopeNote, taskName);
  const sourceFragments = detailedFragments.length ? detailedFragments : [cleanString(scopeNote || taskName)];
  return sourceFragments
    .map((fragment) => {
      const inferredType = inferTaskLineType(fragment);
      return normalizeLineSuggestion(
        {
          type: inferredType,
          description: fragment,
          quantity: inferredType === "labour" ? 0 : 0,
          quantityStatus: inferredType === "labour" ? "provided" : "missing",
          cost: 0,
          markup: 0,
          sellingPrice: 0
        },
        {
          scopeNote,
          taskName
        }
      );
    })
    .filter((line) => cleanString(line.description));
}

function buildFallbackValidation(divisions = [], estimatorConfig = {}, quoteBody = "") {
  const suggestions = [];
  const multiplier = getConservativenessMultiplier(estimatorConfig);

  toArray(divisions).forEach((division, index) => {
    const sectionId = cleanString(division?.sectionId);
    const sectionTitle = cleanString(division?.title || division?.id || "Division");
    const divisionId = cleanString(division?.id);
    const scope = cleanString(division?.scope);
    const labour = division?.labour || {};
    const materials = division?.materials || {};
    const subcontractor = division?.subcontractor || {};
    const materialLines = toArray(materials.lines || division?.materialLines);
    const subcontractorLines = toArray(subcontractor.lines || division?.subcontractorLines);

    if (!scope) {
      suggestions.push({
        id: `scope-${sectionId || divisionId || index}`,
        sectionId,
        divisionId,
        sectionTitle,
        title: "Missing scope details",
        reason: "Each selected division should have a complete statement of work.",
        estimatedHours: roundCurrency(2 * multiplier),
        estimatedMaterialCost: 0,
        scopeText: "Add installation method, site constraints, and finish/cleanup expectations.",
        lineSuggestion: null
      });
    }

    const technicianHours = parseNumber(labour.technicianHours);
    const supervisionHours = parseNumber(labour.supervisionHours);
    if (!labour.noCost && technicianHours <= 0 && supervisionHours <= 0) {
      suggestions.push({
        id: `labour-${sectionId || divisionId || index}`,
        sectionId,
        divisionId,
        sectionTitle,
        title: "Labour hours not provided",
        reason: "No labour hours were provided for a costed division.",
        estimatedHours: roundCurrency(8 * multiplier),
        estimatedMaterialCost: 0,
        scopeText: "Add realistic technician and supervision hours.",
        lineSuggestion: {
          type: "labour",
          description: "General labour allowance",
          quantity: roundCurrency(8 * multiplier),
          quantityStatus: "assumed",
          cost: roundCurrency(85 * multiplier),
          markup: 20,
          sellingPrice: 0
        }
      });
    }

    if (!materials.noCost && materialLines.length === 0) {
      suggestions.push({
        id: `material-${sectionId || divisionId || index}`,
        sectionId,
        divisionId,
        sectionTitle,
        title: "Material lines are missing",
        reason: "No material allowance is present for this scope.",
        estimatedHours: 0,
        estimatedMaterialCost: roundCurrency(500 * multiplier),
        scopeText: "Add materials required for install, fastening, and commissioning.",
        lineSuggestion: {
          type: "material",
          description: "Material allowance",
          quantity: 1,
          quantityStatus: "assumed",
          cost: roundCurrency(500 * multiplier),
          markup: 25,
          sellingPrice: 0
        }
      });
    }

    if (!subcontractor.noCost && subcontractorLines.length === 0) {
      suggestions.push({
        id: `subtrade-${sectionId || divisionId || index}`,
        sectionId,
        divisionId,
        sectionTitle,
        title: "Subtrade allowance is missing",
        reason: "Subtrade is enabled but no subtrade line exists.",
        estimatedHours: 0,
        estimatedMaterialCost: roundCurrency(750 * multiplier),
        scopeText: "Add expected subcontractor scope and allowance.",
        lineSuggestion: {
          type: "subtrade",
          description: "Subtrade allowance",
          quantity: 1,
          quantityStatus: "assumed",
          cost: roundCurrency(750 * multiplier),
          markup: 20,
          sellingPrice: 0
        }
      });
    }
  });

  const sections = {
    quickScopeReadback: [
      `Validated ${toArray(divisions).length} selected division(s).`,
      `Canadian costing mode: ${cleanString(estimatorConfig?.currency || "CAD")} / ${cleanString(estimatorConfig?.country || "CA")}.`
    ],
    clarifyingQuestions: buildEstimatorClarifyingQuestionsFromDivisions(divisions, quoteBody),
    assumptionsExclusions: [
      "ASSUMED: Ontario commercial labour burden and supplier pricing.",
      "ASSUMED: Standard working-hours access and no premium shift constraints."
    ],
    divisionBreakdown: toArray(divisions).map((division) => ({
      division: cleanString(division?.title || division?.id || "Division"),
      included: ["Labour, material, and subtrade coverage check against provided scope."],
      missingItems: ["Permits/testing/closeout should be confirmed where applicable."],
      risks: ["Unknown phasing/access constraints can materially impact labour."]
    })),
    missingScopeRecommendations: suggestions.map((item) => `${item.title}: ${item.scopeText || item.reason}`),
    materialSubtradeSuggestions: suggestions
      .filter((item) => parseNumber(item.estimatedMaterialCost, 0) > 0)
      .map((item) => `${cleanString(item.sectionTitle || item.divisionId || "division")}: $${roundCurrency(item.estimatedMaterialCost).toFixed(2)} allowance`),
    uomComplianceCheck: ["Fallback mode used generic UOM mapping (HOUR/EA); AI mode returns full UOM mapping review."]
  };

  return {
    score: Math.max(0, 100 - suggestions.length * 12),
    summary: suggestions.length
      ? "Potential gaps were detected in scope and estimating lines."
      : "No critical estimation gaps were detected.",
    sections,
    suggestions
  };
}

function sanitizeTaskPlan(parsed, fallback) {
  const normalizeTaskOrderKey = (task = {}, index = 0) => {
    const sectionId = cleanString(task?.sectionId).toLowerCase();
    const division = normalizeDivisionKey(task?.divisionId || "");
    const name = cleanString(task?.taskName).toLowerCase();
    const scope = cleanString(task?.scopeNote).toLowerCase();
    return `${sectionId}|${division}|${name}|${scope}|${String(index).padStart(5, "0")}`;
  };

  const tasks = toArray(parsed?.tasks)
    .map((task, index) => {
      const sectionId = cleanString(task?.sectionId);
      const divisionId = normalizeDivisionKey(task?.divisionId);
      const taskName = cleanString(task?.taskName);
      const scopeNote = cleanString(task?.scopeNote);
      const lineSuggestionsRaw = toArray(task?.lineSuggestions);
      const aiSuggestions = lineSuggestionsRaw
        .map((line) =>
          normalizeLineSuggestion(line, {
            taskName,
            scopeNote
          })
        )
        .filter((line) => cleanString(line.description));
      const detailedSuggestions = buildDetailedTaskLineSuggestions(scopeNote, taskName).map((line) => {
        if (divisionId === "glendale" && line.type === "material") {
          return { ...line, type: "subtrade" };
        }
        return line;
      });

      const lineSuggestions = [];
      const seen = new Set();
      const primaryScopeKey = cleanString(scopeNote || taskName).toLowerCase();
      const pushUnique = (line) => {
        if (!line || !cleanString(line.description)) return;
        const key = `${cleanString(line.type).toLowerCase()}|${cleanString(line.description).toLowerCase()}`;
        if (!key || seen.has(key)) return;
        if (detailedSuggestions.length > 1 && cleanString(line.description).toLowerCase() === primaryScopeKey) {
          return;
        }
        seen.add(key);
        lineSuggestions.push(line);
      };

      aiSuggestions.forEach(pushUnique);
      detailedSuggestions.forEach(pushUnique);
      const sanitizedLineSuggestions = sanitizeTaskLineSuggestionsForPlan(lineSuggestions);
      lineSuggestions.length = 0;
      sanitizedLineSuggestions.forEach((line) => lineSuggestions.push(line));

      if (!lineSuggestions.length) {
        const inferredType = inferTaskLineType(`${taskName} ${scopeNote}`);
        lineSuggestions.push(
          normalizeLineSuggestion(
            {
              type: inferredType,
              description: scopeNote || taskName || "Scope line item",
              quantity: inferredType === "labour" ? 0 : 0,
              quantityStatus: inferredType === "labour" ? "provided" : "missing",
              cost: 0,
              markup: 0,
              sellingPrice: 0
            },
            {
              taskName,
              scopeNote
            }
          )
        );
      }
      lineSuggestions.sort((a, b) => {
        const keyA = `${cleanString(a?.type).toLowerCase()}|${cleanString(a?.description).toLowerCase()}`;
        const keyB = `${cleanString(b?.type).toLowerCase()}|${cleanString(b?.description).toLowerCase()}`;
        return keyA.localeCompare(keyB);
      });

      return {
        id: cleanString(task?.id || `task-${index + 1}`),
        sectionId,
        divisionId,
        taskName,
        scopeNote,
        lineSuggestions
      };
    })
    .filter((task) => task.taskName)
    .sort((a, b) => normalizeTaskOrderKey(a).localeCompare(normalizeTaskOrderKey(b)));

  const fallbackWorksheetRows = toArray(fallback?.worksheetRows).map((row) => normalizeWorksheetRow(row, row)).filter(Boolean);
  const fallbackWorksheetMap = new Map(
    fallbackWorksheetRows.map((row) => [`${cleanString(row.sectionId)}|${cleanString(row.scopeLineKey)}`, row])
  );
  const worksheetRows = [];
  const seenWorksheetKeys = new Set();

  toArray(parsed?.worksheetRows).forEach((row) => {
    const fallbackRow =
      fallbackWorksheetMap.get(`${cleanString(row?.sectionId)}|${cleanString(row?.scopeLineKey)}`) ||
      fallbackWorksheetRows.find(
        (candidate) =>
          cleanString(candidate?.divisionId) === normalizeDivisionKey(row?.divisionId) &&
          cleanString(candidate?.scopeLineKey) === cleanString(row?.scopeLineKey)
      ) ||
      {};
    const normalizedRow = choosePreferredWorksheetRow(row, fallbackRow);
    if (!normalizedRow) return;
    const rowKey = `${cleanString(normalizedRow.sectionId)}|${cleanString(normalizedRow.scopeLineKey)}`;
    if (!rowKey || seenWorksheetKeys.has(rowKey)) return;
    seenWorksheetKeys.add(rowKey);
    worksheetRows.push(normalizedRow);
  });

  fallbackWorksheetRows.forEach((fallbackRow) => {
    const rowKey = `${cleanString(fallbackRow.sectionId)}|${cleanString(fallbackRow.scopeLineKey)}`;
    if (!rowKey || seenWorksheetKeys.has(rowKey)) return;
    worksheetRows.push({
      ...fallbackRow,
      needsReview: true,
      assumptions: uniqueStringList([
        ...toArray(fallbackRow.assumptions),
        "ASSUMED: Review this worksheet row because AI did not return a scoped estimate."
      ]),
      riskFlags: uniqueStringList([
        ...toArray(fallbackRow.riskFlags),
        "AI coverage gap fallback applied."
      ])
    });
    seenWorksheetKeys.add(rowKey);
  });

  worksheetRows.sort((a, b) => {
    const sectionDiff = cleanString(a?.sectionId).localeCompare(cleanString(b?.sectionId));
    if (sectionDiff !== 0) return sectionDiff;
    return parseNumber(a?.lineNumber, 0) - parseNumber(b?.lineNumber, 0);
  });

  return {
    strategy: cleanString(parsed?.strategy || fallback.strategy),
    tasks: tasks.length ? tasks : fallback.tasks,
    worksheetRows: worksheetRows.length ? worksheetRows : fallbackWorksheetRows
  };
}

function sanitizeValidationSections(parsedSections, fallbackSections = {}) {
  const toList = (value) =>
    toArray(value)
      .map((item) => cleanString(item))
      .filter(Boolean);

  const toDivisionBreakdown = (value) =>
    toArray(value)
      .map((entry) => ({
        division: cleanString(entry?.division || entry?.name),
        included: toList(entry?.included),
        missingItems: toList(entry?.missingItems || entry?.missing),
        risks: toList(entry?.risks || entry?.riskFlags)
      }))
      .filter((entry) => entry.division || entry.included.length || entry.missingItems.length || entry.risks.length);

  return {
    quickScopeReadback: toList(parsedSections?.quickScopeReadback || fallbackSections?.quickScopeReadback),
    clarifyingQuestions: toList(parsedSections?.clarifyingQuestions || fallbackSections?.clarifyingQuestions),
    assumptionsExclusions: toList(parsedSections?.assumptionsExclusions || fallbackSections?.assumptionsExclusions),
    divisionBreakdown: toDivisionBreakdown(parsedSections?.divisionBreakdown || fallbackSections?.divisionBreakdown),
    missingScopeRecommendations: toList(
      parsedSections?.missingScopeRecommendations || fallbackSections?.missingScopeRecommendations
    ),
    materialSubtradeSuggestions: toList(
      parsedSections?.materialSubtradeSuggestions || fallbackSections?.materialSubtradeSuggestions
    ),
    uomComplianceCheck: toList(parsedSections?.uomComplianceCheck || fallbackSections?.uomComplianceCheck)
  };
}

function normalizeValidationLineKey(value = "") {
  return cleanString(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasValidationLineKeyCollision(candidateKey = "", keySet = new Set()) {
  const key = cleanString(candidateKey);
  if (!key || !keySet?.size) return false;
  if (keySet.has(key)) return true;
  if (key.length < 12) return false;
  for (const existingKey of keySet) {
    if (!existingKey || existingKey.length < 8) continue;
    if (existingKey.includes(key) || key.includes(existingKey)) return true;
  }
  return false;
}

function buildDivisionSuggestionLineKeyMap(divisions = []) {
  const bySection = new Map();
  const byDivision = new Map();
  const global = new Set();
  const upsert = (division, description) => {
    const key = normalizeValidationLineKey(description);
    if (!key) return;
    global.add(key);
    const sectionKey = cleanString(division?.sectionId);
    if (sectionKey) {
      if (!bySection.has(sectionKey)) {
        bySection.set(sectionKey, new Set());
      }
      bySection.get(sectionKey).add(key);
    }
    const divisionKey = normalizeDivisionKey(division?.id || division?.title);
    if (!divisionKey) return;
    if (!byDivision.has(divisionKey)) {
      byDivision.set(divisionKey, new Set());
    }
    byDivision.get(divisionKey).add(key);
  };

  toArray(divisions).forEach((division) => {
    toArray(division?.materials?.lines).forEach((line) => upsert(division, line?.description));
    toArray(division?.subcontractor?.lines).forEach((line) => upsert(division, line?.description));
    toArray(division?.materialLines).forEach((line) => upsert(division, line?.description));
    toArray(division?.subcontractorLines).forEach((line) => upsert(division, line?.description));
  });

  return { bySection, byDivision, global };
}

function sanitizeValidation(parsed, fallback, divisions = [], quoteBody = "") {
  const parsedSuggestions = toArray(parsed?.suggestions);
  const suggestions = parsedSuggestions
    .map((suggestion, index) => {
      const rawLineType = cleanString(suggestion?.lineSuggestion?.type || "material").toLowerCase();
      const fallbackUom = rawLineType === "labour" ? "HOUR" : "EACH";
      const lineSuggestion = suggestion?.lineSuggestion
        ? {
            type: rawLineType,
            description: cleanString(suggestion.lineSuggestion.description || "Suggested line"),
            quantity: Math.max(0, parseNumber(suggestion.lineSuggestion.quantity, 0)),
            quantityStatus: TASK_PLAN_QUANTITY_STATUSES.has(cleanString(suggestion.lineSuggestion.quantityStatus).toLowerCase())
              ? cleanString(suggestion.lineSuggestion.quantityStatus).toLowerCase()
              : parseNumber(suggestion.lineSuggestion.quantity, Number.NaN) > 0
                ? "provided"
                : "missing",
            uom: resolveTaskLineUom(
              suggestion.lineSuggestion.uom,
              `${cleanString(suggestion.lineSuggestion.description)} ${cleanString(suggestion?.scopeText)} ${cleanString(suggestion?.title)}`,
              fallbackUom
            ),
            cost: parseNumber(suggestion.lineSuggestion.cost, 0),
            markup: parseNumber(suggestion.lineSuggestion.markup, 0),
            sellingPrice: parseNumber(suggestion.lineSuggestion.sellingPrice, 0),
            specStatus: TASK_PLAN_SPEC_STATUSES.has(cleanString(suggestion.lineSuggestion.specStatus).toLowerCase())
              ? cleanString(suggestion.lineSuggestion.specStatus).toLowerCase()
              : inferSpecStatus(cleanString(suggestion.lineSuggestion.description)),
            requiredInputs: uniqueStringList(suggestion.lineSuggestion.requiredInputs),
            assumptions: uniqueStringList(suggestion.lineSuggestion.assumptions),
            riskFlags: uniqueStringList(suggestion.lineSuggestion.riskFlags),
            confidence: Math.max(0.05, Math.min(0.99, parseNumber(suggestion.lineSuggestion.confidence, 0.5)))
          }
        : null;

      const normalized = {
        id: cleanString(suggestion?.id || `suggestion-${index + 1}`),
        sectionId: cleanString(suggestion?.sectionId),
        divisionId: cleanString(suggestion?.divisionId),
        sectionTitle: cleanString(suggestion?.sectionTitle || suggestion?.divisionTitle),
        title: cleanString(suggestion?.title || "Suggested improvement"),
        reason: cleanString(suggestion?.reason || ""),
        estimatedHours: parseNumber(suggestion?.estimatedHours, 0),
        estimatedMaterialCost: parseNumber(suggestion?.estimatedMaterialCost, 0),
        scopeText: cleanString(suggestion?.scopeText || ""),
        lineSuggestion
      };

      if (normalized.lineSuggestion) {
        const lineType = cleanString(normalized.lineSuggestion.type).toLowerCase();
        const quantity = Math.max(0, parseNumber(normalized.lineSuggestion.quantity, 0));
        const unitCost = Math.max(0, parseNumber(normalized.lineSuggestion.cost, 0));
        const markupPercent = parseNumber(normalized.lineSuggestion.markup, 0);
        const sellingPrice = parseNumber(normalized.lineSuggestion.sellingPrice, 0);
        if (quantity > 0 && normalized.lineSuggestion.quantityStatus === "missing") {
          normalized.lineSuggestion.quantityStatus = "provided";
        }
        const defaultMeta = buildDefaultRequiredInputs(
          lineType,
          cleanString(normalized.lineSuggestion.description),
          normalized.lineSuggestion.quantityStatus
        );
        normalized.lineSuggestion.requiredInputs = uniqueStringList([
          ...toArray(normalized.lineSuggestion.requiredInputs),
          ...defaultMeta.requiredInputs
        ]);
        normalized.lineSuggestion.assumptions = uniqueStringList([
          ...toArray(normalized.lineSuggestion.assumptions),
          ...defaultMeta.assumptions
        ]);
        normalized.lineSuggestion.riskFlags = uniqueStringList([
          ...toArray(normalized.lineSuggestion.riskFlags),
          ...defaultMeta.riskFlags
        ]);
        normalized.lineSuggestion.confidence = Number.isFinite(parseNumber(normalized.lineSuggestion.confidence, Number.NaN))
          ? Math.max(0.05, Math.min(0.99, parseNumber(normalized.lineSuggestion.confidence, 0.5)))
          : inferLineConfidence({
              quantityStatus: normalized.lineSuggestion.quantityStatus,
              specStatus: normalized.lineSuggestion.specStatus,
              requiredInputs: normalized.lineSuggestion.requiredInputs
            });

        normalized.lineSuggestion.quantity = quantity;
        if (sellingPrice <= 0 && unitCost > 0) {
          normalized.lineSuggestion.sellingPrice = Math.round(unitCost * (1 + markupPercent / 100) * 100) / 100;
        }

        if (normalized.estimatedHours <= 0 && lineType === "labour") {
          normalized.estimatedHours = quantity;
        }
        if (normalized.estimatedMaterialCost <= 0 && (lineType === "material" || lineType === "subtrade")) {
          const defaultCost = lineType === "subtrade" ? 750 : 500;
          normalized.estimatedMaterialCost = Math.round((unitCost > 0 ? unitCost * Math.max(quantity, 1) : defaultCost) * 100) / 100;
        }
      }

      const contextText = `${normalized.title} ${normalized.reason} ${normalized.scopeText}`.toLowerCase();
      if (normalized.estimatedMaterialCost <= 0 && /(material|subtrade|subcontract|glass|window|door|equipment|allowance)/.test(contextText)) {
        normalized.estimatedMaterialCost = /subtrade|subcontract/.test(contextText) ? 750 : 500;
      }
      if (normalized.estimatedHours <= 0 && /(labou?r|install|replace|repair|supervis|commission|crew|site)/.test(contextText)) {
        normalized.estimatedHours = 2;
      }

      return normalized;
    })
    .filter((item) => item.title);

  const existingSuggestionKeys = buildDivisionSuggestionLineKeyMap(divisions);
  const acceptedBySection = new Map();
  const acceptedByDivision = new Map();
  const acceptedGlobal = new Set();
  const filteredSuggestions = suggestions.filter((item) => {
    const candidateText = cleanString(item?.lineSuggestion?.description || item?.title || item?.scopeText);
    const candidateKey = normalizeValidationLineKey(candidateText);
    if (!candidateKey) return true;

    const sectionKey = cleanString(item?.sectionId);
    const divisionKey = normalizeDivisionKey(item?.divisionId);
    if (sectionKey) {
      const existingSectionSet = existingSuggestionKeys.bySection.get(sectionKey) || new Set();
      const acceptedSectionSet = acceptedBySection.get(sectionKey) || new Set();
      if (
        hasValidationLineKeyCollision(candidateKey, existingSectionSet) ||
        hasValidationLineKeyCollision(candidateKey, acceptedSectionSet)
      ) {
        return false;
      }
      if (!acceptedBySection.has(sectionKey)) {
        acceptedBySection.set(sectionKey, new Set());
      }
      acceptedBySection.get(sectionKey).add(candidateKey);
      return true;
    }

    if (divisionKey) {
      const existingDivisionSet = existingSuggestionKeys.byDivision.get(divisionKey) || new Set();
      const acceptedDivisionSet = acceptedByDivision.get(divisionKey) || new Set();
      if (
        hasValidationLineKeyCollision(candidateKey, existingDivisionSet) ||
        hasValidationLineKeyCollision(candidateKey, acceptedDivisionSet)
      ) {
        return false;
      }
    } else if (
      hasValidationLineKeyCollision(candidateKey, existingSuggestionKeys.global) ||
      hasValidationLineKeyCollision(candidateKey, acceptedGlobal)
    ) {
      return false;
    }

    if (divisionKey) {
      if (!acceptedByDivision.has(divisionKey)) {
        acceptedByDivision.set(divisionKey, new Set());
      }
      acceptedByDivision.get(divisionKey).add(candidateKey);
    } else {
      acceptedGlobal.add(candidateKey);
    }
    return true;
  });

  const finalSuggestions =
    filteredSuggestions.length > 0
      ? filteredSuggestions
      : parsedSuggestions.length > 0
        ? []
        : fallback.suggestions;
  const sections = sanitizeValidationSections(parsed?.sections, fallback.sections);
  sections.clarifyingQuestions = buildEstimatorClarifyingQuestionsFromDivisions(divisions, quoteBody);

  return {
    score: parseNumber(parsed?.score, fallback.score),
    summary: cleanString(parsed?.summary || fallback.summary),
    sections,
    suggestions: finalSuggestions
  };
}

const AI_JSON_SCHEMA_TASK_PLAN = {
  type: "object",
  additionalProperties: true,
  required: ["strategy", "tasks", "worksheetRows"],
  properties: {
    strategy: { type: "string" },
    worksheetRows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["sectionId", "divisionId", "scopeLineKey", "lineNumber", "sourceText", "generalLabourHours", "materialAllowanceCost"],
        properties: {
          sectionId: { type: "string" },
          divisionId: { type: "string" },
          scopeLineKey: { type: "string" },
          lineNumber: { type: ["number", "string"] },
          sourceText: { type: "string" },
          normalizedText: { type: "string" },
          generalLabourHours: { type: ["number", "string"] },
          supervisionHours: { type: ["number", "string"] },
          materialAllowanceCost: { type: ["number", "string"] },
          subtradeAllowanceCost: { type: ["number", "string"] },
          confidence: { type: ["number", "string"] },
          assumptions: { type: "array", items: { type: "string" } },
          missingInputs: { type: "array", items: { type: "string" } },
          riskFlags: { type: "array", items: { type: "string" } },
          needsReview: { type: ["boolean", "string"] },
          materialSuggestions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                description: { type: "string" },
                quantity: { type: ["number", "string"] },
                uom: { type: "string" },
                unitCost: { type: ["number", "string"] },
                cost: { type: ["number", "string"] },
                markup: { type: ["number", "string"] },
                sellingPrice: { type: ["number", "string"] },
                assumptions: { type: "array", items: { type: "string" } },
                riskFlags: { type: "array", items: { type: "string" } },
                confidence: { type: ["number", "string"] }
              }
            }
          }
        }
      }
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["divisionId", "taskName", "scopeNote", "lineSuggestions"],
        properties: {
          sectionId: { type: "string" },
          divisionId: { type: "string" },
          taskName: { type: "string" },
          scopeNote: { type: "string" },
          lineSuggestions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["type", "description", "quantity", "uom", "cost", "markup", "sellingPrice"],
              properties: {
                type: { type: "string" },
                description: { type: "string" },
                quantity: { type: ["number", "string"] },
                quantityStatus: { type: "string" },
                uom: { type: "string" },
                cost: { type: ["number", "string"] },
                markup: { type: ["number", "string"] },
                sellingPrice: { type: ["number", "string"] },
                specStatus: { type: "string" },
                confidence: { type: ["number", "string"] },
                requiredInputs: { type: "array", items: { type: "string" } },
                assumptions: { type: "array", items: { type: "string" } },
                riskFlags: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      }
    }
  }
};

const AI_JSON_SCHEMA_POLISH = {
  type: "object",
  additionalProperties: true,
  required: ["polishedText", "notes"],
  properties: {
    polishedText: { type: "string" },
    notes: { type: "string" }
  }
};

const AI_JSON_SCHEMA_DESCRIPTION = {
  type: "object",
  additionalProperties: true,
  required: ["description", "notes"],
  properties: {
    description: { type: "string" },
    notes: { type: "string" }
  }
};

const AI_JSON_SCHEMA_VALIDATION = {
  type: "object",
  additionalProperties: true,
  required: ["score", "summary", "sections", "suggestions"],
  properties: {
    score: { type: ["number", "string"] },
    summary: { type: "string" },
    sections: { type: "object", additionalProperties: true },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true
      }
    }
  }
};

async function chatJson({
  apiKey,
  model,
  system,
  user,
  temperature = 0.2,
  jsonSchemaName = "",
  jsonSchema = null
}) {
  if (!cleanString(apiKey)) return null;
  try {
    const client = new OpenAI({ apiKey });
    const request = {
      model: cleanString(model) || "gpt-4o-mini",
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    };

    if (jsonSchema && typeof jsonSchema === "object") {
      request.response_format = {
        type: "json_schema",
        json_schema: {
          name: cleanString(jsonSchemaName || "structured_response"),
          schema: jsonSchema,
          strict: false
        }
      };
    }

    let completion;
    try {
      completion = await client.chat.completions.create(request);
    } catch (schemaError) {
      const message = cleanString(schemaError?.message || "");
      if (!request.response_format || !/response_format|json_schema|schema/i.test(message)) {
        throw schemaError;
      }
      const retryRequest = {
        model: request.model,
        temperature: request.temperature,
        messages: request.messages
      };
      completion = await client.chat.completions.create(retryRequest);
    }

    const content = completion.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      try {
        return JSON.parse(content);
      } catch (_error) {
        return extractJsonObject(content);
      }
    }
    return extractJsonObject(content);
  } catch (error) {
    console.warn("[ai] OpenAI request failed. Falling back to deterministic output.", error?.message || error);
    return null;
  }
}

function mergeTaskPlanResponses(base = {}, supplement = {}) {
  return {
    strategy: cleanString(base?.strategy || supplement?.strategy),
    worksheetRows: [...toArray(base?.worksheetRows), ...toArray(supplement?.worksheetRows)],
    tasks: [...toArray(base?.tasks), ...toArray(supplement?.tasks)]
  };
}

const PROTOTYPE_TRADE_ORDER = ["construction", "electrical", "plumbing", "hvac", "glendale"];
const PROTOTYPE_CLASSIFICATION_RULES = [
  {
    trade: "glendale",
    patterns: [
      /\bglendale\b/i,
      /\bengineer(?:ing)?\b/i,
      /\barchitect(?:ural)?\b/i,
      /\bconsultant\b/i,
      /\bpermit\b/i,
      /\bdesign\b/i,
      /\bdrawings?\b/i,
      /\bsubmittals?\b/i,
      /\bcalculations?\b/i,
      /\bstamped\b/i
    ]
  },
  {
    trade: "electrical",
    patterns: [
      /\belectrical\b/i,
      /\bpower\b/i,
      /\bpanel\b/i,
      /\bconduit\b/i,
      /\bwiring?\b/i,
      /\bdisconnect\b/i,
      /\bjunction\b/i,
      /\blighting?\b/i,
      /\bfixtures?\b/i,
      /\breceptacles?\b/i,
      /\bswitch(?:es)?\b/i,
      /\bbreakers?\b/i,
      /\besa\b/i
    ]
  },
  {
    trade: "plumbing",
    patterns: [
      /\bplumbing\b/i,
      /\bdomestic water\b/i,
      /\bsanitary\b/i,
      /\bdrain(?:age)?\b/i,
      /\bcondensate\b/i,
      /\bbackflow\b/i,
      /\bfixture(?:s)?\b/i,
      /\bvalve(?:s)?\b/i,
      /\bpump(?:s)?\b/i,
      /\bfloor drain\b/i,
      /\bwashroom\b/i,
      /\bhumidifier\b/i
    ]
  },
  {
    trade: "hvac",
    patterns: [
      /\bhvac\b/i,
      /\bmechanical\b/i,
      /\brtu\b/i,
      /\brooftop\b/i,
      /\bair handler\b/i,
      /\bduct(?:work)?\b/i,
      /\bdiffuser(?:s)?\b/i,
      /\bgrille(?:s)?\b/i,
      /\bregister(?:s)?\b/i,
      /\bthermostat\b/i,
      /\bexhaust\b/i,
      /\bsupply air\b/i,
      /\breturn air\b/i,
      /\bgas piping\b/i,
      /\bsprinkler(?:s)?\b/i
    ]
  },
  {
    trade: "construction",
    patterns: [
      /\bconstruction\b/i,
      /\bdemo(?:lish|lition)?\b/i,
      /\bframing\b/i,
      /\bdrywall\b/i,
      /\bpaint(?:ing)?\b/i,
      /\bceiling\b/i,
      /\bpartition\b/i,
      /\bconcrete\b/i,
      /\basphalt\b/i,
      /\bstructural\b/i,
      /\breinforcement\b/i,
      /\bcarpentry\b/i,
      /\bmillwork\b/i,
      /\broofing\b/i,
      /\bfire watch\b/i,
      /\bdoors?\b/i,
      /\bwindows?\b/i
    ]
  }
];

function getPrototypeDivisionTitle(divisionId = "") {
  const normalized = normalizeDivisionKey(divisionId);
  if (normalized === "hvac") return "HVAC";
  return toTitleCase(normalized || "division");
}

function getPrototypeLabourDefaults(divisionId = "") {
  const normalized = normalizeDivisionKey(divisionId);
  if (normalized === "glendale") {
    return {
      technicianRate: 60,
      technicianSellingPrice: 90,
      supervisionRate: 70,
      supervisionSellingPrice: 110,
      engineerRate: 90,
      engineerSellingPrice: 135,
      seniorEngineerRate: 110,
      seniorEngineerSellingPrice: 185,
      projectManagerRate: 95,
      projectManagerSellingPrice: 150
    };
  }
  const isHvac = normalized === "hvac";
  return {
    technicianRate: 85,
    technicianSellingPrice: isHvac ? 140 : 130,
    supervisionRate: 85,
    supervisionSellingPrice: isHvac ? 140 : 130,
    engineerRate: 0,
    engineerSellingPrice: 0,
    seniorEngineerRate: 0,
    seniorEngineerSellingPrice: 0,
    projectManagerRate: isHvac ? 110 : 95,
    projectManagerSellingPrice: isHvac ? 165 : 150
  };
}

function classifyPrototypeScopeLine(scopeLine = {}) {
  const sourceText = cleanString(scopeLine?.sourceText || scopeLine?.text || scopeLine?.normalizedText);
  if (!sourceText) return [];
  const matchedTrades = PROTOTYPE_CLASSIFICATION_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(sourceText))
  ).map((rule) => rule.trade);
  if (!matchedTrades.length) return ["construction"];
  return PROTOTYPE_TRADE_ORDER.filter((trade) => matchedTrades.includes(trade));
}

function buildPrototypeDivisionsFromScope({ masterScope = "", existingDivisions = [] } = {}) {
  const scopeLines = buildScopeLineItems(masterScope);
  const groupedScopeLines = new Map();
  const existingDivisionMap = new Map(
    toArray(existingDivisions).map((division) => [
      normalizeDivisionKey(division?.id || division?.divisionId || division?.title),
      division
    ])
  );

  scopeLines.forEach((scopeLine) => {
    const trades = classifyPrototypeScopeLine(scopeLine);
    trades.forEach((trade) => {
      if (!groupedScopeLines.has(trade)) groupedScopeLines.set(trade, []);
      groupedScopeLines.get(trade).push({
        ...scopeLine,
        divisionId: trade
      });
    });
  });

  return PROTOTYPE_TRADE_ORDER.filter((trade) => groupedScopeLines.has(trade)).map((trade) => {
    const existingDivision = existingDivisionMap.get(trade) || {};
    const labourDefaults = getPrototypeLabourDefaults(trade);
    const sectionId = `prototype-${trade}`;
    const title = cleanString(existingDivision?.title) || getPrototypeDivisionTitle(trade);
    const tradeScopeLines = groupedScopeLines.get(trade) || [];
    return {
      id: trade,
      sectionId,
      title,
      scope: tradeScopeLines.map((line) => cleanString(line?.sourceText)).filter(Boolean).join("\n"),
      scopeLines: tradeScopeLines,
      labour: {
        noCost: false,
        ...labourDefaults
      },
      materials: {
        noCost: trade === "glendale",
        lines: []
      },
      subcontractor: {
        noCost: false,
        lines: []
      }
    };
  });
}

function resolvePrototypeLabourRoleConfig(divisionId = "", description = "") {
  const normalizedDivision = normalizeDivisionKey(divisionId);
  const text = cleanString(description).toLowerCase();
  const defaults = getPrototypeLabourDefaults(normalizedDivision);
  if (normalizedDivision === "glendale") {
    if (/project manager|project coordinator|coordination|scheduling|submittal|closeout/.test(text)) {
      return {
        hoursField: "projectManagerHours",
        rateField: "projectManagerRate",
        sellField: "projectManagerSellingPrice",
        label: "Project Manager",
        rate: defaults.projectManagerRate,
        sell: defaults.projectManagerSellingPrice
      };
    }
    if (/senior engineer|sr\.?\s*engineer/.test(text)) {
      return {
        hoursField: "seniorEngineerHours",
        rateField: "seniorEngineerRate",
        sellField: "seniorEngineerSellingPrice",
        label: "Sr. Engineer",
        rate: defaults.seniorEngineerRate,
        sell: defaults.seniorEngineerSellingPrice
      };
    }
    if (/engineer|engineering|calculation|permit|stamped/.test(text)) {
      return {
        hoursField: "engineerHours",
        rateField: "engineerRate",
        sellField: "engineerSellingPrice",
        label: "Engineer",
        rate: defaults.engineerRate,
        sell: defaults.engineerSellingPrice
      };
    }
    if (/architect|architectural|drawing|design/.test(text)) {
      return {
        hoursField: "supervisionHours",
        rateField: "supervisionRate",
        sellField: "supervisionSellingPrice",
        label: "Architect",
        rate: defaults.supervisionRate,
        sell: defaults.supervisionSellingPrice
      };
    }
    return {
      hoursField: "technicianHours",
      rateField: "technicianRate",
      sellField: "technicianSellingPrice",
      label: "Design",
      rate: defaults.technicianRate,
      sell: defaults.technicianSellingPrice
    };
  }
  if (/project manager|project coordinator|coordination|scheduling|submittal|closeout/.test(text)) {
    return {
      hoursField: "projectManagerHours",
      rateField: "projectManagerRate",
      sellField: "projectManagerSellingPrice",
      label: "Project Manager",
      rate: defaults.projectManagerRate,
      sell: defaults.projectManagerSellingPrice
    };
  }
  if (/supervis|foreman|quality|safety|oversight/.test(text)) {
    return {
      hoursField: "supervisionHours",
      rateField: "supervisionRate",
      sellField: "supervisionSellingPrice",
      label: "Supervision",
      rate: defaults.supervisionRate,
      sell: defaults.supervisionSellingPrice
    };
  }
  return {
    hoursField: "technicianHours",
    rateField: "technicianRate",
    sellField: "technicianSellingPrice",
    label: "General Labour",
    rate: defaults.technicianRate,
    sell: defaults.technicianSellingPrice
  };
}

function applyPrototypePremiumPostureToSuggestion(lineSuggestion = {}, divisionId = "") {
  const line = normalizeLineSuggestion(lineSuggestion, lineSuggestion);
  if (!line) return null;
  const next = { ...line };
  if (next.type === "labour") {
    const role = resolvePrototypeLabourRoleConfig(divisionId, next.description);
    next.cost = Math.max(parseNumber(next.cost, 0), parseNumber(role?.rate, 0));
    next.sellingPrice = Math.max(parseNumber(next.sellingPrice, 0), parseNumber(role?.sell, 0));
    return next;
  }

  next.markup = Math.max(50, parseNumber(next.markup, 0));
  const quantity = Math.max(0, parseNumber(next.quantity, 0));
  const resolvedCost =
    Math.max(0, parseNumber(next.cost, 0)) ||
    (quantity > 0 ? Math.max(0, parseNumber(next.unitCost, 0)) * quantity : 0);
  next.cost = roundCurrency(resolvedCost);
  if (next.cost > 0) {
    next.sellingPrice = Math.max(
      parseNumber(next.sellingPrice, 0),
      roundCurrency(next.cost * (1 + next.markup / 100))
    );
  }
  return next;
}

function applyPrototypePremiumPostureToWorksheetRow(row = {}, divisionId = "") {
  const normalized = normalizeWorksheetRow(row, row);
  if (!normalized) return null;
  const next = {
    ...normalized,
    materialSuggestions: toArray(normalized.materialSuggestions)
      .map((suggestion) => applyPrototypePremiumPostureToSuggestion(suggestion, divisionId))
      .filter(Boolean)
  };
  if (next.materialSuggestions.length) {
    next.materialAllowanceCost = roundCurrency(
      Math.max(
        parseNumber(next.materialAllowanceCost, 0),
        next.materialSuggestions.reduce((sum, suggestion) => sum + Math.max(0, parseNumber(suggestion?.cost, 0)), 0)
      )
    );
  }
  return next;
}

function buildPrototypeGlendaleFallbackLabour(scopeLines = []) {
  const totals = {
    technicianHours: 0,
    supervisionHours: 0,
    engineerHours: 0,
    seniorEngineerHours: 0,
    projectManagerHours: 0
  };
  toArray(scopeLines).forEach((scopeLine) => {
    const text = cleanString(scopeLine?.sourceText || scopeLine?.text || scopeLine?.normalizedText);
    if (!text) return;
    const extractedHours =
      cleanString(extractMeasuredQuantityFromText(text)?.uom) === "HOUR"
        ? Math.max(0, parseNumber(extractMeasuredQuantityFromText(text)?.quantity, 0))
        : 0;
    const fallbackHours = extractedHours || Math.max(2, inferFallbackWorksheetLabourHours(text, "glendale"));
    const role = resolvePrototypeLabourRoleConfig("glendale", text);
    totals[role.hoursField] = roundCurrency(Math.max(0, parseNumber(totals[role.hoursField], 0)) + fallbackHours);
  });
  return totals;
}

function buildPrototypeSectionLabour(section = {}, prototypeDivision = {}) {
  const divisionId = normalizeDivisionKey(section?.divisionId || prototypeDivision?.id);
  const defaults = getPrototypeLabourDefaults(divisionId);
  const worksheetRows = toArray(section?.worksheetRows);
  const tasks = toArray(section?.tasks);
  const totals = {
    technicianHours: 0,
    supervisionHours: 0,
    engineerHours: 0,
    seniorEngineerHours: 0,
    projectManagerHours: 0
  };

  if (divisionId === "glendale") {
    tasks.forEach((task) => {
      toArray(task?.lineSuggestions)
        .filter((line) => cleanString(line?.type).toLowerCase() === "labour")
        .forEach((line) => {
          const role = resolvePrototypeLabourRoleConfig(divisionId, line?.description || task?.scopeNote || task?.taskName);
          totals[role.hoursField] = roundCurrency(
            Math.max(0, parseNumber(totals[role.hoursField], 0)) + Math.max(0, parseNumber(line?.quantity, 0))
          );
        });
    });
    const hasAnyHours = Object.values(totals).some((value) => parseNumber(value, 0) > 0);
    if (!hasAnyHours) {
      Object.assign(totals, buildPrototypeGlendaleFallbackLabour(section?.scopeLines));
    }
  } else {
    totals.technicianHours = roundCurrency(
      worksheetRows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.generalLabourHours, 0)), 0)
    );
    totals.supervisionHours = roundCurrency(
      worksheetRows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.supervisionHours, 0)), 0)
    );
    totals.projectManagerHours = roundCurrency(
      worksheetRows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.projectManagerHours, 0)), 0)
    );
  }

  return {
    ...totals,
    technicianRate: defaults.technicianRate,
    technicianSellingPrice: defaults.technicianSellingPrice,
    supervisionRate: defaults.supervisionRate,
    supervisionSellingPrice: defaults.supervisionSellingPrice,
    engineerRate: defaults.engineerRate,
    engineerSellingPrice: defaults.engineerSellingPrice,
    seniorEngineerRate: defaults.seniorEngineerRate,
    seniorEngineerSellingPrice: defaults.seniorEngineerSellingPrice,
    projectManagerRate: defaults.projectManagerRate,
    projectManagerSellingPrice: defaults.projectManagerSellingPrice
  };
}

function buildPrototypeDetailedItems(section = {}) {
  const detailedItems = [];
  toArray(section?.tasks).forEach((task) => {
    toArray(task?.lineSuggestions).forEach((line) => {
      const normalized = applyPrototypePremiumPostureToSuggestion(line, section?.divisionId);
      if (!normalized || !cleanString(normalized?.description)) return;
      detailedItems.push({
        taskName: cleanString(task?.taskName),
        scopeNote: cleanString(task?.scopeNote),
        ...normalized
      });
    });
  });
  return detailedItems;
}

function buildPrototypeSectionsFromPlan(plan = {}, prototypeDivisions = []) {
  return toArray(prototypeDivisions).map((prototypeDivision) => {
    const divisionId = normalizeDivisionKey(prototypeDivision?.id || prototypeDivision?.title);
    const sectionId = cleanString(prototypeDivision?.sectionId);
    const sectionWorksheetRows = toArray(plan?.worksheetRows)
      .filter((row) => cleanString(row?.sectionId) === sectionId)
      .map((row) => applyPrototypePremiumPostureToWorksheetRow(row, divisionId))
      .filter(Boolean);
    const sectionTasks = toArray(plan?.tasks)
      .filter((task) => cleanString(task?.sectionId) === sectionId)
      .map((task) => ({
        ...task,
        lineSuggestions: toArray(task?.lineSuggestions)
          .map((line) => applyPrototypePremiumPostureToSuggestion(line, divisionId))
          .filter(Boolean)
      }));
    const detailedItems = buildPrototypeDetailedItems({
      divisionId,
      tasks: sectionTasks
    });
    const labour = buildPrototypeSectionLabour(
      {
        divisionId,
        scopeLines: prototypeDivision?.scopeLines,
        worksheetRows: sectionWorksheetRows,
        tasks: sectionTasks
      },
      prototypeDivision
    );
    const assumptions = uniqueStringList([
      ...sectionWorksheetRows.flatMap((row) => toArray(row?.assumptions)),
      ...sectionTasks.flatMap((task) =>
        toArray(task?.lineSuggestions).flatMap((line) => toArray(line?.assumptions))
      )
    ]);
    const riskFlags = uniqueStringList([
      ...sectionWorksheetRows.flatMap((row) => toArray(row?.riskFlags)),
      ...sectionTasks.flatMap((task) =>
        toArray(task?.lineSuggestions).flatMap((line) => toArray(line?.riskFlags))
      )
    ]);
    const confidenceValues = [
      ...sectionWorksheetRows.map((row) => parseNumber(row?.confidence, Number.NaN)),
      ...sectionTasks.flatMap((task) => toArray(task?.lineSuggestions).map((line) => parseNumber(line?.confidence, Number.NaN)))
    ].filter((value) => Number.isFinite(value));
    const confidence =
      confidenceValues.length > 0
        ? roundCurrency(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
        : 0.55;
    return {
      sectionId,
      divisionId,
      title: cleanString(prototypeDivision?.title || getPrototypeDivisionTitle(divisionId)),
      scopeText: cleanString(prototypeDivision?.scope),
      scopeSummary: sanitizeBriefDescription(prototypeDivision?.scope, prototypeDivision?.title),
      scopeLines: toArray(prototypeDivision?.scopeLines),
      worksheetRows: sectionWorksheetRows,
      tasks: sectionTasks,
      detailedItems,
      labour,
      assumptions,
      riskFlags,
      confidence: Math.max(0.05, Math.min(0.99, confidence)),
      needsReview:
        sectionWorksheetRows.some((row) => Boolean(row?.needsReview)) ||
        sectionTasks.some((task) =>
          toArray(task?.lineSuggestions).some(
            (line) =>
              cleanString(line?.quantityStatus) === "missing" ||
              cleanString(line?.specStatus) !== "complete"
          )
        )
    };
  });
}

export async function generatePrototypeEstimateWithAI({
  apiKey,
  model,
  quoteType,
  masterScope,
  existingDivisions = [],
  pricingPosture = "premium_high"
}) {
  const normalizedMasterScope = normalizeScopeFormatting(cleanString(masterScope));
  const prototypeDivisions = buildPrototypeDivisionsFromScope({
    masterScope: normalizedMasterScope,
    existingDivisions
  });
  if (!prototypeDivisions.length) {
    return {
      draftId: "prototype-empty",
      generatedAt: new Date().toISOString(),
      pricingPosture: cleanString(pricingPosture || "premium_high") || "premium_high",
      strategy: "No scope lines were detected for prototype generation.",
      sections: [],
      worksheetRows: [],
      tasks: [],
      generatedByAI: false,
      historicalEstimateSuggestions: null,
      historicalRowsApplied: 0,
      historicalSectionAnchors: [],
      anchoredSectionCount: 0,
      usedHistoricalLibrary: false
    };
  }

  const plan = await generateTaskPlanWithAI({
    apiKey,
    model,
    quoteType,
    divisions: prototypeDivisions,
    quoteBody: normalizedMasterScope
  });
  const sections = buildPrototypeSectionsFromPlan(plan, prototypeDivisions);
  return {
    draftId: `prototype-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    pricingPosture: cleanString(pricingPosture || "premium_high") || "premium_high",
    scopeText: normalizedMasterScope,
    strategy: cleanString(plan?.strategy),
    sections,
    worksheetRows: sections.flatMap((section) => toArray(section?.worksheetRows)),
    tasks: sections.flatMap((section) => toArray(section?.tasks)),
    generatedByAI: Boolean(plan?.generatedByAI),
    historicalEstimateSuggestions: plan?.historicalEstimateSuggestions || null,
    historicalRowsApplied: Math.max(0, parseNumber(plan?.historicalRowsApplied, 0)),
    historicalSectionAnchors: toArray(plan?.historicalSectionAnchors),
    anchoredSectionCount: Math.max(0, parseNumber(plan?.anchoredSectionCount, 0)),
    usedHistoricalLibrary: Boolean(plan?.usedHistoricalLibrary)
  };
}

export async function generateTaskPlanWithAI({
  apiKey,
  model,
  quoteType,
  divisions,
  quoteBody
}) {
  const fallback = buildFallbackTaskPlan(divisions);
  const selectedDivisions = toArray(divisions).map((division) => ({
    id: normalizeDivisionKey(division?.id || division?.title),
    sectionId: cleanString(division?.sectionId),
    title: cleanString(division?.title || division?.id),
    scope: cleanString(division?.scope),
    scopeLines: buildScopeLineItems(division?.scope, division?.scopeLines),
    templateMapping: division?.templateMapping || {},
    labour: division?.labour || {},
    materials: division?.materials || {},
    subcontractor: division?.subcontractor || {}
  }));
  const fullScopeText =
    cleanString(quoteBody) ||
    selectedDivisions
      .map((division) => cleanString(division?.scope))
      .filter(Boolean)
      .join("\n\n");
  let historicalEstimateSuggestions = null;
  try {
    historicalEstimateSuggestions = await suggestHistoricalEstimateMatches({
      divisions: selectedDivisions
    });
  } catch (error) {
    console.warn("[ai] Historical estimate suggestion lookup failed for task plan.", error?.message || error);
  }
  const historicalPromptContext = buildHistoricalTaskPlanPromptContext(historicalEstimateSuggestions);

  const buildTaskPlanPrompt = (
    inputDivisions,
    promptLabel = "Create an estimator worksheet",
    promptContext = ""
  ) =>
    `${promptLabel} for a ${cleanString(quoteType)} quote.\n` +
    `Return JSON with shape:\n` +
    `{"strategy":"...","worksheetRows":[{"sectionId":"...","divisionId":"...","scopeLineKey":"...","lineNumber":"...","sourceText":"...","generalLabourHours":0,"supervisionHours":0,"materialAllowanceCost":0,"subtradeAllowanceCost":0,"materialSuggestions":[{"description":"...","quantity":0,"uom":"...","unitCost":0,"cost":0,"markup":0,"sellingPrice":0,"assumptions":["..."],"riskFlags":["..."],"confidence":0.0}],"confidence":0.0,"assumptions":["ASSUMED: ..."],"missingInputs":["..."],"riskFlags":["..."],"needsReview":false}],"tasks":[{"sectionId":"...","divisionId":"...","taskName":"...","scopeNote":"...","lineSuggestions":[{"type":"labour|material|subtrade","description":"...","quantity":0,"quantityStatus":"provided|extracted|assumed|missing","uom":"...","cost":0,"markup":0,"sellingPrice":0,"specStatus":"complete|missing_finish|missing_brand|missing_method|missing_location","confidence":0.0,"requiredInputs":["..."],"assumptions":["ASSUMED: ..."],"riskFlags":["..."]}]}]}\n` +
    "Rules:\n" +
    "- Read the ENTIRE scope text and every provided scopeLines entry.\n" +
    "- Use any provided historical pricing anchors as prior examples. Do not copy them blindly; adapt them to the current scope text.\n" +
    "- If a historical quote-section anchor is marked hard, keep that section's total worksheet cost within 10% of the archived section subtotal.\n" +
    "- Return one worksheetRows item for every supplied non-Glendale scopeLines entry. Do not omit any supplied scope line.\n" +
    "- Echo the exact sectionId, divisionId, scopeLineKey, lineNumber, and sourceText from the matching input scope line.\n" +
    "- Estimate direct field execution hours in generalLabourHours for each scope line.\n" +
    "- For project manager, coordinator, supervisor, safety, quality, scheduling, and oversight lines: put hours in supervisionHours, keep generalLabourHours at 0, and stay conservative unless duration is explicit.\n" +
    "- Do not return supervision-only rows for direct install, remove, modify, or supply scope unless the scope text is clearly administrative.\n" +
    "- Do not split one supplied scope line into multiple worksheet rows.\n" +
    "- Set materialAllowanceCost to the best reasonable allowance for that scope line; use 0 only when the line is clearly labour/admin only.\n" +
    "- Use subtradeAllowanceCost for specialist vendor/equipment/system cost. For proprietary mobile systems, compact shelving, mechanically assisted storage, powered carriages, static units, and similar specialty systems, do not hide the dominant cost in labour or a tiny disposal material allowance.\n" +
    "- Use materialAllowanceCost for dump fees, consumables, minor materials, and disposal. Use subtradeAllowanceCost when the actual system/vendor scope is the major cost driver.\n" +
    "- If specialist vendor cost is the primary cost driver for a row, keep MeadowBrook generalLabourHours conservative.\n" +
    "- When a historical anchor shows real vendor/subtrade cost for a similar scope line, reflect that unless the current scope text clearly says otherwise.\n" +
    "- Include materialSuggestions only when the scope clearly implies a specific material or disposal line. Otherwise rely on materialAllowanceCost.\n" +
    "- If a line is underspecified, still estimate it, add assumptions/missingInputs/riskFlags, and set needsReview=true.\n" +
    "- Keep numbers numeric. Never omit a row because quantity is missing.\n" +
    "- Keep tasks for estimator-friendly cost coverage and subtrade suggestions; tasks may be empty if worksheetRows fully cover the section.\n" +
    "- Approved UOM values for materialSuggestions and tasks: " +
    `${TASK_PLAN_APPROVED_UOM_LIST}.\n` +
    `Full Scope:\n${fullScopeText}\n` +
    `Divisions:\n${JSON.stringify(inputDivisions, null, 2)}${promptContext ? `\n${promptContext}` : ""}`;

  let parsed = await chatJson({
    apiKey,
    model,
    temperature: 0,
    jsonSchemaName: "task_plan",
    jsonSchema: AI_JSON_SCHEMA_TASK_PLAN,
    system:
      "You are a MeadowBrook estimator assistant. Return strict JSON only and do not wrap in markdown.",
    user: buildTaskPlanPrompt(selectedDivisions, "Create an estimator worksheet", historicalPromptContext)
  });

  const expectedRows = toArray(fallback?.worksheetRows);
  const returnedRowKeys = new Set(
    toArray(parsed?.worksheetRows).map((row) => `${cleanString(row?.sectionId)}|${cleanString(row?.scopeLineKey)}`)
  );
  const missingRows = expectedRows.filter((row) => !returnedRowKeys.has(`${cleanString(row?.sectionId)}|${cleanString(row?.scopeLineKey)}`));

  if (missingRows.length && cleanString(apiKey)) {
    const missingDivisions = selectedDivisions
      .map((division) => ({
        ...division,
        scopeLines: division.scopeLines.filter((line) =>
          missingRows.some(
            (missingRow) =>
              cleanString(missingRow?.sectionId) === cleanString(division?.sectionId) &&
              cleanString(missingRow?.scopeLineKey) === cleanString(line?.scopeLineKey)
          )
        )
      }))
      .filter((division) => division.scopeLines.length > 0);
    if (missingDivisions.length) {
      const retryParsed = await chatJson({
        apiKey,
        model,
        temperature: 0,
        jsonSchemaName: "task_plan",
        jsonSchema: AI_JSON_SCHEMA_TASK_PLAN,
        system: "You are a MeadowBrook estimator assistant. Return strict JSON only and do not wrap in markdown.",
        user: buildTaskPlanPrompt(missingDivisions, "Estimate only the missing worksheet rows", historicalPromptContext)
      });
      if (retryParsed) {
        parsed = mergeTaskPlanResponses(parsed || {}, retryParsed);
      }
    }
  }

  const sanitizedPlan = sanitizeTaskPlan(parsed || {}, fallback);
  const historicalEnrichment = enrichTaskPlanWithHistoricalData(
    sanitizedPlan,
    historicalEstimateSuggestions || {},
    selectedDivisions
  );

  return {
    ...historicalEnrichment.plan,
    generatedByAI: Boolean(parsed),
    historicalEstimateSuggestions,
    historicalRowsApplied: historicalEnrichment.historicalRowsApplied,
    historicalSectionAnchors: historicalEnrichment.historicalSectionAnchors,
    anchoredSectionCount: historicalEnrichment.anchoredSectionCount,
    usedHistoricalLibrary: historicalEnrichment.usedHistoricalLibrary
  };
}

export async function polishQuoteBodyWithAI({
  apiKey,
  model,
  quoteBody,
  quoteType,
  mode = "context",
  customInstructions = "",
  clarifications = []
}) {
  const source = cleanString(quoteBody);
  if (!source) {
    return {
      polishedText: "",
      notes: "No text provided.",
      generatedByAI: false
    };
  }

  const normalizedMode = ["grammar", "context", "custom"].includes(cleanString(mode).toLowerCase())
    ? cleanString(mode).toLowerCase()
    : "context";
  const customInstructionText = cleanString(customInstructions);
  const resolvedClarifications = normalizeClarifications(clarifications);
  const modePrompt =
    normalizedMode === "grammar"
      ? "Fix only grammar, punctuation, and spelling. Do not change structure, sequence, or technical meaning."
      : normalizedMode === "context"
        ? "Improve context flow and structure so the scope reads clearly from start to finish. Keep technical meaning and deliverables intact."
        : `Apply this custom instruction while preserving technical intent: ${customInstructionText}`;

  const stripPlaceholderScopeBoilerplate = (text = "") =>
    String(text || "")
      .replace(/\bat TBD (?:location|area|site)\b/gi, "")
      .replace(/\bwith TBD (?:specifications?|scope|details|finish(?:es)?|brands?)\b/gi, "")
      .replace(/\bexecuted per project requirements and closed out upon completion\b/gi, "")
      .replace(/\bclosed out upon completion\b/gi, "")
      .replace(/\s+,/g, ",")
      .replace(/\s+\./g, ".")
      .replace(/[ \t]+/g, " ")
      .trim();
  const clarificationPromptBlock = resolvedClarifications.length
    ? `Estimator-provided clarifications. Treat these as authoritative project details and fold them into the polished scope when relevant:\n${resolvedClarifications
        .map((entry) => `- Question: ${entry.question}\n  Answer: ${entry.answer}`)
        .join("\n")}\n`
    : "";

  const parsed = await chatJson({
    apiKey,
    model,
    temperature: 0.1,
    jsonSchemaName: "scope_polish",
    jsonSchema: AI_JSON_SCHEMA_POLISH,
    system:
      "You are a professional construction estimator editor. Preserve technical meaning and safety/compliance intent. Return strict JSON only.",
    user:
      `Polish this ${cleanString(quoteType)} quote narrative.\n` +
      `${modePrompt}\n` +
      "Keep a clean plain-text structure. Preserve numbered headings/items and keep each major item on its own line.\n" +
      "Write scope as item-by-item steps; do not return a single long paragraph under a heading.\n" +
      "Do not collapse the scope into one long paragraph.\n" +
      "Improve clarity without inventing missing details or padding the wording with boilerplate.\n" +
      "Do not inject placeholders such as TBD location, TBD specifications, executed per project requirements, or closed out upon completion.\n" +
      "If information is missing, keep the original concise scope wording and mention unresolved items only in the notes field as estimator follow-up questions.\n" +
      clarificationPromptBlock +
      `Always process the entire provided scope text, not just a section.\n` +
      `Return JSON: {"polishedText":"...","notes":"short changelog"}\n` +
      `Text:\n${source}`
  });

  const polishedText = normalizeScopeFormatting(stripPlaceholderScopeBoilerplate(cleanString(parsed?.polishedText || source)));
  return {
    polishedText: polishedText || cleanString(source),
    notes: cleanString(parsed?.notes || "Scope polish completed with formatting cleanup."),
    generatedByAI: Boolean(parsed)
  };
}

export async function generateQuoteDescriptionWithAI({
  apiKey,
  model,
  quoteType,
  accountName,
  quoteBody,
  divisions,
  currentDescription
}) {
  const fallbackDescription = buildFallbackQuoteDescription({
    quoteType,
    accountName,
    quoteBody,
    divisions
  });
  const scopeSource =
    collapseWhitespace(quoteBody) ||
    toArray(divisions)
      .map((division) => cleanString(division?.scope))
      .filter(Boolean)
      .join("\n");
  const existingDescription = cleanString(currentDescription);

  const parsed = await chatJson({
    apiKey,
    model,
    temperature: 0.2,
    jsonSchemaName: "quote_description",
    jsonSchema: AI_JSON_SCHEMA_DESCRIPTION,
    system:
      "You write concise one-line project summaries for opportunity/quote subject lines. Return strict JSON only.",
    user:
      "Create one brief one-line summary of the ENTIRE scope of work across all provided divisions.\n" +
      "Rules: 8-16 words, max 110 characters, plain language, no customer name, no bullet/numbering.\n" +
      "The summary must represent the full scope, not only the first task.\n" +
      'Return JSON: {"description":"...","notes":"short rationale"}\n' +
      `Quote type: ${cleanString(quoteType)}\n` +
      `Account: ${cleanString(accountName)}\n` +
      `Current description: ${existingDescription}\n` +
      `Scope:\n${scopeSource}\n` +
      `Divisions:\n${JSON.stringify(toArray(divisions).map((division) => ({
        id: cleanString(division?.id),
        title: cleanString(division?.title),
        scope: cleanString(division?.scope)
      })), null, 2)}`
  });

  const description = sanitizeBriefDescription(
    cleanString(parsed?.description || parsed?.subject || fallbackDescription),
    fallbackDescription
  );
  return {
    description: description || fallbackDescription,
    notes: cleanString(parsed?.notes || "Generated from scope of work."),
    generatedByAI: Boolean(parsed)
  };
}

const ESTIMATOR_UOM_GUIDE = [
  "BOTTLE(EA), CAN(EA), EA, EACH, HOUR(HUR), ITEM, KG(KGM), KM, LB, LFT, LITER(LTR), M3, METER(MTR), MINUTE(MIN),",
  "PACK(NMP), PALLET(EA), PIECE(PCB), SQFT, TONNES(TNE), Y3."
].join(" ");

const SENIOR_ESTIMATOR_SYSTEM_PROMPT = [
  "You are Senior Estimator (Construction + Glendale Engineering) for a Canadian commercial contractor.",
  "Capabilities: build benchmark estimates, audit provided estimates, and run hybrid comparison mode.",
  "Always separate COST vs SELL, show markups, and keep recommendations practical.",
  "Do not invent hard constraints. Ask clarifying questions when needed; if proceeding, label assumptions as ASSUMED.",
  "Do not rewrite scope using literal TBD placeholders; put unresolved details in clarifyingQuestions instead.",
  "Default geography and costing assumptions to Canada (Ontario) unless payload says otherwise.",
  "Normalize UOM to approved set only and include Unit ID where available.",
  "Output MUST be strict JSON only with this shape:",
  "{",
  '  "score": 0-100,',
  '  "summary": "short paragraph",',
  '  "sections": {',
  '    "quickScopeReadback": ["..."],',
  '    "clarifyingQuestions": ["..."],',
  '    "assumptionsExclusions": ["..."],',
  '    "divisionBreakdown": [{"division":"Construction","included":["..."],"missingItems":["..."],"risks":["..."]}],',
  '    "missingScopeRecommendations": ["..."],',
  '    "materialSubtradeSuggestions": ["..."],',
  '    "uomComplianceCheck": ["..."]',
  "  },",
  '  "suggestions": [',
  "    {",
  '      "id":"...",',
  '      "sectionId":"...",',
  '      "divisionId":"construction|electrical|plumbing|hvac|glendale",',
  '      "sectionTitle":"Construction 1",',
  '      "title":"...",',
  '      "reason":"...",',
  '      "scopeText":"itemized recommendation text",',
  '      "estimatedHours": 0,',
  '      "estimatedMaterialCost": 0,',
  '      "lineSuggestion": {',
  '        "type":"labour|material|subtrade",',
  '        "description":"...",',
  '        "quantity":1,',
  '        "cost":0,',
  '        "markup":0,',
  '        "sellingPrice":0',
  "      }",
  "    }",
  "  ]",
  "}",
  "Rules for suggestions:",
  "- Echo the exact sectionId for the matching input division whenever sectionId is provided.",
  "- Provide labour recommendations with realistic general labour and supervision hours.",
  "- Provide material/subtrade allowances where scope implies missing costs.",
  "- Keep scopeText item-by-item, readable, and not one long paragraph.",
  "- Never mask missing takeoff quantities. If unknown, keep quantity 0 and state requiredInputs + ASSUMED notes.",
  "- When details are uncertain, include explicit ASSUMED wording.",
  `Approved UOM list: ${ESTIMATOR_UOM_GUIDE}`
].join("\n");

export async function validateQuoteWithAI({
  apiKey,
  model,
  quoteType,
  divisions,
  quoteBody,
  quoteDescription,
  account,
  opportunity,
  estimatorConfig,
  clarifications = []
}) {
  const config = {
    conservativeness: Math.min(100, Math.max(0, parseNumber(estimatorConfig?.conservativeness, 100))),
    postureLabel: cleanString(estimatorConfig?.postureLabel),
    country: cleanString(estimatorConfig?.country || "CA") || "CA",
    currency: cleanString(estimatorConfig?.currency || "CAD") || "CAD",
    labourModel: cleanString(estimatorConfig?.labourModel)
  };
  const fallback = buildFallbackValidation(divisions, config, quoteBody);
  const resolvedClarifications = normalizeClarifications(clarifications);
  const snapshot = {
    quoteType: cleanString(quoteType),
    quoteBody: cleanString(quoteBody),
    quoteDescription: cleanString(quoteDescription),
    account: {
      name: cleanString(account?.name),
      city: cleanString(account?.city),
      state: cleanString(account?.state),
      country: cleanString(account?.country || config.country)
    },
    opportunity: {
      projectType: cleanString(opportunity?.projectType),
      willWinJob: cleanString(opportunity?.willWinJob)
    },
    estimatorConfig: config,
    divisions: toArray(divisions)
  };

  const modeHint = snapshot.divisions.some((division) => {
    const labour = division?.labour || {};
    const hasHours =
      parseNumber(labour?.technicianHours) > 0 ||
      parseNumber(labour?.supervisionHours) > 0 ||
      parseNumber(labour?.projectManagerHours) > 0 ||
      parseNumber(labour?.engineerHours) > 0 ||
      parseNumber(labour?.seniorEngineerHours) > 0;
    const hasMaterialLines = toArray(division?.materials?.lines).length > 0;
    const hasSubtradeLines = toArray(division?.subcontractor?.lines).length > 0;
    return hasHours || hasMaterialLines || hasSubtradeLines;
  })
    ? "AUDIT or HYBRID"
    : "ESTIMATE";

  const parsed = await chatJson({
    apiKey,
    model,
    temperature: 0.15,
    jsonSchemaName: "quote_validation",
    jsonSchema: AI_JSON_SCHEMA_VALIDATION,
    system: SENIOR_ESTIMATOR_SYSTEM_PROMPT,
    user:
      "Run the estimator workflow using the provided payload.\n" +
      `Detected mode hint: ${modeHint}\n` +
      `Conservativeness (0=aggressive, 100=conservative): ${config.conservativeness}\n` +
      "Conservativeness rule: aggressive lowers labour/material benchmarks slightly; conservative increases contingency/coverage.\n" +
      "Enforce Canadian commercial assumptions and CAD pricing language.\n" +
      "Follow structure A-J inside sections and suggestions fields.\n" +
      "If data is missing, include concise clarifying questions and ASSUMED fallback values.\n" +
      (resolvedClarifications.length
        ? `Estimator-provided clarifications (treat these as authoritative project details and use them to reduce unnecessary follow-up questions):\n${JSON.stringify(
            resolvedClarifications,
            null,
            2
          )}\n`
        : "") +
      `Payload:\n${JSON.stringify(snapshot, null, 2)}`
  });

  return {
    ...sanitizeValidation(parsed || {}, fallback, snapshot.divisions, snapshot.quoteBody),
    generatedByAI: Boolean(parsed)
  };
}

export const __test__ = {
  splitScopeLinesPreservingInputRows,
  sanitizeTaskPlan,
  enrichTaskPlanWithHistoricalData,
  buildAnchoredSectionRows,
  calculateWorksheetRowCost,
  choosePreferredWorksheetRow,
  classifyPrototypeScopeLine,
  buildPrototypeDivisionsFromScope,
  resolveTaskLineUom,
  buildEstimatorClarifyingQuestionsFromDivisions
};
