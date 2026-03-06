import { z } from "zod";

import {
  CATEGORY_VALUES,
  type BusinessAccountUpdateRequest,
  type Category,
  type SortBy,
  type SortDir,
} from "@/types/business-account";
import {
  BUSINESS_ACCOUNT_CLASS_CODES,
  CONTACT_CLASS_KEYS,
  type BusinessAccountCreateRequest,
  type BusinessAccountContactCreateRequest,
} from "@/types/business-account-create";
import {
  DATA_QUALITY_BASIS_VALUES,
  DATA_QUALITY_METRIC_KEYS,
  type DataQualityBasis,
  type DataQualityMetricKey,
} from "@/types/data-quality";
import {
  CONTACT_MERGE_FIELD_KEYS,
  type ContactMergeRequest,
} from "@/types/contact-merge";
import { normalizePhoneForSave } from "@/lib/phone";

const sortByValues = [
  "companyName",
  "salesRepName",
  "industryType",
  "subCategory",
  "companyRegion",
  "week",
  "address",
  "primaryContactName",
  "primaryContactPhone",
  "primaryContactEmail",
  "notes",
  "category",
  "lastModifiedIso",
] as const;

const sortDirValues = ["asc", "desc"] as const;

export const listQuerySchema = z.object({
  q: z.string().optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  filterCompanyName: z.string().optional(),
  filterSalesRep: z.string().optional(),
  filterIndustryType: z.string().optional(),
  filterSubCategory: z.string().optional(),
  filterCompanyRegion: z.string().optional(),
  filterWeek: z.string().optional(),
  filterAddress: z.string().optional(),
  filterPrimaryContactName: z.string().optional(),
  filterPrimaryContactPhone: z.string().optional(),
  filterPrimaryContactEmail: z.string().optional(),
  filterNotes: z.string().optional(),
  filterCategory: z.enum(CATEGORY_VALUES).optional(),
  filterLastModified: z.string().optional(),
  sortBy: z.enum(sortByValues).optional(),
  sortDir: z.enum(sortDirValues).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

const emptyToNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const normalizeCountryCode = (value: string | null | undefined): string => {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!normalized || normalized === "CA" || normalized === "CAN") {
    return "CA";
  }

  return normalized.slice(0, 3);
};

const nullableStringSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => emptyToNull(value ?? null));

const nullableEmailSchema = nullableStringSchema
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: "Primary contact email must be a valid email address.",
  });

export const updateRequestSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(255),
  assignedBusinessAccountRecordId: nullableStringSchema.default(null),
  assignedBusinessAccountId: nullableStringSchema.default(null),
  addressLine1: z.string().trim().min(1, "Address line 1 is required").max(255),
  addressLine2: z.string().trim().max(255).default(""),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().trim().min(1, "Province/State is required").max(100),
  postalCode: z.string().trim().min(1, "Postal code is required").max(20),
  country: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => normalizeCountryCode(value ?? null))
    .refine((value) => value.length >= 2 && value.length <= 3, {
      message: "Country is required.",
    }),
  targetContactId: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    })
    .default(null),
  setAsPrimaryContact: z.boolean().default(false),
  primaryOnlyIntent: z.boolean().default(false),
  salesRepId: nullableStringSchema.default(null),
  salesRepName: nullableStringSchema.default(null),
  industryType: nullableStringSchema.default(null),
  subCategory: nullableStringSchema.default(null),
  companyRegion: nullableStringSchema.default(null),
  week: nullableStringSchema.default(null),
  primaryContactName: nullableStringSchema,
  primaryContactPhone: nullableStringSchema,
  primaryContactEmail: nullableEmailSchema,
  category: nullableStringSchema
    .refine((value) => value === null || (CATEGORY_VALUES as readonly string[]).includes(value), {
      message: "Category must be one of A, B, C, or D.",
    })
    .transform((value) => value as Category | null),
  notes: nullableStringSchema,
  expectedLastModified: z.union([z.string(), z.null()]),
});

export const businessAccountCreateRequestSchema = z.object({
  companyName: z.string().trim().min(1, "Account name is required.").max(255),
  classId: z.enum(BUSINESS_ACCOUNT_CLASS_CODES, {
    required_error: "Business account class is required.",
    invalid_type_error: "Business account class is required.",
  }),
  salesRepId: nullableStringSchema.default(null),
  salesRepName: nullableStringSchema.default(null),
  industryType: z.string().trim().min(1, "Industry Type is required.").max(255),
  subCategory: z
    .string()
    .trim()
    .min(1, "Industry Type Sub-Category is required.")
    .max(255),
  companyRegion: z.string().trim().min(1, "Company Region is required.").max(255),
  week: nullableStringSchema.default(null),
  category: z.enum(CATEGORY_VALUES, {
    required_error: "Client Type is required.",
    invalid_type_error: "Client Type is required.",
  }),
  addressLookupId: z.string().trim().min(1, "Select a Canada Post address."),
  addressLine1: z.string().trim().min(1, "Address Line 1 is required.").max(255),
  addressLine2: z.string().trim().max(255).default(""),
  city: z.string().trim().min(1, "City is required.").max(100),
  state: z.string().trim().min(1, "Province/State is required.").max(100),
  postalCode: z.string().trim().min(1, "Postal code is required.").max(20),
  country: z
    .union([z.string(), z.null(), z.undefined()])
    .transform(() => "CA" as const),
}).superRefine((value, ctx) => {
  if ((value.salesRepName && !value.salesRepId) || (value.salesRepId && !value.salesRepName)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Sales Rep must include both employee ID and name.",
      path: ["salesRepId"],
    });
  }
});

