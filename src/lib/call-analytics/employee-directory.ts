import type {
  AuthCookieRefreshState,
  EmployeeDirectoryItem,
  EmployeeProfileItem,
  RawContact,
} from "@/lib/acumatica";
import {
  fetchContacts,
  fetchEmployeeProfiles,
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import { formatPhoneForTwilioDial } from "@/lib/phone";
import { getReadModelDb } from "@/lib/read-model/db";
import {
  FULL_EMPLOYEE_DIRECTORY_SOURCE,
  replaceEmployeeDirectory,
} from "@/lib/read-model/employees";
import { INTERNAL_EMPLOYEE_EMAIL_DOMAINS } from "@/lib/internal-records";
import type { CallEmployeeDirectoryItem } from "@/lib/call-analytics/types";

let callEmployeeDirectorySyncPromise: Promise<CallEmployeeDirectoryItem[]> | null = null;

type StoredEmployeeDirectoryRow = {
  login_name: string;
  contact_id: number | null;
  display_name: string;
  email: string | null;
  normalized_phone: string | null;
  caller_id_phone: string | null;
  is_active: number;
  updated_at: string;
};

type CallEmployeeDirectoryMetaRow = {
  total: number;
  latest_updated_at: string | null;
};

type NormalizedInternalEmployeeProfile = {
  employeeId: string;
  loginName: string;
  contactId: number | null;
  displayName: string;
  email: string;
  normalizedPhone: string | null;
  callerIdPhone: string | null;
  isActive: boolean;
  updatedAt: string;
};

export type CallEmployeeDirectoryMeta = {
  total: number;
  latestUpdatedAt: string | null;
};

function buildInternalContactFilter(): string {
  return INTERNAL_EMPLOYEE_EMAIL_DOMAINS.map(
    (domain) => `substringof('@${domain.replace(/'/g, "''")}',Email)`,
  ).join(" or ");
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeLoginName(email: string | null): string | null {
  const trimmed = email?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return null;
  }

  const atIndex = trimmed.indexOf("@");
  const local = atIndex >= 0 ? trimmed.slice(0, atIndex) : trimmed;
  return local || null;
}

function isInternalEmployeeEmail(email: string | null): boolean {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  return INTERNAL_EMPLOYEE_EMAIL_DOMAINS.some((domain) =>
    normalizedEmail.endsWith(`@${domain}`),
  );
}

function buildInternalContactIdByEmail(contacts: RawContact[]): Map<string, number> {
  const byEmail = new Map<string, number>();
  for (const contact of contacts) {
    const email =
      readWrappedString(contact, "Email") || readWrappedString(contact, "EMail") || "";
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !isInternalEmployeeEmail(normalizedEmail)) {
      continue;
    }

    const contactId = readWrappedNumber(contact, "ContactID");
    if (contactId === null) {
      continue;
    }

    if (!byEmail.has(normalizedEmail)) {
      byEmail.set(normalizedEmail, contactId);
    }
  }

  return byEmail;
}

function readContactDisplayName(contact: RawContact): string | null {
  const explicit =
    readWrappedString(contact, "DisplayName") ||
    readWrappedString(contact, "FullName") ||
    readWrappedString(contact, "ContactName") ||
    readWrappedString(contact, "Attention");
  if (explicit) {
    return explicit.trim() || null;
  }

  const composite = [
    readWrappedString(contact, "FirstName"),
    readWrappedString(contact, "MiddleName"),
    readWrappedString(contact, "LastName"),
  ]
    .filter((value) => value.trim().length > 0)
    .join(" ")
    .trim();

  return composite || null;
}

function buildInternalContactByDisplayName(contacts: RawContact[]): Map<string, RawContact> {
  const byDisplayName = new Map<string, RawContact>();
  for (const contact of contacts) {
    const displayName = readContactDisplayName(contact);
    if (!displayName) {
      continue;
    }

    const email =
      readWrappedString(contact, "Email") || readWrappedString(contact, "EMail") || null;
    if (!isInternalEmployeeEmail(email)) {
      continue;
    }

    const key = normalizeComparable(displayName);
    if (!byDisplayName.has(key)) {
      byDisplayName.set(key, contact);
    }
  }

  return byDisplayName;
}

