import { createHash } from "node:crypto";

import jefferyBuhagiarScheduleData from "@/data/visitation-routes/jeffery-buhagiar-fingerprints.json";

export type VisitationRouteFingerprintKind =
  | "companyAddress"
  | "company"
  | "address";

export type AuthoritativeVisitationRouteSchedule = {
  id: string;
  version: string;
  salesRepNames: string[];
  fingerprintSalt: string;
  referenceAccountTotal: number;
  expectedDayCounts: Array<[week: number, day: number, accountCount: number]>;
  fingerprints: Record<
    VisitationRouteFingerprintKind,
    Record<string, string>
  >;
};

export type SchedulableVisitationRouteAccount = {
  accountRecordId: string;
  businessAccountId: string;
  companyName: string;
  address: string;
  addressLine1: string;
  city: string;
  postalCode: string;
};

export type AuthoritativeScheduleMatchResult<TAccount> = {
  schedule: AuthoritativeVisitationRouteSchedule;
  days: Array<{ week: number; day: number; accounts: TAccount[] }>;
  unmatchedAccounts: TAccount[];
  matchedAccountTotal: number;
  missingReferenceAccountTotal: number;
};

const WEEK_COUNT = 12;
const DAY_COUNT = 5;
const FINGERPRINT_KINDS: readonly VisitationRouteFingerprintKind[] = [
  "companyAddress",
  "company",
  "address",
];

