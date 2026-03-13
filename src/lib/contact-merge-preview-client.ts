import type {
  ContactMergePreviewContact,
  ContactMergePreviewField,
  ContactMergePreviewFieldValue,
  ContactMergePreviewResponse,
} from "@/types/contact-merge";

export type ContactMergePreviewQuery = {
  businessAccountRecordId: string;
  keepContactId: number;
  contactIds: number[];
};

type MergeErrorPayload = {
  error?: string;
};

const previewCache = new Map<string, ContactMergePreviewResponse>();
const previewRequestCache = new Map<string, Promise<ContactMergePreviewResponse>>();
const prefetchQueue: ContactMergePreviewQuery[] = [];
const MAX_PREFETCH_CONCURRENCY = 2;

let activePrefetchCount = 0;

function buildPreviewCacheKey(query: ContactMergePreviewQuery): string {
  return [
    query.businessAccountRecordId.trim(),
    String(query.keepContactId),
    ...query.contactIds.map((contactId) => String(contactId)),
  ].join("|");
}

function hasCachedOrInflightPreview(query: ContactMergePreviewQuery): boolean {
  const key = buildPreviewCacheKey(query);
  return previewCache.has(key) || previewRequestCache.has(key);
}

function isQueuedPreview(query: ContactMergePreviewQuery): boolean {
  const key = buildPreviewCacheKey(query);
  return prefetchQueue.some((queuedQuery) => buildPreviewCacheKey(queuedQuery) === key);
}

function parseError(payload: MergeErrorPayload | null): string {
  if (!payload?.error || !payload.error.trim()) {
    return "Request failed.";
  }

  return payload.error;
}

function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return Promise.resolve(null);
  }

  return response.json().catch(() => null) as Promise<T | null>;
}

function isContactMergePreviewContact(value: unknown): value is ContactMergePreviewContact {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.contactId === "number" &&
    (record.displayName === null || typeof record.displayName === "string") &&
    (record.email === null || typeof record.email === "string") &&
    (record.phone === null || typeof record.phone === "string") &&
    typeof record.isPrimary === "boolean" &&
    (record.lastModifiedIso === null || typeof record.lastModifiedIso === "string")
  );
}

function isContactMergePreviewFieldValue(value: unknown): value is ContactMergePreviewFieldValue {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.contactId === "number" &&
    (record.value === null || typeof record.value === "string")
  );
}

function isContactMergePreviewField(value: unknown): value is ContactMergePreviewField {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.field === "string" &&
    typeof record.label === "string" &&
    typeof record.recommendedSourceContactId === "number" &&
    typeof record.valuesDiffer === "boolean" &&
    Array.isArray(record.values) &&
    record.values.every((entry) => isContactMergePreviewFieldValue(entry))
  );
}

function isContactMergePreviewResponse(value: unknown): value is ContactMergePreviewResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.businessAccountRecordId === "string" &&
    typeof record.businessAccountId === "string" &&
    typeof record.companyName === "string" &&
    typeof record.keepContactId === "number" &&
    Array.isArray(record.contacts) &&
    record.contacts.every((contact) => isContactMergePreviewContact(contact)) &&
    typeof record.recommendedSetKeptAsPrimary === "boolean" &&
    (record.expectedAccountLastModified === null ||
      typeof record.expectedAccountLastModified === "string") &&
    Array.isArray(record.warnings) &&
    record.warnings.every((warning) => typeof warning === "string") &&
    Array.isArray(record.fields) &&
    record.fields.every((field) => isContactMergePreviewField(field))
  );
}

export function getCachedContactMergePreview(
  query: ContactMergePreviewQuery,
): ContactMergePreviewResponse | null {
  return previewCache.get(buildPreviewCacheKey(query)) ?? null;
}

async function fetchContactMergePreview(
  query: ContactMergePreviewQuery,
): Promise<ContactMergePreviewResponse> {
  const params = new URLSearchParams({
    businessAccountRecordId: query.businessAccountRecordId,
    keepContactId: String(query.keepContactId),
  });
  query.contactIds.forEach((contactId) => {
    params.append("contactId", String(contactId));
  });

  const response = await fetch(`/api/contacts/merge-preview?${params.toString()}`, {
    cache: "no-store",
  });
  const payload = await readJsonResponse<ContactMergePreviewResponse | MergeErrorPayload>(
    response,
  );

  if (!response.ok) {
    throw new Error(parseError(payload as MergeErrorPayload | null));
  }

  if (!isContactMergePreviewResponse(payload)) {
    throw new Error("Unexpected response while loading merge preview.");
  }

  return payload;
}

export function refreshContactMergePreview(
  query: ContactMergePreviewQuery,
): Promise<ContactMergePreviewResponse> {
  const key = buildPreviewCacheKey(query);
  const inflightRequest = previewRequestCache.get(key);
  if (inflightRequest) {
    return inflightRequest;
  }

  const request = fetchContactMergePreview(query)
    .then((preview) => {
      previewCache.set(key, preview);
      return preview;
    })
    .finally(() => {
      if (previewRequestCache.get(key) === request) {
        previewRequestCache.delete(key);
      }
    });

  previewRequestCache.set(key, request);
  return request;
}

export function loadContactMergePreview(
  query: ContactMergePreviewQuery,
): Promise<ContactMergePreviewResponse> {
  const cached = getCachedContactMergePreview(query);
  if (cached) {
    return Promise.resolve(cached);
  }

  return refreshContactMergePreview(query);
}

function schedulePrefetchQueue(): void {
  while (activePrefetchCount < MAX_PREFETCH_CONCURRENCY && prefetchQueue.length > 0) {
    const nextQuery = prefetchQueue.shift();
    if (!nextQuery || hasCachedOrInflightPreview(nextQuery)) {
      continue;
    }

    activePrefetchCount += 1;
    void loadContactMergePreview(nextQuery)
      .catch(() => undefined)
      .finally(() => {
        activePrefetchCount = Math.max(0, activePrefetchCount - 1);
        schedulePrefetchQueue();
      });
  }
}

export function prefetchContactMergePreview(query: ContactMergePreviewQuery): void {
  if (hasCachedOrInflightPreview(query) || isQueuedPreview(query)) {
    return;
  }

  prefetchQueue.push(query);
  schedulePrefetchQueue();
}
