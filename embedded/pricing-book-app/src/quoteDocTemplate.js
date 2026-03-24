import { google } from "googleapis";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeScopeMarkers(value) {
  return String(value || "")
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

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(parseNumber(value));
}

function formatTransactionDate(rawDate) {
  const trimmed = cleanString(rawDate);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;

  const date = trimmed ? new Date(trimmed) : new Date();
  if (!Number.isFinite(date.getTime())) return "";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function compactObject(obj = {}) {
  const output = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === "") continue;
    output[key] = value;
  }
  return output;
}

function splitLines(value) {
  return cleanString(value)
    .split(/\r?\n|,/)
    .map((line) => cleanString(line))
    .filter(Boolean);
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return "";
}

function toAddressObject(source, fallback = {}) {
  if (!source) return compactObject(fallback);
  if (typeof source === "string") {
    return compactObject({
      ...fallback,
      street: splitLines(source).join("\n")
    });
  }
  if (typeof source !== "object") return compactObject(fallback);

  const line1 = firstNonEmpty([
    source.addressLine1,
    source.line1,
    source.address1,
    source.AddressLine1,
    source.Line1,
    source.Address1,
    source.street,
    source.Street
  ]);
  const line2 = firstNonEmpty([
    source.addressLine2,
    source.line2,
    source.address2,
    source.AddressLine2,
    source.Line2,
    source.Address2
  ]);
  const street = [line1, line2].filter(Boolean).join("\n");

  return compactObject({
    ...fallback,
    name: firstNonEmpty([source.name, source.Name, source.accountName, source.businessAccountName, fallback.name]),
    street: street || firstNonEmpty([source.address, source.Address, fallback.street]),
    city: firstNonEmpty([source.city, source.City, fallback.city]),
    state: firstNonEmpty([source.state, source.State, source.province, source.Province, fallback.state]),
    zip: firstNonEmpty([source.zip, source.Zip, source.postalCode, source.PostalCode, source.zipCode, source.ZipCode, fallback.zip]),
    country: firstNonEmpty([source.country, source.Country, fallback.country])
  });
}

function normalizeAddress(account = {}, override = {}) {
  const accountAddress = toAddressObject(account.address, {
    name: cleanString(account.name),
    street: cleanString(account.address),
    city: cleanString(account.city),
    state: cleanString(account.state),
    zip: cleanString(account.zip || account.postalCode),
    country: cleanString(account.country)
  });

  const overrideAddress = toAddressObject(override.address || override, {
    name: cleanString(override.name),
    street: cleanString(override.street || override.addressLine1),
    city: cleanString(override.city),
    state: cleanString(override.state || override.province),
    zip: cleanString(override.zip || override.postalCode || override.zipCode),
    country: cleanString(override.country)
  });

  return compactObject({
    name: firstNonEmpty([overrideAddress.name, accountAddress.name]),
    street: firstNonEmpty([overrideAddress.street, accountAddress.street]),
    city: firstNonEmpty([overrideAddress.city, accountAddress.city]),
    state: firstNonEmpty([overrideAddress.state, accountAddress.state]),
    zip: firstNonEmpty([overrideAddress.zip, accountAddress.zip]),
    country: firstNonEmpty([overrideAddress.country, accountAddress.country])
  });
}

function cityProvincePostal(address = {}) {
  const city = cleanString(address.city);
  const province = cleanString(address.state);
  const postal = cleanString(address.zip);
  const provincePostal = [province, postal].filter(Boolean).join(" ");
  return [city, provincePostal].filter(Boolean).join(", ");
}

function normalizeScopeLines(scope) {
  return normalizeScopeMarkers(scope)
    .split(/\r?\n/)
    .map((line) => cleanString(line))
    .filter(Boolean);
}

