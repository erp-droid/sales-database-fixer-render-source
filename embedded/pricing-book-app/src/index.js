import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { AcumaticaAuthExpiredError, AcumaticaClient, AcumaticaValidationError } from "./acumatica.js";
import {
  generateQuoteDescriptionWithAI,
  generatePrototypeEstimateWithAI,
  generateTaskPlanWithAI,
  polishQuoteBodyWithAI,
  validateQuoteWithAI
} from "./ai.js";
import {
  getHistoricalEstimateLibraryStatus,
  listHistoricalEstimateLibraryReviews,
  recordHistoricalEstimateFeedback,
  runHistoricalEstimateLibrarySync,
  startHistoricalEstimateLibraryAutoSync,
  suggestHistoricalEstimateMatches
} from "./estimateLibrary.js";
import {
  applyStructuredPricingBookWorkbook,
  buildPricingBookMainEstimate,
  buildPricingBookScopeSections,
  buildPricingBookSeedRows
} from "./pricingBookWorkbook.js";
import { loadPricingBookEstimatorCatalog } from "./estimators.js";
import { renderQuoteBackupPdfFromGoogleDoc } from "./quoteDocTemplate.js";
import { renderQuoteBackupPdf } from "./quotePdfTemplate.js";
import { loadTemplates, pickTemplateItem } from "./templates.js";
import { buildQuoteBackupSummary, buildQuoteDescription, buildQuoteScopeNote, buildTasksAndLines, buildQuoteSummary, normalizeDivisionId } from "./quoteBuilder.js";
import { mailRouter } from "./mail/router.js";

const app = express();
app.use(express.json({ limit: "30mb" }));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
app.use((req, res, next) => {
  const requestPath = cleanString(req.path || "");
  if (!requestPath.startsWith("/api/") && /\.(?:html|js|css)$/i.test(requestPath || "/")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  next();
});
app.use(express.static(publicDir, {
  index: false,
  setHeaders: (res, filePath) => {
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    }
  }
}));
app.use("/api/mail", mailRouter);

const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const AUTH_TOKEN_NAMESPACE = "acu";
const AUTH_TOKEN_VERSION = "v2";
const SHARED_ACUMATICA_MODE = !["0", "false", "no", "off"].includes(
  String(process.env.ACU_SHARED_SESSION_MODE || "true")
    .trim()
    .toLowerCase()
);
const AUTH_TOKEN_SECRET = String(
  process.env.AUTH_TOKEN_SECRET ||
    process.env.ACU_AUTH_TOKEN_SECRET ||
    config.openaiApiKey ||
    "pricing-book-app-shared-token-secret"
);
const INTEGRATED_AUTH_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.MBQ_INTEGRATED_AUTH_ENABLED || "true")
    .trim()
    .toLowerCase()
);
const INTEGRATED_AUTH_COOKIE_NAME = cleanString(process.env.AUTH_COOKIE_NAME || ".ASPXAUTH") || ".ASPXAUTH";
const INTEGRATED_LOGIN_NAME_COOKIE = cleanString(process.env.MBQ_LOGIN_NAME_COOKIE || "mb_login_name") || "mb_login_name";
const INTEGRATED_SIGNIN_PATH = cleanString(process.env.MBQ_SIGNIN_PATH || "/signin") || "/signin";
const INTEGRATED_QUOTES_PATH = cleanString(process.env.MBQ_BASE_PATH || "/quotes") || "/quotes";
const INTEGRATED_COOKIE_JAR_PREFIX = "v1.";
const DEFAULT_LINK_TO_DRIVE_TEXT = "Made using MB Quoting Page";
const DEFAULT_ACCOUNT_PROVINCE = "ON";
const DEFAULT_ACCOUNT_COUNTRY = "CA";
const CANADIAN_POSTAL_CODE_REGEX = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
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
const SHARED_ACUMATICA_CLIENT = new AcumaticaClient(config.acumatica);
const BUSINESS_ACCOUNTS_CACHE_TTL_MS = parsePositiveInt(
  process.env.BUSINESS_ACCOUNTS_CACHE_TTL_MS,
  30 * 60 * 1000,
  24 * 60 * 60 * 1000
);
const BUSINESS_ACCOUNTS_CACHE = new Map();

class AcumaticaUpstreamError extends Error {
  constructor(step, cause) {
    const message = cause instanceof Error ? cause.message : String(cause || "Unknown upstream error");
    super(message);
    this.name = "AcumaticaUpstreamError";
    this.step = step;
    const isLoginLimit = /login limit reached|concurrent api login/i.test(message);
    this.status = isLoginLimit ? 503 : 502;
    this.code = isLoginLimit ? "ACUMATICA_LOGIN_LIMIT" : "ACUMATICA_UPSTREAM_ERROR";
  }
}

class ApiAuthError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.name = "ApiAuthError";
    this.code = code;
    this.status = status;
  }
}

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text;
}

function parseCookieHeader(headerValue) {
  const pairs = String(headerValue || "")
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const cookies = {};
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) continue;
    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) continue;
    cookies[name] = value;
  }
  return cookies;
}

function getRequestCookie(req, cookieName) {
  const cookies = parseCookieHeader(req?.headers?.cookie || req?.get?.("cookie"));
  return cleanString(cookies?.[cookieName]);
}

function cleanFieldValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    if ("value" in value) {
      return cleanString(value.value);
    }
    return "";
  }
  return cleanString(value);
}

function normalizeCanadianPostalCode(value) {
  const compact = cleanString(value)
    .toUpperCase()
    .replace(/[\s-]+/g, "");
  if (compact.length !== 6) return cleanString(value).toUpperCase();
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function isValidCanadianPostalCode(value) {
  return CANADIAN_POSTAL_CODE_REGEX.test(cleanString(value));
}

function extractBearerToken(req) {
  const authHeader = cleanString(req.get("authorization"));
  if (!authHeader) return "";
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token) return "";
  if (scheme.toLowerCase() !== "bearer") return "";
  return cleanString(token);
}

function base64UrlEncode(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function buildIntegratedCookieHeader(storedValue) {
  const raw = cleanString(storedValue);
  if (!raw) return "";
  if (!raw.startsWith(INTEGRATED_COOKIE_JAR_PREFIX)) {
    return `${INTEGRATED_AUTH_COOKIE_NAME}=${raw}`;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(raw.slice(INTEGRATED_COOKIE_JAR_PREFIX.length)));
    if (!payload || typeof payload !== "object") return "";
    return Object.entries(payload)
      .map(([name, value]) => [cleanString(name), cleanString(value)])
      .filter(([name, value]) => name && value)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  } catch (_error) {
    return "";
  }
}

function resolveIntegratedSession(req) {
  if (!INTEGRATED_AUTH_ENABLED) return null;
  const storedCookieValue = getRequestCookie(req, INTEGRATED_AUTH_COOKIE_NAME);
  if (!storedCookieValue) return null;
  const cookieHeader = buildIntegratedCookieHeader(storedCookieValue);
  if (!cookieHeader) return null;
  return {
    username: getRequestCookie(req, INTEGRATED_LOGIN_NAME_COOKIE) || "Signed in user",
    company: config.acumatica.company,
    cookie: cookieHeader,
    mode: "integrated"
  };
}

function signAuthPayload(encodedPayload) {
  return crypto.createHmac("sha256", AUTH_TOKEN_SECRET).update(encodedPayload).digest("base64url");
}

