import { describe, expect, it } from "vitest";

import { buildAddressKeyFromRow } from "@/lib/read-model/geocodes";
import {
  buildVisitationRoutePlan,
  buildVisitationRouteSalesRepOptions,
  VISITATION_ROUTE_MIN_ACCOUNTS_PER_DAY,
} from "@/lib/visitation-route-report";
import {
  buildVisitationRouteAccountFingerprints,
  type AuthoritativeVisitationRouteSchedule,
} from "@/lib/visitation-route-schedule";
import type { BusinessAccountRow } from "@/types/business-account";

function buildRow(
  index: number,
  overrides: Partial<BusinessAccountRow> = {},
): BusinessAccountRow {
  const id = overrides.accountRecordId ?? `account-${index}`;
  return {
    id,
    accountRecordId: id,
    rowKey: overrides.rowKey ?? `${id}:contact:1`,
    contactId: overrides.contactId ?? index,
    isPrimaryContact: overrides.isPrimaryContact ?? true,
    companyPhone: overrides.companyPhone ?? `905-555-${String(index).padStart(4, "0")}`,
    salesRepId: overrides.salesRepId ?? "rep-1",
    salesRepName: overrides.salesRepName ?? "Jeffery Ye",
    industryType: overrides.industryType ?? null,
    subCategory: overrides.subCategory ?? null,
    companyRegion: overrides.companyRegion ?? null,
    week: overrides.week ?? null,
    businessAccountId: overrides.businessAccountId ?? `B${index}`,
    companyName: overrides.companyName ?? `Company ${index}`,
    address: overrides.address ?? `${index} Test Street, Toronto ON`,
    addressLine1: overrides.addressLine1 ?? `${index} Test Street`,
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Toronto",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? `M1A ${String(index).padStart(3, "0")}`,
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? `Contact ${index}`,
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? "Manager",
    primaryContactPhone: overrides.primaryContactPhone ?? "416-555-0100",
    primaryContactExtension: overrides.primaryContactExtension ?? "",
    primaryContactEmail: overrides.primaryContactEmail ?? `contact${index}@example.com`,
    primaryContactId: overrides.primaryContactId ?? index,
    category: overrides.category ?? (index % 2 === 0 ? "A" : "B"),
    notes: overrides.notes ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? null,
    ...overrides,
  };
}

const SYNTHETIC_SCHEDULE_SALT = "synthetic-route-test-salt";

function syntheticSchedule(
  rows: BusinessAccountRow[],
  salesRepName = "Synthetic Route Rep",
): AuthoritativeVisitationRouteSchedule {
  const companyAddress: Record<string, string> = {};
  const company: Record<string, string> = {};
  const address: Record<string, string> = {};
  const expectedDayCounts: Array<[number, number, number]> = Array.from(
    { length: 12 },
    (_, weekIndex) =>
      Array.from(
        { length: 5 },
        (_, dayIndex): [number, number, number] => [weekIndex + 1, dayIndex + 1, 0],
      ),
  ).flat();

  for (const row of rows) {
    const match = row.accountRecordId?.match(/^scheduled-w(\d+)-d(\d+)-s\d+$/);
    if (!match) {
      continue;
    }
    const week = Number.parseInt(match[1] ?? "", 10);
    const day = Number.parseInt(match[2] ?? "", 10);
    const destination = `${week}:${day}`;
    const dayCount = expectedDayCounts.find(
      ([candidateWeek, candidateDay]) => candidateWeek === week && candidateDay === day,
    );
    if (dayCount) {
      dayCount[2] += 1;
    }

    const fingerprints = buildVisitationRouteAccountFingerprints(
      {
        companyName: row.companyName ?? "",
        addressLine1: row.addressLine1 ?? "",
        postalCode: row.postalCode ?? "",
      },
      SYNTHETIC_SCHEDULE_SALT,
    );
    if (fingerprints.companyAddress) {
      companyAddress[fingerprints.companyAddress] = destination;
    }
    if (fingerprints.company) {
      company[fingerprints.company] = destination;
    }
    if (fingerprints.address) {
      address[fingerprints.address] = destination;
    }
  }

  return {
    id: "synthetic-authoritative-schedule",
    version: "test-v1",
    salesRepNames: [salesRepName],
    fingerprintSalt: SYNTHETIC_SCHEDULE_SALT,
    referenceAccountTotal: rows.length,
    expectedDayCounts,
    fingerprints: { companyAddress, company, address },
  };
}

