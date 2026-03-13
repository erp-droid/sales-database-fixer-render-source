export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  fetchBusinessAccounts,
  fetchContacts,
  readRecordIdentity,
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import { isAllowedBusinessAccountType } from "@/lib/business-account-region-resolution";
import { normalizeBusinessAccountRows } from "@/lib/business-accounts";
import {
  buildMeetingAccountOptionsFromRows,
  DEFAULT_MEETING_TIME_ZONE,
} from "@/lib/meeting-create";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  isExcludedInternalCompanyName,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
import type { MeetingContactOption } from "@/types/meeting-create";

function isAllowedMeetingBusinessAccount(record: unknown): boolean {
  return isAllowedBusinessAccountType({
    type: readWrappedString(record, "Type") || null,
    typeDescription: readWrappedString(record, "TypeDescription") || null,
    classId:
      readWrappedString(record, "ClassID") ||
      readWrappedString(record, "BusinessAccountClass") ||
      null,
  });
}

function readContactDisplayName(record: unknown): string | null {
  const explicit =
    readWrappedString(record, "DisplayName") ||
    readWrappedString(record, "FullName") ||
    readWrappedString(record, "ContactName") ||
    readWrappedString(record, "Attention");
  if (explicit) {
    return explicit;
  }

  const composite = [
    readWrappedString(record, "FirstName"),
    readWrappedString(record, "MiddleName"),
    readWrappedString(record, "LastName"),
  ]
    .filter((value) => value.trim().length > 0)
    .join(" ")
    .trim();

  return composite || null;
}

function readContactEmail(record: unknown): string | null {
  return readWrappedString(record, "Email") || readWrappedString(record, "EMail") || null;
}

function readContactPhone(record: unknown): string | null {
  return (
    readWrappedString(record, "Phone1") ||
    readWrappedString(record, "Phone2") ||
    readWrappedString(record, "Phone3") ||
    null
  );
}

function normalizeBusinessAccountCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function buildMeetingContactOptionsFromContacts(
  rawContacts: unknown[],
  allowedAccountsByBusinessId: Map<
    string,
    {
      businessAccountId: string;
      businessAccountRecordId: string | null;
      companyName: string | null;
    }
  >,
): MeetingContactOption[] {
  const byContactId = new Map<number, MeetingContactOption>();

  rawContacts.forEach((contact) => {
    const contactId = readWrappedNumber(contact, "ContactID");
    if (contactId === null) {
      return;
    }

    const businessAccountId =
      readWrappedString(contact, "BusinessAccount") ||
      readWrappedString(contact, "BusinessAccountID") ||
      readWrappedString(contact, "BAccountID") ||
      null;
    const normalizedBusinessAccountId = normalizeBusinessAccountCode(businessAccountId);
    const linkedAccount =
      normalizedBusinessAccountId
        ? allowedAccountsByBusinessId.get(normalizedBusinessAccountId) ?? null
        : null;
    const companyName =
      readWrappedString(contact, "CompanyName") || linkedAccount?.companyName || null;

    if (normalizedBusinessAccountId && !linkedAccount) {
      return;
    }

    const email = readContactEmail(contact);
    const next: MeetingContactOption = {
      key: `${contactId}:${linkedAccount?.businessAccountRecordId ?? normalizedBusinessAccountId ?? "contact"}`,
      contactId,
      contactName: readContactDisplayName(contact)?.trim() || `Contact ${contactId}`,
      email: email?.trim() || null,
      phone: readContactPhone(contact)?.trim() || null,
      businessAccountRecordId: linkedAccount?.businessAccountRecordId ?? null,
      businessAccountId: linkedAccount?.businessAccountId ?? (businessAccountId?.trim() || null),
      companyName,
      isInternal:
        isExcludedInternalContactEmail(email) ||
        isExcludedInternalCompanyName(companyName),
    };

    const existing = byContactId.get(contactId);
    if (!existing) {
      byContactId.set(contactId, next);
      return;
    }

    byContactId.set(contactId, {
      ...existing,
      contactName:
        existing.contactName === `Contact ${contactId}` && next.contactName !== `Contact ${contactId}`
          ? next.contactName
          : existing.contactName,
      email: existing.email ?? next.email,
      phone: existing.phone ?? next.phone,
      businessAccountRecordId: existing.businessAccountRecordId ?? next.businessAccountRecordId,
      businessAccountId: existing.businessAccountId ?? next.businessAccountId,
      companyName: existing.companyName ?? next.companyName,
      isInternal: existing.isInternal || next.isInternal,
    });
  });

  return [...byContactId.values()].sort((left, right) => {
    const nameCompare = left.contactName.localeCompare(right.contactName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (nameCompare !== 0) {
      return nameCompare;
    }

    const companyCompare = (left.companyName ?? "").localeCompare(right.companyName ?? "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (companyCompare !== 0) {
      return companyCompare;
    }

    return (left.email ?? "").localeCompare(right.email ?? "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh = {
    value: null as string | null,
  };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const [rawAccounts, rawContacts] = await Promise.all([
      fetchBusinessAccounts(
        cookieValue,
        {
          batchSize: 300,
          ensureMainAddress: true,
        },
        authCookieRefresh,
      ),
      fetchContacts(
        cookieValue,
        {
          batchSize: 300,
        },
        authCookieRefresh,
      ),
    ]);
    const accountRows = rawAccounts
      .filter((account) => isAllowedMeetingBusinessAccount(account))
      .flatMap((account) => normalizeBusinessAccountRows(account));
    const accountOptions = buildMeetingAccountOptionsFromRows(accountRows);
    const allowedAccountsByBusinessId = new Map(
      rawAccounts
        .filter((account) => isAllowedMeetingBusinessAccount(account))
        .map((account) => {
          const businessAccountId =
            readWrappedString(account, "BusinessAccountID") ||
            readWrappedString(account, "BAccountID");
          return [
            normalizeBusinessAccountCode(businessAccountId),
            {
              businessAccountId: businessAccountId.trim(),
              businessAccountRecordId: readRecordIdentity(account),
              companyName:
                readWrappedString(account, "Name") ||
                readWrappedString(account, "CompanyName") ||
                null,
            },
          ] as const;
        })
        .filter(([businessAccountId]) => businessAccountId.length > 0),
    );
    const contacts = buildMeetingContactOptionsFromContacts(
      rawContacts,
      allowedAccountsByBusinessId,
    );

    const response = NextResponse.json({
      accounts: accountOptions,
      contacts,
      defaultTimeZone: DEFAULT_MEETING_TIME_ZONE,
    });
    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  } catch (error) {
    let response: NextResponse;
    if (error instanceof HttpError) {
      response = NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status },
      );
    } else {
      response = NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }

    if (authCookieRefresh.value) {
      setAuthCookie(response, authCookieRefresh.value);
    }

    return response;
  }
}