function safeTokenEquals(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createAuthToken({ username, company, cookie = "", mode = "shared" }) {
  const normalizedMode = cleanString(mode).toLowerCase() === "user" ? "user" : "shared";
  const payload = {
    sub: cleanString(username),
    company: cleanString(company || config.acumatica.company),
    mode: normalizedMode,
    exp: Date.now() + AUTH_SESSION_TTL_MS
  };
  if (normalizedMode === "user") {
    payload.cookie = cleanString(cookie);
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signAuthPayload(encodedPayload);
  return `${AUTH_TOKEN_NAMESPACE}.${AUTH_TOKEN_VERSION}.${encodedPayload}.${signature}`;
}

function decodeAuthToken(token, options = {}) {
  const allowExpired = Boolean(options.allowExpired);
  const raw = cleanString(token);
  const segments = raw.split(".");
  if (segments.length !== 4) {
    throw new ApiAuthError("AUTH_REQUIRED", "Your Acumatica session is invalid. Sign in again.");
  }

  const [namespace, version, encodedPayload, signature] = segments;
  if (namespace !== AUTH_TOKEN_NAMESPACE || version !== AUTH_TOKEN_VERSION) {
    throw new ApiAuthError("AUTH_REQUIRED", "Your Acumatica session is invalid. Sign in again.");
  }

  const expectedSignature = signAuthPayload(encodedPayload);
  if (!safeTokenEquals(signature, expectedSignature)) {
    throw new ApiAuthError("AUTH_REQUIRED", "Your Acumatica session is invalid. Sign in again.");
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (_error) {
    throw new ApiAuthError("AUTH_REQUIRED", "Your Acumatica session is invalid. Sign in again.");
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiAuthError("AUTH_REQUIRED", "Your Acumatica session is invalid. Sign in again.");
  }

  const expiresAt = Number(payload.exp);
  if (!Number.isFinite(expiresAt) || (expiresAt <= Date.now() && !allowExpired)) {
    throw new ApiAuthError("AUTH_EXPIRED", "Your Acumatica session expired. Sign in again.");
  }

  return payload;
}

function buildClientFromTokenPayload(payload) {
  const cookie = cleanString(payload?.cookie);
  if (!cookie) {
    throw new ApiAuthError("AUTH_EXPIRED", "Your Acumatica session expired. Sign in again.");
  }

  const client = new AcumaticaClient({
    ...config.acumatica,
    username: "",
    password: ""
  });
  client.cookie = cookie;
  return client;
}

function getSharedAcumaticaClient() {
  const username = cleanString(config.acumatica.username);
  const password = cleanString(config.acumatica.password);
  if (!username || !password) {
    throw new ApiAuthError(
      "SERVICE_ACCOUNT_NOT_CONFIGURED",
      "Shared Acumatica service account is not configured on the backend.",
      500
    );
  }
  return SHARED_ACUMATICA_CLIENT;
}

function requireAcumaticaClient(req) {
  const token = extractBearerToken(req);
  if (!token) {
    const integratedSession = resolveIntegratedSession(req);
    if (!integratedSession) {
      throw new ApiAuthError("AUTH_REQUIRED", "Sign in to the quoting app before using this API.");
    }
    const client = new AcumaticaClient({
      ...config.acumatica,
      username: "",
      password: ""
    });
    client.cookie = integratedSession.cookie;
    return client;
  }
  const payload = decodeAuthToken(token);
  const tokenMode = cleanString(payload?.mode).toLowerCase();
  if (tokenMode === "shared") {
    return getSharedAcumaticaClient();
  }
  return buildClientFromTokenPayload(payload);
}

function requireAppSession(req) {
  const token = extractBearerToken(req);
  if (!token) {
    const integratedSession = resolveIntegratedSession(req);
    if (!integratedSession) {
      throw new ApiAuthError("AUTH_REQUIRED", "Sign in to the quoting app before using this API.");
    }
    return integratedSession;
  }
  return decodeAuthToken(token);
}

function isRefreshQueryEnabled(raw) {
  const value = cleanString(raw).toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(value);
}

function buildBusinessAccountsCacheKey(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return `shared:${cleanString(config.acumatica.company) || "default"}`;
  }
  try {
    const payload = decodeAuthToken(token);
    const mode = cleanString(payload?.mode).toLowerCase() || (SHARED_ACUMATICA_MODE ? "shared" : "user");
    const subject = cleanString(payload?.sub) || "unknown";
    const company = cleanString(payload?.company || config.acumatica.company) || "default";
    return `${mode}:${company}:${subject}`;
  } catch (_error) {
    return `token:${crypto.createHash("sha1").update(token).digest("hex").slice(0, 16)}`;
  }
}

function getBusinessAccountsCacheEntry(cacheKey) {
  const key = cleanString(cacheKey);
  if (!key) return null;
  const entry = BUSINESS_ACCOUNTS_CACHE.get(key);
  if (!entry) return null;
  const ageMs = Date.now() - parseNumber(entry.savedAt, 0);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > BUSINESS_ACCOUNTS_CACHE_TTL_MS) {
    BUSINESS_ACCOUNTS_CACHE.delete(key);
    return null;
  }
  return entry;
}

function setBusinessAccountsCacheEntry(cacheKey, items) {
  const key = cleanString(cacheKey);
  if (!key) return;
  BUSINESS_ACCOUNTS_CACHE.set(key, {
    savedAt: Date.now(),
    items: Array.isArray(items) ? items : []
  });
}

function normalizeDivision(raw) {
  const materialLines = raw.materialLines || raw.materials?.lines || raw.materials || [];
  const subcontractorLines = raw.subcontractorLines || raw.subcontractor?.lines || raw.subcontractor || [];
  const scopeLines = Array.isArray(raw.scopeLines)
    ? raw.scopeLines
        .map((line, index) => ({
          scopeLineKey: cleanString(line?.scopeLineKey || `scope-line-${index + 1}`),
          lineNumber: cleanString(line?.lineNumber || String(index + 1)),
          sourceText: cleanString(line?.sourceText || line?.text),
          normalizedText: cleanString(line?.normalizedText || line?.sourceText || line?.text)
        }))
        .filter((line) => line.sourceText)
    : [];

  const normalized = {
    sectionId: cleanString(raw.sectionId || raw.sectionID || raw.section),
    id: raw.id || raw.division || raw.title,
    title: raw.title || "",
    scope: raw.scope || "",
    estimatorId: cleanString(
      raw.estimatorId ||
        raw.estimator ||
        raw.templateEstimator ||
        raw.templateMapping?.estimator
    ),
    estimator: cleanString(
      raw.estimator ||
        raw.estimatorId ||
        raw.templateEstimator ||
        raw.templateMapping?.estimator
    ),
    estimatorName: cleanString(raw.estimatorName),
    scopeLines,
    isSelected: raw.isSelected !== false,
    templateMapping: {
      taskCd: cleanString(raw.templateMapping?.taskCd || raw.taskCd || raw.templateTaskCd),
      description: cleanString(raw.templateMapping?.description || raw.taskDescription || raw.templateDescription),
      taskType: cleanString(raw.templateMapping?.taskType || raw.templateTaskType),
      costCode: cleanString(raw.templateMapping?.costCode || raw.templateCostCode),
      revenueGroup: cleanString(raw.templateMapping?.revenueGroup || raw.templateRevenueGroup),
      taxCategory: cleanString(raw.templateMapping?.taxCategory || raw.templateTaxCategory),
      estimator: cleanString(raw.templateMapping?.estimator || raw.templateEstimator),
      labourUom: cleanString(raw.templateMapping?.labourUom || raw.templateLabourUom),
      materialUom: cleanString(raw.templateMapping?.materialUom || raw.templateMaterialUom),
      subtradeUom: cleanString(raw.templateMapping?.subtradeUom || raw.templateSubtradeUom),
      plannedStartDate: cleanString(raw.templateMapping?.plannedStartDate || raw.templatePlannedStartDate),
      plannedEndDate: cleanString(raw.templateMapping?.plannedEndDate || raw.templatePlannedEndDate),
      costRate: cleanString(raw.templateMapping?.costRate || raw.templateCostRate),
      sellRate: cleanString(raw.templateMapping?.sellRate || raw.templateSellRate)
    },
    labour: raw.labour || {
      noCost: raw.labourNoCost || false,
      technicianHours: raw.technicianHours,
      technicianRate: raw.technicianRate,
      technicianSellingPrice: raw.technicianSellingPrice,
      technicianNotApplicable: raw.technicianNotApplicable,
      supervisionHours: raw.supervisionHours,
      supervisionRate: raw.supervisionRate,
      supervisionSellingPrice: raw.supervisionSellingPrice,
      supervisionNotApplicable: raw.supervisionNotApplicable,
      engineerHours: raw.engineerHours,
      engineerRate: raw.engineerRate,
      engineerSellingPrice: raw.engineerSellingPrice,
      seniorEngineerHours: raw.seniorEngineerHours,
      seniorEngineerRate: raw.seniorEngineerRate,
      seniorEngineerSellingPrice: raw.seniorEngineerSellingPrice,
      projectManagerHours: raw.projectManagerHours,
      projectManagerRate: raw.projectManagerRate,
      projectManagerSellingPrice: raw.projectManagerSellingPrice
    },
    materials: {
      noCost: raw.materialNoCost || raw.materials?.noCost || false,
      lines: materialLines
    },
    subcontractor: {
      noCost: raw.subcontractorNoCost || raw.subcontractor?.noCost || false,
      lines: subcontractorLines
    }
  };

  if (normalizeDivisionId(normalized.id || normalized.title) === "glendale") {
    normalized.materials.noCost = true;
    normalized.materials.lines = [];
  }

  return normalized;
}

function normalizeAccount(raw = {}) {
  return {
    ...raw,
    name: cleanFieldValue(raw.name || raw.displayName),
    contactName: cleanFieldValue(raw.contactName || raw.contact || raw.ContactName),
    owner: cleanFieldValue(
      raw.owner || raw.ownerEmployeeName || raw.ownerName || raw.OwnerEmployeeName || raw.OwnerName || raw.Owner
    ),
    businessAccountId: cleanFieldValue(raw.businessAccountId || raw.businessAccount || raw.businessAccountCd || raw.BusinessAccountID),
    contactId: cleanFieldValue(raw.contactId || raw.contactID || raw.ContactID),
    location: cleanFieldValue(raw.location || raw.locationId || raw.locationCd || raw.Location)
  };
}

function normalizeOpportunity(raw = {}) {
  return {
    willWinJob: cleanString(
      raw.willWinJob ||
        raw.winJob ||
        raw.winProbability ||
        raw.doYouThinkWeAreGoingToWinThisJob
    ),
    linkToDrive: cleanString(raw.linkToDrive || raw.driveLink || raw.backupLink || DEFAULT_LINK_TO_DRIVE_TEXT),
    projectType: cleanString(raw.projectType)
  };
}

function normalizeOwnerLookupValue(value) {
  return cleanFieldValue(value).toLowerCase();
}

function compactOwnerLookupValue(value) {
  return normalizeOwnerLookupValue(value).replace(/[^a-z0-9]/g, "");
}

function buildOwnerLookupVariants(value) {
  const raw = normalizeOwnerLookupValue(value);
  const variants = new Set();
  if (!raw) return variants;
  variants.add(raw);
  const compact = compactOwnerLookupValue(raw);
  if (compact) variants.add(compact);
  const nameParts = raw
    .split(/[\s._-]+/)
    .map((part) => cleanFieldValue(part))
    .filter(Boolean);
  if (nameParts.length >= 2) {
    const firstInitialLastName = `${nameParts[0].slice(0, 1)}${nameParts[nameParts.length - 1]}`;
    const compactInitialLastName = compactOwnerLookupValue(firstInitialLastName);
    if (compactInitialLastName) variants.add(compactInitialLastName);
  }
  const atIndex = raw.indexOf("@");
  if (atIndex > 0) {
    const localPart = raw.slice(0, atIndex);
    variants.add(localPart);
    const compactLocalPart = compactOwnerLookupValue(localPart);
    if (compactLocalPart) variants.add(compactLocalPart);
  }
  return variants;
}

function isOpportunityOwnerNotFoundError(error) {
  const message = cleanFieldValue(error?.message).toLowerCase();
  return (
    message.includes("owner") &&
    (
      message.includes("cannot be found") ||
      message.includes("not found") ||
      message.includes("invalid owner")
    )
  );
}

async function resolveSignedInQuoteOwner({ req, acumatica, correlationId = "" } = {}) {
  let session;
  try {
    session = requireAppSession(req);
  } catch (_error) {
    return null;
  }

  const signedInUsername = cleanFieldValue(session?.sub || session?.username);
  if (!signedInUsername || /^signed in user$/i.test(signedInUsername)) {
    return null;
  }

  try {
    const employees = await withUpstreamStep("employee_list", () =>
      acumatica.listEmployees({ pageSize: 200, maxRecords: 5000 })
    );
    const requestedVariants = buildOwnerLookupVariants(signedInUsername);
    if (!requestedVariants.size) return null;

    const match = employees.find((employee) => {
      if (!cleanFieldValue(employee?.id) || employee?.isActive === false) {
        return false;
      }
      const employeeVariants = new Set([
        ...buildOwnerLookupVariants(employee?.id),
        ...buildOwnerLookupVariants(employee?.name),
        ...buildOwnerLookupVariants(employee?.email)
      ]);
      for (const candidate of requestedVariants) {
        if (employeeVariants.has(candidate)) {
          return true;
        }
      }
      return false;
    });

    if (!match) {
      console.warn(
        `[${correlationId}] Quote owner lookup did not find an active Acumatica employee for signed-in user "${signedInUsername}".`
      );
      return null;
    }

    return {
      username: signedInUsername,
      ownerId: cleanFieldValue(match.id),
      ownerName: cleanFieldValue(match.name || match.id)
    };
  } catch (error) {
    console.warn(
      `[${correlationId}] Quote owner lookup failed for signed-in user "${signedInUsername}": ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

function normalizeEstimatorConfig(raw = {}) {
  const conservativeness = Math.min(100, Math.max(0, parseNumber(raw.conservativeness, 100)));
  return {
    conservativeness,
    postureLabel: cleanString(raw.postureLabel || raw.posture),
    country: cleanString(raw.country || "CA") || "CA",
    currency: cleanString(raw.currency || "CAD") || "CAD",
    labourModel: cleanString(raw.labourModel || "")
  };
}

function normalizePayload(body) {
  const divisions = Array.isArray(body.divisions) ? body.divisions.map(normalizeDivision) : [];
  const opportunity = normalizeOpportunity(body.opportunity || body);
  return {
    quoteType: body.quoteType,
    existingOpportunityId: cleanString(body.existingOpportunityId),
    account: normalizeAccount(body.account || {}),
    opportunity,
    divisions: divisions.filter((division) => division.isSelected),
    reviewConfirmation: {
      confirmed: Boolean(body?.reviewConfirmation?.confirmed),
      signerName: cleanString(body?.reviewConfirmation?.signerName),
      statement: cleanString(body?.reviewConfirmation?.statement),
      confirmedAt: cleanString(body?.reviewConfirmation?.confirmedAt)
    }
  };
}

async function withUpstreamStep(step, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AcumaticaAuthExpiredError) {
      throw new ApiAuthError("AUTH_EXPIRED", error.message, 401);
    }
    if (error instanceof AcumaticaValidationError || error instanceof AcumaticaUpstreamError || error instanceof ApiAuthError) {
      throw error;
    }
    throw new AcumaticaUpstreamError(step, error);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function resolveQuoteMode(payload) {
  const quoteType = cleanString(payload?.quoteType).toLowerCase();
  const hasGlendaleDivision = (payload?.divisions || []).some(
    (division) => normalizeDivisionId(division?.id || division?.title) === "glendale"
  );
  if (quoteType === "glendale" || hasGlendaleDivision) return "glendale";
  if (quoteType === "service") return "service";
  return "production";
}

function resolveQuoteTypeFromOpportunityContext(opportunity = {}) {
  const branch = cleanFieldValue(opportunity?.branch).toLowerCase();
  if (branch.includes("service")) return "service";
  if (branch.includes("glendale")) return "glendale";
  if (branch.includes("production") || branch.includes("construction")) return "production";

  const classId = cleanFieldValue(opportunity?.classId).toLowerCase();
  if (classId.includes("service")) return "service";
  if (classId.includes("glendale")) return "glendale";
  if (classId) return "production";

  return "";
}

function buildOpportunityContextValidationMessage(opportunityId, reasons = []) {
  const cleanedReasons = reasons.map((reason) => cleanString(reason)).filter(Boolean);
  const prefix = cleanString(opportunityId)
    ? `Opportunity ${cleanString(opportunityId)} is missing required quote-generator data.`
    : "The selected opportunity is missing required quote-generator data.";
  if (!cleanedReasons.length) {
    return prefix;
  }
  return `${prefix} ${cleanedReasons.join(" ")}`;
}

async function loadExistingOpportunityContext({ acumatica, opportunityId } = {}) {
  const normalizedOpportunityId = cleanString(opportunityId);
  if (!normalizedOpportunityId) {
    throw new AcumaticaValidationError(
      "OPPORTUNITY_ID_REQUIRED",
      "Opportunity ID is required to launch the quote generator.",
      { validationErrors: ["Opportunity ID is required."] }
    );
  }

  const opportunity = await withUpstreamStep("opportunity_lookup", () =>
    acumatica.getOpportunityById(normalizedOpportunityId)
  );

  if (!opportunity?.id) {
    throw new AcumaticaValidationError(
      "OPPORTUNITY_NOT_FOUND",
      `Opportunity ${normalizedOpportunityId} was not found.`,
      {
        opportunityId: normalizedOpportunityId,
        validationErrors: [`Opportunity ${normalizedOpportunityId} was not found.`]
      }
    );
  }

  const businessAccountId = cleanFieldValue(opportunity.businessAccountId);
  const contactId = cleanFieldValue(opportunity.contactId);
  const quoteType = resolveQuoteTypeFromOpportunityContext(opportunity);
  const validationErrors = [];

  if (!businessAccountId) {
    validationErrors.push("Business account is missing.");
  }
  if (!contactId) {
    validationErrors.push("Contact is missing.");
  }
  if (!quoteType) {
    validationErrors.push("Department could not be resolved from Branch or Opportunity Class.");
  }

  if (validationErrors.length) {
    throw new AcumaticaValidationError(
      "OPPORTUNITY_CONTEXT_INVALID",
      buildOpportunityContextValidationMessage(opportunity.id || normalizedOpportunityId, validationErrors),
      {
        opportunityId: cleanString(opportunity.id || normalizedOpportunityId),
        validationErrors
      }
    );
  }

  let businessAccount = null;
  try {
    businessAccount = await withUpstreamStep("opportunity_business_account_lookup", () =>
      acumatica.getBusinessAccountById(businessAccountId)
    );
  } catch (error) {
    console.warn(
      `[opportunity-context] Business account lookup warning for ${opportunity.id}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let contact = null;
  try {
    contact = await withUpstreamStep("opportunity_contact_lookup", () =>
      acumatica.getContactById(contactId, { businessAccountId })
    );
  } catch (error) {
    console.warn(
      `[opportunity-context] Contact lookup warning for ${opportunity.id}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const normalizedAccount = {
    businessAccountId,
    name: cleanFieldValue(businessAccount?.name || opportunity.businessAccountName || businessAccountId),
    owner: cleanFieldValue(businessAccount?.owner),
    location: cleanFieldValue(businessAccount?.location || opportunity.location),
    address: businessAccount?.address || undefined
  };

  const normalizedContact = {
    contactId,
    displayName: cleanFieldValue(contact?.displayName || opportunity.contactName || contactId),
    email: cleanFieldValue(contact?.email),
    phone: cleanFieldValue(contact?.phone),
    contactClass: cleanFieldValue(contact?.contactClass)
  };

  return {
    opportunityId: cleanFieldValue(opportunity.id || normalizedOpportunityId),
    subject: cleanFieldValue(opportunity.subject),
    description: cleanFieldValue(opportunity.note || opportunity.subject),
    branch: cleanFieldValue(opportunity.branch),
    classId: cleanFieldValue(opportunity.classId),
    stage: cleanFieldValue(opportunity.stage),
    owner: cleanFieldValue(opportunity.owner),
    location: cleanFieldValue(opportunity.location || normalizedAccount.location),
    quoteType,
    businessAccount: normalizedAccount,
    contact: normalizedContact,
    opportunity
  };
}

const VALID_PROJECT_TYPE_VALUES = new Set(["Construct", "Electrical", "HVAC", "M-Trade", "Plumbing"]);

function normalizeProjectTypeValue(raw, fallback = "M-Trade") {
  const fallbackValue = VALID_PROJECT_TYPE_VALUES.has(cleanString(fallback))
    ? cleanString(fallback)
    : "M-Trade";
  const value = cleanString(raw);
  if (!value) return fallbackValue;
  if (VALID_PROJECT_TYPE_VALUES.has(value)) return value;

  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["construct", "construction", "con"].includes(normalized)) return "Construct";
  if (["electrical", "electric", "elec", "ele"].includes(normalized)) return "Electrical";
  if (["hvac", "mechanical", "mech", "mec"].includes(normalized)) return "HVAC";
  if (["plumbing", "plumb", "plu"].includes(normalized)) return "Plumbing";
  if (["mtrade", "multitrade", "multi", "production", "service", "glendale"].includes(normalized)) {
    return "M-Trade";
  }

  return fallbackValue;
}

function resolveDefaultProjectType(payload) {
  const selectedDivisionIds = Array.from(
    new Set(
      (payload?.divisions || [])
        .map((division) => normalizeDivisionId(division?.id || division?.title))
        .filter(Boolean)
    )
  );

  if (selectedDivisionIds.length === 1) {
    const divisionId = selectedDivisionIds[0];
    if (divisionId === "construction") return "Construct";
    if (divisionId === "electrical") return "Electrical";
    if (divisionId === "hvac") return "HVAC";
    if (divisionId === "plumbing") return "Plumbing";
  }

  return "M-Trade";
}

function resolveProjectTypeFromPayload(payload) {
  const defaultProjectType = resolveDefaultProjectType(payload);
  const explicitProjectType = cleanString(payload?.opportunity?.projectType);
  if (explicitProjectType) {
    return normalizeProjectTypeValue(explicitProjectType, defaultProjectType);
  }

  const selectedDivisionIds = Array.from(
    new Set(
      (payload?.divisions || [])
        .map((division) => normalizeDivisionId(division?.id || division?.title))
        .filter(Boolean)
    )
  );

  const mappingByDivision = config.acumatica?.opportunity?.projectTypeByDivision || {};
  if (selectedDivisionIds.length === 1) {
    const divisionType = cleanString(mappingByDivision[selectedDivisionIds[0]]);
    if (divisionType) {
      return normalizeProjectTypeValue(divisionType, defaultProjectType);
    }
  }
  if (selectedDivisionIds.length > 1) {
    return normalizeProjectTypeValue(
      cleanString(config.acumatica?.opportunity?.multiTradeProjectType) || "M-Trade",
      defaultProjectType
    );
  }

  const mode = resolveQuoteMode(payload);
  const mappingByMode = config.acumatica?.opportunity?.projectTypeByMode || {};
  return normalizeProjectTypeValue(
    cleanString(mappingByMode[mode]) || "M-Trade",
    defaultProjectType
  );
}

function mergeAttributeLists(...lists) {
  const merged = new Map();
  const add = (item) => {
    if (!item || typeof item !== "object") return;
    const attributeId = cleanString(item.attributeId || item.AttributeID || item.id);
    const value = cleanString(item.value ?? item.Value ?? item.attributeValue);
    if (!attributeId || !value) return;
    merged.set(attributeId.toLowerCase(), { attributeId, value });
  };
  lists.flat().forEach(add);
  return Array.from(merged.values());
}

function buildRequiredOpportunityAttributes(payload) {
  const ids = config.acumatica?.opportunity?.requiredAttributeIds || {};
  const winJobAttributeId =
    cleanString(ids.winJob) || "Do you think we are going to win this job?";
  const linkToDriveAttributeId = cleanString(ids.linkToDrive) || "Link to Drive";
  const projectTypeAttributeId = cleanString(ids.projectType) || "Project Type";

  const willWinJob =
    cleanString(payload?.opportunity?.willWinJob) || "Yes";
  const linkToDrive = cleanString(payload?.opportunity?.linkToDrive || DEFAULT_LINK_TO_DRIVE_TEXT);
  const projectType = resolveProjectTypeFromPayload(payload);

  return [
    { attributeId: winJobAttributeId, value: willWinJob },
    { attributeId: linkToDriveAttributeId, value: linkToDrive },
    { attributeId: projectTypeAttributeId, value: projectType }
  ];
}

function validateRequiredOpportunityInputs(payload) {
  const errors = [];
  const businessAccountId = cleanString(payload?.account?.businessAccountId);
  const contactId = cleanString(payload?.account?.contactId);
  const winJob = cleanString(payload?.opportunity?.willWinJob).toLowerCase();
  const linkToDrive = cleanString(payload?.opportunity?.linkToDrive || DEFAULT_LINK_TO_DRIVE_TEXT);
  const projectType = cleanString(resolveProjectTypeFromPayload(payload));

  if (!businessAccountId) {
    errors.push("Business account is required.");
  }
  if (!contactId) {
    errors.push("Contact selection is required.");
  }
  if (!["yes", "no"].includes(winJob)) {
    errors.push("Do you think we are going to win this job? must be Yes or No.");
  }
  if (!linkToDrive) {
    errors.push("Link to Drive is required.");
  }
  if (!projectType) {
    errors.push("Project Type is required.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
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
    if (high > 0) return Math.max(low, high);
  }
  const parsed = parseNumber(token, Number.NaN);
  if (Number.isFinite(parsed)) return parsed;
  return null;
}

function extractMeasuredQuantityFromText(rawText = "") {
  const text = cleanString(rawText);
  if (!text) return null;
  const measuredPatterns = [
    /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square\s*feet|square\s*foot|sf)\b/i,
    /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i,
    /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:tonnes?|tons?|tne)\b/i,
    /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:linear\s*feet?|lineal\s*feet?|lin\.?\s*ft|lft)\b/i,
    /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:m3|cubic\s*meters?|cubic\s*metres?)\b/i,
    /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:y3|yd3|cubic\s*yards?)\b/i
  ];
  for (const regex of measuredPatterns) {
    const match = text.match(regex);
    if (!match?.[1]) continue;
    const quantity = parseNumber(match[1], 0);
    if (quantity > 0) return quantity;
  }

  const dimensionMatch = text.match(
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:x|×)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:'|ft|feet)?/i
  );
  if (dimensionMatch?.[1] && dimensionMatch?.[2]) {
    const width = parseNumber(dimensionMatch[1], 0);
    const height = parseNumber(dimensionMatch[2], 0);
    if (width > 0 && height > 0) {
      const countMatch = text.match(
        /\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:bay\s+|single\s+|man\s+|double\s+)?(?:doors?|windows?|panels?|units?)\b/i
      );
      const count = Math.max(1, parseNumericToken(countMatch?.[1]) || 1);
      const area = width * height * count;
      if (area > 0) return area;
    }
  }

  const numericTokenPattern =
    "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
  const countRegex = new RegExp(
    `\\b(${numericTokenPattern})(?:\\s*\\(\\s*(${numericTokenPattern})\\s*\\))?(?:\\s*(?:-|to|–|—)\\s*(${numericTokenPattern}))?\\s+(?:bay\\s+|single\\s+|man\\s+|double\\s+|existing\\s+|new\\s+|powered\\s+|static\\s+|mobile\\s+|double-powered\\s+|mechanically\\s+assisted\\s+)?(${COUNT_BASED_SCOPE_NOUN_PATTERN})\\b`,
    "i"
  );
  const countMatch = text.match(countRegex);
  if (countMatch) {
    const first = parseNumericToken(countMatch[1]);
    const parenthetical = parseNumericToken(countMatch[2]);
    const second = parseNumericToken(countMatch[3]);
    const quantity = Math.max(first || 0, parenthetical || 0, second || 0);
    if (quantity > 0) return quantity;
  }

  return null;
}

function splitScopeLinesForLint(scopeText = "") {
  return cleanString(scopeText)
    .replace(/\r\n/g, "\n")
    .split(/\r?\n+/)
    .map((line) => cleanString(line).replace(/^[-*•]\s*/, "").replace(/^\d+(?:\.\d+)*\.?\s*/, ""))
    .filter(Boolean);
}

function hasExplicitScopeMeasurement(text = "") {
  const source = cleanString(text);
  if (!source) return false;
  if (extractMeasuredQuantityFromText(source)) return true;
  if (/\b\d+(?:\.\d+)?\s*(?:each|ea|qty|nos?|no\.?)\b/i.test(source)) return true;
  if (
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i.test(
      source
    ) &&
    new RegExp(`\\b(${COUNT_BASED_SCOPE_NOUN_PATTERN})\\b`, "i").test(source)
  ) {
    return true;
  }
  return false;
}

function scopeLineNeedsMeasuredQuantity(line = "") {
  const text = cleanString(line);
  if (!text) return false;
  if (/\ballowance|lump sum|ls\b|tbd\b|to be confirmed\b/i.test(text)) return false;
  const hasActionVerb =
    /\b(remove|supply|install|replace|paint|repaint|repair|apply|seal|grade|compact|stripe|line painting|pave|demolish)\b/i.test(
      text
    );
  const hasQuantifiableObject =
    /\b(door|doors|window|windows|fixture|fixtures|light|lights|unit|units|panel|panels|pipe|pipes|wire|wiring|asphalt|concrete|gravel|paint|striping|lines?|stall|stalls|wall|walls|equipment)\b/i.test(
      text
    );
  if (!hasActionVerb || !hasQuantifiableObject) return false;
  return !hasExplicitScopeMeasurement(text);
}

function buildScopeLintForDivision(division = {}) {
  const blocking = [];
  const lines = splitScopeLinesForLint(division?.scope);
  lines.forEach((line) => {
    if (!scopeLineNeedsMeasuredQuantity(line)) return;
    blocking.push(`Scope line requires measurable quantity: "${line}"`);
  });
  return { blocking };
}

function hasMeaningfulCostLine(line = {}) {
  return (
    Boolean(cleanString(line?.description)) ||
    hasNumericInput(line?.quantity) ||
    hasNumericInput(line?.unitCost) ||
    hasNumericInput(line?.cost) ||
    hasNumericInput(line?.sellingPrice)
  );
}

function isCompleteCostLine(line = {}) {
  const description = cleanString(line?.description);
  const hasQuantity = hasNumericInput(line?.quantity);
  const hasUnitCost = hasNumericInput(line?.unitCost);
  const hasSellingPrice = hasNumericInput(line?.sellingPrice);
  const quantity = parseNumber(line?.quantity, Number.NaN);
  const unitCost = parseNumber(line?.unitCost, Number.NaN);
  const sellingPrice = parseNumber(line?.sellingPrice, Number.NaN);
  return (
    Boolean(description) &&
    hasQuantity &&
    hasUnitCost &&
    hasSellingPrice &&
    quantity > 0 &&
    unitCost >= 0 &&
    sellingPrice >= 0
  );
}

function validateDivisionCostInputs(payload) {
  const errors = [];
  const divisions = Array.isArray(payload?.divisions) ? payload.divisions : [];

  for (const division of divisions) {
    const divisionName = cleanString(division?.title || division?.id) || "Selected division";
    const isGlendale = normalizeDivisionId(division?.id || division?.title) === "glendale";
    const subcontractorLabel = isGlendale ? "consultant" : "subtrade";
    if (!cleanString(division?.scope)) {
      errors.push(`${divisionName} scope of work is required.`);
      continue;
    }
    const scopeLint = buildScopeLintForDivision(division);
    scopeLint.blocking.forEach((item) => {
      errors.push(`${divisionName} ${item}`);
    });

    const labour = division?.labour || {};
    if (!Boolean(labour?.noCost)) {
      const labourRows = isGlendale
        ? [
            {
              label: "design",
              hours: parseNumber(labour?.technicianHours, Number.NaN),
              costRate: parseNumber(labour?.technicianRate, Number.NaN),
              sellRate: parseNumber(labour?.technicianSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.technicianHours),
              hasCostRate: hasNumericInput(labour?.technicianRate),
              hasSellRate: hasNumericInput(labour?.technicianSellingPrice)
            },
            {
              label: "architect",
              hours: parseNumber(labour?.supervisionHours, Number.NaN),
              costRate: parseNumber(labour?.supervisionRate, Number.NaN),
              sellRate: parseNumber(labour?.supervisionSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.supervisionHours),
              hasCostRate: hasNumericInput(labour?.supervisionRate),
              hasSellRate: hasNumericInput(labour?.supervisionSellingPrice)
            },
            {
              label: "engineer",
              hours: parseNumber(labour?.engineerHours, Number.NaN),
              costRate: parseNumber(labour?.engineerRate, Number.NaN),
              sellRate: parseNumber(labour?.engineerSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.engineerHours),
              hasCostRate: hasNumericInput(labour?.engineerRate),
              hasSellRate: hasNumericInput(labour?.engineerSellingPrice)
            },
            {
              label: "sr. engineer",
              hours: parseNumber(labour?.seniorEngineerHours, Number.NaN),
              costRate: parseNumber(labour?.seniorEngineerRate, Number.NaN),
              sellRate: parseNumber(labour?.seniorEngineerSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.seniorEngineerHours),
              hasCostRate: hasNumericInput(labour?.seniorEngineerRate),
              hasSellRate: hasNumericInput(labour?.seniorEngineerSellingPrice)
            },
            {
              label: "project manager",
              hours: parseNumber(labour?.projectManagerHours, Number.NaN),
              costRate: parseNumber(labour?.projectManagerRate, Number.NaN),
              sellRate: parseNumber(labour?.projectManagerSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.projectManagerHours),
              hasCostRate: hasNumericInput(labour?.projectManagerRate),
              hasSellRate: hasNumericInput(labour?.projectManagerSellingPrice)
            }
          ]
        : [
            {
              label: "general labour",
              hours: parseNumber(labour?.technicianHours, Number.NaN),
              costRate: parseNumber(labour?.technicianRate, Number.NaN),
              sellRate: parseNumber(labour?.technicianSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.technicianHours),
              hasCostRate: hasNumericInput(labour?.technicianRate),
              hasSellRate: hasNumericInput(labour?.technicianSellingPrice)
            },
            {
              label: "supervision",
              hours: parseNumber(labour?.supervisionHours, Number.NaN),
              costRate: parseNumber(labour?.supervisionRate, Number.NaN),
              sellRate: parseNumber(labour?.supervisionSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.supervisionHours),
              hasCostRate: hasNumericInput(labour?.supervisionRate),
              hasSellRate: hasNumericInput(labour?.supervisionSellingPrice)
            },
            {
              label: "project manager",
              hours: parseNumber(labour?.projectManagerHours, Number.NaN),
              costRate: parseNumber(labour?.projectManagerRate, Number.NaN),
              sellRate: parseNumber(labour?.projectManagerSellingPrice, Number.NaN),
              hasHours: hasNumericInput(labour?.projectManagerHours),
              hasCostRate: hasNumericInput(labour?.projectManagerRate),
              hasSellRate: hasNumericInput(labour?.projectManagerSellingPrice)
            }
          ];
      const hasAnyLabourInput = labourRows.some((row) => row.hasHours || row.hasCostRate || row.hasSellRate);
      if (!hasAnyLabourInput) {
        errors.push(`${divisionName} requires labour details or set labour as no cost.`);
      }
      for (const row of labourRows) {
        const hasAnyRowInput = row.hasHours || row.hasCostRate || row.hasSellRate;
        const isCompleteRow =
          row.hasHours &&
          row.hasCostRate &&
          row.hasSellRate &&
          row.hours > 0 &&
          row.costRate >= 0 &&
          row.sellRate >= 0;
        if (hasAnyRowInput && !isCompleteRow) {
          errors.push(
            `${divisionName} ${row.label} must include hours, cost rate, and sell rate, or set labour as no cost.`
          );
        }
      }
    }

    const materialLines = Array.isArray(division?.materials?.lines) ? division.materials.lines : [];
    const meaningfulMaterialLines = materialLines.filter(hasMeaningfulCostLine);
    if (!isGlendale && !Boolean(division?.materials?.noCost)) {
      if (!meaningfulMaterialLines.length) {
        errors.push(`${divisionName} requires at least one material line or set material as no cost.`);
      }
      meaningfulMaterialLines.forEach((line, index) => {
        if (!isCompleteCostLine(line)) {
          errors.push(
            `${divisionName} material line ${index + 1} must include description, quantity, unit cost, and sell total, or set material as no cost.`
          );
        }
      });
    }

    const subcontractorLines = Array.isArray(division?.subcontractor?.lines) ? division.subcontractor.lines : [];
    const meaningfulSubcontractorLines = subcontractorLines.filter(hasMeaningfulCostLine);
    if (!Boolean(division?.subcontractor?.noCost)) {
      if (!meaningfulSubcontractorLines.length) {
        errors.push(
          `${divisionName} requires at least one ${subcontractorLabel} line or set ${subcontractorLabel} as no cost.`
        );
      }
      meaningfulSubcontractorLines.forEach((line, index) => {
        if (!isCompleteCostLine(line)) {
          errors.push(
            `${divisionName} ${subcontractorLabel} line ${index + 1} must include description, quantity, unit cost, and sell total, or set ${subcontractorLabel} as no cost.`
          );
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function resolveOpportunityClassCandidates(payload) {
  const mode = resolveQuoteMode(payload);
  if (mode === "glendale") {
    return Array.from(
      new Set(
        [cleanString(config.acumatica?.opportunity?.glendaleClassId), "GLENDALE", "Glendale", "glendale"]
          .map((item) => cleanString(item))
          .filter(Boolean)
      )
    );
  }
  if (mode === "service") {
    return Array.from(
      new Set(
        [cleanString(config.acumatica?.opportunity?.serviceClassId), "SERVICE", "SERVICES", "Service", "Services"]
          .map((item) => cleanString(item))
          .filter(Boolean)
      )
    );
  }
  return Array.from(
    new Set(
      [cleanString(config.acumatica?.opportunity?.classId), "PRODUCTION", "Production", "production"]
        .map((item) => cleanString(item))
        .filter(Boolean)
    )
  );
}

function resolveOpportunityStage() {
  return cleanString(config.acumatica?.opportunity?.stage) || "Awaiting Estimate";
}

function isOpportunityClassNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /opportunity class.*cannot be found in the system/i.test(message);
}

function isProjectTemplateNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /project template.*cannot be found in the system/i.test(message);
}

function resolveProjectTemplateCandidates(payload) {
  const mode = resolveQuoteMode(payload);
  if (mode === "service") return ["SERVICE", "SERVICES"];
  if (mode === "glendale") return ["GLENDALE", "Glendale", "glendale"];
  return ["PRODUCTION", "Production", "production"];
}

function parsePositiveInt(raw, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function parseNumber(raw, fallback = 0) {
  const normalized = cleanString(raw).replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasNumericInput(value) {
  const raw = cleanString(value);
  if (!raw) return false;
  return Number.isFinite(parseNumber(raw, Number.NaN));
}

function collapseWhitespace(value) {
  return cleanString(value).replace(/\s+/g, " ");
}

function truncateText(value, max = 85) {
  const text = collapseWhitespace(value);
  if (!text) return "";
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const breakAt = slice.lastIndexOf(" ");
  return (breakAt > 20 ? slice.slice(0, breakAt) : slice).trimEnd();
}

function toTitleCase(value) {
  const text = cleanString(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stripDescriptionNoise(value) {
  return collapseWhitespace(value)
    .replace(/[\u2022•▪◦·]/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/^\d+\s*[\.\)\-:]\s*/g, "")
    .replace(/^(construction|electrical|plumbing|hvac|glendale)\s*/i, "")
    .replace(/^(scope of work|statement of work|scope)\s*[:\-]\s*/i, "")
    .trim();
}

function limitWords(value, maxWords = 16) {
  return cleanString(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function toHeadlineCase(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bHvac\b/g, "HVAC");
}

function joinWithAnd(items = []) {
  const values = items.map(cleanString).filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function summarizeScopeToOneLine(raw, fallback = "") {
  const rawText = String(raw || "");
  const simpleRaw = cleanString(rawText);
  if (simpleRaw && !/[\r\n]/.test(rawText) && simpleRaw.length <= 110) {
    const compact = collapseWhitespace(simpleRaw).replace(/[,:;.\-]+$/g, "");
    if (compact) return toTitleCase(compact);
  }

  const scopeLines = rawText
    .split(/\r?\n/)
    .map((line) =>
      cleanString(line)
        .replace(/^[*•▪◦·]\s*/, "- ")
        .replace(/\s+/g, " ")
    )
    .filter(Boolean);

  const headingPattern = /^[A-Z0-9][A-Z0-9 &/().,#:'"-]{2,}$/;
  const headings = [];
  for (const line of scopeLines) {
    const normalized = cleanString(line).replace(/^\d+\s*[\.\)\-:]\s*/, "");
    if (/^(-\s+|\d+[.)]\s+)/.test(normalized)) continue;
    if (!headingPattern.test(normalized)) continue;
    if (/^(optional items|scope of work|statement of work)\b/i.test(normalized)) continue;
    headings.push(toHeadlineCase(normalized));
  }
  const headingSummary = Array.from(new Set(headings)).slice(0, 4);

  const firstBullet = scopeLines.find((line) => /^(-\s+|\d+[.)]\s+)/.test(line));
  let actionSummary = cleanString(firstBullet ? firstBullet.replace(/^(-\s+|\d+[.)]\s+)/, "") : "");
  actionSummary = actionSummary
    .replace(/^supply\s+and\s+install\s+/i, "Install ")
    .replace(/^furnish\s+and\s+install\s+/i, "Install ")
    .replace(/^supply\s+labou?r\s+and\s+material\s+to\s+/i, "")
    .replace(/[,:;.\-]+$/g, "")
    .trim();
  actionSummary = truncateText(limitWords(actionSummary, 9), 62);

  let summaryText = "";
  if (headingSummary.length) {
    summaryText = `Work includes ${joinWithAnd(headingSummary)}`;
    if (actionSummary) {
      summaryText += `, including ${actionSummary.toLowerCase()}`;
    }
  } else if (actionSummary) {
    summaryText = `Work includes ${actionSummary}`;
  } else {
    summaryText = stripDescriptionNoise(rawText).split(/(?<=[.!?;:])\s+/)[0];
  }

  if (!cleanString(summaryText)) {
    summaryText = stripDescriptionNoise(fallback);
  }
  if (!cleanString(summaryText)) {
    summaryText = "Project scope overview";
  }

  const compactSummary = cleanString(summaryText).replace(/[,:;.\-]+$/g, "");
  const maxWords = limitWords(compactSummary, 16);
  return toTitleCase(truncateText(maxWords, 110));
}

function sanitizeBriefQuoteDescription(raw, fallback = "") {
  return summarizeScopeToOneLine(raw, fallback);
}

function buildFallbackQuoteDescription(payload, quoteSummary, quoteBody) {
  const summary = cleanString(quoteSummary);
  const divisionLabel = cleanString(payload?.quoteType || "project");
  const scopeText = [
    cleanString(quoteBody),
    ...(Array.isArray(payload?.divisions) ? payload.divisions.map((division) => cleanString(division?.scope)) : [])
  ]
    .filter(Boolean)
    .join("\n");
  return sanitizeBriefQuoteDescription(scopeText || summary, `${divisionLabel} scope`);
}

function resolveQuoteDescriptionFromRequest(reqBody, payload, quoteSummary, quoteBody) {
  const providedDescription = cleanString(
    reqBody?.quoteDescription || reqBody?.description || reqBody?.subject
  );
  if (providedDescription) {
    return sanitizeBriefQuoteDescription(providedDescription, quoteBody || quoteSummary);
  }

  const scopeText = [
    cleanString(quoteBody),
    ...(Array.isArray(payload?.divisions) ? payload.divisions.map((division) => cleanString(division?.scope)) : [])
  ]
    .filter(Boolean)
    .join("\n");
  if (scopeText) {
    return sanitizeBriefQuoteDescription(scopeText, quoteSummary);
  }

  const generatedDescription = cleanString(buildQuoteDescription(payload, { summary: quoteSummary }));
  if (generatedDescription) {
    return sanitizeBriefQuoteDescription(generatedDescription, quoteSummary);
  }

  return buildFallbackQuoteDescription(payload, quoteSummary, quoteBody);
}

function buildAcumaticaQuoteUrl(quoteNbr) {
  const baseUrl = cleanString(config.acumatica?.baseUrl).replace(/\/$/, "");
  const company = cleanString(config.acumatica?.company);
  const screenId = cleanString(config.acumatica?.quoteScreenId || "PM304500");
  const number = cleanString(quoteNbr);
  if (!baseUrl || !company || !screenId || !number) return "";
  const params = new URLSearchParams({
    CompanyID: company,
    ScreenId: screenId,
    QuoteNbr: number
  });
  return `${baseUrl}/Main?${params.toString()}`;
}

function buildLineSubtotal(lines = []) {
  return lines.reduce((sum, line) => {
    const unitPrice = parseNumber(line?.unitPrice);
    const quantity = parseNumber(line?.quantity, 1);
    return sum + unitPrice * quantity;
  }, 0);
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((parseNumber(value) + Number.EPSILON) * factor) / factor;
}

function extractSpreadsheetIdFromUrl(url) {
  const value = cleanString(url);
  if (!value) return "";
  const match = value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : "";
}

function normalizeSpreadsheetEditUrl(url) {
  const fileId = extractSpreadsheetIdFromUrl(url);
  if (!fileId) return cleanString(url);
  return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
}

function extractQuoteNumberCandidate(text) {
  const raw = cleanString(text);
  if (!raw) return "";
  const qHash = raw.match(/\bQ#\s*([A-Za-z0-9_-]+)/i);
  if (qHash?.[1]) return cleanString(qHash[1]);
  const pq = raw.match(/\b(PQ[0-9]{4,})\b/i);
  if (pq?.[1]) return cleanString(pq[1]);
  const labeled = raw.match(/\bquote\s*#?\s*[:\-]?\s*([A-Za-z0-9_-]+)/i);
  if (labeled?.[1]) return cleanString(labeled[1]);
  return "";
}

function buildPdfAddressObject(source = {}, fallbackCountry = DEFAULT_ACCOUNT_COUNTRY) {
  if (!source || typeof source !== "object") return null;
  const address = source.address && typeof source.address === "object" ? source.address : {};
  const pickAddressValue = (...values) => {
    for (const value of values) {
      const text = cleanString(value);
      if (text) return text;
    }
    return "";
  };

  const line1 = pickAddressValue(
    address.addressLine1,
    address.line1,
    address.address1,
    address.AddressLine1,
    address.Line1,
    address.Address1,
    source.addressLine1,
    source.AddressLine1,
    source.line1,
    source.Line1
  );
  const line2 = pickAddressValue(
    address.addressLine2,
    address.line2,
    address.address2,
    address.AddressLine2,
    address.Line2,
    address.Address2,
    source.addressLine2,
    source.AddressLine2,
    source.line2,
    source.Line2
  );
  const streetSource =
    typeof address.street === "string"
      ? address.street
      : typeof address.Street === "string"
        ? address.Street
      : typeof address.address === "string"
        ? address.address
        : typeof address.Address === "string"
          ? address.Address
      : typeof source.street === "string"
        ? source.street
      : typeof source.Street === "string"
        ? source.Street
        : typeof source.address === "string"
          ? source.address
          : typeof source.Address === "string"
            ? source.Address
          : "";
  const parsedStreetParts = cleanString(streetSource)
    .split(/\r?\n|,/)
    .map((part) => cleanString(part))
    .filter(Boolean);
  const seenStreet = new Set();
  const streetParts = [line1, line2, ...parsedStreetParts].filter((line) => {
    const key = cleanString(line).toLowerCase();
    if (!key || seenStreet.has(key)) return false;
    seenStreet.add(key);
    return true;
  });

  return {
    name: pickAddressValue(source.name, source.Name),
    addressLine1: cleanString(streetParts[0] || ""),
    addressLine2: cleanString(streetParts.slice(1).join(", ")),
    city: pickAddressValue(address.city, address.City, source.city, source.City),
    state: pickAddressValue(
      address.state,
      address.province,
      address.State,
      address.Province,
      source.state,
      source.province,
      source.State,
      source.Province
    ),
    postalCode: pickAddressValue(
      address.zip,
      address.postalCode,
      address.PostalCode,
      address.Zip,
      address.ZipCode,
      source.zip,
      source.postalCode,
      source.PostalCode,
      source.Zip,
      source.ZipCode
    ),
    country:
      pickAddressValue(address.country, address.Country, source.country, source.Country, fallbackCountry, DEFAULT_ACCOUNT_COUNTRY) ||
      DEFAULT_ACCOUNT_COUNTRY
  };
}

function resolveSalesRepForQuotePdf({ requestBody = {}, payload = {}, businessAccount = {}, contact = {} } = {}) {
  return (
    cleanFieldValue(requestBody?.salesRep) ||
    cleanFieldValue(requestBody?.account?.owner || requestBody?.account?.ownerEmployeeName || requestBody?.account?.OwnerEmployeeName) ||
    cleanFieldValue(payload?.account?.owner || payload?.account?.ownerEmployeeName) ||
    cleanFieldValue(businessAccount?.owner || businessAccount?.ownerEmployeeName) ||
    cleanFieldValue(requestBody?.account?.contactName || requestBody?.account?.ContactName) ||
    cleanFieldValue(payload?.account?.contactName) ||
    cleanFieldValue(contact?.displayName || contact?.name) ||
    "TBD"
  );
}

function buildQuoteBackupFilename(quoteNumber) {
  const fileQuoteNumber = cleanString(quoteNumber || "quote");
  const safeQuoteNumber = fileQuoteNumber.replace(/[^a-zA-Z0-9_-]/g, "");
  return safeQuoteNumber ? `quote-backup-${safeQuoteNumber}.pdf` : "quote-backup.pdf";
}

async function renderQuoteBackupPdfResult(options = {}) {
  const hasGoogleDocTemplate = Boolean(
    cleanString(config.quotePdf?.templateDocId || config.quotePdf?.templateDocUrl)
  );

  if (hasGoogleDocTemplate) {
    return renderQuoteBackupPdfFromGoogleDoc({
      ...options,
      templateDocId: config.quotePdf?.templateDocId,
      templateDocUrl: config.quotePdf?.templateDocUrl,
      outputFolderId: config.quotePdf?.outputFolderId,
      keepGeneratedDoc: Boolean(config.quotePdf?.keepGeneratedDoc),
      storePdfInDrive: config.quotePdf?.storePdfInDrive !== false
    });
  }

  const fallbackBytes = await renderQuoteBackupPdf({
    ...options,
    templatePath: config.quotePdf?.templatePath
  });
  return { pdfBytes: fallbackBytes };
}

function buildPricingBookServiceHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };
  const token = cleanString(config.pricingBookService?.token);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function parsePricingBookSeedStatus(raw) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const nested = parsed.seed && typeof parsed.seed === "object" ? parsed.seed : parsed;
  const rowsWritten = parseNumber(
    nested?.rowsWritten ?? parsed?.rowsWritten ?? nested?.rows ?? parsed?.rows,
    0
  );
  const sheetsTouched = parseNumber(
    nested?.sheetsTouched ?? parsed?.sheetsTouched ?? nested?.sheets ?? parsed?.sheets,
    0
  );
  const summaryApplied = Boolean(
    nested?.summaryApplied ?? parsed?.summaryApplied ?? nested?.summary_applied ?? parsed?.summary_applied
  );
  const applied = Boolean(nested?.applied ?? parsed?.applied ?? nested?.seeded ?? parsed?.seeded);
  const seeded = applied || rowsWritten > 0 || summaryApplied;
  const message = cleanString(
    nested?.message || parsed?.message || nested?.summaryMessage || parsed?.summaryMessage || ""
  );
  return {
    seeded,
    rowsWritten,
    sheetsTouched,
    summaryApplied,
    message
  };
}

async function createPricingBookWorkbookFromService({
  payload,
  businessAccount,
  contact,
  quoteNbr,
  opportunityId,
  quoteSummary,
  breakdowns,
  quoteBackupSummary
}) {
  const serviceConfig = config.pricingBookService || {};
  if (!serviceConfig.enabled) {
    return {
      attempted: false,
      created: false,
      message: "Pricing book seed is disabled."
    };
  }

  const baseUrl = cleanString(serviceConfig.baseUrl);
  if (!baseUrl) {
    return {
      attempted: false,
      created: false,
      message: "Pricing book service URL is not configured."
    };
  }

  const divisionRows = buildPricingBookSeedRows(breakdowns);
  const scopeSections = buildPricingBookScopeSections(breakdowns);
  const mainEstimate = buildPricingBookMainEstimate({
    payload,
    quoteSummary,
    divisionRows,
    opportunityId,
    quoteNbr
  });
  const requestBody = {
    customerName: cleanString(businessAccount?.name || payload?.account?.name),
    opportunityId: cleanString(opportunityId),
    quoteNbr: cleanString(quoteNbr),
    quoteSubject: cleanString(quoteSummary),
    branchCd: cleanString(resolveQuoteMode(payload)).toUpperCase(),
    contactName: cleanString(payload?.account?.contactName || contact?.displayName || contact?.name),
    projectBudget: mainEstimate.projectBudget,
    projectSellingPrice: mainEstimate.projectSellingPrice,
    grandTotal: mainEstimate.grandTotal,
    seed: {
      quoteSummary: cleanString(quoteSummary),
      quoteBackupSummary: cleanString(quoteBackupSummary),
      mainEstimate,
      scopeSections,
      divisionRows
    }
  };

  const endpoint = `${baseUrl.replace(/\/$/, "")}/pricing-books`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildPricingBookServiceHeaders(),
    body: JSON.stringify(requestBody)
  });

  const rawText = await response.text();
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (_error) {
    parsed = null;
  }

  if (!response.ok) {
    return {
      attempted: true,
      created: false,
      message: `Pricing book service create failed (${response.status}): ${cleanString(parsed?.error || rawText || response.statusText)}`
    };
  }

  const sheetUrl = cleanString(parsed?.url);
  const seedStatus = parsePricingBookSeedStatus(parsed);
  return {
    attempted: true,
    created: Boolean(sheetUrl),
    mode: "service",
    message: cleanString(parsed?.message || ""),
    sheetUrl: normalizeSpreadsheetEditUrl(sheetUrl),
    fileId: cleanString(parsed?.fileId || extractSpreadsheetIdFromUrl(sheetUrl)),
    seed: {
      attempted: true,
      seeded: seedStatus.seeded,
      rowsWritten: seedStatus.rowsWritten,
      sheetsTouched: seedStatus.sheetsTouched,
      summaryApplied: seedStatus.summaryApplied,
      message: seedStatus.message
    }
  };
}

async function seedPricingBookWorkbook({
  acumatica,
  payload,
  quoteNbr,
  quoteId,
  opportunityId,
  quoteSummary,
  breakdowns,
  pricingBookResult,
  quoteBackupSummary
}) {
  const serviceConfig = config.pricingBookService || {};
  if (!serviceConfig.enabled) {
    return {
      attempted: false,
      seeded: false,
      message: "Pricing book seed is disabled."
    };
  }

  const divisionRows = buildPricingBookSeedRows(breakdowns);
  if (!divisionRows.length) {
    return {
      attempted: false,
      seeded: false,
      message: "No division rows available for pricing-book seed."
    };
  }

  const baseUrl = cleanString(serviceConfig.baseUrl);
  if (!baseUrl) {
    return {
      attempted: false,
      seeded: false,
      message: "Pricing book service URL is not configured."
    };
  }

  let sheetUrl = normalizeSpreadsheetEditUrl(pricingBookResult?.sheetUrl);
  let fileId = cleanString(pricingBookResult?.fileId || extractSpreadsheetIdFromUrl(sheetUrl));

  if (!fileId) {
    const backupRef = await acumatica.getQuoteBackupLink(
      { quoteNbr, quoteId },
      { entityName: config.acumatica.quoteEntity }
    );
    sheetUrl = normalizeSpreadsheetEditUrl(backupRef?.link || sheetUrl);
    fileId = cleanString(backupRef?.fileId || extractSpreadsheetIdFromUrl(sheetUrl));
  }

  if (!fileId) {
    return {
      attempted: true,
      seeded: false,
      message: "Pricing book file id not found; skipped workbook seed."
    };
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}${cleanString(serviceConfig.seedPath || "/pricing-books/seed")}`;
  const scopeSections = buildPricingBookScopeSections(breakdowns);
  const mainEstimate = buildPricingBookMainEstimate({
    payload,
    quoteSummary,
    divisionRows,
    opportunityId,
    quoteNbr
  });
  const requestBody = {
    fileId,
    quoteNbr: cleanString(quoteNbr),
    opportunityId: cleanString(opportunityId),
    customerName: cleanString(payload?.account?.name),
    projectBudget: mainEstimate.projectBudget,
    projectSellingPrice: mainEstimate.projectSellingPrice,
    grandTotal: mainEstimate.grandTotal,
    seed: {
      quoteSummary: cleanString(quoteSummary),
      quoteBackupSummary: cleanString(quoteBackupSummary),
      mainEstimate,
      scopeSections,
      divisionRows
    }
  };

  const headers = {
    "Content-Type": "application/json"
  };
  const token = cleanString(serviceConfig.token);
  if (token) headers.Authorization = `Bearer ${token}`;

  const configuredMaxAttempts = parsePositiveInt(serviceConfig.seedMaxAttempts, 12, 30);
  const configuredRetryBaseMs = parsePositiveInt(serviceConfig.seedRetryBaseMs, 750, 5000);
  const maxAttempts = Math.max(2, configuredMaxAttempts);
  const retryBaseMs = Math.max(200, configuredRetryBaseMs);
  let lastResult = {
    attempted: true,
    seeded: false,
    fileId,
    sheetUrl,
    rowsWritten: 0,
    sheetsTouched: 0,
    summaryApplied: false,
    message: "Seed request did not run."
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });

    const rawText = await response.text();
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_error) {
      parsed = null;
    }

    if (!response.ok) {
      const detail = cleanString(parsed?.error || rawText || response.statusText);
      lastResult = {
        attempted: true,
        seeded: false,
        fileId,
        sheetUrl,
        rowsWritten: 0,
        sheetsTouched: 0,
        summaryApplied: false,
        message: `Seed request failed (${response.status}): ${detail}`
      };
      const retryableStatus = [404, 409, 425, 429, 500, 502, 503];
      if (attempt < maxAttempts && retryableStatus.includes(response.status)) {
        await delay(retryBaseMs * attempt);
        continue;
      }
      return lastResult;
    }

    const seedStatus = parsePricingBookSeedStatus(parsed);
    lastResult = {
      attempted: true,
      seeded: seedStatus.seeded,
      fileId: cleanString(parsed?.fileId || fileId),
      sheetUrl,
      rowsWritten: seedStatus.rowsWritten,
      sheetsTouched: seedStatus.sheetsTouched,
      summaryApplied: seedStatus.summaryApplied,
      message: seedStatus.message
    };

    if (seedStatus.seeded && seedStatus.summaryApplied) {
      return lastResult;
    }
    if (attempt < maxAttempts) {
      await delay(retryBaseMs * attempt);
    }
  }

  return {
    ...lastResult,
    seeded: false,
    summaryApplied: false,
    message: [
      cleanString(lastResult.message),
      "Pricing-book summary was not applied after retry attempts."
    ]
      .filter(Boolean)
      .join(" | ")
  };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/acumatica/session", async (req, res) => {
  try {
    const session = requireAppSession(req);
    res.json({
      authenticated: true,
      integratedAuth: cleanString(session?.mode).toLowerCase() === "integrated",
      token: "",
      username: cleanString(session?.sub || session?.username),
      company: cleanString(session?.company || config.acumatica.company),
      sharedSession: cleanString(session?.mode).toLowerCase() === "shared"
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return res.status(error.status || 401).json({
        code: error.code,
        error: error.message,
        authenticated: false
      });
    }
    return res.status(500).json({
      code: "AUTH_SESSION_ERROR",
      error: error instanceof Error ? error.message : "Session lookup failed.",
      authenticated: false
    });
  }
});

app.post("/api/acumatica/login", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    if (INTEGRATED_AUTH_ENABLED) {
      const integratedSession = resolveIntegratedSession(req);
      if (!integratedSession) {
        return res.status(401).json({
          code: "AUTH_REQUIRED",
          error: "Sign in through the MeadowBrook sales workspace first.",
          correlationId
        });
      }
      return res.json({
        token: "",
        username: integratedSession.username,
        company: integratedSession.company,
        sharedSession: false,
        integratedAuth: true,
        expiresInSeconds: Math.trunc(AUTH_SESSION_TTL_MS / 1000),
        correlationId
      });
    }

    const requestedUsername = cleanString(req.body?.name || req.body?.username || req.body?.user);
    const requestedPassword = cleanString(req.body?.password);
    const username = requestedUsername || "shared-user";
    let useSharedSession = SHARED_ACUMATICA_MODE;

    let userClient = null;
    if (useSharedSession) {
      try {
        const client = getSharedAcumaticaClient();
        await withUpstreamStep("auth_login", () => client.login());
      } catch (error) {
        const canFallbackToUser =
          error instanceof ApiAuthError &&
          error.code === "SERVICE_ACCOUNT_NOT_CONFIGURED" &&
          requestedUsername &&
          requestedPassword;
        if (!canFallbackToUser) throw error;
        useSharedSession = false;
      }
    }

    if (!useSharedSession) {
      if (!requestedUsername || !requestedPassword) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          error: "Acumatica username and password are required.",
          correlationId
        });
      }

      userClient = new AcumaticaClient({
        ...config.acumatica,
        username: requestedUsername,
        password: requestedPassword
      });
      await withUpstreamStep("auth_login", () => userClient.login());
    } else {
      userClient = null;
    }

    const token = createAuthToken({
      username,
      company: config.acumatica.company,
      cookie: userClient?.cookie || "",
      mode: useSharedSession ? "shared" : "user"
    });

    res.json({
      token,
      username,
      company: config.acumatica.company,
      sharedSession: useSharedSession,
      expiresInSeconds: Math.trunc(AUTH_SESSION_TTL_MS / 1000),
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/acumatica/logout", async (req, res) => {
  if (INTEGRATED_AUTH_ENABLED) {
    return res.json({ status: "ok", delegatedToSalesAuth: true });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.json({ status: "ok" });
  }

  try {
    const payload = decodeAuthToken(token, { allowExpired: true });
    const tokenMode = cleanString(payload?.mode).toLowerCase();
    if (tokenMode === "user") {
      const client = buildClientFromTokenPayload(payload);
      await client.logout();
    }
  } catch (_error) {
    // Best-effort logout: treat invalid/expired tokens as already logged out.
  }

  res.json({ status: "ok" });
});

