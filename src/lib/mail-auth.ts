import crypto from "node:crypto";

import { getStoredLoginName, requireAuthCookieValue } from "@/lib/auth";
import {
  readCallEmployeeDirectory,
  readCallEmployeeDirectoryMeta,
  syncCallEmployeeDirectory,
} from "@/lib/call-analytics/employee-directory";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import type { NextRequest } from "next/server";

const MAIL_ASSERTION_NAMESPACE = "mbmail";
const MAIL_ASSERTION_VERSION = "v1";
const MAIL_ASSERTION_TTL_MS = 5 * 60 * 1000;

type AuthCookieRefreshState = {
  value: string | null;
};

export type ResolvedMailSender = {
  loginName: string;
  senderEmail: string;
  displayName: string;
};

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function isFreshDirectory(latestUpdatedAt: string | null, staleAfterMs: number): boolean {
  if (!latestUpdatedAt) {
    return false;
  }

  const updatedAtMs = Date.parse(latestUpdatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs <= staleAfterMs;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function ensureMailServiceConfigured(): {
  serviceUrl: string;
  sharedSecret: string;
} {
  const env = getEnv();
  if (!env.MAIL_SERVICE_URL) {
    throw new HttpError(500, "MAIL_SERVICE_URL is not configured.");
  }
  if (!env.MAIL_SERVICE_SHARED_SECRET) {
    throw new HttpError(500, "MAIL_SERVICE_SHARED_SECRET is not configured.");
  }

  return {
    serviceUrl: env.MAIL_SERVICE_URL,
    sharedSecret: env.MAIL_SERVICE_SHARED_SECRET,
  };
}

export function ensureMailProxyConfigured(): {
  sharedSecret: string;
} {
  const env = getEnv();
  if (env.MAIL_PROXY_SHARED_SECRET) {
    return {
      sharedSecret: env.MAIL_PROXY_SHARED_SECRET,
    };
  }

  // Emergency fallback: keep internal proxy auth operational when only the
  // service assertion secret is configured in production.
  if (env.MAIL_SERVICE_SHARED_SECRET) {
    return {
      sharedSecret: env.MAIL_SERVICE_SHARED_SECRET,
    };
  }

  throw new HttpError(500, "MAIL_PROXY_SHARED_SECRET is not configured.");
}

export async function resolveMailSenderForRequest(
  request: NextRequest,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ResolvedMailSender> {
  const cookieValue = requireAuthCookieValue(request);
  const loginName = cleanText(getStoredLoginName(request));
  if (!loginName) {
    throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
  }

  const env = getEnv();
  const normalizedLoginName = loginName.toLowerCase();
  const findSender = () =>
    readCallEmployeeDirectory().find(
      (employee) => employee.loginName.trim().toLowerCase() === normalizedLoginName,
    ) ?? null;

  let sender = findSender();
  const directoryMeta = readCallEmployeeDirectoryMeta();
  if (!sender || !isFreshDirectory(directoryMeta.latestUpdatedAt, env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS)) {
    await syncCallEmployeeDirectory(cookieValue, authCookieRefresh);
    sender = findSender();
  }

  const senderEmail = cleanText(sender?.email);
  if (!senderEmail) {
    throw new HttpError(
      422,
      `No internal mailbox email is mapped to the signed-in login '${loginName}'.`,
    );
  }

  const expectedSuffix = `@${env.MAIL_INTERNAL_DOMAIN.trim().toLowerCase()}`;
  if (!normalizeEmail(senderEmail).endsWith(expectedSuffix)) {
    throw new HttpError(
      422,
      `Mapped mailbox '${senderEmail}' is outside the allowed ${env.MAIL_INTERNAL_DOMAIN} domain.`,
    );
  }

  return {
    loginName,
    senderEmail,
    displayName: cleanText(sender?.displayName) || loginName,
  };
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signAssertion(encodedPayload: string, sharedSecret: string): string {
  return crypto.createHmac("sha256", sharedSecret).update(encodedPayload).digest("base64url");
}

function buildSignedMailAssertion(
  input: ResolvedMailSender,
  sharedSecret: string,
): string {
  const issuedAt = Date.now();
  const payload = {
    loginName: input.loginName,
    displayName: input.displayName,
    senderEmail: input.senderEmail,
    issuedAt,
    expiresAt: issuedAt + MAIL_ASSERTION_TTL_MS,
    sourceApp: "sales-database-fixer",
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signAssertion(encodedPayload, sharedSecret);
  return `${MAIL_ASSERTION_NAMESPACE}.${MAIL_ASSERTION_VERSION}.${encodedPayload}.${signature}`;
}

export function buildMailServiceAssertion(input: ResolvedMailSender): string {
  const { sharedSecret } = ensureMailServiceConfigured();
  return buildSignedMailAssertion(input, sharedSecret);
}

export function buildMailProxyAssertion(input: ResolvedMailSender): string {
  const { sharedSecret } = ensureMailProxyConfigured();
  return buildSignedMailAssertion(input, sharedSecret);
}