function buildSyntheticScheduleRows(): BusinessAccountRow[] {
  return Array.from({ length: 12 }, (_, weekIndex) =>
    Array.from({ length: 5 }, (_, dayIndex) =>
      Array.from({ length: 10 }, (_, stopIndex) => {
        const week = weekIndex + 1;
        const day = dayIndex + 1;
        const stop = stopIndex + 1;
        const index = weekIndex * 50 + dayIndex * 10 + stop;
        const accountRecordId = `scheduled-w${week}-d${day}-s${stop}`;
        return buildRow(index, {
          id: accountRecordId,
          accountRecordId,
          rowKey: `${accountRecordId}:contact:1`,
          businessAccountId: `synthetic-${index}`,
          salesRepId: "synthetic-rep",
          salesRepName: "Synthetic Route Rep",
          companyName: `Synthetic Company ${index}`,
          address: `${1000 + index} Example Ave, Test City ON T1T 1T1, CA`,
          addressLine1: `${1000 + index} Example Ave`,
          city: `Synthetic Zone ${week}-${day}`,
          state: "ON",
          postalCode: `T${week % 10}T ${day}T${stop % 10}`,
          country: "CA",
          // The saved day membership must take precedence over this value.
          week: "Week 12",
          category: "B",
        });
      }),
    ).flat(),
  ).flat();
}

