import { z } from "zod";

import {
  CATEGORY_VALUES,
  type BusinessAccountUpdateRequest,
  type Category,
  type SortBy,
  type SortDir,
} from "@/types/business-account";

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
  "category",
  "lastModifiedIso",
] as const;

const sortDirValues = ["asc", "desc"] as const;

const phoneRegex = /^[0-9()+\-\s]{7,30}$/;

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

const nullableStringSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => emptyToNull(value ?? null));

const nullablePhoneSchema = nullableStringSchema
  .refine((value) => value === null || phoneRegex.test(value), {
    message:
      "Primary contact phone can contain digits, spaces, and +-( ) characters only.",
  });

const nullableEmailSchema = nullableStringSchema
  .refine((value) => value === null || z.string().email().safeParse(value).success, {
    message: "Primary contact email must be a valid email address.",
  });

export const updateRequestSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(255),
  addressLine1: z.string().trim().min(1, "Address line 1 is required").max(255),
  addressLine2: z.string().trim().max(255).default(""),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().trim().min(1, "Province/State is required").max(100),
  postalCode: z.string().trim().min(1, "Postal code is required").max(20),
  country: z.string().trim().min(2, "Country is required").max(3),
  salesRepId: nullableStringSchema.default(null),
  salesRepName: nullableStringSchema.default(null),
  primaryContactName: nullableStringSchema,
  primaryContactPhone: nullablePhoneSchema,
  primaryContactEmail: nullableEmailSchema,
  category: nullableStringSchema
    .refine((value) => value === null || (CATEGORY_VALUES as readonly string[]).includes(value), {
      message: "Category must be one of A, B, C, or D.",
    })
    .transform((value) => value as Category | null),
  notes: nullableStringSchema,
  expectedLastModified: z.union([z.string(), z.null()]),
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
  filterCategory?: Category;
  filterLastModified?: string;
  sortBy?: SortBy;
  sortDir?: SortDir;
  page: number;
  pageSize: number;
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
    filterLastModified: normalizeOptionalFilter(parsed.filterLastModified),
  };
}

export function parseUpdatePayload(payload: unknown): BusinessAccountUpdateRequest {
  return updateRequestSchema.parse(payload);
}
