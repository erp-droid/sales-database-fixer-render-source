export const SUPPORT_ATTACHMENT_MAX_FILES = 5;
export const SUPPORT_ATTACHMENT_MAX_FILE_BYTES = 6 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_MAX_TOTAL_BYTES = 12 * 1024 * 1024;

export const SUPPORT_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  ".log",
].join(",");

const MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".log": "text/plain",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const ROBOT_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function extensionOf(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

export function normalizeSupportAttachmentMimeType(fileName: string, mimeType: string) {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return normalizedMime;
  }
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? normalizedMime;
}

export function isAllowedSupportAttachment(fileName: string, mimeType: string) {
  return ALLOWED_MIME_TYPES.has(normalizeSupportAttachmentMimeType(fileName, mimeType));
}

export function isRobotAnalyzableImage(mimeType: string) {
  return ROBOT_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function supportAttachmentStorageExtension(fileName: string, mimeType: string) {
  const normalizedMime = normalizeSupportAttachmentMimeType(fileName, mimeType);
  const requestedExtension = extensionOf(fileName);
  if (MIME_BY_EXTENSION[requestedExtension] === normalizedMime) {
    return requestedExtension;
  }

  const preferred = Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === normalizedMime);
  return preferred?.[0] ?? "";
}

export function formatSupportAttachmentBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