describe("visitation route report", () => {
  it("counts unique A/B accounts by sales rep", () => {
    const primary = buildRow(1);
    const duplicateContact = buildRow(1, {
      id: primary.id,
      accountRecordId: primary.accountRecordId,
      rowKey: `${primary.id}:contact:2`,
      contactId: 200,
      isPrimaryContact: false,
    });
    const rows = [
      primary,
      duplicateContact,
      buildRow(2),
      buildRow(3, { salesRepId: "rep-2", salesRepName: "Alex Smith" }),
      buildRow(4, { category: "C" }),
    ];

    expect(buildVisitationRouteSalesRepOptions(rows)).toEqual([
      { id: "rep-2", name: "Alex Smith", accountCount: 1 },
      { id: "rep-1", name: "Jeffery Ye", accountCount: 2 },
    ]);
  });

  it("covers every selected account once across balanced weeks and days", () => {
    const rows = Array.from({ length: 62 }, (_, index) => buildRow(index + 1));
    rows.push(buildRow(100, { salesRepId: "rep-2", salesRepName: "Other Rep" }));
    rows.push(buildRow(101, { category: "C" }));
    const geocodes = new Map(
      rows.slice(0, 60).map((row, index) => [
        buildAddressKeyFromRow(row),
        {
          latitude: 43.5 + Math.floor(index / 10) * 0.08,
          longitude: -79.9 + (index % 10) * 0.04,
        },
      ]),
    );

    const plan = buildVisitationRoutePlan({
      rows,
      geocodes,
      salesRepId: "rep-1",
      salesRepName: "Jeffery Ye",
      generatedAt: new Date("2026-07-17T12:00:00.000Z"),
    });

    expect(plan.accountTotal).toBe(62);
    expect(plan.mappedAccountTotal).toBe(60);
    expect(plan.unmappedAccountTotal).toBe(2);
    expect(plan.days).toHaveLength(60);
    const allIds = plan.days.flatMap((day) =>
      day.accounts.map((account) => account.accountRecordId),
    );
    expect(new Set(allIds).size).toBe(62);
    expect(allIds).toHaveLength(62);

    const weekCounts = Array.from({ length: 12 }, (_, weekIndex) =>
      plan.days
        .filter((day) => day.week === weekIndex + 1)
        .reduce((sum, day) => sum + day.accounts.length, 0),
    );
    expect(Math.max(...weekCounts) - Math.min(...weekCounts)).toBeLessThanOrEqual(1);
    for (let week = 1; week <= 12; week += 1) {
      const dayCounts = plan.days
        .filter((day) => day.week === week)
        .map((day) => day.accounts.length);
      expect(dayCounts).toHaveLength(5);
      expect(Math.max(...dayCounts) - Math.min(...dayCounts)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps assigned weeks authoritative and builds five compact ten-stop days", () => {
    const rows: BusinessAccountRow[] = [];
    const geocodes = new Map<string, { latitude: number; longitude: number }>();
    const expectedWeekByAccountId = new Map<string, number>();

    for (let week = 1; week <= 12; week += 1) {
      for (let zone = 0; zone < 5; zone += 1) {
        for (let stop = 0; stop < 10; stop += 1) {
          const index = (week - 1) * 50 + zone * 10 + stop + 1;
          const row = buildRow(index, {
            week: `Week ${week}`,
            city: `Zone ${zone + 1}`,
          });
          rows.push(row);
          expectedWeekByAccountId.set(row.accountRecordId ?? row.id, week);
          geocodes.set(buildAddressKeyFromRow(row), {
            latitude: 43 + week * 0.01 + stop * 0.00001,
            longitude: -80 + zone * 0.08 + stop * 0.00001,
          });
        }
      }
    }

    const plan = buildVisitationRoutePlan({
      rows,
      geocodes,
      salesRepId: "rep-1",
      salesRepName: "Jeffery Ye",
      generatedAt: new Date("2026-07-17T12:00:00.000Z"),
    });

    expect(plan.accountTotal).toBe(600);
    expect(plan.days).toHaveLength(60);
    for (const day of plan.days) {
      expect(day.accounts).toHaveLength(10);
      expect(new Set(day.accounts.map((account) => account.city)).size).toBe(1);
      for (const account of day.accounts) {
        expect(expectedWeekByAccountId.get(account.accountRecordId)).toBe(day.week);
        expect(account.assignedWeek).toBe(day.week);
      }
    }
  });

  it("keeps authoritative week/day membership, places only new accounts, and orders stops geographically", () => {
    const scheduledRows = buildSyntheticScheduleRows();
    const schedule = syntheticSchedule(scheduledRows);
    const geocodes = new Map<string, { latitude: number; longitude: number }>();
    const expectedDayByAccountId = new Map<string, string>();
    for (const row of scheduledRows) {
      const match = row.accountRecordId?.match(/^scheduled-w(\d+)-d(\d+)-s(\d+)$/);
      expect(match).not.toBeNull();
      const week = Number.parseInt(match?.[1] ?? "", 10);
      const day = Number.parseInt(match?.[2] ?? "", 10);
      const stop = Number.parseInt(match?.[3] ?? "", 10);
      expectedDayByAccountId.set(row.accountRecordId ?? row.id, `W${week}D${day}`);
      geocodes.set(buildAddressKeyFromRow(row), {
        latitude: 43 + week * 0.08 + day * 0.01,
        longitude: -80 + day * 0.1 + stop * 0.001,
      });
    }

    const newAccount = buildRow(601, {
      id: "new-synthetic-account",
      accountRecordId: "new-synthetic-account",
      rowKey: "new-synthetic-account:contact:1",
      businessAccountId: "new-synthetic-business",
      salesRepId: "synthetic-rep",
      salesRepName: "Synthetic Route Rep",
      companyName: "New Synthetic Company",
      address: "9000 Example Ave, Synthetic Zone 3-4 ON T3T 4T4, CA",
      addressLine1: "9000 Example Ave",
      city: "Synthetic Zone 3-4",
      state: "ON",
      postalCode: "T3T 4T4",
      country: "CA",
      week: "Week 3",
      category: "B",
    });
    geocodes.set(buildAddressKeyFromRow(newAccount), {
      latitude: 43 + 3 * 0.08 + 4 * 0.01,
      longitude: -80 + 4 * 0.1 + 0.0055,
    });

    const plan = buildVisitationRoutePlan({
      rows: [newAccount, ...scheduledRows].reverse(),
      geocodes,
      salesRepId: "synthetic-rep",
      salesRepName: "Synthetic Route Rep",
      generatedAt: new Date("2026-07-21T12:00:00.000Z"),
      authoritativeSchedule: schedule,
    });

    expect(plan.days).toHaveLength(60);
    expect(plan.scheduleDiagnostics).toMatchObject({
      scheduleId: "synthetic-authoritative-schedule",
      scheduleVersion: "test-v1",
      referenceAccountTotal: 600,
      matchedScheduledAccountTotal: 600,
      missingReferenceAccountTotal: 0,
      newlyPlacedAccountTotal: 1,
    });
    for (const day of plan.days) {
      expect(day.accounts.length).toBeGreaterThanOrEqual(
        VISITATION_ROUTE_MIN_ACCOUNTS_PER_DAY,
      );
      for (const account of day.accounts) {
        const expectedDay = expectedDayByAccountId.get(account.accountRecordId);
        if (expectedDay) {
          expect(`W${day.week}D${day.day}`).toBe(expectedDay);
        }
      }
    }

    const w3d4 = plan.days.find((day) => day.week === 3 && day.day === 4);
    expect(
      w3d4?.accounts.some(
        (account) => account.accountRecordId === "new-synthetic-account",
      ),
    ).toBe(true);

    const w1d1 = plan.days.find((day) => day.week === 1 && day.day === 1);
    expect(w1d1?.accounts.map((account) => account.accountRecordId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `scheduled-w1-d1-s${index + 1}`),
    );
  });

  it("rejects an authoritative schedule when any day cannot reach ten accounts", () => {
    const scheduledRows = buildSyntheticScheduleRows();
    const schedule = syntheticSchedule(scheduledRows);

    expect(() =>
      buildVisitationRoutePlan({
        rows: scheduledRows.slice(1),
        geocodes: new Map(),
        salesRepId: "synthetic-rep",
        salesRepName: "Synthetic Route Rep",
        authoritativeSchedule: schedule,
      }),
    ).toThrow(/at least 10 accounts.*W1 D1 \(9\)/);
  });

  it("uses the primary contact for the route sheet", () => {
    const nonPrimary = buildRow(1, {
      isPrimaryContact: false,
      primaryContactName: "Alternate Contact",
      primaryContactEmail: "alternate@example.com",
    });
    const primary = buildRow(1, {
      rowKey: "account-1:contact:2",
      contactId: 2,
      primaryContactId: 2,
      isPrimaryContact: true,
      primaryContactName: "Primary Contact",
      primaryContactEmail: "primary@example.com",
    });
    const plan = buildVisitationRoutePlan({
      rows: [nonPrimary, primary],
      geocodes: new Map(),
      salesRepName: "Jeffery Ye",
    });
    const account = plan.days.flatMap((day) => day.accounts)[0];

    expect(account.contactName).toBe("Primary Contact");
    expect(account.contactEmail).toBe("primary@example.com");
  });
});
