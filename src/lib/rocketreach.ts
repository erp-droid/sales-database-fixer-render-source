import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { normalizePhoneForSave } from "@/lib/phone";
import type {
  ContactEnhanceCandidate,
  ContactEnhanceFilledFieldKey,
  ContactEnhanceRequest,
  ContactEnhanceResponse,
  ContactEnhanceSuggestion,
} from "@/types/contact-enhance";

const ROCKETREACH_BASE_URL = "https://api.rocketreach.co/api/v2";
const SEARCH_PAGE_SIZE = 10;
const CANDIDATE_LIMIT = 5;
const LOOKUP_POLL_ATTEMPTS = 5;
const LOOKUP_POLL_DELAY_MS = 1_000;
const LOCATION_STATE_LABELS: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};
const LOCATION_COUNTRY_LABELS: Record<string, string> = {
  CA: "Canada",
  US: "United States",
};

type RocketReachPerson = {
  id?: unknown;
  status?: unknown;
  name?: unknown;
  linkedin_url?: unknown;
  location?: unknown;
  current_title?: unknown;
  current_employer?: unknown;
  current_work_email?: unknown;
  current_personal_email?: unknown;
  emails?: unknown;
  phones?: unknown;
};

type RocketReachSearchPayload = {
  query: Record<string, string[]>;
  start: number;
  page_size: number;
};

type RankedCandidate = {
  candidate: ContactEnhanceCandidate;
  score: number;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeCountry(value: string | null | undefined): string | null {
  const normalized = clean(value)?.toUpperCase() ?? null;
  if (!normalized) {
    return null;
  }

  if (normalized === "CA" || normalized === "CAN") {
    return "CA";
  }
  if (normalized === "US" || normalized === "USA") {
    return "US";
  }

  return normalized;
}

function normalizeLocationState(value: string | null | undefined): string | null {
  const normalized = clean(value)?.toUpperCase() ?? null;
  if (!normalized) {
    return null;
  }

  return LOCATION_STATE_LABELS[normalized] ?? normalized;
}

function normalizeLocationCountryLabel(value: string | null | undefined): string | null {
  const normalized = normalizeCountry(value);
  if (!normalized) {
    return null;
  }

  return LOCATION_COUNTRY_LABELS[normalized] ?? normalized;
}

function hasTwoWordName(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return value.split(/\s+/).filter(Boolean).length >= 2;
}

function isValidEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : NaN;

  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function readPeopleSearchResponse(payload: unknown): RocketReachPerson[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const profiles = (payload as Record<string, unknown>).profiles;
  return Array.isArray(profiles) ? (profiles as RocketReachPerson[]) : [];
}

function readPeopleStatusResponse(payload: unknown): RocketReachPerson[] {
  return Array.isArray(payload) ? (payload as RocketReachPerson[]) : [];
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function readRocketReachErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const direct =
    (typeof record.detail === "string" && record.detail.trim()) ||
    (typeof record.error === "string" && record.error.trim()) ||
    (typeof record.message === "string" && record.message.trim()) ||
    null;
  if (direct) {
    return direct;
  }

  const details = Object.entries(record)
    .map(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        return `${key}: ${value.join(", ")}`;
      }
      if (typeof value === "string" && value.trim().length > 0) {
        return `${key}: ${value.trim()}`;
      }
      return null;
    })
    .filter((value): value is string => value !== null);

  return details.length > 0 ? details.join(". ") : null;
}

function mapRocketReachError(status: number, payload: unknown): HttpError {
  const upstreamMessage = readRocketReachErrorMessage(payload);

  if (status === 401 || status === 403) {
    return new HttpError(
      502,
      "RocketReach rejected the API key or this account cannot use the requested endpoint.",
      upstreamMessage ?? payload,
    );
  }

  if (status === 429) {
    return new HttpError(
      429,
      "RocketReach rate limited this request. Wait a moment and try again.",
      upstreamMessage ?? payload,
    );
  }

  if (status >= 500) {
    return new HttpError(
      502,
      "RocketReach is unavailable right now. Try again later.",
      upstreamMessage ?? payload,
    );
  }

  if (status === 404) {
    return new HttpError(
      404,
      "RocketReach could not find a matching person for this selection.",
      upstreamMessage ?? payload,
    );
  }

  return new HttpError(
    422,
    upstreamMessage ?? "RocketReach rejected the enhancement request.",
    payload,
  );
}

