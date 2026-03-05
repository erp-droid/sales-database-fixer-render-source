import { buildCookieHeader, extractAuthCookieFromResponseHeaders } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";

export type AuthCookieRefreshState = {
  value: string | null;
};

function getActiveCookieValue(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): string {
  return authCookieRefresh?.value ?? cookieValue;
}

function buildAcumaticaUrl(resourcePath: string): string {
  const { ACUMATICA_BASE_URL, ACUMATICA_ENTITY_PATH } = getEnv();

  const normalizedResource = resourcePath.startsWith("/")
    ? resourcePath
    : `/${resourcePath}`;

  return `${ACUMATICA_BASE_URL}${ACUMATICA_ENTITY_PATH}${normalizedResource}`;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readFirstObjectMessage(source: unknown): string | null {
  if (!source || typeof source !== "object") {
    return null;
  }

  const record = source as Record<string, unknown>;
  let genericFallback: string | null = null;
  const directCandidates = [
    record.message,
    record.Message,
    record.exceptionMessage,
    record.ExceptionMessage,
    record.detail,
    record.Detail,
    record.title,
    record.Title,
    record.error_description,
  ];

  for (const candidate of directCandidates) {
    if (hasText(candidate)) {
      const trimmed = candidate.trim();
      if (!isGenericAcumaticaMessage(trimmed)) {
        return trimmed;
      }

      if (!genericFallback) {
        genericFallback = trimmed;
      }
    }
  }

  const nestedError = record.error;
  if (hasText(nestedError)) {
    const trimmed = nestedError.trim();
    if (!isGenericAcumaticaMessage(trimmed)) {
      return trimmed;
    }

    if (!genericFallback) {
      genericFallback = trimmed;
    }
  }
  if (nestedError && typeof nestedError === "object") {
    const nestedErrorMessage = readFirstObjectMessage(nestedError);
    if (nestedErrorMessage) {
      return nestedErrorMessage;
    }
  }

  const modelState = record.modelState;
  if (modelState && typeof modelState === "object") {
    const entries = Object.entries(modelState as Record<string, unknown>);
    for (const [field, value] of entries) {
      if (Array.isArray(value)) {
        const first = value.find(hasText);
        if (first) {
          const trimmed = first.trim();
          if (!isGenericAcumaticaMessage(trimmed)) {
            return `${field}: ${trimmed}`;
          }

          if (!genericFallback) {
            genericFallback = `${field}: ${trimmed}`;
          }
        }
      }

      if (hasText(value)) {
        const trimmed = value.trim();
        if (!isGenericAcumaticaMessage(trimmed)) {
          return `${field}: ${trimmed}`;
        }

        if (!genericFallback) {
          genericFallback = `${field}: ${trimmed}`;
        }
      }
    }
  }

  const errors = record.errors;
  if (errors && typeof errors === "object") {
    const entries = Object.entries(errors as Record<string, unknown>);
    for (const [field, value] of entries) {
      if (Array.isArray(value)) {
        const first = value.find(hasText);
        if (first) {
          const trimmed = first.trim();
          if (!isGenericAcumaticaMessage(trimmed)) {
            return `${field}: ${trimmed}`;
          }

          if (!genericFallback) {
            genericFallback = `${field}: ${trimmed}`;
          }
        }
      }

      if (hasText(value)) {
        const trimmed = value.trim();
        if (!isGenericAcumaticaMessage(trimmed)) {
          return `${field}: ${trimmed}`;
        }

        if (!genericFallback) {
          genericFallback = `${field}: ${trimmed}`;
        }
      }
    }
  }

  return genericFallback;
}

function isGenericAcumaticaMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "an error has occurred." ||
    normalized === "an error has occurred" ||
    normalized === "error has occurred."
  );
}

async function parseErrorResponse(
  response: Response,
): Promise<{ message: string; details?: unknown }> {
  const text = await response.text();
  if (!text) {
    return {
      message: `Acumatica request failed with status ${response.status}`,
    };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const nestedMessage = readFirstObjectMessage(parsed);
    if (nestedMessage && !isGenericAcumaticaMessage(nestedMessage)) {
      return {
        message: nestedMessage,
        details: parsed,
      };
    }

    if (nestedMessage) {
      return {
        message: nestedMessage,
        details: parsed,
      };
    }

    return {
      message: text,
      details: parsed,
    };
  } catch {
    return { message: text };
  }
}

