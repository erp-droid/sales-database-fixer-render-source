import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { type AuthCookieRefreshState, fetchBusinessAccounts } from "@/lib/acumatica";
import { normalizeBusinessAccount } from "@/lib/business-accounts";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";
import type {
  BusinessAccountMapPoint,
  BusinessAccountMapResponse,
} from "@/types/business-account";

const mapGeocodeCache = new Map<string, GeocodeResult | null>();
const mapPayloadCache = new Map<
  string,
  { payload: BusinessAccountMapResponse; createdAt: number }
>();
const mapPayloadInFlight = new Map<string, Promise<BusinessAccountMapResponse>>();
const MAP_PAYLOAD_CACHE_TTL_MS = 10 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAccountType(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const wrappedValue = (value as Record<string, unknown>).value;
  if (typeof wrappedValue !== "string") {
    return "";
  }

  return wrappedValue
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isLikelyVendorClassId(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  return (
    normalized.includes("vendor") ||
    normalized.includes("supplier") ||
    normalized.includes("suppl") ||
    normalized.startsWith("ven")
  );
}

function isAllowedBusinessAccountType(record: unknown): boolean {
  if (!record || typeof record !== "object") {
    return false;
  }

  const typeField = (record as Record<string, unknown>).Type;
  const normalizedType =
    normalizeAccountType(typeField) ||
    normalizeAccountType((record as Record<string, unknown>).TypeDescription);
  if (normalizedType) {
    return normalizedType === "customer" || normalizedType === "businessaccount";
  }

  const classId =
    readWrappedString(record, "ClassID") ??
    readWrappedString(record, "BusinessAccountClass");
  if (isLikelyVendorClassId(classId)) {
    return false;
  }

  return true;
}

function buildAddressKey(parts: {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}): string {
  return [
    parts.addressLine1,
    parts.addressLine2,
    parts.city,
    parts.state,
    parts.postalCode,
    parts.country,
  ]
    .map((part) => normalizeText(part))
    .join("|");
}

function toFullAddress(parts: {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}): string {
  const street = [parts.addressLine1, parts.addressLine2].filter(Boolean).join(" ");
  const cityLine = [parts.city, parts.state, parts.postalCode].filter(Boolean).join(" ");
  return [street, cityLine, parts.country].filter(Boolean).join(", ");
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const cookieValue = requireAuthCookieValue(request);
    const authCookieRefresh: AuthCookieRefreshState = { value: null };

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const syncedAt = request.nextUrl.searchParams.get("syncedAt")?.trim() ?? "";
    const normalizedSearch = normalizeText(q);
    const limit = clamp(
      Number(request.nextUrl.searchParams.get("limit") ?? "600"),
      1,
      5000,
    );
    const cacheKey = `${limit}|${normalizedSearch}|${syncedAt}`;

    const cachedPayload = mapPayloadCache.get(cacheKey);
    if (cachedPayload && Date.now() - cachedPayload.createdAt <= MAP_PAYLOAD_CACHE_TTL_MS) {
      const cachedResponse = NextResponse.json(cachedPayload.payload);
      if (authCookieRefresh.value) {
        setAuthCookie(cachedResponse, authCookieRefresh.value);
      }
      return cachedResponse;
    }

    const inFlight = mapPayloadInFlight.get(cacheKey);
    const payloadPromise =
      inFlight ??
      (async (): Promise<BusinessAccountMapResponse> => {
        try {
          const rawAccounts = await fetchBusinessAccounts(
            cookieValue,
            {
              maxRecords: Math.max(limit, Math.min(limit * 4, 10000)),
              batchSize: 150,
              ensureMainAddress: true,
              ensurePrimaryContact: true,
              ensureAttributes: true,
              ensureContacts: true,
            },
            authCookieRefresh,
          );

          const normalizedRows = rawAccounts
            .filter((account) => isAllowedBusinessAccountType(account))
            .map((item) => normalizeBusinessAccount(item))
            .filter((row) => Boolean(row.id && row.addressLine1 && row.city));

          const filteredRows = normalizedSearch
            ? normalizedRows.filter((row) =>
                [
                  row.companyName,
                  row.businessAccountId,
                  row.address,
                  row.primaryContactName,
                  row.primaryContactEmail,
                ]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase()
                  .includes(normalizedSearch),
              )
            : normalizedRows;

          const candidates = filteredRows.slice(0, limit);
          const pointsOrNull = await mapLimit(candidates, 10, async (row) => {
            const key = buildAddressKey(row);
            let geocode = mapGeocodeCache.get(key);

            if (geocode === undefined) {
              geocode = await geocodeAddress({
                addressLine1: row.addressLine1,
                addressLine2: row.addressLine2,
                city: row.city,
                state: row.state,
                postalCode: row.postalCode,
                country: row.country,
              });
              if (geocode) {
                mapGeocodeCache.set(key, geocode);
              }
            }

            if (!geocode) {
              return null;
            }

            const point: BusinessAccountMapPoint = {
              id: row.id,
              businessAccountId: row.businessAccountId,
              companyName: row.companyName,
              fullAddress:
                row.address ||
                toFullAddress({
                  addressLine1: row.addressLine1,
                  addressLine2: row.addressLine2,
                  city: row.city,
                  state: row.state,
                  postalCode: row.postalCode,
                  country: row.country,
                }),
              addressLine1: row.addressLine1,
              addressLine2: row.addressLine2,
              city: row.city,
              state: row.state,
              postalCode: row.postalCode,
              country: row.country,
              primaryContactName: row.primaryContactName,
              primaryContactPhone: row.primaryContactPhone,
              primaryContactEmail: row.primaryContactEmail,
              category: row.category,
              notes: row.notes,
              lastModifiedIso: row.lastModifiedIso,
              latitude: geocode.latitude,
              longitude: geocode.longitude,
              geocodeProvider: geocode.provider,
            };

            return point;
          });

          const items = pointsOrNull.filter(
            (item): item is BusinessAccountMapPoint => Boolean(item),
          );

          const nextPayload: BusinessAccountMapResponse = {
            items,
            totalCandidates: candidates.length,
            geocodedCount: items.length,
            unmappedCount: candidates.length - items.length,
          };
          if (process.env.NODE_ENV !== "production") {
            console.info(
              `[map] q="${normalizedSearch}" limit=${limit} candidates=${nextPayload.totalCandidates} mapped=${nextPayload.geocodedCount} unmapped=${nextPayload.unmappedCount}`,
            );
          }
          mapPayloadCache.set(cacheKey, {
            payload: nextPayload,
            createdAt: Date.now(),
          });
          return nextPayload;
        } finally {
          mapPayloadInFlight.delete(cacheKey);
        }
      })();

    if (!inFlight) {
      mapPayloadInFlight.set(cacheKey, payloadPromise);
    }

    const payload = await payloadPromise;

    const response = NextResponse.json(payload);
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
