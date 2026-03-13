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

function formatNorthAmericanPhoneDigits(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeNorthAmericanPhoneDigits(value: string | null | undefined): string | null {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return null;
  }

  const digits = extractPhoneDigits(sanitized);
  if (digits.length === 10) {
    return digits;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return null;
}

export function extractNormalizedPhoneDigits(value: string | null | undefined): string {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return "";
  }

  return normalizeNorthAmericanPhoneDigits(sanitized) ?? extractPhoneDigits(sanitized);
}

export function formatPhoneDraftValue(value: string | null | undefined): string {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return "";
  }

  const rawDigits = extractPhoneDigits(sanitized);
  const digits =
    rawDigits.length > 10 && rawDigits.startsWith("1")
      ? rawDigits.slice(1, 11)
      : rawDigits.slice(0, 10);
  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizePhoneForSave(value: string | null | undefined): string | null {
  const digits = normalizeNorthAmericanPhoneDigits(value);
  if (!digits) {
    return null;
  }

  return formatNorthAmericanPhoneDigits(digits);
}

export function formatPhoneForDisplay(value: string | null | undefined): string | null {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return null;
  }

  return normalizePhoneForSave(sanitized) ?? sanitized;
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

export function formatPhoneForTwilioDial(value: string | null | undefined): string | null {
  const digits = extractNormalizedPhoneDigits(value);
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return null;
}

export type ParsedPhoneWithExtension =
  | {
      kind: "plain_phone";
      phone: string;
      extension: null;
    }
  | {
      kind: "phone_with_extension";
      phone: string;
      extension: string;
    }
  | {
      kind: "ambiguous_multiple_extensions" | "ambiguous_multiple_numbers" | "invalid";
      phone: null;
      extension: null;
    };

export function looksLikeFullNorthAmericanPhone(
  value: string | null | undefined,
): boolean {
  return normalizeNorthAmericanPhoneDigits(value) !== null;
}

export function normalizeExtensionForSave(
  value: string | null | undefined,
): string | null {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return null;
  }

  const digits = extractPhoneDigits(sanitized);
  return digits.length > 0 ? digits : null;
}

export function isExtensionLikeValue(
  value: string | null | undefined,
): boolean {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized || looksLikeFullNorthAmericanPhone(sanitized)) {
    return false;
  }

  const normalizedExtension = normalizeExtensionForSave(sanitized);
  if (!normalizedExtension || normalizedExtension.length > 5) {
    return false;
  }

  return /^(?:(?:ext(?:ension)?\.?|x)\s*)?\d+$/i.test(sanitized);
}

export function parsePhoneWithExtension(
  value: string | null | undefined,
): ParsedPhoneWithExtension {
  const sanitized = sanitizePhoneInput(value);
  if (!sanitized) {
    return {
      kind: "invalid",
      phone: null,
      extension: null,
    };
  }

  const extensionTailMatch = sanitized.match(
    /^(.*?)(?:\s*(?:ext(?:ension)?\.?|x)\s*([0-9]+(?:\s*\/\s*[0-9]+)*))\s*$/i,
  );
  if (extensionTailMatch) {
    const baseValue = extensionTailMatch[1]?.trim() ?? "";
    const extensionValue = extensionTailMatch[2]?.trim() ?? "";
    if (!baseValue || !extensionValue) {
      return {
        kind: "invalid",
        phone: null,
        extension: null,
      };
    }

    if (extensionValue.includes("/")) {
      return {
        kind: "ambiguous_multiple_extensions",
        phone: null,
        extension: null,
      };
    }

    const normalizedPhone = normalizePhoneForSave(baseValue);
    if (!normalizedPhone) {
      const baseDigits = extractPhoneDigits(baseValue);
      return {
        kind: baseDigits.length > 11 ? "ambiguous_multiple_numbers" : "invalid",
        phone: null,
        extension: null,
      };
    }

    const normalizedExtension = normalizeExtensionForSave(extensionValue);
    if (!normalizedExtension) {
      return {
        kind: "invalid",
        phone: null,
        extension: null,
      };
    }

    return {
      kind: "phone_with_extension",
      phone: normalizedPhone,
      extension: normalizedExtension,
    };
  }

  const normalizedPhone = normalizePhoneForSave(sanitized);
  if (normalizedPhone) {
    return {
      kind: "plain_phone",
      phone: normalizedPhone,
      extension: null,
    };
  }

  if (/(?:\b[TMF]:|\r|\n)/i.test(sanitized)) {
    return {
      kind: "ambiguous_multiple_numbers",
      phone: null,
      extension: null,
    };
  }

  if (/(?:ext(?:ension)?\.?|x)\s*[0-9]+/i.test(sanitized)) {
    return {
      kind: "ambiguous_multiple_extensions",
      phone: null,
      extension: null,
    };
  }

  const digits = extractPhoneDigits(sanitized);
  if (digits.length > 11) {
    return {
      kind: "ambiguous_multiple_numbers",
      phone: null,
      extension: null,
    };
  }

  return {
    kind: "invalid",
    phone: null,
    extension: null,
  };
}

export function resolvePrimaryContactPhoneFields(values: {
  phone1: string | null | undefined;
  phone2?: string | null | undefined;
  phone3?: string | null | undefined;
}): {
  phone: string | null;
  extension: string | null;
} {
  const phone1 = sanitizePhoneInput(values.phone1);
  const phone2 = sanitizePhoneInput(values.phone2);
  const phone3 = sanitizePhoneInput(values.phone3);

  if (phone1) {
    return {
      phone: formatPhoneForDisplay(phone1),
      extension: phone2 && isExtensionLikeValue(phone2) ? normalizeExtensionForSave(phone2) : null,
    };
  }

  if (phone2 && looksLikeFullNorthAmericanPhone(phone2)) {
    return {
      phone: formatPhoneForDisplay(phone2),
      extension: null,
    };
  }

  if (phone3 && looksLikeFullNorthAmericanPhone(phone3)) {
    return {
      phone: formatPhoneForDisplay(phone3),
      extension: null,
    };
  }

  return {
    phone: null,
    extension: null,
  };
}
