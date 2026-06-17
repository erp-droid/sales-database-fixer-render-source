export type SessionPayload =
  | {
      authenticated?: boolean;
      degraded?: boolean;
    }
  | {
      error?: string;
    }
  | null;

export type SessionCheckOutcome =
  | "authenticated"
  | "unauthenticated"
  | "indeterminate";

const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/health",
  "/api/healthz",
  "/api/calendar/oauth/",
  "/api/mail/oauth/",
] as const;

export function resolveSessionCheckOutcome(
  responseStatus: number,
  payload: SessionPayload,
): SessionCheckOutcome {
  if (responseStatus === 401) {
    return "unauthenticated";
  }

  if (payload && "authenticated" in payload) {
    return payload.authenticated === false
      ? "unauthenticated"
      : "authenticated";
  }

  return "indeterminate";
}

function normalizeApiPath(requestPath: string | null): string | null {
  const trimmed = requestPath?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed, "https://sales-meadowb.local").pathname;
  } catch {
    return trimmed.startsWith("/") ? trimmed.split("?")[0] ?? trimmed : null;
  }
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix);
}

function readApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim() : null;
}

function isAppAuthErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized === "not authenticated" ||
    normalized === "not authenticated." ||
    normalized.includes("signed-in username is unavailable")
  );
}

export function shouldForceLogoutForApiResponse(
  requestPath: string | null,
  responseStatus: number,
  payload?: unknown,
): boolean {
  if (responseStatus !== 401) {
    return false;
  }

  const path = normalizeApiPath(requestPath);
  if (!path?.startsWith("/api/")) {
    return false;
  }

  if (PUBLIC_API_PREFIXES.some((prefix) => pathMatchesPrefix(path, prefix))) {
    return false;
  }

  const errorMessage = readApiErrorMessage(payload);
  if (errorMessage) {
    return isAppAuthErrorMessage(errorMessage);
  }

  return false;
}

export async function fetchSessionCheckOutcome(
  fetchImpl: typeof fetch,
): Promise<SessionCheckOutcome> {
  const response = await fetchImpl("/api/auth/session", { cache: "no-store" });
  const payload = (await response.clone().json().catch(() => null)) as SessionPayload;

  return resolveSessionCheckOutcome(response.status, payload);
}
