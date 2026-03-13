#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

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

function resolveConfig() {
  const rootDir = process.cwd();
  const envValues = parseEnvFile(path.join(rootDir, ".env.local"));

  return {
    rootDir,
    sqlitePath:
      process.env.READ_MODEL_SQLITE_PATH ||
      envValues.READ_MODEL_SQLITE_PATH ||
      "./data/read-model.sqlite",
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
    username: process.env.ACUMATICA_USERNAME || "",
    password: process.env.ACUMATICA_PASSWORD || "",
  };
}

function parseArgs(argv) {
  const options = {
    apply: false,
    limit: null,
    contactIds: null,
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
    if (arg === "--contact-id") {
      const raw = argv[index + 1];
      const numeric = Number(raw);
      if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error("--contact-id must be a positive integer.");
      }
      if (!options.contactIds) {
        options.contactIds = [];
      }
      options.contactIds.push(numeric);
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
      "  node scripts/normalize-contact-phones.cjs [--apply] [--limit N] [--contact-id N]",
      "",
      "Environment required for --apply:",
      "  ACUMATICA_USERNAME",
      "  ACUMATICA_PASSWORD",
      "",
      "Behavior:",
      "  - reads the shared SQLite snapshot",
      "  - targets primary contact phone values from the SQLite snapshot",
      "  - excludes internal MeadowBrook rows",
      "  - fetches the current Acumatica contact and classifies plain-phone vs extension cases",
      "  - with --apply, updates Contact.Phone1 to ###-###-#### and Contact.Phone2 to extension digits when safe",
      "  - verifies each update and writes a JSON report to data/phone-normalization-report.json",
      "",
    ].join("\n"),
  );
}

function sanitizePhoneInput(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractPhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value) {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return null;
  }

  const digits = extractPhoneDigits(sanitized);
  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length !== 10) {
    return null;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeExtension(value) {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return null;
  }

  const digits = extractPhoneDigits(sanitized);
  return digits.length > 0 ? digits : null;
}

function parsePhoneWithExtension(value) {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return {
      kind: "invalid",
      phone: null,
      extension: null,
    };
  }

  const extensionTailMatch = sanitized.match(
    /^(.*?)(?:\s*(?:ext(?:ension)?\.?|x)\s*([0-9]+(?:\s*\/\s*[0-9]+)*))\s*$/i,
  );
  if (extensionTailMatch) {
    const baseValue = extensionTailMatch[1] ? extensionTailMatch[1].trim() : "";
    const extensionValue = extensionTailMatch[2] ? extensionTailMatch[2].trim() : "";

    if (!baseValue || !extensionValue) {
      return {
        kind: "invalid",
        phone: null,
        extension: null,
      };
    }

    if (extensionValue.includes("/")) {
      return {
        kind: "ambiguous_multiple_extensions",
        phone: null,
        extension: null,
      };
    }

    const normalizedPhone = normalizePhone(baseValue);
    if (!normalizedPhone) {
      return {
        kind: extractPhoneDigits(baseValue).length > 11 ? "ambiguous_multiple_numbers" : "invalid",
        phone: null,
        extension: null,
      };
    }

    const normalizedExtension = normalizeExtension(extensionValue);
    if (!normalizedExtension || normalizedExtension.length > 5) {
      return {
        kind: "ambiguous_multiple_extensions",
        phone: null,
        extension: null,
      };
    }

    return {
      kind: "phone_with_extension",
      phone: normalizedPhone,
      extension: normalizedExtension,
    };
  }

  const normalizedPhone = normalizePhone(sanitized);
  if (normalizedPhone) {
    return {
      kind: "plain_phone",
      phone: normalizedPhone,
      extension: null,
    };
  }

  if (/(?:\b[TMF]:|\r|\n)/i.test(sanitized)) {
    return {
      kind: "ambiguous_multiple_numbers",
      phone: null,
      extension: null,
    };
  }

  if (/(?:ext(?:ension)?\.?|x)\s*[0-9]+/i.test(sanitized)) {
    return {
      kind: "ambiguous_multiple_extensions",
      phone: null,
      extension: null,
    };
  }

  if (extractPhoneDigits(sanitized).length > 11) {
    return {
      kind: "ambiguous_multiple_numbers",
      phone: null,
      extension: null,
    };
  }

  return {
    kind: "invalid",
    phone: null,
    extension: null,
  };
}

