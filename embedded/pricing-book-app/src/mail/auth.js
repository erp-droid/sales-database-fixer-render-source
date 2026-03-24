import { config } from "../config.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  cleanString,
  safeTokenEquals,
  signWithSecret
} from "./utils.js";

const MAIL_NAMESPACE = "mbmail";
const MAIL_VERSION = "v1";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class MailAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "MailAuthError";
    this.status = status;
  }
}

function getProxySecret() {
  const secret = cleanString(config.mail.proxySharedSecret);
  if (!secret) {
    throw new MailAuthError("Mail proxy secret is not configured.", 500);
  }
  return secret;
}

function decodeSignedToken(token) {
  const raw = cleanString(token);
  const [namespace, version, encodedPayload, signature] = raw.split(".");
  if (namespace !== MAIL_NAMESPACE || version !== MAIL_VERSION || !encodedPayload || !signature) {
    throw new MailAuthError("Mail authentication is invalid.");
  }

  const expected = signWithSecret(encodedPayload, getProxySecret());
  if (!safeTokenEquals(signature, expected)) {
    throw new MailAuthError("Mail authentication is invalid.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (!payload || typeof payload !== "object") {
    throw new MailAuthError("Mail authentication is invalid.");
  }

  const expiresAt = Number(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new MailAuthError("Mail authentication expired.");
  }

  return payload;
}

export function parseMailAssertionToken(token) {
  const payload = decodeSignedToken(token);
  const loginName = cleanString(payload.loginName);
  const senderEmail = cleanString(payload.senderEmail).toLowerCase();
  if (!loginName || !senderEmail) {
    throw new MailAuthError("Mail authentication payload is incomplete.");
  }

  return {
    loginName,
    senderEmail,
    displayName: cleanString(payload.displayName) || loginName,
    sourceApp: cleanString(payload.sourceApp) || "unknown"
  };
}

export function requireMailAssertion(req) {
  const authHeader = cleanString(req.get("authorization"));
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new MailAuthError("Mail authentication is required.");
  }

  const token = cleanString(authHeader.slice(7));
  return parseMailAssertionToken(token);
}

export function buildOauthState(payload) {
  const encodedPayload = base64UrlEncode(
    JSON.stringify({
      ...payload,
      issuedAt: Date.now(),
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS
    })
  );
  const signature = signWithSecret(encodedPayload, getProxySecret());
  return `${MAIL_NAMESPACE}.${MAIL_VERSION}.${encodedPayload}.${signature}`;
}

export function parseOauthState(state) {
  return decodeSignedToken(state);
}
