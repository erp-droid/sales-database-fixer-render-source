import { google } from "googleapis";
import OpenAI from "openai";
import { config } from "./config.js";
import { buildGoogleAuth } from "./googleServiceAuth.js";

const TEMPLATE_SHEETS = {
  plumbing: "Template Plumbing",
  electrical: "Template Electrical",
  hvac: "Template HVAC",
  construction: "Template Construction",
  glendale: "Template Glendale"
};

const TEMPLATE_COLUMNS = {
  taskCd: 0,
  costCode: 1,
  accountGroup: 2,
  description: 3,
  uom: 4,
  sellRate: 5,
  costRate: 6,
  type: 7,
  taxCategory: 8,
  plannedStart: 9,
  plannedEnd: 10
};

const FALLBACK_TEMPLATE_ITEMS = {
  construction: {
    taskCd: "CONGEN",
    costCode: "061053",
    accountGroup: "R",
    description: "Construction Generic Scope",
    uom: "EACH",
    sellRate: 0,
    costRate: 0,
    type: "Cost and Revenue Task",
    taxCategory: "H",
    plannedStart: "",
    plannedEnd: ""
  },
  electrical: {
    taskCd: "ELECGEN",
    costCode: "260500",
    accountGroup: "R",
    description: "Electrical Generic Scope",
    uom: "EACH",
    sellRate: 0,
    costRate: 0,
    type: "Cost and Revenue Task",
    taxCategory: "H",
    plannedStart: "",
    plannedEnd: ""
  },
  plumbing: {
    taskCd: "PLUMGEN",
    costCode: "220500",
    accountGroup: "R",
    description: "Plumbing Generic Scope",
    uom: "EACH",
    sellRate: 0,
    costRate: 0,
    type: "Cost and Revenue Task",
    taxCategory: "H",
    plannedStart: "",
    plannedEnd: ""
  },
  hvac: {
    taskCd: "HVACGRAL",
    costCode: "23-0000",
    accountGroup: "R",
    description: "HVAC General",
    uom: "HOUR",
    sellRate: 140,
    costRate: 93,
    type: "Cost and Revenue Task",
    taxCategory: "H",
    plannedStart: "",
    plannedEnd: ""
  },
  glendale: {
    taskCd: "GLENGEN",
    costCode: "990000",
    accountGroup: "R",
    description: "Glendale Generic Scope",
    uom: "EACH",
    sellRate: 0,
    costRate: 0,
    type: "Cost and Revenue Task",
    taxCategory: "H",
    plannedStart: "",
    plannedEnd: ""
  }
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedTemplates = null;
let cacheTimestamp = 0;
let googleTemplateAccessDisabled = false;
let googleTemplateAccessDisableReason = "";
let googleTemplateAccessDisableLogged = false;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDivisionKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!normalized) return "";
  if (normalized.includes("plumb")) return "plumbing";
  if (normalized.includes("elect")) return "electrical";
  if (normalized === "mec" || normalized.includes("mechanical") || normalized.includes("hvac")) return "hvac";
  if (normalized.includes("construct") || normalized === "con") return "construction";
  if (normalized.includes("glendale") || normalized === "gln") return "glendale";
  return normalized;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isGoogleReauthError(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.response?.data || {})}`.toLowerCase();
  return /invalid_rapt|invalid_grant|reauth/.test(message);
}

function cloneTemplateItem(item) {
  return {
    taskCd: normalizeText(item?.taskCd),
    costCode: normalizeText(item?.costCode),
    accountGroup: normalizeText(item?.accountGroup),
    description: normalizeText(item?.description),
    uom: normalizeText(item?.uom),
    sellRate: parseNumber(item?.sellRate),
    costRate: parseNumber(item?.costRate),
    type: normalizeText(item?.type),
    taxCategory: normalizeText(item?.taxCategory),
    plannedStart: normalizeText(item?.plannedStart),
    plannedEnd: normalizeText(item?.plannedEnd)
  };
}

function getFallbackTemplateItem(division) {
  const key = normalizeDivisionKey(division);
  const preset = FALLBACK_TEMPLATE_ITEMS[key] || FALLBACK_TEMPLATE_ITEMS.construction;
  return cloneTemplateItem(preset);
}

function buildFallbackTemplateCatalog() {
  return Object.keys(TEMPLATE_SHEETS).reduce((acc, division) => {
    acc[division] = [getFallbackTemplateItem(division)];
    return acc;
  }, {});
}

function scoreGenericTemplateItem(item) {
  const text = `${normalizeText(item.taskCd)} ${normalizeText(item.description)}`.toLowerCase();
  let score = 0;
  if (/\bgeneral\b/.test(text)) score += 9;
  if (/\bgeneric\b/.test(text)) score += 8;
  if (/\bmisc(ellaneous)?\b/.test(text)) score += 7;
  if (/\ballowance\b/.test(text)) score += 6;
  if (/\blabou?r\b/.test(text)) score += 5;
  if (/\bservice\b/.test(text)) score += 4;
  if (/\bwork\b/.test(text)) score += 2;
  score -= Math.min(normalizeText(item.description).length, 120) / 120;
  return score;
}

function pickGenericTemplateItem(items = []) {
  if (!items.length) return null;
  return [...items].sort((a, b) => {
    const scoreDiff = scoreGenericTemplateItem(b) - scoreGenericTemplateItem(a);
    if (scoreDiff !== 0) return scoreDiff;
    const lenDiff = normalizeText(a.description).length - normalizeText(b.description).length;
    if (lenDiff !== 0) return lenDiff;
    return normalizeText(a.taskCd).localeCompare(normalizeText(b.taskCd));
  })[0];
}

export async function loadTemplates() {
  const now = Date.now();
  if (cachedTemplates && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedTemplates;
  }

  if (googleTemplateAccessDisabled) {
    if (googleTemplateAccessDisableReason && !googleTemplateAccessDisableLogged) {
      console.warn(`[templates] Google template access disabled: ${googleTemplateAccessDisableReason}. Using fallback mappings.`);
      googleTemplateAccessDisableLogged = true;
    }
    const fallbackCatalog = buildFallbackTemplateCatalog();
    cachedTemplates = fallbackCatalog;
    cacheTimestamp = now;
    return fallbackCatalog;
  }

  try {
    let sheets = null;
    try {
      const auth = buildGoogleAuth({
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        jsonEnvNames: ["GOOGLE_SERVICE_ACCOUNT_JSON", "QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON"],
        keyFileEnvNames: ["GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_KEY_FILE"]
      });
      const client = await auth.getClient();
      sheets = google.sheets({ version: "v4", auth: client });
    } catch (error) {
      if (isGoogleReauthError(error)) {
        googleTemplateAccessDisabled = true;
        googleTemplateAccessDisableReason = "Google OAuth re-authentication is required (invalid_rapt/invalid_grant).";
        googleTemplateAccessDisableLogged = false;
      }
      console.warn("[templates] Unable to initialize Google Sheets client. Using fallback mappings only.", error?.message || error);
      const fallbackCatalog = buildFallbackTemplateCatalog();
      cachedTemplates = fallbackCatalog;
      cacheTimestamp = now;
      return fallbackCatalog;
    }

    const results = {};

    for (const [division, sheetName] of Object.entries(TEMPLATE_SHEETS)) {
      let rows = [];
      if (!googleTemplateAccessDisabled) {
        try {
          const range = `'${sheetName}'!A1:K`;
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: config.masterSheetId,
            range
          });
          rows = response.data.values || [];
        } catch (error) {
          if (isGoogleReauthError(error)) {
            googleTemplateAccessDisabled = true;
            googleTemplateAccessDisableReason = "Google OAuth re-authentication is required (invalid_rapt/invalid_grant).";
            googleTemplateAccessDisableLogged = false;
          }
          console.warn(`[templates] Failed to load sheet "${sheetName}" for ${division}. Using fallback mapping.`, error?.message || error);
        }
      }

      const items = rows
        .slice(1)
        .map((row) => ({
          taskCd: normalizeText(row[TEMPLATE_COLUMNS.taskCd]),
          costCode: normalizeText(row[TEMPLATE_COLUMNS.costCode]),
          accountGroup: normalizeText(row[TEMPLATE_COLUMNS.accountGroup]),
          description: normalizeText(row[TEMPLATE_COLUMNS.description]),
          uom: normalizeText(row[TEMPLATE_COLUMNS.uom]),
          sellRate: parseNumber(row[TEMPLATE_COLUMNS.sellRate]),
          costRate: parseNumber(row[TEMPLATE_COLUMNS.costRate]),
          type: normalizeText(row[TEMPLATE_COLUMNS.type]),
          taxCategory: normalizeText(row[TEMPLATE_COLUMNS.taxCategory]),
          plannedStart: normalizeText(row[TEMPLATE_COLUMNS.plannedStart]),
          plannedEnd: normalizeText(row[TEMPLATE_COLUMNS.plannedEnd])
        }))
        .filter((item) => item.taskCd && item.description && item.costCode);

      results[division] = items.length ? items : [getFallbackTemplateItem(division)];
    }

    for (const division of Object.keys(TEMPLATE_SHEETS)) {
      if (!Array.isArray(results[division]) || !results[division].length) {
        results[division] = [getFallbackTemplateItem(division)];
      }
    }

    cachedTemplates = results;
    cacheTimestamp = now;
    return results;
  } catch (error) {
    console.warn("[templates] Unexpected template load failure. Using fallback mappings.", error?.message || error);
    if (isGoogleReauthError(error)) {
      googleTemplateAccessDisabled = true;
      googleTemplateAccessDisableReason = "Google OAuth re-authentication is required (invalid_rapt/invalid_grant).";
      googleTemplateAccessDisableLogged = false;
    }
    const fallbackCatalog = buildFallbackTemplateCatalog();
    cachedTemplates = fallbackCatalog;
    cacheTimestamp = now;
    return fallbackCatalog;
  }
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreMatch(tokens, candidateTokens) {
  if (!tokens.length || !candidateTokens.length) return 0;
  const tokenSet = new Set(tokens);
  let hits = 0;
  candidateTokens.forEach((token) => {
    if (tokenSet.has(token)) hits += 1;
  });
  return hits / candidateTokens.length;
}

function buildCandidateSet(items, query) {
  const tokens = tokenize(query);
  const scored = items.map((item) => {
    const candidateTokens = tokenize(item.description);
    return {
      item,
      score: scoreMatch(tokens, candidateTokens)
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 25).map((entry) => entry.item);
}

function extractJson(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const sliced = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(sliced);
  } catch {
    return null;
  }
}

export async function pickTemplateItem({ division, scopeText, materialText, subcontractorText, preferGeneric = true }) {
  const templates = await loadTemplates();
  const divisionKey = normalizeDivisionKey(division);
  const items = templates[divisionKey] || [getFallbackTemplateItem(divisionKey)];

  const genericItem = pickGenericTemplateItem(items);
  if (preferGeneric && genericItem) {
    return genericItem;
  }

  const queryText = [scopeText, materialText, subcontractorText].filter(Boolean).join(" ").trim();
  const searchText = queryText || divisionKey || division;
  const candidates = buildCandidateSet(items, searchText);

  if (!config.openaiApiKey) {
    return candidates[0];
  }

  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const prompt = `Select the closest template item for the division. Only respond with JSON like {"taskCd":"","description":""}.

Division: ${divisionKey}
Scope: ${scopeText || ""}
Materials: ${materialText || ""}
Subcontractor: ${subcontractorText || ""}

Candidates:
${candidates.map((item, index) => `${index + 1}) ${item.taskCd} - ${item.description}`).join("\n")}
`;

  try {
    const response = await client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: "You are selecting the best template item. Reply with JSON only." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    });
    const text = response.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);
    if (parsed?.taskCd) {
      const match = items.find((item) => item.taskCd.toLowerCase() === String(parsed.taskCd).toLowerCase());
      if (match) return match;
    }
  } catch {
    // fall through to default
  }

  return candidates[0];
}