function normalizeStatementOfWorkText(value) {
  const rawLines = normalizeScopeMarkers(value)
    .split(/\r?\n/)
    .map((line) => cleanString(line));
  const lines = [];
  let paragraph = "";

  const isListLine = (line) =>
    /^-\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^\d+(?:\.\d+)+\s+/.test(line) ||
    /^[A-Za-z][.)]\s+/.test(line);
  const isHeadingLine = (line) =>
    /^[A-Z0-9][A-Z0-9 &/().,#:'"-]{2,}$/.test(line) &&
    line.length <= 80;
  const shouldAppendWrappedLine = (previousLine, currentLine) => {
    const previous = cleanString(previousLine);
    const current = cleanString(currentLine);
    if (!previous || !current) return false;
    if (isHeadingLine(previous) || isHeadingLine(current)) return false;
    if (isListLine(current)) return false;

    if (isListLine(previous)) return true;
    if (/[,;:/-]$/.test(previous)) return true;
    if (/^[a-z0-9(]/.test(current)) return true;
    if (!/[.!?]$/.test(previous)) return true;
    return false;
  };

  const flushParagraph = () => {
    if (!paragraph) return;
    lines.push(paragraph);
    paragraph = "";
  };

  const pushBlankLine = () => {
    if (!lines.length || lines[lines.length - 1] === "") return;
    lines.push("");
  };

  for (const rawLine of rawLines) {
    if (!rawLine) {
      flushParagraph();
      pushBlankLine();
      continue;
    }

    const line = rawLine
      .replace(/^[*•]\s*/, "- ")
      .replace(/^-(\S)/, "- $1");
    const isBullet = isListLine(line);
    const isHeading = isHeadingLine(line);

    if (isBullet || isHeading) {
      flushParagraph();
      if (isHeading) pushBlankLine();
      lines.push(line);
      continue;
    }

    const previousLine = lines.length ? lines[lines.length - 1] : "";
    if (!paragraph && shouldAppendWrappedLine(previousLine, line)) {
      lines[lines.length - 1] = `${previousLine} ${line}`;
      continue;
    }

    paragraph = paragraph ? `${paragraph} ${line}` : line;
  }

  flushParagraph();

  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const compact = [];
  for (const line of lines) {
    if (line === "" && compact[compact.length - 1] === "") continue;
    const previous = cleanString(compact[compact.length - 1]);
    const normalizedCurrent = cleanString(line).replace(/[.:;,\-]+$/g, "").toLowerCase();
    const normalizedPrevious = previous.replace(/[.:;,\-]+$/g, "").toLowerCase();
    if (normalizedCurrent && normalizedCurrent === normalizedPrevious) continue;
    compact.push(line);
  }

  return compact.join("\n");
}

function isStructuredStatementLine(line = "") {
  return (
    /^-\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^\d+(?:\.\d+)+\s+/.test(line) ||
    /^[A-Za-z][.)]\s+/.test(line)
  );
}

function formatStatementScopeLine(line = "") {
  const text = cleanString(line);
  if (!text) return "";
  if (isStructuredStatementLine(text) || /:$/.test(text)) return text;
  return `- ${text}`;
}

function buildStatementOfWork(payload = {}) {
  const divisions = Array.isArray(payload.divisions) ? payload.divisions.filter((item) => item?.isSelected !== false) : [];
  if (!divisions.length) return "Scope of work to be confirmed.";

  const output = [];
  const multiDivision = divisions.length > 1;
  for (const division of divisions) {
    const title = cleanString(division.title || division.id || "Division");
    const scopeLines = normalizeScopeLines(division.scope);
    if (!scopeLines.length) continue;
    if (multiDivision) {
      output.push(`${title}:`);
    }
    output.push(...scopeLines.map((line) => formatStatementScopeLine(line)));
    if (multiDivision) output.push("");
  }

  while (output.length && !output[output.length - 1]) output.pop();
  return output.length ? normalizeStatementOfWorkText(output.join("\n")) : "Scope of work to be confirmed.";
}

function extractQuoteReferenceFromText(text) {
  const value = cleanString(text);
  if (!value) return "";
  const qHash = value.match(/\bQ#\s*([A-Za-z0-9_-]+)/i);
  if (qHash?.[1]) return cleanString(qHash[1]);
  const pq = value.match(/\b(PQ[0-9]{4,})\b/i);
  if (pq?.[1]) return cleanString(pq[1]);
  const labeled = value.match(/\bquote\s*#?\s*[:\-]?\s*([A-Za-z0-9_-]+)/i);
  if (labeled?.[1]) return cleanString(labeled[1]);
  return "";
}

function extractGoogleDocId(value) {
  const raw = cleanString(value);
  if (!raw) return "";

  const urlMatch = raw.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch?.[1]) return urlMatch[1];

  const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];

  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return "";
}

