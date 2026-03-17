import type { BusinessAccountUpdateRequest } from "@/types/business-account";

export type BusinessAccountOptionalSaveWarningField = "category" | "week";

const OPTIONAL_WARNING_FIELDS: Array<{
  key: BusinessAccountOptionalSaveWarningField;
  label: string;
}> = [
  { key: "category", label: "Category" },
  { key: "week", label: "Week" },
];

function isMissingOptionalField(
  draft: BusinessAccountUpdateRequest,
  field: BusinessAccountOptionalSaveWarningField,
): boolean {
  if (field === "category") {
    return draft.category === null;
  }

  const value = draft[field];
  return typeof value !== "string" || value.trim().length === 0;
}

export function collectOptionalSaveWarningFields(
  draft: BusinessAccountUpdateRequest,
): BusinessAccountOptionalSaveWarningField[] {
  return OPTIONAL_WARNING_FIELDS.filter((field) => isMissingOptionalField(draft, field.key)).map(
    (field) => field.key,
  );
}

function toFieldLabel(field: BusinessAccountOptionalSaveWarningField): string {
  return OPTIONAL_WARNING_FIELDS.find((entry) => entry.key === field)?.label ?? field;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function formatOptionalSaveWarningMessage(
  fields: BusinessAccountOptionalSaveWarningField[],
): string | null {
  if (fields.length === 0) {
    return null;
  }

  const labels = fields.map(toFieldLabel);
  return `You have not added ${joinLabels(labels)}. Are you sure you want to save the changes?`;
}