function looksLikeHtmlDocument(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.trunc(seconds * 1000);
  }

  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

async function parseJsonPayload<T>(response: Response, context: string): Promise<T> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
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
    return JSON.parse(responseText) as T;
  } catch {
    throw new HttpError(
      502,
      `Acumatica returned invalid JSON while ${context}.`,
    );
  }
}

async function requestAcumatica<T>(
  cookieValue: string,
  resourcePath: string,
  init?: RequestInit & { authCookieRefresh?: AuthCookieRefreshState },
): Promise<T> {
  const headers = new Headers(init?.headers);
  const authCookieRefresh = init?.authCookieRefresh;
  const requestInit: RequestInit & { authCookieRefresh?: AuthCookieRefreshState } = init
    ? { ...init }
    : {};
  delete requestInit.authCookieRefresh;
  headers.set("Accept", "application/json");
  headers.set("Cookie", buildCookieHeader(cookieValue));

  if (requestInit.body) {
    headers.set("Content-Type", "application/json");
  }

  const maxRateLimitRetries = 3;

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(buildAcumaticaUrl(resourcePath), {
      ...requestInit,
      headers,
      cache: "no-store",
    });

    if (authCookieRefresh) {
      const refreshedCookie = extractAuthCookieFromResponseHeaders(
        response.headers,
        cookieValue,
      );
      if (refreshedCookie) {
        authCookieRefresh.value = refreshedCookie;
      }
    }

    if (response.status === 429 && attempt < maxRateLimitRetries) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const backoffMs = Math.min(6000, 700 * 2 ** attempt);
      await sleep(retryAfterMs ?? backoffMs);
      continue;
    }

    if (!response.ok) {
      const errorResponse = await parseErrorResponse(response);
      throw new HttpError(
        response.status,
        errorResponse.message,
        errorResponse.details,
      );
    }

    if (response.status === 204) {
      return null as T;
    }

    return parseJsonPayload<T>(response, `requesting '${resourcePath}'`);
  }
}

export type RawBusinessAccount = Record<string, unknown>;
export type RawContact = Record<string, unknown>;
export type RawEmployee = Record<string, unknown>;
export type EmployeeDirectoryItem = {
  id: string;
  name: string;
};

type FetchContactsOptions = {
  maxRecords?: number;
  batchSize?: number;
  initialSkip?: number;
  filter?: string;
};

export function readWrappedString(record: unknown, key: string): string {
  if (!record || typeof record !== "object") {
    return "";
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return "";
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" ? value.trim() : "";
}

export function readWrappedScalarString(record: unknown, key: string): string {
  if (!record || typeof record !== "object") {
    return "";
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return "";
  }

  const value = (field as Record<string, unknown>).value;
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value).trim();
  }

  return "";
}

export function readWrappedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function unwrapCollection<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    if (Array.isArray(record.value)) {
      return record.value as T[];
    }

    // Some Acumatica endpoint variants can wrap arrays in alternate properties.
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        return value as T[];
      }
    }
  }

  return [];
}

type FetchBusinessAccountsOptions = {
  maxRecords?: number;
  batchSize?: number;
  initialSkip?: number;
  filter?: string;
  ensurePrimaryContact?: boolean;
  ensureAttributes?: boolean;
  ensureContacts?: boolean;
  ensureMainAddress?: boolean;
};

const BUSINESS_ACCOUNT_EXPAND_CANDIDATES = [
  "Attributes,Contacts,MainAddress,PrimaryContact",
  "Contacts,MainAddress,PrimaryContact",
  "Attributes,MainAddress,PrimaryContact",
  "MainAddress,PrimaryContact",
  "PrimaryContact",
  "MainAddress",
  "",
] as const;

function shouldRetryWithLighterBusinessAccountExpand(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status !== 429 &&
    error.status !== 401 &&
    error.status !== 403
  );
}

function buildBusinessAccountCollectionPath(options: {
  top: number;
  skip: number;
  expand: string;
  filter?: string;
}): string {
  const query = new URLSearchParams({
    $top: String(options.top),
    $skip: String(options.skip),
  });

  if (options.expand) {
    query.set("$expand", options.expand);
  }

  if (options.filter) {
    query.set("$filter", options.filter);
  }

  return `/BusinessAccount?${query.toString()}`;
}

