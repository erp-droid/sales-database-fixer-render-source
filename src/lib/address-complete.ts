import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";

export type AddressInput = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type AddressOutput = AddressInput;

export type AddressCompleteSuggestion = {
  id: string;
  type: string;
  text: string;
  description: string;
};

type FindResultItem = {
  Id?: string;
  Type?: string;
  Text?: string;
  Description?: string;
  Error?: string;
  Cause?: string;
  Resolution?: string;
};

type RetrieveResultItem = Record<string, unknown> & {
  Error?: string;
  Cause?: string;
  Resolution?: string;
};

type NominatimResultItem = {
  place_id?: number | string;
  display_name?: string;
  address?: Record<string, unknown>;
};

type PhotonFeatureItem = {
  type?: string;
  properties?: Record<string, unknown>;
};

const NOMINATIM_SUGGESTION_PREFIX = "nominatim:";
const PHOTON_SUGGESTION_PREFIX = "photon:";

function clean(value: string): string {
  return value.trim();
}

function cleanUpper(value: string): string {
  return clean(value).toUpperCase();
}

function toCountryCode3(value: string): string {
  const normalized = cleanUpper(value);
  if (normalized === "CA" || normalized === "CAN") {
    return "CAN";
  }
  if (normalized === "US" || normalized === "USA") {
    return "USA";
  }
  return normalized.slice(0, 3) || "CAN";
}

function findValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function parseFindItems(payload: unknown): FindResultItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const items = (payload as { Items?: unknown }).Items;
  return Array.isArray(items) ? (items as FindResultItem[]) : [];
}

function parseRetrieveItems(payload: unknown): RetrieveResultItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const items = (payload as { Items?: unknown }).Items;
  return Array.isArray(items) ? (items as RetrieveResultItem[]) : [];
}

function assertAddressCompleteSuccess(items: Array<{ Error?: string; Cause?: string }>) {
  const withError = items.find((item) => item.Error && item.Error !== "0");
  if (!withError) {
    return;
  }

  const errorCode = (withError.Error ?? "").trim();
  if (errorCode === "13") {
    throw new HttpError(
      429,
      "Canada Post AddressComplete quota was reached for this API key.",
    );
  }

  throw new HttpError(
    422,
    withError.Cause ||
      "AddressComplete rejected this address. Verify the address and try again.",
  );
}

function pickAddressCandidate(items: FindResultItem[]): FindResultItem | null {
  const directAddress = items.find((item) => item.Type?.toLowerCase() === "address");
  return directAddress ?? items[0] ?? null;
}

function normalizePostalCode(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (compact.length === 6) {
    return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  }

  return value.toUpperCase();
}

