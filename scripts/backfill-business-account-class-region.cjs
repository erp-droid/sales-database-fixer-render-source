#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REQUEST_TIMEOUT_MS = 45000;
const MAX_NETWORK_RETRIES = 3;
const CHECKPOINT_EVERY = 25;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function parseArgs(argv) {
  const options = {
    apply: false,
    limit: null,
    businessAccountIds: [],
    reportFile: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--limit") {
      const raw = argv[index + 1];
      const numeric = Number(raw);
      if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error("--limit must be a positive integer.");
      }
      options.limit = numeric;
      index += 1;
      continue;
    }

    if (arg === "--business-account-id") {
      const raw = argv[index + 1];
      if (!raw || !raw.trim()) {
        throw new Error("--business-account-id requires a value.");
      }
      options.businessAccountIds.push(raw.trim());
      index += 1;
      continue;
    }

    if (arg === "--report-file") {
      const raw = argv[index + 1];
      if (!raw || !raw.trim()) {
        throw new Error("--report-file requires a value.");
      }
      options.reportFile = raw.trim();
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/backfill-business-account-class-region.cjs [--apply] [--limit N] [--business-account-id ID] [--report-file path]",
      "",
      "Behavior:",
      "  - dry-run by default",
      "  - with --apply, updates Acumatica business account ClassID and REGION attribute",
      "  - skips vendors and unsupported business account types",
      "  - assigns region by first-listed FSA mapping, then city fallback, then sales-rep fallback, then global fallback",
      "  - verifies every applied update by refetching the business account",
      "  - writes a JSON audit report to data/business-account-class-region-report.json by default",
      "",
      "Required environment:",
      "  ACUMATICA_BASE_URL",
      "  ACUMATICA_ENTITY_PATH",
      "  ACUMATICA_COMPANY",
      "  ACUMATICA_USERNAME",
      "  ACUMATICA_PASSWORD",
      "",
    ].join("\n"),
  );
}

function resolveConfig(options) {
  const rootDir = process.cwd();
  const envValues = parseEnvFile(path.join(rootDir, ".env.local"));
  const reportFile =
    options.reportFile ||
    path.join(rootDir, "data", "business-account-class-region-report.json");

  return {
    rootDir,
    acumaticaBaseUrl:
      process.env.ACUMATICA_BASE_URL || envValues.ACUMATICA_BASE_URL || "",
    acumaticaEntityPath:
      process.env.ACUMATICA_ENTITY_PATH ||
      envValues.ACUMATICA_ENTITY_PATH ||
      "/entity/lightspeed/24.200.001",
    acumaticaCompany:
      process.env.ACUMATICA_COMPANY || envValues.ACUMATICA_COMPANY || "",
    acumaticaBranch:
      process.env.ACUMATICA_BRANCH || envValues.ACUMATICA_BRANCH || "",
    acumaticaLocale:
      process.env.ACUMATICA_LOCALE || envValues.ACUMATICA_LOCALE || "en-US",
    username: process.env.ACUMATICA_USERNAME || envValues.ACUMATICA_USERNAME || "",
    password: process.env.ACUMATICA_PASSWORD || envValues.ACUMATICA_PASSWORD || "",
    reportFile,
    regionConfigPath: path.join(rootDir, "config", "business-account-region-map.json"),
  };
}