function shouldReplaceDirectoryItem(
  existing: NormalizedInternalEmployeeProfile | undefined,
  candidate: NormalizedInternalEmployeeProfile,
): boolean {
  if (!existing) {
    return true;
  }

  return (
    (candidate.isActive && !existing.isActive) ||
    (candidate.normalizedPhone !== null && existing.normalizedPhone === null) ||
    (candidate.contactId !== null && existing.contactId === null)
  );
}

function normalizeInternalEmployeeProfile(
  profile: EmployeeProfileItem,
  contactIdsByEmail: Map<string, number>,
  contactsByDisplayName: Map<string, RawContact>,
): NormalizedInternalEmployeeProfile | null {
  const employeeId = profile.employeeId.trim();
  if (!employeeId) {
    return null;
  }

  const fallbackContact =
    contactsByDisplayName.get(normalizeComparable(profile.displayName?.trim() || "")) ?? null;
  const fallbackEmail =
    readWrappedString(fallbackContact, "Email") ||
    readWrappedString(fallbackContact, "EMail") ||
    null;
  const email = (profile.email?.trim().toLowerCase() ?? fallbackEmail?.trim().toLowerCase()) ?? null;
  const loginName = normalizeLoginName(email);
  const displayName = profile.displayName?.trim() || loginName;
  const normalizedPhone = formatPhoneForTwilioDial(profile.phone);

  if (!loginName || !displayName || !email || !isInternalEmployeeEmail(email)) {
    return null;
  }

  return {
    employeeId,
    loginName,
    contactId:
      profile.contactId ??
      contactIdsByEmail.get(email) ??
      readWrappedNumber(fallbackContact, "ContactID") ??
      null,
    displayName,
    email,
    normalizedPhone,
    callerIdPhone: normalizedPhone,
    isActive: profile.isActive,
    updatedAt: new Date().toISOString(),
  };
}

function buildNormalizedInternalEmployeeProfiles(
  profiles: EmployeeProfileItem[],
  internalContacts: RawContact[] = [],
): NormalizedInternalEmployeeProfile[] {
  const contactIdsByEmail = buildInternalContactIdByEmail(internalContacts);
  const contactsByDisplayName = buildInternalContactByDisplayName(internalContacts);
  const deduped = new Map<string, NormalizedInternalEmployeeProfile>();
  for (const profile of profiles) {
    const normalized = normalizeInternalEmployeeProfile(
      profile,
      contactIdsByEmail,
      contactsByDisplayName,
    );
    if (!normalized) {
      continue;
    }

    const existing = deduped.get(normalized.loginName);
    if (shouldReplaceDirectoryItem(existing, normalized)) {
      deduped.set(normalized.loginName, normalized);
    }
  }

  return [...deduped.values()].sort((left, right) =>
    normalizeComparable(left.displayName).localeCompare(normalizeComparable(right.displayName)),
  );
}

export function buildCallEmployeeDirectoryFromEmployeeProfiles(
  profiles: EmployeeProfileItem[],
  internalContacts: RawContact[] = [],
): CallEmployeeDirectoryItem[] {
  return buildNormalizedInternalEmployeeProfiles(profiles, internalContacts).map((profile) => ({
    loginName: profile.loginName,
    contactId: profile.contactId,
    displayName: profile.displayName,
    email: profile.email,
    normalizedPhone: profile.normalizedPhone,
    callerIdPhone: profile.callerIdPhone,
    isActive: profile.isActive,
    updatedAt: profile.updatedAt,
  }));
}

export function buildEmployeeDirectoryFromEmployeeProfiles(
  profiles: EmployeeProfileItem[],
  internalContacts: RawContact[] = [],
): EmployeeDirectoryItem[] {
  return buildNormalizedInternalEmployeeProfiles(profiles, internalContacts).map((profile) => ({
    id: profile.employeeId,
    name: profile.displayName,
    loginName: profile.loginName,
    email: profile.email,
    contactId: profile.contactId,
    phone: profile.normalizedPhone,
    isActive: profile.isActive,
  }));
}

