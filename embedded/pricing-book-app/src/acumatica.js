import { config } from "./config.js";

const DEFAULT_QUOTE_ENTITY_CANDIDATES = [
  "ProjectQuote",
  "ProjectQuotes",
  "PMQuote",
  "Quote",
  "Quotes"
];

const DEFAULT_OPPORTUNITY_ENTITY_CANDIDATES = ["Opportunity", "Opportunities", "CROpportunity"];
const DEFAULT_BUSINESS_ACCOUNT_ENTITY_CANDIDATES = [
  "BusinessAccount",
  "BusinessAccounts",
  "Customer",
  "Customers",
  "BAccount"
];
const DEFAULT_CONTACT_ENTITY_CANDIDATES = ["Contact", "Contacts", "CRContact"];
const DEFAULT_EMPLOYEE_ENTITY_CANDIDATES = ["Employee", "Employees", "EPEmployee"];

const TASK_DETAIL_CANDIDATES = ["Tasks", "ProjectTasks", "QuoteTasks", "PMQuoteTasks"];

const LINE_DETAIL_CANDIDATES = ["Estimation", "Products", "Details", "QuoteDetails", "QuoteLines", "LineItems"];

const FIELD_CANDIDATES = {
  key: ["QuoteNbr", "QuoteNumber", "QuoteID", "QuoteID", "ID"],
  quoteNbr: ["QuoteNbr", "QuoteNumber"],
  quoteId: ["QuoteID", "QuoteId", "ID"],
  quoteSubject: ["Subject", "Summary"],
  description: ["Description", "Subject", "Summary", "QuoteDescription"],
  note: ["note", "Note", "Notes"],
  attributes: ["Attributes"],
  businessAccount: ["BusinessAccount", "BusinessAccountID", "BusinessAccountCD", "BAccountID", "AccountID"],
  contact: ["Contact", "ContactID", "ContactId"],
  date: ["Date", "QuoteDate"],
  projectTemplate: ["ProjectTemplate", "Template", "ProjectTemplateID"],
  task: ["Task", "ProjectTask", "TaskID", "TaskCD", "ProjectTaskID"],
  taskDescription: ["Description", "TaskDescription"],
  taskType: ["Type", "TaskType"],
  taskDefault: ["Default", "IsDefault"],
  plannedStartDate: ["PlannedStartDate", "StartDate", "PlannedStart"],
  plannedEndDate: ["PlannedEndDate", "EndDate", "PlannedEnd"],
  expenseGroup: ["CostAccountGroup", "ExpenseAccountGroup", "ExpenseAccountGroupID", "ExpenseAccountGroupCd"],
  revenueGroup: ["RevenueAccountGroup", "RevenueAccountGroupID", "RevenueAccountGroupCd"],
  costCode: ["CostCode", "CostCodeID", "CostCodeCd"],
  uom: ["UOM", "Uom", "UnitOfMeasure"],
  quantity: ["Quantity", "Qty"],
  unitCost: ["UnitCost", "CuryUnitCost"],
  unitPrice: ["UnitPrice", "CuryUnitPrice"],
  taxCategory: ["TaxCategory", "TaxCategoryID"],
  estimator: ["Estimator", "EstimatorID", "EstimatorId"],
  tradeDivision: ["TradeNMSDivision", "TradeDivision", "Division"],
  manualPrice: ["ManualPrice"],
  manualDiscount: ["ManualDiscount"],
  discount: ["Discount"],
  inventoryId: ["InventoryID", "InventoryId", "Inventory", "InventoryItem"],
  opportunityId: ["OpportunityID", "OpportunityId", "Opportunity", "OpportunityNbr"]
};

const OPPORTUNITY_FIELD_CANDIDATES = {
  id: ["OpportunityID", "OpportunityId", "OpportunityNbr", "ID"],
  classId: ["ClassID", "ClassId", "OpportunityClass", "OpportunityClassID"],
  businessAccount: ["BusinessAccount", "BusinessAccountID", "BusinessAccountCD", "BAccountID", "AccountID"],
  location: ["Location", "LocationID", "LocationCD"],
  contactId: ["ContactID", "ContactId", "Contact"],
  stage: ["Stage", "StageID", "OpportunityStage"],
  owner: ["Owner", "OwnerID", "WorkgroupOwner", "OwnerName"],
  subject: ["Subject", "Description", "Summary"],
  estimation: ["Estimation", "EstimationDate", "Date"],
  note: ["note", "Note", "Notes"],
  attributes: ["Attributes"]
};

const BUSINESS_ACCOUNT_FIELD_CANDIDATES = {
  id: ["BusinessAccount", "BusinessAccountID", "BusinessAccountCD", "BAccountID", "AccountCD", "CustomerID", "ID"],
  code: ["AcctCD", "AccountCD", "BusinessAccountCD", "CustomerCD", "CD"],
  name: ["AccountName", "BusinessAccountName", "Name", "Description"],
  location: ["Location", "DefaultLocation", "LocationCD", "LocationID"],
  owner: ["OwnerEmployeeName", "OwnerName", "OwnerContact", "Owner"],
  ownerId: ["Owner", "OwnerID", "WorkgroupOwner"]
};

const CONTACT_FIELD_CANDIDATES = {
  id: ["ContactID", "ContactId", "ID"],
  displayName: ["DisplayName", "ContactName", "FullName", "Name"],
  firstName: ["FirstName", "First"],
  lastName: ["LastName", "Last"],
  email: ["Email", "EMail", "EmailAddress"],
  phone: ["Phone1", "Phone", "BusinessPhone", "CellPhone", "WorkPhone"],
  businessAccountRef: ["BusinessAccount", "BusinessAccountID", "BusinessAccountCD", "BAccountID", "BAccountCD", "AccountID", "AccountCD", "CustomerID"],
  contactClass: ["ClassID", "ClassId", "ContactClass", "ContactClassID"]
};

const EMPLOYEE_FIELD_CANDIDATES = {
  id: ["EmployeeID", "AcctCD", "BAccountID", "UserID", "ContactID", "ID"],
  name: ["EmployeeName", "DisplayName", "Name", "AcctName", "Description", "ContactName"],
  firstName: ["FirstName", "First"],
  lastName: ["LastName", "Last"],
  email: ["Email", "EMail", "EmailAddress", "Username"],
  status: ["Status", "EmploymentStatus", "Active", "IsActive", "Disabled", "Terminated"]
};

const BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES = {
  id: ["BusinessAccountID", "BusinessAccountCD", "BAccountID", "AccountCD", "CustomerID", "ID"],
  name: ["Name", "AccountName", "BusinessAccountName", "Description"],
  email: ["Email", "EMail", "EmailAddress"],
  phone: ["Phone1", "Phone", "BusinessPhone", "MainPhone"],
  addressLine1: ["AddressLine1"],
  addressLine2: ["AddressLine2"],
  city: ["City"],
  state: ["State", "Province"],
  postalCode: ["PostalCode", "ZipCode", "Zip"],
  country: ["Country"],
  ownerId: ["Owner", "OwnerID", "OwnerEmployeeID", "WorkgroupOwner"]
};

const CONTACT_CREATE_FIELD_CANDIDATES = {
  displayName: ["DisplayName", "Contact", "ContactName", "FullName", "Name"],
  firstName: ["FirstName", "First"],
  lastName: ["LastName", "Last"],
  email: ["Email", "EMail", "EmailAddress"],
  phone: ["Phone1", "Phone", "BusinessPhone", "CellPhone", "WorkPhone"],
  businessAccount: ["BusinessAccount", "BusinessAccountID", "BusinessAccountCD", "BAccountID", "AccountID", "CustomerID"],
  contactClass: ["ClassID", "ClassId", "ContactClass", "ContactClassID"]
};

const DEFAULT_ALLOWED_UOMS = new Set(
  (Array.isArray(config.acumatica?.allowedUoms) ? config.acumatica.allowedUoms : [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
);

const UOM_ALIAS_MAP = new Map([
  ["HR", "HOUR"],
  ["HRS", "HOUR"],
  ["HUR", "HOUR"],
  ["LTR", "LITER"],
  ["MTR", "METER"],
  ["MIN", "MINUTE"],
  ["KGM", "KG"],
  ["PCB", "PIECE"],
  ["NMP", "PACK"],
  ["SQM", "METER"],
  ["LM", "METER"]
]);

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeUomToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function resolveAcumaticaCompatibleUom(value = "", fallbackValue = "") {
  const primaryCandidate = UOM_ALIAS_MAP.get(normalizeUomToken(value)) || normalizeUomToken(value);
  if (primaryCandidate && DEFAULT_ALLOWED_UOMS.has(primaryCandidate)) {
    return primaryCandidate;
  }
  const fallbackCandidate = UOM_ALIAS_MAP.get(normalizeUomToken(fallbackValue)) || normalizeUomToken(fallbackValue);
  if (fallbackCandidate && DEFAULT_ALLOWED_UOMS.has(fallbackCandidate)) {
    return fallbackCandidate;
  }
  return fallbackCandidate || (primaryCandidate === "HOUR" ? "HOUR" : "EACH");
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function stringValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function unwrapValue(value) {
  if (value && typeof value === "object" && "value" in value) {
    return value.value;
  }
  return value;
}

function readPathValue(record, pathSegments) {
  let current = record;
  for (const segment of pathSegments) {
    current = unwrapValue(current);
    if (!current || typeof current !== "object") return "";
    current = current[segment];
  }
  const finalValue = unwrapValue(current);
  if (finalValue && typeof finalValue === "object") return "";
  return stringValue(finalValue);
}

function firstPathValue(record, paths) {
  for (const pathSegments of paths) {
    const value = readPathValue(record, pathSegments);
    if (value) return value;
  }
  return "";
}

function buildBusinessAccountAddress(row) {
  const addressLine1 = firstPathValue(row, [
    ["AddressLine1"],
    ["MainAddress", "AddressLine1"],
    ["ShippingAddress", "AddressLine1"],
    ["DefAddress", "AddressLine1"],
    ["Address", "AddressLine1"]
  ]);
  const addressLine2 = firstPathValue(row, [
    ["AddressLine2"],
    ["MainAddress", "AddressLine2"],
    ["ShippingAddress", "AddressLine2"],
    ["DefAddress", "AddressLine2"],
    ["Address", "AddressLine2"]
  ]);
  const city = firstPathValue(row, [
    ["City"],
    ["MainAddress", "City"],
    ["ShippingAddress", "City"],
    ["DefAddress", "City"],
    ["Address", "City"]
  ]);
  const state = firstPathValue(row, [
    ["State"],
    ["Province"],
    ["MainAddress", "State"],
    ["MainAddress", "Province"],
    ["ShippingAddress", "State"],
    ["ShippingAddress", "Province"],
    ["DefAddress", "State"],
    ["Address", "State"]
  ]);
  const postalCode = firstPathValue(row, [
    ["PostalCode"],
    ["ZipCode"],
    ["Zip"],
    ["MainAddress", "PostalCode"],
    ["MainAddress", "ZipCode"],
    ["ShippingAddress", "PostalCode"],
    ["ShippingAddress", "ZipCode"],
    ["DefAddress", "PostalCode"],
    ["Address", "PostalCode"]
  ]);
  const country = firstPathValue(row, [
    ["Country"],
    ["MainAddress", "Country"],
    ["ShippingAddress", "Country"],
    ["DefAddress", "Country"],
    ["Address", "Country"]
  ]);

  const street = [addressLine1, addressLine2].filter(Boolean).join(", ");
  if (!street && !city && !state && !postalCode && !country) return null;
  return compactObject({
    street: street || undefined,
    city: city || undefined,
    state: state || undefined,
    zip: postalCode || undefined,
    country: country || undefined
  });
}

function toContactValue(record, fallbackBusinessAccountRef = "") {
  const id = firstPathValue(record, [["ContactID"], ["ContactId"], ["ID"], ["id"]]);
  const displayName = firstPathValue(record, [["DisplayName"], ["Contact"], ["ContactName"], ["FullName"], ["Name"]]);
  const firstName = firstPathValue(record, [["FirstName"], ["First"]]);
  const lastName = firstPathValue(record, [["LastName"], ["Last"]]);
  const email = firstPathValue(record, [["Email"], ["EMail"], ["EmailAddress"]]);
  const phone = firstPathValue(record, [["Phone1"], ["Phone"], ["BusinessPhone"], ["CellPhone"], ["WorkPhone"]]);
  const contactClass = firstPathValue(record, [["ClassID"], ["ClassId"], ["ContactClass"], ["ContactClassID"]]);
  const businessAccountRef =
    firstPathValue(record, [
      ["BusinessAccount"],
      ["BusinessAccountID"],
      ["BusinessAccountCD"],
      ["BAccountID"],
      ["BAccountCD"],
      ["AccountID"],
      ["AccountCD"],
      ["CustomerID"]
    ]) || fallbackBusinessAccountRef;

  const activeValue = firstPathValue(record, [["Active"], ["IsActive"], ["active"]]);
  const normalizedActive = normalizeSearch(activeValue);
  const isActive =
    !activeValue || normalizedActive === "true" || normalizedActive === "1" || normalizedActive === "yes" || normalizedActive === "active";

  const fullName = stringValue(`${firstName} ${lastName}`);
  return {
    id,
    displayName: displayName || fullName || id,
    email,
    phone,
    contactClass,
    businessAccountRef,
    isActive,
    raw: record
  };
}

function extractContactRowsFromBusinessAccountRow(row) {
  const directCandidates = ["Contacts", "contacts", "BusinessAccountContacts", "ContactList"];
  for (const key of directCandidates) {
    const value = unwrapValue(row?.[key]);
    if (Array.isArray(value)) return value;
  }

  const entries = Object.entries(row || {});
  for (const [key, rawValue] of entries) {
    const value = unwrapValue(rawValue);
    if (!Array.isArray(value)) continue;
    if (normalizeName(key).includes("contact")) {
      return value;
    }
  }
  return [];
}

function resolveFieldName(fields, candidates) {
  const normalized = new Map();
  (fields || []).forEach((field) => {
    const name = field.name || field.fieldName || field.displayName;
    if (name) normalized.set(normalizeName(name), name);
  });
  for (const candidate of candidates) {
    const match = normalized.get(normalizeName(candidate));
    if (match) return match;
  }
  return "";
}

function pickDetail(details, candidates, hint) {
  if (!details || details.length === 0) return null;
  const normalizedCandidates = candidates.map(normalizeName);
  for (const detail of details) {
    const name = detail.name || detail.displayName || "";
    const entityName = detail.entityName || "";
    const haystack = `${name} ${entityName}`.toLowerCase();
    if (normalizedCandidates.some((cand) => normalizeName(haystack).includes(cand))) {
      return detail;
    }
  }
  if (hint) {
    const hintLower = hint.toLowerCase();
    const match = details.find((detail) => `${detail.name || ""} ${detail.entityName || ""}`.toLowerCase().includes(hintLower));
    if (match) return match;
  }
  return details[0] || null;
}

function extractEntityList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.entities)) return payload.entities;
  if (Array.isArray(payload.entity)) return payload.entity;
  if (Array.isArray(payload.resources)) return payload.resources;
  if (Array.isArray(payload.value)) return payload.value;
  return [];
}

function extractDetails(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.details)) return payload.details;
  if (Array.isArray(payload.Details)) return payload.Details;
  if (payload.entity && Array.isArray(payload.entity.details)) return payload.entity.details;
  return [];
}