function shouldInspectTargetPhone(value) {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return false;
  }

  const parsed = parsePhoneWithExtension(sanitized);
  if (parsed.kind === "phone_with_extension") {
    return true;
  }

  if (
    parsed.kind === "ambiguous_multiple_extensions" ||
    parsed.kind === "ambiguous_multiple_numbers"
  ) {
    return true;
  }

  const normalizedPhone = normalizePhone(sanitized);
  if (normalizedPhone === sanitized) {
    return false;
  }

  return /(?:^|[^a-z])(?:ext(?:ension)?\.?|x)(?:[^a-z]|$)/i.test(sanitized);
}

function readTargets(sqlitePath, limit, contactIds) {
  const db = new Database(sqlitePath, { readonly: true });
  const filters = [
    "contact_id IS NOT NULL",
    "primary_contact_phone IS NOT NULL",
    "LOWER(COALESCE(company_name, '')) NOT LIKE '%meadowbrook%'",
    "LOWER(COALESCE(primary_contact_email, '')) NOT LIKE '%@meadowb.com%'",
    "LOWER(COALESCE(primary_contact_email, '')) NOT LIKE '%@meadowbrookconstruction.ca%'",
  ];
  const params = [];

  if (Array.isArray(contactIds) && contactIds.length > 0) {
    filters.push(`contact_id IN (${contactIds.map(() => "?").join(", ")})`);
    params.push(...contactIds);
  }

  const rows = db
    .prepare(
      `
      SELECT DISTINCT
        contact_id AS contactId,
        account_record_id AS accountRecordId,
        business_account_id AS businessAccountId,
        company_name AS companyName,
        primary_contact_name AS contactName,
        primary_contact_email AS contactEmail,
        primary_contact_phone AS currentPhone
      FROM account_rows
      WHERE ${filters.join("\n        AND ")}
      ORDER BY company_name ASC, contactName ASC, contact_id ASC
      `,
    )
    .all(...params);
  db.close();

  const mapped = rows.map((row) => ({
    ...row,
    formattedPhone: normalizePhone(row.currentPhone),
  }));

  const filtered = mapped.filter((row) => shouldInspectTargetPhone(row.currentPhone));
  return limit ? filtered.slice(0, limit) : filtered;
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
    /api login limit|concurrent api login|users \(sm201010\)|checkapiuserslimits/i.test(
      text || "",
    )
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

    const setCookies = extractSetCookies(response.headers);
    const cookieHeader = buildCookieHeader(setCookies);
    if (!cookieHeader) {
      throw new Error("Acumatica login succeeded but no session cookies were returned.");
    }

    return cookieHeader;
  }

  throw new Error("Acumatica login failed after repeated retries.");
}

