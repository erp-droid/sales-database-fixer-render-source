import type { AppEnv } from "@/lib/env";

const PASSWORD_RECOVERY_PATH =
  "/Frames/PasswordRemind.aspx?ReturnUrl=%2fPasswordRemind.aspx";
const PASSWORD_RECOVERY_TIMEOUT_MS = 15_000;
const PASSWORD_RECOVERY_USER_AGENT =
  "MeadowBrook-CRM/1.0 (Windows password recovery)";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function readInputValue(html: string, name: string): string | null {
  const tag = html.match(
    new RegExp(
      `<input\\b[^>]*\\bname=["']${escapeRegex(name)}["'][^>]*>`,
      "i",
    ),
  )?.[0];
  if (!tag) {
    return null;
  }

  const value = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? "";
  return decodeHtml(value);
}

function readRecoveryMessage(html: string): string {
  const raw = html.match(
    /<span\b[^>]*\bid=["']lblMsg["'][^>]*>([\s\S]*?)<\/span>/i,
  )?.[1];
  if (!raw) {
    return "";
  }

  return decodeHtml(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function buildCookieHeader(headers: Headers): string {
  const rawHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof rawHeaders.getSetCookie === "function"
      ? rawHeaders.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];

  return setCookies
    .map((value) => value.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = PASSWORD_RECOVERY_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function normalizePasswordRecoveryUsername(value: string): string {
  const trimmed = value.trim();
  const atIndex = trimmed.indexOf("@");
  return atIndex > 0 ? trimmed.slice(0, atIndex).trim() : trimmed;
}

export async function requestAcumaticaPasswordReset(
  rawUsername: string,
  env: AppEnv,
): Promise<void> {
  const username = normalizePasswordRecoveryUsername(rawUsername);
  if (!username) {
    throw new Error("A username is required for password recovery.");
  }

  if (env.AUTH_PROVIDER !== "acumatica") {
    throw new Error("Native password recovery is unavailable for this auth provider.");
  }

  const recoveryUrl = new URL(PASSWORD_RECOVERY_PATH, env.ACUMATICA_BASE_URL);
  const origin = new URL(env.ACUMATICA_BASE_URL).origin;
  const startedAt = Date.now();

  const pageResponse = await fetchWithTimeout(recoveryUrl.toString(), {
    method: "GET",
    cache: "no-store",
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": PASSWORD_RECOVERY_USER_AGENT,
    },
  });

  if (!pageResponse.ok) {
    throw new Error(`Password recovery page returned HTTP ${pageResponse.status}.`);
  }

  const pageHtml = await pageResponse.text();
  const viewState = readInputValue(pageHtml, "__VIEWSTATE");
  const viewStateGenerator = readInputValue(pageHtml, "__VIEWSTATEGENERATOR");
  if (!viewState || !viewStateGenerator) {
    throw new Error("Password recovery page did not include the expected form state.");
  }

  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: viewStateGenerator,
    "ctl00$txtLoginBgIndex":
      readInputValue(pageHtml, "ctl00$txtLoginBgIndex") ?? "",
    "ctl00$__isOutlook": "",
    "ctl00$phUser$edLogin": username,
    "ctl00$phUser$cmbCompany": env.ACUMATICA_COMPANY ?? "MeadowBrook Live",
    "ctl00$phUser$txtDummyCpny": "",
    "ctl00$phUser$btnSubmit": "Submit",
  });

  const cookieHeader = buildCookieHeader(pageResponse.headers);
  const submitResponse = await fetchWithTimeout(recoveryUrl.toString(), {
    method: "POST",
    cache: "no-store",
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
      Referer: recoveryUrl.toString(),
      "User-Agent": PASSWORD_RECOVERY_USER_AGENT,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body,
  });

  if (!submitResponse.ok) {
    throw new Error(`Password recovery request returned HTTP ${submitResponse.status}.`);
  }

  const responseHtml = await submitResponse.text();
  const message = readRecoveryMessage(responseHtml);
  if (!/\b(?:will be sent|has been sent|instructions were sent)\b/i.test(message)) {
    throw new Error(
      message
        ? `Password recovery was not accepted: ${message}`
        : "Password recovery returned an unexpected response.",
    );
  }

  console.info("[password-recovery] upstream request accepted", {
    durationMs: Math.max(0, Date.now() - startedAt),
  });
}