function assertConfig(config) {
  const required = [
    ["ACUMATICA_BASE_URL", config.acumaticaBaseUrl],
    ["ACUMATICA_ENTITY_PATH", config.acumaticaEntityPath],
    ["ACUMATICA_COMPANY", config.acumaticaCompany],
    ["ACUMATICA_USERNAME", config.username],
    ["ACUMATICA_PASSWORD", config.password],
  ];

  const missing = required.filter(([, value]) => !String(value || "").trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.map(([name]) => name).join(", ")}`,
    );
  }

  if (!fs.existsSync(config.regionConfigPath)) {
    throw new Error(`Region mapping file not found: ${config.regionConfigPath}`);
  }
}

function loadRegionConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return raw;
}

function ensureReportDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReportCheckpoint(filePath, report) {
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function parseSetCookies(setCookies) {
  const jar = {};

  for (const entry of setCookies) {
    const [pair] = String(entry || "").split(";");
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name || !value) {
      continue;
    }

    jar[name] = value;
  }

  return jar;
}

function buildCookieHeader(setCookies) {
  return setCookies
    .map((entry) => entry.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function buildCookieHeaderFromJar(cookieJar) {
  return Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractFormFields(html) {
  const fields = {};

  for (const tag of String(html || "").match(/<input[^>]+>/gi) || []) {
    const nameMatch = tag.match(/\bname="([^"]+)"/i);
    if (!nameMatch) {
      continue;
    }

    const valueMatch = tag.match(/\bvalue="([^"]*)"/i);
    fields[nameMatch[1]] = valueMatch ? valueMatch[1] : "";
  }

  return fields;
}

function isApiLoginLimitError(status, text) {
  return (
    status >= 500 &&
    (/api login limit/i.test(text || "") ||
      /concurrent api logins/i.test(text || "") ||
      /number of concurrent api logins/i.test(text || ""))
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function clearStaleApiSessions(config) {
  const loginPageUrl = new URL("/Frames/Login.aspx", config.acumaticaBaseUrl).toString();
  const loginPageResponse = await fetch(loginPageUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!loginPageResponse.ok) {
    throw new Error(`Failed to load Acumatica web login page (${loginPageResponse.status}).`);
  }

  const cookieJar = parseSetCookies(extractSetCookies(loginPageResponse.headers));
  const formFields = extractFormFields(await loginPageResponse.text());
  formFields["ctl00$phUser$txtUser"] = config.username;
  formFields["ctl00$phUser$txtPass"] = config.password;
  formFields["ctl00$phUser$btnLogin"] = "Sign In";

  const submitResponse = await fetch(loginPageUrl, {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: buildCookieHeaderFromJar(cookieJar),
      Referer: loginPageUrl,
    },
    body: new URLSearchParams(formFields).toString(),
    redirect: "manual",
  });

  Object.assign(cookieJar, parseSetCookies(extractSetCookies(submitResponse.headers)));

  const logoutUrl = new URL("/entity/auth/logout", config.acumaticaBaseUrl).toString();
  await fetch(logoutUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Cookie: buildCookieHeaderFromJar(cookieJar),
      Referer: loginPageUrl,
    },
  });
}

async function loginToAcumatica(config) {
  const loginUrl = new URL("/entity/auth/login", config.acumaticaBaseUrl).toString();
  const payload = {
    name: config.username,
    password: config.password,
    company: config.acumaticaCompany,
    ...(config.acumaticaBranch ? { branch: config.acumaticaBranch } : {}),
    ...(config.acumaticaLocale ? { locale: config.acumaticaLocale } : {}),
  };

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      if (isApiLoginLimitError(response.status, text) && attempt < 20) {
        try {
          process.stdout.write(
            "Acumatica API login limit reached. Attempting web-session cleanup before retrying...\n",
          );
          await clearStaleApiSessions(config);
        } catch (cleanupError) {
          process.stdout.write(
            `Web-session cleanup did not complete: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
          );
        }

        process.stdout.write(`Waiting 15s before retry ${attempt + 1}/20...\n`);
        await wait(15000);
        continue;
      }

      throw new Error(
        `Acumatica login failed (${response.status}): ${text || "No response body."}`,
      );
    }

    const cookieHeader = buildCookieHeader(extractSetCookies(response.headers));
    if (!cookieHeader) {
      throw new Error("Acumatica login succeeded but no session cookies were returned.");
    }

    return cookieHeader;
  }

  throw new Error("Acumatica login failed after repeated retries.");
}

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

function looksLikeHtmlDocument(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

async function parseJsonPayload(response, context) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const responseText = await response.text();

  if (!contentType.includes("application/json")) {
    if (contentType.includes("text/html") || looksLikeHtmlDocument(responseText)) {
      throw new HttpError(401, "Session is invalid or expired");
    }

    throw new HttpError(
      502,
      `Acumatica returned unexpected content while ${context}.`,
      { contentType: contentType || "unknown" },
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new HttpError(
      502,
      `Acumatica returned invalid JSON while ${context}.`,
    );
  }
}

function parseRetryAfterMs(value) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.trunc(seconds * 1000);
  }

  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return null;
}