async function fetchRocketReachJson<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const apiKey = getEnv().ROCKETREACH_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(503, "RocketReach is not configured for this environment.");
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Api-Key", apiKey);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${ROCKETREACH_BASE_URL}/${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
  const payload = await readJsonResponse<T>(response);

  if (!response.ok) {
    throw mapRocketReachError(response.status, payload);
  }

  if (payload === null) {
    throw new HttpError(502, "RocketReach returned an unexpected response.");
  }

  return payload;
}

function readPersonId(person: RocketReachPerson): number | null {
  return person && typeof person === "object"
    ? readPositiveInteger(person as Record<string, unknown>, "id")
    : null;
}

function readPersonName(person: RocketReachPerson): string | null {
  return person && typeof person === "object"
    ? readString(person as Record<string, unknown>, "name")
    : null;
}

function readPersonEmployer(person: RocketReachPerson): string | null {
  return person && typeof person === "object"
    ? readString(person as Record<string, unknown>, "current_employer")
    : null;
}

function readPersonLocation(person: RocketReachPerson): string | null {
  return person && typeof person === "object"
    ? readString(person as Record<string, unknown>, "location")
    : null;
}

function readPersonTitle(person: RocketReachPerson): string | null {
  if (!person || typeof person !== "object") {
    return null;
  }

  const record = person as Record<string, unknown>;
  return (
    readString(record, "current_title") ??
    readString(record, "title") ??
    readString(record, "job_title") ??
    readString(record, "headline") ??
    readString(record, "occupation") ??
    readString(record, "current_position") ??
    readString(record, "position")
  );
}

function readPersonLinkedInUrl(person: RocketReachPerson): string | null {
  return person && typeof person === "object"
    ? readString(person as Record<string, unknown>, "linkedin_url")
    : null;
}

function readPersonStatus(person: RocketReachPerson): string | null {
  return person && typeof person === "object"
    ? readString(person as Record<string, unknown>, "status")
    : null;
}

function buildLocationString(request: ContactEnhanceRequest): string | null {
  const parts = [
    clean(request.city),
    normalizeLocationState(request.state),
    normalizeLocationCountryLabel(request.country),
  ].filter((value): value is string => value !== null);

  return parts.length > 0 ? parts.join(", ") : null;
}

function createRocketReachSearchPayload(
  query: Record<string, string[]>,
): RocketReachSearchPayload {
  return {
    query,
    start: 1,
    page_size: SEARCH_PAGE_SIZE,
  };
}

export function buildRocketReachSearchRequest(
  request: ContactEnhanceRequest,
): RocketReachSearchPayload | null {
  return buildRocketReachSearchRequests(request)[0] ?? null;
}

export function buildRocketReachSearchRequests(
  request: ContactEnhanceRequest,
): RocketReachSearchPayload[] {
  const contactName = clean(request.contactName);
  const companyName = clean(request.companyName);
  const city = clean(request.city);
  const state = clean(request.state);
  const location = buildLocationString(request);
  const hasUsefulLocation = Boolean(city || state);

  if (!contactName && !companyName) {
    return [];
  }

  if (!contactName && !hasUsefulLocation) {
    return [];
  }

  if (!companyName && !hasTwoWordName(contactName) && !hasUsefulLocation) {
    return [];
  }

  const payloads: RocketReachSearchPayload[] = [];
  const seen = new Set<string>();

  function addPayload(query: Record<string, string[]>) {
    const key = JSON.stringify(query);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    payloads.push(createRocketReachSearchPayload(query));
  }

  if (contactName && companyName && location) {
    addPayload({
      name: [contactName],
      current_employer: [companyName],
      location: [location],
    });
  }

  if (contactName && companyName) {
    addPayload({
      name: [contactName],
      current_employer: [companyName],
    });
  }

  if (contactName && location) {
    addPayload({
      name: [contactName],
      location: [location],
    });
  }

  if (contactName) {
    addPayload({
      name: [contactName],
    });
  }

  return payloads;
}

