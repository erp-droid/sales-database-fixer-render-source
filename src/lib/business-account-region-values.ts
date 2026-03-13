export const BUSINESS_ACCOUNT_REGION_VALUES = [
  "Region 1",
  "Region 2",
  "Region 3",
  "Region 4",
  "Region 5",
  "Region 6",
  "Region 7",
  "Region 8",
  "Region 9",
  "Region 10",
] as const;

export type BusinessAccountRegionValue = (typeof BUSINESS_ACCOUNT_REGION_VALUES)[number];

export function normalizeBusinessAccountRegionValue(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^region\s*(\d+)$/i);
  if (!match) {
    return trimmed;
  }

  const regionNumber = Number(match[1]);
  if (!Number.isInteger(regionNumber) || regionNumber < 1 || regionNumber > 10) {
    return trimmed;
  }

  return `Region ${regionNumber}`;
}

export function canonicalBusinessAccountRegionValue(
  value: string | null | undefined,
): string {
  return normalizeBusinessAccountRegionValue(value) ?? "";
}
