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
  OPPORTUNITY_PROJECT_TYPE_VALUES,
  OPPORTUNITY_WILL_WIN_JOB_VALUES,
  type OpportunityCreateRequest,
} from "@/types/opportunity-create";
import {
  MEETING_PRIORITY_VALUES,
  type MeetingCreateRequest,
} from "@/types/meeting-create";
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
import type { CompanyAttributeSuggestionRequest } from "@/types/company-attribute-suggestion";
import { buildMeetingDateTimeRange } from "@/lib/meeting-create";
import { normalizeExtensionForSave, normalizePhoneForSave } from "@/lib/phone";

const sortByValues = [
  "companyName",
  "salesRepName",
  "industryType",
  "subCategory",
  "companyRegion",
  "week",
  "address",
  "companyPhone",
  "primaryContactName",
  "primaryContactJobTitle",
  "primaryContactPhone",
  "primaryContactExtension",
  "primaryContactEmail",
  "notes",
  "category",
  "lastEmailedAt",
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
  filterPrimaryContactJobTitle: z.string().optional(),
  filterPrimaryContactPhone: z.string().optional(),
  filterPrimaryContactExtension: z.string().optional(),
  filterPrimaryContactEmail: z.string().optional(),
  filterNotes: z.string().optional(),
  filterCategory: z.enum(CATEGORY_VALUES).optional(),
  filterLastEmailed: z.string().optional(),
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

const nullablePhoneSchema = nullableStringSchema
  .refine((value) => value === null || normalizePhoneForSave(value) !== null, {
    message: "Phone number must use the format ###-###-####.",
  })
  .transform((value) => {
    if (value === null) {
      return null;
    }

    return normalizePhoneForSave(value) as string;
  });

const nullableExtensionSchema = nullableStringSchema
  .refine((value) => {
    if (value === null) {
      return true;
    }

    const normalized = normalizeExtensionForSave(value);
    return normalized !== null && /^[0-9]{1,5}$/.test(normalized);
  }, {
    message: "Extension must use 1 to 5 digits.",
  })
  .transform((value) => {
    if (value === null) {
      return null;
    }

    return normalizeExtensionForSave(value) as string;
  });

const nullableCountrySchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : normalizeCountryCode(trimmed);
  });

const nullableExpectedLastModifiedSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => value ?? null);

export const updateRequestSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(255),
  companyDescription: nullableStringSchema.default(null),
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
  contactOnlyIntent: z.boolean().default(false),
  salesRepId: nullableStringSchema.default(null),
  salesRepName: nullableStringSchema.default(null),
  industryType: nullableStringSchema.default(null),
  subCategory: nullableStringSchema.default(null),
  companyRegion: nullableStringSchema.default(null),
  week: nullableStringSchema.default(null),
  companyPhone: nullablePhoneSchema.default(null),
  primaryContactName: nullableStringSchema,
  primaryContactJobTitle: nullableStringSchema.default(null),
  primaryContactPhone: nullablePhoneSchema,
  primaryContactExtension: nullableExtensionSchema.default(null),
  primaryContactEmail: nullableEmailSchema,
  category: nullableStringSchema
    .refine((value) => value === null || (CATEGORY_VALUES as readonly string[]).includes(value), {
      message: "Category must be one of A, B, C, or D.",
    })
    .transform((value) => value as Category | null),
  notes: nullableStringSchema,
  expectedLastModified: z.union([z.string(), z.null()]),
});

