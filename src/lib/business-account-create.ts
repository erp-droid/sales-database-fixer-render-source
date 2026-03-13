import {
  CATEGORY_VALUES,
  type BusinessAccountRow,
  type Category,
} from "@/types/business-account";
import type {
  BusinessAccountClassCode,
  BusinessAccountCreateRequest,
  BusinessAccountContactCreateRequest,
  ContactClassKey,
} from "@/types/business-account-create";
import {
  BUSINESS_ACCOUNT_REGION_VALUES,
  canonicalBusinessAccountRegionValue,
  normalizeBusinessAccountRegionValue,
} from "@/lib/business-account-region-values";
import { normalizeBusinessAccount, normalizeBusinessAccountRows } from "@/lib/business-accounts";

export type AttributeOption = {
  value: string;
  label: string;
  aliases?: string[];
};

export const BUSINESS_ACCOUNT_CLASS_OPTIONS: Array<{
  value: BusinessAccountClassCode;
  label: string;
}> = [
  { value: "LEAD", label: "Lead" },
  { value: "CUSTOMER", label: "Customer" },
];

export const BUSINESS_ACCOUNT_CLASS_MAP: Record<
  BusinessAccountClassCode,
  { classId: string; type: string }
> = {
  LEAD: {
    classId: "LEAD",
    type: "Lead",
  },
  CUSTOMER: {
    classId: "CUSTOMER",
    type: "Customer",
  },
};

export const CONTACT_CLASS_LABELS: Record<ContactClassKey, string> = {
  billing: "Billing",
  operations: "Operations",
  production: "Production",
  sales: "Sales",
  service: "Service",
};

export const CONTACT_CLASS_OPTIONS = (
  Object.keys(CONTACT_CLASS_LABELS) as ContactClassKey[]
).map((key) => ({
  value: key,
  label: CONTACT_CLASS_LABELS[key],
}));

// Initial Acumatica values are stored centrally so they can be adjusted
// without changing the form contract.
export const CONTACT_CLASS_VALUE_MAP: Record<ContactClassKey, string> = {
  billing: "Billing",
  operations: "Operations",
  production: "Production",
  sales: "Sales",
  service: "Service",
};

export const CATEGORY_OPTIONS: AttributeOption[] = [
  { value: "A", label: "A - Type Clients", aliases: ["A - Type Customers"] },
  { value: "B", label: "B - Type Clients", aliases: ["B - Type Customers"] },
  { value: "C", label: "C - Type Clients", aliases: ["C - Type Customers"] },
  { value: "D", label: "D - Type Clients", aliases: ["D - Type Customers"] },
];

export const INDUSTRY_TYPE_OPTIONS: AttributeOption[] = [
  { value: "Distributi", label: "Distribution", aliases: ["Distributi"] },
  { value: "Manufactur", label: "Manufacturing", aliases: ["Manufactur"] },
  { value: "Recreation", label: "Recreation" },
  { value: "Service", label: "Service" },
];

export const SUB_CATEGORY_OPTIONS: AttributeOption[] = [
  { value: "Automotive", label: "Automotive" },
  { value: "Distributi", label: "Food & Beverage", aliases: ["Distribution"] },
  { value: "Electronic", label: "Electronics", aliases: ["Electronic"] },
  { value: "Fabric", label: "Fabrication" },
  { value: "General", label: "General" },
  { value: "Manufactur", label: "Pharmaceuticals", aliases: ["Manufacturing"] },
  { value: "Package", label: "Packaging" },
  { value: "Plastics", label: "Plastics" },
  { value: "Recreation", label: "Aerospace & Defense" },
  { value: "Service", label: "Chemical" },
];

export const COMPANY_REGION_OPTIONS: AttributeOption[] = [
  ...BUSINESS_ACCOUNT_REGION_VALUES.map((value) => ({
    value,
    label: value,
  })),
];

export const WEEK_OPTIONS: AttributeOption[] = Array.from({ length: 15 }, (_, index) => {
  const value = `Week ${index + 1}`;
  return {
    value,
    label: value,
  };
});

function splitContactName(displayName: string): {
  firstName: string | null;
  lastName: string;
} {
  const trimmed = displayName.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: null,
      lastName: trimmed,
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? trimmed,
  };
}

function normalizeAttributeCandidate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionComparable(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeOptionValue(
  options: AttributeOption[],
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const comparable = normalizeOptionComparable(value);
  for (const option of options) {
    if (normalizeOptionComparable(option.value) === comparable) {
      return option.value;
    }
    if (normalizeOptionComparable(option.label) === comparable) {
      return option.value;
    }
    if (
      option.aliases &&
      option.aliases.some((alias) => normalizeOptionComparable(alias) === comparable)
    ) {
      return option.value;
    }
  }

  return value.trim() || null;
}

export function normalizeRegionValue(value: string | null | undefined): string | null {
  return normalizeBusinessAccountRegionValue(value);
}

export function normalizeWeekValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^week\\s*(\\d+)$/i);
  if (match) {
    return `Week ${match[1]}`;
  }

  return trimmed;
}