async function requestAcumaticaJson(config, cookieHeader, resourcePath, init, context) {
  const headers = new Headers(init && init.headers ? init.headers : {});
  headers.set("Accept", "application/json");
  headers.set("Cookie", cookieHeader);
  if (init && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const maxRateLimitRetries = 3;
  for (let attempt = 0; attempt < MAX_NETWORK_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(
        new URL(resourcePath, `${config.acumaticaBaseUrl}${config.acumaticaEntityPath}/`).toString(),
        {
          method: init && init.method ? init.method : "GET",
          headers,
          body: init && init.body ? init.body : undefined,
          cache: "no-store",
          signal: controller.signal,
        },
      );
    } catch (error) {
      clearTimeout(timeout);
      const isAbort = error && typeof error === "object" && error.name === "AbortError";
      const isRetryableNetworkError = isAbort || error instanceof TypeError;
      if (!isRetryableNetworkError || attempt >= MAX_NETWORK_RETRIES - 1) {
        throw new Error(
          `Acumatica request failed while ${context}: ${isAbort ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : error instanceof Error ? error.message : String(error)}`,
        );
      }

      const delayMs = Math.min(8000, 1000 * 2 ** attempt);
      process.stdout.write(
        `Transient Acumatica network issue while ${context}. Retrying in ${Math.round(delayMs / 1000)}s...\n`,
      );
      await wait(delayMs);
      continue;
    }

    clearTimeout(timeout);

    if (response.status === 429 && attempt < maxRateLimitRetries) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const backoffMs = retryAfterMs === null ? Math.min(6000, 700 * 2 ** attempt) : retryAfterMs;
      process.stdout.write(
        `Acumatica rate limited ${context}. Retrying in ${Math.max(1, Math.round(backoffMs / 1000))}s...\n`,
      );
      await wait(backoffMs);
      continue;
    }

    if ([408, 502, 503, 504].includes(response.status) && attempt < MAX_NETWORK_RETRIES - 1) {
      const backoffMs = Math.min(8000, 1000 * 2 ** attempt);
      process.stdout.write(
        `Transient Acumatica HTTP ${response.status} while ${context}. Retrying in ${Math.round(backoffMs / 1000)}s...\n`,
      );
      await wait(backoffMs);
      continue;
    }

    if (!response.ok) {
      let details = null;
      let message = `Acumatica request failed while ${context}.`;
      try {
        const parsed = await parseJsonPayload(response, context);
        details = parsed;
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.message === "string" && parsed.message.trim()) {
            message = parsed.message.trim();
          } else if (
            parsed.error &&
            typeof parsed.error === "object" &&
            typeof parsed.error.message === "string" &&
            parsed.error.message.trim()
          ) {
            message = parsed.error.message.trim();
          }
        }
      } catch (parseError) {
        if (parseError instanceof HttpError) {
          throw parseError;
        }
      }
      throw new HttpError(response.status, message, details);
    }

    return parseJsonPayload(response, context);
  }

  throw new Error(`Acumatica request failed after repeated retries while ${context}.`);
}

async function logoutAcumatica(config, cookieHeader) {
  try {
    await fetch(new URL("/entity/auth/logout", config.acumaticaBaseUrl).toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader,
      },
      cache: "no-store",
    });
  } catch {
    // Best effort only.
  }
}

function buildBusinessAccountCollectionPath({ top, skip, expand, select, filter }) {
  const query = new URLSearchParams({
    $top: String(top),
    $skip: String(skip),
  });

  if (expand) {
    query.set("$expand", expand);
  }
  if (select && select.length > 0) {
    query.set("$select", select.join(","));
  }
  if (filter) {
    query.set("$filter", filter);
  }

  return `BusinessAccount?${query.toString()}`;
}

function buildBusinessAccountByIdPath(id, expand, select) {
  const query = new URLSearchParams();
  if (expand) {
    query.set("$expand", expand);
  }
  if (select && select.length > 0) {
    query.set("$select", select.join(","));
  }

  if (query.size === 0) {
    return `BusinessAccount/${encodeURIComponent(id)}`;
  }

  return `BusinessAccount/${encodeURIComponent(id)}?${query.toString()}`;
}

function unwrapCollection(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.value)) {
      return payload.value;
    }

    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
}

function readWrappedValue(record, key) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  return field.value == null ? null : field.value;
}