export const businessAccountContactCreateRequestSchema = z.object({
  displayName: z.string().trim().min(1, "Contact name is required.").max(255),
  jobTitle: z.string().trim().min(1, "Job Title is required.").max(255),
  email: z.string().trim().email("Email must be a valid email address."),
  phone1: z
    .string()
    .trim()
    .min(1, "Phone Number is required.")
    .refine((value) => normalizePhoneForSave(value) !== null, {
      message: "Phone number must use the format ###-###-####.",
    })
    .transform((value) => normalizePhoneForSave(value) as string),
  contactClass: z.enum(CONTACT_CLASS_KEYS, {
    required_error: "Contact class is required.",
    invalid_type_error: "Contact class is required.",
  }),
});

export const dataQualityIssuesQuerySchema = z.object({
  metric: z.enum(DATA_QUALITY_METRIC_KEYS),
  basis: z.enum(DATA_QUALITY_BASIS_VALUES).default("row"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const dataQualityBasisQuerySchema = z.object({
  basis: z.enum(DATA_QUALITY_BASIS_VALUES).default("row"),
});

export const dataQualityStatusPayloadSchema = z.object({
  action: z.enum(["review", "unreview"]),
  issueKeys: z.array(z.string().min(1)).min(1).max(200),
});

const contactMergeFieldChoiceSchema = z.object({
  field: z.enum(CONTACT_MERGE_FIELD_KEYS),
  source: z.enum(["keep", "delete"]),
});

export const contactMergePreviewQuerySchema = z
  .object({
    businessAccountRecordId: z.string().trim().min(1, "Business account record ID is required."),
    keepContactId: z.coerce.number().int().positive(),
    deleteContactId: z.coerce.number().int().positive(),
  })
  .refine((value) => value.keepContactId !== value.deleteContactId, {
    message: "Keep and delete contact IDs must be different.",
    path: ["deleteContactId"],
  });

export const contactMergeRequestSchema = z
  .object({
    businessAccountRecordId: z.string().trim().min(1, "Business account record ID is required."),
    businessAccountId: z.string().trim().min(1, "Business account ID is required."),
    keepContactId: z.number().int().positive(),
    deleteContactId: z.number().int().positive(),
    setKeptAsPrimary: z.boolean(),
    expectedAccountLastModified: z.union([z.string(), z.null()]),
    expectedKeepContactLastModified: z.union([z.string(), z.null()]),
    expectedDeleteContactLastModified: z.union([z.string(), z.null()]),
    fieldChoices: z.array(contactMergeFieldChoiceSchema).min(1),
  })
  .refine((value) => value.keepContactId !== value.deleteContactId, {
    message: "Keep and delete contact IDs must be different.",
    path: ["deleteContactId"],
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();

    value.fieldChoices.forEach((choice, index) => {
      if (seen.has(choice.field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Field choices cannot contain duplicates.",
          path: ["fieldChoices", index, "field"],
        });
        return;
      }

      seen.add(choice.field);
    });
  });

export type ParsedListQuery = {
  q?: string;
  category?: Category;
  filterCompanyName?: string;
  filterSalesRep?: string;
  filterIndustryType?: string;
  filterSubCategory?: string;
  filterCompanyRegion?: string;
  filterWeek?: string;
  filterAddress?: string;
  filterPrimaryContactName?: string;
  filterPrimaryContactPhone?: string;
  filterPrimaryContactEmail?: string;
  filterNotes?: string;
  filterCategory?: Category;
  filterLastModified?: string;
  sortBy?: SortBy;
  sortDir?: SortDir;
  page: number;
  pageSize: number;
};

export type ParsedDataQualityIssuesQuery = {
  metric: DataQualityMetricKey;
  basis: DataQualityBasis;
  page: number;
  pageSize: number;
};

export type ParsedDataQualityBasisQuery = {
  basis: DataQualityBasis;
};

export type ParsedDataQualityStatusPayload = {
  action: "review" | "unreview";
  issueKeys: string[];
};

export type ParsedContactMergePreviewQuery = {
  businessAccountRecordId: string;
  keepContactId: number;
  deleteContactId: number;
};

function normalizeOptionalFilter(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseListQuery(queryParams: URLSearchParams): ParsedListQuery {
  const parsed = listQuerySchema.parse({
    q: queryParams.get("q") ?? undefined,
    category: queryParams.get("category") ?? undefined,
    filterCompanyName: queryParams.get("filterCompanyName") ?? undefined,
    filterSalesRep: queryParams.get("filterSalesRep") ?? undefined,
    filterIndustryType: queryParams.get("filterIndustryType") ?? undefined,
    filterSubCategory: queryParams.get("filterSubCategory") ?? undefined,
    filterCompanyRegion: queryParams.get("filterCompanyRegion") ?? undefined,
    filterWeek: queryParams.get("filterWeek") ?? undefined,
    filterAddress: queryParams.get("filterAddress") ?? undefined,
    filterPrimaryContactName: queryParams.get("filterPrimaryContactName") ?? undefined,
    filterPrimaryContactPhone: queryParams.get("filterPrimaryContactPhone") ?? undefined,
    filterPrimaryContactEmail: queryParams.get("filterPrimaryContactEmail") ?? undefined,
    filterNotes: queryParams.get("filterNotes") ?? undefined,
    filterCategory: queryParams.get("filterCategory") ?? undefined,
    filterLastModified: queryParams.get("filterLastModified") ?? undefined,
    sortBy: queryParams.get("sortBy") ?? undefined,
    sortDir: queryParams.get("sortDir") ?? undefined,
    page: queryParams.get("page") ?? undefined,
    pageSize: queryParams.get("pageSize") ?? undefined,
  });

  return {
    ...parsed,
    q: normalizeOptionalFilter(parsed.q),
    filterCompanyName: normalizeOptionalFilter(parsed.filterCompanyName),
    filterSalesRep: normalizeOptionalFilter(parsed.filterSalesRep),
    filterIndustryType: normalizeOptionalFilter(parsed.filterIndustryType),
    filterSubCategory: normalizeOptionalFilter(parsed.filterSubCategory),
    filterCompanyRegion: normalizeOptionalFilter(parsed.filterCompanyRegion),
    filterWeek: normalizeOptionalFilter(parsed.filterWeek),
    filterAddress: normalizeOptionalFilter(parsed.filterAddress),
    filterPrimaryContactName: normalizeOptionalFilter(parsed.filterPrimaryContactName),
    filterPrimaryContactPhone: normalizeOptionalFilter(parsed.filterPrimaryContactPhone),
    filterPrimaryContactEmail: normalizeOptionalFilter(parsed.filterPrimaryContactEmail),
    filterNotes: normalizeOptionalFilter(parsed.filterNotes),
    filterLastModified: normalizeOptionalFilter(parsed.filterLastModified),
  };
}

export function parseUpdatePayload(payload: unknown): BusinessAccountUpdateRequest {
  return updateRequestSchema.parse(payload);
}

export function parseBusinessAccountCreatePayload(
  payload: unknown,
): BusinessAccountCreateRequest {
  return businessAccountCreateRequestSchema.parse(payload);
}

export function parseBusinessAccountContactCreatePayload(
  payload: unknown,
): BusinessAccountContactCreateRequest {
  return businessAccountContactCreateRequestSchema.parse(payload);
}

export function parseDataQualityIssuesQuery(
  queryParams: URLSearchParams,
): ParsedDataQualityIssuesQuery {
  return dataQualityIssuesQuerySchema.parse({
    metric: queryParams.get("metric") ?? undefined,
    basis: queryParams.get("basis") ?? undefined,
    page: queryParams.get("page") ?? undefined,
    pageSize: queryParams.get("pageSize") ?? undefined,
  });
}

export function parseDataQualityBasisQuery(
  queryParams: URLSearchParams,
): ParsedDataQualityBasisQuery {
  return dataQualityBasisQuerySchema.parse({
    basis: queryParams.get("basis") ?? undefined,
  });
}

export function parseDataQualityStatusPayload(
  payload: unknown,
): ParsedDataQualityStatusPayload {
  return dataQualityStatusPayloadSchema.parse(payload);
}

export function parseContactMergePreviewQuery(
  queryParams: URLSearchParams,
): ParsedContactMergePreviewQuery {
  return contactMergePreviewQuerySchema.parse({
    businessAccountRecordId: queryParams.get("businessAccountRecordId") ?? undefined,
    keepContactId: queryParams.get("keepContactId") ?? undefined,
    deleteContactId: queryParams.get("deleteContactId") ?? undefined,
  });
}

export function parseContactMergePayload(payload: unknown): ContactMergeRequest {
  return contactMergeRequestSchema.parse(payload);
}