function scoreNameMatch(candidateName: string | null, requestedName: string | null): number {
  if (!candidateName || !requestedName) {
    return 0;
  }

  const normalizedCandidate = normalizeComparable(candidateName);
  const normalizedRequested = normalizeComparable(requestedName);
  if (!normalizedCandidate || !normalizedRequested) {
    return 0;
  }

  if (normalizedCandidate === normalizedRequested) {
    return 120;
  }

  if (
    normalizedCandidate.includes(normalizedRequested) ||
    normalizedRequested.includes(normalizedCandidate)
  ) {
    return 60;
  }

  const requestedTokens = new Set(normalizedRequested.split(/\s+/).filter(Boolean));
  const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
  const overlap = candidateTokens.filter((token) => requestedTokens.has(token)).length;

  return overlap * 15;
}

function scoreEmployerMatch(candidateEmployer: string | null, requestedEmployer: string | null): number {
  if (!candidateEmployer || !requestedEmployer) {
    return 0;
  }

  const normalizedCandidate = normalizeComparable(candidateEmployer);
  const normalizedRequested = normalizeComparable(requestedEmployer);
  if (!normalizedCandidate || !normalizedRequested) {
    return 0;
  }

  if (normalizedCandidate === normalizedRequested) {
    return 90;
  }

  if (
    normalizedCandidate.includes(normalizedRequested) ||
    normalizedRequested.includes(normalizedCandidate)
  ) {
    return 35;
  }

  return 0;
}

function scoreLocationMatch(candidateLocation: string | null, request: ContactEnhanceRequest): number {
  if (!candidateLocation) {
    return 0;
  }

  const normalizedLocation = normalizeComparable(candidateLocation);
  if (!normalizedLocation) {
    return 0;
  }

  function locationIncludesTerm(term: string): boolean {
    const normalizedTerm = normalizeComparable(term);
    if (!normalizedTerm) {
      return false;
    }

    if (normalizedTerm.length <= 3) {
      const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(normalizedLocation);
    }

    return normalizedLocation.includes(normalizedTerm);
  }

  function buildStateTerms(value: string | null | undefined): string[] {
    const raw = clean(value);
    if (!raw) {
      return [];
    }

    const normalized = raw.trim().toUpperCase();
    const fullLabel = LOCATION_STATE_LABELS[normalized];
    return fullLabel ? [normalized, fullLabel] : [raw];
  }

  function buildCountryTerms(value: string | null | undefined): string[] {
    const normalized = normalizeCountry(value);
    if (!normalized) {
      return [];
    }

    const fullLabel = LOCATION_COUNTRY_LABELS[normalized];
    return fullLabel ? [normalized, fullLabel] : [normalized];
  }

  let score = 0;
  const city = clean(request.city);
  const stateTerms = buildStateTerms(request.state);
  const countryTerms = buildCountryTerms(request.country);

  if (city && locationIncludesTerm(city)) {
    score += 20;
  }
  if (stateTerms.some((term) => locationIncludesTerm(term))) {
    score += 10;
  }
  if (countryTerms.some((term) => locationIncludesTerm(term))) {
    score += 5;
  }

  return score;
}

function scoreRocketReachPerson(person: RocketReachPerson, request: ContactEnhanceRequest): number {
  return (
    scoreNameMatch(readPersonName(person), clean(request.contactName)) +
    scoreEmployerMatch(readPersonEmployer(person), clean(request.companyName)) +
    scoreLocationMatch(readPersonLocation(person), request)
  );
}

function toCandidate(person: RocketReachPerson): ContactEnhanceCandidate | null {
  const id = readPersonId(person);
  if (id === null) {
    return null;
  }

  return {
    id,
    name: readPersonName(person),
    currentTitle: readPersonTitle(person),
    currentEmployer: readPersonEmployer(person),
    location: readPersonLocation(person),
    linkedinUrl: readPersonLinkedInUrl(person),
  };
}