async function fetchContact(config, cookieHeader, contactId) {
  const url = new URL(
    `${config.acumaticaEntityPath}/Contact/${encodeURIComponent(String(contactId))}`,
    config.acumaticaBaseUrl,
  ).toString();

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fetch contact ${contactId} failed (${response.status}): ${text || "No response body."}`);
  }

  return response.json();
}

function readWrappedString(record, key) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = record[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = field.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readContactDisplayName(record) {
  const explicit =
    readWrappedString(record, "DisplayName") ||
    readWrappedString(record, "FullName") ||
    readWrappedString(record, "ContactName") ||
    readWrappedString(record, "Attention");
  if (explicit) {
    return explicit;
  }

  const first = readWrappedString(record, "FirstName") || "";
  const middle = readWrappedString(record, "MiddleName") || "";
  const last = readWrappedString(record, "LastName") || "";
  const composite = [first, middle, last].filter(Boolean).join(" ").trim();
  return composite || null;
}

function splitContactName(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return {
      firstName: "",
      lastName: "",
    };
  }

  const parts = trimmed.split(" ");
  if (parts.length === 1) {
    return {
      firstName: "",
      lastName: parts[0],
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) || "",
  };
}

function deriveNameFromEmail(email) {
  const trimmed = String(email || "").trim();
  if (!trimmed.includes("@")) {
    return trimmed || null;
  }

  const local = trimmed.slice(0, trimmed.indexOf("@")).trim();
  return local || null;
}

function classifyContactNormalization(target, currentContact) {
  const currentPhone1 = readWrappedString(currentContact, "Phone1");
  const currentPhone2 = readWrappedString(currentContact, "Phone2");
  const currentPhone3 = readWrappedString(currentContact, "Phone3");
  const parsed = parsePhoneWithExtension(currentPhone1);
  const currentPhone2Normalized = normalizeExtension(currentPhone2);

  if (currentPhone3 && currentPhone3.trim()) {
    return {
      category: "skipped_existing_phone3",
      reason: "Phone3 already contains data.",
      currentPhone1,
      currentPhone2,
      currentPhone3,
      nextPhone1: null,
      nextPhone2: null,
    };
  }

  if (parsed.kind === "phone_with_extension") {
    if (
      currentPhone2 &&
      currentPhone2.trim() &&
      currentPhone2Normalized !== parsed.extension
    ) {
      return {
        category: "skipped_existing_phone2",
        reason: "Phone2 already contains different data.",
        currentPhone1,
        currentPhone2,
        currentPhone3,
        nextPhone1: null,
        nextPhone2: null,
      };
    }

    return {
      category: "split_phone1_to_phone2_extension",
      reason: "Phone1 contains a phone plus extension.",
      currentPhone1,
      currentPhone2,
      currentPhone3,
      nextPhone1: parsed.phone,
      nextPhone2: parsed.extension,
    };
  }

  if (parsed.kind === "plain_phone") {
    if (currentPhone2 && currentPhone2.trim()) {
      if (currentPhone2Normalized && currentPhone2Normalized.length <= 5) {
        if (currentPhone1 === parsed.phone) {
          return {
            category: "already_normalized",
            reason: "Phone1 and Phone2 are already normalized.",
            currentPhone1,
            currentPhone2,
            currentPhone3,
            nextPhone1: parsed.phone,
            nextPhone2: currentPhone2Normalized,
          };
        }

        return {
          category: "formatted_phone1_only",
          reason: "Phone1 can be normalized while preserving the existing extension.",
          currentPhone1,
          currentPhone2,
          currentPhone3,
          nextPhone1: parsed.phone,
          nextPhone2: currentPhone2Normalized,
        };
      }

      return {
        category: "skipped_existing_phone2",
        reason: "Phone2 already contains non-extension data.",
        currentPhone1,
        currentPhone2,
        currentPhone3,
        nextPhone1: null,
        nextPhone2: null,
      };
    }

    if (currentPhone1 === parsed.phone) {
      return {
        category: "already_normalized",
        reason: "Phone1 is already normalized.",
        currentPhone1,
        currentPhone2,
        currentPhone3,
        nextPhone1: parsed.phone,
        nextPhone2: currentPhone2Normalized ?? null,
      };
    }

    return {
      category: "formatted_phone1_only",
      reason: "Phone1 can be normalized to ###-###-####.",
      currentPhone1,
      currentPhone2,
      currentPhone3,
      nextPhone1: parsed.phone,
      nextPhone2: currentPhone2Normalized ?? null,
    };
  }

  if (parsed.kind === "ambiguous_multiple_extensions") {
    return {
      category: "skipped_ambiguous_extension",
      reason: "Phone1 contains an ambiguous or unsupported extension.",
      currentPhone1,
      currentPhone2,
      currentPhone3,
      nextPhone1: null,
      nextPhone2: null,
    };
  }

  if (parsed.kind === "ambiguous_multiple_numbers") {
    return {
      category: "skipped_multiple_numbers",
      reason: "Phone1 appears to contain multiple phone numbers.",
      currentPhone1,
      currentPhone2,
      currentPhone3,
      nextPhone1: null,
      nextPhone2: null,
    };
  }

  return {
    category: "skipped_invalid_base_phone",
    reason: "Phone1 could not be normalized safely.",
    currentPhone1,
    currentPhone2,
    currentPhone3,
    nextPhone1: null,
    nextPhone2: null,
  };
}

function buildContactUpdatePayload(target, currentContact) {
  const recordId =
    typeof currentContact?.id === "string" && currentContact.id.trim()
      ? currentContact.id.trim()
      : "";
  const noteId = readWrappedString(currentContact, "NoteID") || "";
  const currentEmail =
    readWrappedString(currentContact, "Email") ||
    readWrappedString(currentContact, "EMail") ||
    target.contactEmail ||
    "";
  const currentDisplayName = readContactDisplayName(currentContact);
  const fallbackName =
    target.contactName ||
    currentDisplayName ||
    deriveNameFromEmail(currentEmail) ||
    `Contact ${target.contactId}`;
  const split = splitContactName(fallbackName);
  const currentFirstName = readWrappedString(currentContact, "FirstName") || "";
  const currentLastName = readWrappedString(currentContact, "LastName") || "";
  const displayName = currentDisplayName || fallbackName;
  const firstName = currentFirstName || split.firstName;
  const lastName = currentLastName || split.lastName || fallbackName;
  const payload = {
    ContactID: {
      value: target.contactId,
    },
    Phone1: {
      value: target.nextPhone1,
    },
    Phone2: {
      value: target.nextPhone2 || "",
    },
    DisplayName: {
      value: displayName,
    },
    LastName: {
      value: lastName,
    },
  };

  if (recordId) {
    payload.id = recordId;
  }
  if (noteId) {
    payload.NoteID = {
      value: noteId,
    };
  }
  if (firstName) {
    payload.FirstName = {
      value: firstName,
    };
  }
  if (currentEmail) {
    payload.Email = {
      value: currentEmail,
    };
  }

  return payload;
}

async function putJson(url, cookieHeader, payload) {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PUT ${url} failed (${response.status}): ${text || "No response body."}`);
  }
}