function extractFields(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.fields)) return payload.fields;
  if (Array.isArray(payload.Fields)) return payload.Fields;
  if (payload.entity && Array.isArray(payload.entity.fields)) return payload.entity.fields;
  return [];
}

function extractKeyFields(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.keyFields)) return payload.keyFields;
  if (payload.entity && Array.isArray(payload.entity.keyFields)) return payload.entity.keyFields;
  return [];
}

function extractRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.value)) return payload.value;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function dedupeBy(items, keySelector) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = keySelector(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function bestMatch(items, rawTerm, valueSelector) {
  const term = normalizeSearch(rawTerm);
  if (!term) return { notFound: true };

  const exact = items.filter((item) =>
    valueSelector(item)
      .map(normalizeSearch)
      .filter(Boolean)
      .some((value) => value === term)
  );
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };

  const contains = items.filter((item) =>
    valueSelector(item)
      .map(normalizeSearch)
      .filter(Boolean)
      .some((value) => value.includes(term) || term.includes(value))
  );
  if (contains.length === 1) return { match: contains[0] };
  if (contains.length > 1) return { ambiguous: contains };

  return { notFound: true };
}

function toIsoWithOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

function compactObject(obj) {
  const output = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined) continue;
    output[key] = value;
  }
  return output;
}

function parseAcumaticaErrorText(rawText, fallback = "") {
  const text = String(rawText || "").trim();
  if (!text) return fallback;

  const tryParseJson = (value) => {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  };

  const directPayload = tryParseJson(text);
  const embeddedPayload = !directPayload && text.includes("{") ? tryParseJson(text.slice(text.indexOf("{"))) : null;
  const payload = directPayload || embeddedPayload;

  const collectNestedErrors = (value, output = []) => {
    if (!value || typeof value !== "object") return output;
    if (Array.isArray(value)) {
      value.forEach((item) => collectNestedErrors(item, output));
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      if (normalizeName(key) === "error") {
        const message = stringValue(unwrapValue(child));
        if (message && normalizeSearch(message) !== normalizeSearch("An error has occurred.")) {
          output.push(message);
        }
      }
      collectNestedErrors(child, output);
    }
    return output;
  };

  if (payload && typeof payload === "object") {
    const nestedErrors = dedupeBy(collectNestedErrors(payload), (item) => normalizeSearch(item));
    if (nestedErrors.length) {
      return nestedErrors.slice(0, 3).join(" | ");
    }

    const exceptionMessage = stringValue(payload.exceptionMessage || payload.ExceptionMessage);
    if (exceptionMessage) return exceptionMessage;

    const message = stringValue(payload.error || payload.message || payload.Message);
    if (message && normalizeSearch(message) !== normalizeSearch("An error has occurred.")) {
      return message;
    }
  }

  if (text.startsWith("<!DOCTYPE html") || text.startsWith("<html")) {
    return fallback || "Acumatica returned an HTML error page.";
  }

  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return fallback;
  return singleLine.length > 260 ? `${singleLine.slice(0, 257)}...` : singleLine;
}