const contactOnlyUpdateRequestSchema = z.object({
  companyName: nullableStringSchema.default(null),
  companyDescription: nullableStringSchema.default(null),
  assignedBusinessAccountRecordId: nullableStringSchema.default(null),
  assignedBusinessAccountId: nullableStringSchema.default(null),
  addressLine1: nullableStringSchema.default(null),
  addressLine2: nullableStringSchema.default(null),
  city: nullableStringSchema.default(null),
  state: nullableStringSchema.default(null),
  postalCode: nullableStringSchema.default(null),
  country: nullableCountrySchema.default(null),
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
  contactOnlyIntent: z.boolean().default(false),
  salesRepId: nullableStringSchema.default(null),
  salesRepName: nullableStringSchema.default(null),
  industryType: nullableStringSchema.default(null),
  subCategory: nullableStringSchema.default(null),
  companyRegion: nullableStringSchema.default(null),
  week: nullableStringSchema.default(null),
  companyPhone: nullablePhoneSchema.default(null),
  primaryContactName: nullableStringSchema.default(null),
  primaryContactJobTitle: nullableStringSchema.default(null),
  primaryContactPhone: nullablePhoneSchema.default(null),
  primaryContactExtension: nullableExtensionSchema.default(null),
  primaryContactEmail: nullableEmailSchema.default(null),
  category: nullableStringSchema
    .refine((value) => value === null || (CATEGORY_VALUES as readonly string[]).includes(value), {
      message: "Category must be one of A, B, C, or D.",
    })
    .transform((value) => value as Category | null)
    .default(null),
  notes: nullableStringSchema.default(null),
  expectedLastModified: nullableExpectedLastModifiedSchema,
});

export const businessAccountCreateRequestSchema = z.object({
  companyName: z.string().trim().min(1, "Account name is required.").max(255),
  companyDescription: nullableStringSchema.default(null),
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

export const companyAttributeSuggestionRequestSchema = z.object({
  companyName: nullableStringSchema.default(null),
  companyDescription: nullableStringSchema.default(null),
  businessAccountId: nullableStringSchema.default(null),
  addressLine1: nullableStringSchema.default(null),
  city: nullableStringSchema.default(null),
  state: nullableStringSchema.default(null),
  postalCode: nullableStringSchema.default(null),
  country: nullableStringSchema.default(null),
  contactEmail: nullableStringSchema.default(null),
  companyRegion: nullableStringSchema.default(null),
  industryType: nullableStringSchema.default(null),
  subCategory: nullableStringSchema.default(null),
  category: nullableStringSchema.default(null),
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

export const opportunityCreateRequestSchema = z
  .object({
    businessAccountRecordId: z
      .string()
      .trim()
      .min(1, "Business account record ID is required."),
    businessAccountId: z
      .string()
      .trim()
      .min(1, "Business account ID is required."),
    contactId: z.coerce.number().int().positive("Contact selection is required."),
    subject: z.string().trim().min(1, "Project description is required.").max(255),
    classId: z.string().trim().min(1, "Opportunity class is required.").max(100),
    location: z.string().trim().max(100).default(""),
    stage: z.string().trim().max(100).default(""),
    estimationDate: z.string().trim().min(1, "Estimation date is required."),
    note: nullableStringSchema.default(null),
    willWinJob: z.enum(OPPORTUNITY_WILL_WIN_JOB_VALUES, {
      required_error: "Do you think we are going to win this job? is required.",
      invalid_type_error: "Do you think we are going to win this job? is required.",
    }),
    linkToDrive: z.string().trim().min(1, "Link to Drive is required.").max(500),
    projectType: z.enum(OPPORTUNITY_PROJECT_TYPE_VALUES, {
      required_error: "Project Type is required.",
      invalid_type_error: "Project Type is required.",
    }),
    ownerId: nullableStringSchema.default(null),
    ownerName: nullableStringSchema.default(null),
  })
  .superRefine((value, ctx) => {
    if (!value.ownerId && !value.ownerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Estimator is required.",
        path: ["ownerName"],
      });
    }
  });

export const meetingCreateRequestSchema = z
  .object({
    businessAccountRecordId: nullableStringSchema.default(null),
    businessAccountId: nullableStringSchema.default(null),
    sourceContactId: z
      .union([z.number(), z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      })
      .default(null),
    organizerContactId: z
      .union([z.number(), z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      })
      .default(null),
    includeOrganizerInAcumatica: z.coerce.boolean().default(false),
    relatedContactId: z.coerce.number().int().positive("Related contact is required."),
    summary: z.string().trim().min(1, "Summary is required.").max(255),
    location: nullableStringSchema.default(null),
    timeZone: z.string().trim().min(1, "Time zone is required.").max(100),
    startDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must use YYYY-MM-DD format."),
    startTime: z
      .string()
      .trim()
      .regex(/^\d{2}:\d{2}$/, "Start time must use HH:mm format."),
    endDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "End date must use YYYY-MM-DD format."),
    endTime: z
      .string()
      .trim()
      .regex(/^\d{2}:\d{2}$/, "End time must use HH:mm format."),
    priority: z.enum(MEETING_PRIORITY_VALUES, {
      required_error: "Priority is required.",
      invalid_type_error: "Priority is required.",
    }),
    details: nullableStringSchema.default(null),
    attendeeContactIds: z
      .array(z.coerce.number().int().positive("Attendee contact IDs must be positive numbers."))
      .default([]),
    attendeeEmails: z
      .array(z.string().trim().email("Attendee email addresses must be valid email addresses."))
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.includeOrganizerInAcumatica && value.organizerContactId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Organizer contact is required when including yourself in Acumatica.",
        path: ["organizerContactId"],
      });
    }

    try {
      buildMeetingDateTimeRange(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error ? error.message : "Meeting end must be after the start.",
        path: ["endTime"],
      });
    }
  });

