import regionMapConfig from "../../config/business-account-region-map.json";
import type { BusinessAccountClassCode } from "@/types/business-account-create";

export type BusinessAccountRegionSource =
  | "exact_fsa"
  | "city_fallback"
  | "sales_rep_fallback"
  | "global_fallback";

export type BusinessAccountRegionMappingGroup = {
  region: string;
  label: string;
  fsas: string[];
};

export type BusinessAccountRegionMappingConfig = {
  overlapStrategy: "first_listed_wins";
  groups: BusinessAccountRegionMappingGroup[];
};

export type BusinessAccountRegionResolutionInput = {
  postalCode: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  country: string | null | undefined;
  salesRepId: string | null | undefined;
  salesRepName: string | null | undefined;
};

export type BusinessAccountRegionResolution = {
  region: string;
  source: BusinessAccountRegionSource;
  fsa: string | null;
};

export type BusinessAccountClassDecision =
  | {
      skip: true;
      skippedReason: "vendor";
      targetClassId: null;
    }
  | {
      skip: false;
      skippedReason: null;
      targetClassId: BusinessAccountClassCode;
    };

type CounterMap = Map<string, number>;

type DominantRegionProfile = {
  city: Map<string, CounterMap>;
  salesRep: Map<string, CounterMap>;
  global: CounterMap;
};

const typedRegionMapConfig = regionMapConfig as BusinessAccountRegionMappingConfig;

export const BUSINESS_ACCOUNT_REGION_MAP = typedRegionMapConfig;
export const BUSINESS_ACCOUNT_REGION_PRECEDENCE = BUSINESS_ACCOUNT_REGION_MAP.groups.map(
  (group) => group.region,
);

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
}

