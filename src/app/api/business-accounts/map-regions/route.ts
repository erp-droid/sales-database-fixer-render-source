import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage, HttpError } from "@/lib/errors";
import type {
  PostalRegion,
  PostalRegionsResponse,
} from "@/types/business-account";

type RegionStyle = {
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
};

const LOCAL_KML_FILE = "MB - Regular Clients.kml";
const DEFAULT_REMOTE_KML_URL =
  "https://www.google.com/maps/d/u/0/kml?forcekml=1&mid=1ijOeKjJnUIqNyAkLMVVeGyt6YHf_8As";
const CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_STYLE: RegionStyle = {
  strokeColor: "#0D47A1",
  strokeOpacity: 0.9,
  strokeWidth: 1,
  fillColor: "#42A5F5",
  fillOpacity: 0.25,
};

let cachedResponse: { createdAt: number; payload: PostalRegionsResponse } | null = null;
let inFlightRequest: Promise<PostalRegionsResponse> | null = null;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripCdata(value: string): string {
  const match = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (!match) {
    return value;
  }
  return match[1];
}

function readFirstTag(block: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = block.match(regex);
  if (!match) {
    return null;
  }

  const raw = stripCdata(match[1].trim());
  return raw ? decodeXml(raw) : null;
}

function kmlColorToHexAndOpacity(
  input: string | null,
): { hex: string; opacity: number } | null {
  if (!input) {
    return null;
  }

  const normalized = input.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$|^[0-9a-f]{8}$/.test(normalized)) {
    return null;
  }

  if (normalized.length === 6) {
    return {
      hex: `#${normalized.toUpperCase()}`,
      opacity: 1,
    };
  }

  const alpha = normalized.slice(0, 2);
  const blue = normalized.slice(2, 4);
  const green = normalized.slice(4, 6);
  const red = normalized.slice(6, 8);
  return {
    hex: `#${red}${green}${blue}`.toUpperCase(),
    opacity: clamp(parseInt(alpha, 16) / 255, 0, 1),
  };
}