export const deleteReasonRequestSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required.").max(1000),
});

export const dataQualityIssuesQuerySchema = z.object({
  metric: z.enum(DATA_QUALITY_METRIC_KEYS),
  basis: z.enum(DATA_QUALITY_BASIS_VALUES).default("row"),
  salesRep: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const dataQualityBasisQuerySchema = z.object({
  basis: z.enum(DATA_QUALITY_BASIS_VALUES).default("row"),
});

export const dataQualityStatusPayloadSchema = z.object({
  action: z.enum(["review", "unreview"]),
  issueKeys: z.array(z.string().min(1)).min(1).max(200),
  reviewKeys: z.array(z.string().min(1)).max(200).optional(),
});

const contactMergeFieldChoiceSchema = z.object({
  field: z.enum(CONTACT_MERGE_FIELD_KEYS),
  sourceContactId: z.number().int().positive(),
});

const contactMergeExpectedContactLastModifiedSchema = z.object({
  contactId: z.number().int().positive(),
  lastModified: z.union([z.string(), z.null()]),
});

export const contactMergePreviewQuerySchema = z
  .object({
    businessAccountRecordId: z.string().trim().min(1, "Business account record ID is required."),
    keepContactId: z.coerce.number().int().positive(),
    contactIds: z.array(z.coerce.number().int().positive()).min(
      2,
      "Select at least 2 contacts to merge.",
    ),
  })
  .superRefine((value, ctx) => {
    const selectedIds = new Set<number>();

    value.contactIds.forEach((contactId, index) => {
      if (selectedIds.has(contactId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selected contact IDs must be unique.",
          path: ["contactIds", index],
        });
        return;
      }

      selectedIds.add(contactId);
    });

    if (!selectedIds.has(value.keepContactId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Keep contact ID must be included in the selected contacts.",
        path: ["keepContactId"],
      });
    }
  });