function buildSearchTerm(input: AddressInput): string {
  return [
    input.addressLine1,
    input.addressLine2,
    input.city,
    input.state,
    input.postalCode,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function isFallbackSuggestionId(id: string): boolean {
  return (
    id.startsWith(NOMINATIM_SUGGESTION_PREFIX) ||
    id.startsWith(PHOTON_SUGGESTION_PREFIX)
  );
}

function isValidFindItem(item: FindResultItem): boolean {
  return !item.Error || item.Error === "0";
}

function isValidRetrieveItem(item: RetrieveResultItem): boolean {
  return !item.Error || item.Error === "0";
}

function normalizeAddressFromRetrieve(
  normalized: RetrieveResultItem,
  fallback: AddressInput,
): AddressOutput {
  const line1 = findValue(normalized, ["Line1", "Street", "AddressLine1"]) || fallback.addressLine1;
  const line2 =
    findValue(normalized, ["Line2", "SubBuilding", "AddressLine2"]) || fallback.addressLine2;
  const city = findValue(normalized, ["City", "Locality"]) || fallback.city;
  const state =
    findValue(normalized, ["ProvinceCode", "ProvinceName", "Province", "AdminAreaCode"]) ||
    fallback.state;
  const postalCode = findValue(normalized, ["PostalCode", "Postcode"]) || fallback.postalCode;
  const country =
    findValue(normalized, ["CountryIso2", "CountryIso3", "CountryName"]) || fallback.country;

  return {
    addressLine1: line1,
    addressLine2: line2,
    city,
    state,
    postalCode: normalizePostalCode(postalCode),
    country: cleanUpper(country).slice(0, 3),
  };
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized.length % 4 === 0
      ? normalized
      : `${normalized}${"=".repeat(4 - (normalized.length % 4))}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseNominatimItems(payload: unknown): NominatimResultItem[] {
  return Array.isArray(payload) ? (payload as NominatimResultItem[]) : [];
}

function parsePhotonItems(payload: unknown): PhotonFeatureItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const features = (payload as { features?: unknown }).features;
  return Array.isArray(features) ? (features as PhotonFeatureItem[]) : [];
}

function readNominatimString(
  address: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!address) {
    return "";
  }

  for (const key of keys) {
    const value = address[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function normalizeAddressFromNominatim(
  item: NominatimResultItem,
  fallbackCountry: string,
): AddressOutput {
  const address =
    item.address && typeof item.address === "object" ? item.address : undefined;
  const house = readNominatimString(address, ["house_number"]);
  const street = readNominatimString(address, [
    "road",
    "pedestrian",
    "street",
  ]);
  const line1 = [house, street].filter(Boolean).join(" ").trim();
  const city = readNominatimString(address, [
    "city",
    "town",
    "village",
    "hamlet",
    "municipality",
  ]);
  const state = readNominatimString(address, ["state_code", "state", "province"]);
  const postalCode = normalizePostalCode(readNominatimString(address, ["postcode"]));
  const country =
    cleanUpper(readNominatimString(address, ["country_code"])) ||
    cleanUpper(fallbackCountry).slice(0, 3) ||
    "CA";

  return {
    addressLine1: line1,
    addressLine2: "",
    city,
    state,
    postalCode,
    country: country.slice(0, 3),
  };
}

function toEmbeddedSuggestion(
  prefix: string,
  address: AddressOutput,
): AddressCompleteSuggestion {
  const encoded = toBase64Url(JSON.stringify(address));
  const description = [address.city, address.state, address.postalCode, address.country]
    .filter(Boolean)
    .join(", ");

  return {
    id: `${prefix}${encoded}`,
    type: "Address",
    text: address.addressLine1 || description || "Address",
    description,
  };
}

function toNominatimSuggestion(address: AddressOutput): AddressCompleteSuggestion {
  return toEmbeddedSuggestion(NOMINATIM_SUGGESTION_PREFIX, address);
}

function toPhotonSuggestion(address: AddressOutput): AddressCompleteSuggestion {
  return toEmbeddedSuggestion(PHOTON_SUGGESTION_PREFIX, address);
}

async function findFallbackSuggestionsWithNominatim(input: {
  searchTerm: string;
  country: string;
  limit: number;
}): Promise<AddressCompleteSuggestion[]> {
  const query = clean(input.searchTerm);
  if (query.length < 3) {
    return [];
  }

  const country = cleanUpper(input.country);
  const countryCode = country === "CA" || country === "CAN" ? "ca" : country === "US" || country === "USA" ? "us" : "";
  const searchParams = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: String(Math.max(1, Math.min(input.limit, 10))),
    q: query,
  });
  if (countryCode) {
    searchParams.set("countrycodes", countryCode);
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${searchParams.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "SalesDatabaseFixer/1.0 (address lookup fallback)",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    return [];
  }

  const payload = await response.json().catch(() => null);
  const items = parseNominatimItems(payload);
  return items
    .map((item) => normalizeAddressFromNominatim(item, input.country))
    .map((address) => toNominatimSuggestion(address));
}

function normalizeAddressFromPhoton(
  item: PhotonFeatureItem,
  fallbackCountry: string,
): AddressOutput {
  const properties =
    item.properties && typeof item.properties === "object"
      ? item.properties
      : {};
  const house =
    typeof properties.housenumber === "string" ? properties.housenumber.trim() : "";
  const street =
    typeof properties.street === "string" ? properties.street.trim() : "";
  const line1 = [house, street].filter(Boolean).join(" ").trim();
  const city = findValue(properties, ["city", "town", "village", "municipality"]);
  const state = findValue(properties, ["state"]);
  const postalCode = normalizePostalCode(findValue(properties, ["postcode"]));
  const country =
    cleanUpper(findValue(properties, ["countrycode", "country"])) ||
    cleanUpper(fallbackCountry).slice(0, 3) ||
    "CA";

  return {
    addressLine1: line1,
    addressLine2: "",
    city,
    state,
    postalCode,
    country: country.slice(0, 3),
  };
}

async function findFallbackSuggestionsWithPhoton(input: {
  searchTerm: string;
  country: string;
  limit: number;
}): Promise<AddressCompleteSuggestion[]> {
  const query = clean(input.searchTerm);
  if (query.length < 3) {
    return [];
  }

  const country = cleanUpper(input.country);
  const language = "en";
  const searchParams = new URLSearchParams({
    q: query,
    limit: String(Math.max(1, Math.min(input.limit, 10))),
    lang: language,
  });
  if (country === "CA" || country === "CAN") {
    searchParams.set("bbox", "-141.0,41.7,-52.6,83.1");
  } else if (country === "US" || country === "USA") {
    searchParams.set("bbox", "-125.0,24.5,-66.9,49.4");
  }

  const response = await fetch(`https://photon.komoot.io/api/?${searchParams.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "SalesDatabaseFixer/1.0 (address lookup fallback)",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return [];
  }

  const payload = await response.json().catch(() => null);
  const items = parsePhotonItems(payload);
  return items
    .map((item) => normalizeAddressFromPhoton(item, input.country))
    .filter((address) => Boolean(address.addressLine1))
    .map((address) => toPhotonSuggestion(address));
}

export async function findAddressCompleteSuggestions(input: {
  searchTerm: string;
  country: string;
  limit?: number;
}): Promise<AddressCompleteSuggestion[]> {
  const query = clean(input.searchTerm);
  if (query.length < 3) {
    return [];
  }

  const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
  const env = getEnv();
  const canUseAddressComplete = Boolean(env.ADDRESS_COMPLETE_API_KEY);

  if (canUseAddressComplete) {
    try {
      const findParams = new URLSearchParams({
        Key: env.ADDRESS_COMPLETE_API_KEY as string,
        SearchTerm: query,
        Country: toCountryCode3(input.country),
        LanguagePreference: "EN",
        Limit: String(limit),
      });

      const response = await fetch(`${env.ADDRESS_COMPLETE_FIND_URL}?${findParams.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new HttpError(502, "AddressComplete find request failed. Please retry.");
      }

      const payload = await response.json().catch(() => null);
      const rawItems = parseFindItems(payload);
      assertAddressCompleteSuccess(rawItems);
      const items = rawItems.filter(isValidFindItem);

      const suggestions = items
        .filter((item) => typeof item.Id === "string" && item.Id.trim().length > 0)
        .map((item) => ({
          id: String(item.Id),
          type: item.Type?.trim() || "Address",
          text: item.Text?.trim() || "Address",
          description: item.Description?.trim() || "",
        }));

      if (suggestions.length > 0) {
        return suggestions;
      }
    } catch {
      // Fall through to Nominatim fallback.
    }
  }

  const nominatimSuggestions = await findFallbackSuggestionsWithNominatim({
    searchTerm: query,
    country: input.country,
    limit,
  });
  if (nominatimSuggestions.length > 0) {
    return nominatimSuggestions;
  }

  return findFallbackSuggestionsWithPhoton({
    searchTerm: query,
    country: input.country,
    limit,
  });
}

export async function findCanadaPostAddressCompleteSuggestions(input: {
  searchTerm: string;
  country: string;
  limit?: number;
}): Promise<AddressCompleteSuggestion[]> {
  const query = clean(input.searchTerm);
  if (query.length < 3) {
    return [];
  }

  const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
  const env = getEnv();

  if (!env.ADDRESS_COMPLETE_API_KEY) {
    throw new HttpError(
      500,
      "ADDRESS_COMPLETE_API_KEY is required for Canada Post address lookup.",
    );
  }

  const findParams = new URLSearchParams({
    Key: env.ADDRESS_COMPLETE_API_KEY,
    SearchTerm: query,
    Country: toCountryCode3(input.country),
    LanguagePreference: "EN",
    Limit: String(limit),
  });

  const response = await fetch(`${env.ADDRESS_COMPLETE_FIND_URL}?${findParams.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new HttpError(502, "AddressComplete find request failed. Please retry.");
  }

  const payload = await response.json().catch(() => null);
  const rawItems = parseFindItems(payload);
  assertAddressCompleteSuccess(rawItems);

  return rawItems
    .filter(isValidFindItem)
    .filter((item) => typeof item.Id === "string" && item.Id.trim().length > 0)
    .map((item) => ({
      id: String(item.Id),
      type: item.Type?.trim() || "Address",
      text: item.Text?.trim() || "Address",
      description: item.Description?.trim() || "",
    }));
}

export async function retrieveAddressCompleteAddress(input: {
  id: string;
  fallback: AddressInput;
}): Promise<AddressOutput> {
  const id = clean(input.id);
  if (isFallbackSuggestionId(id)) {
    const encoded = id.startsWith(NOMINATIM_SUGGESTION_PREFIX)
      ? id.slice(NOMINATIM_SUGGESTION_PREFIX.length)
      : id.slice(PHOTON_SUGGESTION_PREFIX.length);
    try {
      const parsed = JSON.parse(fromBase64Url(encoded)) as Partial<AddressOutput>;
      return {
        addressLine1: typeof parsed.addressLine1 === "string" ? parsed.addressLine1 : input.fallback.addressLine1,
        addressLine2: typeof parsed.addressLine2 === "string" ? parsed.addressLine2 : input.fallback.addressLine2,
        city: typeof parsed.city === "string" ? parsed.city : input.fallback.city,
        state: typeof parsed.state === "string" ? parsed.state : input.fallback.state,
        postalCode: typeof parsed.postalCode === "string" ? parsed.postalCode : input.fallback.postalCode,
        country: typeof parsed.country === "string" ? parsed.country : input.fallback.country,
      };
    } catch {
      throw new HttpError(422, "Could not parse selected address suggestion.");
    }
  }

  const env = getEnv();
  if (!env.ADDRESS_COMPLETE_API_KEY) {
    throw new HttpError(500, "ADDRESS_COMPLETE_API_KEY is required for Canada Post address lookup.");
  }

  if (!id) {
    throw new HttpError(400, "Address suggestion id is required.");
  }

  const retrieveParams = new URLSearchParams({
    Key: env.ADDRESS_COMPLETE_API_KEY,
    Id: id,
  });

  const response = await fetch(
    `${env.ADDRESS_COMPLETE_RETRIEVE_URL}?${retrieveParams.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new HttpError(502, "AddressComplete retrieve request failed. Please retry.");
  }

  const payload = await response.json().catch(() => null);
  const rawItems = parseRetrieveItems(payload);
  assertAddressCompleteSuccess(rawItems);
  const items = rawItems.filter(isValidRetrieveItem);
  if (!items.length) {
    throw new HttpError(422, "AddressComplete did not return a normalized address.");
  }

  return normalizeAddressFromRetrieve(items[0], input.fallback);
}

export async function retrieveCanadaPostAddressCompleteAddress(input: {
  id: string;
  fallback: AddressInput;
}): Promise<AddressOutput> {
  const id = clean(input.id);
  if (!id) {
    throw new HttpError(400, "Address suggestion id is required.");
  }

  if (isFallbackSuggestionId(id)) {
    throw new HttpError(
      422,
      "Only Canada Post address suggestions can be used for new account creation.",
    );
  }

  const env = getEnv();
  if (!env.ADDRESS_COMPLETE_API_KEY) {
    throw new HttpError(
      500,
      "ADDRESS_COMPLETE_API_KEY is required for Canada Post address lookup.",
    );
  }

  const retrieveParams = new URLSearchParams({
    Key: env.ADDRESS_COMPLETE_API_KEY,
    Id: id,
  });

  const response = await fetch(
    `${env.ADDRESS_COMPLETE_RETRIEVE_URL}?${retrieveParams.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new HttpError(502, "AddressComplete retrieve request failed. Please retry.");
  }

  const payload = await response.json().catch(() => null);
  const rawItems = parseRetrieveItems(payload);
  assertAddressCompleteSuccess(rawItems);
  const items = rawItems.filter(isValidRetrieveItem);
  if (!items.length) {
    throw new HttpError(422, "AddressComplete did not return a normalized address.");
  }

  return normalizeAddressFromRetrieve(items[0], input.fallback);
}

export function shouldValidateWithAddressComplete(input: AddressInput): boolean {
  const country = cleanUpper(input.country);
  return country === "CA" || country === "CAN";
}

export async function validateCanadianAddress(input: AddressInput): Promise<AddressOutput> {
  const env = getEnv();
  if (!env.ADDRESS_COMPLETE_API_KEY) {
    throw new HttpError(
      500,
      "ADDRESS_COMPLETE_API_KEY is required to validate Canadian address updates.",
    );
  }

  const findParams = new URLSearchParams({
    Key: env.ADDRESS_COMPLETE_API_KEY,
    SearchTerm: buildSearchTerm(input),
    Country: "CAN",
    LanguagePreference: "EN",
    Limit: "10",
  });

  const findResponse = await fetch(`${env.ADDRESS_COMPLETE_FIND_URL}?${findParams.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!findResponse.ok) {
    throw new HttpError(
      502,
      "AddressComplete find request failed. Please retry in a moment.",
    );
  }

  const findPayload = await findResponse.json();
  const findItems = parseFindItems(findPayload);
  if (!findItems.length) {
    throw new HttpError(422, "AddressComplete could not find a matching Canadian address.");
  }

  assertAddressCompleteSuccess(findItems);

  const candidate = pickAddressCandidate(findItems);
  if (!candidate?.Id) {
    throw new HttpError(
      422,
      "AddressComplete returned a non-specific result. Please enter a more complete address.",
    );
  }

  const retrieveParams = new URLSearchParams({
    Key: env.ADDRESS_COMPLETE_API_KEY,
    Id: candidate.Id,
  });

  const retrieveResponse = await fetch(
    `${env.ADDRESS_COMPLETE_RETRIEVE_URL}?${retrieveParams.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!retrieveResponse.ok) {
    throw new HttpError(
      502,
      "AddressComplete retrieve request failed. Please retry in a moment.",
    );
  }

  const retrievePayload = await retrieveResponse.json();
  const retrieveItems = parseRetrieveItems(retrievePayload);
  if (!retrieveItems.length) {
    throw new HttpError(422, "AddressComplete did not return a normalized address.");
  }

  assertAddressCompleteSuccess(retrieveItems);
  return normalizeAddressFromRetrieve(retrieveItems[0], input);
}