function buildBusinessAccountByIdPath(id: string, expand: string): string {
  const encodedId = encodeURIComponent(id);
  if (!expand) {
    return `/BusinessAccount/${encodedId}`;
  }

  return `/BusinessAccount/${encodedId}?$expand=${encodeURIComponent(expand)}`;
}

function buildContactCollectionPath(options: {
  top: number;
  skip: number;
  filter?: string;
}): string {
  const query = new URLSearchParams({
    $top: String(options.top),
    $skip: String(options.skip),
  });

  if (options.filter) {
    query.set("$filter", options.filter);
  }

  return `/Contact?${query.toString()}`;
}

function buildEmployeeCollectionPath(resourcePath: string, options: {
  top: number;
  skip: number;
}): string {
  const query = new URLSearchParams({
    $top: String(options.top),
    $skip: String(options.skip),
  });

  return `${resourcePath}?${query.toString()}`;
}

function readBusinessAccountIdentity(record: RawBusinessAccount): string {
  const rawId = typeof record.id === "string" ? record.id : "";
  const rawNoteId = readWrappedString(record, "NoteID");
  const rawBusinessAccountId = readWrappedString(record, "BusinessAccountID");
  return rawId || rawNoteId || rawBusinessAccountId;
}

function mergePrimaryContactFromSupplement(
  baseRows: RawBusinessAccount[],
  supplementRows: RawBusinessAccount[],
): RawBusinessAccount[] {
  const supplementByIdentity = new Map<string, RawBusinessAccount>();

  for (const row of supplementRows) {
    const identity = readBusinessAccountIdentity(row);
    if (identity) {
      supplementByIdentity.set(identity, row);
    }
  }

  return baseRows.map((row) => {
    const identity = readBusinessAccountIdentity(row);
    if (!identity) {
      return row;
    }

    const supplement = supplementByIdentity.get(identity);
    if (!supplement || !("PrimaryContact" in supplement)) {
      return row;
    }

    return {
      ...row,
      PrimaryContact: supplement.PrimaryContact,
    };
  });
}

function mergeAttributesFromSupplement(
  baseRows: RawBusinessAccount[],
  supplementRows: RawBusinessAccount[],
): RawBusinessAccount[] {
  const supplementByIdentity = new Map<string, RawBusinessAccount>();

  for (const row of supplementRows) {
    const identity = readBusinessAccountIdentity(row);
    if (identity) {
      supplementByIdentity.set(identity, row);
    }
  }

  return baseRows.map((row) => {
    const identity = readBusinessAccountIdentity(row);
    if (!identity) {
      return row;
    }

    const supplement = supplementByIdentity.get(identity);
    if (!supplement || !("Attributes" in supplement)) {
      return row;
    }

    return {
      ...row,
      Attributes: supplement.Attributes,
    };
  });
}

function mergeContactsFromSupplement(
  baseRows: RawBusinessAccount[],
  supplementRows: RawBusinessAccount[],
): RawBusinessAccount[] {
  const supplementByIdentity = new Map<string, RawBusinessAccount>();

  for (const row of supplementRows) {
    const identity = readBusinessAccountIdentity(row);
    if (identity) {
      supplementByIdentity.set(identity, row);
    }
  }

  return baseRows.map((row) => {
    const identity = readBusinessAccountIdentity(row);
    if (!identity) {
      return row;
    }

    const supplement = supplementByIdentity.get(identity);
    if (!supplement || !("Contacts" in supplement)) {
      return row;
    }

    return {
      ...row,
      Contacts: supplement.Contacts,
    };
  });
}

function mergeMainAddressFromSupplement(
  baseRows: RawBusinessAccount[],
  supplementRows: RawBusinessAccount[],
): RawBusinessAccount[] {
  const supplementByIdentity = new Map<string, RawBusinessAccount>();

  for (const row of supplementRows) {
    const identity = readBusinessAccountIdentity(row);
    if (identity) {
      supplementByIdentity.set(identity, row);
    }
  }

  return baseRows.map((row) => {
    const identity = readBusinessAccountIdentity(row);
    if (!identity) {
      return row;
    }

    const supplement = supplementByIdentity.get(identity);
    if (!supplement || !("MainAddress" in supplement)) {
      return row;
    }

    return {
      ...row,
      MainAddress: supplement.MainAddress,
    };
  });
}