export const contactMergeRequestSchema = z
  .object({
    businessAccountRecordId: z.string().trim().min(1, "Business account record ID is required."),
    businessAccountId: z.string().trim().min(1, "Business account ID is required."),
    keepContactId: z.number().int().positive(),
    selectedContactIds: z.array(z.number().int().positive()).min(
      2,
      "Select at least 2 contacts to merge.",
    ),
    setKeptAsPrimary: z.boolean(),
    expectedAccountLastModified: z.union([z.string(), z.null()]),
    expectedContactLastModifieds: z.array(contactMergeExpectedContactLastModifiedSchema).min(2),
    fieldChoices: z.array(contactMergeFieldChoiceSchema).min(1),
  })
  .superRefine((value, ctx) => {
    const selectedIds = new Set<number>();

    value.selectedContactIds.forEach((contactId, index) => {
      if (selectedIds.has(contactId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selected contact IDs must be unique.",
          path: ["selectedContactIds", index],
        });
        return;
      }

      selectedIds.add(contactId);
    });

    if (!selectedIds.has(value.keepContactId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Keep contact ID must be included in the selected contacts.",
        path: ["keepContactId"],
      });
    }

    const timestampIds = new Set<number>();
    value.expectedContactLastModifieds.forEach((entry, index) => {
      if (!selectedIds.has(entry.contactId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected contact timestamps must match the selected contacts.",
          path: ["expectedContactLastModifieds", index, "contactId"],
        });
        return;
      }

      if (timestampIds.has(entry.contactId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected contact timestamps cannot contain duplicates.",
          path: ["expectedContactLastModifieds", index, "contactId"],
        });
        return;
      }

      timestampIds.add(entry.contactId);
    });

    if (timestampIds.size !== selectedIds.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected contact timestamps must cover every selected contact.",
        path: ["expectedContactLastModifieds"],
      });
    }

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

      if (!selectedIds.has(choice.sourceContactId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Field choices must reference one of the selected contacts.",
          path: ["fieldChoices", index, "sourceContactId"],
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
  filterPrimaryContactJobTitle?: string;
  filterPrimaryContactPhone?: string;
  filterPrimaryContactExtension?: string;
  filterPrimaryContactEmail?: string;
  filterNotes?: string;
  filterCategory?: Category;
  filterLastEmailed?: string;
  filterLastModified?: string;
  sortBy?: SortBy;
  sortDir?: SortDir;
  page: number;
  pageSize: number;
};

export type ParsedDataQualityIssuesQuery = {
  metric: DataQualityMetricKey;
  basis: DataQualityBasis;
  salesRep?: string;
  page: number;
  pageSize: number;
};

export type ParsedDataQualityBasisQuery = {
  basis: DataQualityBasis;
};

export type ParsedDataQualityStatusPayload = {
  action: "review" | "unreview";
  issueKeys: string[];
  reviewKeys?: string[];
};

export type ParsedContactMergePreviewQuery = {
  businessAccountRecordId: string;
  keepContactId: number;
  contactIds: number[];
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
    filterPrimaryContactJobTitle:
      queryParams.get("filterPrimaryContactJobTitle") ?? undefined,
    filterPrimaryContactPhone: queryParams.get("filterPrimaryContactPhone") ?? undefined,
    filterPrimaryContactExtension:
      queryParams.get("filterPrimaryContactExtension") ?? undefined,
    filterPrimaryContactEmail: queryParams.get("filterPrimaryContactEmail") ?? undefined,
    filterNotes: queryParams.get("filterNotes") ?? undefined,
    filterCategory: queryParams.get("filterCategory") ?? undefined,
    filterLastEmailed: queryParams.get("filterLastEmailed") ?? undefined,
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
    filterPrimaryContactJobTitle: normalizeOptionalFilter(parsed.filterPrimaryContactJobTitle),
    filterPrimaryContactPhone: normalizeOptionalFilter(parsed.filterPrimaryContactPhone),
    filterPrimaryContactExtension: normalizeOptionalFilter(parsed.filterPrimaryContactExtension),
    filterPrimaryContactEmail: normalizeOptionalFilter(parsed.filterPrimaryContactEmail),
    filterNotes: normalizeOptionalFilter(parsed.filterNotes),
    filterLastEmailed: normalizeOptionalFilter(parsed.filterLastEmailed),
    filterLastModified: normalizeOptionalFilter(parsed.filterLastModified),
  };
}

export function parseUpdatePayload(payload: unknown): BusinessAccountUpdateRequest {
  return updateRequestSchema.parse(payload);
}

