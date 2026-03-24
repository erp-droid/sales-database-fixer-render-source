import crypto from "node:crypto";

export function cleanString(value) {
  return String(value ?? "").trim();
}

export function normalizeComparable(value) {
  return cleanString(value).toLowerCase();
}

export function base64UrlEncode(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

export function base64UrlDecode(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

export function signWithSecret(encodedPayload, secret) {
  return crypto.createHmac("sha256", String(secret || "")).update(encodedPayload).digest("base64url");
}

export function safeTokenEquals(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function nowIso() {
  return new Date().toISOString();
}

export function toMailboxKey(loginName) {
  return normalizeComparable(loginName);
}

export function dedupeBy(items, buildKey) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = buildKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function encryptText(value, secret) {
  const key = crypto.createHash("sha256").update(String(secret || "")).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptText(value, secret) {
  const text = cleanString(value);
  if (!text) return "";
  const [ivEncoded, tagEncoded, encryptedEncoded] = text.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) {
    return "";
  }
  const key = crypto.createHash("sha256").update(String(secret || "")).digest();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function parseJsonBodySafe(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}
