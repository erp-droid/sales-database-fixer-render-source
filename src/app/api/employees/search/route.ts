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
  searchContacts,
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import {
  readCallEmployeeDirectory,
  syncCallEmployeeDirectory,
  upsertCallEmployeeDirectoryItem,
} from "@/lib/call-analytics/employee-directory";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  INTERNAL_EMPLOYEE_EMAIL_DOMAINS,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
import {
  FULL_EMPLOYEE_DIRECTORY_SOURCE,
  hasDetailedEmployeeDirectory,
  readEmployeeDirectorySnapshot,
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

function escapeODataStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildInternalContactFilter(): string {
  return INTERNAL_EMPLOYEE_EMAIL_DOMAINS.map(
    (domain) => `substringof('@${domain.replace(/'/g, "''")}',Email)`,
  ).join(" or ");
}

function readContactDisplayName(record: unknown): string | null {
  return (
    readWrappedString(record, "DisplayName") ||
    readWrappedString(record, "FullName") ||
    readWrappedString(record, "ContactName") ||
    readWrappedString(record, "Attention") ||
    [
      readWrappedString(record, "FirstName"),
      readWrappedString(record, "MiddleName"),
      readWrappedString(record, "LastName"),
    ]
      .filter((value) => value.trim().length > 0)
      .join(" ")
      .trim() ||
    null
  );
}

function buildInternalContactNameSearchFilter(query: string): string | null {
  const tokens = tokenizeSearch(query);
  if (tokens.length === 0) {
    return null;
  }

  const tokenClauses = tokens.map((token) => {
    const escaped = escapeODataStringLiteral(token);
    return `(
      substringof('${escaped}',DisplayName) or
      substringof('${escaped}',FullName) or
      substringof('${escaped}',ContactName) or
      substringof('${escaped}',Attention) or
      substringof('${escaped}',FirstName) or
      substringof('${escaped}',LastName) or
      substringof('${escaped}',Email)
    )`;
  });

  return `(${tokenClauses.join(" and ")}) and (${buildInternalContactFilter()})`;
}

function scoreInternalContactMatch(contact: unknown, employeeName: string): number {
  const normalizedEmployeeName = normalizeComparable(employeeName);
  const employeeTokens = tokenizeSearch(employeeName);
  const displayName = normalizeComparable(readContactDisplayName(contact));
  const email = normalizeComparable(readContactEmail(contact));
  let score = 0;

  if (displayName === normalizedEmployeeName) {
    score += 100;
  }
  if (email && email.includes("@")) {
    const local = email.split("@")[0] ?? "";
    if (employeeTokens.every((token) => local.includes(token))) {
      score += 50;
    }
  }

  score += employeeTokens.filter((token) => displayName.includes(token)).length * 10;
  return score;
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
      await syncCallEmployeeDirectory(cookieValue, authCookieRefresh);
      const detailedSnapshot = readEmployeeDirectorySnapshot();
      if (
        detailedSnapshot.source === FULL_EMPLOYEE_DIRECTORY_SOURCE &&
        hasDetailedEmployeeDirectory(detailedSnapshot.items)
      ) {
        return detailedSnapshot.items;
      }

      // Fall back to the lightweight employee list only for this request. Do not
      // overwrite the richer synced directory with sparse list results.
      return fetchEmployees(cookieValue, authCookieRefresh);
    })().finally(() => {
      employeeDirectoryRefreshPromise = null;
    });
  }

  return employeeDirectoryRefreshPromise;
}

async function loadEmployeeDirectory(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<EmployeeDirectoryItem[]> {
  const snapshot = readEmployeeDirectorySnapshot();
  const hasFreshFullDirectory =
    snapshot.source === FULL_EMPLOYEE_DIRECTORY_SOURCE &&
    isFreshEmployeeDirectory(snapshot.updatedAt) &&
    hasDetailedEmployeeDirectory(snapshot.items);

  if (hasFreshFullDirectory) {
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
  const exactContacts = await findContactsByDisplayName(
    cookieValue,
    employeeName,
    authCookieRefresh,
  ).catch((error) => {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      return [];
    }
    throw error;
  });

  const exactInternal =
    exactContacts.find((contact) => isExcludedInternalContactEmail(readContactEmail(contact))) ?? null;
  if (exactInternal) {
    return exactInternal;
  }

  const searchFilter = buildInternalContactNameSearchFilter(employeeName);
  if (!searchFilter) {
    return null;
  }

  const candidates = await searchContacts(
    cookieValue,
    {
      filter: searchFilter,
      top: 10,
      skip: 0,
    },
    authCookieRefresh,
  ).catch((error) => {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      return [];
    }
    throw error;
  });

  return candidates
    .filter((contact) => isExcludedInternalContactEmail(readContactEmail(contact)))
    .sort(
      (left, right) =>
        scoreInternalContactMatch(right, employeeName) -
        scoreInternalContactMatch(left, employeeName),
    )[0] ?? null;
}