export function buildRankedRocketReachCandidates(
  people: RocketReachPerson[],
  request: ContactEnhanceRequest,
): ContactEnhanceCandidate[] {
  const rankedById = new Map<number, RankedCandidate>();

  for (const person of people) {
    const candidate = toCandidate(person);
    if (!candidate) {
      continue;
    }

    const nextRanked: RankedCandidate = {
      candidate,
      score: scoreRocketReachPerson(person, request),
    };
    const existing = rankedById.get(candidate.id);
    if (!existing || nextRanked.score > existing.score) {
      rankedById.set(candidate.id, nextRanked);
    }
  }

  return [...rankedById.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (left.candidate.name ?? "").localeCompare(right.candidate.name ?? "");
    })
    .slice(0, CANDIDATE_LIMIT)
    .map((entry) => entry.candidate);
}

function chooseProfessionalEmail(person: RocketReachPerson): string | null {
  if (!person || typeof person !== "object") {
    return null;
  }

  const record = person as Record<string, unknown>;
  const currentWorkEmail = readString(record, "current_work_email");
  if (isValidEmail(currentWorkEmail)) {
    return currentWorkEmail;
  }

  const emails = Array.isArray(record.emails)
    ? (record.emails as Array<Record<string, unknown>>)
    : [];

  for (const emailRecord of emails) {
    const email = readString(emailRecord, "email");
    const type = normalizeComparable(readString(emailRecord, "type"));
    if (!isValidEmail(email)) {
      continue;
    }
    if (type === "professional" || type === "work" || type === "business") {
      return email;
    }
  }

  return null;
}

function scorePhoneType(type: string | null): number {
  const normalized = normalizeComparable(type);
  if (
    normalized.includes("office") ||
    normalized.includes("work") ||
    normalized.includes("direct") ||
    normalized.includes("business")
  ) {
    return 100;
  }

  if (normalized.includes("mobile") || normalized.includes("cell")) {
    return 50;
  }

  return 10;
}

function chooseBestPhone(person: RocketReachPerson): string | null {
  if (!person || typeof person !== "object") {
    return null;
  }

  const phones = Array.isArray((person as Record<string, unknown>).phones)
    ? ((person as Record<string, unknown>).phones as Array<Record<string, unknown>>)
    : [];

  const scored = phones
    .map((phoneRecord) => ({
      phone: normalizePhoneForSave(readString(phoneRecord, "number")),
      score: scorePhoneType(readString(phoneRecord, "type")),
    }))
    .filter((entry): entry is { phone: string; score: number } => entry.phone !== null)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.phone ?? null;
}

export function buildContactEnhanceSuggestion(
  person: RocketReachPerson,
): ContactEnhanceSuggestion {
  return {
    name: readPersonName(person),
    jobTitle: readPersonTitle(person),
    email: chooseProfessionalEmail(person),
    phone: chooseBestPhone(person),
  };
}

function applySuggestionFallbacks(
  suggestion: ContactEnhanceSuggestion,
  fallback: {
    jobTitle?: string | null;
  },
): ContactEnhanceSuggestion {
  return {
    ...suggestion,
    jobTitle: clean(suggestion.jobTitle) ?? clean(fallback.jobTitle) ?? null,
  };
}

export function resolveFilledFieldKeys(
  request: ContactEnhanceRequest,
  suggestion: ContactEnhanceSuggestion,
): ContactEnhanceFilledFieldKey[] {
  const filledFieldKeys: ContactEnhanceFilledFieldKey[] = [];

  if (!clean(request.contactName) && clean(suggestion.name)) {
    filledFieldKeys.push("name");
  }
  if (!clean(request.contactJobTitle) && clean(suggestion.jobTitle)) {
    filledFieldKeys.push("jobTitle");
  }
  if (!clean(request.contactEmail) && clean(suggestion.email)) {
    filledFieldKeys.push("email");
  }
  if (!clean(request.contactPhone) && clean(suggestion.phone)) {
    filledFieldKeys.push("phone");
  }

  return filledFieldKeys;
}

