import type {
  ContactMergePreviewField,
  ContactMergePreviewResponse,
} from "@/types/contact-merge";

export type ContactMergePreviewQuery = {
  businessAccountRecordId: string;
  keepContactId: number;
  deleteContactId: number;
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
    String(query.deleteContactId),
  ].join("|");
}

function reversePreviewCacheKey(query: ContactMergePreviewQuery): string {
  return buildPreviewCacheKey({
    ...query,
    keepContactId: query.deleteContactId,
    deleteContactId: query.keepContactId,
  });
}

function hasCachedOrInflightPreview(query: ContactMergePreviewQuery): boolean {
  const exactKey = buildPreviewCacheKey(query);
  const reverseKey = reversePreviewCacheKey(query);

  return (
    previewCache.has(exactKey) ||
    previewCache.has(reverseKey) ||
    previewRequestCache.has(exactKey) ||
    previewRequestCache.has(reverseKey)
  );
}

function isQueuedPreview(query: ContactMergePreviewQuery): boolean {
  const exactKey = buildPreviewCacheKey(query);
  const reverseKey = reversePreviewCacheKey(query);

  return prefetchQueue.some((queuedQuery) => {
    const queuedKey = buildPreviewCacheKey(queuedQuery);
    return queuedKey === exactKey || queuedKey === reverseKey;
  });
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

function isContactMergePreviewField(value: unknown): value is ContactMergePreviewField {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.field === "string" &&
    typeof record.label === "string" &&
    (record.keepValue === null || typeof record.keepValue === "string") &&
    (record.deleteValue === null || typeof record.deleteValue === "string") &&
    (record.recommendedSource === "keep" || record.recommendedSource === "delete") &&
    typeof record.valuesDiffer === "boolean"
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
    typeof record.deleteContactId === "number" &&
    typeof record.keepIsPrimary === "boolean" &&
    typeof record.deleteIsPrimary === "boolean" &&
    typeof record.recommendedSetKeptAsPrimary === "boolean" &&
    (record.expectedAccountLastModified === null ||
      typeof record.expectedAccountLastModified === "string") &&
    (record.expectedKeepContactLastModified === null ||
      typeof record.expectedKeepContactLastModified === "string") &&
    (record.expectedDeleteContactLastModified === null ||
      typeof record.expectedDeleteContactLastModified === "string") &&
    Array.isArray(record.warnings) &&
    record.warnings.every((warning) => typeof warning === "string") &&
    Array.isArray(record.fields) &&
    record.fields.every((field) => isContactMergePreviewField(field))
  );
}

function normalizeComparableValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function computeRecommendedSource(
  keepValue: string | null | undefined,
  deleteValue: string | null | undefined,
): "keep" | "delete" {
  if (keepValue && keepValue.trim()) {
    return "keep";
  }

  if (deleteValue && deleteValue.trim()) {
    return "delete";
  }

  return "keep";
}

export function reverseContactMergePreview(
  preview: ContactMergePreviewResponse,
): ContactMergePreviewResponse {
  return {
    ...preview,
    keepContactId: preview.deleteContactId,
    deleteContactId: preview.keepContactId,
    keepIsPrimary: preview.deleteIsPrimary,
    deleteIsPrimary: preview.keepIsPrimary,
    recommendedSetKeptAsPrimary: !preview.deleteIsPrimary && preview.keepIsPrimary,
    expectedKeepContactLastModified: preview.expectedDeleteContactLastModified,
    expectedDeleteContactLastModified: preview.expectedKeepContactLastModified,
    fields: preview.fields.map((field) => {
      const keepValue = field.deleteValue;
      const deleteValue = field.keepValue;
      return {
        ...field,
        keepValue,
        deleteValue,
        valuesDiffer:
          normalizeComparableValue(keepValue) !== normalizeComparableValue(deleteValue),
        recommendedSource: computeRecommendedSource(keepValue, deleteValue),
      };
    }),
  };
}

export function getCachedContactMergePreview(
  query: ContactMergePreviewQuery,
): ContactMergePreviewResponse | null {
  const exactKey = buildPreviewCacheKey(query);
  const exactPreview = previewCache.get(exactKey);
  if (exactPreview) {
    return exactPreview;
  }

  const reversePreview = previewCache.get(reversePreviewCacheKey(query));
  return reversePreview ? reverseContactMergePreview(reversePreview) : null;
}

async function fetchContactMergePreview(
  query: ContactMergePreviewQuery,
): Promise<ContactMergePreviewResponse> {
  const params = new URLSearchParams({
    businessAccountRecordId: query.businessAccountRecordId,
    keepContactId: String(query.keepContactId),
    deleteContactId: String(query.deleteContactId),
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

export function loadContactMergePreview(
  query: ContactMergePreviewQuery,
): Promise<ContactMergePreviewResponse> {
  const cached = getCachedContactMergePreview(query);
  if (cached) {
    return Promise.resolve(cached);
  }

  const exactKey = buildPreviewCacheKey(query);
  const exactRequest = previewRequestCache.get(exactKey);
  if (exactRequest) {
    return exactRequest;
  }

  const reverseRequest = previewRequestCache.get(reversePreviewCacheKey(query));
  if (reverseRequest) {
    return reverseRequest.then((preview) => reverseContactMergePreview(preview));
  }

  const request = fetchContactMergePreview(query)
    .then((preview) => {
      previewCache.set(exactKey, preview);
      return preview;
    })
    .finally(() => {
      if (previewRequestCache.get(exactKey) === request) {
        previewRequestCache.delete(exactKey);
      }
    });

  previewRequestCache.set(exactKey, request);
  return request;
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