function parseJsonSafe(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function resolveTimeoutMs(raw, fallback = 0) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 0) {
  const ms = resolveTimeoutMs(timeoutMs, 0);
  if (!ms) return fetch(url, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractSpreadsheetUrlFromText(text) {
  const raw = String(text || "");
  if (!raw) return "";
  const match = raw.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit[^\s"']*/i);
  return match ? match[0] : "";
}

function absolutizeAcumaticaUrl(url, baseUrl = "") {
  const raw = stringValue(url);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith("/")) return "";
  const base = stringValue(baseUrl).replace(/\/$/, "");
  if (!base) return "";
  return `${base}${raw}`;
}

function extractHttpUrlFromText(text, baseUrl = "") {
  const raw = String(text || "");
  if (!raw) return "";

  const absolute = raw.match(/https?:\/\/[^\s"'<>]+/i);
  if (absolute?.[0]) return absolute[0];

  const sessionBound = raw.match(/\/\(W\([^)]+\)\)\/[^\s"'<>]+/i);
  if (sessionBound?.[0]) return absolutizeAcumaticaUrl(sessionBound[0], baseUrl);

  const reportLauncher = raw.match(/\/Frames\/ReportLauncher\.aspx[^\s"'<>]*/i);
  if (reportLauncher?.[0]) return absolutizeAcumaticaUrl(reportLauncher[0], baseUrl);

  const mainPath = raw.match(/\/Main\?[^\s"'<>]+/i);
  if (mainPath?.[0]) return absolutizeAcumaticaUrl(mainPath[0], baseUrl);

  return "";
}

function extractHttpUrlFromValue(value, baseUrl = "") {
  if (!value) return "";
  if (typeof value === "string") {
    return extractHttpUrlFromText(value, baseUrl);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractHttpUrlFromValue(item, baseUrl);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = extractHttpUrlFromValue(item, baseUrl);
      if (found) return found;
    }
  }
  return "";
}

function extractSpreadsheetUrlFromValue(value) {
  if (!value) return "";
  if (typeof value === "string") {
    return extractSpreadsheetUrlFromText(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractSpreadsheetUrlFromValue(item);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = extractSpreadsheetUrlFromValue(item);
      if (found) return found;
    }
  }
  return "";
}

function extractSpreadsheetIdFromUrl(url) {
  const raw = String(url || "");
  if (!raw) return "";
  const match = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : "";
}

function extractAttributeIdValue(item) {
  if (!item || typeof item !== "object") return "";
  const direct = stringValue(item.AttributeID || item.attributeID || item.attributeId || item.id);
  if (direct) return direct;

  const nested = item.AttributeID ?? item.attributeID ?? item.attributeId;
  if (nested && typeof nested === "object") {
    return stringValue(unwrapValue(nested.value ?? nested.Value ?? nested));
  }
  return "";
}

function extractAttributeRawValue(item) {
  if (!item || typeof item !== "object") return "";
  const direct = item.value ?? item.Value ?? item.attributeValue;
  if (direct !== undefined && direct !== null && direct !== "") return stringValue(unwrapValue(direct));

  const nestedValue = item?.Value?.value ?? item?.Value?.Value ?? item?.value?.value;
  return stringValue(unwrapValue(nestedValue));
}

function extractBackupLinkFromQuotePayload(payload) {
  const queue = [payload];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current === "string") {
      const sheetUrl = extractSpreadsheetUrlFromText(current);
      if (sheetUrl) return sheetUrl;
      if (/^https?:\/\//i.test(current.trim())) return current.trim();
      continue;
    }

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
      continue;
    }

    if (typeof current !== "object") continue;

    for (const key of Object.keys(current)) {
      if (normalizeName(key) === "backup") {
        const value = unwrapValue(current[key]);
        const asText = stringValue(value);
        if (asText) {
          const sheetUrl = extractSpreadsheetUrlFromText(asText);
          if (sheetUrl) return sheetUrl;
          if (/^https?:\/\//i.test(asText)) return asText;
        }
      }
    }

    const attributes = current.Attributes || current.attributes;
    if (Array.isArray(attributes)) {
      for (const attribute of attributes) {
        const attributeId = normalizeName(extractAttributeIdValue(attribute));
        if (attributeId !== "backup") continue;
        const rawValue = extractAttributeRawValue(attribute);
        if (rawValue) {
          const sheetUrl = extractSpreadsheetUrlFromText(rawValue);
          if (sheetUrl) return sheetUrl;
          if (/^https?:\/\//i.test(rawValue)) return rawValue;
        }
      }
    }

    Object.values(current).forEach((value) => queue.push(value));
  }
  return "";
}

function extractFilesPutLinkFromQuotePayload(payload) {
  const queue = [payload];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
      continue;
    }
    if (typeof current !== "object") continue;

    const links = current._links || current.links || current.Links;
    if (links && typeof links === "object") {
      const direct = links["files:put"] ?? links.filesPut ?? links.filesput ?? links["files-put"];
      const directValue =
        stringValue(unwrapValue(direct?.href ?? direct?.url ?? direct));
      if (directValue) return directValue;

      for (const [key, value] of Object.entries(links)) {
        const normalizedKey = normalizeName(key);
        if (!normalizedKey.includes("filesput")) continue;
        const candidate = stringValue(unwrapValue(value?.href ?? value?.url ?? value));
        if (candidate) return candidate;
      }
    }

    Object.values(current).forEach((value) => queue.push(value));
  }
  return "";
}

function sanitizeUploadFileName(fileName, fallback = "attachment") {
  const cleaned = stringValue(fileName)
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function buildFilesPutUploadPath(filesPutLink, fileName) {
  const link = stringValue(filesPutLink);
  if (!link) return "";
  const safeFileName = encodeURIComponent(sanitizeUploadFileName(fileName, "attachment.pdf"));
  if (!safeFileName) return link;

  if (link.includes("{filename}")) {
    return link.replace(/\{filename\}/gi, safeFileName);
  }
  if (link.includes("%7Bfilename%7D") || link.includes("%7bfilename%7d")) {
    return link.replace(/%7Bfilename%7D/gi, safeFileName);
  }

  if (/\/$/.test(link)) {
    return `${link}${safeFileName}`;
  }
  return link;
}

function extractAcumaticaStatusCode(error) {
  if (!(error instanceof Error)) return 0;
  const match = error.message.match(/Acumatica request failed \((\d{3})\)/);
  return match ? Number(match[1]) : 0;
}

function isRecoverableEntityCandidateError(error) {
  const status = extractAcumaticaStatusCode(error);
  return status === 404 || status === 405 || status === 406;
}

function isRecoverableCreateMethodError(error) {
  if (!(error instanceof Error)) return false;
  const status = extractAcumaticaStatusCode(error);
  if (status !== 500) return false;
  const normalized = normalizeSearch(error.message);
  return normalized.includes("operationfailed");
}

function isRecoverableLineDetailError(error) {
  const status = extractAcumaticaStatusCode(error);
  if (status === 400 || status === 404 || status === 405 || status === 406 || status === 500) {
    return true;
  }
  return false;
}

function isConcurrentLoginLimitMessage(message) {
  const normalized = normalizeSearch(message);
  return (
    normalized.includes("concurrentapilogins") ||
    normalized.includes("checkapiuserslimits") ||
    normalized.includes("apiloginlimitreached")
  );
}

export class AcumaticaValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AcumaticaValidationError";
    this.code = code;
    this.status = 422;
    this.details = details;
  }
}

export class AcumaticaAuthExpiredError extends Error {
  constructor(message = "Your Acumatica session is invalid. Sign in again.") {
    super(message);
    this.name = "AcumaticaAuthExpiredError";
    this.code = "AUTH_EXPIRED";
    this.status = 401;
  }
}

export class AcumaticaClient {
  constructor(settings = config.acumatica) {
    this.settings = settings;
    this.cookie = "";
    this.loginPromise = null;
    this.entityMetaCache = new Map();
    this.entityListCache = null;
  }

  hasCredentials() {
    return Boolean(stringValue(this.settings?.username) && stringValue(this.settings?.password));
  }

  baseEndpoint() {
    const { baseUrl, endpointName, endpointVersion } = this.settings;
    return `${baseUrl.replace(/\/$/, "")}/entity/${endpointName}/${endpointVersion}`;
  }

  async login(force = false) {
    if (force && this.cookie) {
      if (this.hasCredentials()) {
        await this.logout();
      } else {
        this.cookie = "";
      }
    }
    if (this.cookie) return;
    if (this.loginPromise) {
      await this.loginPromise;
      if (this.cookie) return;
    }

    const { baseUrl, username, password, company } = this.settings;
    if (!username || !password) {
      throw new AcumaticaAuthExpiredError();
    }

    this.loginPromise = (async () => {
      const url = `${baseUrl.replace(/\/$/, "")}/entity/auth/login`;
      const timeoutMs = resolveTimeoutMs(this.settings?.requestTimeoutMs, 45000);
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: username, password, company })
      }, timeoutMs);
      if (!response.ok) {
        const text = await response.text();
        const detail = parseAcumaticaErrorText(text, response.statusText);
        if (isConcurrentLoginLimitMessage(detail)) {
          throw new Error(
            "Acumatica login limit reached for this API user. Close old API sessions or increase concurrent API logins on Users (SM201010), then retry."
          );
        }
        throw new Error(`Acumatica login failed (${response.status}): ${detail || response.statusText}`);
      }

      let cookies = [];
      if (typeof response.headers.getSetCookie === "function") {
        cookies = response.headers.getSetCookie();
      } else {
        const raw = response.headers.get("set-cookie");
        if (raw) cookies = [raw];
      }
      this.cookie = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
      if (!this.cookie) {
        throw new Error("Acumatica login did not return a session cookie.");
      }
    })();

    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  async logout() {
    if (!this.cookie) return;
    const { baseUrl } = this.settings;
    const url = `${baseUrl.replace(/\/$/, "")}/entity/auth/logout`;
    const cookie = this.cookie;
    this.cookie = "";

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Cookie: cookie
        }
      });
    } catch (_error) {
      // Best-effort logout only. Cookie is cleared locally either way.
    }
  }

  async request(path, options = {}) {
    const url = `${this.baseEndpoint()}${path.startsWith("/") ? "" : "/"}${path}`;
    const send = async () => {
      await this.login();
      const timeoutMs = resolveTimeoutMs(
        options.timeoutMs,
        resolveTimeoutMs(this.settings?.requestTimeoutMs, 45000)
      );
      return fetchWithTimeout(url, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: this.cookie,
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      }, timeoutMs);
    };

    let response = await send();
    if (response.status === 401 || response.status === 403) {
      if (this.hasCredentials()) {
        await this.login(true);
        response = await send();
      } else {
        throw new AcumaticaAuthExpiredError();
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new AcumaticaAuthExpiredError();
    }

    if (!response.ok) {
      const text = await response.text();
      const detail = parseAcumaticaErrorText(text, response.statusText);
      throw new Error(`Acumatica request failed (${response.status}): ${detail || response.statusText}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async rawRequest(path, options = {}) {
    const url = `${this.baseEndpoint()}${path.startsWith("/") ? "" : "/"}${path}`;
    const send = async () => {
      await this.login();
      const timeoutMs = resolveTimeoutMs(
        options.timeoutMs,
        resolveTimeoutMs(this.settings?.requestTimeoutMs, 45000)
      );
      return fetchWithTimeout(url, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: this.cookie,
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      }, timeoutMs);
    };

    let response = await send();
    if (response.status === 401 || response.status === 403) {
      if (this.hasCredentials()) {
        await this.login(true);
        response = await send();
      } else {
        throw new AcumaticaAuthExpiredError();
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new AcumaticaAuthExpiredError();
    }

    return response;
  }

  async getEntityList() {
    if (this.entityListCache) return this.entityListCache;
    const payload = await this.request("", { method: "GET" });
    const list = extractEntityList(payload);
    this.entityListCache = list;
    return list;
  }

  async getEntityMeta(entityName) {
    if (this.entityMetaCache.has(entityName)) {
      return this.entityMetaCache.get(entityName);
    }
    const payload = await this.request(entityName, { method: "GET" });
    this.entityMetaCache.set(entityName, payload);
    return payload;
  }

  async resolveEntityName(preferred, candidates) {
    const list = await this.getEntityList();
    const names = list.map((item) => item.name || item.entity || item.displayName).filter(Boolean);

    if (preferred) {
      const exactPreferred = names.find((name) => normalizeName(name) === normalizeName(preferred));
      if (exactPreferred) return exactPreferred;
    }

    for (const candidate of candidates || []) {
      const exact = names.find((name) => normalizeName(name) === normalizeName(candidate));
      if (exact) return exact;
    }

    for (const candidate of candidates || []) {
      const partial = names.find((name) => normalizeName(name).includes(normalizeName(candidate)));
      if (partial) return partial;
    }

    return preferred || names[0] || "";
  }

  async resolveEntityMeta({ preferred, candidates, errorMessage }) {
    const entityName = await this.resolveEntityName(preferred, candidates);
    if (!entityName) {
      throw new Error(errorMessage || "Could not resolve entity metadata from the Acumatica endpoint.");
    }
    const meta = await this.getEntityMeta(entityName);
    return {
      entityName,
      fields: extractFields(meta),
      keyFields: extractKeyFields(meta),
      details: extractDetails(meta)
    };
  }

  async resolveQuoteEntity() {
    return this.resolveEntityName(this.settings.quoteEntity, DEFAULT_QUOTE_ENTITY_CANDIDATES);
  }

  async resolveQuoteMeta() {
    return this.resolveEntityMeta({
      preferred: this.settings.quoteEntity,
      candidates: DEFAULT_QUOTE_ENTITY_CANDIDATES,
      errorMessage: "Could not resolve a Project Quote entity from the Acumatica endpoint."
    });
  }

  getQuoteEntityCandidates() {
    return dedupeBy(
      [this.settings.quoteEntity, ...DEFAULT_QUOTE_ENTITY_CANDIDATES]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );
  }

  async resolveOpportunityMeta() {
    return this.resolveEntityMeta({
      preferred: this.settings.opportunity?.entity,
      candidates: DEFAULT_OPPORTUNITY_ENTITY_CANDIDATES,
      errorMessage: "Could not resolve an Opportunity entity from the Acumatica endpoint."
    });
  }

  getOpportunityEntityCandidates() {
    return dedupeBy(
      [this.settings.opportunity?.entity, ...DEFAULT_OPPORTUNITY_ENTITY_CANDIDATES]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );
  }

  async resolveBusinessAccountMeta() {
    return this.resolveEntityMeta({
      preferred: this.settings.businessAccountEntity || "BusinessAccount",
      candidates: DEFAULT_BUSINESS_ACCOUNT_ENTITY_CANDIDATES,
      errorMessage: "Could not resolve a Business Account entity from the Acumatica endpoint."
    });
  }

  async resolveContactMeta() {
    return this.resolveEntityMeta({
      preferred: "",
      candidates: DEFAULT_CONTACT_ENTITY_CANDIDATES,
      errorMessage: "Could not resolve a Contact entity from the Acumatica endpoint."
    });
  }

  async resolveEmployeeMeta() {
    return this.resolveEntityMeta({
      preferred: this.settings.employeeEntity || "Employee",
      candidates: DEFAULT_EMPLOYEE_ENTITY_CANDIDATES,
      errorMessage: "Could not resolve an Employee entity from the Acumatica endpoint."
    });
  }

  getBusinessAccountCreateFieldMap(fields) {
    return {
      id: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.id),
      name: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.name),
      email: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.email),
      phone: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.phone),
      addressLine1: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.addressLine1),
      addressLine2: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.addressLine2),
      city: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.city),
      state: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.state),
      postalCode: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.postalCode),
      country: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.country),
      ownerId: resolveFieldName(fields, BUSINESS_ACCOUNT_CREATE_FIELD_CANDIDATES.ownerId)
    };
  }

  getContactCreateFieldMap(fields) {
    return {
      displayName: resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.displayName),
      firstName: resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.firstName),
      lastName: resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.lastName),
      email: resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.email),
      phone: resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.phone),
      businessAccount: resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.businessAccount),
      contactClass: resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.contactClass)
    };
  }

  buildBusinessAccountCreatePayload(meta, input = {}) {
    const fields = meta?.fields || [];
    const fieldMap = this.getBusinessAccountCreateFieldMap(fields);
    const businessAccountId = stringValue(input.businessAccountId || input.businessAccount || input.businessAccountCd);
    const name = stringValue(input.name || input.accountName);
    const email = stringValue(input.email);
    const phone = stringValue(input.phone);
    const addressLine1 = stringValue(input.addressLine1 || input.street || input.address);
    const addressLine2 = stringValue(input.addressLine2);
    const city = stringValue(input.city);
    const state = stringValue(input.state || input.province);
    const postalCode = stringValue(input.postalCode || input.zip);
    const country = stringValue(input.country);
    const ownerId = stringValue(input.ownerId || input.owner || input.ownerEmployeeId);

    if (!name) {
      throw new AcumaticaValidationError(
        "VALIDATION_ERROR",
        "Business account name is required.",
        this.buildValidationDetails()
      );
    }

    const payload = {};
    const setValue = (resolvedFieldName, fallbackFieldName, value) => {
      if (value === undefined || value === null) return;
      if (typeof value === "string" && value.trim() === "") return;
      payload[resolvedFieldName || fallbackFieldName] = { value };
    };

    setValue(fieldMap.id, "BusinessAccountID", businessAccountId);
    setValue(fieldMap.name, "Name", name);
    setValue(fieldMap.email, "Email", email);
    setValue(fieldMap.phone, "Phone1", phone);
    setValue(fieldMap.addressLine1, "AddressLine1", addressLine1);
    setValue(fieldMap.addressLine2, "AddressLine2", addressLine2);
    setValue(fieldMap.city, "City", city);
    setValue(fieldMap.state, "State", state);
    setValue(fieldMap.postalCode, "PostalCode", postalCode);
    setValue(fieldMap.country, "Country", country);
    setValue(fieldMap.ownerId, "Owner", ownerId);

    return payload;
  }

  buildContactCreatePayload(meta, input = {}) {
    const fields = meta?.fields || [];
    const fieldMap = this.getContactCreateFieldMap(fields);
    const businessAccountId = stringValue(input.businessAccountId || input.businessAccount || input.businessAccountCd);
    const firstName = stringValue(input.firstName);
    const lastName = stringValue(input.lastName);
    const displayName = stringValue(
      input.displayName || input.name || stringValue(`${firstName} ${lastName}`)
    );
    const email = stringValue(input.email);
    const phone = stringValue(input.phone);
    const contactClass = stringValue(input.contactClass || input.classId);

    if (!businessAccountId) {
      throw new AcumaticaValidationError(
        "VALIDATION_ERROR",
        "businessAccountId is required to create a contact.",
        this.buildValidationDetails()
      );
    }
    if (!displayName && !firstName && !lastName) {
      throw new AcumaticaValidationError(
        "VALIDATION_ERROR",
        "Contact name is required.",
        this.buildValidationDetails()
      );
    }

    const payload = {};
    const setValue = (resolvedFieldName, fallbackFieldName, value) => {
      if (value === undefined || value === null) return;
      if (typeof value === "string" && value.trim() === "") return;
      payload[resolvedFieldName || fallbackFieldName] = { value };
    };

    setValue(fieldMap.businessAccount, "BusinessAccount", businessAccountId);
    setValue(fieldMap.displayName, "DisplayName", displayName);
    setValue(fieldMap.firstName, "FirstName", firstName);
    setValue(fieldMap.lastName, "LastName", lastName);
    setValue(fieldMap.email, "Email", email);
    setValue(fieldMap.phone, "Phone1", phone);
    // Contact endpoints often expose this as ContactClass (not ClassID).
    setValue(fieldMap.contactClass, "ContactClass", contactClass);

    return payload;
  }

  buildContactClassPatchPayload(meta, contactId, contactClass) {
    const fields = meta?.fields || [];
    const idField = resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.id) || "ContactID";
    const classField = resolveFieldName(fields, CONTACT_CREATE_FIELD_CANDIDATES.contactClass) || "ContactClass";
    const payload = {};
    payload[idField] = { value: stringValue(contactId) };
    payload[classField] = { value: stringValue(contactClass) };
    return payload;
  }

  async enforceContactClass(meta, contactId, contactClass) {
    const normalizedContactId = stringValue(contactId);
    const normalizedContactClass = stringValue(contactClass);
    if (!normalizedContactId || !normalizedContactClass) return;

    const entityName = stringValue(meta?.entityName || "Contact");
    const payload = this.buildContactClassPatchPayload(meta, normalizedContactId, normalizedContactClass);
    const keyPath = `${entityName}/${encodeURIComponent(normalizedContactId)}`;
    const attempts = [
      { path: entityName, method: "PUT", body: payload },
      { path: entityName, method: "POST", body: payload },
      { path: keyPath, method: "PUT", body: payload },
      { path: keyPath, method: "POST", body: payload }
    ];

    let lastRecoverableError = null;
    for (const attempt of attempts) {
      try {
        await this.request(attempt.path, {
          method: attempt.method,
          body: attempt.body
        });
        return;
      } catch (error) {
        const status = extractAcumaticaStatusCode(error);
        const recoverableStatus = status === 400 || status === 404 || status === 405 || status === 406 || status === 500;
        if (!recoverableStatus) throw error;
        lastRecoverableError = error;
      }
    }

    if (lastRecoverableError) {
      throw lastRecoverableError;
    }
  }

  async createBusinessAccount(input = {}) {
    const attemptedEntityNames = dedupeBy(
      [this.settings.businessAccountEntity || "BusinessAccount", ...DEFAULT_BUSINESS_ACCOUNT_ENTITY_CANDIDATES]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );
    const candidateMethods = ["PUT", "POST"];
    let lastRecoverableEntityError = null;
    const recoverableErrors = [];
    const resolvedMetaByEntity = new Map();

    try {
      const resolvedMeta = await this.resolveBusinessAccountMeta();
      if (
        resolvedMeta?.entityName &&
        !attemptedEntityNames.some((existing) => normalizeName(existing) === normalizeName(resolvedMeta.entityName))
      ) {
        attemptedEntityNames.push(resolvedMeta.entityName);
      }
      if (resolvedMeta?.entityName) {
        resolvedMetaByEntity.set(normalizeName(resolvedMeta.entityName), resolvedMeta);
      }
    } catch (error) {
      if (!isRecoverableEntityCandidateError(error)) throw error;
      lastRecoverableEntityError = error;
    }

    for (const entityName of attemptedEntityNames) {
      for (const method of candidateMethods) {
        try {
          const meta = resolvedMetaByEntity.get(normalizeName(entityName)) || {
            entityName,
            fields: []
          };
          const payload = this.buildBusinessAccountCreatePayload(meta, input);
          const response = await this.request(entityName, { method, body: payload });
          const fieldMap = this.getBusinessAccountFieldMap(meta.fields || []);
          return this.toBusinessAccount(response, fieldMap);
        } catch (error) {
          if (isRecoverableEntityCandidateError(error)) {
            lastRecoverableEntityError = error;
            recoverableErrors.push({
              entityName: `${entityName} (${method})`,
              message: error instanceof Error ? error.message : String(error || "Unknown error")
            });
            continue;
          }
          throw error;
        }
      }
    }

    if (lastRecoverableEntityError) {
      const summary = recoverableErrors
        .map((item) => `${item.entityName}: ${item.message}`)
        .join(" | ");
      throw new Error(`Business Account create failed for attempted entities. ${summary}`);
    }

    throw new Error("Could not resolve a Business Account entity from the Acumatica endpoint.");
  }

  async createContact(input = {}) {
    const attemptedEntityNames = dedupeBy(
      [...DEFAULT_CONTACT_ENTITY_CANDIDATES]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );
    const candidateMethods = ["PUT", "POST"];
    let lastRecoverableEntityError = null;
    const recoverableErrors = [];
    const resolvedMetaByEntity = new Map();

    try {
      const resolvedMeta = await this.resolveContactMeta();
      if (
        resolvedMeta?.entityName &&
        !attemptedEntityNames.some((existing) => normalizeName(existing) === normalizeName(resolvedMeta.entityName))
      ) {
        attemptedEntityNames.push(resolvedMeta.entityName);
      }
      if (resolvedMeta?.entityName) {
        resolvedMetaByEntity.set(normalizeName(resolvedMeta.entityName), resolvedMeta);
      }
    } catch (error) {
      if (!isRecoverableEntityCandidateError(error)) throw error;
      lastRecoverableEntityError = error;
    }

    for (const entityName of attemptedEntityNames) {
      for (const method of candidateMethods) {
        try {
          const meta = resolvedMetaByEntity.get(normalizeName(entityName)) || {
            entityName,
            fields: []
          };
          const payload = this.buildContactCreatePayload(meta, input);
          const response = await this.request(entityName, { method, body: payload });
          const fieldMap = this.getContactFieldMap(meta.fields || []);
          const createdContact = this.toContact(response, fieldMap);
          const requestedContactClass = stringValue(input.contactClass || input.classId);
          if (requestedContactClass && createdContact?.id) {
            const classAlreadyAssigned =
              normalizeSearch(createdContact.contactClass) === normalizeSearch(requestedContactClass);
            if (!classAlreadyAssigned) {
              try {
                await this.enforceContactClass(meta, createdContact.id, requestedContactClass);
              } catch (_error) {
                // Best effort: some contact entities do not support post-create class patch.
              }
            }
            return {
              ...createdContact,
              contactClass: requestedContactClass
            };
          }
          return createdContact;
        } catch (error) {
          if (isRecoverableEntityCandidateError(error)) {
            lastRecoverableEntityError = error;
            recoverableErrors.push({
              entityName: `${entityName} (${method})`,
              message: error instanceof Error ? error.message : String(error || "Unknown error")
            });
            continue;
          }
          throw error;
        }
      }
    }

    if (lastRecoverableEntityError) {
      const summary = recoverableErrors
        .map((item) => `${item.entityName}: ${item.message}`)
        .join(" | ");
      throw new Error(`Contact create failed for attempted entities. ${summary}`);
    }

    throw new Error("Could not resolve a Contact entity from the Acumatica endpoint.");
  }

  async createQuote(payload) {
    const attemptedEntityNames = [...this.getQuoteEntityCandidates()];
    const candidateMethods = ["PUT", "POST"];
    let lastRecoverableEntityError = null;
    const recoverableErrors = [];
    const resolvedMetaByEntity = new Map();

    try {
      const resolvedMeta = await this.resolveQuoteMeta();
      if (resolvedMeta?.entityName && !attemptedEntityNames.some((existing) => normalizeName(existing) === normalizeName(resolvedMeta.entityName))) {
        attemptedEntityNames.push(resolvedMeta.entityName);
      }
      if (resolvedMeta?.entityName) {
        resolvedMetaByEntity.set(normalizeName(resolvedMeta.entityName), resolvedMeta);
      }
    } catch (error) {
      if (!isRecoverableEntityCandidateError(error)) throw error;
      lastRecoverableEntityError = error;
    }

    for (const entityName of attemptedEntityNames) {
      for (const method of candidateMethods) {
        try {
          const response = await this.request(entityName, { method, body: payload });
          const meta =
            resolvedMetaByEntity.get(normalizeName(entityName)) || {
              entityName,
              fields: [],
              keyFields: [],
              details: []
          };
          return { response, meta };
        } catch (error) {
          const canRetryMethod =
            method === "PUT" && isRecoverableCreateMethodError(error);
          if (isRecoverableEntityCandidateError(error) || canRetryMethod) {
            lastRecoverableEntityError = error;
            recoverableErrors.push({
              entityName: `${entityName} (${method})`,
              message: error instanceof Error ? error.message : String(error || "Unknown error")
            });
            continue;
          }
          throw error;
        }
      }
    }

    if (lastRecoverableEntityError) {
      const summary = recoverableErrors
        .map((item) => `${item.entityName}: ${item.message}`)
        .join(" | ");
      throw new Error(`Quote create failed for attempted entities. ${summary}`);
    }

    throw new Error("Could not resolve a Project Quote entity from the Acumatica endpoint.");
  }

  async createOpportunity(payload) {
    const attemptedEntityNames = [...this.getOpportunityEntityCandidates()];
    let lastRecoverableEntityError = null;
    const recoverableErrors = [];
    const candidateMethods = ["PUT", "POST"];

    try {
      const resolvedMeta = await this.resolveOpportunityMeta();
      if (
        resolvedMeta?.entityName &&
        !attemptedEntityNames.some((existing) => normalizeName(existing) === normalizeName(resolvedMeta.entityName))
      ) {
        attemptedEntityNames.push(resolvedMeta.entityName);
      }
    } catch (error) {
      if (!isRecoverableEntityCandidateError(error)) throw error;
      lastRecoverableEntityError = error;
    }

    for (const entityName of attemptedEntityNames) {
      for (const method of candidateMethods) {
        try {
          const response = await this.request(entityName, { method, body: payload });
          const meta = {
            entityName,
            fields: [],
            keyFields: [],
            details: []
          };
          return {
            response,
            meta,
            opportunityId: this.extractOpportunityKey(response)
          };
        } catch (error) {
          if (isRecoverableEntityCandidateError(error)) {
            lastRecoverableEntityError = error;
            recoverableErrors.push({
              entityName: `${entityName} (${method})`,
              message: error instanceof Error ? error.message : String(error || "Unknown error")
            });
            continue;
          }
          throw error;
        }
      }
    }

    if (lastRecoverableEntityError) {
      const summary = recoverableErrors
        .map((item) => `${item.entityName}: ${item.message}`)
        .join(" | ");
      throw new Error(`Opportunity create failed for attempted entities. ${summary}`);
    }
    throw new Error("Could not resolve an Opportunity entity from the Acumatica endpoint.");
  }

  async updateQuote(entityName, payload) {
    try {
      return await this.request(entityName, { method: "PUT", body: payload });
    } catch (error) {
      const isNotFound = error instanceof Error && error.message.includes("Acumatica request failed (404)");
      if (!isNotFound) throw error;

      const keyCandidates = Object.entries(payload || {})
        .filter(([fieldName, fieldValue]) => {
          if (!fieldValue || typeof fieldValue !== "object" || !("value" in fieldValue)) return false;
          const normalized = normalizeName(fieldName);
          return FIELD_CANDIDATES.key.some((candidate) => normalizeName(candidate) === normalized);
        })
        .map(([, fieldValue]) => stringValue(fieldValue?.value))
        .filter(Boolean);

      const dedupedKeys = dedupeBy(keyCandidates, (value) => normalizeName(value));
      let lastPathError = error;
      for (const keyValue of dedupedKeys) {
        try {
          return await this.request(`${entityName}/${encodeURIComponent(keyValue)}`, { method: "PUT", body: payload });
        } catch (pathError) {
          lastPathError = pathError;
        }
      }

      throw lastPathError;
    }
  }

  async listEntityRows(entityName) {
    const attempts = [`${entityName}?$top=500`, entityName];
    let lastError = null;

    for (const path of attempts) {
      try {
        const payload = await this.request(path, { method: "GET" });
        return extractRecords(payload);
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  async listBusinessAccounts({ pageSize = 100, maxRecords = 10000 } = {}) {
    const rows = [];
    let offset = 0;
    const preferredEntity = this.settings.businessAccountEntity || "BusinessAccount";
    let activeStrategy = null;
    const listStrategies = [
      {
        select: "BusinessAccountID,Name,Owner,OwnerEmployeeName,AddressLine1,AddressLine2,City,State,PostalCode,Country",
        expand: ""
      },
      {
        // Keep expanded address objects in payload. With Acumatica, combining
        // $expand with a narrow $select can omit expanded nodes entirely.
        select: "",
        expand: "ShippingAddress,MainAddress"
      },
      {
        select: "BusinessAccountID,Name",
        expand: ""
      }
    ];

    const buildPath = (entityName, top, skip, strategy) => {
      const query = [`$top=${top}`, `$skip=${skip}`];
      if (strategy.select) query.push(`$select=${strategy.select}`);
      if (strategy.expand) query.push(`$expand=${strategy.expand}`);
      return `${entityName}?${query.join("&")}`;
    };

    const isRecoverableStrategyError = (error) => {
      if (!(error instanceof Error)) return false;
      return (
        error.message.includes("Acumatica request failed (400)") ||
        error.message.includes("Acumatica request failed (404)") ||
        error.message.includes("Acumatica request failed (500)")
      );
    };

    const fetchBatch = async (entityName, top, skip) => {
      if (activeStrategy) {
        const path = buildPath(entityName, top, skip, activeStrategy);
        const payload = await this.request(path, { method: "GET" });
        return extractRecords(payload);
      }

      let lastError = null;
      for (const strategy of listStrategies) {
        try {
          const path = buildPath(entityName, top, skip, strategy);
          const payload = await this.request(path, { method: "GET" });
          activeStrategy = strategy;
          return extractRecords(payload);
        } catch (error) {
          if (!isRecoverableStrategyError(error)) throw error;
          lastError = error;
        }
      }

      if (lastError) throw lastError;
      return [];
    };

    try {
      while (rows.length < maxRecords) {
        const nextTop = Math.min(pageSize, maxRecords - rows.length);
        const batch = await fetchBatch(preferredEntity, nextTop, offset);
        if (!batch.length) break;
        rows.push(...batch);
        if (batch.length < nextTop) break;
        offset += batch.length;
      }
    } catch (error) {
      const isNotFound = error instanceof Error && error.message.includes("Acumatica request failed (404)");
      if (!isNotFound) throw error;
      rows.length = 0;
      offset = 0;
      const meta = await this.resolveBusinessAccountMeta();
      while (rows.length < maxRecords) {
        const nextTop = Math.min(pageSize, maxRecords - rows.length);
        const batch = await fetchBatch(meta.entityName, nextTop, offset);
        if (!batch.length) break;
        rows.push(...batch);
        if (batch.length < nextTop) break;
        offset += batch.length;
      }
    }

    const mapped = dedupeBy(
      rows
        .map((row) => {
          const id = stringValue(unwrapValue(row.BusinessAccountID) ?? unwrapValue(row.BAccountID) ?? unwrapValue(row.AccountCD));
          const name = stringValue(unwrapValue(row.Name) ?? unwrapValue(row.AccountName) ?? id);
          const owner = firstPathValue(row, [["OwnerEmployeeName"], ["OwnerName"], ["OwnerContact"], ["Owner"]]);
          const address = buildBusinessAccountAddress(row);
          return compactObject({
            businessAccountId: id,
            name,
            owner: owner || undefined,
            address: address || undefined
          });
        })
        .filter((item) => item.businessAccountId),
      (item) => normalizeSearch(item.businessAccountId)
    );

    return mapped;
  }

  async listEmployees({ pageSize = 100, maxRecords = 5000 } = {}) {
    const rows = [];
    const attemptedEntityNames = dedupeBy(
      [this.settings.employeeEntity || "Employee", ...DEFAULT_EMPLOYEE_ENTITY_CANDIDATES]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );
    let resolvedMeta = null;

    try {
      resolvedMeta = await this.resolveEmployeeMeta();
      if (
        resolvedMeta?.entityName &&
        !attemptedEntityNames.some((existing) => normalizeName(existing) === normalizeName(resolvedMeta.entityName))
      ) {
        attemptedEntityNames.unshift(resolvedMeta.entityName);
      }
    } catch (error) {
      if (!isRecoverableEntityCandidateError(error)) throw error;
    }

    const isRecoverableEmployeeEntityError = (error) => {
      const status = extractAcumaticaStatusCode(error);
      return status === 400 || status === 404 || status === 405 || status === 406 || status === 500;
    };

    let activeEntityName = "";
    for (const entityName of attemptedEntityNames) {
      let offset = 0;
      const candidateRows = [];
      try {
        while (candidateRows.length < maxRecords) {
          const nextTop = Math.min(pageSize, maxRecords - candidateRows.length);
          const path = `${entityName}?$top=${nextTop}&$skip=${offset}`;
          const payload = await this.request(path, { method: "GET" });
          const batch = extractRecords(payload);
          if (!batch.length) break;
          candidateRows.push(...batch);
          if (batch.length < nextTop) break;
          offset += batch.length;
        }
        activeEntityName = entityName;
        rows.push(...candidateRows);
        break;
      } catch (error) {
        if (!isRecoverableEmployeeEntityError(error)) throw error;
      }
    }

    if (!activeEntityName) return [];

    let fieldMap = this.getEmployeeFieldMap([]);
    if (resolvedMeta?.entityName && normalizeName(resolvedMeta.entityName) === normalizeName(activeEntityName)) {
      fieldMap = this.getEmployeeFieldMap(resolvedMeta.fields || []);
    } else {
      try {
        const meta = await this.getEntityMeta(activeEntityName);
        fieldMap = this.getEmployeeFieldMap(extractFields(meta));
      } catch (_error) {
        fieldMap = this.getEmployeeFieldMap([]);
      }
    }

    return dedupeBy(
      rows
        .map((row) => this.toEmployee(row, fieldMap))
        .filter((employee) => employee.id)
        .sort((a, b) => stringValue(a.name || a.id).localeCompare(stringValue(b.name || b.id))),
      (employee) => normalizeSearch(employee.id)
    );
  }

  async listBusinessAccountContacts(businessAccountId, { maxRecords = 500 } = {}) {
    const accountId = stringValue(businessAccountId);
    if (!accountId) return [];

    const preferredEntity = this.settings.businessAccountEntity || "BusinessAccount";
    const escapedId = accountId.replace(/'/g, "''");
    const isRecoverableQueryError = (error) =>
      error instanceof Error &&
      (error.message.includes("Acumatica request failed (400)") ||
        error.message.includes("Acumatica request failed (404)") ||
        error.message.includes("Acumatica request failed (500)"));

    const entityNames = [preferredEntity];
    try {
      const meta = await this.resolveBusinessAccountMeta();
      if (meta.entityName && !entityNames.some((name) => normalizeSearch(name) === normalizeSearch(meta.entityName))) {
        entityNames.push(meta.entityName);
      }
    } catch (_error) {
      // Keep the preferred entity fallback if metadata cannot be resolved.
    }

    const filters = [
      `BusinessAccountID eq '${escapedId}'`,
      `BusinessAccountCD eq '${escapedId}'`,
      `AccountCD eq '${escapedId}'`,
      `BAccountID eq '${escapedId}'`
    ];

    const mapFromBusinessAccountRows = (rows) => {
      const scopedRows = rows.filter((row) => {
        const rowAccountId = stringValue(
          unwrapValue(row.BusinessAccountID) ?? unwrapValue(row.BusinessAccountCD) ?? unwrapValue(row.BAccountID) ?? unwrapValue(row.AccountCD)
        );
        if (!rowAccountId) return true;
        return normalizeSearch(rowAccountId) === normalizeSearch(accountId);
      });

      const contacts = scopedRows.flatMap((row) => {
        const rowAccountRef = stringValue(
          unwrapValue(row.BusinessAccountID) ?? unwrapValue(row.BusinessAccountCD) ?? unwrapValue(row.BAccountID) ?? unwrapValue(row.AccountCD) ?? accountId
        );
        return extractContactRowsFromBusinessAccountRow(row).map((contactRow) => toContactValue(contactRow, rowAccountRef));
      });

      return dedupeBy(
        contacts.filter((contact) => contact.id).filter((contact) => contact.isActive !== false).slice(0, maxRecords),
        (contact) => normalizeSearch(contact.id)
      );
    };

    for (const entityName of entityNames) {
      const keyPath = `${entityName}/${encodeURIComponent(accountId)}?$expand=Contacts`;
      try {
        const payload = await this.request(keyPath, { method: "GET" });
        const rows = extractRecords(payload);
        const mapped = mapFromBusinessAccountRows(rows);
        if (mapped.length) return mapped;
      } catch (error) {
        if (!isRecoverableQueryError(error)) throw error;
      }
    }

    for (const entityName of entityNames) {
      for (const filter of filters) {
        // Do not use $select here; Acumatica may hide expanded Contacts when
        // $select does not include expanded nodes.
        const path = `${entityName}?$top=1&$filter=${encodeURIComponent(filter)}&$expand=Contacts`;
        try {
          const payload = await this.request(path, { method: "GET" });
          const rows = extractRecords(payload);
          const mapped = mapFromBusinessAccountRows(rows);
          if (mapped.length) return mapped;
        } catch (error) {
          if (!isRecoverableQueryError(error)) throw error;
        }
      }
    }

    try {
      const meta = await this.resolveContactMeta();
      const fieldMap = this.getContactFieldMap(meta.fields || []);
      const rows = await this.listEntityRows(meta.entityName);
      const allContacts = rows
        .map((row) => this.toContact(row, fieldMap))
        .filter((item) => item.id);

      const accountRef = normalizeSearch(accountId);
      const scopedContacts = allContacts.filter((contact) => {
        const ref = normalizeSearch(contact.businessAccountRef);
        return ref && (ref === accountRef || ref.includes(accountRef) || accountRef.includes(ref));
      });

      return dedupeBy(scopedContacts, (contact) => normalizeSearch(contact.id));
    } catch (error) {
      if (isRecoverableQueryError(error)) {
        return [];
      }
      throw error;
    }
  }

  pickFieldValue(record, fieldNames) {
    for (const fieldName of fieldNames) {
      if (!fieldName) continue;
      const value = unwrapValue(record[fieldName]);
      if (value === undefined || value === null) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      return value;
    }
    return "";
  }

  getFieldMap(fields) {
    return {
      key: resolveFieldName(fields, FIELD_CANDIDATES.key),
      description: resolveFieldName(fields, FIELD_CANDIDATES.description),
      task: resolveFieldName(fields, FIELD_CANDIDATES.task),
      taskDescription: resolveFieldName(fields, FIELD_CANDIDATES.taskDescription),
      taskType: resolveFieldName(fields, FIELD_CANDIDATES.taskType),
      taskDefault: resolveFieldName(fields, FIELD_CANDIDATES.taskDefault),
      plannedStartDate: resolveFieldName(fields, FIELD_CANDIDATES.plannedStartDate),
      plannedEndDate: resolveFieldName(fields, FIELD_CANDIDATES.plannedEndDate),
      expenseGroup: resolveFieldName(fields, FIELD_CANDIDATES.expenseGroup),
      revenueGroup: resolveFieldName(fields, FIELD_CANDIDATES.revenueGroup),
      costCode: resolveFieldName(fields, FIELD_CANDIDATES.costCode),
      uom: resolveFieldName(fields, FIELD_CANDIDATES.uom),
      quantity: resolveFieldName(fields, FIELD_CANDIDATES.quantity),
      unitCost: resolveFieldName(fields, FIELD_CANDIDATES.unitCost),
      unitPrice: resolveFieldName(fields, FIELD_CANDIDATES.unitPrice),
      taxCategory: resolveFieldName(fields, FIELD_CANDIDATES.taxCategory),
      estimator: resolveFieldName(fields, FIELD_CANDIDATES.estimator),
      tradeDivision: resolveFieldName(fields, FIELD_CANDIDATES.tradeDivision),
      manualPrice: resolveFieldName(fields, FIELD_CANDIDATES.manualPrice),
      manualDiscount: resolveFieldName(fields, FIELD_CANDIDATES.manualDiscount),
      discount: resolveFieldName(fields, FIELD_CANDIDATES.discount),
      inventoryId: resolveFieldName(fields, FIELD_CANDIDATES.inventoryId),
      opportunityId: resolveFieldName(fields, FIELD_CANDIDATES.opportunityId)
    };
  }

  getOpportunityFieldMap(fields) {
    return {
      id: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.id),
      classId: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.classId),
      businessAccount: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.businessAccount),
      location: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.location),
      contactId: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.contactId),
      stage: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.stage),
      owner: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.owner),
      subject: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.subject),
      estimation: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.estimation),
      note: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.note),
      attributes: resolveFieldName(fields, OPPORTUNITY_FIELD_CANDIDATES.attributes)
    };
  }

  getBusinessAccountFieldMap(fields) {
    return {
      id: resolveFieldName(fields, BUSINESS_ACCOUNT_FIELD_CANDIDATES.id),
      code: resolveFieldName(fields, BUSINESS_ACCOUNT_FIELD_CANDIDATES.code),
      name: resolveFieldName(fields, BUSINESS_ACCOUNT_FIELD_CANDIDATES.name),
      location: resolveFieldName(fields, BUSINESS_ACCOUNT_FIELD_CANDIDATES.location),
      owner: resolveFieldName(fields, BUSINESS_ACCOUNT_FIELD_CANDIDATES.owner),
      ownerId: resolveFieldName(fields, BUSINESS_ACCOUNT_FIELD_CANDIDATES.ownerId)
    };
  }

  getContactFieldMap(fields) {
    return {
      id: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.id),
      displayName: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.displayName),
      firstName: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.firstName),
      lastName: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.lastName),
      email: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.email),
      phone: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.phone),
      businessAccountRef: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.businessAccountRef),
      contactClass: resolveFieldName(fields, CONTACT_FIELD_CANDIDATES.contactClass)
    };
  }

  getEmployeeFieldMap(fields) {
    return {
      id: resolveFieldName(fields, EMPLOYEE_FIELD_CANDIDATES.id),
      name: resolveFieldName(fields, EMPLOYEE_FIELD_CANDIDATES.name),
      firstName: resolveFieldName(fields, EMPLOYEE_FIELD_CANDIDATES.firstName),
      lastName: resolveFieldName(fields, EMPLOYEE_FIELD_CANDIDATES.lastName),
      email: resolveFieldName(fields, EMPLOYEE_FIELD_CANDIDATES.email),
      status: resolveFieldName(fields, EMPLOYEE_FIELD_CANDIDATES.status)
    };
  }

  toBusinessAccount(record, fieldMap) {
    const id = stringValue(this.pickFieldValue(record, [fieldMap.id, fieldMap.code]));
    const code = stringValue(this.pickFieldValue(record, [fieldMap.code, fieldMap.id]));
    const name = stringValue(this.pickFieldValue(record, [fieldMap.name, fieldMap.code, fieldMap.id]));
    const location = stringValue(this.pickFieldValue(record, [fieldMap.location]));
    const owner = stringValue(this.pickFieldValue(record, [fieldMap.owner, fieldMap.ownerId]));
    return {
      id: id || code,
      code: code || id,
      name,
      location,
      owner,
      raw: record
    };
  }

  toContact(record, fieldMap) {
    const id =
      stringValue(this.pickFieldValue(record, [fieldMap.id])) ||
      firstPathValue(record, [["ContactID"], ["ContactId"], ["ID"], ["id"]]);
    const displayName = stringValue(this.pickFieldValue(record, [fieldMap.displayName]));
    const firstName = stringValue(this.pickFieldValue(record, [fieldMap.firstName]));
    const lastName = stringValue(this.pickFieldValue(record, [fieldMap.lastName]));
    const email = stringValue(this.pickFieldValue(record, [fieldMap.email]));
    const phone = stringValue(this.pickFieldValue(record, [fieldMap.phone]));
    const businessAccountRef = stringValue(this.pickFieldValue(record, [fieldMap.businessAccountRef]));
    const contactClass =
      stringValue(this.pickFieldValue(record, [fieldMap.contactClass])) ||
      firstPathValue(record, [["ClassID"], ["ClassId"], ["ContactClass"], ["ContactClassID"]]);
    const combinedName = stringValue(`${firstName} ${lastName}`);

    return {
      id,
      displayName: displayName || combinedName || id,
      email,
      phone,
      contactClass,
      businessAccountRef,
      raw: record
    };
  }

  toEmployee(record, fieldMap) {
    const id =
      stringValue(this.pickFieldValue(record, [fieldMap.id])) ||
      firstPathValue(record, [["EmployeeID"], ["AcctCD"], ["BAccountID"], ["UserID"], ["ContactID"], ["ID"], ["id"]]);
    const displayName =
      stringValue(this.pickFieldValue(record, [fieldMap.name])) ||
      firstPathValue(record, [["EmployeeName"], ["DisplayName"], ["Name"], ["AcctName"], ["Description"], ["ContactName"]]);
    const firstName =
      stringValue(this.pickFieldValue(record, [fieldMap.firstName])) ||
      firstPathValue(record, [["FirstName"], ["First"]]);
    const lastName =
      stringValue(this.pickFieldValue(record, [fieldMap.lastName])) ||
      firstPathValue(record, [["LastName"], ["Last"]]);
    const email =
      stringValue(this.pickFieldValue(record, [fieldMap.email])) ||
      firstPathValue(record, [["Email"], ["EMail"], ["EmailAddress"], ["Username"]]);
    const statusRaw =
      stringValue(this.pickFieldValue(record, [fieldMap.status])) ||
      firstPathValue(record, [["Status"], ["EmploymentStatus"], ["Active"], ["IsActive"], ["Disabled"], ["Terminated"]]);
    const normalizedStatus = normalizeSearch(statusRaw);
    const inactiveStatuses = new Set(["inactive", "disabled", "terminated", "false", "0", "no"]);
    const combinedName = stringValue(`${firstName} ${lastName}`);

    return {
      id,
      name: displayName || combinedName || id,
      email,
      isActive: statusRaw ? !inactiveStatuses.has(normalizedStatus) : true,
      raw: record
    };
  }

  formatContactOption(contact) {
    return {
      contactId: contact.id,
      displayName: contact.displayName || contact.id,
      email: contact.email || "",
      phone: contact.phone || "",
      contactClass: contact.contactClass || ""
    };
  }

  formatEmployeeOption(employee) {
    return {
      employeeId: employee.id,
      name: employee.name || employee.id,
      email: employee.email || "",
      isActive: employee.isActive !== false
    };
  }

  buildValidationDetails(baseDetails = {}) {
    return compactObject(baseDetails);
  }

  async resolveBusinessAccount(account = {}) {
    const explicitId = stringValue(account.businessAccountId || account.businessAccount || account.businessAccountCd);
    if (explicitId) {
      return {
        id: explicitId,
        code: explicitId,
        name: stringValue(account.name),
        location: stringValue(account.location),
        owner: stringValue(account.owner || account.ownerEmployeeName)
      };
    }

    const lookup = stringValue(account.name || account.displayName);
    if (!lookup) {
      throw new AcumaticaValidationError(
        "BUSINESS_ACCOUNT_NOT_FOUND",
        "Account name is required to resolve a business account.",
        this.buildValidationDetails()
      );
    }

    const accounts = await this.listBusinessAccounts({ pageSize: 500, maxRecords: 50000 });
    const match = bestMatch(accounts, lookup, (item) => [item.businessAccountId, item.name]);

    if (match.match) {
      return {
        id: match.match.businessAccountId,
        code: match.match.businessAccountId,
        name: match.match.name || match.match.businessAccountId,
        location: stringValue(account.location),
        owner: stringValue(account.owner || match.match.owner)
      };
    }

    if (match.ambiguous) {
      throw new AcumaticaValidationError(
        "BUSINESS_ACCOUNT_AMBIGUOUS",
        `Multiple business accounts matched "${lookup}".`,
        this.buildValidationDetails({
          accountOptions: match.ambiguous.slice(0, 10).map((item) => ({
            businessAccountId: item.businessAccountId,
            businessAccountCode: item.businessAccountId,
            name: item.name
          }))
        })
      );
    }

    throw new AcumaticaValidationError(
      "BUSINESS_ACCOUNT_NOT_FOUND",
      `No business account matched "${lookup}".`,
      this.buildValidationDetails()
    );
  }

  async resolveContactForBusinessAccount(account = {}, businessAccount = {}) {
    const scopedFromBusinessAccount = await this.listBusinessAccountContacts(businessAccount.id || businessAccount.code);
    const isRecoverableContactLookupError = (error) =>
      error instanceof Error &&
      (error.message.includes("Acumatica request failed (400)") ||
        error.message.includes("Acumatica request failed (404)") ||
        error.message.includes("Acumatica request failed (500)"));

    let contacts = [];
    try {
      const meta = await this.resolveContactMeta();
      const fieldMap = this.getContactFieldMap(meta.fields || []);
      const rows = await this.listEntityRows(meta.entityName);
      contacts = rows
        .map((row) => this.toContact(row, fieldMap))
        .filter((item) => item.id);
    } catch (error) {
      if (!isRecoverableContactLookupError(error)) throw error;
    }

    if (scopedFromBusinessAccount.length) {
      contacts = dedupeBy([...scopedFromBusinessAccount, ...contacts], (contact) => normalizeSearch(contact.id));
    }

    const accountRefs = [businessAccount.id, businessAccount.code]
      .map(normalizeSearch)
      .filter(Boolean);

    const exactScoped = contacts.filter((contact) => {
      const ref = normalizeSearch(contact.businessAccountRef);
      return ref && accountRefs.includes(ref);
    });

    const scopedFromGenericContacts =
      exactScoped.length > 0
        ? exactScoped
        : contacts.filter((contact) => {
            const ref = normalizeSearch(contact.businessAccountRef);
            if (!ref) return false;
            return accountRefs.some((accountRef) => ref.includes(accountRef) || accountRef.includes(ref));
          });

    const scopedContacts = scopedFromBusinessAccount.length
      ? dedupeBy([...scopedFromBusinessAccount, ...scopedFromGenericContacts], (contact) => normalizeSearch(contact.id))
      : scopedFromGenericContacts;

    const explicitContactId = stringValue(account.contactId);
    const contactName = stringValue(account.contactName || account.contact || account.contactDisplayName);

    if (explicitContactId) {
      const foundInScoped = scopedContacts.find((contact) => normalizeSearch(contact.id) === normalizeSearch(explicitContactId));
      if (foundInScoped) return foundInScoped;

      const foundElsewhere = contacts.find((contact) => normalizeSearch(contact.id) === normalizeSearch(explicitContactId));
      if (foundElsewhere) {
        throw new AcumaticaValidationError(
          "CONTACT_INVALID_FOR_ACCOUNT",
          `Contact ${explicitContactId} does not belong to business account ${businessAccount.id}.`,
          this.buildValidationDetails({
            businessAccountId: businessAccount.id,
            contactOptions: scopedContacts.slice(0, 20).map((item) => this.formatContactOption(item))
          })
        );
      }

      throw new AcumaticaValidationError(
        "CONTACT_NOT_FOUND",
        `Contact ${explicitContactId} was not found.`,
        this.buildValidationDetails({
          businessAccountId: businessAccount.id,
          contactOptions: scopedContacts.slice(0, 20).map((item) => this.formatContactOption(item))
        })
      );
    }

    if (contactName) {
      const match = bestMatch(scopedContacts, contactName, (item) => [item.id, item.displayName, item.email, item.phone]);
      if (match.match) return match.match;
      if (match.ambiguous) {
        throw new AcumaticaValidationError(
          "CONTACT_SELECTION_REQUIRED",
          `Multiple contacts matched "${contactName}" for account ${businessAccount.id}.`,
          this.buildValidationDetails({
            businessAccountId: businessAccount.id,
            contactOptions: match.ambiguous.slice(0, 20).map((item) => this.formatContactOption(item))
          })
        );
      }

      throw new AcumaticaValidationError(
        "CONTACT_NOT_FOUND",
        `No contact matched "${contactName}" for account ${businessAccount.id}.`,
        this.buildValidationDetails({
          businessAccountId: businessAccount.id,
          contactOptions: scopedContacts.slice(0, 20).map((item) => this.formatContactOption(item))
        })
      );
    }

    if (scopedContacts.length === 1) {
      return scopedContacts[0];
    }

    if (scopedContacts.length === 0) {
      throw new AcumaticaValidationError(
        "CONTACT_NOT_FOUND",
        `No contacts were found for business account ${businessAccount.id}.`,
        this.buildValidationDetails({ businessAccountId: businessAccount.id })
      );
    }

    throw new AcumaticaValidationError(
      "CONTACT_SELECTION_REQUIRED",
      `Multiple contacts are available for business account ${businessAccount.id}.`,
      this.buildValidationDetails({
        businessAccountId: businessAccount.id,
        contactOptions: scopedContacts.slice(0, 20).map((item) => this.formatContactOption(item))
      })
    );
  }

  buildOpportunityPayload(meta, input = {}) {
    const fieldMap = this.getOpportunityFieldMap(meta.fields || []);
    const defaults = this.settings.opportunity || {};

    const classId = stringValue(input.classId || defaults.classId);
    const businessAccountId = stringValue(input.businessAccountId);
    const location = stringValue(input.location || defaults.location);
    const contactId = stringValue(input.contactId);
    const stage = stringValue(input.stage || defaults.stage);
    const owner = stringValue(input.owner || defaults.owner);
    const subject = stringValue(input.subject);
    const estimation = stringValue(input.estimation || toIsoWithOffset(defaults.estimationOffsetDays));
    const note = stringValue(input.note);
    const attributes = Array.isArray(input.attributes) ? input.attributes : defaults.attributes || [];

    const payload = {};
    const setValue = (resolvedFieldName, fallbackFieldName, value) => {
      if (value === undefined || value === null) return;
      if (typeof value === "string" && value.trim() === "") return;
      const fieldName = resolvedFieldName || fallbackFieldName;
      if (!fieldName) return;
      payload[fieldName] = { value };
    };

    setValue(fieldMap.classId, "ClassID", classId);
    setValue(fieldMap.businessAccount, "BusinessAccount", businessAccountId);
    setValue(fieldMap.location, "Location", location);
    setValue(fieldMap.contactId, "ContactID", contactId);
    setValue(fieldMap.stage, "Stage", stage);
    setValue(fieldMap.owner, "Owner", owner);
    setValue(fieldMap.subject, "Subject", subject);
    setValue(fieldMap.estimation, "Estimation", estimation);
    setValue(fieldMap.note, "note", note);

    if (attributes.length) {
      const attributeField = fieldMap.attributes || "Attributes";
      payload[attributeField] = attributes
        .map((item) => {
          const attributeId = stringValue(item.attributeId || item.AttributeID || item.id);
          const value = unwrapValue(item.value ?? item.Value ?? item.attributeValue);
          if (!attributeId || value === undefined || value === null || value === "") return null;
          return {
            AttributeID: { value: attributeId },
            Value: { value }
          };
        })
        .filter(Boolean);
    }

    return payload;
  }

  buildValuePayload(fields, data) {
    const payload = {};
    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      const fieldName = resolveFieldName(fields, FIELD_CANDIDATES[key] || [key]);
      if (!fieldName) return;
      payload[fieldName] = { value };
    });
    return payload;
  }

  resolveDetailMeta(details, detailName, fallbackNames) {
    if (detailName) {
      const found = details.find((detail) => (detail.name || "").toLowerCase() === detailName.toLowerCase());
      if (found) return found;
    }
    return pickDetail(details, fallbackNames, detailName);
  }

  extractQuoteKey(response) {
    if (!response || typeof response !== "object") return "";
    const candidates = FIELD_CANDIDATES.key.map((name) => normalizeName(name));
    for (const [key, value] of Object.entries(response)) {
      if (!value || typeof value !== "object") continue;
      if (candidates.includes(normalizeName(key))) {
        return value.value || "";
      }
    }
    return "";
  }

  extractQuoteNumber(response) {
    if (!response || typeof response !== "object") return "";
    const candidates = FIELD_CANDIDATES.quoteNbr.map((name) => normalizeName(name));
    for (const [key, value] of Object.entries(response)) {
      if (!value || typeof value !== "object") continue;
      if (candidates.includes(normalizeName(key))) {
        return value.value || "";
      }
    }
    return "";
  }

  extractQuoteId(response) {
    if (!response || typeof response !== "object") return "";
    const quoteId = stringValue(response?.QuoteID?.value ?? response?.QuoteID);
    if (quoteId) return quoteId;

    const quoteIdAlt = stringValue(response?.QuoteId?.value ?? response?.QuoteId);
    if (quoteIdAlt) return quoteIdAlt;

    const idField = stringValue(response?.ID?.value ?? response?.ID);
    if (idField) return idField;

    const responseId = stringValue(response.id);
    return responseId || "";
  }

  extractOpportunityKey(response) {
    if (!response || typeof response !== "object") return "";
    const candidates = OPPORTUNITY_FIELD_CANDIDATES.id.map((name) => normalizeName(name));
    for (const [key, value] of Object.entries(response)) {
      if (!value || typeof value !== "object") continue;
      if (candidates.includes(normalizeName(key))) {
        return value.value || "";
      }
    }
    return "";
  }

  buildQuotePayload(meta, summaryText, options = {}) {
    const fields = meta.fields || [];
    const quoteIdField = resolveFieldName(fields, FIELD_CANDIDATES.quoteId);
    const businessAccountField = resolveFieldName(fields, FIELD_CANDIDATES.businessAccount);
    const contactField = resolveFieldName(fields, FIELD_CANDIDATES.contact);
    const dateField = resolveFieldName(fields, FIELD_CANDIDATES.date);
    const projectTemplateField = resolveFieldName(fields, FIELD_CANDIDATES.projectTemplate);
    const subjectField = resolveFieldName(fields, FIELD_CANDIDATES.quoteSubject);
    const descriptionField = resolveFieldName(fields, FIELD_CANDIDATES.description);
    const noteField = resolveFieldName(fields, FIELD_CANDIDATES.note);
    const attributesField = resolveFieldName(fields, FIELD_CANDIDATES.attributes);
    const opportunityField = resolveFieldName(fields, FIELD_CANDIDATES.opportunityId);
    const payload = {};

    const setValue = (resolvedFieldName, fallbackFieldName, value) => {
      if (value === undefined || value === null) return;
      if (typeof value === "string" && value.trim() === "") return;
      const fieldName = resolvedFieldName || fallbackFieldName;
      if (!fieldName) return;
      payload[fieldName] = { value };
    };

    const contactValueRaw = String(options.contactId || "").trim();
    const contactNumeric = /^\d+$/.test(contactValueRaw) ? Number(contactValueRaw) : contactValueRaw;
    const quoteDate = stringValue(options.date || new Date().toISOString());
    const taskDetailName = stringValue(options.taskDetailName || this.settings.taskDetailName) || "Tasks";
    const lineDetailName = stringValue(options.lineDetailName || this.settings.lineDetailName) || "Estimation";
    const subjectText = stringValue(options.subject || summaryText || options.description);
    const descriptionText = stringValue(options.description || summaryText || subjectText);
    const attributes = Array.isArray(options.attributes) ? options.attributes : [];
    const tasks = Array.isArray(options.tasks) ? options.tasks : [];
    const lines = Array.isArray(options.lines) ? options.lines : [];

    setValue(quoteIdField, "QuoteID", "<NEW>");
    setValue(businessAccountField, "BusinessAccount", options.businessAccountId);
    setValue(contactField, "Contact", contactNumeric);
    setValue(dateField, "Date", quoteDate);
    setValue(projectTemplateField, "ProjectTemplate", options.projectTemplate);
    setValue(descriptionField, "Description", descriptionText);
    setValue(subjectField, "Subject", subjectText);
    setValue(noteField, "note", options.note);
    setValue(opportunityField, "OpportunityID", options.opportunityId);

    if (attributes.length) {
      const attributeFieldName = attributesField || "Attributes";
      payload[attributeFieldName] = attributes
        .map((item) => {
          const attributeId = stringValue(item.attributeId || item.AttributeID || item.id);
          const value = unwrapValue(item.value ?? item.Value ?? item.attributeValue);
          if (!attributeId || value === undefined || value === null || value === "") return null;
          return {
            AttributeID: { value: attributeId },
            Value: { value }
          };
        })
        .filter(Boolean);
    }

    if (tasks.length) {
      payload[taskDetailName] = tasks.map((task) => ({
        ProjectTask: { value: task.taskCd },
        Description: { value: task.description || task.taskCd },
        PlannedStartDate: { value: task.plannedStartDate || quoteDate },
        PlannedEndDate: { value: task.plannedEndDate || quoteDate },
        Type: { value: task.type || "Cost and Revenue Task" },
        Default: { value: task.default === undefined ? false : Boolean(task.default) },
        ...(task.taxCategory ? { TaxCategory: { value: task.taxCategory } } : {})
      }));
    }

    if (lines.length) {
      payload[lineDetailName] = lines.map((line) => {
        const resolvedUom = resolveAcumaticaCompatibleUom(line.uom, line.expenseGroup === "L" ? "HOUR" : "EACH");
        return {
        ProjectTask: { value: line.taskCd },
        Description: { value: line.description },
        CostAccountGroup: { value: line.expenseGroup },
        RevenueAccountGroup: { value: line.revenueGroup },
        ...(line.costCode ? { CostCode: { value: line.costCode } } : {}),
        Quantity: { value: line.quantity },
        ...(resolvedUom ? { UOM: { value: resolvedUom } } : {}),
        UnitCost: { value: line.unitCost },
        UnitPrice: { value: line.unitPrice },
        ...(line.taxCategory ? { TaxCategory: { value: line.taxCategory } } : {}),
        ...(line.estimator ? { Estimator: { value: line.estimator } } : {}),
        ...(line.tradeDivision ? { TradeNMSDivision: { value: line.tradeDivision } } : {}),
        ManualPrice: { value: line.manualPrice === undefined ? true : Boolean(line.manualPrice) },
        ManualDiscount: { value: line.manualDiscount === undefined ? true : Boolean(line.manualDiscount) },
        Discount: { value: line.discount === undefined ? 0 : line.discount }
        };
      });
    }

    return payload;
  }

  buildCanonicalLinePayloads(lines, options = {}) {
    const minimal = Boolean(options.minimal);
    return lines.map((line) => {
      const resolvedUom = resolveAcumaticaCompatibleUom(line.uom, line.expenseGroup === "L" ? "HOUR" : "EACH");
      return {
        ProjectTask: { value: line.taskCd },
        Description: { value: line.description },
        CostAccountGroup: { value: line.expenseGroup },
        RevenueAccountGroup: { value: line.revenueGroup },
        ...(!minimal && line.costCode ? { CostCode: { value: line.costCode } } : {}),
        Quantity: { value: line.quantity },
        ...(resolvedUom ? { UOM: { value: resolvedUom } } : {}),
        UnitCost: { value: line.unitCost },
        UnitPrice: { value: line.unitPrice },
        ...(!minimal && line.taxCategory ? { TaxCategory: { value: line.taxCategory } } : {}),
        ...(!minimal && line.estimator ? { Estimator: { value: line.estimator } } : {}),
        ...(!minimal && line.tradeDivision ? { TradeNMSDivision: { value: line.tradeDivision } } : {}),
        ManualPrice: { value: line.manualPrice === undefined ? true : Boolean(line.manualPrice) },
        ManualDiscount: { value: line.manualDiscount === undefined ? true : Boolean(line.manualDiscount) },
        Discount: { value: line.discount === undefined ? 0 : line.discount }
      };
    });
  }

  buildTasksPayload(detailMeta, tasks) {
    const fields = extractFields(detailMeta);
    const fieldMap = this.getFieldMap(fields);
    return tasks.map((task) => {
      const payload = {};
      if (fieldMap.task) payload[fieldMap.task] = { value: task.taskCd };
      if (fieldMap.taskDescription) payload[fieldMap.taskDescription] = { value: task.description };
      if (fieldMap.taskType && task.type) payload[fieldMap.taskType] = { value: task.type };
      if (fieldMap.taskDefault && task.default !== undefined) payload[fieldMap.taskDefault] = { value: Boolean(task.default) };
      if (fieldMap.plannedStartDate && task.plannedStartDate) payload[fieldMap.plannedStartDate] = { value: task.plannedStartDate };
      if (fieldMap.plannedEndDate && task.plannedEndDate) payload[fieldMap.plannedEndDate] = { value: task.plannedEndDate };
      if (fieldMap.taxCategory && task.taxCategory) payload[fieldMap.taxCategory] = { value: task.taxCategory };
      return payload;
    });
  }

  buildLinesPayload(detailMeta, lines, defaultInventoryId) {
    const fields = extractFields(detailMeta);
    const fieldMap = this.getFieldMap(fields);
    return lines.map((line) => {
      const payload = {};
      const resolvedUom = resolveAcumaticaCompatibleUom(line.uom, line.expenseGroup === "L" ? "HOUR" : "EACH");
      if (fieldMap.task) payload[fieldMap.task] = { value: line.taskCd };
      if (fieldMap.description) payload[fieldMap.description] = { value: line.description };
      if (fieldMap.expenseGroup) payload[fieldMap.expenseGroup] = { value: line.expenseGroup };
      if (fieldMap.revenueGroup) payload[fieldMap.revenueGroup] = { value: line.revenueGroup };
      if (fieldMap.costCode && line.costCode) payload[fieldMap.costCode] = { value: line.costCode };
      if (fieldMap.uom && resolvedUom) payload[fieldMap.uom] = { value: resolvedUom };
      if (fieldMap.quantity) payload[fieldMap.quantity] = { value: line.quantity };
      if (fieldMap.unitCost) payload[fieldMap.unitCost] = { value: line.unitCost };
      if (fieldMap.unitPrice) payload[fieldMap.unitPrice] = { value: line.unitPrice };
      if (fieldMap.taxCategory && line.taxCategory) payload[fieldMap.taxCategory] = { value: line.taxCategory };
      if (fieldMap.estimator && line.estimator) payload[fieldMap.estimator] = { value: line.estimator };
      if (fieldMap.tradeDivision && line.tradeDivision) payload[fieldMap.tradeDivision] = { value: line.tradeDivision };
      if (fieldMap.manualPrice && line.manualPrice !== undefined) payload[fieldMap.manualPrice] = { value: Boolean(line.manualPrice) };
      if (fieldMap.manualDiscount && line.manualDiscount !== undefined) {
        payload[fieldMap.manualDiscount] = { value: Boolean(line.manualDiscount) };
      }
      if (fieldMap.discount && line.discount !== undefined) payload[fieldMap.discount] = { value: line.discount };
      if (fieldMap.inventoryId && defaultInventoryId) payload[fieldMap.inventoryId] = { value: defaultInventoryId };
      return payload;
    });
  }

  buildFallbackQuoteMeta(entityName) {
    const taskDetailName = stringValue(this.settings.taskDetailName) || "Tasks";
    const lineDetailName = stringValue(this.settings.lineDetailName) || "Estimation";

    return {
      entityName: stringValue(entityName) || this.settings.quoteEntity || "ProjectQuotes",
      fields: [{ name: this.settings.quoteKeyField || "QuoteNbr" }, { name: "QuoteID" }],
      keyFields: [{ name: this.settings.quoteKeyField || "QuoteNbr" }],
      details: [
        {
          name: taskDetailName,
          fields: [
            { name: "ProjectTask" },
            { name: "Description" },
            { name: "Type" },
            { name: "Default" },
            { name: "PlannedStartDate" },
            { name: "PlannedEndDate" }
          ]
        },
        {
          name: lineDetailName,
          fields: [
            { name: "ProjectTask" },
            { name: "Description" },
            { name: "CostAccountGroup" },
            { name: "RevenueAccountGroup" },
            { name: "CostCode" },
            { name: "UOM" },
            { name: "Quantity" },
            { name: "UnitCost" },
            { name: "UnitPrice" },
            { name: "TaxCategory" },
            { name: "Estimator" },
            { name: "TradeNMSDivision" },
            { name: "ManualPrice" },
            { name: "ManualDiscount" },
            { name: "Discount" },
            { name: "InventoryID" }
          ]
        }
      ]
    };
  }

  async applyTasksAndLines(quoteRef, tasks, lines, options = {}) {
    let meta = options.meta || null;
    const hasUsableMeta = meta && Array.isArray(meta.fields) && meta.fields.length && Array.isArray(meta.details) && meta.details.length;
    if (!hasUsableMeta) {
      const preferredEntity = stringValue(options.entityName);
      try {
        if (preferredEntity) {
          meta = await this.resolveEntityMeta({
            preferred: preferredEntity,
            candidates: [preferredEntity],
            errorMessage: "Could not resolve the Project Quote entity for update."
          });
        } else {
          meta = await this.resolveQuoteMeta();
        }
      } catch (error) {
        if (!isRecoverableEntityCandidateError(error)) throw error;
        meta = this.buildFallbackQuoteMeta(preferredEntity || this.settings.quoteEntity || "ProjectQuotes");
      }
    }

    const updateEntityName = stringValue(options.entityName || meta.entityName || this.settings.quoteEntity);
    const updateEntityCandidates = dedupeBy(
      [
        "ProjectQuotes",
        updateEntityName,
        this.settings.quoteEntity,
        "ProjectQuote",
        "PMQuote"
      ]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );

    const updateWithEntityFallback = async (payload) => {
      let lastNotFoundError = null;
      for (const entityCandidate of updateEntityCandidates) {
        try {
          return await this.updateQuote(entityCandidate, payload);
        } catch (error) {
          const isNotFound = error instanceof Error && error.message.includes("Acumatica request failed (404)");
          if (!isNotFound) throw error;
          lastNotFoundError = error;
        }
      }

      if (lastNotFoundError) throw lastNotFoundError;
      throw new Error("Unable to resolve a valid Project Quote entity for update.");
    };
    const fields = meta.fields || [];
    const keyField = this.settings.quoteKeyField || resolveFieldName(fields, FIELD_CANDIDATES.key);
    const quoteNbrField = resolveFieldName(fields, FIELD_CANDIDATES.quoteNbr);
    const quoteIdField = resolveFieldName(fields, FIELD_CANDIDATES.quoteId);
    const normalizedQuoteRef =
      quoteRef && typeof quoteRef === "object"
        ? {
          quoteNbr: stringValue(quoteRef.quoteNbr || quoteRef.key || quoteRef.quoteNumber),
            quoteId: stringValue(quoteRef.quoteId || quoteRef.id)
          }
        : { quoteNbr: stringValue(quoteRef), quoteId: "" };

    const payloadBase = {};
    if (quoteNbrField && normalizedQuoteRef.quoteNbr) {
      payloadBase[quoteNbrField] = { value: normalizedQuoteRef.quoteNbr };
    }
    if (quoteIdField && normalizedQuoteRef.quoteId) {
      payloadBase[quoteIdField] = { value: normalizedQuoteRef.quoteId };
    }
    if (!Object.keys(payloadBase).length && keyField) {
      const fallbackKey = normalizedQuoteRef.quoteNbr || normalizedQuoteRef.quoteId;
      if (fallbackKey) {
        payloadBase[keyField] = { value: fallbackKey };
      }
    }
    if (!Object.keys(payloadBase).length) {
      throw new Error("Unable to resolve quote key fields for Project Quote update.");
    }

    const taskDetail = this.resolveDetailMeta(meta.details, this.settings.taskDetailName, TASK_DETAIL_CANDIDATES);
    const lineDetail = this.resolveDetailMeta(meta.details, this.settings.lineDetailName, LINE_DETAIL_CANDIDATES);

    if (!taskDetail) {
      throw new Error("Unable to resolve the Tasks detail for Project Quote.");
    }
    const taskPayloads = this.buildTasksPayload(taskDetail, tasks);
    const canonicalLinePayloads = this.buildCanonicalLinePayloads(lines, { minimal: false });
    const canonicalMinimalLinePayloads = this.buildCanonicalLinePayloads(lines, { minimal: true });

    if (taskPayloads.length) {
      const tasksUpdate = {
        ...payloadBase,
        [taskDetail.name]: taskPayloads
      };
      await updateWithEntityFallback(tasksUpdate);
    }

    if (canonicalLinePayloads.length) {
      const lineDetailNames = dedupeBy(
        [
          stringValue(this.settings.lineDetailName),
          stringValue(lineDetail?.name),
          ...LINE_DETAIL_CANDIDATES
        ].filter(Boolean),
        (value) => normalizeName(value)
      );

      let lastLineError = null;

      for (const detailName of lineDetailNames) {
        const detailMeta = (meta.details || []).find((detail) => normalizeName(detail.name) === normalizeName(detailName));
        const mappedPayloads = detailMeta ? this.buildLinesPayload(detailMeta, lines, this.settings.defaultInventoryId) : [];
        const linePayloadVariants = [mappedPayloads, canonicalLinePayloads, canonicalMinimalLinePayloads].filter(
          (payloadSet) => Array.isArray(payloadSet) && payloadSet.length
        );

        for (const linePayloads of linePayloadVariants) {
          try {
            const linesUpdate = {
              ...payloadBase,
              [detailName]: linePayloads
            };
            await updateWithEntityFallback(linesUpdate);
            return;
          } catch (error) {
            lastLineError = error;
            if (!isRecoverableLineDetailError(error)) throw error;
          }
        }
      }

      try {
        const linesUpdate = {
          ...payloadBase,
          Estimation: canonicalLinePayloads,
          Products: canonicalLinePayloads
        };
        await updateWithEntityFallback(linesUpdate);
        return;
      } catch (error) {
        lastLineError = error;
      }

      if (lastLineError) throw lastLineError;
    }
  }

  async updateQuoteAttributes(quoteRef, attributes, options = {}) {
    const normalizedAttributes = Array.isArray(attributes)
      ? attributes
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const attributeId = stringValue(item.attributeId || item.AttributeID || item.id);
            const value = unwrapValue(item.value ?? item.Value ?? item.attributeValue);
            if (!attributeId || value === undefined || value === null || value === "") return null;
            return {
              AttributeID: { value: attributeId },
              Value: { value }
            };
          })
          .filter(Boolean)
      : [];
    if (!normalizedAttributes.length) return;

    const normalizedQuoteRef =
      quoteRef && typeof quoteRef === "object"
        ? {
            quoteNbr: stringValue(quoteRef.quoteNbr || quoteRef.key || quoteRef.quoteNumber),
            quoteId: stringValue(quoteRef.quoteId || quoteRef.id)
          }
        : { quoteNbr: stringValue(quoteRef), quoteId: "" };

    if (!normalizedQuoteRef.quoteNbr && !normalizedQuoteRef.quoteId) {
      throw new Error("Unable to resolve quote key fields for Project Quote attribute update.");
    }

    const payloadCandidates = [];
    if (normalizedQuoteRef.quoteNbr) {
      payloadCandidates.push(
        { QuoteNbr: { value: normalizedQuoteRef.quoteNbr }, Attributes: normalizedAttributes },
        { QuoteID: { value: normalizedQuoteRef.quoteNbr }, Attributes: normalizedAttributes }
      );
    }
    if (normalizedQuoteRef.quoteId) {
      payloadCandidates.push(
        { id: normalizedQuoteRef.quoteId, Attributes: normalizedAttributes },
        { ID: { value: normalizedQuoteRef.quoteId }, Attributes: normalizedAttributes },
        { QuoteID: { value: normalizedQuoteRef.quoteId }, Attributes: normalizedAttributes },
        { QuoteNbr: { value: normalizedQuoteRef.quoteId }, Attributes: normalizedAttributes }
      );
    }

    const uniquePayloadCandidates = dedupeBy(
      payloadCandidates.filter((item) => item && typeof item === "object"),
      (item) => JSON.stringify(item)
    );
    if (!uniquePayloadCandidates.length) {
      throw new Error("Unable to build quote payload for attribute update.");
    }

    const entityCandidates = dedupeBy(
      [options.entityName, this.settings.quoteEntity, ...DEFAULT_QUOTE_ENTITY_CANDIDATES]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );

    let lastRecoverableError = null;
    for (const entityCandidate of entityCandidates) {
      for (const payload of uniquePayloadCandidates) {
        try {
          const response = await this.updateQuote(entityCandidate, payload);
          return {
            entityName: entityCandidate,
            payload,
            response,
            backupLink: extractBackupLinkFromQuotePayload(response)
          };
        } catch (error) {
          const status = extractAcumaticaStatusCode(error);
          const isRecoverable =
            status === 400 || status === 404 || status === 405 || status === 406 || status === 422 || status === 500;
          if (!isRecoverable) throw error;
          lastRecoverableError = error;
        }
      }
    }

    if (lastRecoverableError) throw lastRecoverableError;
    throw new Error("Unable to resolve a valid Project Quote entity for attribute update.");
  }

  async getQuoteBackupLink(quoteRef, options = {}) {
    const preferredEntity = stringValue(options.entityName || this.settings.quoteEntity);
    const entityCandidates = dedupeBy(
      [preferredEntity, ...this.getQuoteEntityCandidates()].filter(Boolean),
      (value) => normalizeName(value)
    );

    const normalizedQuoteRef =
      quoteRef && typeof quoteRef === "object"
        ? {
            quoteNbr: stringValue(quoteRef.quoteNbr || quoteRef.key || quoteRef.quoteNumber || quoteRef.QuoteID),
            quoteId: stringValue(quoteRef.quoteId || quoteRef.id || quoteRef.ID)
          }
        : { quoteNbr: stringValue(quoteRef), quoteId: "" };

    const keysToTry = dedupeBy(
      [normalizedQuoteRef.quoteNbr, normalizedQuoteRef.quoteId].filter(Boolean),
      (value) => value
    );

    const makeFilter = (fieldName, fieldValue) =>
      `${fieldName} eq '${String(fieldValue || "").replace(/'/g, "''")}'`;

    for (const entityName of entityCandidates) {
      for (const key of keysToTry) {
        const directPaths = [
          `${entityName}/${encodeURIComponent(key)}?$expand=Attributes`,
          `${entityName}/${encodeURIComponent(key)}`
        ];

        for (const path of directPaths) {
          try {
            const response = await this.rawRequest(path, { method: "GET" });
            if (!response.ok) continue;
            const payload = await response.json();
            const link = extractBackupLinkFromQuotePayload(payload);
            if (link) {
              return {
                link,
                fileId: extractSpreadsheetIdFromUrl(link),
                entityName,
                path
              };
            }
          } catch (_error) {
            // Continue through alternate resolution strategies.
          }
        }
      }

      if (normalizedQuoteRef.quoteNbr) {
        const queryPaths = [
          `${entityName}?$filter=${encodeURIComponent(makeFilter("QuoteNbr", normalizedQuoteRef.quoteNbr))}&$expand=Attributes`,
          `${entityName}?$filter=${encodeURIComponent(makeFilter("QuoteID", normalizedQuoteRef.quoteNbr))}&$expand=Attributes`
        ];

        for (const path of queryPaths) {
          try {
            const response = await this.rawRequest(path, { method: "GET" });
            if (!response.ok) continue;
            const payload = await response.json();
            const link = extractBackupLinkFromQuotePayload(payload);
            if (link) {
              return {
                link,
                fileId: extractSpreadsheetIdFromUrl(link),
                entityName,
                path
              };
            }
          } catch (_error) {
            // Continue through alternate resolution strategies.
          }
        }
      }
    }

    return { link: "", fileId: "" };
  }

  async getQuoteFilesPutLink(quoteRef, options = {}) {
    const preferredEntity = stringValue(options.entityName || this.settings.quoteEntity);
    const entityCandidates = dedupeBy(
      [preferredEntity, ...this.getQuoteEntityCandidates()].filter(Boolean),
      (value) => normalizeName(value)
    );

    const normalizedQuoteRef =
      quoteRef && typeof quoteRef === "object"
        ? {
            quoteNbr: stringValue(quoteRef.quoteNbr || quoteRef.key || quoteRef.quoteNumber || quoteRef.QuoteID),
            quoteId: stringValue(quoteRef.quoteId || quoteRef.id || quoteRef.ID)
          }
        : { quoteNbr: stringValue(quoteRef), quoteId: "" };

    const keysToTry = dedupeBy(
      [normalizedQuoteRef.quoteNbr, normalizedQuoteRef.quoteId].filter(Boolean),
      (value) => value
    );

    const makeFilter = (fieldName, fieldValue) =>
      `${fieldName} eq '${String(fieldValue || "").replace(/'/g, "''")}'`;

    for (const entityName of entityCandidates) {
      for (const key of keysToTry) {
        const directPaths = [
          `${entityName}/${encodeURIComponent(key)}`,
          `${entityName}/${encodeURIComponent(key)}?$expand=Attributes`
        ];

        for (const path of directPaths) {
          try {
            const response = await this.rawRequest(path, { method: "GET" });
            if (!response.ok) continue;
            const payload = await response.json();
            const link = extractFilesPutLinkFromQuotePayload(payload);
            if (link) {
              return {
                link,
                entityName,
                path
              };
            }
          } catch (_error) {
            // Continue through alternate resolution strategies.
          }
        }
      }

      if (normalizedQuoteRef.quoteNbr) {
        const queryPaths = [
          `${entityName}?$filter=${encodeURIComponent(makeFilter("QuoteNbr", normalizedQuoteRef.quoteNbr))}&$top=1`,
          `${entityName}?$filter=${encodeURIComponent(makeFilter("QuoteID", normalizedQuoteRef.quoteNbr))}&$top=1`
        ];

        for (const path of queryPaths) {
          try {
            const response = await this.rawRequest(path, { method: "GET" });
            if (!response.ok) continue;
            const payload = await response.json();
            const link = extractFilesPutLinkFromQuotePayload(payload);
            if (link) {
              return {
                link,
                entityName,
                path
              };
            }
          } catch (_error) {
            // Continue through alternate resolution strategies.
          }
        }
      }
    }

    return { link: "" };
  }

  async uploadQuoteFile(quoteRef, fileName, fileBytes, options = {}) {
    const bytes =
      fileBytes instanceof Uint8Array
        ? fileBytes
        : fileBytes instanceof ArrayBuffer
          ? new Uint8Array(fileBytes)
          : fileBytes
            ? new Uint8Array(fileBytes)
            : new Uint8Array();
    if (!bytes.length) {
      throw new Error("Quote file upload requires non-empty bytes.");
    }

    const resolvedFileName = sanitizeUploadFileName(fileName, "quote-backup.pdf");

    let filesPutLink = stringValue(options.filesPutLink);
    if (!filesPutLink) {
      filesPutLink = extractFilesPutLinkFromQuotePayload(options.quotePayload);
    }
    if (!filesPutLink) {
      const lookup = await this.getQuoteFilesPutLink(quoteRef, options);
      filesPutLink = stringValue(lookup?.link);
    }
    if (!filesPutLink) {
      throw new Error("Could not resolve the quote files upload link.");
    }

    const uploadPath = buildFilesPutUploadPath(filesPutLink, resolvedFileName);
    const uploadUrl = absolutizeAcumaticaUrl(uploadPath, this.settings.baseUrl) || uploadPath;
    if (!uploadUrl || !/^https?:\/\//i.test(uploadUrl)) {
      throw new Error("Quote files upload link was invalid.");
    }

    const send = async () => {
      await this.login();
      const timeoutMs = resolveTimeoutMs(
        options.timeoutMs,
        resolveTimeoutMs(this.settings?.requestTimeoutMs, 45000)
      );
      return fetchWithTimeout(uploadUrl, {
        method: "PUT",
        headers: {
          Accept: "application/json,application/octet-stream,*/*",
          "Content-Type": options.contentType || "application/pdf",
          Cookie: this.cookie,
          ...(options.headers || {})
        },
        body: bytes
      }, timeoutMs);
    };

    let response = await send();
    if (response.status === 401 || response.status === 403) {
      if (this.hasCredentials()) {
        await this.login(true);
        response = await send();
      } else {
        throw new AcumaticaAuthExpiredError();
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new AcumaticaAuthExpiredError();
    }

    if (!response.ok) {
      const text = await response.text();
      const detail = parseAcumaticaErrorText(text, response.statusText);
      throw new Error(`Quote file upload failed (${response.status}): ${detail || response.statusText}`);
    }

    let payload = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }
    }

    return {
      success: true,
      status: response.status,
      fileName: resolvedFileName,
      uploadUrl,
      filesPutLink,
      payload
    };
  }

  async createPricingBookForQuote(quoteRef, options = {}) {
    const configuredActionName = stringValue(options.actionName || "CreatePricingBook") || "CreatePricingBook";
    const primaryEntityName = stringValue(options.entityName || this.settings.quoteEntity || "ProjectQuotes");
    const entityCandidates = dedupeBy(
      [
        primaryEntityName,
        ...(typeof this.getQuoteEntityCandidates === "function" ? this.getQuoteEntityCandidates() : []),
        this.settings.quoteEntity,
        "ProjectQuotes"
      ]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );
    const actionNameCandidates = dedupeBy(
      [
        configuredActionName,
        configuredActionName.replace(/\s+/g, ""),
        configuredActionName.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
        "CreatePricingBook",
        "Create Pricing Book",
        "CREATE PRICING BOOK"
      ]
        .map((value) => stringValue(value))
        .filter(Boolean),
      (value) => normalizeName(value)
    );
    const methodCandidates = ["POST", "PUT"];
    const normalizedQuoteRef =
      quoteRef && typeof quoteRef === "object"
        ? {
            quoteNbr: stringValue(quoteRef.quoteNbr || quoteRef.key || quoteRef.quoteNumber || quoteRef.QuoteID),
            quoteId: stringValue(quoteRef.quoteId || quoteRef.id || quoteRef.ID)
          }
        : { quoteNbr: stringValue(quoteRef), quoteId: "" };
    const quoteKeyCandidates = dedupeBy(
      [normalizedQuoteRef.quoteNbr, normalizedQuoteRef.quoteId].filter(Boolean),
      (value) => value
    );

    const attempts = [];
    if (normalizedQuoteRef.quoteNbr) {
      attempts.push({ entity: { QuoteID: { value: normalizedQuoteRef.quoteNbr } } });
      attempts.push({ entity: { QuoteNbr: { value: normalizedQuoteRef.quoteNbr } } });
      attempts.push({ QuoteNbr: { value: normalizedQuoteRef.quoteNbr } });
      attempts.push({ QuoteID: { value: normalizedQuoteRef.quoteNbr } });
    }
    if (normalizedQuoteRef.quoteId) {
      attempts.push({ entity: { id: normalizedQuoteRef.quoteId } });
      attempts.push({ entity: { ID: { value: normalizedQuoteRef.quoteId } } });
      attempts.push({ entity: { QuoteID: { value: normalizedQuoteRef.quoteId } } });
      attempts.push({ entity: { QuoteNbr: { value: normalizedQuoteRef.quoteId } } });
      attempts.push({ id: normalizedQuoteRef.quoteId });
      attempts.push({ ID: { value: normalizedQuoteRef.quoteId } });
      attempts.push({ QuoteID: { value: normalizedQuoteRef.quoteId } });
      attempts.push({ QuoteNbr: { value: normalizedQuoteRef.quoteId } });
    }

    const baseAttempts = dedupeBy(
      attempts.filter((item) => item && typeof item === "object"),
      (item) => JSON.stringify(item)
    );
    if (!baseAttempts.length) {
      throw new Error("Pricing book action requires quoteNbr or quoteId.");
    }
    const serializeInvocation = (value) => (value === null ? "__NO_BODY__" : JSON.stringify(value));
    const uniqueAttempts = dedupeBy(
      baseAttempts.flatMap((item) => [item, { ...item, parameters: {} }]),
      (item) => serializeInvocation(item)
    );
    const keyedPathAttempts = dedupeBy(
      [null, {}, { parameters: {} }, ...uniqueAttempts],
      (item) => serializeInvocation(item)
    );

    let disabledResult = null;
    const recoverableErrors = [];
    const missingActions = new Set();
    const requestPlans = [];
    for (const entityName of entityCandidates) {
      for (const actionName of actionNameCandidates) {
        const actionPath = `${entityName}/${encodeURIComponent(actionName)}`;
        requestPlans.push({
          entityName,
          actionName,
          path: actionPath,
          pathMode: "entity_action",
          invocationCandidates: uniqueAttempts
        });
        for (const quoteKey of quoteKeyCandidates) {
          requestPlans.push({
            entityName,
            actionName,
            path: `${entityName}/${encodeURIComponent(quoteKey)}/${encodeURIComponent(actionName)}`,
            pathMode: "entity_key_action",
            quoteKey,
            invocationCandidates: keyedPathAttempts
          });
        }
      }
    }

    for (const plan of requestPlans) {
      const actionSignature = `${normalizeName(plan.entityName)}::${normalizeName(plan.actionName)}`;
      if (missingActions.has(actionSignature)) continue;
      for (const invocation of plan.invocationCandidates) {
        let actionWasMissing = false;
        for (const method of methodCandidates) {
          const response = await this.rawRequest(plan.path, {
            method,
            ...(invocation !== null ? { body: invocation } : {})
          });

          if (response.ok) {
            let payload = null;
            if (response.status !== 204) {
              try {
                payload = await response.json();
              } catch (_error) {
                payload = null;
              }
            }
            const sheetUrl = extractSpreadsheetUrlFromValue(payload);
            const fileId = extractSpreadsheetIdFromUrl(sheetUrl);

            return {
              success: true,
              created: true,
              status: response.status,
              mode: "ok",
              entityName: plan.entityName,
              actionName: plan.actionName,
              path: plan.path,
              pathMode: plan.pathMode,
              quoteKey: plan.quoteKey,
              invocation,
              method,
              payload,
              sheetUrl,
              fileId
            };
          }

          const rawText = await response.text();
          const parsed = parseJsonSafe(rawText);
          const exceptionType = stringValue(parsed?.exceptionType || parsed?.exception || parsed?.errorType);
          const innerExceptionMessage = stringValue(parsed?.innerException?.exceptionMessage || parsed?.innerException?.message);
          const exceptionMessage = stringValue(parsed?.exceptionMessage || parsed?.message);
          const detail = parseAcumaticaErrorText(rawText, response.statusText);
          const normalizedErrorBlob = `${exceptionType} ${innerExceptionMessage} ${exceptionMessage} ${rawText}`.toLowerCase();
          const sheetUrlFromError = extractSpreadsheetUrlFromValue([rawText, parsed, exceptionMessage, innerExceptionMessage]);
          const fileIdFromError = extractSpreadsheetIdFromUrl(sheetUrlFromError);

          if (response.status === 500 && /pxredirecttourlexception/i.test(exceptionType)) {
            return {
              success: true,
              created: true,
              status: response.status,
              mode: "redirect",
              entityName: plan.entityName,
              actionName: plan.actionName,
              path: plan.path,
              pathMode: plan.pathMode,
              quoteKey: plan.quoteKey,
              invocation,
              method,
              message: exceptionMessage || "CreatePricingBook redirected to the pricing book screen.",
              sheetUrl: sheetUrlFromError,
              fileId: fileIdFromError
            };
          }

          if (
            normalizedErrorBlob.includes("create pricing book button is disabled") ||
            normalizedErrorBlob.includes("button is disabled")
          ) {
            disabledResult = {
              success: false,
              created: false,
              disabled: true,
              status: response.status,
              mode: "disabled",
              entityName: plan.entityName,
              actionName: plan.actionName,
              path: plan.path,
              pathMode: plan.pathMode,
              quoteKey: plan.quoteKey,
              invocation,
              method,
              message: innerExceptionMessage || exceptionMessage || "Create Pricing Book button is disabled.",
              sheetUrl: sheetUrlFromError,
              fileId: fileIdFromError
            };
            continue;
          }

          if (response.status === 404 && /can't find action/i.test(rawText.toLowerCase())) {
            actionWasMissing = true;
            missingActions.add(actionSignature);
            recoverableErrors.push(
              `path=${plan.path} method=${method}: action not found`
            );
            break;
          }

          if (
            response.status === 422 &&
            (parsed?.QuoteID || parsed?.QuoteNbr || parsed?.id || parsed?.ID)
          ) {
            recoverableErrors.push(
              `path=${plan.path} method=${method}: validation mismatch (${response.status})`
            );
            continue;
          }

          if ([400, 404, 405, 406, 409, 422, 500].includes(response.status)) {
            recoverableErrors.push(
              `path=${plan.path} method=${method}: ${detail || response.statusText || `HTTP ${response.status}`}`
            );
            continue;
          }

          throw new Error(
            `Acumatica action ${plan.actionName} failed (${response.status}): ${detail || response.statusText}`
          );
        }

        if (actionWasMissing) break;
      }
    }

    if (disabledResult) return disabledResult;
    if (recoverableErrors.length) {
      const summarized = Array.from(new Set(recoverableErrors)).slice(0, 6).join(" | ");
      throw new Error(
        `Acumatica pricing-book action failed for all attempted entity/action variants. ${summarized}`
      );
    }
    throw new Error("Acumatica pricing-book action failed for all attempted variants.");
  }

  async fetchBinaryByAbsoluteUrl(url, options = {}) {
    const absoluteUrl = absolutizeAcumaticaUrl(url, this.settings.baseUrl) || stringValue(url);
    if (!absoluteUrl) {
      return {
        ok: false,
        status: 0,
        contentType: "",
        error: "Empty or invalid Acumatica URL."
      };
    }

    const send = async () => {
      await this.login();
      const timeoutMs = resolveTimeoutMs(
        options.timeoutMs,
        resolveTimeoutMs(this.settings?.requestTimeoutMs, 45000)
      );
      return fetchWithTimeout(absoluteUrl, {
        method: "GET",
        headers: {
          Accept: options.accept || "application/pdf,application/octet-stream,*/*",
          Cookie: this.cookie,
          ...(options.headers || {})
        }
      }, timeoutMs);
    };

    let response = await send();
    if (response.status === 401 || response.status === 403) {
      if (this.hasCredentials()) {
        await this.login(true);
        response = await send();
      } else {
        throw new AcumaticaAuthExpiredError();
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw new AcumaticaAuthExpiredError();
    }

    const contentType = stringValue(response.headers.get("content-type")).toLowerCase();
    const contentDisposition = stringValue(response.headers.get("content-disposition"));
    if (!response.ok) {
      const rawText = await response.text();
      return {
        ok: false,
        status: response.status,
        contentType,
        contentDisposition,
        error: parseAcumaticaErrorText(rawText, response.statusText)
      };
    }

    if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        ok: true,
        status: response.status,
        contentType: contentType || "application/pdf",
        contentDisposition,
        bytes
      };
    }

    const rawText = await response.text();
    const nestedUrl = extractHttpUrlFromText(rawText, this.settings.baseUrl);
    return {
      ok: true,
      status: response.status,
      contentType,
      contentDisposition,
      text: rawText,
      nestedUrl
    };
  }

  async printQuoteForQuote(quoteRef, options = {}) {
    const actionName = stringValue(options.actionName || "PrintQuote") || "PrintQuote";
    const entityName = stringValue(options.entityName || this.settings.quoteEntity || "ProjectQuotes");
    const fetchPdf = options.fetchPdf === true;
    const baseUrl = this.settings.baseUrl;
    const actionTimeoutMs = resolveTimeoutMs(
      options.timeoutMs,
      resolveTimeoutMs(
        this.settings?.quotePrint?.timeoutMs,
        resolveTimeoutMs(this.settings?.requestTimeoutMs, 45000)
      )
    );
    const normalizedQuoteRef =
      quoteRef && typeof quoteRef === "object"
        ? {
            quoteNbr: stringValue(quoteRef.quoteNbr || quoteRef.key || quoteRef.quoteNumber || quoteRef.QuoteNbr),
            quoteId: stringValue(quoteRef.quoteId || quoteRef.id || quoteRef.ID || quoteRef.QuoteID)
          }
        : { quoteNbr: stringValue(quoteRef), quoteId: "" };

    const attempts = [];
    if (normalizedQuoteRef.quoteNbr) {
      attempts.push({ entity: { QuoteNbr: { value: normalizedQuoteRef.quoteNbr } } });
      attempts.push({ entity: { QuoteID: { value: normalizedQuoteRef.quoteNbr } } });
    }
    if (normalizedQuoteRef.quoteId) {
      attempts.push({ entity: { id: normalizedQuoteRef.quoteId } });
      attempts.push({ entity: { ID: { value: normalizedQuoteRef.quoteId } } });
      attempts.push({ entity: { QuoteID: { value: normalizedQuoteRef.quoteId } } });
    }

    const uniqueAttempts = dedupeBy(
      attempts.filter((item) => item && typeof item === "object"),
      (item) => JSON.stringify(item)
    );
    if (!uniqueAttempts.length) {
      throw new Error("Print quote action requires quoteNbr or quoteId.");
    }

    let lastRecoverableError = null;
    for (const invocation of uniqueAttempts) {
      const response = await this.rawRequest(`${entityName}/${encodeURIComponent(actionName)}`, {
        method: "POST",
        body: invocation,
        timeoutMs: actionTimeoutMs
      });

      if (response.ok) {
        const contentType = stringValue(response.headers.get("content-type")).toLowerCase();
        const contentDisposition = stringValue(response.headers.get("content-disposition"));
        if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          return {
            success: true,
            status: response.status,
            mode: "pdf",
            entityName,
            actionName,
            invocation,
            contentType: contentType || "application/pdf",
            contentDisposition,
            pdfBytes: bytes
          };
        }

        let payload = null;
        let rawText = "";
        if (response.status !== 204) {
          if (contentType.includes("application/json")) {
            try {
              payload = await response.json();
            } catch (_error) {
              payload = null;
            }
          } else {
            rawText = await response.text();
            payload = parseJsonSafe(rawText) || rawText;
          }
        }

        const printUrl = extractHttpUrlFromValue(
          [payload, rawText, response.headers.get("location"), response.headers.get("x-redirect-url")],
          baseUrl
        );

        if (fetchPdf && printUrl) {
          const binaryResult = await this.fetchBinaryByAbsoluteUrl(printUrl, {
            timeoutMs: actionTimeoutMs
          });
          if (binaryResult.ok && binaryResult.bytes) {
            return {
              success: true,
              status: response.status,
              mode: "pdf",
              entityName,
              actionName,
              invocation,
              printUrl,
              contentType: binaryResult.contentType || "application/pdf",
              contentDisposition: binaryResult.contentDisposition,
              pdfBytes: binaryResult.bytes
            };
          }
        }

        return {
          success: true,
          status: response.status,
          mode: printUrl ? "url" : "ok",
          entityName,
          actionName,
          invocation,
          printUrl,
          payload
        };
      }

      const rawText = await response.text();
      const parsed = parseJsonSafe(rawText);
      const exceptionType = stringValue(parsed?.exceptionType || parsed?.exception || parsed?.errorType);
      const innerExceptionMessage = stringValue(parsed?.innerException?.exceptionMessage || parsed?.innerException?.message);
      const exceptionMessage = stringValue(parsed?.exceptionMessage || parsed?.message);
      const detail = parseAcumaticaErrorText(rawText, response.statusText);
      const printUrlFromError = extractHttpUrlFromValue(
        [rawText, parsed, exceptionMessage, innerExceptionMessage, response.headers.get("location"), response.headers.get("x-redirect-url")],
        baseUrl
      );

      if (response.status === 500 && /pxredirecttourlexception/i.test(exceptionType)) {
        if (fetchPdf && printUrlFromError) {
          const binaryResult = await this.fetchBinaryByAbsoluteUrl(printUrlFromError, {
            timeoutMs: actionTimeoutMs
          });
          if (binaryResult.ok && binaryResult.bytes) {
            return {
              success: true,
              status: response.status,
              mode: "pdf",
              entityName,
              actionName,
              invocation,
              printUrl: printUrlFromError,
              contentType: binaryResult.contentType || "application/pdf",
              contentDisposition: binaryResult.contentDisposition,
              pdfBytes: binaryResult.bytes
            };
          }
        }

        return {
          success: true,
          status: response.status,
          mode: printUrlFromError ? "redirect" : "redirect_no_url",
          entityName,
          actionName,
          invocation,
          printUrl: printUrlFromError,
          message: exceptionMessage || innerExceptionMessage || "PrintQuote redirected to report view."
        };
      }

      if (
        response.status === 422 &&
        (parsed?.QuoteID || parsed?.QuoteNbr || parsed?.id || parsed?.ID)
      ) {
        lastRecoverableError = new Error(`Acumatica action ${actionName} validation mismatch (${response.status}).`);
        continue;
      }

      if (response.status === 404 && /can't find action/i.test(rawText.toLowerCase())) {
        throw new Error(`Acumatica action ${actionName} was not found on entity ${entityName}.`);
      }

      throw new Error(`Acumatica action ${actionName} failed (${response.status}): ${detail || response.statusText}`);
    }

    if (lastRecoverableError) throw lastRecoverableError;
    throw new Error(`Acumatica action ${actionName} failed for all invocation variants.`);
  }
}

export const __test__ = {
  resolveAcumaticaCompatibleUom
};