function normalizeLocationPart(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function normalizeSalesRepKey(
  salesRepId: string | null | undefined,
  salesRepName: string | null | undefined,
): string | null {
  const normalizedId = salesRepId?.trim() ?? "";
  if (normalizedId) {
    return `id:${normalizedId}`;
  }

  const normalizedName = salesRepName?.trim().toUpperCase() ?? "";
  return normalizedName ? `name:${normalizedName}` : null;
}

function normalizeCityKey(
  city: string | null | undefined,
  state: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const normalizedCity = normalizeLocationPart(city);
  const normalizedState = normalizeLocationPart(state);
  const normalizedCountry = normalizeLocationPart(country);
  if (!normalizedCity && !normalizedState && !normalizedCountry) {
    return null;
  }

  return [normalizedCity, normalizedState, normalizedCountry].join("|");
}

function incrementCounter(counter: CounterMap, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function chooseDominantRegion(counter: CounterMap): string | null {
  let bestRegion: string | null = null;
  let bestCount = -1;
  let bestPrecedence = Number.POSITIVE_INFINITY;

  for (const [region, count] of counter.entries()) {
    const precedence = BUSINESS_ACCOUNT_REGION_PRECEDENCE.indexOf(region);
    const effectivePrecedence =
      precedence >= 0 ? precedence : BUSINESS_ACCOUNT_REGION_PRECEDENCE.length;

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

function buildExactRegionLookup(): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const group of BUSINESS_ACCOUNT_REGION_MAP.groups) {
    for (const fsa of group.fsas) {
      const normalized = normalizeCanadianPostalCodeFsa(fsa);
      if (!normalized || lookup.has(normalized)) {
        continue;
      }
      lookup.set(normalized, group.region);
    }
  }

  return lookup;
}

const exactRegionLookup = buildExactRegionLookup();

export function normalizeBusinessAccountType(value: string | null | undefined): string {
  return normalizeComparable(value);
}

export function normalizeBusinessAccountStatus(value: string | null | undefined): string {
  return normalizeComparable(value);
}

export function isLikelyVendorClassId(value: string | null | undefined): boolean {
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

function isLikelyVendorType(value: string | null | undefined): boolean {
  return isLikelyVendorClassId(value);
}

export function isAllowedBusinessAccountType(input: {
  type: string | null | undefined;
  typeDescription?: string | null | undefined;
  classId?: string | null | undefined;
}): boolean {
  const normalizedType =
    normalizeBusinessAccountType(input.type) ||
    normalizeBusinessAccountType(input.typeDescription);
  if (normalizedType) {
    return (
      normalizedType === "customer" ||
      normalizedType === "businessaccount" ||
      normalizedType === "prospect"
    );
  }

  return !isLikelyVendorClassId(input.classId);
}

export function resolveBusinessAccountClassDecision(input: {
  type: string | null | undefined;
  typeDescription?: string | null | undefined;
  classId?: string | null | undefined;
  status: string | null | undefined;
}): BusinessAccountClassDecision {
  const normalizedType =
    normalizeBusinessAccountType(input.type) ||
    normalizeBusinessAccountType(input.typeDescription);
  if (normalizedType && isLikelyVendorType(normalizedType)) {
    return {
      skip: true,
      skippedReason: "vendor",
      targetClassId: null,
    };
  }

  if (!normalizedType && isLikelyVendorClassId(input.classId)) {
    return {
      skip: true,
      skippedReason: "vendor",
      targetClassId: null,
    };
  }

  const normalizedStatus = normalizeBusinessAccountStatus(input.status);
  return {
    skip: false,
    skippedReason: null,
    targetClassId:
      normalizedType === "customer" && normalizedStatus === "active"
        ? "CUSTOMER"
        : "LEAD",
  };
}

export function normalizeCanadianPostalCodeFsa(
  postalCode: string | null | undefined,
): string | null {
  const normalized = postalCode?.trim().toUpperCase().replace(/[\s-]+/g, "") ?? "";
  if (!/^[A-Z]\d[A-Z]/.test(normalized)) {
    return null;
  }

  return normalized.slice(0, 3);
}

export function resolveExactBusinessAccountRegion(
  postalCode: string | null | undefined,
): { region: string; fsa: string } | null {
  const fsa = normalizeCanadianPostalCodeFsa(postalCode);
  if (!fsa) {
    return null;
  }

  const region = exactRegionLookup.get(fsa);
  if (!region) {
    return null;
  }

  return {
    region,
    fsa,
  };
}

export function buildBusinessAccountRegionProfiles(
  records: BusinessAccountRegionResolutionInput[],
): DominantRegionProfile & { globalRegion: string } {
  const city = new Map<string, CounterMap>();
  const salesRep = new Map<string, CounterMap>();
  const global = new Map<string, number>();

  for (const record of records) {
    const exact = resolveExactBusinessAccountRegion(record.postalCode);
    if (!exact) {
      continue;
    }

    incrementCounter(global, exact.region);

    const cityKey = normalizeCityKey(record.city, record.state, record.country);
    if (cityKey) {
      const counter = city.get(cityKey) ?? new Map<string, number>();
      incrementCounter(counter, exact.region);
      city.set(cityKey, counter);
    }

    const salesRepKey = normalizeSalesRepKey(record.salesRepId, record.salesRepName);
    if (salesRepKey) {
      const counter = salesRep.get(salesRepKey) ?? new Map<string, number>();
      incrementCounter(counter, exact.region);
      salesRep.set(salesRepKey, counter);
    }
  }

  return {
    city,
    salesRep,
    global,
    globalRegion:
      chooseDominantRegion(global) ?? BUSINESS_ACCOUNT_REGION_PRECEDENCE[0] ?? "Region 6",
  };
}

export function resolveBusinessAccountRegion(
  record: BusinessAccountRegionResolutionInput,
  profiles: DominantRegionProfile & { globalRegion: string },
): BusinessAccountRegionResolution {
  const exact = resolveExactBusinessAccountRegion(record.postalCode);
  if (exact) {
    return {
      region: exact.region,
      source: "exact_fsa",
      fsa: exact.fsa,
    };
  }

  const fsa = normalizeCanadianPostalCodeFsa(record.postalCode);
  const cityKey = normalizeCityKey(record.city, record.state, record.country);
  if (cityKey) {
    const cityRegion = chooseDominantRegion(profiles.city.get(cityKey) ?? new Map());
    if (cityRegion) {
      return {
        region: cityRegion,
        source: "city_fallback",
        fsa,
      };
    }
  }

  const salesRepKey = normalizeSalesRepKey(record.salesRepId, record.salesRepName);
  if (salesRepKey) {
    const salesRepRegion = chooseDominantRegion(
      profiles.salesRep.get(salesRepKey) ?? new Map(),
    );
    if (salesRepRegion) {
      return {
        region: salesRepRegion,
        source: "sales_rep_fallback",
        fsa,
      };
    }
  }

  return {
    region: profiles.globalRegion,
    source: "global_fallback",
    fsa,
  };
}
