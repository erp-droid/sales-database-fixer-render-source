export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { requireAuthCookieValue } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import {
  applyReadModelBlankFieldPatch,
  type ReadModelBlankFieldPatchPlan,
} from "@/lib/read-model/blank-field-patch";
import type { BusinessAccountRow } from "@/types/business-account";

const rowSchema = z.object({
  id: z.string().min(1),
  accountRecordId: z.string().nullable().optional(),
  businessAccountId: z.string().min(1),
  companyName: z.string().min(1),
  address: z.string().optional().default(""),
  addressLine1: z.string().optional().default(""),
  addressLine2: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  postalCode: z.string().optional().default(""),
  country: z.string().optional().default("CA"),
  phoneNumber: z.string().nullable().optional(),
  companyPhone: z.string().nullable().optional(),
  companyPhoneSource: z.string().nullable().optional(),
  salesRepId: z.string().nullable().optional(),
  salesRepName: z.string().nullable().optional(),
  accountType: z.string().nullable().optional(),
  opportunityCount: z.number().nullable().optional(),
  industryType: z.string().nullable().optional(),
  subCategory: z.string().nullable().optional(),
  companyRegion: z.string().nullable().optional(),
  week: z.string().nullable().optional(),
  category: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  notes: z.string().nullable().optional(),
  lastCalledAt: z.string().nullable().optional(),
  lastEmailedAt: z.string().nullable().optional(),
  lastModifiedIso: z.string().nullable().optional(),
  rowKey: z.string().optional(),
  contactId: z.number().nullable().optional(),
  isPrimaryContact: z.boolean(),
  primaryContactName: z.string().nullable().optional(),
  primaryContactJobTitle: z.string().nullable().optional(),
  primaryContactPhone: z.string().nullable().optional(),
  primaryContactExtension: z.string().nullable().optional(),
  primaryContactRawPhone: z.string().nullable().optional(),
  primaryContactEmail: z.string().nullable().optional(),
  primaryContactId: z.number().nullable().optional(),
  companyDescription: z.string().nullable().optional(),
  marketingEligible: z.boolean().optional(),
});

const enrichmentSchema = z.object({
  accountRecordId: z.string().min(1),
  businessAccountId: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  fields: z.object({
    industryType: z.string().nullable().optional(),
    subCategory: z.string().nullable().optional(),
    companyDescription: z.string().nullable().optional(),
  }),
});

const missingAccountSchema = z.object({
  accountRecordId: z.string().min(1),
  businessAccountId: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  companyDescription: z.string().nullable().optional(),
  category: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  marketingEligible: z.boolean().nullable().optional(),
  rowsToWrite: z.array(rowSchema).min(1),
});

const requestSchema = z.object({
  dryRun: z.boolean().optional(),
  plan: z.object({
    missingAccounts: z.array(missingAccountSchema).optional(),
    enrichExistingAccounts: z.array(enrichmentSchema).optional(),
  }),
});

type ParsedRow = z.infer<typeof rowSchema>;
type ParsedRequest = z.infer<typeof requestSchema>;

function coerceRow(row: ParsedRow): BusinessAccountRow {
  return {
    ...row,
    accountRecordId: row.accountRecordId ?? undefined,
    phoneNumber: row.phoneNumber ?? null,
    companyPhone: row.companyPhone ?? null,
    companyPhoneSource:
      row.companyPhoneSource === "account" ||
      row.companyPhoneSource === "placeholder" ||
      row.companyPhoneSource === "fallback"
        ? row.companyPhoneSource
        : null,
    salesRepId: row.salesRepId ?? null,
    salesRepName: row.salesRepName ?? null,
    accountType:
      row.accountType === "Lead" || row.accountType === "Customer" ? row.accountType : null,
    opportunityCount: row.opportunityCount ?? null,
    industryType: row.industryType ?? null,
    subCategory: row.subCategory ?? null,
    companyRegion: row.companyRegion ?? null,
    week: row.week ?? null,
    category: row.category ?? null,
    notes: row.notes ?? null,
    lastCalledAt: row.lastCalledAt ?? null,
    lastEmailedAt: row.lastEmailedAt ?? null,
    lastModifiedIso: row.lastModifiedIso ?? null,
    rowKey: row.rowKey,
    contactId: row.contactId ?? null,
    primaryContactName: row.primaryContactName ?? null,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone: row.primaryContactPhone ?? null,
    primaryContactExtension: row.primaryContactExtension ?? null,
    primaryContactRawPhone: row.primaryContactRawPhone ?? null,
    primaryContactEmail: row.primaryContactEmail ?? null,
    primaryContactId: row.primaryContactId ?? null,
    companyDescription: row.companyDescription ?? null,
    marketingEligible: row.marketingEligible,
  };
}

function coercePlan(parsed: ParsedRequest): ReadModelBlankFieldPatchPlan {
  return {
    missingAccounts: parsed.plan.missingAccounts?.map((account) => ({
      ...account,
      businessAccountId: account.businessAccountId ?? null,
      companyName: account.companyName ?? null,
      companyDescription: account.companyDescription ?? null,
      category: account.category ?? null,
      marketingEligible: account.marketingEligible ?? null,
      rowsToWrite: account.rowsToWrite.map(coerceRow),
    })),
    enrichExistingAccounts: parsed.plan.enrichExistingAccounts?.map((account) => ({
      ...account,
      businessAccountId: account.businessAccountId ?? null,
      companyName: account.companyName ?? null,
    })),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);

    const body = await request.json().catch(() => {
      throw new Error("Request body must be valid JSON.");
    });
    const parsed = requestSchema.parse(body);
    const result = applyReadModelBlankFieldPatch(coercePlan(parsed), {
      dryRun: parsed.dryRun === true,
    });

    return NextResponse.json(result, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid patch payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    const status = getErrorMessage(error).toLowerCase().includes("not authenticated")
      ? 401
      : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
