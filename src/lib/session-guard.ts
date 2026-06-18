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

export async function fetchSessionCheckOutcome(
  fetchImpl: typeof fetch,
): Promise<SessionCheckOutcome> {
  const response = await fetchImpl("/api/auth/session", { cache: "no-store" });
  const payload = (await response.clone().json().catch(() => null)) as SessionPayload;

  return resolveSessionCheckOutcome(response.status, payload);
}