function readWrappedString(record, key) {
  const value = readWrappedValue(record, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFirstString(record, keys) {
  for (const key of keys) {
    const value = readWrappedString(record, key);
    if (value) {
      return value;
    }
  }

  return null;
}

function readRecordIdentity(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
  if (id) {
    return id;
  }

  return readWrappedString(record, "NoteID");
}

function readBusinessAccountId(record) {
  return readFirstString(record, [
    "BusinessAccountID",
    "BAccountID",
    "AccountCD",
    "AccountID",
    "BusinessAccountCD",
  ]);
}

function readBusinessAccountName(record) {
  return readFirstString(record, [
    "Name",
    "CompanyName",
    "AcctName",
    "BusinessAccountName",
  ]);
}

function readMainAddress(record) {
  return record && typeof record === "object" && record.MainAddress && typeof record.MainAddress === "object"
    ? record.MainAddress
    : {};
}

function readAddressField(record, key) {
  return readWrappedString(readMainAddress(record), key);
}

function readAttributeValue(record, attributeId) {
  const attributes =
    record && typeof record === "object" && Array.isArray(record.Attributes)
      ? record.Attributes
      : [];

  for (const attribute of attributes) {
    const currentId = readWrappedString(attribute, "AttributeID");
    if (currentId !== attributeId) {
      continue;
    }

    return (
      readWrappedString(attribute, "ValueDescription") ||
      readWrappedString(attribute, "Value")
    );
  }

  return null;
}

function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeStatus(value) {
  return normalizeComparable(value);
}

function normalizePostalCodeFsa(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z]\d[A-Z]/.test(normalized)) {
    return null;
  }
  return normalized.slice(0, 3);
}

function isLikelyVendorClassId(value) {
  const normalized = normalizeComparable(value);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("vendor") ||
    normalized.includes("supplier") ||
    normalized.includes("suppl") ||
    normalized.startsWith("ven")
  );
}

function isLikelyVendorType(value) {
  return isLikelyVendorClassId(value);
}

function resolveBusinessAccountClassDecision(record) {
  const type =
    normalizeComparable(readWrappedString(record, "Type")) ||
    normalizeComparable(readWrappedString(record, "TypeDescription"));
  const classId =
    readWrappedString(record, "ClassID") ||
    readWrappedString(record, "BusinessAccountClass");

  if (type && isLikelyVendorType(type)) {
    return {
      skip: true,
      skippedReason: "vendor",
      targetClassId: null,
    };
  }

  if (!type && isLikelyVendorClassId(classId)) {
    return {
      skip: true,
      skippedReason: "vendor",
      targetClassId: null,
    };
  }

  const status = normalizeStatus(readWrappedString(record, "Status"));
  return {
    skip: false,
    skippedReason: null,
    targetClassId: type === "customer" && status === "active" ? "CUSTOMER" : "LEAD",
  };
}

function normalizeRegionValue(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^region\s*(\d+)$/i);
  if (!match) {
    return trimmed;
  }

  const numeric = Number(match[1]);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) {
    return trimmed;
  }

  return `Region ${numeric}`;
}

function canonicalRegionValue(value) {
  return normalizeRegionValue(value) || "";
}

function buildExactRegionLookup(regionConfig) {
  const lookup = new Map();
  const precedence = [];

  for (const group of regionConfig.groups || []) {
    precedence.push(group.region);
    for (const fsa of group.fsas || []) {
      const normalized = normalizePostalCodeFsa(fsa);
      if (!normalized || lookup.has(normalized)) {
        continue;
      }
      lookup.set(normalized, group.region);
    }
  }

  return {
    lookup,
    precedence,
  };
}

function normalizeCityKey(record) {
  const city = String(readAddressField(record, "City") || "").trim().toUpperCase();
  const state = String(readAddressField(record, "State") || "").trim().toUpperCase();
  const country = String(readAddressField(record, "Country") || "").trim().toUpperCase();
  if (!city && !state && !country) {
    return null;
  }

  return [city, state, country].join("|");
}

function normalizeSalesRepKey(record) {
  const salesRepId = String(readWrappedString(record, "Owner") || "").trim();
  if (salesRepId) {
    return `id:${salesRepId}`;
  }

  const salesRepName = String(readWrappedString(record, "OwnerEmployeeName") || "").trim().toUpperCase();
  return salesRepName ? `name:${salesRepName}` : null;
}

