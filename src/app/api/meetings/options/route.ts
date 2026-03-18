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
  readCallEmployeeDirectory,
  readCallEmployeeDirectoryMeta,
  syncCallEmployeeDirectory,
} from "@/lib/call-analytics/employee-directory";
import type { CallEmployeeDirectoryItem } from "@/lib/call-analytics/types";
import { getEnv } from "@/lib/env";
import {
  buildMeetingAccountOptionsFromRows,
  DEFAULT_MEETING_TIME_ZONE,
} from "@/lib/meeting-create";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  isExcludedInternalCompanyName,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
import { readEmployeeDirectorySnapshot } from "@/lib/read-model/employees";
import type {
  MeetingContactOption,
  MeetingEmployeeOption,
} from "@/types/meeting-create";

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

function compareMeetingContacts(left: MeetingContactOption, right: MeetingContactOption): number {
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

  return [...byContactId.values()].sort(compareMeetingContacts);
}

function buildMeetingEmployeeOptions(
  internalEmployees: CallEmployeeDirectoryItem[],
): MeetingEmployeeOption[] {
  return internalEmployees
    .filter((employee) => typeof employee.email === "string" && employee.email.trim())
    .map((employee) => ({
      key: `employee:${employee.loginName}`,
      loginName: employee.loginName,
      employeeName: employee.displayName,
      email: employee.email!.trim(),
      contactId: employee.contactId,
      isInternal: true,
    }));
}

function buildInternalEmployeeContactOptions(
  employees: MeetingEmployeeOption[],
): MeetingContactOption[] {
  return employees
    .filter((employee): employee is MeetingEmployeeOption & { contactId: number } => employee.contactId !== null)
    .map((employee) => ({
      key: `${employee.contactId}:employee:${employee.loginName}`,
      contactId: employee.contactId,
      contactName: employee.employeeName,
      email: employee.email,
      phone: null,
      businessAccountRecordId: null,
      businessAccountId: null,
      companyName: "MeadowBrook Internal",
      isInternal: true,
    }));
}

function mergeMeetingContactOptions(
  contacts: MeetingContactOption[],
  additionalContacts: MeetingContactOption[],
): MeetingContactOption[] {
  const byContactId = new Map<number, MeetingContactOption>();

  [...contacts, ...additionalContacts].forEach((contact) => {
    const existing = byContactId.get(contact.contactId);
    if (!existing) {
      byContactId.set(contact.contactId, contact);
      return;
    }

    byContactId.set(contact.contactId, {
      ...existing,
      contactName:
        existing.contactName === `Contact ${contact.contactId}` &&
        contact.contactName !== `Contact ${contact.contactId}`
          ? contact.contactName
          : existing.contactName,
      email: existing.email ?? contact.email,
      phone: existing.phone ?? contact.phone,
      businessAccountRecordId: existing.businessAccountRecordId ?? contact.businessAccountRecordId,
      businessAccountId: existing.businessAccountId ?? contact.businessAccountId,
      companyName: existing.companyName ?? contact.companyName,
      isInternal: existing.isInternal || contact.isInternal,
    });
  });

  return [...byContactId.values()].sort(compareMeetingContacts);
}

function isFreshEmployeeDirectory(updatedAt: string | null): boolean {
  if (!updatedAt) {
    return false;
  }

  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs <= getEnv().CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS;
}

function isCompleteEnoughEmployeeDirectory(cachedCount: number): boolean {
  const expectedEmployeeCount = readEmployeeDirectorySnapshot().items.length;
  if (expectedEmployeeCount <= 0) {
    return cachedCount > 0;
  }

  // Older caches built from the pre-hydration path can be "fresh" but still contain
  // only a handful of employees. Trust the cache only once it reaches a reasonable
  // floor relative to the known employee directory.
  return cachedCount >= Math.min(expectedEmployeeCount, 25);
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
    const employeeDirectoryMeta = readCallEmployeeDirectoryMeta();
    const cachedEmployeeDirectory = readCallEmployeeDirectory();
    const internalEmployees =
      cachedEmployeeDirectory.length > 0 &&
      isFreshEmployeeDirectory(employeeDirectoryMeta.latestUpdatedAt) &&
      isCompleteEnoughEmployeeDirectory(cachedEmployeeDirectory.length)
        ? cachedEmployeeDirectory
        : await syncCallEmployeeDirectory(cookieValue, authCookieRefresh);
    const employees = buildMeetingEmployeeOptions(internalEmployees);
    const mergedContacts = mergeMeetingContactOptions(
      contacts,
      buildInternalEmployeeContactOptions(employees),
    );

    const response = NextResponse.json({
      accounts: accountOptions,
      contacts: mergedContacts,
      employees,
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
