import type { BusinessAccountUpdateRequest } from "@/types/business-account";

export type BusinessAccountSaveErrorField =
  | "industryType"
  | "subCategory"
  | "companyRegion"
  | "week"
  | "category";

export type BusinessAccountSaveErrorFeedback = {
  message: string;
  fieldErrors: Partial<Record<BusinessAccountSaveErrorField, string>>;
};

type AttributeFieldDescriptor = {
  key: BusinessAccountSaveErrorField;
  label: string;
};

const ATTRIBUTE_FIELD_DESCRIPTORS: AttributeFieldDescriptor[] = [
  { key: "industryType", label: "Industry Type" },
  { key: "subCategory", label: "Sub-Category" },
  { key: "companyRegion", label: "Company Region" },
  { key: "week", label: "Week" },
  { key: "category", label: "Category" },
];

const OPTIONAL_UPDATE_FIELDS = new Set<BusinessAccountSaveErrorField>(["week", "category"]);

const FIELD_ALIAS_MAP: Record<string, BusinessAccountSaveErrorField> = {
  category: "category",
  clienttype: "category",
  companyregion: "companyRegion",
  industry: "industryType",
  industrytype: "industryType",
  indsubcate: "subCategory",
  region: "companyRegion",
  subcategory: "subCategory",
  week: "week",
};

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDetailsMessage(details: unknown): string | null {
  if (!details || typeof details !== "object") {
    return null;
  }

  const record = details as Record<string, unknown>;
  const direct = [
    record.message,
    record.Message,
    record.exceptionMessage,
    record.ExceptionMessage,
    record.detail,
    record.Detail,
    record.title,
    record.Title,
  ]
    .map(readText)
    .find((value) => Boolean(value));
  if (direct) {
    return direct;
  }

  const modelState = record.modelState;
  if (modelState && typeof modelState === "object") {
    const entries = Object.entries(modelState as Record<string, unknown>);
    for (const [field, value] of entries) {
      if (Array.isArray(value)) {
        const first = value.map(readText).find((item) => Boolean(item));
        if (first) {
          return `${field}: ${first}`;
        }
      } else {
        const single = readText(value);
        if (single) {
          return `${field}: ${single}`;
        }
      }
    }
  }

  const errors = record.errors;
  if (errors && typeof errors === "object") {
    const entries = Object.entries(errors as Record<string, unknown>);
    for (const [field, value] of entries) {
      if (Array.isArray(value)) {
        const first = value.map(readText).find((item) => Boolean(item));
        if (first) {
          return `${field}: ${first}`;
        }
      } else {
        const single = readText(value);
        if (single) {
          return `${field}: ${single}`;
        }
      }
    }
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    return readDetailsMessage(nestedError);
  }

  return null;
}

export function parseApiErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Request failed.";
  }

  const record = payload as Record<string, unknown>;
  const errorValue = readText(record.error);
  const detailsValue = readDetailsMessage(record.details);
  const isGenericError =
    (errorValue ?? "").toLowerCase() === "an error has occurred." ||
    (errorValue ?? "").toLowerCase() === "an error has occurred";

  if (errorValue && detailsValue && isGenericError) {
    return detailsValue;
  }

  if (errorValue) {
    return errorValue;
  }

  if (detailsValue) {
    return detailsValue;
  }

  return "Request failed.";
}

function mapStructuredFieldName(fieldName: string): BusinessAccountSaveErrorField | null {
  const normalized = fieldName.replace(/[^a-z]/gi, "").toLowerCase();
  return FIELD_ALIAS_MAP[normalized] ?? null;
}

function collectStructuredFieldErrors(
  source: unknown,
  fieldErrors: Partial<Record<BusinessAccountSaveErrorField, string>>,
  seen: Set<object>,
): boolean {
  if (!source || typeof source !== "object") {
    return false;
  }

  if (seen.has(source)) {
    return false;
  }
  seen.add(source);

  let sawGenericValueField = false;
  const record = source as Record<string, unknown>;

  for (const bucketKey of ["modelState", "errors"] as const) {
    const bucket = record[bucketKey];
    if (!bucket || typeof bucket !== "object") {
      continue;
    }

    for (const [fieldName, value] of Object.entries(bucket as Record<string, unknown>)) {
      const mappedField = mapStructuredFieldName(fieldName);
      const message = Array.isArray(value)
        ? value.map(readText).find((item) => Boolean(item))
        : readText(value);

      if (mappedField && message && !fieldErrors[mappedField]) {
        fieldErrors[mappedField] = message;
      }

      if (fieldName.trim().toLowerCase() === "value") {
        sawGenericValueField = true;
      }
    }
  }

  for (const nestedKey of ["details", "error", "lastError"] as const) {
    const nested = record[nestedKey];
    if (nested && typeof nested === "object") {
      sawGenericValueField =
        collectStructuredFieldErrors(nested, fieldErrors, seen) || sawGenericValueField;
    }
  }

  return sawGenericValueField;
}

function isMissingAttributeField(
  draft: BusinessAccountUpdateRequest,
  field: BusinessAccountSaveErrorField,
): boolean {
  if (field === "category") {
    return draft.category === null;
  }

  const value = draft[field];
  return typeof value !== "string" || value.trim().length === 0;
}

function buildMissingAttributeFieldErrors(
  draft: BusinessAccountUpdateRequest,
): Partial<Record<BusinessAccountSaveErrorField, string>> {
  const next: Partial<Record<BusinessAccountSaveErrorField, string>> = {};

  for (const descriptor of ATTRIBUTE_FIELD_DESCRIPTORS) {
    if (OPTIONAL_UPDATE_FIELDS.has(descriptor.key)) {
      continue;
    }

    if (isMissingAttributeField(draft, descriptor.key)) {
      next[descriptor.key] = "Select a value before saving.";
    }
  }

  return next;
}

function formatMissingAttributeMessage(
  fieldErrors: Partial<Record<BusinessAccountSaveErrorField, string>>,
): string {
  const labels = ATTRIBUTE_FIELD_DESCRIPTORS.filter(
    (descriptor) => fieldErrors[descriptor.key],
  ).map((descriptor) => descriptor.label);

  if (labels.length === 0) {
    return "Complete the missing attribute values before saving.";
  }

  if (labels.length === 1) {
    return `Complete the missing attribute value before saving: ${labels[0]}.`;
  }

  return `Complete the missing attribute values before saving: ${labels.join(", ")}.`;
}

function looksLikeGenericValueEmptyError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("'value' cannot be empty") ||
    normalized.includes("value cannot be empty") ||
    normalized.includes(" value: ")
  );
}

export function buildBusinessAccountSaveErrorFeedback(
  payload: unknown,
  draft: BusinessAccountUpdateRequest,
): BusinessAccountSaveErrorFeedback {
  const message = parseApiErrorMessage(payload);
  const fieldErrors: Partial<Record<BusinessAccountSaveErrorField, string>> = {};
  const sawGenericValueField = collectStructuredFieldErrors(payload, fieldErrors, new Set());

  if (Object.keys(fieldErrors).length > 0) {
    return { message, fieldErrors };
  }

  if (
    (sawGenericValueField || looksLikeGenericValueEmptyError(message)) &&
    ATTRIBUTE_FIELD_DESCRIPTORS.some((descriptor) => isMissingAttributeField(draft, descriptor.key))
  ) {
    const missingFieldErrors = buildMissingAttributeFieldErrors(draft);
    return {
      message: formatMissingAttributeMessage(missingFieldErrors),
      fieldErrors: missingFieldErrors,
    };
  }

  return {
    message,
    fieldErrors: {},
  };
}