function incrementCounter(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function chooseDominantRegion(counter, precedence) {
  let bestRegion = null;
  let bestCount = -1;
  let bestPrecedence = Number.POSITIVE_INFINITY;

  for (const [region, count] of counter.entries()) {
    const regionPrecedence = precedence.indexOf(region);
    const effectivePrecedence = regionPrecedence >= 0 ? regionPrecedence : precedence.length;

    if (
      count > bestCount ||
      (count === bestCount && effectivePrecedence < bestPrecedence)
    ) {
      bestRegion = region;
      bestCount = count;
      bestPrecedence = effectivePrecedence;
    }
  }

  return bestRegion;
}

function buildRegionProfiles(records, exactRegionLookup, precedence) {
  const cityProfiles = new Map();
  const salesRepProfiles = new Map();
  const globalCounts = new Map();

  for (const record of records) {
    const postalCode = readAddressField(record, "PostalCode");
    const fsa = normalizePostalCodeFsa(postalCode);
    const exactRegion = fsa ? exactRegionLookup.get(fsa) : null;
    if (!exactRegion) {
      continue;
    }

    incrementCounter(globalCounts, exactRegion);

    const cityKey = normalizeCityKey(record);
    if (cityKey) {
      const counter = cityProfiles.get(cityKey) || new Map();
      incrementCounter(counter, exactRegion);
      cityProfiles.set(cityKey, counter);
    }

    const salesRepKey = normalizeSalesRepKey(record);
    if (salesRepKey) {
      const counter = salesRepProfiles.get(salesRepKey) || new Map();
      incrementCounter(counter, exactRegion);
      salesRepProfiles.set(salesRepKey, counter);
    }
  }

  return {
    cityProfiles,
    salesRepProfiles,
    globalRegion: chooseDominantRegion(globalCounts, precedence) || precedence[0] || "Region 6",
  };
}

function resolveTargetRegion(record, exactRegionLookup, precedence, profiles) {
  const postalCode = readAddressField(record, "PostalCode");
  const fsa = normalizePostalCodeFsa(postalCode);
  const exactRegion = fsa ? exactRegionLookup.get(fsa) : null;
  if (exactRegion) {
    return {
      region: exactRegion,
      source: "exact_fsa",
      fsa,
    };
  }

  const cityKey = normalizeCityKey(record);
  if (cityKey && profiles.cityProfiles.has(cityKey)) {
    return {
      region: chooseDominantRegion(profiles.cityProfiles.get(cityKey), precedence),
      source: "city_fallback",
      fsa,
    };
  }

  const salesRepKey = normalizeSalesRepKey(record);
  if (salesRepKey && profiles.salesRepProfiles.has(salesRepKey)) {
    return {
      region: chooseDominantRegion(profiles.salesRepProfiles.get(salesRepKey), precedence),
      source: "sales_rep_fallback",
      fsa,
    };
  }

  return {
    region: profiles.globalRegion,
    source: "global_fallback",
    fsa,
  };
}

function buildBusinessAccountIdentityPayload(record) {
  const payload = {};
  const rawId = record && typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
  if (rawId) {
    payload.id = rawId;
  }

  const noteId = readWrappedString(record, "NoteID");
  if (noteId) {
    payload.NoteID = {
      value: noteId,
    };
  }

  const businessAccountId = readBusinessAccountId(record);
  if (businessAccountId) {
    payload.BusinessAccountID = {
      value: businessAccountId,
    };
  }

  return payload;
}

function buildUpdateIdentifiers(record) {
  const rawId = record && typeof record.id === "string" ? record.id.trim() : "";
  const businessAccountId = readBusinessAccountId(record) || "";
  const noteId = readWrappedString(record, "NoteID") || "";

  return [businessAccountId, rawId, noteId]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function buildUpdatedAttributes(record, targetRegion) {
  const attributes =
    record && typeof record === "object" && Array.isArray(record.Attributes)
      ? record.Attributes
      : [];

  let hasRegion = false;
  const nextAttributes = attributes.map((attribute) => {
    const attributeId = readWrappedString(attribute, "AttributeID");
    if (attributeId !== "REGION") {
      return attribute;
    }

    hasRegion = true;
    return {
      ...(attribute && typeof attribute === "object" ? attribute : {}),
      AttributeID: {
        value: "REGION",
      },
      Value: {
        value: targetRegion,
      },
    };
  });

  if (!hasRegion) {
    nextAttributes.push({
      AttributeID: {
        value: "REGION",
      },
      Value: {
        value: targetRegion,
      },
    });
  }

  return nextAttributes;
}

function buildUpdatePayload(record, decision) {
  const payload = {
    ...buildBusinessAccountIdentityPayload(record),
  };

  if (decision.changedClass) {
    payload.ClassID = {
      value: decision.targetClassId,
    };
  }

  if (decision.changedRegion) {
    payload.Attributes = buildUpdatedAttributes(record, decision.targetRegion);
  }

  return payload;
}

async function fetchAllBusinessAccounts(config, cookieHeader) {
  const rows = [];
  const expand = "Attributes,MainAddress";

  for (let skip = 0; ; skip += 200) {
    const payload = await requestAcumaticaJson(
      config,
      cookieHeader,
      buildBusinessAccountCollectionPath({
        top: 200,
        skip,
        expand,
      }),
      {},
      `fetching business accounts page ${skip / 200 + 1}`,
    );

    const pageRows = unwrapCollection(payload);
    if (pageRows.length === 0) {
      break;
    }

    rows.push(...pageRows);
    if (pageRows.length < 200) {
      break;
    }
  }

  const deduped = new Map();
  for (const row of rows) {
    const identity =
      readRecordIdentity(row) || readBusinessAccountId(row) || readBusinessAccountName(row) || "";
    if (!identity || deduped.has(identity)) {
      continue;
    }
    deduped.set(identity, row);
  }

  return [...deduped.values()];
}

async function fetchBusinessAccountByIdentifier(config, cookieHeader, record) {
  const identifiers = buildUpdateIdentifiers(record);

  for (const identifier of identifiers) {
    try {
      return await requestAcumaticaJson(
        config,
        cookieHeader,
        buildBusinessAccountByIdPath(identifier, "Attributes,MainAddress"),
        {},
        `fetching business account ${identifier}`,
      );
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
    }
  }

  throw new Error(
    `Unable to refetch business account ${readBusinessAccountId(record) || readRecordIdentity(record) || "unknown"}.`,
  );
}

async function updateBusinessAccount(config, cookieHeader, record, payload) {
  const identifiers = buildUpdateIdentifiers(record);
  const pathErrors = [];

  for (const identifier of identifiers) {
    try {
      await requestAcumaticaJson(
        config,
        cookieHeader,
        `BusinessAccount/${encodeURIComponent(identifier)}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
        `updating business account ${identifier}`,
      );
      return;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        throw error;
      }

      pathErrors.push({
        identifier,
        status: error instanceof HttpError ? error.status : null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const bodyAttempts = [payload];
  for (const identifier of identifiers) {
    bodyAttempts.push({
      ...payload,
      BusinessAccountID: { value: identifier },
    });
    bodyAttempts.push({
      ...payload,
      BAccountID: { value: identifier },
    });
    bodyAttempts.push({
      ...payload,
      NoteID: { value: identifier },
    });
    bodyAttempts.push({
      ...payload,
      id: identifier,
    });
  }

  const seenFingerprints = new Set();
  let lastError = null;
  for (const body of bodyAttempts) {
    const fingerprint = JSON.stringify(body);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);

    try {
      await requestAcumaticaJson(
        config,
        cookieHeader,
        "BusinessAccount",
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
        `updating business account ${readBusinessAccountId(record) || readRecordIdentity(record) || "unknown"}`,
      );
      return;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw new Error(
    JSON.stringify({
      message:
        lastError instanceof Error
          ? lastError.message
          : "Failed to update business account.",
      attempts: pathErrors,
    }),
  );
}

function buildDecision(record, exactRegionLookup, precedence, profiles) {
  const classDecision = resolveBusinessAccountClassDecision(record);
  const currentClassId = readWrappedString(record, "ClassID");
  const currentRegion = normalizeRegionValue(readAttributeValue(record, "REGION"));

  if (classDecision.skip) {
    return {
      skip: true,
      skippedReason: classDecision.skippedReason,
      currentClassId,
      targetClassId: null,
      currentRegion,
      targetRegion: null,
      regionSource: null,
      fsa: normalizePostalCodeFsa(readAddressField(record, "PostalCode")),
      changedClass: false,
      changedRegion: false,
    };
  }

  const regionResolution = resolveTargetRegion(record, exactRegionLookup, precedence, profiles);
  const targetRegion = canonicalRegionValue(regionResolution.region);
  const targetClassId = classDecision.targetClassId;

  return {
    skip: false,
    skippedReason: null,
    currentClassId,
    targetClassId,
    currentRegion,
    targetRegion,
    regionSource: regionResolution.source,
    fsa: regionResolution.fsa,
    changedClass: normalizeComparable(currentClassId) !== normalizeComparable(targetClassId),
    changedRegion: canonicalRegionValue(currentRegion) !== canonicalRegionValue(targetRegion),
  };
}

function shouldIncludeRecord(record, selectedIds) {
  if (selectedIds.length === 0) {
    return true;
  }

  const candidates = [
    readBusinessAccountId(record),
    readRecordIdentity(record),
    readWrappedString(record, "NoteID"),
  ]
    .filter(Boolean)
    .map((value) => value.trim().toLowerCase());

  return selectedIds.some((value) => candidates.includes(value));
}

function buildReportEntry(record, decision) {
  return {
    recordId: readRecordIdentity(record),
    businessAccountId: readBusinessAccountId(record),
    companyName: readBusinessAccountName(record),
    type:
      readWrappedString(record, "Type") ||
      readWrappedString(record, "TypeDescription"),
    status: readWrappedString(record, "Status"),
    currentClassId: decision.currentClassId,
    targetClassId: decision.targetClassId,
    currentRegion: decision.currentRegion,
    targetRegion: decision.targetRegion,
    regionSource: decision.regionSource,
    postalCode: readAddressField(record, "PostalCode"),
    fsa: decision.fsa,
    city: readAddressField(record, "City"),
    state: readAddressField(record, "State"),
    salesRepId: readWrappedString(record, "Owner"),
    salesRepName: readWrappedString(record, "OwnerEmployeeName"),
    changedClass: decision.changedClass,
    changedRegion: decision.changedRegion,
    skippedReason: decision.skippedReason,
    error: null,
  };
}

function maybeWriteProgressCheckpoint(filePath, report, processedCount, force = false) {
  if (!force && processedCount % CHECKPOINT_EVERY !== 0) {
    return;
  }

  writeReportCheckpoint(filePath, report);
}

function isRecoverableApplyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /session is invalid or expired/i.test(message) ||
    /unexpected content/i.test(message) ||
    /timed out after/i.test(message) ||
    /"status":401/i.test(message) ||
    /"status":403/i.test(message) ||
    /"status":502/i.test(message) ||
    /"status":503/i.test(message) ||
    /"status":504/i.test(message)
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const config = resolveConfig(options);
  assertConfig(config);
  ensureReportDirectory(config.reportFile);

  const startedAt = new Date().toISOString();
  const regionConfig = loadRegionConfig(config.regionConfigPath);
  const { lookup: exactRegionLookup, precedence } = buildExactRegionLookup(regionConfig);

  let cookieHeader = "";

  try {
    process.stdout.write("Logging into Acumatica...\n");
    cookieHeader = await loginToAcumatica(config);

    process.stdout.write("Fetching business accounts...\n");
    const allRows = await fetchAllBusinessAccounts(config, cookieHeader);
    const profileRows = allRows.filter((record) => {
      const decision = resolveBusinessAccountClassDecision(record);
      return !decision.skip;
    });
    const profiles = buildRegionProfiles(profileRows, exactRegionLookup, precedence);
    const selectedIds = options.businessAccountIds.map((value) => value.trim().toLowerCase());
    let candidateRows = allRows.filter((row) => shouldIncludeRecord(row, selectedIds));
    if (options.limit) {
      candidateRows = candidateRows.slice(0, options.limit);
    }

    const report = {
      startedAt,
      completedAt: null,
      apply: options.apply,
      status: "running",
      progress: {
        processed: 0,
        total: candidateRows.length,
        lastBusinessAccountId: null,
      },
      totals: {
        scanned: candidateRows.length,
        inScope: 0,
        skipped: 0,
        skippedVendors: 0,
        unchanged: 0,
        updated: 0,
        failed: 0,
      },
      regionSourceCounts: {
        exact_fsa: 0,
        city_fallback: 0,
        sales_rep_fallback: 0,
        global_fallback: 0,
      },
      classCounts: {
        CUSTOMER: 0,
        LEAD: 0,
      },
      skippedVendorCount: 0,
      unchangedCount: 0,
      updatedCount: 0,
      failedCount: 0,
      accounts: [],
    };

    let processedCount = 0;

    for (const [index, record] of candidateRows.entries()) {
      const decision = buildDecision(record, exactRegionLookup, precedence, profiles);
      const entry = buildReportEntry(record, decision);
      const recordLabel =
        entry.businessAccountId || entry.recordId || entry.companyName || `row-${index + 1}`;

      report.progress.processed = index + 1;
      report.progress.lastBusinessAccountId = entry.businessAccountId || entry.recordId || null;

      if (decision.skip) {
        report.totals.skipped += 1;
        if (decision.skippedReason === "vendor") {
          report.totals.skippedVendors += 1;
          report.skippedVendorCount += 1;
        }
        report.accounts.push(entry);
        processedCount += 1;
        maybeWriteProgressCheckpoint(config.reportFile, report, processedCount);
        continue;
      }

      report.totals.inScope += 1;
      report.classCounts[decision.targetClassId] += 1;
      report.regionSourceCounts[decision.regionSource] += 1;

      if (!decision.changedClass && !decision.changedRegion) {
        report.totals.unchanged += 1;
        report.unchangedCount += 1;
        report.accounts.push(entry);
        processedCount += 1;
        maybeWriteProgressCheckpoint(config.reportFile, report, processedCount);
        continue;
      }

      if (!options.apply) {
        report.totals.updated += 1;
        report.updatedCount += 1;
        report.accounts.push(entry);
        processedCount += 1;
        maybeWriteProgressCheckpoint(config.reportFile, report, processedCount);
        continue;
      }

      try {
        process.stdout.write(
          `Updating [${index + 1}/${candidateRows.length}] ${recordLabel} -> class ${decision.targetClassId}${decision.changedRegion ? `, region ${decision.targetRegion}` : ""}\n`,
        );
        const payload = buildUpdatePayload(record, decision);
        let verified = null;
        let lastApplyError = null;

        for (let applyAttempt = 1; applyAttempt <= 2; applyAttempt += 1) {
          try {
            await updateBusinessAccount(config, cookieHeader, record, payload);
            verified = await fetchBusinessAccountByIdentifier(config, cookieHeader, record);
            lastApplyError = null;
            break;
          } catch (error) {
            lastApplyError = error;
            if (applyAttempt >= 2 || !isRecoverableApplyError(error)) {
              throw error;
            }

            process.stdout.write(
              `Recoverable Acumatica session/proxy error for ${recordLabel}. Refreshing session and retrying once...\n`,
            );
            if (cookieHeader) {
              await logoutAcumatica(config, cookieHeader);
            }
            cookieHeader = await loginToAcumatica(config);
          }
        }

        if (!verified) {
          throw lastApplyError || new Error(`Verification fetch did not complete for ${recordLabel}.`);
        }

        const verifiedClassId = readWrappedString(verified, "ClassID");
        const verifiedRegion = normalizeRegionValue(readAttributeValue(verified, "REGION"));

        if (
          normalizeComparable(verifiedClassId) !== normalizeComparable(decision.targetClassId) ||
          canonicalRegionValue(verifiedRegion) !== canonicalRegionValue(decision.targetRegion)
        ) {
          throw new Error(
            `Verification failed. Expected class ${decision.targetClassId} and region ${decision.targetRegion}; got class ${verifiedClassId || "<empty>"} and region ${verifiedRegion || "<empty>"}.`,
          );
        }

        report.totals.updated += 1;
        report.updatedCount += 1;
        report.accounts.push(entry);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        report.totals.failed += 1;
        report.failedCount += 1;
        report.accounts.push(entry);
      }

      processedCount += 1;
      maybeWriteProgressCheckpoint(config.reportFile, report, processedCount);
    }

    report.completedAt = new Date().toISOString();
    report.status = "complete";
    maybeWriteProgressCheckpoint(config.reportFile, report, processedCount, true);

    process.stdout.write(
      [
        "",
        `Scanned: ${report.totals.scanned}`,
        `In scope: ${report.totals.inScope}`,
        `Skipped vendors: ${report.skippedVendorCount}`,
        `Unchanged: ${report.unchangedCount}`,
        `${options.apply ? "Updated" : "Would update"}: ${report.updatedCount}`,
        `Failed: ${report.failedCount}`,
        `Report: ${config.reportFile}`,
        "",
      ].join("\n"),
    );

    if (report.failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (cookieHeader) {
      await logoutAcumatica(config, cookieHeader);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