app.get("/api/business-accounts", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const pageSize = parsePositiveInt(req.query.pageSize, 100, 1000);
    const maxRecords = parsePositiveInt(req.query.maxRecords, 10000, 50000);
    const forceRefresh = isRefreshQueryEnabled(req.query.refresh);
    const cacheKey = buildBusinessAccountsCacheKey(req);
    if (!forceRefresh) {
      const cached = getBusinessAccountsCacheEntry(cacheKey);
      if (cached) {
        const ageMs = Math.max(0, Date.now() - parseNumber(cached.savedAt, 0));
        return res.json({
          items: cached.items,
          count: cached.items.length,
          cache: {
            hit: true,
            ageMs,
            ttlMs: BUSINESS_ACCOUNTS_CACHE_TTL_MS
          },
          correlationId
        });
      }
    }

    const acumatica = requireAcumaticaClient(req);
    const items = await withUpstreamStep("business_account_list", () =>
      acumatica.listBusinessAccounts({ pageSize, maxRecords })
    );
    setBusinessAccountsCacheEntry(cacheKey, items);

    res.json({
      items,
      count: items.length,
      cache: {
        hit: false,
        ageMs: 0,
        ttlMs: BUSINESS_ACCOUNTS_CACHE_TTL_MS
      },
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.get("/api/employees", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const acumatica = requireAcumaticaClient(req);
    const pageSize = parsePositiveInt(req.query.pageSize, 100, 1000);
    const maxRecords = parsePositiveInt(req.query.maxRecords, 5000, 20000);
    const employees = await withUpstreamStep("employee_list", () =>
      acumatica.listEmployees({ pageSize, maxRecords })
    );
    const items = employees.map((employee) => acumatica.formatEmployeeOption(employee));

    res.json({
      items,
      count: items.length,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.get("/api/templates/catalog", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const templates = await loadTemplates();
    res.json({
      items: templates,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.get("/api/pricing-book/estimators", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const items = await loadPricingBookEstimatorCatalog({ force: isRefreshQueryEnabled(req.query.refresh), logger: console });
    res.json({
      items,
      count: items.length,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unable to load pricing-book estimators.";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.get("/api/business-accounts/:businessAccountId/contacts", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const acumatica = requireAcumaticaClient(req);
    const businessAccountId = cleanString(req.params.businessAccountId);
    if (!businessAccountId) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "businessAccountId is required.",
        correlationId
      });
    }

    const maxRecords = parsePositiveInt(req.query.maxRecords, 500, 5000);
    const contacts = await withUpstreamStep("contact_list", () =>
      acumatica.listBusinessAccountContacts(businessAccountId, { maxRecords })
    );

    const items = contacts.map((contact) => acumatica.formatContactOption(contact));
    res.json({
      businessAccountId,
      items,
      count: items.length,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/business-accounts", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const acumatica = requireAcumaticaClient(req);
    const normalizedPostalCode = normalizeCanadianPostalCode(req.body?.postalCode || req.body?.zip);
    const input = {
      businessAccountId: cleanString(req.body?.businessAccountId),
      name: cleanString(req.body?.name || req.body?.accountName),
      email: cleanString(req.body?.email),
      phone: cleanString(req.body?.phone),
      addressLine1: cleanString(req.body?.addressLine1 || req.body?.address),
      addressLine2: cleanString(req.body?.addressLine2),
      city: cleanString(req.body?.city),
      state: cleanString(req.body?.state || req.body?.province || DEFAULT_ACCOUNT_PROVINCE) || DEFAULT_ACCOUNT_PROVINCE,
      postalCode: normalizedPostalCode,
      country: cleanString(req.body?.country || DEFAULT_ACCOUNT_COUNTRY) || DEFAULT_ACCOUNT_COUNTRY,
      ownerId: cleanString(req.body?.ownerId || req.body?.ownerEmployeeId || req.body?.Owner),
      owner: cleanString(req.body?.owner || req.body?.ownerEmployeeName || req.body?.ownerName)
    };

    if (!input.name) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Business account name is required.",
        correlationId
      });
    }
    if (!input.ownerId) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Sales rep is required.",
        correlationId
      });
    }
    if (!input.city) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "City is required.",
        correlationId
      });
    }
    if (!input.postalCode || !isValidCanadianPostalCode(input.postalCode)) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Postal Code must be in Canadian format (e.g., A1A 1A1).",
        correlationId
      });
    }

    const created = await withUpstreamStep("business_account_create", () =>
      acumatica.createBusinessAccount(input)
    );
    BUSINESS_ACCOUNTS_CACHE.clear();

    const item = {
      businessAccountId: cleanString(created?.id || created?.code || input.businessAccountId),
      name: cleanString(created?.name || input.name),
      owner: cleanString(created?.owner || input.owner || input.ownerId),
      ownerId: cleanString(input.ownerId),
      address:
        input.addressLine1 || input.addressLine2 || input.city || input.state || input.postalCode || input.country
          ? {
              street: [input.addressLine1, input.addressLine2].filter(Boolean).join(", "),
              city: input.city,
              state: input.state,
              zip: input.postalCode,
              country: input.country
            }
          : null
    };

    res.status(201).json({
      item,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/contacts", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const acumatica = requireAcumaticaClient(req);
    const contactClass = cleanString(req.body?.contactClass || req.body?.classId);
    const allowedContactClasses = new Set(["BILLING", "OPERATIONS", "PRODUCTION", "SALES", "SERVICE"]);
    const input = {
      businessAccountId: cleanString(req.body?.businessAccountId),
      firstName: cleanString(req.body?.firstName),
      lastName: cleanString(req.body?.lastName),
      displayName: cleanString(req.body?.displayName || req.body?.name),
      email: cleanString(req.body?.email),
      phone: cleanString(req.body?.phone),
      contactClass
    };

    if (!input.businessAccountId) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "businessAccountId is required.",
        correlationId
      });
    }

    if (!input.firstName) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "First Name is required.",
        correlationId
      });
    }
    if (!input.lastName) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Last Name is required.",
        correlationId
      });
    }
    if (!input.email) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Email is required.",
        correlationId
      });
    }
    if (!input.phone) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Phone is required.",
        correlationId
      });
    }
    if (!contactClass) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Contact Class is required.",
        correlationId
      });
    }
    if (!allowedContactClasses.has(contactClass.toUpperCase())) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Contact Class must be one of: BILLING, OPERATIONS, PRODUCTION, SALES, SERVICE.",
        correlationId
      });
    }

    const created = await withUpstreamStep("contact_create", () => acumatica.createContact(input));
    const item = acumatica.formatContactOption(created);

    res.status(201).json({
      businessAccountId: input.businessAccountId,
      item,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/ai/task-plan", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const payload = normalizePayload(req.body || {});
    if (!payload.divisions.length) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "At least one selected division is required.",
        correlationId
      });
    }

    const plan = await generateTaskPlanWithAI({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      quoteType: payload.quoteType,
      divisions: payload.divisions,
      quoteBody: cleanString(req.body?.quoteBody)
    });

    res.json({
      ...plan,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/ai/prototype-estimate", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const masterScope = cleanString(req.body?.masterScope || req.body?.quoteBody || req.body?.scopeText);
    if (!masterScope) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "masterScope is required.",
        correlationId
      });
    }
    const existingDivisions = Array.isArray(req.body?.divisions)
      ? req.body.divisions.map((division) => ({
          sectionId: cleanString(division?.sectionId),
          id: cleanString(division?.id || division?.divisionId || division?.title),
          title: cleanString(division?.title || division?.id),
          scope: cleanString(division?.scope),
          scopeLines: Array.isArray(division?.scopeLines)
            ? division.scopeLines.map((line, index) => ({
                scopeLineKey: cleanString(line?.scopeLineKey || `scope-line-${index + 1}`),
                lineNumber: cleanString(line?.lineNumber || String(index + 1)),
                sourceText: cleanString(line?.sourceText || line?.text || line?.normalizedText)
              }))
            : []
        }))
      : [];

    const prototype = await generatePrototypeEstimateWithAI({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      quoteType: cleanString(req.body?.quoteType || "production"),
      masterScope,
      existingDivisions,
      pricingPosture: cleanString(req.body?.pricingPosture || "premium_high") || "premium_high"
    });

    res.json({
      ...prototype,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/ai/quote-polish", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const quoteBody = cleanString(req.body?.quoteBody || req.body?.text);
    const mode = cleanString(req.body?.mode || "context").toLowerCase();
    const customInstructions = cleanString(req.body?.customInstructions);
    const validModes = new Set(["grammar", "context", "custom"]);
    if (!quoteBody) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "quoteBody is required.",
        correlationId
      });
    }
    if (!validModes.has(mode)) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "mode must be one of: grammar, context, custom.",
        correlationId
      });
    }
    if (mode === "custom" && !customInstructions) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "customInstructions is required when mode is custom.",
        correlationId
      });
    }

    const polish = await polishQuoteBodyWithAI({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      quoteBody,
      quoteType: cleanString(req.body?.quoteType || "production"),
      mode,
      customInstructions,
      clarifications: Array.isArray(req.body?.clarifications) ? req.body.clarifications : []
    });

    res.json({
      ...polish,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/ai/quote-description", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const payload = normalizePayload(req.body || {});
    const quoteBody = cleanString(req.body?.quoteBody || req.body?.text);
    if (!payload.divisions.length && !quoteBody) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Provide at least one selected division scope or quoteBody.",
        correlationId
      });
    }

    const accountName = cleanString(req.body?.account?.name || payload.account?.name);
    const suggestion = await generateQuoteDescriptionWithAI({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      quoteType: cleanString(req.body?.quoteType || payload.quoteType || "production"),
      accountName,
      quoteBody,
      divisions: payload.divisions,
      currentDescription: cleanString(req.body?.quoteDescription || req.body?.description)
    });

    const quoteSummary = buildQuoteSummary(payload);
    const fallback = buildFallbackQuoteDescription(payload, quoteSummary, quoteBody);
    const description = sanitizeBriefQuoteDescription(
      cleanString(suggestion?.description || fallback || quoteSummary),
      fallback || quoteSummary
    );

    res.json({
      description,
      notes: cleanString(suggestion?.notes || "Generated from scope of work."),
      generatedByAI: Boolean(suggestion?.generatedByAI),
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/ai/quote-validate", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const payload = normalizePayload(req.body || {});
    if (!payload.divisions.length) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "At least one selected division is required.",
        correlationId
      });
    }
    const missingScopeDivision = payload.divisions.find((division) => !cleanString(division?.scope));
    if (missingScopeDivision) {
      const divisionName = cleanString(missingScopeDivision?.title || missingScopeDivision?.id) || "Selected division";
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: `${divisionName} scope of work is required before AI validation.`,
        correlationId
      });
    }

    const validation = await validateQuoteWithAI({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      quoteType: payload.quoteType,
      divisions: payload.divisions,
      quoteBody: cleanString(req.body?.quoteBody || req.body?.text),
      quoteDescription: cleanString(req.body?.quoteDescription),
      account: normalizeAccount(req.body?.account || {}),
      opportunity: normalizeOpportunity(req.body?.opportunity || {}),
      estimatorConfig: normalizeEstimatorConfig(req.body?.estimatorConfig || {}),
      clarifications: Array.isArray(req.body?.clarifications) ? req.body.clarifications : []
    });

    res.json({
      ...validation,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/templates/recommend", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const divisionId = cleanString(req.body?.divisionId || req.body?.division);
    const scopeText = cleanString(req.body?.scopeText || req.body?.scope);
    const materialText = cleanString(req.body?.materialText);
    const subcontractorText = cleanString(req.body?.subcontractorText || req.body?.subtradeText);
    const preferGenericRaw = cleanString(req.body?.preferGeneric);
    const preferGeneric = preferGenericRaw ? preferGenericRaw.toLowerCase() !== "false" : true;

    if (!divisionId) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "divisionId is required.",
        correlationId
      });
    }

    const item = await pickTemplateItem({
      division: divisionId,
      scopeText,
      materialText,
      subcontractorText,
      preferGeneric
    });

    res.json({
      item,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/quote/preview", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const payload = normalizePayload(req.body || {});
    if (!payload.divisions.length) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "At least one division is required.",
        correlationId
      });
    }
    const requiredOpportunityValidation = validateRequiredOpportunityInputs(payload);
    if (!requiredOpportunityValidation.valid) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: requiredOpportunityValidation.errors[0],
        correlationId
      });
    }
    const requiredDivisionValidation = validateDivisionCostInputs(payload);
    if (!requiredDivisionValidation.valid) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: requiredDivisionValidation.errors[0],
        correlationId
      });
    }

    const quoteDateIso = new Date().toISOString();
    const quoteSummary = buildQuoteSummary(payload);
    const { tasks, lines, breakdowns } = await buildTasksAndLines({
      divisions: payload.divisions,
      pickTemplate: pickTemplateItem,
      quoteDate: quoteDateIso
    });
    const subtotal = buildLineSubtotal(lines);
    const taxRate = parseNumber(config.quotePdf?.taxRate, 0.13);
    const tax = roundTo(subtotal * taxRate, 2);
    const total = roundTo(subtotal + tax, 2);
    const quoteBody = cleanString(req.body?.quoteBody || req.body?.fullQuoteBody);
    const quoteScopeNote = quoteBody || buildQuoteScopeNote(payload, { breakdowns });
    const quoteDescription = resolveQuoteDescriptionFromRequest(req.body, payload, quoteSummary, quoteBody);
    const quoteBackupSummary = buildQuoteBackupSummary(payload, {
      summary: quoteSummary,
      breakdowns,
      lines
    });
    const requiredOpportunityAttributes = buildRequiredOpportunityAttributes(payload);
    const quoteAttributes = mergeAttributeLists(requiredOpportunityAttributes);

    res.json({
      quoteSummary,
      quoteDescription,
      quoteScopeNote,
      quoteBackupSummary,
      opportunity: {
        projectType: resolveProjectTypeFromPayload(payload),
        attributes: requiredOpportunityAttributes
      },
      quoteAttributes,
      tasks,
      lines,
      breakdowns,
      totals: {
        subtotal: roundTo(subtotal, 2),
        taxRate,
        tax,
        total
      },
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/quote/backup-pdf", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const payload = normalizePayload(req.body || {});
    if (!payload.divisions.length) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "At least one division is required.",
        correlationId
      });
    }
    const requiredDivisionValidation = validateDivisionCostInputs(payload);
    if (!requiredDivisionValidation.valid) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: requiredDivisionValidation.errors[0],
        correlationId
      });
    }

    const quoteDateIso = new Date().toISOString();
    const { lines } = await buildTasksAndLines({
      divisions: payload.divisions,
      pickTemplate: pickTemplateItem,
      quoteDate: quoteDateIso
    });

    const subtotal = buildLineSubtotal(lines);
    const taxRate = parseNumber(config.quotePdf?.taxRate, 0.13);
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    const rawStatementOfWork = cleanString(req.body?.quoteBody || req.body?.statementOfWork || req.body?.fullQuoteBody);
    let statementOfWork = rawStatementOfWork;
    if (rawStatementOfWork) {
      try {
        const grammarPolish = await polishQuoteBodyWithAI({
          apiKey: config.openaiApiKey,
          model: config.openaiModel,
          quoteBody: rawStatementOfWork,
          quoteType: cleanString(payload?.quoteType || "production"),
          mode: "grammar"
        });
        const contextPolish = await polishQuoteBodyWithAI({
          apiKey: config.openaiApiKey,
          model: config.openaiModel,
          quoteBody: cleanString(grammarPolish?.polishedText || rawStatementOfWork),
          quoteType: cleanString(payload?.quoteType || "production"),
          mode: "context"
        });
        statementOfWork = cleanString(contextPolish?.polishedText || grammarPolish?.polishedText || rawStatementOfWork);
      } catch (error) {
        console.warn(
          `[${correlationId}] Quote backup scope polish warning: ${
            error instanceof Error ? error.message : String(error || "Unknown AI scope polish error")
          }`
        );
      }
    }
    const quoteNumber =
      cleanString(req.body?.quoteNumber || req.body?.quoteNbr || req.body?.quote) ||
      extractQuoteNumberCandidate(statementOfWork) ||
      extractQuoteNumberCandidate(req.body?.quoteSummary) ||
      "PENDING";
    const transactionDate = cleanString(req.body?.transactionDate || quoteDateIso);
    const salesRep = resolveSalesRepForQuotePdf({
      requestBody: req.body,
      payload
    });
    const backupOptions = {
      payload,
      quoteNumber,
      transactionDate,
      salesRep,
      statementOfWork,
      billTo: req.body?.billTo,
      shipTo: req.body?.shipTo,
      subtotal,
      tax,
      total
    };

    const pdfResult = await renderQuoteBackupPdfResult(backupOptions);
    const pdfBytes = pdfResult?.pdfBytes;
    if (!pdfBytes) {
      throw new Error("Quote backup PDF generation returned no file bytes.");
    }

    const filename = buildQuoteBackupFilename(quoteNumber);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Correlation-Id", correlationId);
    if (pdfResult?.driveFile?.id) res.setHeader("X-Drive-File-Id", pdfResult.driveFile.id);
    if (pdfResult?.driveFile?.webViewLink) res.setHeader("X-Drive-File-Url", pdfResult.driveFile.webViewLink);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/quote", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const acumatica = requireAcumaticaClient(req);
    const payload = normalizePayload(req.body || {});
    const quoteBody = cleanString(req.body?.quoteBody || req.body?.fullQuoteBody);
    let existingOpportunityContext = null;
    if (payload.existingOpportunityId) {
      existingOpportunityContext = await loadExistingOpportunityContext({
        acumatica,
        opportunityId: payload.existingOpportunityId
      });
      payload.quoteType = cleanString(existingOpportunityContext.quoteType || payload.quoteType);
      payload.account = normalizeAccount({
        ...payload.account,
        ...existingOpportunityContext.businessAccount,
        contactId: cleanFieldValue(existingOpportunityContext.contact?.contactId),
        contactName: cleanFieldValue(existingOpportunityContext.contact?.displayName),
        location: cleanFieldValue(
          existingOpportunityContext.businessAccount?.location || existingOpportunityContext.location || payload.account?.location
        )
      });
    }
    if (!payload.divisions.length) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "At least one division is required.",
        correlationId
      });
    }
    const requiredOpportunityValidation = validateRequiredOpportunityInputs(payload);
    if (!requiredOpportunityValidation.valid) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: requiredOpportunityValidation.errors[0],
        correlationId
      });
    }
    const requiredDivisionValidation = validateDivisionCostInputs(payload);
    if (!requiredDivisionValidation.valid) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: requiredDivisionValidation.errors[0],
        correlationId
      });
    }

    const quoteSummary = buildQuoteSummary(payload);
    const quoteDateIso = new Date().toISOString();
    const { tasks, lines, breakdowns } = await buildTasksAndLines({
      divisions: payload.divisions,
      pickTemplate: pickTemplateItem,
      quoteDate: quoteDateIso
    });
    const generatedScopeNote = buildQuoteScopeNote(payload, { breakdowns });
    const sourceScopeNote = quoteBody || generatedScopeNote;
    let quoteScopeNote = sourceScopeNote;
    const scopePolishMeta = {
      attempted: Boolean(sourceScopeNote),
      generatedByAI: false,
      notes: ""
    };
    if (sourceScopeNote) {
      try {
        const grammarPolish = await polishQuoteBodyWithAI({
          apiKey: config.openaiApiKey,
          model: config.openaiModel,
          quoteBody: sourceScopeNote,
          quoteType: cleanString(payload?.quoteType || "production"),
          mode: "grammar"
        });
        const contextPolish = await polishQuoteBodyWithAI({
          apiKey: config.openaiApiKey,
          model: config.openaiModel,
          quoteBody: cleanString(grammarPolish?.polishedText || sourceScopeNote),
          quoteType: cleanString(payload?.quoteType || "production"),
          mode: "context"
        });
        quoteScopeNote = cleanString(contextPolish?.polishedText || grammarPolish?.polishedText || sourceScopeNote);
        scopePolishMeta.generatedByAI = Boolean(grammarPolish?.generatedByAI || contextPolish?.generatedByAI);
        scopePolishMeta.notes = [cleanString(grammarPolish?.notes), cleanString(contextPolish?.notes)].filter(Boolean).join(" | ");
      } catch (error) {
        scopePolishMeta.generatedByAI = false;
        scopePolishMeta.notes = error instanceof Error ? error.message : String(error || "Unknown AI scope polish error");
        console.warn(`[${correlationId}] Quote scope polish warning: ${scopePolishMeta.notes}`);
      }
    }
    const quoteDescription = resolveQuoteDescriptionFromRequest(req.body, payload, quoteSummary, quoteScopeNote);
    const generatedBackupSummary = buildQuoteBackupSummary(payload, {
      summary: quoteSummary,
      breakdowns,
      lines
    });
    const quoteBackupSummary = quoteScopeNote
      ? `${quoteScopeNote}\n\n${generatedBackupSummary}`
      : generatedBackupSummary;

    const businessAccount = existingOpportunityContext
      ? {
          id: cleanFieldValue(existingOpportunityContext.businessAccount?.businessAccountId),
          code: cleanFieldValue(existingOpportunityContext.businessAccount?.businessAccountId),
          name: cleanFieldValue(existingOpportunityContext.businessAccount?.name),
          location: cleanFieldValue(existingOpportunityContext.businessAccount?.location),
          owner: cleanFieldValue(existingOpportunityContext.businessAccount?.owner),
          address: existingOpportunityContext.businessAccount?.address || undefined
        }
      : await withUpstreamStep("business_account_lookup", () => acumatica.resolveBusinessAccount(payload.account));
    const contact = existingOpportunityContext
      ? {
          id: cleanFieldValue(existingOpportunityContext.contact?.contactId),
          displayName: cleanFieldValue(existingOpportunityContext.contact?.displayName),
          email: cleanFieldValue(existingOpportunityContext.contact?.email),
          phone: cleanFieldValue(existingOpportunityContext.contact?.phone),
          contactClass: cleanFieldValue(existingOpportunityContext.contact?.contactClass)
        }
      : await withUpstreamStep("contact_lookup", () =>
          acumatica.resolveContactForBusinessAccount(payload.account, businessAccount)
        );
    const signedInQuoteOwner = await resolveSignedInQuoteOwner({
      req,
      acumatica,
      correlationId
    });
    const uniqueClassCandidates = resolveOpportunityClassCandidates(payload);
    const requiredOpportunityAttributes = buildRequiredOpportunityAttributes(payload);
    const opportunityAttributes = mergeAttributeLists(
      config.acumatica?.opportunity?.attributes || [],
      requiredOpportunityAttributes
    );

    let opportunityId = cleanFieldValue(existingOpportunityContext?.opportunityId);
    let usedOpportunityClassId = cleanFieldValue(existingOpportunityContext?.classId);
    let lastOpportunityError = null;
    let createdOpportunity = false;
    const opportunityOwnerCandidates = Array.from(
      new Set(
        [
          cleanFieldValue(signedInQuoteOwner?.ownerId),
          cleanFieldValue(signedInQuoteOwner?.ownerName)
        ].filter(Boolean)
      )
    );
    if (!existingOpportunityContext) {
      for (const classId of uniqueClassCandidates) {
        const ownerValuesToTry = opportunityOwnerCandidates.length ? opportunityOwnerCandidates : [""];
        for (let ownerIndex = 0; ownerIndex < ownerValuesToTry.length; ownerIndex += 1) {
          const ownerValue = ownerValuesToTry[ownerIndex];
          try {
            const opportunityPayload = acumatica.buildOpportunityPayload({ fields: [] }, {
              classId,
              stage: resolveOpportunityStage(),
              businessAccountId: businessAccount.id,
              contactId: contact.id,
              location: payload.account.location || businessAccount.location,
              owner: ownerValue,
              subject: quoteDescription,
              note: quoteScopeNote,
              attributes: opportunityAttributes
            });
            const result = await withUpstreamStep("opportunity_create", () => acumatica.createOpportunity(opportunityPayload));
            opportunityId = cleanString(result?.opportunityId);
            if (opportunityId) {
              usedOpportunityClassId = classId;
              createdOpportunity = true;
              break;
            }
          } catch (error) {
            lastOpportunityError = error;
            if (isOpportunityClassNotFoundError(error)) break;
            const canRetryOwnerWithAlternateValue =
              ownerValuesToTry.length > 1 &&
              ownerIndex < ownerValuesToTry.length - 1 &&
              isOpportunityOwnerNotFoundError(error);
            if (canRetryOwnerWithAlternateValue) {
              continue;
            }
            throw error;
          }
        }
        if (opportunityId) break;
        if (lastOpportunityError && isOpportunityClassNotFoundError(lastOpportunityError)) continue;
        if (opportunityId) break;
      }
    }

    if (!opportunityId && lastOpportunityError) {
      throw lastOpportunityError;
    }

    if (!opportunityId) {
      throw new AcumaticaUpstreamError("opportunity_create", new Error("Acumatica did not return an opportunity id."));
    }

    const signedInOwnerId = cleanFieldValue(signedInQuoteOwner?.ownerId);
    if (signedInOwnerId) {
      try {
        const ownerAlreadyApplied = await withUpstreamStep("opportunity_owner_verify", () =>
          acumatica.opportunityMatchesOwner(opportunityId, signedInOwnerId)
        );
        if (!ownerAlreadyApplied) {
          await withUpstreamStep("opportunity_owner_update", () =>
            acumatica.updateOpportunityFields(opportunityId, {
              Owner: { value: signedInOwnerId }
            })
          );
          const ownerUpdated = await withUpstreamStep("opportunity_owner_verify", () =>
            acumatica.opportunityMatchesOwner(opportunityId, signedInOwnerId)
          );
          if (!ownerUpdated) {
            console.warn(
              `[${correlationId}] Opportunity ${opportunityId} owner verification did not confirm signed-in owner "${signedInOwnerId}" after update.`
            );
          }
        }
      } catch (error) {
        console.warn(
          `[${correlationId}] Opportunity ${opportunityId} owner assignment warning: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const quoteAttributes = mergeAttributeLists(requiredOpportunityAttributes);

    const templateCandidates = resolveProjectTemplateCandidates(payload);
    let quoteCreateResult = null;
    let usedProjectTemplate = "";
    let lastQuoteCreateError = null;

    for (const projectTemplate of templateCandidates) {
      try {
        const quotePayload = acumatica.buildQuotePayload({ fields: [] }, quoteDescription, {
          businessAccountId: businessAccount.id,
          contactId: contact.id,
          opportunityId,
          projectTemplate,
          subject: quoteDescription,
          description: quoteDescription,
          date: quoteDateIso,
          note: quoteScopeNote,
          attributes: quoteAttributes
        });
        quoteCreateResult = await withUpstreamStep("quote_create", () => acumatica.createQuote(quotePayload));
        usedProjectTemplate = projectTemplate;
        break;
      } catch (error) {
        lastQuoteCreateError = error;
        if (isProjectTemplateNotFoundError(error)) continue;
        throw error;
      }
    }

    if (!quoteCreateResult && lastQuoteCreateError) {
      throw lastQuoteCreateError;
    }

    const { response, meta: quoteMeta } = quoteCreateResult || {};
    const extractedQuoteId = acumatica.extractQuoteId(response);
    const quoteNbr = acumatica.extractQuoteNumber(response) || acumatica.extractQuoteKey(response) || extractedQuoteId;
    const quoteIdLooksLikeGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      extractedQuoteId
    );
    const quoteId = quoteIdLooksLikeGuid && extractedQuoteId !== quoteNbr ? "" : extractedQuoteId;

    if (!quoteNbr) {
      throw new AcumaticaUpstreamError("quote_create", new Error("Acumatica did not return a quote number."));
    }

    if (tasks.length || lines.length) {
      try {
        await withUpstreamStep("quote_update", () =>
          acumatica.applyTasksAndLines(
            {
              quoteNbr,
              quoteId
            },
            tasks,
            lines,
            {
              entityName: quoteMeta?.entityName,
              meta: quoteMeta
            }
          )
        );
      } catch (error) {
        const context = `entity=${cleanString(quoteMeta?.entityName)} quoteNbr=${quoteNbr} quoteId=${quoteId} tasks=${tasks.length} lines=${lines.length}`;
        const message = error instanceof Error ? error.message : String(error || "Unknown quote update error");
        throw new AcumaticaUpstreamError("quote_update", new Error(`${message}. ${context}`));
      }
    }

    const quoteTotals = {
      subtotal: roundTo(buildLineSubtotal(lines), 2),
      taxRate: parseNumber(config.quotePdf?.taxRate, 0.13)
    };
    quoteTotals.tax = roundTo(quoteTotals.subtotal * quoteTotals.taxRate, 2);
    quoteTotals.total = roundTo(quoteTotals.subtotal + quoteTotals.tax, 2);

    const quoteFile = {
      attempted: false,
      attached: false,
      fileName: "",
      message: "",
      driveFileUrl: "",
      driveFileId: ""
    };

    if (config.quotePdf?.attachOnCreate !== false) {
      quoteFile.attempted = true;
      const quoteNumberForFile = cleanString(quoteNbr || extractedQuoteId || quoteId || "PENDING");
      const fallbackAccount = {
        ...businessAccount,
        ...payload.account
      };
      const billTo = buildPdfAddressObject(req.body?.billTo || fallbackAccount);
      const shipTo = buildPdfAddressObject(req.body?.shipTo || billTo || fallbackAccount);
      const salesRep = resolveSalesRepForQuotePdf({
        requestBody: req.body,
        payload,
        businessAccount,
        contact
      });
      const backupOptions = {
        payload,
        quoteNumber: quoteNumberForFile,
        transactionDate: quoteDateIso,
        salesRep,
        statementOfWork: quoteScopeNote,
        billTo,
        shipTo,
        subtotal: quoteTotals.subtotal,
        tax: quoteTotals.tax,
        total: quoteTotals.total
      };

      try {
        const pdfResult = await renderQuoteBackupPdfResult(backupOptions);
        const pdfBytes = pdfResult?.pdfBytes;
        if (!pdfBytes) {
          throw new Error("Quote backup PDF generation returned no file bytes.");
        }

        const fileName = buildQuoteBackupFilename(quoteNumberForFile);
        quoteFile.fileName = fileName;
        quoteFile.driveFileUrl = cleanString(pdfResult?.driveFile?.webViewLink);
        quoteFile.driveFileId = cleanString(pdfResult?.driveFile?.id);

        await withUpstreamStep("quote_file_upload", () =>
          acumatica.uploadQuoteFile(
            {
              quoteNbr,
              quoteId: extractedQuoteId || quoteId
            },
            fileName,
            pdfBytes,
            {
              entityName: quoteMeta?.entityName,
              quotePayload: response
            }
          )
        );

        quoteFile.attached = true;
      } catch (error) {
        quoteFile.attached = false;
        quoteFile.message = error instanceof Error ? error.message : String(error || "Unknown quote file upload error");
        console.warn(`[${correlationId}] Quote file attachment warning: ${quoteFile.message}`);
        if (config.quotePdf?.attachRequired === true) {
          throw error;
        }
      }
    }

    let pricingBook = {
      attempted: false,
      created: false,
      disabled: false,
      mode: "",
      actionName: cleanString(config.acumatica?.pricingBook?.actionName || "CreatePricingBook"),
      message: "",
      sheetUrl: "",
      fileId: "",
      seed: {
        attempted: false,
        seeded: false,
        message: ""
      }
    };

    let pricingBookResult = null;
    let serviceCreateResult = null;
    if (config.acumatica?.pricingBook?.autoCreate !== false) {
      pricingBook.attempted = true;
      let pricingBookActionError = "";
      try {
        pricingBookResult = await withUpstreamStep("pricing_book_create", () =>
          acumatica.createPricingBookForQuote(
            {
              quoteNbr,
              quoteId: extractedQuoteId || quoteId
            },
            {
              entityName: quoteMeta?.entityName,
              actionName: pricingBook.actionName
            }
          )
        );

        pricingBook = {
          attempted: true,
          created: Boolean(pricingBookResult?.created || pricingBookResult?.success),
          disabled: Boolean(pricingBookResult?.disabled),
          mode: cleanString(pricingBookResult?.mode),
          actionName: pricingBook.actionName,
          message: cleanString(pricingBookResult?.message || serviceCreateResult?.message),
          sheetUrl: normalizeSpreadsheetEditUrl(pricingBookResult?.sheetUrl),
          fileId: cleanString(pricingBookResult?.fileId)
        };

        if (pricingBook.created && !pricingBook.sheetUrl) {
          const lookupAttempts = 5;
          let lookupError = "";
          for (let attempt = 1; attempt <= lookupAttempts; attempt += 1) {
            try {
              const backupRef = await withUpstreamStep("pricing_book_link_lookup", () =>
                acumatica.getQuoteBackupLink(
                  {
                    quoteNbr,
                    quoteId: extractedQuoteId || quoteId
                  },
                  {
                    entityName: quoteMeta?.entityName || config.acumatica.quoteEntity
                  }
                )
              );
              const foundUrl = normalizeSpreadsheetEditUrl(backupRef?.link);
              if (foundUrl) {
                pricingBook.sheetUrl = foundUrl;
                pricingBook.fileId = cleanString(backupRef?.fileId || extractSpreadsheetIdFromUrl(foundUrl));
                break;
              }
            } catch (error) {
              lookupError = error instanceof Error ? error.message : String(error || "Unknown pricing-book lookup error");
            }

            if (attempt < lookupAttempts) {
              await delay(350 * attempt);
            }
          }

          if (!pricingBook.sheetUrl) {
            pricingBook.created = false;
            pricingBook.mode = cleanString(pricingBook.mode || "unverified");
            pricingBook.message = [
              cleanString(pricingBook.message),
              cleanString(lookupError),
              "Pricing-book action did not return a BACKUP link."
            ]
              .filter(Boolean)
              .join(" | ");
          }
        }
      } catch (error) {
        if (error instanceof ApiAuthError) throw error;
        if (error instanceof AcumaticaValidationError) throw error;
        pricingBookActionError = error instanceof Error ? error.message : String(error || "Unknown pricing book action error");
        pricingBook.message = cleanString(pricingBookActionError);
        console.warn(`[${correlationId}] Pricing book action warning: ${pricingBookActionError}`);
      }

      if (!pricingBook.created) {
        try {
          serviceCreateResult = await createPricingBookWorkbookFromService({
            payload,
            businessAccount,
            contact,
            quoteNbr,
            opportunityId,
            quoteSummary: quoteDescription,
            breakdowns,
            quoteBackupSummary
          });
        } catch (error) {
          serviceCreateResult = {
            attempted: true,
            created: false,
            message: error instanceof Error ? error.message : String(error || "Unknown pricing book service create error")
          };
        }

        if (serviceCreateResult?.created && serviceCreateResult?.sheetUrl) {
          pricingBook = {
            attempted: true,
            created: true,
            disabled: false,
            mode: cleanString(serviceCreateResult.mode || "service"),
            actionName: pricingBook.actionName,
            message: [cleanString(pricingBookActionError), cleanString(serviceCreateResult.message || "")].filter(Boolean).join(" | "),
            sheetUrl: normalizeSpreadsheetEditUrl(serviceCreateResult.sheetUrl),
            fileId: cleanString(serviceCreateResult.fileId),
            seed: {
              attempted: true,
              seeded: Boolean(serviceCreateResult?.seed?.seeded),
              rowsWritten: parseNumber(serviceCreateResult?.seed?.rowsWritten),
              sheetsTouched: parseNumber(serviceCreateResult?.seed?.sheetsTouched),
              summaryApplied: Boolean(serviceCreateResult?.seed?.summaryApplied),
              message: cleanString(serviceCreateResult?.seed?.message || "")
            }
          };
        } else {
          pricingBook.message = [
            cleanString(pricingBook.message || pricingBookActionError),
            cleanString(serviceCreateResult?.message || "")
          ]
            .filter(Boolean)
            .join(" | ");
        }
      }

      if (pricingBook.created && (!pricingBook.seed?.seeded || pricingBook.seed?.summaryApplied !== true)) {
        pricingBook.seed = await seedPricingBookWorkbook({
          acumatica,
          payload,
          quoteNbr,
          quoteId: extractedQuoteId || quoteId,
          opportunityId,
          quoteSummary: quoteDescription,
          breakdowns,
          pricingBookResult: {
            ...(pricingBookResult || {}),
            sheetUrl: pricingBook.sheetUrl || pricingBookResult?.sheetUrl || serviceCreateResult?.sheetUrl,
            fileId:
              pricingBook.fileId ||
              pricingBookResult?.fileId ||
              serviceCreateResult?.fileId ||
              extractSpreadsheetIdFromUrl(pricingBook.sheetUrl || pricingBookResult?.sheetUrl || serviceCreateResult?.sheetUrl)
          },
          quoteBackupSummary
        });

        const seedFailed = pricingBook.seed?.attempted && (!pricingBook.seed?.seeded || pricingBook.seed?.summaryApplied !== true);
        const isServiceMode = cleanString(pricingBook.mode).toLowerCase() === "service";
        if (seedFailed) {
          try {
            const serviceFallbackResult = await createPricingBookWorkbookFromService({
              payload,
              businessAccount,
              contact,
              quoteNbr,
              opportunityId,
              quoteSummary: quoteDescription,
              breakdowns,
              quoteBackupSummary
            });
            if (serviceFallbackResult?.created && serviceFallbackResult?.seed?.summaryApplied === true) {
              const fallbackSheetUrl = normalizeSpreadsheetEditUrl(serviceFallbackResult.sheetUrl);
              pricingBook.mode = isServiceMode ? "service_regen" : "service_fallback";
              pricingBook.sheetUrl = fallbackSheetUrl;
              pricingBook.fileId = cleanString(serviceFallbackResult.fileId || extractSpreadsheetIdFromUrl(fallbackSheetUrl));
              pricingBook.seed = {
                attempted: true,
                seeded: Boolean(serviceFallbackResult?.seed?.seeded),
                rowsWritten: parseNumber(serviceFallbackResult?.seed?.rowsWritten),
                sheetsTouched: parseNumber(serviceFallbackResult?.seed?.sheetsTouched),
                summaryApplied: Boolean(serviceFallbackResult?.seed?.summaryApplied),
                message: cleanString(serviceFallbackResult?.seed?.message || "")
              };
              pricingBook.message = [
                cleanString(pricingBook.message),
                isServiceMode
                  ? "Service workbook summary was incomplete; regenerated and switched to a fully seeded workbook."
                  : "Workbook seed on Acumatica-created file failed; switched BACKUP link to service-generated seeded workbook."
              ]
                .filter(Boolean)
                .join(" | ");
            } else {
              pricingBook.message = [
                cleanString(pricingBook.message),
                cleanString(serviceFallbackResult?.message || ""),
                isServiceMode
                  ? "Workbook summary generation remained incomplete after service regeneration."
                  : "Workbook seed failed and service fallback did not produce a seeded summary."
              ]
                .filter(Boolean)
                .join(" | ");
            }
          } catch (error) {
            const fallbackError = error instanceof Error ? error.message : String(error || "Unknown pricing-book fallback error");
            pricingBook.message = [cleanString(pricingBook.message), fallbackError].filter(Boolean).join(" | ");
          }
        }
      }

      let pricingBookLinkMessage = "";
      let pricingBookSheetUrl = normalizeSpreadsheetEditUrl(
        pricingBook.sheetUrl || pricingBookResult?.sheetUrl || serviceCreateResult?.sheetUrl
      );
      let pricingBookFileId = cleanString(
        pricingBook.fileId || pricingBookResult?.fileId || serviceCreateResult?.fileId || extractSpreadsheetIdFromUrl(pricingBookSheetUrl)
      );

      if (!pricingBookSheetUrl && pricingBook.created) {
        try {
          const backupRef = await withUpstreamStep("pricing_book_link_lookup", () =>
            acumatica.getQuoteBackupLink(
              {
                quoteNbr,
                quoteId: extractedQuoteId || quoteId
              },
              {
                entityName: quoteMeta?.entityName || config.acumatica.quoteEntity
              }
            )
          );
          pricingBookSheetUrl = normalizeSpreadsheetEditUrl(backupRef?.link);
          pricingBookFileId = cleanString(backupRef?.fileId || extractSpreadsheetIdFromUrl(pricingBookSheetUrl));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "Unknown pricing book link lookup error");
          pricingBookLinkMessage = `Pricing book created but link lookup failed: ${message}`;
          console.warn(`[${correlationId}] ${pricingBookLinkMessage}`);
        }
      }

      if (pricingBook.created && pricingBookFileId) {
        const structuredWorkbookResult = await applyStructuredPricingBookWorkbook({
          fileId: pricingBookFileId,
          payload,
          quoteSummary: quoteDescription,
          quoteNbr,
          opportunityId,
          breakdowns,
          quoteBackupSummary
        });
        if (structuredWorkbookResult?.attempted) {
          const existingSeed = pricingBook.seed || {};
          pricingBook.seed = {
            attempted: Boolean(existingSeed?.attempted) || Boolean(structuredWorkbookResult?.attempted),
            seeded: Boolean(existingSeed?.seeded) || Boolean(structuredWorkbookResult?.seeded),
            rowsWritten:
              parseNumber(existingSeed?.rowsWritten, 0) + parseNumber(structuredWorkbookResult?.rowsWritten, 0),
            sheetsTouched: Math.max(
              parseNumber(existingSeed?.sheetsTouched, 0),
              parseNumber(structuredWorkbookResult?.sheetsTouched, 0)
            ),
            summaryApplied:
              Boolean(existingSeed?.summaryApplied) || Boolean(structuredWorkbookResult?.summaryApplied),
            message: [cleanString(existingSeed?.message), cleanString(structuredWorkbookResult?.message)]
              .filter(Boolean)
              .join(" | ")
          };
        }
      }

      const seedReadyForBackupLink = !pricingBook.seed?.attempted || pricingBook.seed?.summaryApplied === true;
      if (pricingBookSheetUrl && seedReadyForBackupLink) {
        try {
          const pricingBookLinkUpdateResult = await withUpstreamStep("pricing_book_link_update", () =>
            acumatica.updateQuoteAttributes(
              {
                quoteNbr,
                quoteId: extractedQuoteId || quoteId
              },
              [{ attributeId: "BACKUP", value: normalizeSpreadsheetEditUrl(pricingBookSheetUrl) }],
              {
                entityName: quoteMeta?.entityName
              }
            )
          );
          pricingBook.backupAttributeWriteAccepted = true;

          const expectedPricingBookUrl = normalizeSpreadsheetEditUrl(pricingBookSheetUrl);
          let resolvedPricingBookUrl = normalizeSpreadsheetEditUrl(pricingBookLinkUpdateResult?.backupLink);

          if (!resolvedPricingBookUrl) {
            try {
              const backupRef = await withUpstreamStep("pricing_book_link_verify", () =>
                acumatica.getQuoteBackupLink(
                  {
                    quoteNbr,
                    quoteId: extractedQuoteId || quoteId
                  },
                  {
                    entityName: cleanString(pricingBookLinkUpdateResult?.entityName || quoteMeta?.entityName)
                  }
                )
              );
              resolvedPricingBookUrl = normalizeSpreadsheetEditUrl(backupRef?.link);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error || "Unknown pricing book link verify error");
              pricingBookLinkMessage = [cleanString(pricingBookLinkMessage), `Pricing book BACKUP verification failed: ${message}`]
                .filter(Boolean)
                .join(" | ");
              console.warn(`[${correlationId}] ${message}`);
            }
          }

          const backupLinkMatches =
            Boolean(expectedPricingBookUrl) &&
            Boolean(resolvedPricingBookUrl) &&
            resolvedPricingBookUrl === expectedPricingBookUrl;

          pricingBook.backupAttributeUpdated = backupLinkMatches;
          if (resolvedPricingBookUrl) {
            pricingBook.backupAttributeResolvedUrl = resolvedPricingBookUrl;
          }

          if (!backupLinkMatches) {
            const verificationMessage = resolvedPricingBookUrl
              ? `Pricing book BACKUP attribute resolved to a different workbook than expected: ${resolvedPricingBookUrl}`
              : "Pricing book BACKUP attribute write was accepted but could not be verified from the quote record.";
            pricingBookLinkMessage = [cleanString(pricingBookLinkMessage), verificationMessage]
              .filter(Boolean)
              .join(" | ");
          }
        } catch (error) {
          pricingBook.backupAttributeUpdated = false;
          pricingBook.backupAttributeWriteAccepted = false;
          const message = error instanceof Error ? error.message : String(error || "Unknown pricing book link update error");
          pricingBookLinkMessage = `Pricing book link found but BACKUP attribute update failed: ${message}`;
          console.warn(`[${correlationId}] ${pricingBookLinkMessage}`);
        }
      } else if (pricingBookSheetUrl && !seedReadyForBackupLink) {
        pricingBook.backupAttributeUpdated = false;
        pricingBook.backupAttributeWriteAccepted = false;
        pricingBookLinkMessage = "Pricing book workbook exists but seed summary is incomplete, so BACKUP link was not updated.";
      } else if (pricingBook.created) {
        pricingBook.backupAttributeUpdated = false;
        pricingBook.backupAttributeWriteAccepted = false;
        pricingBookLinkMessage = "Pricing book created but workbook URL was not returned.";
      }

      if (pricingBookSheetUrl) {
        pricingBook.sheetUrl = pricingBookSheetUrl;
      }
      if (pricingBookFileId) {
        pricingBook.fileId = pricingBookFileId;
      }
      if (pricingBookLinkMessage) {
        pricingBook.message = [cleanString(pricingBook.message), pricingBookLinkMessage].filter(Boolean).join(" | ");
      }

      if (config.acumatica?.pricingBook?.required && !pricingBook.created) {
        throw new AcumaticaUpstreamError(
          "pricing_book_create",
          new Error(pricingBook.message || "Pricing book was not created.")
        );
      }
      if (config.acumatica?.pricingBook?.required && pricingBook.seed?.attempted && pricingBook.seed?.summaryApplied !== true) {
        throw new AcumaticaUpstreamError(
          "pricing_book_seed",
          new Error(pricingBook.message || "Pricing book workbook seed did not apply the summary.")
        );
      }
    }

    const quoteUrl = buildAcumaticaQuoteUrl(quoteNbr);
    const pricingBookSeedPreviewRows = buildPricingBookSeedRows(breakdowns);
    const pricingBookSeedPreviewSections = buildPricingBookScopeSections(breakdowns);
    const pricingBookSeedPreviewMainEstimate = buildPricingBookMainEstimate({
      payload,
      quoteSummary: quoteDescription,
      divisionRows: pricingBookSeedPreviewRows,
      opportunityId,
      quoteNbr
    });
    pricingBook.seedPreview = {
      divisionCount: pricingBookSeedPreviewSections.length,
      projectBudget: pricingBookSeedPreviewMainEstimate.projectBudget,
      projectSellingPrice: pricingBookSeedPreviewMainEstimate.projectSellingPrice,
      grandTotal: pricingBookSeedPreviewMainEstimate.grandTotal,
      rows: pricingBookSeedPreviewRows.slice(0, 12).map((row) => ({
        divisionKey: cleanString(row?.divisionKey),
        taskCd: cleanString(row?.taskCd),
        description: cleanString(row?.description),
        labourHours: parseNumber(row?.labourHours),
        labourCost: parseNumber(row?.labourCost),
        materialCost: parseNumber(row?.materialCost),
        subcontractorCost: parseNumber(row?.subcontractorCost),
        totalCost: parseNumber(row?.totalCost),
        totalSell: parseNumber(row?.totalSell)
      }))
    };

    res.json({
      quoteNbr,
      quoteUrl,
      quoteDescription,
      opportunityId,
      createdOpportunity,
      businessAccountId: businessAccount.id,
      contactId: contact.id,
      opportunityClassId: usedOpportunityClassId,
      projectType: resolveProjectTypeFromPayload(payload),
      opportunityAttributes: requiredOpportunityAttributes,
      quoteAttributes,
      projectTemplate: usedProjectTemplate,
      tasksCount: tasks.length,
      linesCount: lines.length,
      pricingBook,
      quoteFile,
      scopePolish: scopePolishMeta,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.get("/api/opportunity-context/:opportunityId", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    const acumatica = requireAcumaticaClient(req);
    const opportunityId = cleanString(req.params?.opportunityId);
    if (!opportunityId) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "Opportunity ID is required.",
        correlationId
      });
    }

    const context = await loadExistingOpportunityContext({
      acumatica,
      opportunityId
    });

    return res.json({
      opportunityId: cleanString(context.opportunityId),
      subject: cleanString(context.subject),
      description: cleanString(context.description),
      branch: cleanString(context.branch),
      classId: cleanString(context.classId),
      stage: cleanString(context.stage),
      owner: cleanString(context.owner),
      location: cleanString(context.location),
      quoteType: cleanString(context.quoteType),
      businessAccountId: cleanFieldValue(context.businessAccount?.businessAccountId),
      businessAccountName: cleanFieldValue(context.businessAccount?.name),
      contactId: cleanFieldValue(context.contact?.contactId),
      contactName: cleanFieldValue(context.contact?.displayName),
      businessAccount: context.businessAccount,
      contact: context.contact,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    if (error instanceof AcumaticaValidationError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId,
        ...(error.details || {})
      });
    }
    if (error instanceof AcumaticaUpstreamError) {
      return res.status(error.status).json({
        code: error.code || "ACUMATICA_UPSTREAM_ERROR",
        error: error.message,
        step: error.step,
        correlationId
      });
    }
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      error: error instanceof Error ? error.message : "Unknown error",
      correlationId
    });
  }
});

app.get("/api/quote/:quoteNbr/url", async (req, res) => {
  const correlationId = crypto.randomUUID();
  try {
    requireAcumaticaClient(req);
    const quoteNbr = cleanString(req.params?.quoteNbr);
    if (!quoteNbr) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "quoteNbr is required.",
        correlationId
      });
    }

    const quoteUrl = buildAcumaticaQuoteUrl(quoteNbr);
    if (!quoteUrl) {
      return res.status(500).json({
        code: "CONFIGURATION_ERROR",
        error: "Unable to build Acumatica quote URL. Check ACU_BASE_URL, ACU_COMPANY, and ACU_QUOTE_SCREEN_ID.",
        correlationId
      });
    }

    res.json({
      quoteNbr,
      quoteUrl,
      correlationId
    });
  } catch (error) {
    console.error(`[${correlationId}]`, error);
    if (error instanceof ApiAuthError) {
      return res.status(error.status).json({
        code: error.code,
        error: error.message,
        correlationId
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: message,
      correlationId
    });
  }
});

app.post("/api/estimate-library/sync", async (req, res) => {
  try {
    requireAppSession(req);
    const result = await runHistoricalEstimateLibrarySync({
      runId: cleanString(req.body?.runId),
      maxFiles: parseNumber(req.body?.maxFiles, config.estimateLibrary.syncMaxFilesPerRun || 25)
    });
    res.json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return res.status(error.status || 401).json({
        code: error.code,
        error: error.message
      });
    }
    return res.status(500).json({
      code: "ESTIMATE_LIBRARY_SYNC_ERROR",
      error: error instanceof Error ? error.message : "Estimate library sync failed."
    });
  }
});

app.get("/api/estimate-library/sync/:runId", async (req, res) => {
  try {
    requireAppSession(req);
    const result = await getHistoricalEstimateLibraryStatus(cleanString(req.params?.runId || "latest") || "latest");
    res.json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return res.status(error.status || 401).json({
        code: error.code,
        error: error.message
      });
    }
    return res.status(500).json({
      code: "ESTIMATE_LIBRARY_STATUS_ERROR",
      error: error instanceof Error ? error.message : "Estimate library status lookup failed."
    });
  }
});

app.get("/api/estimate-library/reviews", async (req, res) => {
  try {
    requireAppSession(req);
    const items = await listHistoricalEstimateLibraryReviews(parseNumber(req.query?.limit, 25));
    res.json({ items });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return res.status(error.status || 401).json({
        code: error.code,
        error: error.message
      });
    }
    return res.status(500).json({
      code: "ESTIMATE_LIBRARY_REVIEWS_ERROR",
      error: error instanceof Error ? error.message : "Estimate library reviews lookup failed."
    });
  }
});

app.post("/api/estimate-library/feedback", async (req, res) => {
  try {
    requireAppSession(req);
    const normalized = normalizePayload(req.body || {});
    if (!normalized.divisions.length) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        error: "At least one selected division is required."
      });
    }

    const result = await recordHistoricalEstimateFeedback({
      quoteType: cleanString(req.body?.quoteType || normalized.quoteType || "production"),
      account: normalized.account,
      opportunity: normalized.opportunity,
      divisions: normalized.divisions,
      quoteBody: cleanString(req.body?.quoteBody),
      quoteDescription: cleanString(req.body?.quoteDescription),
      pricingPosture: cleanString(req.body?.pricingPosture || "premium_high") || "premium_high",
      sourceKind: cleanString(req.body?.sourceKind || "manual_feedback") || "manual_feedback",
      prototypeDraftId: cleanString(req.body?.prototypeDraftId),
      feedbackId: cleanString(req.body?.feedbackId),
      quoteMetadata: req.body?.quoteMetadata || {}
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return res.status(error.status || 401).json({
        code: error.code,
        error: error.message
      });
    }
    return res.status(500).json({
      code: "ESTIMATE_LIBRARY_FEEDBACK_ERROR",
      error: error instanceof Error ? error.message : "Estimate feedback save failed."
    });
  }
});

app.post("/api/estimate-library/suggest", async (req, res) => {
  try {
    requireAppSession(req);
    const divisions = Array.isArray(req.body?.divisions)
      ? req.body.divisions.map((division) => ({
          sectionId: cleanString(division?.sectionId),
          id: cleanString(division?.id || division?.divisionId || division?.title),
          title: cleanString(division?.title || division?.id),
          scope: cleanString(division?.scope),
          scopeLines: Array.isArray(division?.scopeLines)
            ? division.scopeLines.map((line, index) => ({
                scopeLineKey: cleanString(line?.scopeLineKey || `scope-line-${index + 1}`),
                lineNumber: cleanString(line?.lineNumber || String(index + 1)),
                sourceText: cleanString(line?.sourceText || line?.text || line?.normalizedText)
              }))
            : []
        }))
      : [];
    const result = await suggestHistoricalEstimateMatches({ divisions });
    res.json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return res.status(error.status || 401).json({
        code: error.code,
        error: error.message
      });
    }
    return res.status(500).json({
      code: "ESTIMATE_LIBRARY_SUGGEST_ERROR",
      error: error instanceof Error ? error.message : "Estimate library suggestion lookup failed."
    });
  }
});

app.get("/", (_req, res) => {
  if (INTEGRATED_AUTH_ENABLED && !resolveIntegratedSession(_req)) {
    const requestedPath = cleanString(_req.originalUrl || _req.url || INTEGRATED_QUOTES_PATH) || INTEGRATED_QUOTES_PATH;
    const nextTarget = requestedPath.startsWith("/") ? requestedPath : INTEGRATED_QUOTES_PATH;
    const redirectTarget = `${INTEGRATED_SIGNIN_PATH}?next=${encodeURIComponent(nextTarget)}`;
    return res.redirect(302, redirectTarget);
  }
  res.sendFile(path.join(publicDir, "index.html"));
});

export function startPricingBookAutoSync(logger = console) {
  startHistoricalEstimateLibraryAutoSync(logger);
}

export { app };