export function parseContactOnlyUpdatePayload(
  payload: unknown,
  fallback?: Partial<BusinessAccountUpdateRequest>,
): BusinessAccountUpdateRequest {
  const sanitizedPayload =
    payload && typeof payload === "object"
      ? {
          ...payload,
          // Contact-only saves should not be blocked by stale account-level placeholder phones.
          companyPhone: undefined,
        }
      : payload;
  const parsed = contactOnlyUpdateRequestSchema.parse(sanitizedPayload);

  return {
    companyName: parsed.companyName ?? fallback?.companyName ?? "",
    companyDescription: parsed.companyDescription ?? fallback?.companyDescription ?? null,
    assignedBusinessAccountRecordId: parsed.assignedBusinessAccountRecordId,
    assignedBusinessAccountId: parsed.assignedBusinessAccountId,
    addressLine1: parsed.addressLine1 ?? fallback?.addressLine1 ?? "",
    addressLine2: parsed.addressLine2 ?? fallback?.addressLine2 ?? "",
    city: parsed.city ?? fallback?.city ?? "",
    state: parsed.state ?? fallback?.state ?? "",
    postalCode: parsed.postalCode ?? fallback?.postalCode ?? "",
    country: parsed.country ?? fallback?.country ?? "CA",
    targetContactId: parsed.targetContactId,
    setAsPrimaryContact: parsed.setAsPrimaryContact,
    primaryOnlyIntent: parsed.primaryOnlyIntent,
    contactOnlyIntent: parsed.contactOnlyIntent,
    salesRepId: parsed.salesRepId ?? fallback?.salesRepId ?? null,
    salesRepName: parsed.salesRepName ?? fallback?.salesRepName ?? null,
    industryType: parsed.industryType ?? fallback?.industryType ?? null,
    subCategory: parsed.subCategory ?? fallback?.subCategory ?? null,
    companyRegion: parsed.companyRegion ?? fallback?.companyRegion ?? null,
    week: parsed.week ?? fallback?.week ?? null,
    companyPhone: parsed.companyPhone ?? fallback?.companyPhone ?? null,
    primaryContactName: parsed.primaryContactName ?? fallback?.primaryContactName ?? null,
    primaryContactJobTitle:
      parsed.primaryContactJobTitle ?? fallback?.primaryContactJobTitle ?? null,
    primaryContactPhone: parsed.primaryContactPhone ?? fallback?.primaryContactPhone ?? null,
    primaryContactExtension:
      parsed.primaryContactExtension ?? fallback?.primaryContactExtension ?? null,
    primaryContactEmail: parsed.primaryContactEmail ?? fallback?.primaryContactEmail ?? null,
    category: parsed.category ?? fallback?.category ?? null,
    notes: parsed.notes ?? fallback?.notes ?? null,
    expectedLastModified: parsed.expectedLastModified,
  };
}

export function parseBusinessAccountCreatePayload(
  payload: unknown,
): BusinessAccountCreateRequest {
  return businessAccountCreateRequestSchema.parse(payload);
}

export function parseCompanyAttributeSuggestionPayload(
  payload: unknown,
): CompanyAttributeSuggestionRequest {
  return companyAttributeSuggestionRequestSchema.parse(payload);
}

export function parseBusinessAccountContactCreatePayload(
  payload: unknown,
): BusinessAccountContactCreateRequest {
  return businessAccountContactCreateRequestSchema.parse(payload);
}

export function parseOpportunityCreatePayload(
  payload: unknown,
): OpportunityCreateRequest {
  return opportunityCreateRequestSchema.parse(payload);
}

export function parseMeetingCreatePayload(
  payload: unknown,
): MeetingCreateRequest {
  return meetingCreateRequestSchema.parse(payload);
}

export function parseDeleteReasonPayload(
  payload: unknown,
): { reason: string } {
  return deleteReasonRequestSchema.parse(payload);
}

export function parseDataQualityIssuesQuery(
  queryParams: URLSearchParams,
): ParsedDataQualityIssuesQuery {
  const parsed = dataQualityIssuesQuerySchema.parse({
    metric: queryParams.get("metric") ?? undefined,
    basis: queryParams.get("basis") ?? undefined,
    salesRep: queryParams.get("salesRep") ?? undefined,
    page: queryParams.get("page") ?? undefined,
    pageSize: queryParams.get("pageSize") ?? undefined,
  });

  return {
    ...parsed,
    salesRep: normalizeOptionalFilter(parsed.salesRep),
  };
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
    contactIds: queryParams.getAll("contactId"),
  });
}

export function parseContactMergePayload(payload: unknown): ContactMergeRequest {
  return contactMergeRequestSchema.parse(payload);
}