function canonicalIndustryType(value: string | null | undefined): string {
  const normalized = normalizeAttributeCandidate(value);
  if (!normalized) {
    return "";
  }

  const key = normalized.toLowerCase();
  const map: Record<string, string> = {
    distributi: "Distributi",
    distribution: "Distributi",
    manufactur: "Manufactur",
    manufacturing: "Manufactur",
    recreation: "Recreation",
    service: "Service",
  };

  return map[key] ?? normalized;
}

function canonicalSubCategory(value: string | null | undefined): string {
  const normalized = normalizeAttributeCandidate(value);
  if (!normalized) {
    return "";
  }

  const key = normalized.toLowerCase();
  const map: Record<string, string> = {
    automotive: "Automotive",
    distributi: "Distributi",
    "food & beverage": "Distributi",
    electronic: "Electronic",
    electronics: "Electronic",
    fabric: "Fabric",
    fabrication: "Fabric",
    general: "General",
    manufactur: "Manufactur",
    pharmaceuticals: "Manufactur",
    package: "Package",
    packaging: "Package",
    plastics: "Plastics",
    recreation: "Recreation",
    "aerospace & defense": "Recreation",
    service: "Service",
    chemical: "Service",
  };

  return map[key] ?? normalized;
}

function canonicalCompanyRegion(value: string | null | undefined): string {
  return canonicalBusinessAccountRegionValue(value);
}

function canonicalWeek(value: string | null | undefined): string {
  const normalized = normalizeAttributeCandidate(value);
  if (!normalized) {
    return "";
  }

  const weekMatch = normalized.match(/^week\\s*(\\d+)$/i);
  if (weekMatch) {
    return `Week ${weekMatch[1]}`;
  }

  return normalized;
}

function buildCreateAttributes(
  request: BusinessAccountCreateRequest,
): Array<Record<string, { value: string }>> {
  const attributes: Array<{ id: string; value: string }> = [
    { id: "CLIENTTYPE", value: request.category },
    { id: "INDUSTRY", value: canonicalIndustryType(request.industryType) },
    { id: "INDSUBCATE", value: canonicalSubCategory(request.subCategory) },
    { id: "REGION", value: canonicalCompanyRegion(request.companyRegion) },
  ];

  const canonicalizedWeek = canonicalWeek(request.week);
  if (canonicalizedWeek) {
    attributes.push({ id: "WEEK", value: canonicalizedWeek });
  }

  return attributes.map((attribute) => ({
    AttributeID: {
      value: attribute.id,
    },
    Value: {
      value: attribute.value,
    },
  }));
}

export function buildBusinessAccountCreatePayload(
  request: BusinessAccountCreateRequest,
): Record<string, unknown> {
  const classConfig = BUSINESS_ACCOUNT_CLASS_MAP[request.classId];

  return {
    Name: {
      value: request.companyName,
    },
    ClassID: {
      value: classConfig.classId,
    },
    Type: {
      value: classConfig.type,
    },
    Owner: {
      value: request.salesRepId ?? "",
    },
    MainAddress: {
      AddressLine1: {
        value: request.addressLine1,
      },
      AddressLine2: {
        value: request.addressLine2,
      },
      City: {
        value: request.city,
      },
      State: {
        value: request.state,
      },
      PostalCode: {
        value: request.postalCode,
      },
      Country: {
        value: request.country,
      },
    },
    Attributes: buildCreateAttributes(request),
  };
}

export function buildContactCreatePayload(input: {
  request: BusinessAccountContactCreateRequest;
  businessAccountId: string;
  companyName: string;
}): Record<string, unknown> {
  const name = splitContactName(input.request.displayName);
  return {
    DisplayName: {
      value: input.request.displayName,
    },
    ...(name.firstName
      ? {
          FirstName: {
            value: name.firstName,
          },
        }
      : {}),
    LastName: {
      value: name.lastName,
    },
    JobTitle: {
      value: input.request.jobTitle,
    },
    Email: {
      value: input.request.email,
    },
    Phone1: {
      value: input.request.phone1,
    },
    ContactClass: {
      value: CONTACT_CLASS_VALUE_MAP[input.request.contactClass],
    },
    BusinessAccount: {
      value: input.businessAccountId,
    },
    CompanyName: {
      value: input.companyName,
    },
    Type: {
      value: "Contact",
    },
  };
}

export function normalizeCreatedBusinessAccountRows(rawAccount: unknown): BusinessAccountRow[] {
  const rows = normalizeBusinessAccountRows(rawAccount);
  if (rows.length > 0) {
    return rows;
  }

  return [normalizeBusinessAccount(rawAccount)];
}

export function isValidCategoryValue(value: string): value is Category {
  return (CATEGORY_VALUES as readonly string[]).includes(value);
}
