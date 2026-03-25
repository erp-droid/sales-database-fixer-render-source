import {
  type AuthCookieRefreshState,
  type RawActivity,
  createActivity,
  fetchActivities,
  fetchContactsByBusinessAccountIds,
  fetchBusinessAccountById,
  fetchContactById,
} from "@/lib/acumatica";
import {
  buildStoredAuthCookieValueFromSetCookies,
  getSetCookieHeaders,
} from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { readStoredUserCredentials } from "@/lib/stored-user-credentials";

type ServiceCredentials = {
  loginNameKey: string;
  username: string;
  password: string;
};

const cachedCookieValues = new Map<string, string>();
const loginPromises = new Map<string, Promise<string>>();

function normalizeLoginName(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed || null;
}

function readServiceCredentials(preferredLoginName?: string | null): ServiceCredentials {
  const env = getEnv();
  const normalizedLoginName = normalizeLoginName(preferredLoginName);
  if (normalizedLoginName) {
    const stored = readStoredUserCredentials(normalizedLoginName);
    if (stored) {
      return {
        loginNameKey: normalizedLoginName,
        username: stored.username,
        password: stored.password,
      };
    }

    throw new Error(
      `No stored Acumatica credentials are available for '${normalizedLoginName}'. Sign in through the app first.`,
    );
  }

  const username = env.ACUMATICA_SERVICE_USERNAME ?? env.ACUMATICA_USERNAME;
  const password = env.ACUMATICA_SERVICE_PASSWORD ?? env.ACUMATICA_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Acumatica service credentials are not configured. Set ACUMATICA_SERVICE_USERNAME / ACUMATICA_SERVICE_PASSWORD or ACUMATICA_USERNAME / ACUMATICA_PASSWORD.",
    );
  }

  return {
    loginNameKey: "__service__",
    username,
    password,
  };
}

async function loginServiceSession(preferredLoginName?: string | null): Promise<string> {
  const credentials = readServiceCredentials(preferredLoginName);
  const cacheKey = credentials.loginNameKey;

  const existingPromise = loginPromises.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const nextPromise = (async () => {
    const env = getEnv();
    const response = await fetch(`${env.ACUMATICA_BASE_URL}/entity/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: credentials.username,
        password: credentials.password,
        company: env.ACUMATICA_COMPANY ?? "MeadowBrook Live",
        ...(env.ACUMATICA_BRANCH ? { branch: env.ACUMATICA_BRANCH } : {}),
        ...(env.ACUMATICA_LOCALE ? { locale: env.ACUMATICA_LOCALE } : {}),
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Acumatica service login failed (${response.status}): ${message || "Unknown error"}`);
    }

    const cookieValue = buildStoredAuthCookieValueFromSetCookies(
      getSetCookieHeaders(response.headers),
    );
    if (!cookieValue) {
      throw new Error("Acumatica service login did not return a reusable auth cookie.");
    }

    cachedCookieValues.set(cacheKey, cookieValue);
    return cookieValue;
  })().finally(() => {
    loginPromises.delete(cacheKey);
  });

  loginPromises.set(cacheKey, nextPromise);
  return nextPromise;
}

async function getServiceCookie(
  preferredLoginName?: string | null,
  forceRefresh = false,
): Promise<string> {
  const cacheKey = readServiceCredentials(preferredLoginName).loginNameKey;
  const cachedCookieValue = cachedCookieValues.get(cacheKey) ?? null;
  if (!forceRefresh && cachedCookieValue) {
    return cachedCookieValue;
  }

  return loginServiceSession(preferredLoginName);
}

export async function withServiceAcumaticaSession<T>(
  preferredLoginName: string | null | undefined,
  operation: (cookieValue: string, authCookieRefresh: AuthCookieRefreshState) => Promise<T>,
): Promise<T> {
  let forceRefresh = false;
  const cacheKey = readServiceCredentials(preferredLoginName).loginNameKey;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cookieValue = await getServiceCookie(preferredLoginName, forceRefresh);
    const authCookieRefresh: AuthCookieRefreshState = { value: null };

    try {
      const result = await operation(cookieValue, authCookieRefresh);
      if (authCookieRefresh.value) {
        cachedCookieValues.set(cacheKey, authCookieRefresh.value);
      }
      return result;
    } catch (error) {
      if (authCookieRefresh.value) {
        cachedCookieValues.set(cacheKey, authCookieRefresh.value);
      }

      if (error instanceof HttpError && error.status === 401 && attempt === 0) {
        cachedCookieValues.delete(cacheKey);
        forceRefresh = true;
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to establish an Acumatica service session.");
}

export async function serviceFetchContactById(
  loginName: string | null | undefined,
  contactId: number,
): Promise<Record<string, unknown>> {
  return withServiceAcumaticaSession(loginName, (cookieValue, authCookieRefresh) =>
    fetchContactById(cookieValue, contactId, authCookieRefresh),
  );
}

export async function serviceFetchBusinessAccountById(
  loginName: string | null | undefined,
  businessAccountId: string,
): Promise<Record<string, unknown>> {
  return withServiceAcumaticaSession(loginName, (cookieValue, authCookieRefresh) =>
    fetchBusinessAccountById(cookieValue, businessAccountId, authCookieRefresh),
  );
}

export async function serviceFetchContactsByBusinessAccountIds(
  loginName: string | null | undefined,
  businessAccountIds: string[],
): Promise<Array<Record<string, unknown>>> {
  return withServiceAcumaticaSession(loginName, (cookieValue, authCookieRefresh) =>
    fetchContactsByBusinessAccountIds(cookieValue, businessAccountIds, authCookieRefresh),
  );
}

export async function serviceCreateActivity(
  loginName: string | null | undefined,
  input: Parameters<typeof createActivity>[1],
): Promise<RawActivity> {
  return withServiceAcumaticaSession(loginName, (cookieValue, authCookieRefresh) =>
    createActivity(cookieValue, input, authCookieRefresh),
  );
}

export async function serviceFetchActivities(
  loginName: string | null | undefined,
  options?: Parameters<typeof fetchActivities>[1],
): Promise<RawActivity[]> {
  return withServiceAcumaticaSession(loginName, (cookieValue, authCookieRefresh) =>
    fetchActivities(cookieValue, options, authCookieRefresh),
  );
}

export function clearCachedServiceAcumaticaSession(): void {
  cachedCookieValues.clear();
  loginPromises.clear();
}

export function getServiceAcumaticaSessionError(error: unknown): string {
  return getErrorMessage(error);
}
