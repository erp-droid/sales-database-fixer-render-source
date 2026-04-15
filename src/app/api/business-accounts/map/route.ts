export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import { type AuthCookieRefreshState, fetchBusinessAccounts } from "@/lib/acumatica";
import {
  filterSuppressedBusinessAccountRows,
  normalizeBusinessAccount,
} from "@/lib/business-accounts";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";
import { isExcludedInternalCompanyName } from "@/lib/internal-records";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { registerReadModelCacheClearer } from "@/lib/read-model/cache";
import { buildAddressKeyFromRow, readReadyGeocodeMap } from "@/lib/read-model/geocodes";
import { maybeTriggerReadModelSync } from "@/lib/read-model/sync";
import type {
  BusinessAccountMapPoint,
  BusinessAccountRow,
  BusinessAccountMapResponse,
} from "@/types/business-account";

const mapGeocodeCache = new Map<string, GeocodeResult | null>();
const mapPayloadCache = new Map<
  string,
  { payload: BusinessAccountMapResponse; createdAt: number }
>();
const mapPayloadInFlight = new Map<string, Promise<BusinessAccountMapResponse>>();
const MAP_PAYLOAD_CACHE_TTL_MS = 10 * 60 * 1000;

registerReadModelCacheClearer(() => {
  mapPayloadCache.clear();
  mapPayloadInFlight.clear();
});

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function buildSalesRepFilterKey(
  salesRepId: string | null | undefined,
  salesRepName: string | null | undefined,
): string {
  if (hasText(salesRepId)) {
    return `id:${normalizeText(salesRepId)}`;
  }

  if (hasText(salesRepName)) {
    return `name:${normalizeText(salesRepName)}`;
  }

  return "unassigned";
}

function matchesSalesRepFilters(
  salesRepId: string | null | undefined,
  salesRepName: string | null | undefined,
  normalizedSalesRepFilters: Set<string>,
): boolean {
  if (normalizedSalesRepFilters.size === 0) {
    return true;
  }

  return normalizedSalesRepFilters.has(buildSalesRepFilterKey(salesRepId, salesRepName));
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

function readBusinessAccountName(record: unknown): string | null {
  return (
    readWrappedString(record, "Name") ??
    readWrappedString(record, "CompanyName") ??
    readWrappedString(record, "AcctName") ??
    readWrappedString(record, "BusinessAccountName")
  );
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

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readRowAccountKey(row: BusinessAccountRow): string {
  return (
    row.accountRecordId?.trim() ||
    row.id.trim() ||
    row.businessAccountId.trim() ||
    row.companyName.trim()
  );
}

function buildContactsFromRows(rows: BusinessAccountRow[]) {
  return rows
    .map((row, index) => ({
      rowKey: row.rowKey ?? `${readRowAccountKey(row)}:contact:${row.contactId ?? index}`,
      contactId: row.contactId ?? null,
      name: row.primaryContactName,
      phone: row.primaryContactPhone,
      extension: row.primaryContactExtension ?? null,
      email: row.primaryContactEmail,
      isPrimary: Boolean(row.isPrimaryContact),
      notes: row.notes ?? null,
    }))
    .filter(
      (contact) =>
        hasText(contact.name) ||
        hasText(contact.phone) ||
        hasText(contact.extension) ||
        hasText(contact.email),
    )
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }

      return (left.name ?? "").localeCompare(right.name ?? "", undefined, {
        sensitivity: "base",
      });
    });
}

function pickRepresentativeRow(rows: BusinessAccountRow[]): BusinessAccountRow {
  return rows.find((row) => hasText(row.addressLine1) && hasText(row.city)) ?? rows[0];
}

