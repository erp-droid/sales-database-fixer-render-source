function sanitizePhoneInput(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractPhoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatPhoneDraftValue(value: string | null | undefined): string {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return "";
  }

  const digits = extractPhoneDigits(sanitized).slice(0, 10);
  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizePhoneForSave(value: string | null | undefined): string | null {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return null;
  }

  const digits = extractPhoneDigits(sanitized);
  if (digits.length !== 10) {
    return null;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function phoneValuesEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizePhoneForSave(left);
  const normalizedRight = normalizePhoneForSave(right);

  if (normalizedLeft !== null && normalizedRight !== null) {
    return normalizedLeft === normalizedRight;
  }

  return sanitizePhoneInput(left) === sanitizePhoneInput(right);
}