export async function fetchBusinessAccounts(
  cookieValue: string,
  options?: FetchBusinessAccountsOptions,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawBusinessAccount[]> {
  const hasMaxRecords =
    typeof options?.maxRecords === "number" &&
    Number.isFinite(options.maxRecords);
  const maxRecords = hasMaxRecords
    ? Math.max(1, Math.trunc(options.maxRecords as number))
    : null;
  const initialSkip = Math.max(0, Math.trunc(options?.initialSkip ?? 0));
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? 100, 500));
  const filter = options?.filter;
  const allRows: RawBusinessAccount[] = [];

  for (let skip = initialSkip; ; skip += batchSize) {
    if (maxRecords !== null && allRows.length >= maxRecords) {
      break;
    }

    const top =
      maxRecords === null
        ? batchSize
        : Math.min(batchSize, maxRecords - allRows.length);
    if (top <= 0) {
      break;
    }

    const activeCookieValue = getActiveCookieValue(cookieValue, authCookieRefresh);
    let payload: unknown | null = null;
    let lastError: unknown = null;
    let selectedExpand = "";

    for (const expand of BUSINESS_ACCOUNT_EXPAND_CANDIDATES) {
      try {
        payload = await requestAcumatica<unknown>(
          activeCookieValue,
          buildBusinessAccountCollectionPath({
            top,
            skip,
            expand,
            filter,
          }),
          {
            authCookieRefresh,
          },
        );
        selectedExpand = expand;
        break;
      } catch (error) {
        lastError = error;
        if (!shouldRetryWithLighterBusinessAccountExpand(error)) {
          throw error;
        }
      }
    }

    if (payload === null) {
      if (lastError instanceof Error) {
        throw lastError;
      }
      throw new HttpError(500, "Failed to fetch business accounts.");
    }

    const rows = unwrapCollection<RawBusinessAccount>(payload);
    let effectiveRows = rows;

    if (
      (options?.ensurePrimaryContact && !selectedExpand.includes("PrimaryContact")) ||
      (options?.ensureAttributes && !selectedExpand.includes("Attributes")) ||
      (options?.ensureContacts && !selectedExpand.includes("Contacts")) ||
      (options?.ensureMainAddress && !selectedExpand.includes("MainAddress"))
    ) {
      try {
        const supplementExpandParts: string[] = [];
        if (options?.ensurePrimaryContact && !selectedExpand.includes("PrimaryContact")) {
          supplementExpandParts.push("PrimaryContact");
        }
        if (options?.ensureAttributes && !selectedExpand.includes("Attributes")) {
          supplementExpandParts.push("Attributes");
        }
        if (options?.ensureContacts && !selectedExpand.includes("Contacts")) {
          supplementExpandParts.push("Contacts");
        }
        if (options?.ensureMainAddress && !selectedExpand.includes("MainAddress")) {
          supplementExpandParts.push("MainAddress");
        }

        const supplementPayload = await requestAcumatica<unknown>(
          getActiveCookieValue(cookieValue, authCookieRefresh),
          buildBusinessAccountCollectionPath({
            top,
            skip,
            expand: supplementExpandParts.join(","),
            filter,
          }),
          {
            authCookieRefresh,
          },
        );
        const supplementRows = unwrapCollection<RawBusinessAccount>(supplementPayload);
        if (supplementRows.length > 0) {
          let mergedRows = effectiveRows;
          if (supplementExpandParts.includes("PrimaryContact")) {
            mergedRows = mergePrimaryContactFromSupplement(mergedRows, supplementRows);
          }
          if (supplementExpandParts.includes("Attributes")) {
            mergedRows = mergeAttributesFromSupplement(mergedRows, supplementRows);
          }
          if (supplementExpandParts.includes("Contacts")) {
            mergedRows = mergeContactsFromSupplement(mergedRows, supplementRows);
          }
          if (supplementExpandParts.includes("MainAddress")) {
            mergedRows = mergeMainAddressFromSupplement(mergedRows, supplementRows);
          }
          effectiveRows = mergedRows;
        }
      } catch (error) {
        if (
          error instanceof HttpError &&
          (error.status === 401 || error.status === 403)
        ) {
          throw error;
        }
      }
    }

    if (rows.length === 0) {
      break;
    }

    allRows.push(...effectiveRows);
    if (effectiveRows.length < top) {
      break;
    }
  }

  return allRows;
}