function pickSalesRepRow(rows: BusinessAccountRow[]): BusinessAccountRow {
  return rows.find((row) => hasText(row.salesRepId) || hasText(row.salesRepName)) ?? rows[0];
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
    const normalizedSalesRepFilters = new Set(
      request.nextUrl.searchParams
        .getAll("salesRep")
        .map((value) => normalizeText(value))
        .filter(Boolean),
    );
    const syncedAt = request.nextUrl.searchParams.get("syncedAt")?.trim() ?? "";
    const normalizedSearch = normalizeText(q);
    const salesRepCacheToken = [...normalizedSalesRepFilters].sort().join(",");
    const cacheKey = `all|${normalizedSearch}|${salesRepCacheToken}|${syncedAt}`;

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
          if (getEnv().READ_MODEL_ENABLED) {
            maybeTriggerReadModelSync(cookieValue, authCookieRefresh);
            const grouped = new Map<string, BusinessAccountRow[]>();
            filterSuppressedBusinessAccountRows(readAllAccountRowsFromReadModel()).forEach((row) => {
              const key = readRowAccountKey(row);
              if (!key) {
                return;
              }
              const existing = grouped.get(key);
              if (existing) {
                existing.push(row);
              } else {
                grouped.set(key, [row]);
              }
            });

            const candidates = [...grouped.entries()]
              .map(([accountKey, rows]) => {
                const representativeRow = pickRepresentativeRow(rows);
                const salesRepRow = pickSalesRepRow(rows);
                const contacts = buildContactsFromRows(rows);
                const haystack = [
                  representativeRow.companyName,
                  representativeRow.businessAccountId,
                  salesRepRow.salesRepName,
                  representativeRow.address,
                  contacts
                    .map((contact) =>
                      [contact.name, contact.email, contact.phone, contact.extension]
                        .filter(Boolean)
                        .join(" "),
                    )
                    .join(" "),
                ]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase();

                return {
                  accountKey,
                  representativeRow,
                  salesRepRow,
                  contacts,
                  haystack,
                };
              })
              .filter((candidate) =>
                normalizedSearch ? candidate.haystack.includes(normalizedSearch) : true,
              )
              .filter((candidate) =>
                matchesSalesRepFilters(
                  candidate.salesRepRow.salesRepId,
                  candidate.salesRepRow.salesRepName,
                  normalizedSalesRepFilters,
                ),
              )
              .filter((candidate) =>
                Boolean(
                  candidate.representativeRow.id &&
                    candidate.representativeRow.addressLine1 &&
                    candidate.representativeRow.city,
                ),
              );
            const geocodeMap = readReadyGeocodeMap(
              candidates.map((candidate) => buildAddressKeyFromRow(candidate.representativeRow)),
            );
            const items = candidates.flatMap((candidate) => {
              const row = candidate.representativeRow;
              const geocode = geocodeMap.get(buildAddressKeyFromRow(row));
              if (!geocode) {
                return [];
              }

              const point: BusinessAccountMapPoint = {
                id: row.id,
                accountRecordId: row.accountRecordId,
                businessAccountId: row.businessAccountId,
                companyName: row.companyName,
                salesRepId: candidate.salesRepRow.salesRepId,
                salesRepName: candidate.salesRepRow.salesRepName,
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
                primaryContactExtension: row.primaryContactExtension ?? null,
                primaryContactEmail: row.primaryContactEmail,
                category: row.category,
                notes: row.notes,
                lastModifiedIso: row.lastModifiedIso,
                latitude: geocode.latitude,
                longitude: geocode.longitude,
                geocodeProvider: geocode.provider,
                contacts: candidate.contacts,
              };

              return [point];
            });

            return {
              items,
              totalCandidates: candidates.length,
              geocodedCount: items.length,
              unmappedCount: Math.max(0, candidates.length - items.length),
            };
          }

          const rawAccounts = await fetchBusinessAccounts(
            cookieValue,
            {
              batchSize: 150,
              ensureMainAddress: true,
              ensurePrimaryContact: true,
              ensureAttributes: true,
              ensureContacts: true,
            },
            authCookieRefresh,
          );

          const normalizedRows = filterSuppressedBusinessAccountRows(
            rawAccounts
              .filter(
                (account) =>
                  isAllowedBusinessAccountType(account) &&
                  !isExcludedInternalCompanyName(readBusinessAccountName(account)),
              )
              .map((item) => normalizeBusinessAccount(item))
              .filter((row) => Boolean(row.id && row.addressLine1 && row.city)),
          );

          const filteredRows = normalizedSearch
            ? normalizedRows.filter((row) =>
                [
                  row.companyName,
                  row.businessAccountId,
                  row.salesRepName,
                  row.address,
                  row.primaryContactName,
                  row.primaryContactExtension,
                  row.primaryContactEmail,
                ]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase()
                  .includes(normalizedSearch),
              )
            : normalizedRows;

          const salesRepFilteredRows = filteredRows.filter((row) =>
            matchesSalesRepFilters(
              row.salesRepId,
              row.salesRepName,
              normalizedSalesRepFilters,
            ),
          );

          const candidates = salesRepFilteredRows;
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
              salesRepId: row.salesRepId,
              salesRepName: row.salesRepName,
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
              primaryContactExtension: row.primaryContactExtension ?? null,
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
              `[map] q="${normalizedSearch}" salesRep="${salesRepCacheToken}" scope=all candidates=${nextPayload.totalCandidates} mapped=${nextPayload.geocodedCount} unmapped=${nextPayload.unmappedCount}`,
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
