export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { withServiceAcumaticaSession } from "@/lib/acumatica-service-auth";
import { requireAuthCookieValue, setAuthCookie } from "@/lib/auth";
import {
  type AuthCookieRefreshState,
  type EmployeeDirectoryItem,
  fetchEmployeeProfileById,
  fetchEmployees,
  findContactsByDisplayName,
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import { upsertCallEmployeeDirectoryItem } from "@/lib/call-analytics/employee-directory";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { isExcludedInternalContactEmail } from "@/lib/internal-records";
import {
  FULL_EMPLOYEE_DIRECTORY_SOURCE,
  readEmployeeDirectorySnapshot,
  replaceEmployeeDirectory,
} from "@/lib/read-model/employees";
import { normalizeTwilioPhoneNumber } from "@/lib/twilio";
import type { MeetingEmployeeOption } from "@/types/meeting-create";

const EMPLOYEE_DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 10;

let employeeDirectoryRefreshPromise: Promise<EmployeeDirectoryItem[]> | null = null;

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function tokenizeSearch(value: string): string[] {
  return normalizeComparable(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isFreshEmployeeDirectory(updatedAt: string | null): boolean {
  if (!updatedAt) {
    return false;
  }

  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Date.now() - parsed <= EMPLOYEE_DIRECTORY_CACHE_TTL_MS;
}

function matchesEmployeeQuery(employeeName: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }

  const words = tokenizeSearch(employeeName);
  const combined = words.join(" ");
  return tokens.every(
    (token) =>
      words.some((word) => word.startsWith(token) || word.includes(token)) ||
      combined.includes(token),
  );
}

function filterEmployeesByQuery(
  items: EmployeeDirectoryItem[],
  query: string,
): EmployeeDirectoryItem[] {
  const tokens = tokenizeSearch(query);
  if (tokens.length === 0) {
    return [];
  }

  return items.filter((item) => matchesEmployeeQuery(item.name, tokens));
}

async function refreshEmployeeDirectory(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<EmployeeDirectoryItem[]> {
  if (!employeeDirectoryRefreshPromise) {
    employeeDirectoryRefreshPromise = (async () => {
      const items = await fetchEmployees(cookieValue, authCookieRefresh);
      replaceEmployeeDirectory(items, FULL_EMPLOYEE_DIRECTORY_SOURCE);
      return items;
    })().finally(() => {
      employeeDirectoryRefreshPromise = null;
    });
  }

  return employeeDirectoryRefreshPromise;
}

async function loadEmployeeDirectory(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  query: string,
): Promise<EmployeeDirectoryItem[]> {
  const snapshot = readEmployeeDirectorySnapshot();
  const cachedMatches = filterEmployeesByQuery(snapshot.items, query);
  const hasFreshFullDirectory =
    snapshot.source === FULL_EMPLOYEE_DIRECTORY_SOURCE &&
    isFreshEmployeeDirectory(snapshot.updatedAt);

  if (hasFreshFullDirectory && cachedMatches.length > 0) {
    return snapshot.items;
  }

  try {
    return await refreshEmployeeDirectory(cookieValue, authCookieRefresh);
  } catch (error) {
    if (snapshot.items.length > 0) {
      return snapshot.items;
    }
    throw error;
  }
}

function readContactEmail(record: unknown): string | null {
  return readWrappedString(record, "Email") || readWrappedString(record, "EMail") || null;
}

async function findBestInternalContactByName(
  cookieValue: string,
  employeeName: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<unknown | null> {
  const contacts = await findContactsByDisplayName(cookieValue, employeeName, authCookieRefresh).catch(
    (error) => {
      if (error instanceof HttpError && [401, 403].includes(error.status)) {
        return [];
      }
      throw error;
    },
  );

  return (
    contacts.find((contact) => isExcludedInternalContactEmail(readContactEmail(contact))) ?? null
  );
}

async function buildMeetingEmployeeOption(
  cookieValue: string,
  employee: EmployeeDirectoryItem,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<MeetingEmployeeOption | null> {
  const displayName = employee.name.trim();
  if (!displayName) {
    return null;
  }

  const profile = await fetchEmployeeProfileById(cookieValue, employee.id, authCookieRefresh).catch(
    (error) => {
      if (error instanceof HttpError && [401, 403].includes(error.status)) {
        return null;
      }
      throw error;
    },
  );
  const fallbackContact = await findBestInternalContactByName(
    cookieValue,
    displayName,
    authCookieRefresh,
  );

  const emailCandidate =
    profile?.email?.trim().toLowerCase() ?? readContactEmail(fallbackContact)?.trim().toLowerCase() ?? null;
  if (!emailCandidate || !isExcludedInternalContactEmail(emailCandidate)) {
    return null;
  }

  const loginName = emailCandidate.split("@")[0]?.trim().toLowerCase() ?? "";
  if (!loginName) {
    return null;
  }

  const contactId =
    profile?.contactId ?? readWrappedNumber(fallbackContact, "ContactID") ?? null;
  const employeeName = profile?.displayName?.trim() || displayName;
  const normalizedPhone = normalizeTwilioPhoneNumber(profile?.phone ?? null);

  upsertCallEmployeeDirectoryItem({
    loginName,
    contactId,
    displayName: employeeName,
    email: emailCandidate,
    normalizedPhone,
    callerIdPhone: normalizedPhone,
    isActive: profile?.isActive ?? true,
    updatedAt: new Date().toISOString(),
  });

  return {
    key: `employee:${loginName}`,
    loginName,
    employeeName,
    email: emailCandidate,
    contactId,
    isInternal: true,
  };
}

function dedupeMeetingEmployeeOptions(items: MeetingEmployeeOption[]): MeetingEmployeeOption[] {
  const byKey = new Map<string, MeetingEmployeeOption>();
  for (const item of items) {
    const key = normalizeComparable(item.email) || normalizeComparable(item.loginName);
    if (!key || byKey.has(key)) {
      continue;
    }
    byKey.set(key, item);
  }

  return [...byKey.values()].sort((left, right) =>
    left.employeeName.localeCompare(right.employeeName, undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );
}

async function searchEmployeeOptions(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  query: string,
): Promise<MeetingEmployeeOption[]> {
  const directory = await loadEmployeeDirectory(cookieValue, authCookieRefresh, query);
  const matches = filterEmployeesByQuery(directory, query).slice(0, MAX_RESULTS);
  if (matches.length === 0) {
    return [];
  }

  const resolved = await Promise.allSettled(
    matches.map((employee) =>
      buildMeetingEmployeeOption(cookieValue, employee, authCookieRefresh),
    ),
  );

  return dedupeMeetingEmployeeOptions(
    resolved
      .filter((result): result is PromiseFulfilledResult<MeetingEmployeeOption | null> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((item): item is MeetingEmployeeOption => item !== null),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authCookieRefresh: AuthCookieRefreshState = { value: null };

  try {
    const cookieValue = requireAuthCookieValue(request);
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

    if (query.length < 2) {
      return NextResponse.json({ items: [] });
    }

    let items: MeetingEmployeeOption[] = [];
    let serviceError: unknown = null;

    try {
      items = await withServiceAcumaticaSession(null, (serviceCookieValue, serviceRefresh) =>
        searchEmployeeOptions(serviceCookieValue, serviceRefresh, query),
      );
    } catch (error) {
      serviceError = error;
    }

    if (items.length === 0) {
      try {
        items = await searchEmployeeOptions(cookieValue, authCookieRefresh, query);
      } catch (error) {
        throw serviceError ?? error;
      }
    }

    const response = NextResponse.json({ items });
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