function normalizeComparable(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePostalCode(value: string | null | undefined): string {
  return (value ?? "").toLocaleUpperCase().replace(/[ -]/g, "");
}

export function buildVisitationRouteFingerprint(
  kind: VisitationRouteFingerprintKind,
  value: string,
  fingerprintSalt: string,
): string {
  return createHash("sha256")
    .update(`${fingerprintSalt}|${kind}|${value}`)
    .digest("hex");
}

export function buildVisitationRouteAccountFingerprints(
  account: Pick<
    SchedulableVisitationRouteAccount,
    "companyName" | "addressLine1" | "postalCode"
  >,
  fingerprintSalt: string,
): Partial<Record<VisitationRouteFingerprintKind, string>> {
  const company = normalizeComparable(account.companyName);
  const addressLine1 = normalizeComparable(account.addressLine1);
  const postalCode = normalizePostalCode(account.postalCode);
  const fingerprints: Partial<Record<VisitationRouteFingerprintKind, string>> = {};

  if (company && addressLine1) {
    fingerprints.companyAddress = buildVisitationRouteFingerprint(
      "companyAddress",
      `${company}|${addressLine1}|${postalCode}`,
      fingerprintSalt,
    );
  }
  if (company) {
    fingerprints.company = buildVisitationRouteFingerprint(
      "company",
      company,
      fingerprintSalt,
    );
  }
  if (addressLine1) {
    fingerprints.address = buildVisitationRouteFingerprint(
      "address",
      `${addressLine1}|${postalCode}`,
      fingerprintSalt,
    );
  }

  return fingerprints;
}

function parseDestination(
  value: string,
): { week: number; day: number } | null {
  const match = value.match(/^(\d+):(\d+)$/);
  if (!match) {
    return null;
  }
  const week = Number.parseInt(match[1] ?? "", 10);
  const day = Number.parseInt(match[2] ?? "", 10);
  return Number.isInteger(week) &&
    week >= 1 &&
    week <= WEEK_COUNT &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= DAY_COUNT
    ? { week, day }
    : null;
}

export function validateAuthoritativeVisitationRouteSchedule(
  value: AuthoritativeVisitationRouteSchedule,
): AuthoritativeVisitationRouteSchedule {
  if (!value.id.trim() || !value.version.trim() || !value.fingerprintSalt.trim()) {
    throw new Error("Authoritative route schedule metadata is incomplete.");
  }
  if (value.salesRepNames.length === 0 || value.salesRepNames.some((name) => !name.trim())) {
    throw new Error(`Authoritative route schedule ${value.id} has invalid sales rep names.`);
  }
  if (!Number.isInteger(value.referenceAccountTotal) || value.referenceAccountTotal < 0) {
    throw new Error(
      `Authoritative route schedule ${value.id} has an invalid reference account total.`,
    );
  }

  const expectedDayCount = WEEK_COUNT * DAY_COUNT;
  if (value.expectedDayCounts.length !== expectedDayCount) {
    throw new Error(
      `Authoritative route schedule ${value.id} has ${value.expectedDayCounts.length} days; expected ${expectedDayCount}.`,
    );
  }

  const dayKeys = new Set<string>();
  let expectedAccountTotal = 0;
  for (const [week, day, accountCount] of value.expectedDayCounts) {
    const destination = parseDestination(`${week}:${day}`);
    if (!destination || !Number.isInteger(accountCount) || accountCount < 0) {
      throw new Error(
        `Authoritative route schedule ${value.id} has an invalid expected day count.`,
      );
    }
    const key = `${destination.week}:${destination.day}`;
    if (dayKeys.has(key)) {
      throw new Error(
        `Authoritative route schedule ${value.id} repeats W${week} D${day}.`,
      );
    }
    dayKeys.add(key);
    expectedAccountTotal += accountCount;
  }
  if (expectedAccountTotal !== value.referenceAccountTotal) {
    throw new Error(
      `Authoritative route schedule ${value.id} expected account counts do not match its reference total.`,
    );
  }

  for (const kind of FINGERPRINT_KINDS) {
    const index = value.fingerprints[kind];
    if (!index || typeof index !== "object" || Array.isArray(index)) {
      throw new Error(
        `Authoritative route schedule ${value.id} has an invalid ${kind} fingerprint index.`,
      );
    }
    for (const [fingerprint, destinationValue] of Object.entries(index)) {
      if (!/^[a-f0-9]{64}$/.test(fingerprint) || !parseDestination(destinationValue)) {
        throw new Error(
          `Authoritative route schedule ${value.id} has an invalid ${kind} fingerprint entry.`,
        );
      }
    }
  }

  return value;
}

const AUTHORITATIVE_SCHEDULES = [
  validateAuthoritativeVisitationRouteSchedule(
    jefferyBuhagiarScheduleData as unknown as AuthoritativeVisitationRouteSchedule,
  ),
];

export function findAuthoritativeVisitationRouteSchedule(
  salesRepName: string | null | undefined,
): AuthoritativeVisitationRouteSchedule | null {
  const targetName = normalizeComparable(salesRepName);
  if (!targetName) {
    return null;
  }
  return (
    AUTHORITATIVE_SCHEDULES.find((schedule) =>
      schedule.salesRepNames.some(
        (candidate) => normalizeComparable(candidate) === targetName,
      ),
    ) ?? null
  );
}

export function matchAccountsToAuthoritativeSchedule<
  TAccount extends SchedulableVisitationRouteAccount,
>(
  accounts: TAccount[],
  scheduleValue: AuthoritativeVisitationRouteSchedule,
): AuthoritativeScheduleMatchResult<TAccount> {
  const schedule = validateAuthoritativeVisitationRouteSchedule(scheduleValue);
  const accountsByDay = new Map<string, TAccount[]>();
  const days = schedule.expectedDayCounts.map(([week, day]) => {
    const accountsForDay: TAccount[] = [];
    accountsByDay.set(`${week}:${day}`, accountsForDay);
    return { week, day, accounts: accountsForDay };
  });
  const unmatchedAccounts: TAccount[] = [];
  let matchedAccountTotal = 0;

  for (const account of accounts) {
    const fingerprints = buildVisitationRouteAccountFingerprints(
      account,
      schedule.fingerprintSalt,
    );
    let destination: { week: number; day: number } | null = null;
    for (const kind of FINGERPRINT_KINDS) {
      const fingerprint = fingerprints[kind];
      if (!fingerprint) {
        continue;
      }
      const destinationValue = schedule.fingerprints[kind][fingerprint];
      destination = destinationValue ? parseDestination(destinationValue) : null;
      if (destination) {
        break;
      }
    }

    const dayAccounts = destination
      ? accountsByDay.get(`${destination.week}:${destination.day}`)
      : null;
    if (!dayAccounts) {
      unmatchedAccounts.push(account);
      continue;
    }
    dayAccounts.push(account);
    matchedAccountTotal += 1;
  }

  return {
    schedule,
    days,
    unmatchedAccounts,
    matchedAccountTotal,
    missingReferenceAccountTotal: Math.max(
      0,
      schedule.referenceAccountTotal - matchedAccountTotal,
    ),
  };
}