async function updateContactPhone(config, cookieHeader, target, currentContact) {
  const payload = buildContactUpdatePayload(target, currentContact);
  const candidates = [
    new URL(`${config.acumaticaEntityPath}/Contact`, config.acumaticaBaseUrl).toString(),
  ];
  const recordId =
    typeof currentContact?.id === "string" && currentContact.id.trim()
      ? currentContact.id.trim()
      : "";

  if (recordId) {
    candidates.push(
      new URL(
        `${config.acumaticaEntityPath}/Contact/${encodeURIComponent(recordId)}`,
        config.acumaticaBaseUrl,
      ).toString(),
    );
  }
  candidates.push(
    new URL(
      `${config.acumaticaEntityPath}/Contact/${encodeURIComponent(String(target.contactId))}`,
      config.acumaticaBaseUrl,
    ).toString(),
  );

  let lastError = null;
  for (const url of candidates) {
    try {
      await putJson(url, cookieHeader, payload);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Update contact ${target.contactId} failed.`);
}

async function logoutOfAcumatica(config, cookieHeader) {
  const logoutUrl = new URL("/entity/auth/logout", config.acumaticaBaseUrl).toString();
  await fetch(logoutUrl, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
    },
  }).catch(() => undefined);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const config = resolveConfig();
  if (!config.acumaticaBaseUrl || !config.acumaticaEntityPath || !config.acumaticaCompany) {
    throw new Error("Missing Acumatica base URL/entity path/company configuration.");
  }

  const sqlitePath = path.resolve(config.rootDir, config.sqlitePath);
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite snapshot not found at ${sqlitePath}`);
  }

  const targets = readTargets(sqlitePath, options.limit, options.contactIds);

  if (!config.username || !config.password) {
    throw new Error(
      "ACUMATICA_USERNAME and ACUMATICA_PASSWORD are required to classify and normalize contact phones.",
    );
  }

  const reportPath = path.join(config.rootDir, "data", "phone-normalization-report.json");
  const categorizedResults = {
    formatted_phone1_only: [],
    split_phone1_to_phone2_extension: [],
    skipped_existing_phone2: [],
    skipped_existing_phone3: [],
    skipped_ambiguous_extension: [],
    skipped_multiple_numbers: [],
    skipped_invalid_base_phone: [],
    already_normalized: [],
    errors: [],
  };
  const cookieHeader = await loginToAcumatica(config);

  try {
    for (const target of targets) {
      try {
        const currentContact = await fetchContact(config, cookieHeader, target.contactId);
        const classification = classifyContactNormalization(target, currentContact);
        const entry = {
          contactId: target.contactId,
          accountRecordId: target.accountRecordId,
          businessAccountId: target.businessAccountId,
          companyName: target.companyName,
          contactName: target.contactName,
          snapshotPhone: target.currentPhone,
          currentPhone1: classification.currentPhone1,
          currentPhone2: classification.currentPhone2,
          currentPhone3: classification.currentPhone3,
          nextPhone1: classification.nextPhone1,
          nextPhone2: classification.nextPhone2,
          reason: classification.reason,
        };

        if (
          classification.category === "formatted_phone1_only" ||
          classification.category === "split_phone1_to_phone2_extension"
        ) {
          if (!options.apply) {
            categorizedResults[classification.category].push({
              ...entry,
              applied: false,
            });
            process.stdout.write(
              `Planned ${classification.category} for contact ${target.contactId}: ${classification.currentPhone1 ?? "null"} -> ${classification.nextPhone1}${classification.nextPhone2 ? ` x ${classification.nextPhone2}` : ""}\n`,
            );
            continue;
          }

          await updateContactPhone(
            config,
            cookieHeader,
            {
              ...target,
              nextPhone1: classification.nextPhone1,
              nextPhone2: classification.nextPhone2,
            },
            currentContact,
          );
          const verification = await fetchContact(config, cookieHeader, target.contactId);
          const verifiedPhone1 = readWrappedString(verification, "Phone1");
          const verifiedPhone2 = normalizeExtension(readWrappedString(verification, "Phone2"));
          if (
            verifiedPhone1 !== classification.nextPhone1 ||
            (classification.nextPhone2 ?? null) !== (verifiedPhone2 ?? null)
          ) {
            throw new Error(
              `Verification mismatch for contact ${target.contactId}: expected ${classification.nextPhone1}${classification.nextPhone2 ? ` x ${classification.nextPhone2}` : ""}, got ${verifiedPhone1 ?? "null"}${verifiedPhone2 ? ` x ${verifiedPhone2}` : ""}.`,
            );
          }

          categorizedResults[classification.category].push({
            ...entry,
            applied: true,
            verifiedPhone1,
            verifiedPhone2,
          });
          process.stdout.write(
            `Updated contact ${target.contactId}: ${classification.currentPhone1 ?? "null"} -> ${verifiedPhone1}${verifiedPhone2 ? ` x ${verifiedPhone2}` : ""}\n`,
          );
          continue;
        }

        categorizedResults[classification.category].push(entry);
        process.stdout.write(
          `Skipped contact ${target.contactId}: ${classification.reason}\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        categorizedResults.errors.push({
          contactId: target.contactId,
          accountRecordId: target.accountRecordId,
          businessAccountId: target.businessAccountId,
          companyName: target.companyName,
          contactName: target.contactName,
          snapshotPhone: target.currentPhone,
          error: message,
        });
        process.stderr.write(`Failed contact ${target.contactId}: ${message}\n`);
      }
    }
  } finally {
    await logoutOfAcumatica(config, cookieHeader);
  }

  const report = {
    generatedAtIso: new Date().toISOString(),
    sqlitePath,
    targetCount: targets.length,
    apply: options.apply,
    counts: Object.fromEntries(
      Object.entries(categorizedResults).map(([key, value]) => [key, value.length]),
    ),
    results: categorizedResults,
    sample: targets.slice(0, 10),
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Report written to ${reportPath}\n`);
  process.stdout.write(`${JSON.stringify(report.counts, null, 2)}\n`);

  if (categorizedResults.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