function extractGoogleErrorMessage(error) {
  if (error?.response?.data?.error?.message) {
    return String(error.response.data.error.message);
  }
  if (error?.response?.data?.error_description) {
    return String(error.response.data.error_description);
  }
  if (error instanceof Error) return error.message;
  return String(error || "Unknown Google API error.");
}

const GOOGLE_DOC_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive"
];

function isReauthError(error) {
  const detail = extractGoogleErrorMessage(error).toLowerCase();
  return detail.includes("invalid_rapt") || detail.includes("reauth related error") || detail.includes("rapt");
}

function isDriveStorageQuotaExceededError(error) {
  const detail = extractGoogleErrorMessage(error).toLowerCase();
  return (
    detail.includes("storage quota has been exceeded") ||
    detail.includes("drive storage quota") ||
    detail.includes("quota has been exceeded")
  );
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

function resolveServiceAccountEmailHint() {
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
      // Ignore hint parsing errors and continue with key-file lookup.
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
      scopes: GOOGLE_DOC_SCOPES,
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
      scopes: GOOGLE_DOC_SCOPES,
      keyFile
    });
  }

  return new google.auth.GoogleAuth({
    scopes: GOOGLE_DOC_SCOPES
  });
}

function normalizeDriveFile(data = {}) {
  return compactObject({
    id: cleanString(data.id),
    name: cleanString(data.name),
    webViewLink: cleanString(data.webViewLink),
    webContentLink: cleanString(data.webContentLink),
    driveId: cleanString(data.driveId),
    parentId: Array.isArray(data.parents) && data.parents.length ? cleanString(data.parents[0]) : ""
  });
}

function buildPlaceholderReplacements({
  billTo,
  shipTo,
  quoteNumber,
  quoteDate,
  salesRep,
  statementOfWork,
  subtotal,
  tax,
  total
}) {
  const billCityLine = cityProvincePostal(billTo);
  const shipCityLine = cityProvincePostal(shipTo);
  const subtotalText = cleanString(subtotal);
  const taxText = cleanString(tax);
  const totalText = cleanString(total);

  const replacements = {
    "{BillToName}": cleanString(billTo.name),
    "{Bill To Name}": cleanString(billTo.name),
    "{Bill to Name}": cleanString(billTo.name),
    "{BillToAddress}": cleanString(billTo.street),
    "{Bill To Address}": cleanString(billTo.street),
    "{BillToCityProvincePostal}": billCityLine,
    "{Bill To City Province Postal}": billCityLine,
    "{BillToCountry}": cleanString(billTo.country),
    "{Bill To Country}": cleanString(billTo.country),

    "{ShipToName}": cleanString(shipTo.name),
    "{Ship To Name}": cleanString(shipTo.name),
    "{Ship to Name}": cleanString(shipTo.name),
    "{ShipToAddress}": cleanString(shipTo.street),
    "{Ship To Address}": cleanString(shipTo.street),
    "{ShipToCityProvincePostal}": shipCityLine,
    "{Ship To City Province Postal}": shipCityLine,
    "{ShipToCountry}": cleanString(shipTo.country),
    "{Ship To Country}": cleanString(shipTo.country),

    "{Business account Name}": cleanString(billTo.name),
    "{Business Account Name}": cleanString(billTo.name),
    "{Address}": cleanString(billTo.street),
    "{City}": cleanString(billTo.city),
    "{Province}": cleanString(billTo.state),
    "{Postal Code}": cleanString(billTo.zip),
    "{Country}": cleanString(billTo.country),
    "{City},{Province} {Postal Code}": billCityLine,
    "{City}, {Province} {Postal Code}": billCityLine,

    "{Quote Number}": cleanString(quoteNumber),
    "{QuoteNumber}": cleanString(quoteNumber),
    "{Quote #}": cleanString(quoteNumber),
    "{Quote Date}": cleanString(quoteDate),
    "{QuoteDate}": cleanString(quoteDate),
    "{Transaction Date}": cleanString(quoteDate),
    "{Business account owner}": cleanString(salesRep),
    "{Business Account Owner}": cleanString(salesRep),
    "{Sales Rep}": cleanString(salesRep),
    "{SalesRep}": cleanString(salesRep),

    "{StatementOfWork}": cleanString(statementOfWork),
    "{Statement of Work}": cleanString(statementOfWork),
    "{ScopeOfWork}": cleanString(statementOfWork),
    "{Scope of Work}": cleanString(statementOfWork),
    "{Description}": cleanString(statementOfWork),
    "{Full quote description here}": cleanString(statementOfWork),
    "{Full quote description here": cleanString(statementOfWork),
    "{Full Quote Description Here}": cleanString(statementOfWork),
    "{Full Quote Description Here": cleanString(statementOfWork),

    "{Subtotal}": subtotalText,
    "{subtotal}": subtotalText,
    "{Sub Total}": subtotalText,
    "{SubTotal}": subtotalText,
    "${Subtotal}": subtotalText,
    "${subtotal}": subtotalText,
    "{Tax}": taxText,
    "{tax}": taxText,
    "${Tax}": taxText,
    "${tax}": taxText,
    "{Total}": totalText,
    "{total}": totalText,
    "{Grand Total}": totalText,
    "{GrandTotal}": totalText,
    "{Quote Total}": totalText,
    "{QuoteTotal}": totalText,
    "{Project Selling Price}": totalText,
    "{ProjectSellingPrice}": totalText,
    "${Total}": totalText,
    "${total}": totalText,
    "${Grand Total}": totalText,
    "${GrandTotal}": totalText,
    "${S}": totalText,
    "${S": totalText
  };

  return Object.entries(replacements)
    .filter(([placeholder]) => cleanString(placeholder))
    .map(([placeholder, replacement]) => ({
      placeholder,
      replacement: cleanString(replacement)
    }));
}

