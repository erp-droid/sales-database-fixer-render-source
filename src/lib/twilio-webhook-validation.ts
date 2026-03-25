import type { NextRequest } from "next/server";
import twilio from "twilio";

import { getEnv } from "@/lib/env";

export type TwilioWebhookValidationResult = {
  isValid: boolean;
  matchedUrl: string | null;
  candidateUrls: string[];
};

function cleanHeaderValue(value: string | null | undefined): string {
  return value?.split(",")[0]?.trim() ?? "";
}

function addCandidateUrl(target: string[], seen: Set<string>, value: string | null): void {
  if (!value) {
    return;
  }

  try {
    const normalized = new URL(value).toString();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    target.push(normalized);
  } catch {
    // Ignore malformed candidate URLs.
  }
}

function buildUrlFromOrigin(origin: string | null, pathAndSearch: string): string | null {
  if (!origin) {
    return null;
  }

  try {
    return new URL(pathAndSearch, origin).toString();
  } catch {
    return null;
  }
}

export function buildTwilioWebhookValidationUrls(request: NextRequest): string[] {
  const pathAndSearch = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const candidateUrls: string[] = [];
  const seen = new Set<string>();

  addCandidateUrl(
    candidateUrls,
    seen,
    buildUrlFromOrigin(getEnv().APP_BASE_URL?.trim() ?? null, pathAndSearch),
  );

  const forwardedHost =
    cleanHeaderValue(request.headers.get("x-forwarded-host")) ||
    cleanHeaderValue(request.headers.get("host"));
  const forwardedProto = cleanHeaderValue(request.headers.get("x-forwarded-proto"));
  if (forwardedHost) {
    const defaultProto =
      forwardedHost.startsWith("localhost") || forwardedHost.startsWith("127.0.0.1")
        ? "http"
        : "https";
    addCandidateUrl(
      candidateUrls,
      seen,
      buildUrlFromOrigin(`${forwardedProto || defaultProto}://${forwardedHost}`, pathAndSearch),
    );
  }

  addCandidateUrl(candidateUrls, seen, request.url);
  addCandidateUrl(candidateUrls, seen, request.nextUrl.toString());
  return candidateUrls;
}

export function validateTwilioWebhookRequest(
  request: NextRequest,
  params: Record<string, string>,
  authToken: string,
): TwilioWebhookValidationResult {
  const signature = request.headers.get("x-twilio-signature")?.trim() ?? "";
  const candidateUrls = buildTwilioWebhookValidationUrls(request);

  if (!signature) {
    return {
      isValid: false,
      matchedUrl: null,
      candidateUrls,
    };
  }

  for (const candidateUrl of candidateUrls) {
    if (twilio.validateRequest(authToken, signature, candidateUrl, params)) {
      return {
        isValid: true,
        matchedUrl: candidateUrl,
        candidateUrls,
      };
    }
  }

  return {
    isValid: false,
    matchedUrl: null,
    candidateUrls,
  };
}
