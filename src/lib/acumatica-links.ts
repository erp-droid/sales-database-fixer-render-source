function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildAcumaticaScreenUrl(
  baseUrl: string,
  screenId: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("Main", normalizedBaseUrl);
  url.searchParams.set("ScreenId", screenId);

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    const normalizedValue = String(value).trim();
    if (!normalizedValue) {
      return;
    }

    url.searchParams.set(key, normalizedValue);
  });

  return url.toString();
}

export function buildAcumaticaBusinessAccountUrl(
  baseUrl: string,
  businessAccountId: string | null | undefined,
  companyId?: string | null,
): string | null {
  if (!hasText(businessAccountId)) {
    return null;
  }

  return buildAcumaticaScreenUrl(baseUrl, "CR303000", {
    CompanyID: companyId,
    AcctCD: businessAccountId,
  });
}

export function buildAcumaticaContactUrl(
  baseUrl: string,
  contactId: number | null | undefined,
  companyId?: string | null,
): string | null {
  if (contactId === null || contactId === undefined || !Number.isFinite(contactId)) {
    return null;
  }

  return buildAcumaticaScreenUrl(baseUrl, "CR302000", {
    CompanyID: companyId,
    ContactID: String(contactId),
  });
}
