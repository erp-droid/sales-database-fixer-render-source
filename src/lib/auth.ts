import type { NextRequest, NextResponse } from "next/server";

import { HttpError } from "@/lib/errors";
import { getAuthCookieNameForMiddleware, getEnv } from "@/lib/env";

const COMMA_SPLIT_REGEX = /,\s*(?=[^;]+=[^;]+)/g;
const COOKIE_JAR_PREFIX = "v1.";

type CookieJar = Record<string, string>;
type ParsedSetCookieEntry = {
  name: string;
  value: string;
  remove: boolean;
};

function shouldPersistUpstreamCookie(name: string): boolean {
  const authCookieName = getAuthCookieNameForMiddleware();
  if (name === authCookieName) {
    return true;
  }

  const lower = name.toLowerCase();
  if (lower.includes("requestverificationtoken")) {
    return false;
  }

  return (
    lower === "asp.net_sessionid" ||
    lower.includes("session") ||
    lower.includes("company") ||
    lower.includes("branch") ||
    lower.includes("locale") ||
    lower.includes("culture") ||
    lower.includes("language") ||
    lower.includes("userid") ||
    lower.includes("username")
  );
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

function parseSetCookieEntries(setCookies: string[]): ParsedSetCookieEntry[] {
  const results: ParsedSetCookieEntry[] = [];

  for (const setCookie of setCookies) {
    const segments = setCookie
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    const pair = segments[0];
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    if (!shouldPersistUpstreamCookie(name)) {
      continue;
    }

    let remove = value.length === 0;

    for (let index = 1; index < segments.length; index += 1) {
      const segment = segments[index];
      const equalsIndex = segment.indexOf("=");
      const attrName =
        equalsIndex >= 0
          ? segment.slice(0, equalsIndex).trim().toLowerCase()
          : segment.toLowerCase();
      const attrValue =
        equalsIndex >= 0 ? segment.slice(equalsIndex + 1).trim() : "";

      if (attrName === "max-age") {
        const maxAge = Number(attrValue);
        if (Number.isFinite(maxAge) && maxAge <= 0) {
          remove = true;
        }
      }

      if (attrName === "expires") {
        const expiresAt = Date.parse(attrValue);
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
          remove = true;
        }
      }
    }

    results.push({ name, value, remove });
  }

  return results;
}

function parseSetCookieValues(setCookies: string[]): CookieJar {
  const entries: CookieJar = {};
  for (const entry of parseSetCookieEntries(setCookies)) {
    if (entry.remove || entry.value.length === 0) {
      continue;
    }
    entries[entry.name] = entry.value;
  }
  return entries;
}

function serializeCookieJar(cookieJar: CookieJar): string {
  return `${COOKIE_JAR_PREFIX}${toBase64Url(JSON.stringify(cookieJar))}`;
}

function deserializeCookieJar(storedValue: string): CookieJar | null {
  if (!storedValue.startsWith(COOKIE_JAR_PREFIX)) {
    return null;
  }

  const encoded = storedValue.slice(COOKIE_JAR_PREFIX.length);
  if (!encoded) {
    return null;
  }

  try {
    const decoded = JSON.parse(fromBase64Url(encoded)) as unknown;
    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    const jar = decoded as Record<string, unknown>;
    const sanitized: CookieJar = {};
    for (const [key, value] of Object.entries(jar)) {
      if (!key || typeof value !== "string" || value.length === 0) {
        continue;
      }
      if (!shouldPersistUpstreamCookie(key)) {
        continue;
      }
      sanitized[key] = value;
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  } catch {
    return null;
  }
}

function resolveCookieJar(storedValue: string): CookieJar {
  const parsed = deserializeCookieJar(storedValue);
  if (parsed) {
    return parsed;
  }

  if (storedValue.startsWith(COOKIE_JAR_PREFIX)) {
    return {};
  }

  return {
    [getAuthCookieNameForMiddleware()]: storedValue,
  };
}

export function getAuthCookieValue(request: NextRequest): string | null {
  return request.cookies.get(getAuthCookieNameForMiddleware())?.value ?? null;
}

export function requireAuthCookieValue(request: NextRequest): string {
  const cookieValue = getAuthCookieValue(request);
  if (!cookieValue) {
    throw new HttpError(401, "Not authenticated");
  }

  return cookieValue;
}

export function buildCookieHeader(cookieValue: string): string {
  const cookieJar = resolveCookieJar(cookieValue);
  return Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function getSetCookieHeaders(headers: Headers): string[] {
  const rawHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof rawHeaders.getSetCookie === "function") {
    return rawHeaders.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  if (!combined) {
    return [];
  }

  return combined.split(COMMA_SPLIT_REGEX);
}

export function extractCookieValueFromSetCookie(
  setCookies: string[],
  cookieName: string,
): string | null {
  for (const setCookie of setCookies) {
    const [pair] = setCookie.split(";");
    if (!pair) {
      continue;
    }

    const [name, ...rest] = pair.split("=");
    if (name?.trim() !== cookieName || rest.length === 0) {
      continue;
    }

    return rest.join("=").trim();
  }

  return null;
}

export function extractAuthCookieFromResponseHeaders(
  headers: Headers,
  currentCookieValue?: string,
): string | null {
  const setCookies = getSetCookieHeaders(headers);
  if (setCookies.length === 0) {
    return null;
  }

  const authCookieName = getAuthCookieNameForMiddleware();
  const incomingEntries = parseSetCookieEntries(setCookies);
  const existing = currentCookieValue ? resolveCookieJar(currentCookieValue) : {};
  const merged = { ...existing };
  for (const entry of incomingEntries) {
    if (entry.remove || entry.value.length === 0) {
      delete merged[entry.name];
      continue;
    }
    merged[entry.name] = entry.value;
  }

  if (!merged[authCookieName]) {
    return null;
  }

  return serializeCookieJar(merged);
}

export function buildStoredAuthCookieValueFromSetCookies(
  setCookies: string[],
): string | null {
  const authCookieName = getAuthCookieNameForMiddleware();
  const cookieJar = parseSetCookieValues(setCookies);
  if (!cookieJar[authCookieName]) {
    return null;
  }

  return serializeCookieJar(cookieJar);
}

export function setAuthCookie(response: NextResponse, cookieValue: string): void {
  const env = getEnv();

  response.cookies.set({
    name: env.AUTH_COOKIE_NAME,
    value: cookieValue,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.AUTH_COOKIE_SECURE,
    domain: env.AUTH_COOKIE_DOMAIN,
  });
}

export function clearAuthCookie(response: NextResponse): void {
  const env = getEnv();

  response.cookies.set({
    name: env.AUTH_COOKIE_NAME,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.AUTH_COOKIE_SECURE,
    domain: env.AUTH_COOKIE_DOMAIN,
    expires: new Date(0),
    maxAge: 0,
  });
}

export function normalizeSessionUser(payload: unknown): {
  id: string;
  name: string;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  const idCandidate =
    record.id ??
    (record.user as Record<string, unknown> | undefined)?.id ??
    (record.User as Record<string, unknown> | undefined)?.id ??
    record.employeeId;

  const nameCandidate =
    record.name ??
    (record.user as Record<string, unknown> | undefined)?.name ??
    (record.User as Record<string, unknown> | undefined)?.name ??
    record.displayName ??
    record.username;

  if (idCandidate == null && nameCandidate == null) {
    return null;
  }

  return {
    id: String(idCandidate ?? "unknown"),
    name: String(nameCandidate ?? "Authenticated user"),
  };
}
