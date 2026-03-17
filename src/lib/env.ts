import path from "node:path";

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
  USER_CREDENTIALS_SECRET: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().optional(),
  ACUMATICA_BASE_URL: z.string().url(),
  ACUMATICA_ENTITY_PATH: z.string().default("/entity/lightspeed/24.200.001"),
  ACUMATICA_COMPANY: z.string().min(1).optional(),
  ACUMATICA_BRANCH: z.string().min(1).optional(),
  ACUMATICA_LOCALE: z.string().min(1).default("en-US"),
  ACUMATICA_USERNAME: z.string().min(1).optional(),
  ACUMATICA_PASSWORD: z.string().min(1).optional(),
  ACUMATICA_SERVICE_USERNAME: z.string().min(1).optional(),
  ACUMATICA_SERVICE_PASSWORD: z.string().min(1).optional(),
  ACUMATICA_PHONE_CALL_ACTIVITY_TYPE: z.string().min(1).default("P"),
  ACUMATICA_OPPORTUNITY_ENTITY: z.string().min(1).default("Opportunity"),
  ACUMATICA_OPPORTUNITY_CLASS_DEFAULT: z.string().min(1).default("PRODUCTION"),
  ACUMATICA_OPPORTUNITY_CLASS_SERVICE: z.string().min(1).default("SERVICE"),
  ACUMATICA_OPPORTUNITY_CLASS_GLENDALE: z.string().min(1).default("GLENDALE"),
  ACUMATICA_OPPORTUNITY_STAGE_DEFAULT: z
    .string()
    .min(1)
    .default("Awaiting Estimate"),
  ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT: z.string().min(1).default("MAIN"),
  ACUMATICA_OPPORTUNITY_OWNER_DEFAULT: z.string().optional(),
  ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS: z.string().default("0"),
  ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID: z
    .string()
    .min(1)
    .default("Do you think we are going to win this job?"),
  ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID: z
    .string()
    .min(1)
    .default("Link to Drive"),
  ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID: z
    .string()
    .min(1)
    .default("Project Type"),
  ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT: z.string().default(""),
  MAIL_SERVICE_URL: z.string().url().optional(),
  MAIL_SERVICE_SHARED_SECRET: z.string().min(1).optional(),
  MAIL_INTERNAL_DOMAIN: z.string().min(1).default("meadowb.com"),
  MAIL_CONNECT_RETURN_PATH: z.string().min(1).default("/mail"),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_API_KEY_SID: z.string().min(1).optional(),
  TWILIO_API_KEY_SECRET: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_TWIML_APP_SID: z.string().min(1).optional(),
  TWILIO_CALLER_ID: z.string().min(1).optional(),
  TWILIO_EDGE: z.string().min(1).optional(),
  ROCKETREACH_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default("gpt-4o-mini-transcribe"),
  OPENAI_SUMMARY_MODEL: z.string().min(1).default("gpt-4o-mini"),
  CALL_ACTIVITY_BODY_MAX_CHARS: z.string().default("25000"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
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
  READ_MODEL_ENABLED: z.enum(["true", "false"]).optional(),
  READ_MODEL_AUTO_SYNC_ENABLED: z.enum(["true", "false"]).optional(),
  READ_MODEL_SQLITE_PATH: z.string().min(1).optional(),
  DATA_QUALITY_HISTORY_PATH: z.string().min(1).optional(),
  READ_MODEL_STALE_AFTER_MS: z.string().optional(),
  READ_MODEL_SYNC_INTERVAL_MS: z.string().optional(),
  CALL_ANALYTICS_STALE_AFTER_MS: z.string().optional(),
  CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS: z.string().optional(),
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
  USER_CREDENTIALS_SECRET?: string;
  APP_BASE_URL?: string;
  ACUMATICA_BASE_URL: string;
  ACUMATICA_ENTITY_PATH: string;
  ACUMATICA_COMPANY?: string;
  ACUMATICA_BRANCH?: string;
  ACUMATICA_LOCALE: string;
  ACUMATICA_USERNAME?: string;
  ACUMATICA_PASSWORD?: string;
  ACUMATICA_SERVICE_USERNAME?: string;
  ACUMATICA_SERVICE_PASSWORD?: string;
  ACUMATICA_PHONE_CALL_ACTIVITY_TYPE?: string;
  ACUMATICA_OPPORTUNITY_ENTITY: string;
  ACUMATICA_OPPORTUNITY_CLASS_DEFAULT: string;
  ACUMATICA_OPPORTUNITY_CLASS_SERVICE: string;
  ACUMATICA_OPPORTUNITY_CLASS_GLENDALE: string;
  ACUMATICA_OPPORTUNITY_STAGE_DEFAULT: string;
  ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT: string;
  ACUMATICA_OPPORTUNITY_OWNER_DEFAULT?: string;
  ACUMATICA_OPPORTUNITY_CLASS_ID: string;
  ACUMATICA_OPPORTUNITY_STAGE: string;
  ACUMATICA_OPPORTUNITY_LOCATION: string;
  ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS: number;
  ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID: string;
  ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID: string;
  ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID: string;
  ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT: string;
  ACUMATICA_OPPORTUNITY_DEFAULT_LINK_TO_DRIVE: string;
  MAIL_SERVICE_URL?: string;
  MAIL_SERVICE_SHARED_SECRET?: string;
  MAIL_INTERNAL_DOMAIN: string;
  MAIL_CONNECT_RETURN_PATH: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_TWIML_APP_SID?: string;
  TWILIO_CALLER_ID?: string;
  TWILIO_EDGE?: string;
  ROCKETREACH_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIPTION_MODEL: string;
  OPENAI_SUMMARY_MODEL: string;
  CALL_ACTIVITY_BODY_MAX_CHARS: number;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  ADDRESS_COMPLETE_API_KEY?: string;
  ADDRESS_COMPLETE_FIND_URL: string;
  ADDRESS_COMPLETE_RETRIEVE_URL: string;
  ADDRESS_COMPLETE_GEOCODE_ENABLED: boolean;
  READ_MODEL_ENABLED: boolean;
  READ_MODEL_AUTO_SYNC_ENABLED: boolean;
  READ_MODEL_SQLITE_PATH: string;
  DATA_QUALITY_HISTORY_PATH: string;
  READ_MODEL_STALE_AFTER_MS: number;
  READ_MODEL_SYNC_INTERVAL_MS: number;
  CALL_ANALYTICS_STALE_AFTER_MS: number;
  CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS: number;
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
    USER_CREDENTIALS_SECRET: emptyToUndefined(process.env.USER_CREDENTIALS_SECRET),
    APP_BASE_URL: emptyToUndefined(process.env.APP_BASE_URL),
    ACUMATICA_BASE_URL: process.env.ACUMATICA_BASE_URL,
    ACUMATICA_ENTITY_PATH: process.env.ACUMATICA_ENTITY_PATH,
    ACUMATICA_COMPANY: emptyToUndefined(process.env.ACUMATICA_COMPANY),
    ACUMATICA_BRANCH: emptyToUndefined(process.env.ACUMATICA_BRANCH),
    ACUMATICA_LOCALE: emptyToUndefined(process.env.ACUMATICA_LOCALE),
    ACUMATICA_USERNAME: emptyToUndefined(process.env.ACUMATICA_USERNAME),
    ACUMATICA_PASSWORD: emptyToUndefined(process.env.ACUMATICA_PASSWORD),
    ACUMATICA_SERVICE_USERNAME: emptyToUndefined(process.env.ACUMATICA_SERVICE_USERNAME),
    ACUMATICA_SERVICE_PASSWORD: emptyToUndefined(process.env.ACUMATICA_SERVICE_PASSWORD),
    ACUMATICA_PHONE_CALL_ACTIVITY_TYPE: emptyToUndefined(
      process.env.ACUMATICA_PHONE_CALL_ACTIVITY_TYPE,
    ),
    ACUMATICA_OPPORTUNITY_ENTITY: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_ENTITY ?? process.env.ACU_OPP_ENTITY,
    ),
    ACUMATICA_OPPORTUNITY_CLASS_DEFAULT: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT ??
        process.env.ACUMATICA_OPPORTUNITY_CLASS_ID ??
        process.env.ACU_OPP_CLASS_ID,
    ),
    ACUMATICA_OPPORTUNITY_CLASS_SERVICE: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_CLASS_SERVICE ??
        process.env.ACU_OPP_CLASS_ID_SERVICE,
    ),
    ACUMATICA_OPPORTUNITY_CLASS_GLENDALE: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_CLASS_GLENDALE ??
        process.env.ACU_OPP_CLASS_ID_GLENDALE,
    ),
    ACUMATICA_OPPORTUNITY_STAGE_DEFAULT: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT ??
        process.env.ACUMATICA_OPPORTUNITY_STAGE ??
        process.env.ACU_OPP_STAGE,
    ),
    ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT ??
        process.env.ACUMATICA_OPPORTUNITY_LOCATION ??
        process.env.ACU_OPP_LOCATION,
    ),
    ACUMATICA_OPPORTUNITY_OWNER_DEFAULT: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_OWNER_DEFAULT ??
        process.env.ACU_OPP_OWNER,
    ),
    ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS ??
        process.env.ACU_OPP_ESTIMATION_OFFSET_DAYS,
    ),
    ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID ??
        process.env.ACU_OPP_ATTR_WIN_JOB_ID,
    ),
    ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID ??
        process.env.ACU_OPP_ATTR_LINK_TO_DRIVE_ID,
    ),
    ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID ??
        process.env.ACU_OPP_ATTR_PROJECT_TYPE_ID,
    ),
    ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT: emptyToUndefined(
      process.env.ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT ??
        process.env.ACUMATICA_OPPORTUNITY_DEFAULT_LINK_TO_DRIVE ??
        process.env.ACU_OPP_ATTR_LINK_TO_DRIVE_PENDING,
    ),
    MAIL_SERVICE_URL: emptyToUndefined(process.env.MAIL_SERVICE_URL),
    MAIL_SERVICE_SHARED_SECRET: emptyToUndefined(process.env.MAIL_SERVICE_SHARED_SECRET),
    MAIL_INTERNAL_DOMAIN: emptyToUndefined(process.env.MAIL_INTERNAL_DOMAIN),
    MAIL_CONNECT_RETURN_PATH: emptyToUndefined(process.env.MAIL_CONNECT_RETURN_PATH),
    TWILIO_ACCOUNT_SID: emptyToUndefined(process.env.TWILIO_ACCOUNT_SID),
    TWILIO_API_KEY_SID: emptyToUndefined(process.env.TWILIO_API_KEY_SID),
    TWILIO_API_KEY_SECRET: emptyToUndefined(process.env.TWILIO_API_KEY_SECRET),
    TWILIO_AUTH_TOKEN: emptyToUndefined(process.env.TWILIO_AUTH_TOKEN),
    TWILIO_TWIML_APP_SID: emptyToUndefined(process.env.TWILIO_TWIML_APP_SID),
    TWILIO_CALLER_ID: emptyToUndefined(process.env.TWILIO_CALLER_ID),
    TWILIO_EDGE: emptyToUndefined(process.env.TWILIO_EDGE),
    ROCKETREACH_API_KEY: emptyToUndefined(process.env.ROCKETREACH_API_KEY),
    OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
    OPENAI_TRANSCRIPTION_MODEL: emptyToUndefined(process.env.OPENAI_TRANSCRIPTION_MODEL),
    OPENAI_SUMMARY_MODEL: emptyToUndefined(process.env.OPENAI_SUMMARY_MODEL),
    CALL_ACTIVITY_BODY_MAX_CHARS: emptyToUndefined(process.env.CALL_ACTIVITY_BODY_MAX_CHARS),
    GOOGLE_OAUTH_CLIENT_ID: emptyToUndefined(process.env.GOOGLE_OAUTH_CLIENT_ID),
    GOOGLE_OAUTH_CLIENT_SECRET: emptyToUndefined(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    ADDRESS_COMPLETE_API_KEY: emptyToUndefined(process.env.ADDRESS_COMPLETE_API_KEY),
    ADDRESS_COMPLETE_FIND_URL: emptyToUndefined(process.env.ADDRESS_COMPLETE_FIND_URL),
    ADDRESS_COMPLETE_RETRIEVE_URL: emptyToUndefined(
      process.env.ADDRESS_COMPLETE_RETRIEVE_URL,
    ),
    ADDRESS_COMPLETE_GEOCODE_ENABLED: process.env.ADDRESS_COMPLETE_GEOCODE_ENABLED,
    READ_MODEL_ENABLED: process.env.READ_MODEL_ENABLED,
    READ_MODEL_AUTO_SYNC_ENABLED: process.env.READ_MODEL_AUTO_SYNC_ENABLED,
    READ_MODEL_SQLITE_PATH: emptyToUndefined(process.env.READ_MODEL_SQLITE_PATH),
    DATA_QUALITY_HISTORY_PATH: emptyToUndefined(process.env.DATA_QUALITY_HISTORY_PATH),
    READ_MODEL_STALE_AFTER_MS: emptyToUndefined(process.env.READ_MODEL_STALE_AFTER_MS),
    READ_MODEL_SYNC_INTERVAL_MS: emptyToUndefined(process.env.READ_MODEL_SYNC_INTERVAL_MS),
    CALL_ANALYTICS_STALE_AFTER_MS: emptyToUndefined(process.env.CALL_ANALYTICS_STALE_AFTER_MS),
    CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS: emptyToUndefined(
      process.env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS,
    ),
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

  if (parsed.data.AUTH_PROVIDER === "acumatica" && !parsed.data.ACUMATICA_COMPANY) {
    throw new Error(
      "Invalid environment configuration for Acumatica auth provider: ACUMATICA_COMPANY",
    );
  }

  const readModelSqlitePath =
    parsed.data.READ_MODEL_SQLITE_PATH?.trim() || "./data/read-model.sqlite";
  const dataQualityHistoryPath =
    parsed.data.DATA_QUALITY_HISTORY_PATH?.trim() ||
    path.join(path.dirname(readModelSqlitePath), "data-quality-history.json");

  cachedEnv = {
    ...parsed.data,
    AUTH_COOKIE_SECURE:
      parsed.data.AUTH_COOKIE_SECURE !== undefined
        ? parsed.data.AUTH_COOKIE_SECURE === "true"
        : process.env.NODE_ENV === "production",
    ACUMATICA_OPPORTUNITY_CLASS_ID:
      parsed.data.ACUMATICA_OPPORTUNITY_CLASS_DEFAULT,
    ACUMATICA_OPPORTUNITY_STAGE:
      parsed.data.ACUMATICA_OPPORTUNITY_STAGE_DEFAULT,
    ACUMATICA_OPPORTUNITY_LOCATION:
      parsed.data.ACUMATICA_OPPORTUNITY_LOCATION_DEFAULT,
    ACUMATICA_OPPORTUNITY_DEFAULT_LINK_TO_DRIVE:
      parsed.data.ACUMATICA_OPPORTUNITY_LINK_TO_DRIVE_DEFAULT,
    ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS:
      Number(parsed.data.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS) || 0,
    ADDRESS_COMPLETE_GEOCODE_ENABLED:
      parsed.data.ADDRESS_COMPLETE_GEOCODE_ENABLED === "true",
    READ_MODEL_ENABLED: parsed.data.READ_MODEL_ENABLED === "true",
    READ_MODEL_AUTO_SYNC_ENABLED:
      parsed.data.READ_MODEL_AUTO_SYNC_ENABLED === "true",
    READ_MODEL_SQLITE_PATH: readModelSqlitePath,
    DATA_QUALITY_HISTORY_PATH: dataQualityHistoryPath,
    READ_MODEL_STALE_AFTER_MS: Math.max(
      60_000,
      Number(parsed.data.READ_MODEL_STALE_AFTER_MS ?? "300000") || 300_000,
    ),
    READ_MODEL_SYNC_INTERVAL_MS: Math.max(
      60_000,
      Number(parsed.data.READ_MODEL_SYNC_INTERVAL_MS ?? "900000") || 900_000,
    ),
    CALL_ANALYTICS_STALE_AFTER_MS: Math.max(
      60_000,
      Number(parsed.data.CALL_ANALYTICS_STALE_AFTER_MS ?? "300000") || 300_000,
    ),
    CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS: Math.max(
      60_000,
      Number(parsed.data.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS ?? "86400000") ||
        86_400_000,
    ),
    CALL_ACTIVITY_BODY_MAX_CHARS: Math.max(
      2_000,
      Number(parsed.data.CALL_ACTIVITY_BODY_MAX_CHARS ?? "25000") || 25_000,
    ),
  };

  return cachedEnv;
}

export function getAuthCookieNameForMiddleware(): string {
  return process.env.AUTH_COOKIE_NAME?.trim() || ".ASPXAUTH";
}
