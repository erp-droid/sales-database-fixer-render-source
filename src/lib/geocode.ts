export type GeocodeInput = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  provider: "nominatim" | "arcgis";
};

const GEOCODE_TIMEOUT_MS = 3500;

function clean(value: string): string {
  return value.trim();
}

function buildSearchTerm(input: GeocodeInput): string {
  return [
    input.addressLine1,
    input.addressLine2,
    input.city,
    input.state,
    input.postalCode,
    input.country,
  ]
    .map((part) => clean(part))
    .filter(Boolean)
    .join(" ");
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs: number = GEOCODE_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeWithNominatim(
  input: GeocodeInput,
): Promise<GeocodeResult | null> {
  const query = buildSearchTerm(input);
  if (!query) {
    return null;
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    query,
  )}`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "SalesDatabaseFixer/1.0 (internal map lookup)",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | Array<{ lat?: string; lon?: string }>
    | null;
  const first = payload?.[0];
  if (!first) {
    return null;
  }

  const latitude = parseNumber(first.lat);
  const longitude = parseNumber(first.lon);
  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    provider: "nominatim",
  };
}

async function geocodeWithArcGIS(input: GeocodeInput): Promise<GeocodeResult | null> {
  const query = buildSearchTerm(input);
  if (!query) {
    return null;
  }

  const url =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates" +
    `?f=json&maxLocations=1&singleLine=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { candidates?: Array<{ location?: { x?: number; y?: number } }> }
    | null;
  const location = payload?.candidates?.[0]?.location;
  const latitude = parseNumber(location?.y);
  const longitude = parseNumber(location?.x);
  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
    provider: "arcgis",
  };
}

export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult | null> {
  const hasCoreAddress = Boolean(clean(input.addressLine1) && clean(input.city));
  if (!hasCoreAddress) {
    return null;
  }

  const arcgis = await geocodeWithArcGIS(input).catch(() => null);
  if (arcgis) {
    return arcgis;
  }

  return geocodeWithNominatim(input).catch(() => null);
}
