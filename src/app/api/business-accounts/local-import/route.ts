import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { requireAuthCookieValue } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { replaceReadModelAccountRows } from "@/lib/read-model/accounts";
import { saveAccountCompanyDescription } from "@/lib/read-model/account-local-metadata";
import type { BusinessAccountRow } from "@/types/business-account";

const rowSchema = z.object({
  id: z.string().min(1),
  accountRecordId: z.string().nullable().optional(),
  businessAccountId: z.string().min(1),
  companyName: z.string().min(1),
  address: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
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

const accountSchema = z.object({
  accountRecordId: z.string().min(1),
  businessAccountId: z.string().nullable().optional(),
  companyName: z.string().min(1),
  companyDescription: z.string().nullable().optional(),
  category: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  marketingEligible: z.boolean().optional(),
  rowsToWrite: z.array(rowSchema).min(1),
});

const payloadSchema = z.object({
  accounts: z.array(accountSchema).min(1),
  dryRun: z.boolean().optional(),
  preserveLocalMetadata: z.boolean().optional(),
});

function coerceRows(rows: z.infer<typeof rowSchema>[]): BusinessAccountRow[] {
  return rows.map((row) => ({
    id: row.id,
    accountRecordId: row.accountRecordId ?? undefined,
    businessAccountId: row.businessAccountId,
    companyName: row.companyName,
    address: row.address ?? "",
    addressLine1: row.addressLine1 ?? "",
    addressLine2: row.addressLine2 ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    postalCode: row.postalCode ?? "",
    country: row.country ?? "",
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
      row.accountType === "Lead" || row.accountType === "Customer"
        ? row.accountType
        : "Lead",
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
    rowKey: row.rowKey ?? `${row.accountRecordId ?? row.id}:contact:${row.contactId ?? "row"}`,
    contactId: row.contactId ?? null,
    isPrimaryContact: row.isPrimaryContact,
    primaryContactName: row.primaryContactName ?? null,
    primaryContactJobTitle: row.primaryContactJobTitle ?? null,
    primaryContactPhone: row.primaryContactPhone ?? null,
    primaryContactExtension: row.primaryContactExtension ?? null,
    primaryContactRawPhone: row.primaryContactRawPhone ?? null,
    primaryContactEmail: row.primaryContactEmail ?? null,
    primaryContactId: row.primaryContactId ?? null,
    companyDescription: row.companyDescription ?? null,
    marketingEligible:
      typeof row.marketingEligible === "boolean" ? row.marketingEligible : undefined,
  }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);

    const body = await request.json().catch(() => {
      throw new HttpError(400, "Request body must be valid JSON.");
    });
    const payload = payloadSchema.parse(body);
    const dryRun = payload.dryRun === true;
    const preserveLocalMetadata = payload.preserveLocalMetadata === true;

    let importedAccounts = 0;
    let importedRows = 0;
    let metadataUpserts = 0;

    for (const account of payload.accounts) {
      const rowsToWrite = coerceRows(account.rowsToWrite);
      if (!dryRun) {
        replaceReadModelAccountRows(account.accountRecordId, rowsToWrite);
        if (!preserveLocalMetadata) {
          saveAccountCompanyDescription({
            accountRecordId: account.accountRecordId,
            businessAccountId: account.businessAccountId ?? rowsToWrite[0]?.businessAccountId ?? null,
            companyDescription: account.companyDescription ?? null,
            category: account.category ?? null,
            marketingEligible:
              typeof account.marketingEligible === "boolean"
                ? account.marketingEligible
                : undefined,
          });
        }
      }

      importedAccounts += 1;
      importedRows += rowsToWrite.length;
      if (!preserveLocalMetadata) {
        metadataUpserts += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      preserveLocalMetadata,
      importedAccounts,
      importedRows,
      metadataUpserts,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid import payload",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    if (error instanceof HttpError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
