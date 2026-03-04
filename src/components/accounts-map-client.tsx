"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type {
  BusinessAccountMapPoint,
  BusinessAccountMapResponse,
  Category,
} from "@/types/business-account";

import styles from "./accounts-map-client.module.css";

type LeafletModule = typeof import("leaflet");

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
};

const DEFAULT_CENTER: [number, number] = [43.6532, -79.3832];
const DEFAULT_LIMIT = 40;
const DATASET_STORAGE_KEYS = [
  "businessAccounts.dataset.v3",
  "businessAccounts.dataset.v2",
  "businessAccounts.dataset.v1",
] as const;
const MAP_CACHE_STORAGE_KEY = "businessAccounts.mapCache.v3";

type CachedDataset = {
  lastSyncedAt?: string | null;
};

type CachedMapResponse = {
  cacheKey: string;
  payload: BusinessAccountMapResponse;
};

function parseError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const value = (payload as Record<string, unknown>).error;
  return typeof value === "string" && value.trim() ? value : "Request failed.";
}

function renderText(value: string | null): string {
  if (!value || !value.trim()) {
    return "-";
  }
  return value;
}

function formatLastModified(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function markerColor(category: Category | null): string {
  switch (category) {
    case "A":
      return "#0f9d58";
    case "B":
      return "#f4b400";
    case "C":
      return "#db4437";
    case "D":
      return "#7e57c2";
    default:
      return "#1e88e5";
  }
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function isMapResponse(payload: unknown): payload is BusinessAccountMapResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    Array.isArray(record.items) &&
    typeof record.totalCandidates === "number" &&
    typeof record.geocodedCount === "number" &&
    typeof record.unmappedCount === "number"
  );
}

function readDatasetSyncStamp(): string | null {
  for (const key of DATASET_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw) as CachedDataset;
      if (typeof parsed.lastSyncedAt === "string") {
        return parsed.lastSyncedAt;
      }
      if (parsed.lastSyncedAt === null) {
        return null;
      }
    } catch {
      // Ignore malformed cache.
    }
  }

  return null;
}