function parseStyles(kml: string): {
  styles: Map<string, RegionStyle>;
  styleMapRefs: Map<string, string>;
} {
  const styles = new Map<string, RegionStyle>();
  const styleMapRefs = new Map<string, string>();

  const styleRegex = /<Style\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/gi;
  let styleMatch: RegExpExecArray | null = null;
  while ((styleMatch = styleRegex.exec(kml)) !== null) {
    const id = styleMatch[1];
    const body = styleMatch[2];
    const lineStyle = readFirstTag(body, "LineStyle");
    const polyStyle = readFirstTag(body, "PolyStyle");

    const lineColor = kmlColorToHexAndOpacity(readFirstTag(lineStyle ?? "", "color"));
    const polyColor = kmlColorToHexAndOpacity(readFirstTag(polyStyle ?? "", "color"));
    const widthValue = Number(readFirstTag(lineStyle ?? "", "width") ?? "1");

    styles.set(id, {
      strokeColor: lineColor?.hex ?? DEFAULT_STYLE.strokeColor,
      strokeOpacity: lineColor?.opacity ?? DEFAULT_STYLE.strokeOpacity,
      strokeWidth: clamp(widthValue, 0.5, 8),
      fillColor: polyColor?.hex ?? DEFAULT_STYLE.fillColor,
      fillOpacity: polyColor?.opacity ?? DEFAULT_STYLE.fillOpacity,
    });
  }

  const styleMapRegex = /<StyleMap\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/StyleMap>/gi;
  let styleMapMatch: RegExpExecArray | null = null;
  while ((styleMapMatch = styleMapRegex.exec(kml)) !== null) {
    const id = styleMapMatch[1];
    const body = styleMapMatch[2];
    const pairRegex = /<Pair\b[^>]*>([\s\S]*?)<\/Pair>/gi;
    let pairMatch: RegExpExecArray | null = null;

    let fallbackStyleRef: string | null = null;
    while ((pairMatch = pairRegex.exec(body)) !== null) {
      const pairBody = pairMatch[1];
      const key = (readFirstTag(pairBody, "key") ?? "").trim().toLowerCase();
      const styleUrl = readFirstTag(pairBody, "styleUrl");
      if (!styleUrl) {
        continue;
      }

      const normalizedRef = styleUrl.replace(/^#/, "").trim();
      if (!normalizedRef) {
        continue;
      }

      if (!fallbackStyleRef) {
        fallbackStyleRef = normalizedRef;
      }
      if (key === "normal") {
        styleMapRefs.set(id, normalizedRef);
      }
    }

    if (!styleMapRefs.has(id) && fallbackStyleRef) {
      styleMapRefs.set(id, fallbackStyleRef);
    }
  }

  return { styles, styleMapRefs };
}

function parseCoordinateRing(rawCoordinates: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const tokens = rawCoordinates
    .trim()
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const [longitude, latitude] = token.split(",", 3);
    const lng = Number(longitude);
    const lat = Number(latitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    points.push([lat, lng]);
  }

  return points;
}

function parsePostalRegions(kml: string): PostalRegion[] {
  const { styles, styleMapRefs } = parseStyles(kml);
  const items: PostalRegion[] = [];

  const placemarkRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let placemarkMatch: RegExpExecArray | null = null;
  let index = 0;

  while ((placemarkMatch = placemarkRegex.exec(kml)) !== null) {
    const body = placemarkMatch[1];
    const name = readFirstTag(body, "name") ?? `Region ${index + 1}`;
    const rawStyleRef = readFirstTag(body, "styleUrl");
    const styleRef = rawStyleRef ? rawStyleRef.replace(/^#/, "").trim() : null;
    const resolvedStyleId =
      styleRef && styleMapRefs.has(styleRef) ? styleMapRefs.get(styleRef)! : styleRef;
    const resolvedStyle = resolvedStyleId ? styles.get(resolvedStyleId) : undefined;

    const polygons: Array<Array<[number, number]>> = [];
    const coordinatesRegex = /<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/gi;
    let coordinatesMatch: RegExpExecArray | null = null;
    while ((coordinatesMatch = coordinatesRegex.exec(body)) !== null) {
      const ring = parseCoordinateRing(coordinatesMatch[1]);
      if (ring.length >= 3) {
        polygons.push(ring);
      }
    }

    if (polygons.length === 0) {
      continue;
    }

    items.push({
      id: `${name}-${index + 1}`,
      name,
      styleId: resolvedStyleId ?? styleRef,
      strokeColor: resolvedStyle?.strokeColor ?? DEFAULT_STYLE.strokeColor,
      strokeOpacity: resolvedStyle?.strokeOpacity ?? DEFAULT_STYLE.strokeOpacity,
      strokeWidth: resolvedStyle?.strokeWidth ?? DEFAULT_STYLE.strokeWidth,
      fillColor: resolvedStyle?.fillColor ?? DEFAULT_STYLE.fillColor,
      fillOpacity: resolvedStyle?.fillOpacity ?? DEFAULT_STYLE.fillOpacity,
      polygons,
    });
    index += 1;
  }

  return items;
}

async function resolveSourceKmlUrl(): Promise<string> {
  const localPath = path.join(process.cwd(), LOCAL_KML_FILE);
  const localKml = await readFile(localPath, "utf8");
  const href = readFirstTag(localKml, "href");
  if (!href || !/^https?:\/\//i.test(href)) {
    return DEFAULT_REMOTE_KML_URL;
  }

  return href;
}

async function loadPostalRegions(): Promise<PostalRegionsResponse> {
  const sourceUrl = await resolveSourceKmlUrl();
  const remoteResponse = await fetch(sourceUrl, { cache: "no-store" });
  if (!remoteResponse.ok) {
    throw new Error(`Failed to fetch postal-region KML (${remoteResponse.status})`);
  }

  const kml = await remoteResponse.text();
  const items = parsePostalRegions(kml);

  return {
    items,
    total: items.length,
    sourceUrl,
    generatedAtIso: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);

    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const now = Date.now();
    if (!refresh && cachedResponse && now - cachedResponse.createdAt <= CACHE_TTL_MS) {
      return NextResponse.json(cachedResponse.payload);
    }

    const payloadPromise = inFlightRequest ?? loadPostalRegions();
    if (!inFlightRequest) {
      inFlightRequest = payloadPromise;
    }

    const payload = await payloadPromise;
    cachedResponse = {
      createdAt: Date.now(),
      payload,
    };
    inFlightRequest = null;
    return NextResponse.json(payload);
  } catch (error) {
    inFlightRequest = null;
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