export async function renderQuoteBackupPdfFromGoogleDoc(options = {}) {
  const templateDocId = extractGoogleDocId(options.templateDocId || options.templateDocUrl);
  if (!templateDocId) {
    throw new Error("Google Docs template id/url is required for quote backup generation.");
  }

  const payload = options.payload || {};
  const account = payload.account || {};

  const billTo = normalizeAddress(account, options.billTo || {});
  const shipTo = normalizeAddress(account, options.shipTo || billTo);
  const requestedQuoteNumber = cleanString(options.quoteNumber || options.quoteNbr || "");
  const quoteDate = formatTransactionDate(options.transactionDate);
  const statementOfWork = normalizeStatementOfWorkText(
    cleanString(options.statementOfWork) || buildStatementOfWork(payload)
  );
  const inferredQuoteNumber =
    requestedQuoteNumber ||
    extractQuoteReferenceFromText(statementOfWork) ||
    extractQuoteReferenceFromText(options.quoteBody) ||
    cleanString(payload.quoteNbr || payload.quoteNumber || payload.quoteId || "");
  const quoteNumber = inferredQuoteNumber || "PENDING";
  const salesRep = cleanString(options.salesRep || account.owner || account.contactName) || "TBD";
  const subtotal = formatMoney(options.subtotal);
  const tax = formatMoney(options.tax);
  const total = formatMoney(options.total);

  const replacements = buildPlaceholderReplacements({
    billTo,
    shipTo,
    quoteNumber,
    quoteDate,
    salesRep,
    statementOfWork,
    subtotal,
    tax,
    total
  });

  const auth = buildGoogleAuth();
  const serviceAccountEmail = resolveServiceAccountEmailHint();
  const templateShareHint = serviceAccountEmail
    ? `Share the template and output folder with ${serviceAccountEmail}.`
    : "Share the template and output folder with the backend Google service account.";
  let docs = null;
  let drive = null;
  let workingDocId = "";
  let generatedDocId = "";
  try {
    const client = await auth.getClient();
    docs = google.docs({ version: "v1", auth: client });
    drive = google.drive({ version: "v3", auth: client });

    const templateMetadata = await drive.files.get({
      fileId: templateDocId,
      fields: "id,name,parents,driveId",
      supportsAllDrives: true
    });
    const templateMeta = templateMetadata.data || {};
    const templateParentId =
      Array.isArray(templateMeta.parents) && templateMeta.parents.length ? cleanString(templateMeta.parents[0]) : "";

    const copyNameBase = cleanString(options.outputDocumentName) || "Quote Backup";
    const copyName = quoteNumber ? `${copyNameBase} - ${quoteNumber}` : `${copyNameBase} - ${Date.now()}`;
    const outputFolderId = extractGoogleDocId(options.outputFolderId);
    const targetFolderId = outputFolderId || templateParentId;

    const copyResponse = await drive.files.copy({
      fileId: templateDocId,
      fields: "id",
      supportsAllDrives: true,
      requestBody: compactObject({
        name: copyName,
        mimeType: "application/vnd.google-apps.document",
        parents: targetFolderId ? [targetFolderId] : undefined
      })
    });

    workingDocId = cleanString(copyResponse.data?.id);
    generatedDocId = workingDocId;
    if (!workingDocId) {
      throw new Error("Google Drive copy succeeded but no document id was returned.");
    }

    const requests = replacements.map((item) => ({
      replaceAllText: {
        containsText: {
          text: item.placeholder,
          matchCase: true
        },
        replaceText: item.replacement
      }
    }));

    if (requests.length) {
      await docs.documents.batchUpdate({
        documentId: workingDocId,
        requestBody: { requests }
      });
    }

    const exportResponse = await drive.files.export(
      {
        fileId: workingDocId,
        mimeType: "application/pdf"
      },
      {
        responseType: "arraybuffer"
      }
    );

    const pdfBuffer = Buffer.isBuffer(exportResponse.data)
      ? exportResponse.data
      : Buffer.from(exportResponse.data);
    let driveFile = null;
    let driveUploadWarning = "";
    const shouldStorePdfInDrive = options.storePdfInDrive !== false;
    if (shouldStorePdfInDrive) {
      const pdfFileName = quoteNumber ? `Quote Backup - ${quoteNumber}.pdf` : `Quote Backup - ${Date.now()}.pdf`;
      try {
        const uploadResponse = await drive.files.create({
          fields: "id,name,webViewLink,webContentLink,parents,driveId",
          supportsAllDrives: true,
          requestBody: compactObject({
            name: cleanString(options.outputPdfName) || pdfFileName,
            mimeType: "application/pdf",
            parents: targetFolderId ? [targetFolderId] : undefined
          }),
          media: {
            mimeType: "application/pdf",
            body: Readable.from(pdfBuffer)
          }
        });
        driveFile = normalizeDriveFile(uploadResponse.data || {});
      } catch (uploadError) {
        if (!isDriveStorageQuotaExceededError(uploadError)) throw uploadError;
        driveUploadWarning = extractGoogleErrorMessage(uploadError);
      }
    }

    return {
      pdfBytes: new Uint8Array(pdfBuffer),
      driveFile,
      driveUploadWarning
    };
  } catch (error) {
    const detail = extractGoogleErrorMessage(error);
    if (isReauthError(error)) {
      throw new Error(
        "Google Docs quote backup generation failed. Google auth reauthentication is required (invalid_rapt). " +
          "Set service-account credentials via QUOTE_DOC_GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS key file). " +
          templateShareHint
      );
    }

    if (/file not found/i.test(detail)) {
      throw new Error(
        `Google Docs quote backup generation failed. ${detail}. Template Doc ID: ${templateDocId}. ${templateShareHint}`
      );
    }

    if (isDriveStorageQuotaExceededError(error)) {
      throw new Error(
        "Google Docs quote backup generation failed. " +
          `${detail}. Configure QUOTE_DOC_OUTPUT_FOLDER_ID to a Shared Drive folder and/or set QUOTE_DOC_STORE_PDF_IN_DRIVE=false. ` +
          templateShareHint
      );
    }

    throw new Error(
      `Google Docs quote backup generation failed. ${detail}. ${templateShareHint}`
    );
  } finally {
    if (!drive) return;
    const shouldKeep = Boolean(options.keepGeneratedDoc);
    if (workingDocId && !shouldKeep) {
      try {
        await drive.files.delete({ fileId: workingDocId, supportsAllDrives: true });
      } catch (_error) {
        // Best-effort cleanup.
      }
    }
    if (generatedDocId && generatedDocId !== workingDocId && !shouldKeep) {
      try {
        await drive.files.delete({ fileId: generatedDocId, supportsAllDrives: true });
      } catch (_error) {
        // Best-effort cleanup.
      }
    }
  }
}

export const __test__ = {
  buildStatementOfWork,
  formatStatementScopeLine,
  normalizeStatementOfWorkText
};