export async function fetchBusinessAccountById(
  cookieValue: string,
  id: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawBusinessAccount> {
  try {
    let directError: unknown = null;
    for (const expand of BUSINESS_ACCOUNT_EXPAND_CANDIDATES) {
      try {
        return await requestAcumatica<RawBusinessAccount>(
          getActiveCookieValue(cookieValue, authCookieRefresh),
          buildBusinessAccountByIdPath(id, expand),
          {
            authCookieRefresh,
          },
        );
      } catch (error) {
        directError = error;
        if (!shouldRetryWithLighterBusinessAccountExpand(error)) {
          throw error;
        }
      }
    }

    if (directError instanceof Error) {
      throw directError;
    }
    throw new HttpError(500, "Failed to fetch business account.");
  } catch (directError) {
    if (!(directError instanceof HttpError)) {
      throw directError;
    }

    const escapedId = id.replace(/'/g, "''");
    const filterCandidates = [
      `BusinessAccountID eq '${escapedId}'`,
      `NoteID eq '${escapedId}'`,
    ];

    for (const filter of filterCandidates) {
      for (const expand of BUSINESS_ACCOUNT_EXPAND_CANDIDATES) {
        try {
          const payload = await requestAcumatica<unknown>(
            getActiveCookieValue(cookieValue, authCookieRefresh),
            buildBusinessAccountCollectionPath({
              top: 1,
              skip: 0,
              expand,
              filter,
            }),
            {
              authCookieRefresh,
            },
          );
          const rows = unwrapCollection<RawBusinessAccount>(payload);
          if (rows[0]) {
            return rows[0];
          }
          break;
        } catch (error) {
          if (!shouldRetryWithLighterBusinessAccountExpand(error)) {
            break;
          }
        }
      }
    }

    try {
      const rows = await fetchBusinessAccounts(cookieValue, {
        maxRecords: 2000,
        batchSize: 200,
      }, authCookieRefresh);
      const match = rows.find((row) => {
        const rawId = typeof row.id === "string" ? row.id : "";
        const rawBusinessAccountId = readWrappedString(row, "BusinessAccountID");
        const rawNoteId = readWrappedString(row, "NoteID");
        return [rawId, rawBusinessAccountId, rawNoteId].includes(id);
      });

      if (match) {
        return match;
      }
    } catch {
      // Preserve original direct lookup error below.
    }

    throw directError;
  }
}

export async function fetchContactById(
  cookieValue: string,
  id: number,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawContact> {
  return requestAcumatica<RawContact>(
    getActiveCookieValue(cookieValue, authCookieRefresh),
    `/Contact/${encodeURIComponent(String(id))}`,
    {
      authCookieRefresh,
    },
  );
}

export async function fetchContacts(
  cookieValue: string,
  options?: FetchContactsOptions,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawContact[]> {
  const hasMaxRecords =
    typeof options?.maxRecords === "number" &&
    Number.isFinite(options.maxRecords);
  const maxRecords = hasMaxRecords
    ? Math.max(1, Math.trunc(options?.maxRecords as number))
    : null;
  const initialSkip = Math.max(0, Math.trunc(options?.initialSkip ?? 0));
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? 200, 500));
  const filter = options?.filter;
  const allRows: RawContact[] = [];

  for (let skip = initialSkip; ; skip += batchSize) {
    if (maxRecords !== null && allRows.length >= maxRecords) {
      break;
    }

    const top =
      maxRecords === null
        ? batchSize
        : Math.min(batchSize, maxRecords - allRows.length);
    if (top <= 0) {
      break;
    }

    const payload = await requestAcumatica<unknown>(
      getActiveCookieValue(cookieValue, authCookieRefresh),
      buildContactCollectionPath({
        top,
        skip,
        filter,
      }),
      {
        authCookieRefresh,
      },
    );

    const rows = unwrapCollection<RawContact>(payload);
    if (rows.length === 0) {
      break;
    }

    allRows.push(...rows);
    if (rows.length < top) {
      break;
    }
  }

  return allRows;
}

function chunkArray<T>(values: T[], size: number): T[][];
function chunkArray<T>(values: T[], size: number): T[][] {
  if (size <= 0) {
    return [values];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildBusinessAccountFilter(accountIds: string[]): string {
  return accountIds
    .map((id) => `BusinessAccount eq '${id.replace(/'/g, "''")}'`)
    .join(" or ");
}

function buildBusinessAccountIdFilter(accountIds: string[]): string {
  return accountIds
    .map((id) => `BusinessAccountID eq '${id.replace(/'/g, "''")}'`)
    .join(" or ");
}

function readContactIdentity(record: RawContact): string {
  const rawId = typeof record.id === "string" ? record.id : "";
  const rawNoteId = readWrappedString(record, "NoteID");
  const rawContactId = readWrappedString(record, "ContactID");
  return rawId || rawNoteId || rawContactId;
}

function composeEmployeeName(record: RawEmployee): string {
  const preferred =
    readWrappedString(record, "DisplayName") ||
    readWrappedString(record, "EmployeeName") ||
    readWrappedString(record, "AcctName") ||
    readWrappedString(record, "ContactName") ||
    readWrappedString(record, "Description") ||
    readWrappedString(record, "UserName") ||
    readWrappedString(record, "Username");
  if (preferred) {
    return preferred;
  }

  const firstName = readWrappedString(record, "FirstName");
  const lastName = readWrappedString(record, "LastName");
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function readEmployeeId(record: RawEmployee): string {
  return (
    readWrappedScalarString(record, "BAccountID") ||
    readWrappedScalarString(record, "EmployeeID") ||
    readWrappedScalarString(record, "AcctCD") ||
    readWrappedScalarString(record, "Owner") ||
    readWrappedScalarString(record, "UserID") ||
    readWrappedScalarString(record, "ContactID") ||
    (typeof record.id === "string" ? record.id.trim() : "")
  );
}

function normalizeEmployeeRecord(record: RawEmployee): EmployeeDirectoryItem | null {
  const id = readEmployeeId(record);
  const name = composeEmployeeName(record);
  if (!id || !name) {
    return null;
  }

  return { id, name };
}

function collectUniqueEmployees(rows: RawEmployee[]): EmployeeDirectoryItem[] {
  const dedupedById = new Map<string, EmployeeDirectoryItem>();
  for (const row of rows) {
    const normalized = normalizeEmployeeRecord(row);
    if (!normalized) {
      continue;
    }

    dedupedById.set(normalized.id, normalized);
  }

  return [...dedupedById.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export async function fetchContactsByBusinessAccountIds(
  cookieValue: string,
  businessAccountIds: string[],
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawContact[]> {
  const uniqueIds = [...new Set(businessAccountIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const allContacts: RawContact[] = [];
  const chunks = chunkArray(uniqueIds, 20);

  for (const chunk of chunks) {
    const filter = buildBusinessAccountFilter(chunk);
    const rows = await fetchContacts(
      cookieValue,
      {
        batchSize: 250,
        filter,
      },
      authCookieRefresh,
    );
    allContacts.push(...rows);
  }

  const deduped = new Map<string, RawContact>();
  for (const contact of allContacts) {
    deduped.set(readContactIdentity(contact), contact);
  }

  return [...deduped.values()];
}

export async function fetchBusinessAccountsByBusinessAccountIds(
  cookieValue: string,
  businessAccountIds: string[],
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawBusinessAccount[]> {
  const uniqueIds = [...new Set(businessAccountIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const allAccounts: RawBusinessAccount[] = [];
  const chunks = chunkArray(uniqueIds, 20);

  for (const chunk of chunks) {
    const filter = buildBusinessAccountIdFilter(chunk);
    const rows = await fetchBusinessAccounts(
      cookieValue,
      {
        batchSize: 200,
        filter,
        ensureMainAddress: true,
        ensurePrimaryContact: true,
        ensureAttributes: true,
        ensureContacts: false,
      },
      authCookieRefresh,
    );
    allAccounts.push(...rows);
  }

  const deduped = new Map<string, RawBusinessAccount>();
  for (const account of allAccounts) {
    deduped.set(readBusinessAccountIdentity(account), account);
  }

  return [...deduped.values()];
}

export async function fetchEmployees(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<EmployeeDirectoryItem[]> {
  const endpointCandidates = ["/Employee", "/EPEmployee"] as const;
  const collectedRows: RawEmployee[] = [];

  for (const endpoint of endpointCandidates) {
    const batchSize = 200;

    try {
      for (let skip = 0; skip < 2000; skip += batchSize) {
        const payload = await requestAcumatica<unknown>(
          getActiveCookieValue(cookieValue, authCookieRefresh),
          buildEmployeeCollectionPath(endpoint, {
            top: batchSize,
            skip,
          }),
          {
            authCookieRefresh,
          },
        );
        const rows = unwrapCollection<RawEmployee>(payload);
        if (rows.length === 0) {
          break;
        }

        collectedRows.push(...rows);
        if (rows.length < batchSize) {
          break;
        }
      }
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw error;
      }
    }
  }

  // Always merge known sales reps from business accounts so partial employee endpoints
  // do not collapse the dropdown to one user.
  try {
    const rawAccounts = await fetchBusinessAccounts(
      cookieValue,
      {
        maxRecords: 5000,
        batchSize: 200,
      },
      authCookieRefresh,
    );
    const derivedRows: RawEmployee[] = rawAccounts.map((account) => ({
      Owner: { value: readWrappedScalarString(account, "Owner") },
      DisplayName: { value: readWrappedString(account, "OwnerEmployeeName") },
    }));
    collectedRows.push(...derivedRows);
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw error;
    }
  }

  return collectUniqueEmployees(collectedRows);
}

export async function updateBusinessAccount(
  cookieValue: string,
  id: string | string[],
  payload: Record<string, unknown>,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<void> {
  const candidates = [...new Set((Array.isArray(id) ? id : [id]).map((value) => value.trim()).filter(Boolean))];

  if (candidates.length === 0) {
    throw new HttpError(400, "Business account identifier is required for update.");
  }

  const pathErrors: Array<{ identifier: string; status?: number; message: string }> = [];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      await requestAcumatica(
        getActiveCookieValue(cookieValue, authCookieRefresh),
        `/BusinessAccount/${encodeURIComponent(candidate)}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
          authCookieRefresh,
        },
      );
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError) {
        pathErrors.push({
          identifier: candidate,
          status: error.status,
          message: error.message,
        });
      } else if (error instanceof Error) {
        pathErrors.push({
          identifier: candidate,
          message: error.message,
        });
      }
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw error;
      }
    }
  }

  const bodyAttempts: Record<string, unknown>[] = [];
  bodyAttempts.push(payload);

  for (const candidate of candidates) {
    bodyAttempts.push({
      ...payload,
      BusinessAccountID: { value: candidate },
    });
    bodyAttempts.push({
      ...payload,
      BAccountID: { value: candidate },
    });
    bodyAttempts.push({
      ...payload,
      NoteID: { value: candidate },
    });
    bodyAttempts.push({
      ...payload,
      id: candidate,
    });
  }

  const seenBodyFingerprints = new Set<string>();
  for (const body of bodyAttempts) {
    const fingerprint = JSON.stringify(body);
    if (seenBodyFingerprints.has(fingerprint)) {
      continue;
    }
    seenBodyFingerprints.add(fingerprint);

    try {
      await requestAcumatica(
        getActiveCookieValue(cookieValue, authCookieRefresh),
        "/BusinessAccount",
        {
          method: "PUT",
          body: JSON.stringify(body),
          authCookieRefresh,
        },
      );
      return;
    } catch (error) {
      lastError = error;
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw error;
      }
    }
  }

  if (lastError instanceof Error) {
    if (lastError instanceof HttpError && pathErrors.length > 0) {
      throw new HttpError(
        lastError.status,
        lastError.message,
        {
          updateAttempts: pathErrors,
          lastError: lastError.details ?? lastError.message,
        },
      );
    }
    throw lastError;
  }
  throw new HttpError(500, "Failed to update business account.");
}

export async function createBusinessAccount(
  cookieValue: string,
  payload: Record<string, unknown>,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawBusinessAccount> {
  return requestAcumatica<RawBusinessAccount>(
    getActiveCookieValue(cookieValue, authCookieRefresh),
    "/BusinessAccount",
    {
      method: "POST",
      body: JSON.stringify(payload),
      authCookieRefresh,
    },
  );
}

export async function updateContact(
  cookieValue: string,
  contactId: number,
  payload: Record<string, unknown>,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<void> {
  await requestAcumatica(
    getActiveCookieValue(cookieValue, authCookieRefresh),
    `/Contact/${encodeURIComponent(String(contactId))}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
      authCookieRefresh,
    },
  );
}

export async function createContact(
  cookieValue: string,
  payload: Record<string, unknown>,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<RawContact> {
  return requestAcumatica<RawContact>(
    getActiveCookieValue(cookieValue, authCookieRefresh),
    "/Contact",
    {
      method: "POST",
      body: JSON.stringify(payload),
      authCookieRefresh,
    },
  );
}

export async function deleteContact(
  cookieValue: string,
  contactId: number,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<void> {
  const maxRateLimitRetries = 3;
  const resourcePath = `/Contact/${encodeURIComponent(String(contactId))}`;

  for (let attempt = 0; ; attempt += 1) {
    const activeCookieValue = getActiveCookieValue(cookieValue, authCookieRefresh);
    const response = await fetch(buildAcumaticaUrl(resourcePath), {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Cookie: buildCookieHeader(activeCookieValue),
      },
      cache: "no-store",
    });

    if (authCookieRefresh) {
      const refreshedCookie = extractAuthCookieFromResponseHeaders(
        response.headers,
        activeCookieValue,
      );
      if (refreshedCookie) {
        authCookieRefresh.value = refreshedCookie;
      }
    }

    if (response.status === 429 && attempt < maxRateLimitRetries) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const backoffMs = Math.min(6000, 700 * 2 ** attempt);
      await sleep(retryAfterMs ?? backoffMs);
      continue;
    }

    if (!response.ok) {
      const errorResponse = await parseErrorResponse(response);
      throw new HttpError(
        response.status,
        errorResponse.message,
        errorResponse.details,
      );
    }

    if (response.status === 204) {
      return;
    }

    const responseText = await response.text();
    if (!responseText.trim()) {
      return;
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return;
    }

    try {
      JSON.parse(responseText);
      return;
    } catch {
      throw new HttpError(
        502,
        `Acumatica returned invalid JSON while deleting contact '${contactId}'.`,
      );
    }
  }
}

export async function validateSessionWithAcumatica(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<unknown> {
  const env = getEnv();
  const sessionProbeUrl =
    env.AUTH_PROVIDER === "custom"
      ? env.AUTH_ME_URL
      : env.AUTH_ME_URL ??
        `${env.ACUMATICA_BASE_URL}${env.ACUMATICA_ENTITY_PATH}/BusinessAccount?$top=1`;

  if (!sessionProbeUrl) {
    throw new HttpError(500, "AUTH_ME_URL is required when AUTH_PROVIDER=custom.");
  }

  const maxRateLimitRetries = 2;

  for (let attempt = 0; ; attempt += 1) {
    const activeCookieValue = getActiveCookieValue(cookieValue, authCookieRefresh);
    const response = await fetch(sessionProbeUrl, {
      method: "GET",
      headers: {
        Cookie: buildCookieHeader(activeCookieValue),
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (authCookieRefresh) {
      const refreshedCookie = extractAuthCookieFromResponseHeaders(
        response.headers,
        activeCookieValue,
      );
      if (refreshedCookie) {
        authCookieRefresh.value = refreshedCookie;
      }
    }

    if (response.status === 429 && attempt < maxRateLimitRetries) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const backoffMs = Math.min(4000, 500 * 2 ** attempt);
      await sleep(retryAfterMs ?? backoffMs);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, "Session is invalid or expired");
    }

    if (!response.ok) {
      const errorResponse = await parseErrorResponse(response);
      throw new HttpError(
        response.status,
        errorResponse.message,
        errorResponse.details,
      );
    }

    if (response.status === 204) {
      return null;
    }

    return parseJsonPayload(response, "validating session");
  }
}