function buildCachedMeetingEmployeeOption(
  employee: EmployeeDirectoryItem,
): MeetingEmployeeOption | null {
  const employeeName = employee.name.trim();
  const emailCandidate = employee.email?.trim().toLowerCase() ?? null;
  if (!employeeName || !emailCandidate || !isExcludedInternalContactEmail(emailCandidate)) {
    return null;
  }

  const loginName =
    employee.loginName?.trim().toLowerCase() ??
    emailCandidate.split("@")[0]?.trim().toLowerCase() ??
    "";
  if (!loginName) {
    return null;
  }

  return {
    key: `employee:${loginName}`,
    loginName,
    employeeName,
    email: emailCandidate,
    contactId: employee.contactId ?? null,
    isInternal: true,
  };
}

function buildMeetingEmployeeOptionFromCachedDirectoryItem(
  employee: ReturnType<typeof readCallEmployeeDirectory>[number],
): MeetingEmployeeOption | null {
  const employeeName = employee.displayName.trim();
  const emailCandidate = employee.email?.trim().toLowerCase() ?? null;
  if (!employeeName || !emailCandidate || !isExcludedInternalContactEmail(emailCandidate)) {
    return null;
  }

  const loginName =
    employee.loginName?.trim().toLowerCase() ??
    emailCandidate.split("@")[0]?.trim().toLowerCase() ??
    "";
  if (!loginName) {
    return null;
  }

  return {
    key: `employee:${loginName}`,
    loginName,
    employeeName,
    email: emailCandidate,
    contactId: employee.contactId ?? null,
    isInternal: true,
  };
}

async function buildMeetingEmployeeOption(
  cookieValue: string,
  employee: EmployeeDirectoryItem,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<MeetingEmployeeOption | null> {
  const cachedOption = buildCachedMeetingEmployeeOption(employee);
  if (cachedOption) {
    const normalizedPhone = normalizeTwilioPhoneNumber(employee.phone ?? null);
    upsertCallEmployeeDirectoryItem({
      loginName: cachedOption.loginName,
      contactId: cachedOption.contactId,
      displayName: cachedOption.employeeName,
      email: cachedOption.email,
      normalizedPhone,
      callerIdPhone: normalizedPhone,
      isActive: employee.isActive ?? true,
      updatedAt: new Date().toISOString(),
    });
    return cachedOption;
  }

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

function searchCachedEmployeeOptions(query: string): MeetingEmployeeOption[] | null {
  const snapshot = readEmployeeDirectorySnapshot();
  const hasFreshDetailedDirectory =
    snapshot.source === FULL_EMPLOYEE_DIRECTORY_SOURCE &&
    isFreshEmployeeDirectory(snapshot.updatedAt) &&
    hasDetailedEmployeeDirectory(snapshot.items);
  if (!hasFreshDetailedDirectory) {
    return null;
  }

  return dedupeMeetingEmployeeOptions(
    filterEmployeesByQuery(snapshot.items, query)
      .slice(0, MAX_RESULTS)
      .map((employee) => buildCachedMeetingEmployeeOption(employee))
      .filter((employee): employee is MeetingEmployeeOption => employee !== null),
  );
}

function searchCachedCallEmployeeDirectory(query: string): MeetingEmployeeOption[] {
  const tokens = tokenizeSearch(query);
  if (tokens.length === 0) {
    return [];
  }

  return dedupeMeetingEmployeeOptions(
    readCallEmployeeDirectory()
      .filter((employee) => {
        const haystacks = [
          normalizeComparable(employee.displayName),
          normalizeComparable(employee.email),
          normalizeComparable(employee.loginName),
        ];
        return tokens.every((token) => haystacks.some((haystack) => haystack.includes(token)));
      })
      .map((employee) => buildMeetingEmployeeOptionFromCachedDirectoryItem(employee))
      .filter((employee): employee is MeetingEmployeeOption => employee !== null)
      .slice(0, MAX_RESULTS),
  );
}

async function searchEmployeeOptions(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  query: string,
): Promise<MeetingEmployeeOption[]> {
  const cachedCallDirectoryMatches = searchCachedCallEmployeeDirectory(query);
  if (cachedCallDirectoryMatches.length > 0) {
    return cachedCallDirectoryMatches;
  }

  const directory = await loadEmployeeDirectory(cookieValue, authCookieRefresh);
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

    const cachedItems = searchCachedEmployeeOptions(query);
    if (cachedItems !== null) {
      return NextResponse.json({ items: cachedItems });
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
