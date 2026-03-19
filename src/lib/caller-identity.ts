import type { AuthCookieRefreshState, EmployeeDirectoryItem } from "@/lib/acumatica";
import {
  fetchEmployeeProfileById,
  readWrappedNumber,
  readWrappedString,
  searchEmployeeProfiles,
  searchContacts,
  searchEmployeesByDisplayName,
} from "@/lib/acumatica";
import {
  readCallEmployeeDirectory,
  readCallEmployeeDirectoryMeta,
  syncCallEmployeeDirectory,
  upsertCallEmployeeDirectoryItem,
} from "@/lib/call-analytics/employee-directory";
import {
  readCallerPhoneOverride,
  saveCallerPhoneOverride,
} from "@/lib/caller-phone-overrides";
import type { CallEmployeeDirectoryItem } from "@/lib/call-analytics/types";
import {
  readCallerIdentityProfile,
  saveCallerIdentityProfile,
} from "@/lib/caller-identity-cache";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import {
  INTERNAL_EMPLOYEE_EMAIL_DOMAINS,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
import { readEmployeeDirectory } from "@/lib/read-model/employees";
import { normalizeTwilioPhoneNumber } from "@/lib/twilio";

export type ResolvedSignedInCallerIdentity = {
  loginName: string;
  employeeId: string | null;
  contactId: number | null;
  displayName: string;
  email: string | null;
  userPhone: string;
};

type ResolveSignedInCallerIdentityOptions = {
  allowFullDirectorySync?: boolean;
  preferredEmployeeId?: string | null;
};

function normalizeLoginName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isFreshDirectory(latestUpdatedAt: string | null, staleAfterMs: number): boolean {
  if (!latestUpdatedAt) {
    return false;
  }

  const updatedAtMs = Date.parse(latestUpdatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs <= staleAfterMs;
}

function findExactLoginMatch(
  items: CallEmployeeDirectoryItem[],
  loginName: string,
): CallEmployeeDirectoryItem | null {
  return (
    items.find((item) => normalizeLoginName(item.loginName) === loginName) ?? null
  );
}

function buildNoMatchError(normalizedLogin: string): HttpError {
  return new HttpError(
    403,
    `Calling is unavailable for '${normalizedLogin}'. The username must exactly match the local part of an internal Acumatica employee email.`,
  );
}

function buildMissingPhoneError(
  normalizedLogin: string,
  displayName: string,
): HttpError {
  return new HttpError(
    422,
    `Calling is unavailable for '${normalizedLogin}'. Internal employee '${displayName}' does not have a valid phone number in Acumatica.`,
  );
}

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeLoginToken(value: string | null | undefined): string {
  return normalizeComparable(value).replace(/[^a-z0-9]/g, "");
}

function extractEmailLocalPart(email: string | null | undefined): string {
  const normalized = normalizeComparable(email);
  if (!normalized) {
    return "";
  }

  const atIndex = normalized.indexOf("@");
  return atIndex >= 0 ? normalized.slice(0, atIndex) : normalized;
}

function buildExactInternalContactFilter(loginName: string): string {
  return INTERNAL_EMPLOYEE_EMAIL_DOMAINS.map((domain) => {
    const email = `${loginName}@${domain}`;
    const escaped = email.replace(/'/g, "''");
    return `(Email eq '${escaped}' or EMail eq '${escaped}')`;
  }).join(" or ");
}

function buildExactInternalEmployeeEmailFilter(loginName: string): string {
  return INTERNAL_EMPLOYEE_EMAIL_DOMAINS.map((domain) => {
    const email = `${loginName}@${domain}`;
    const escaped = email.replace(/'/g, "''");
    return [
      `Email eq '${escaped}'`,
      `EMail eq '${escaped}'`,
      `ContactEmail eq '${escaped}'`,
    ].join(" or ");
  })
    .map((clause) => `(${clause})`)
    .join(" or ");
}

function readContactDisplayName(record: unknown): string | null {
  return (
    readWrappedString(record, "DisplayName") ||
    readWrappedString(record, "FullName") ||
    readWrappedString(record, "ContactName") ||
    [
      readWrappedString(record, "FirstName"),
      readWrappedString(record, "MiddleName"),
      readWrappedString(record, "LastName"),
    ]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null
  );
}

function readContactPhone(record: unknown): string | null {
  return (
    readWrappedString(record, "Phone1") ||
    readWrappedString(record, "Phone2") ||
    readWrappedString(record, "Phone3") ||
    readWrappedString(record, "Phone") ||
    null
  );
}

function buildDirectoryItemFromProfile(
  loginName: string,
  profile: {
    contactId: number | null;
    displayName: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
  },
): CallEmployeeDirectoryItem | null {
  const email = profile.email?.trim().toLowerCase() ?? null;
  if (!email || !isExcludedInternalContactEmail(email)) {
    return null;
  }

  return {
    loginName,
    contactId: profile.contactId ?? null,
    displayName: profile.displayName.trim() || loginName,
    email,
    normalizedPhone: normalizeTwilioPhoneNumber(profile.phone),
    callerIdPhone: normalizeTwilioPhoneNumber(profile.phone),
    isActive: profile.isActive,
    updatedAt: new Date().toISOString(),
  };
}

function buildDirectoryItemFromEmployeeIdProfile(
  loginName: string,
  profile: {
    contactId: number | null;
    displayName: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
  },
): CallEmployeeDirectoryItem {
  const email = profile.email?.trim().toLowerCase() ?? null;

  return {
    loginName,
    contactId: profile.contactId ?? null,
    displayName: profile.displayName.trim() || loginName,
    email,
    normalizedPhone: normalizeTwilioPhoneNumber(profile.phone),
    callerIdPhone: normalizeTwilioPhoneNumber(profile.phone),
    isActive: profile.isActive,
    updatedAt: new Date().toISOString(),
  };
}

function selectBestDirectoryItem(
  candidates: CallEmployeeDirectoryItem[],
): CallEmployeeDirectoryItem | null {
  return candidates
    .slice()
    .sort((left, right) => {
      const leftHasPhone = left.normalizedPhone || left.callerIdPhone ? 1 : 0;
      const rightHasPhone = right.normalizedPhone || right.callerIdPhone ? 1 : 0;
      if (leftHasPhone !== rightHasPhone) {
        return rightHasPhone - leftHasPhone;
      }

      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }

      const leftHasContactId = left.contactId !== null ? 1 : 0;
      const rightHasContactId = right.contactId !== null ? 1 : 0;
      if (leftHasContactId !== rightHasContactId) {
        return rightHasContactId - leftHasContactId;
      }

      return normalizeComparable(left.displayName).localeCompare(
        normalizeComparable(right.displayName),
      );
    })[0] ?? null;
}

function readCachedEmployeeCandidates(displayName: string): EmployeeDirectoryItem[] {
  const normalizedDisplayName = normalizeComparable(displayName);
  if (!normalizedDisplayName) {
    return [];
  }

  return readEmployeeDirectory().filter(
    (employee) => normalizeComparable(employee.name) === normalizedDisplayName,
  );
}

function buildEmployeeLoginAliases(displayName: string): string[] {
  const tokens = displayName
    .split(/\s+/)
    .map((token) => normalizeLoginToken(token))
    .filter(Boolean);
  if (tokens.length < 2) {
    return [];
  }

  const first = tokens[0] ?? "";
  const last = tokens[tokens.length - 1] ?? "";
  const remaining = tokens.slice(1).join("");
  const aliases = new Set<string>();

  if (first && last) {
    aliases.add(`${first[0]}${last}`);
  }
  if (first && remaining) {
    aliases.add(`${first[0]}${remaining}`);
  }

  return [...aliases];
}

function choosePreferredEmployeeId(items: EmployeeDirectoryItem[]): string | null {
  if (items.length === 0) {
    return null;
  }

  return (
    items.find((item) => item.id.trim().toUpperCase().startsWith("E"))?.id ??
    items[0]?.id ??
    null
  );
}

function readDerivedEmployeeIdForLogin(loginName: string): string | null {
  const normalizedLogin = normalizeLoginToken(loginName);
  if (!normalizedLogin) {
    return null;
  }

  const matchingEmployees = readEmployeeDirectory().filter((employee) =>
    buildEmployeeLoginAliases(employee.name).includes(normalizedLogin),
  );
  if (matchingEmployees.length === 0) {
    return null;
  }

  const groupedByName = new Map<string, EmployeeDirectoryItem[]>();
  for (const employee of matchingEmployees) {
    const key = normalizeComparable(employee.name);
    const existing = groupedByName.get(key) ?? [];
    existing.push(employee);
    groupedByName.set(key, existing);
  }

  if (groupedByName.size !== 1) {
    return null;
  }

  return choosePreferredEmployeeId([...groupedByName.values()][0] ?? []);
}

function buildResolvedIdentity(
  normalizedLogin: string,
  directoryItem: CallEmployeeDirectoryItem,
  options?: {
    employeeId?: string | null;
  },
): ResolvedSignedInCallerIdentity {
  const existingProfile = readCallerIdentityProfile(normalizedLogin);
  const resolvedDirectoryPhone = normalizeTwilioPhoneNumber(
    directoryItem.normalizedPhone ?? directoryItem.callerIdPhone,
  );
  const canonicalPhone = normalizeTwilioPhoneNumber(existingProfile?.phoneNumber ?? null);
  const overridePhone = normalizeTwilioPhoneNumber(
    readCallerPhoneOverride(normalizedLogin)?.phoneNumber ?? null,
  );
  const userPhone = resolvedDirectoryPhone ?? canonicalPhone ?? overridePhone;
  const displayName =
    existingProfile?.displayName?.trim() ||
    directoryItem.displayName.trim() ||
    normalizedLogin;
  const email = existingProfile?.email ?? directoryItem.email ?? null;
  const contactId = existingProfile?.contactId ?? directoryItem.contactId ?? null;
  const employeeId =
    options?.employeeId?.trim() || existingProfile?.employeeId || null;
  if (!userPhone) {
    throw buildMissingPhoneError(
      normalizedLogin,
      displayName,
    );
  }

  if (resolvedDirectoryPhone) {
    try {
      saveCallerPhoneOverride(normalizedLogin, resolvedDirectoryPhone);
    } catch {
      // Keep caller resolution working even if the local phone cache cannot be updated.
    }
  }

  const cachedDirectoryItem: CallEmployeeDirectoryItem = {
    ...directoryItem,
    contactId,
    displayName,
    email,
    normalizedPhone: resolvedDirectoryPhone ?? canonicalPhone ?? overridePhone,
    callerIdPhone: resolvedDirectoryPhone ?? canonicalPhone ?? overridePhone,
  };
  upsertCallEmployeeDirectoryItem(cachedDirectoryItem);
  saveCallerIdentityProfile({
    loginName: normalizedLogin,
    employeeId,
    contactId,
    displayName,
    email,
    phoneNumber: userPhone,
  });

  return {
    loginName: normalizedLogin,
    employeeId,
    contactId,
    displayName,
    email,
    userPhone,
  };
}

async function findExactInternalContact(
  cookieValue: string,
  normalizedLogin: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<unknown | null> {
  const contacts = await searchContacts(
    cookieValue,
    {
      filter: buildExactInternalContactFilter(normalizedLogin),
      top: 20,
    },
    authCookieRefresh,
  );

  return (
    contacts.find((contact) => {
      const email =
        readWrappedString(contact, "Email") || readWrappedString(contact, "EMail") || null;
      return (
        isExcludedInternalContactEmail(email) &&
        extractEmailLocalPart(email) === normalizedLogin
      );
    }) ?? null
  );
}

function readInternalContactEmail(record: unknown): string | null {
  const email =
    readWrappedString(record, "Email") || readWrappedString(record, "EMail") || null;
  return isExcludedInternalContactEmail(email) ? email?.trim().toLowerCase() ?? null : null;
}

function buildDirectoryItemFromExactInternalContact(
  normalizedLogin: string,
  matchingContact: unknown,
): CallEmployeeDirectoryItem | null {
  const contactEmail = readInternalContactEmail(matchingContact);
  if (!contactEmail || extractEmailLocalPart(contactEmail) !== normalizedLogin) {
    return null;
  }

  return buildDirectoryItemFromProfile(normalizedLogin, {
    contactId: readWrappedNumber(matchingContact, "ContactID") ?? null,
    displayName: readContactDisplayName(matchingContact) || normalizedLogin,
    email: contactEmail,
    phone: readContactPhone(matchingContact),
    isActive: true,
  });
}

async function resolveSignedInCallerIdentityByEmployeeId(
  cookieValue: string,
  normalizedLogin: string,
  preferredEmployeeId: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ResolvedSignedInCallerIdentity | null> {
  const trimmedEmployeeId = preferredEmployeeId.trim();
  if (!trimmedEmployeeId) {
    return null;
  }

  const profile = await fetchEmployeeProfileById(
    cookieValue,
    trimmedEmployeeId,
    authCookieRefresh,
  );
  if (!profile) {
    return null;
  }

  const cachedOverridePhone = normalizeTwilioPhoneNumber(
    readCallerPhoneOverride(normalizedLogin)?.phoneNumber ?? null,
  );
  if (profile.phone || cachedOverridePhone) {
    const directoryItem = buildDirectoryItemFromEmployeeIdProfile(normalizedLogin, {
      contactId: profile.contactId ?? null,
      displayName: profile.displayName || normalizedLogin,
      email: isExcludedInternalContactEmail(profile.email)
        ? profile.email?.trim().toLowerCase() ?? null
        : null,
      phone: profile.phone,
      isActive: profile.isActive,
    });

    return buildResolvedIdentity(normalizedLogin, directoryItem, {
      employeeId: trimmedEmployeeId,
    });
  }

  const matchingContact = await findExactInternalContact(
    cookieValue,
    normalizedLogin,
    authCookieRefresh,
  ).catch((error) => {
    if (
      error instanceof HttpError &&
      [403, 404, 422].includes(error.status)
    ) {
      return null;
    }
    return null;
  });

  const contactDisplayName = readContactDisplayName(matchingContact);
  const directoryItem = buildDirectoryItemFromEmployeeIdProfile(normalizedLogin, {
    contactId:
      profile.contactId ??
      readWrappedNumber(matchingContact, "ContactID") ??
      null,
    displayName:
      profile.displayName ||
      contactDisplayName ||
      normalizedLogin,
    email:
      (isExcludedInternalContactEmail(profile.email)
        ? profile.email?.trim().toLowerCase() ?? null
        : null) ??
      readInternalContactEmail(matchingContact),
    phone: profile.phone ?? readContactPhone(matchingContact),
    isActive: profile.isActive,
  });

  return buildResolvedIdentity(normalizedLogin, directoryItem, {
    employeeId: trimmedEmployeeId,
  });
}

async function resolveSignedInCallerIdentityDirect(
  cookieValue: string,
  normalizedLogin: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<ResolvedSignedInCallerIdentity | null> {
  const matchingContact = await findExactInternalContact(
    cookieValue,
    normalizedLogin,
    authCookieRefresh,
  );
  const exactInternalContact = matchingContact
    ? buildDirectoryItemFromExactInternalContact(normalizedLogin, matchingContact)
    : null;
  if (exactInternalContact && (exactInternalContact.normalizedPhone || exactInternalContact.callerIdPhone)) {
    return buildResolvedIdentity(normalizedLogin, exactInternalContact);
  }
  const employeeProfiles = await searchEmployeeProfiles(
    cookieValue,
    {
      filter: buildExactInternalEmployeeEmailFilter(normalizedLogin),
      top: 20,
    },
    authCookieRefresh,
  );
  const matchingByEmployeeEmailCandidates = employeeProfiles
    .filter(
      (profile) =>
        extractEmailLocalPart(profile.email) === normalizedLogin &&
        isExcludedInternalContactEmail(profile.email),
    )
    .map((profile) => ({
      employeeId: profile.employeeId,
      item: buildDirectoryItemFromProfile(normalizedLogin, {
        contactId:
          profile.contactId ??
          readWrappedNumber(matchingContact, "ContactID") ??
          null,
        displayName:
          profile.displayName ||
          readContactDisplayName(matchingContact) ||
          normalizedLogin,
        email:
          profile.email ??
          readWrappedString(matchingContact, "Email") ??
          readWrappedString(matchingContact, "EMail") ??
          null,
        phone: profile.phone ?? readContactPhone(matchingContact),
        isActive: profile.isActive,
      }),
    }))
    .filter(
      (candidate): candidate is { employeeId: string; item: CallEmployeeDirectoryItem } =>
        candidate.item !== null,
    );
  const matchingByEmployeeEmail = selectBestDirectoryItem(
    matchingByEmployeeEmailCandidates.map((candidate) => candidate.item),
  );
  if (matchingByEmployeeEmail) {
    const matchingProfile =
      matchingByEmployeeEmailCandidates.find(
        (candidate) => candidate.item === matchingByEmployeeEmail,
      ) ?? null;
    return buildResolvedIdentity(normalizedLogin, matchingByEmployeeEmail, {
      employeeId: matchingProfile?.employeeId ?? null,
    });
  }

  if (!matchingContact) {
    return null;
  }

  const contactDisplayName = readContactDisplayName(matchingContact);
  if (!contactDisplayName) {
    return null;
  }

  const contactId = readWrappedNumber(matchingContact, "ContactID");
  const candidateEmployees = readCachedEmployeeCandidates(contactDisplayName);
  const employees =
    candidateEmployees.length > 0
      ? candidateEmployees
      : await searchEmployeesByDisplayName(
          cookieValue,
          contactDisplayName,
          authCookieRefresh,
        );
  if (employees.length === 0) {
    return null;
  }

  const matchedDirectoryItems: Array<{
    employeeId: string;
    item: CallEmployeeDirectoryItem;
  }> = [];
  for (const employee of employees) {
    const profile = await fetchEmployeeProfileById(cookieValue, employee.id, authCookieRefresh);
    if (!profile) {
      continue;
    }

    const matchesProfileEmail =
      extractEmailLocalPart(profile.email) === normalizedLogin &&
      isExcludedInternalContactEmail(profile.email);
    const matchesContactId =
      contactId !== null &&
      profile.contactId !== null &&
      profile.contactId === contactId;
    if (!matchesProfileEmail && !matchesContactId) {
      continue;
    }

    const directoryItem = buildDirectoryItemFromProfile(normalizedLogin, {
      contactId: profile.contactId ?? contactId ?? null,
      displayName: profile.displayName || contactDisplayName,
      email:
        profile.email ??
        readWrappedString(matchingContact, "Email") ??
        readWrappedString(matchingContact, "EMail") ??
        null,
      phone: profile.phone ?? readContactPhone(matchingContact),
      isActive: profile.isActive,
    });

    if (directoryItem) {
      matchedDirectoryItems.push({
        employeeId: employee.id,
        item: directoryItem,
      });
    }
  }

  const directoryItem = selectBestDirectoryItem(
    matchedDirectoryItems.map((candidate) => candidate.item),
  );
  if (!directoryItem) {
    const contactFallback = buildDirectoryItemFromProfile(normalizedLogin, {
      contactId: contactId ?? null,
      displayName: contactDisplayName,
      email:
        readWrappedString(matchingContact, "Email") ||
        readWrappedString(matchingContact, "EMail") ||
        null,
      phone: readContactPhone(matchingContact),
      // We only allow this fallback after finding a same-name employee candidate.
      isActive: true,
    });
    if (!contactFallback) {
      return null;
    }

    return buildResolvedIdentity(normalizedLogin, contactFallback);
  }

  const matchedDirectoryItem =
    matchedDirectoryItems.find((candidate) => candidate.item === directoryItem) ?? null;
  return buildResolvedIdentity(normalizedLogin, directoryItem, {
    employeeId: matchedDirectoryItem?.employeeId ?? null,
  });
}

export async function resolveSignedInCallerIdentity(
  cookieValue: string,
  loginName: string,
  authCookieRefresh?: AuthCookieRefreshState,
  options?: ResolveSignedInCallerIdentityOptions,
): Promise<ResolvedSignedInCallerIdentity> {
  const normalizedLogin = normalizeLoginName(loginName);
  if (!normalizedLogin) {
    throw new HttpError(401, "Signed-in username is unavailable. Sign out and sign in again.");
  }

  const preferredEmployeeId =
    options?.preferredEmployeeId?.trim() || readDerivedEmployeeIdForLogin(normalizedLogin);
  if (preferredEmployeeId) {
    const employeeIdMatch = await resolveSignedInCallerIdentityByEmployeeId(
      cookieValue,
      normalizedLogin,
      preferredEmployeeId,
      authCookieRefresh,
    );
    if (employeeIdMatch) {
      return employeeIdMatch;
    }
  }

  const env = getEnv();
  let items = readCallEmployeeDirectory();
  let candidate = findExactLoginMatch(items, normalizedLogin);
  const directoryMeta = readCallEmployeeDirectoryMeta();
  const shouldRefresh =
    items.length === 0 ||
    candidate === null ||
    !isFreshDirectory(directoryMeta.latestUpdatedAt, env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS);

  if (shouldRefresh) {
    const directMatch = await resolveSignedInCallerIdentityDirect(
      cookieValue,
      normalizedLogin,
      authCookieRefresh,
    );
    if (directMatch) {
      return directMatch;
    }

    if (options?.allowFullDirectorySync !== false) {
      items = await syncCallEmployeeDirectory(cookieValue, authCookieRefresh);
      candidate = findExactLoginMatch(items, normalizedLogin);
    }
  }

  if (!candidate) {
    throw buildNoMatchError(normalizedLogin);
  }

  const email = candidate.email?.trim().toLowerCase() ?? "";
  if (!email || !isExcludedInternalContactEmail(email)) {
    throw buildNoMatchError(normalizedLogin);
  }
  return buildResolvedIdentity(normalizedLogin, candidate);
}