export async function searchRocketReachPeople(
  request: ContactEnhanceRequest,
): Promise<RocketReachPerson[]> {
  const searchRequests = buildRocketReachSearchRequests(request);
  if (searchRequests.length === 0) {
    return [];
  }

  const peopleById = new Map<number, RocketReachPerson>();
  const peopleWithoutIds: RocketReachPerson[] = [];

  for (const searchRequest of searchRequests) {
    const payload = await fetchRocketReachJson<unknown>("person/search", {
      method: "POST",
      body: JSON.stringify(searchRequest),
    });

    const matches = readPeopleSearchResponse(payload);
    for (const person of matches) {
      const personId = readPersonId(person);
      if (personId === null) {
        peopleWithoutIds.push(person);
        continue;
      }

      if (!peopleById.has(personId)) {
        peopleById.set(personId, person);
      }
    }

    if (matches.length > 0 || peopleById.size >= CANDIDATE_LIMIT) {
      break;
    }
  }

  return [...peopleById.values(), ...peopleWithoutIds];
}

export async function lookupRocketReachPerson(personId: number): Promise<RocketReachPerson> {
  let person = await fetchRocketReachJson<RocketReachPerson>(
    `person/lookup?id=${encodeURIComponent(String(personId))}`,
    {
      method: "GET",
    },
  );

  for (let attempt = 0; attempt < LOOKUP_POLL_ATTEMPTS; attempt += 1) {
    const status = normalizeComparable(readPersonStatus(person));
    if (!status || status === "complete") {
      return person;
    }

    await sleep(LOOKUP_POLL_DELAY_MS);
    const statusPayload = await fetchRocketReachJson<unknown>(
      `person/checkStatus?ids=${encodeURIComponent(String(personId))}`,
      {
        method: "GET",
      },
    );
    const matches = readPeopleStatusResponse(statusPayload);
    const matchedPerson = matches.find((candidate) => readPersonId(candidate) === personId);
    if (!matchedPerson) {
      continue;
    }

    person = matchedPerson;
  }

  if (normalizeComparable(readPersonStatus(person)) !== "complete") {
    throw new HttpError(
      504,
      "RocketReach is still processing this contact. Try Enhance again in a moment.",
    );
  }

  return person;
}

export async function enhanceContactWithRocketReach(
  request: ContactEnhanceRequest,
): Promise<ContactEnhanceResponse> {
  if (
    request.candidatePersonId !== null &&
    request.candidatePersonId !== undefined
  ) {
    const person = await lookupRocketReachPerson(request.candidatePersonId);
    const suggestion = applySuggestionFallbacks(buildContactEnhanceSuggestion(person), {
      jobTitle: request.candidateCurrentTitle,
    });

    return {
      status: "ready",
      suggestion,
      filledFieldKeys: resolveFilledFieldKeys(request, suggestion),
    };
  }

  const searchRequest = buildRocketReachSearchRequest(request);
  if (!searchRequest) {
    return {
      status: "need_more_context",
      message:
        "Add a contact name or more location details before enhancing with RocketReach.",
    };
  }

  const people = await searchRocketReachPeople(request);
  const candidates = buildRankedRocketReachCandidates(people, request);

  if (candidates.length === 0) {
    return {
      status: "no_match",
      message: "RocketReach did not find a matching contact from the available details.",
    };
  }

  if (candidates.length > 1) {
    return {
      status: "needs_selection",
      candidates,
    };
  }

  const person = await lookupRocketReachPerson(candidates[0].id);
  const matchedSearchPerson =
    people.find((candidate) => readPersonId(candidate) === candidates[0].id) ?? null;
  const suggestion = applySuggestionFallbacks(buildContactEnhanceSuggestion(person), {
    jobTitle: matchedSearchPerson ? readPersonTitle(matchedSearchPerson) : null,
  });

  return {
    status: "ready",
    suggestion,
    filledFieldKeys: resolveFilledFieldKeys(request, suggestion),
  };
}