export async function syncCallEmployeeDirectory(
  cookieValue: string,
  authCookieRefresh?: AuthCookieRefreshState,
): Promise<CallEmployeeDirectoryItem[]> {
  if (!callEmployeeDirectorySyncPromise) {
    callEmployeeDirectorySyncPromise = (async () => {
      const [profiles, contacts] = await Promise.all([
        fetchEmployeeProfiles(cookieValue, authCookieRefresh),
        fetchContacts(
          cookieValue,
          {
            batchSize: 200,
            filter: buildInternalContactFilter(),
          },
          authCookieRefresh,
        ),
      ]);

      const employeeDirectoryItems = buildEmployeeDirectoryFromEmployeeProfiles(
        profiles,
        contacts,
      );
      const items = buildCallEmployeeDirectoryFromEmployeeProfiles(profiles, contacts);
      replaceEmployeeDirectory(employeeDirectoryItems, FULL_EMPLOYEE_DIRECTORY_SOURCE);
      replaceCallEmployeeDirectory(items);
      try {
        const { rebuildCallSessions } = await import("@/lib/call-analytics/sessionize");
        const { refreshStoredReadModelAccountSupplementalFields } = await import(
          "@/lib/read-model/accounts"
        );
        rebuildCallSessions();
        refreshStoredReadModelAccountSupplementalFields();
      } catch {
        // Keep employee syncing resilient even if the historical call repair step fails.
      }
      return items;
    })().finally(() => {
      callEmployeeDirectorySyncPromise = null;
    });
  }

  return callEmployeeDirectorySyncPromise;
}

export function replaceCallEmployeeDirectory(items: CallEmployeeDirectoryItem[]): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();
  const replace = db.transaction((directory: CallEmployeeDirectoryItem[]) => {
    db.prepare("DELETE FROM call_employee_directory").run();
    const insert = db.prepare(
      `
      INSERT INTO call_employee_directory (
        login_name,
        contact_id,
        display_name,
        email,
        normalized_phone,
        caller_id_phone,
        is_active,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const item of directory) {
      insert.run(
        item.loginName,
        item.contactId,
        item.displayName,
        item.email,
        item.normalizedPhone,
        item.callerIdPhone,
        item.isActive ? 1 : 0,
        item.updatedAt || now,
      );
    }
  });

  replace(items);
}

export function upsertCallEmployeeDirectoryItem(item: CallEmployeeDirectoryItem): void {
  const current = readCallEmployeeDirectory().filter(
    (existing) => normalizeComparable(existing.loginName) !== normalizeComparable(item.loginName),
  );
  replaceCallEmployeeDirectory([...current, item]);
}

export function readCallEmployeeDirectory(): CallEmployeeDirectoryItem[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        login_name,
        contact_id,
        display_name,
        email,
        normalized_phone,
        caller_id_phone,
        is_active,
        updated_at
      FROM call_employee_directory
      ORDER BY display_name COLLATE NOCASE ASC, login_name ASC
      `,
    )
    .all() as StoredEmployeeDirectoryRow[];

  return rows.map((row) => ({
    loginName: row.login_name,
    contactId: row.contact_id,
    displayName: row.display_name,
    email: row.email,
    normalizedPhone: row.normalized_phone,
    callerIdPhone: row.caller_id_phone,
    isActive: row.is_active === 1,
    updatedAt: row.updated_at,
  }));
}

export function readCallEmployeeDirectoryMeta(): CallEmployeeDirectoryMeta {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        MAX(updated_at) AS latest_updated_at
      FROM call_employee_directory
      `,
    )
    .get() as CallEmployeeDirectoryMetaRow | undefined;

  return {
    total: row?.total ?? 0,
    latestUpdatedAt: row?.latest_updated_at ?? null,
  };
}
