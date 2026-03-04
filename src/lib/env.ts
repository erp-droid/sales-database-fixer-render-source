import { z } from "zod";

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const schema = z.object({
  AUTH_PROVIDER: z.enum(["acumatica", "custom"]).default("acumatica"),
  AUTH_LOGIN_URL: z.string().url().optional(),
  AUTH_ME_URL: z.string().url().optional(),
  AUTH_LOGOUT_URL: z.string().url().optional(),
  AUTH_FORGOT_PASSWORD_URL: z.string().url().optional(),
  AUTH_COOKIE_NAME: z.string().min(1).default(".ASPXAUTH"),
  AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  ACUMATICA_BASE_URL: z.string().url(),
  ACUMATICA_ENTITY_PATH: z.string().default("/entity/lightspeed/24.200.001"),
  ACUMATICA_COMPANY: z.string().min(1).optional(),
  ACUMATICA_BRANCH: z.string().min(1).optional(),
  ACUMATICA_LOCALE: z.string().min(1).default("en-US"),
  ADDRESS_COMPLETE_API_KEY: z.string().min(1).optional(),
  ADDRESS_COMPLETE_FIND_URL: z
    .string()
    .url()
    .default(
      "https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Find/v2.10/json3.ws",
    ),
  ADDRESS_COMPLETE_RETRIEVE_URL: z
    .string()
    .url()
    .default(
      "https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Retrieve/v2.10/json3.ws",
    ),
  ADDRESS_COMPLETE_GEOCODE_ENABLED: z.enum(["true", "false"]).optional(),
});

export type AppEnv = {
  AUTH_PROVIDER: "acumatica" | "custom";
  AUTH_LOGIN_URL?: string;
  AUTH_ME_URL?: string;
  AUTH_LOGOUT_URL?: string;
  AUTH_FORGOT_PASSWORD_URL?: string;
  AUTH_COOKIE_NAME: string;
  AUTH_COOKIE_DOMAIN?: string;
  AUTH_COOKIE_SECURE: boolean;
  ACUMATICA_BASE_URL: string;
  ACUMATICA_ENTITY_PATH: string;
  ACUMATICA_COMPANY?: string;
  ACUMATICA_BRANCH?: string;
  ACUMATICA_LOCALE: string;
  ADDRESS_COMPLETE_API_KEY?: string;
  ADDRESS_COMPLETE_FIND_URL: string;
  ADDRESS_COMPLETE_RETRIEVE_URL: string;
  ADDRESS_COMPLETE_GEOCODE_ENABLED: boolean;
};

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = schema.safeParse({
    AUTH_PROVIDER: emptyToUndefined(process.env.AUTH_PROVIDER),
    AUTH_LOGIN_URL: emptyToUndefined(process.env.AUTH_LOGIN_URL),
    AUTH_ME_URL: emptyToUndefined(process.env.AUTH_ME_URL),
    AUTH_LOGOUT_URL: emptyToUndefined(process.env.AUTH_LOGOUT_URL),
    AUTH_FORGOT_PASSWORD_URL: emptyToUndefined(process.env.AUTH_FORGOT_PASSWORD_URL),
    AUTH_COOKIE_NAME: emptyToUndefined(process.env.AUTH_COOKIE_NAME),
    AUTH_COOKIE_DOMAIN: emptyToUndefined(process.env.AUTH_COOKIE_DOMAIN),
    AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
    ACUMATICA_BASE_URL: process.env.ACUMATICA_BASE_URL,
    ACUMATICA_ENTITY_PATH: process.env.ACUMATICA_ENTITY_PATH,
    ACUMATICA_COMPANY: emptyToUndefined(process.env.ACUMATICA_COMPANY),
    ACUMATICA_BRANCH: emptyToUndefined(process.env.ACUMATICA_BRANCH),
    ACUMATICA_LOCALE: emptyToUndefined(process.env.ACUMATICA_LOCALE),
    ADDRESS_COMPLETE_API_KEY: emptyToUndefined(process.env.ADDRESS_COMPLETE_API_KEY),
    ADDRESS_COMPLETE_FIND_URL: emptyToUndefined(process.env.ADDRESS_COMPLETE_FIND_URL),
    ADDRESS_COMPLETE_RETRIEVE_URL: emptyToUndefined(
      process.env.ADDRESS_COMPLETE_RETRIEVE_URL,
    ),
    ADDRESS_COMPLETE_GEOCODE_ENABLED: process.env.ADDRESS_COMPLETE_GEOCODE_ENABLED,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");

    throw new Error(`Invalid environment configuration: ${missing}`);
  }

  if (parsed.data.AUTH_PROVIDER === "custom") {
    const missing: string[] = [];
    if (!parsed.data.AUTH_LOGIN_URL) {
      missing.push("AUTH_LOGIN_URL");
    }
    if (!parsed.data.AUTH_ME_URL) {
      missing.push("AUTH_ME_URL");
    }

    if (missing.length > 0) {
      throw new Error(
        `Invalid environment configuration for custom auth provider: ${missing.join(", ")}`,
      );
    }
  }

  cachedEnv = {
    ...parsed.data,
    AUTH_COOKIE_SECURE:
      parsed.data.AUTH_COOKIE_SECURE !== undefined
        ? parsed.data.AUTH_COOKIE_SECURE === "true"
        : process.env.NODE_ENV === "production",
    ADDRESS_COMPLETE_GEOCODE_ENABLED:
      parsed.data.ADDRESS_COMPLETE_GEOCODE_ENABLED === "true",
  };

  return cachedEnv;
}

export function getAuthCookieNameForMiddleware(): string {
  return process.env.AUTH_COOKIE_NAME?.trim() || ".ASPXAUTH";
}