function readMapCache(expectedCacheKey: string): BusinessAccountMapResponse | null {
  try {
    const raw = window.localStorage.getItem(MAP_CACHE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedMapResponse;
    if (parsed.cacheKey !== expectedCacheKey) {
      return null;
    }
    if (!isMapResponse(parsed.payload)) {
      return null;
    }

    if (parsed.payload.totalCandidates > 0 && parsed.payload.geocodedCount === 0) {
      return null;
    }

    return parsed.payload;
  } catch {
    return null;
  }
}

function writeMapCache(cacheKey: string, payload: BusinessAccountMapResponse) {
  if (payload.totalCandidates > 0 && payload.geocodedCount === 0) {
    return;
  }

  try {
    const next: CachedMapResponse = {
      cacheKey,
      payload,
    };
    window.localStorage.setItem(MAP_CACHE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
}

export function AccountsMapClient() {
  const router = useRouter();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [q, setQ] = useState("");
  const [points, setPoints] = useState<BusinessAccountMapPoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [geocodedCount, setGeocodedCount] = useState(0);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);

  const selectedPoint = useMemo(
    () => points.find((point) => point.id === selectedId) ?? points[0] ?? null,
    [points, selectedId],
  );

  useEffect(() => {
    async function fetchSession() {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const payload = await readJsonResponse<SessionResponse | { error?: string }>(response);

      if (payload && "authenticated" in payload) {
        if (payload.authenticated) {
          setSession(payload);
          return;
        }

        setSession({ authenticated: true, user: null });
        setError(
          "Unable to validate your Acumatica session right now. Your cookie is still present; try refreshing map data.",
        );
        return;
      }

      setSession({ authenticated: true, user: null });
      setError(
        "Session check is temporarily unavailable. Continuing with your existing session.",
      );
    }

    fetchSession().catch(() => {
      setSession({ authenticated: true, user: null });
      setError(
        "Session check is temporarily unavailable. Continuing with your existing session.",
      );
    });
  }, [router]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const controller = new AbortController();

    async function fetchMapData() {
      setLoading(true);
      setError(null);

      try {
        const normalizedQuery = q.trim().toLowerCase();
        const lastSyncedAt = readDatasetSyncStamp() ?? "unsynced";
        const cacheKey = `${lastSyncedAt}|${DEFAULT_LIMIT}|${normalizedQuery}`;
        const cached = readMapCache(cacheKey);
        if (cached) {
          setPoints(cached.items);
          setTotalCandidates(cached.totalCandidates);
          setGeocodedCount(cached.geocodedCount);
          setUnmappedCount(cached.unmappedCount);
          setSelectedId((current) =>
            cached.items.some((item) => item.id === current)
              ? current
              : cached.items[0]?.id ?? null,
          );
          return;
        }

        const params = new URLSearchParams({
          limit: String(DEFAULT_LIMIT),
        });
        const syncedAt = readDatasetSyncStamp();
        if (syncedAt) {
          params.set("syncedAt", syncedAt);
        }
        if (q.trim()) {
          params.set("q", q.trim());
        }

        const response = await fetch(`/api/business-accounts/map?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = await readJsonResponse<BusinessAccountMapResponse | { error?: string }>(
          response,
        );

        if (response.status === 401) {
          setError(
            "Acumatica rejected this map request. Keeping your session; try again in a moment.",
          );
          return;
        }

        if (!response.ok) {
          throw new Error(parseError(payload));
        }

        if (!isMapResponse(payload)) {
          throw new Error("Unexpected response while loading map data.");
        }

        setPoints(payload.items);
        setTotalCandidates(payload.totalCandidates);
        setGeocodedCount(payload.geocodedCount);
        setUnmappedCount(payload.unmappedCount);
        writeMapCache(cacheKey, payload);
        setSelectedId((current) =>
          payload.items.some((item) => item.id === current) ? current : payload.items[0]?.id ?? null,
        );
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }

        setPoints([]);
        setSelectedId(null);
        setTotalCandidates(0);
        setGeocodedCount(0);
        setUnmappedCount(0);
        setError(requestError instanceof Error ? requestError.message : "Failed to load map data.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    const timeout = setTimeout(() => {
      void fetchMapData();
    }, 180);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [q, router, session]);

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      if (mapRef.current || !mapContainerRef.current) {
        return;
      }

      const L = await import("leaflet");
      if (cancelled || !mapContainerRef.current || mapRef.current) {
        return;
      }

      leafletRef.current = L;
      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 6,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const markerLayer = L.layerGroup().addTo(map);
      mapRef.current = map;
      markersLayerRef.current = markerLayer;
      setTimeout(() => map.invalidateSize(), 100);
    }

    void initializeMap();

    return () => {
      cancelled = true;
      markersLayerRef.current?.clearLayers();
      mapRef.current?.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const markerLayer = markersLayerRef.current;
    if (!L || !map || !markerLayer) {
      return;
    }

    markerLayer.clearLayers();

    if (points.length === 0) {
      map.setView(DEFAULT_CENTER, 6);
      return;
    }

    const bounds = L.latLngBounds([]);

    for (const point of points) {
      const isSelected = selectedPoint?.id === point.id;
      const circle = L.circleMarker([point.latitude, point.longitude], {
        radius: isSelected ? 10 : 8,
        color: "#ffffff",
        weight: 2,
        fillColor: markerColor(point.category),
        fillOpacity: 0.94,
      });

      circle.bindTooltip(point.companyName || point.businessAccountId, {
        direction: "top",
        offset: [0, -8],
      });
      circle.on("click", () => {
        setSelectedId(point.id);
      });
      circle.addTo(markerLayer);

      bounds.extend([point.latitude, point.longitude]);
    }

    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 12);
    } else {
      map.fitBounds(bounds.pad(0.18));
    }
  }, [points, selectedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPoint) {
      return;
    }

    const nextZoom = Math.max(map.getZoom(), 11);
    map.flyTo([selectedPoint.latitude, selectedPoint.longitude], nextZoom, {
      duration: 0.5,
    });
  }, [selectedPoint]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/signin");
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Image alt="MeadowBrook" className={styles.brandLogo} height={202} priority src="/mb-logo.png" width={712} />
          <div>
            <p className={styles.kicker}>Business Accounts Map</p>
            <h1 className={styles.title}>Contacts Location View</h1>
          </div>
        </div>
        <div className={styles.actions}>
          <input
            className={styles.searchInput}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search company, contact, address"
            value={q}
          />
          <Link className={styles.navButton} href="/accounts">
            Back To Accounts
          </Link>
          <button className={styles.navButton} onClick={handleLogout} type="button">
            Sign out
          </button>
          <span className={styles.userName}>{session?.user?.name ?? "Signed in"}</span>
        </div>
      </header>

      <section className={styles.mapShell}>
        <div className={styles.mapCanvas} ref={mapContainerRef} />

        <aside className={styles.infoPanel}>
          <div className={styles.stats}>
            <span>Candidates: {totalCandidates}</span>
            <span>Mapped: {geocodedCount}</span>
            <span>Unmapped: {unmappedCount}</span>
          </div>

          {loading ? <p className={styles.loadingText}>Loading map data...</p> : null}
          {error ? <p className={styles.errorText}>{error}</p> : null}

          {!loading && !error && !selectedPoint ? (
            <p className={styles.loadingText}>No mapped contacts found for this filter.</p>
          ) : null}

          {selectedPoint ? (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>{selectedPoint.companyName || selectedPoint.businessAccountId}</h2>
              </div>

              <dl className={styles.details}>
                <div>
                  <dt>Full Address</dt>
                  <dd>{renderText(selectedPoint.fullAddress)}</dd>
                </div>
                <div>
                  <dt>Primary Contact</dt>
                  <dd>{renderText(selectedPoint.primaryContactName)}</dd>
                </div>
                <div>
                  <dt>Contact Phone</dt>
                  <dd>{renderText(selectedPoint.primaryContactPhone)}</dd>
                </div>
                <div>
                  <dt>Contact Email</dt>
                  <dd>{renderText(selectedPoint.primaryContactEmail)}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{renderText(selectedPoint.category)}</dd>
                </div>
                <div>
                  <dt>Business Account ID</dt>
                  <dd>{renderText(selectedPoint.businessAccountId)}</dd>
                </div>
                <div>
                  <dt>Coordinates</dt>
                  <dd>
                    {selectedPoint.latitude.toFixed(6)}, {selectedPoint.longitude.toFixed(6)}
                  </dd>
                </div>
                <div>
                  <dt>Geocode Source</dt>
                  <dd>{selectedPoint.geocodeProvider}</dd>
                </div>
                <div>
                  <dt>Last Modified</dt>
                  <dd>{formatLastModified(selectedPoint.lastModifiedIso)}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>{renderText(selectedPoint.notes)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
