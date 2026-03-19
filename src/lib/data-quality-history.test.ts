import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessAccountRow } from "@/types/business-account";

function setBaseEnv(historyPath: string): void {
  process.env.AUTH_PROVIDER = "acumatica";
  process.env.ACUMATICA_BASE_URL = "https://example.acumatica.com";
  process.env.ACUMATICA_ENTITY_PATH = "/entity/lightspeed/24.200.001";
  process.env.ACUMATICA_COMPANY = "MeadowBrook Live";
  process.env.ACUMATICA_LOCALE = "en-US";
  process.env.AUTH_COOKIE_NAME = ".ASPXAUTH";
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.AUTH_LOGIN_URL = "";
  process.env.AUTH_ME_URL = "";
  process.env.AUTH_LOGOUT_URL = "";
  process.env.AUTH_FORGOT_PASSWORD_URL = "";
  process.env.ACUMATICA_BRANCH = "";
  process.env.ACUMATICA_OPPORTUNITY_ENTITY = "Opportunity";
  process.env.ACUMATICA_OPPORTUNITY_CLASS_ID = "PRODUCTION";
  process.env.ACUMATICA_OPPORTUNITY_STAGE = "Awaiting Estimate";
  process.env.ACUMATICA_OPPORTUNITY_LOCATION = "MAIN";
  process.env.ACUMATICA_OPPORTUNITY_ESTIMATION_OFFSET_DAYS = "0";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_WIN_JOB_ID = "Do you think we are going to win this job?";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_LINK_TO_DRIVE_ID = "Link to Drive";
  process.env.ACUMATICA_OPPORTUNITY_ATTR_PROJECT_TYPE_ID = "Project Type";
  process.env.ACUMATICA_OPPORTUNITY_DEFAULT_LINK_TO_DRIVE = "";
  process.env.MAIL_INTERNAL_DOMAIN = "meadowb.com";
  process.env.MAIL_CONNECT_RETURN_PATH = "/mail";
  process.env.READ_MODEL_ENABLED = "true";
  process.env.READ_MODEL_SQLITE_PATH = path.join(path.dirname(historyPath), "read-model.sqlite");
  process.env.DATA_QUALITY_HISTORY_PATH = historyPath;
  process.env.READ_MODEL_STALE_AFTER_MS = "300000";
  process.env.READ_MODEL_SYNC_INTERVAL_MS = "300000";
  process.env.CALL_ANALYTICS_STALE_AFTER_MS = "300000";
  process.env.CALL_EMPLOYEE_DIRECTORY_STALE_AFTER_MS = "300000";
}

function buildRow(overrides: Partial<BusinessAccountRow>): BusinessAccountRow {
  return {
    id: overrides.id ?? "row-id",
    accountRecordId: overrides.accountRecordId ?? "account-id",
    rowKey: overrides.rowKey ?? "row-key",
    contactId: overrides.contactId !== undefined ? overrides.contactId : 1,
    isPrimaryContact: overrides.isPrimaryContact ?? false,
    phoneNumber: overrides.phoneNumber ?? "416-000-0000",
    salesRepId: overrides.salesRepId ?? "109343",
    salesRepName: overrides.salesRepName ?? "Jorge Serrano",
    industryType: overrides.industryType ?? "Distribution",
    subCategory: overrides.subCategory ?? "Manufacturing",
    companyRegion: overrides.companyRegion ?? "Region 1",
    week: overrides.week ?? "Week 1",
    businessAccountId: overrides.businessAccountId ?? "BA-100",
    companyName: overrides.companyName ?? "Example Company",
    address: overrides.address ?? "5579 McAdam Road, Mississauga ON L4Z 1N4, CA",
    addressLine1: overrides.addressLine1 ?? "5579 McAdam Road",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Mississauga",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "L4Z 1N4",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? "Jane Doe",
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? null,
    primaryContactPhone: overrides.primaryContactPhone ?? "416-230-4681",
    primaryContactExtension: overrides.primaryContactExtension ?? null,
    primaryContactRawPhone: overrides.primaryContactRawPhone ?? overrides.primaryContactPhone ?? "416-230-4681",
    primaryContactEmail: overrides.primaryContactEmail ?? "jane@example.com",
    primaryContactId: overrides.primaryContactId !== undefined ? overrides.primaryContactId : 1,
    category: overrides.category ?? "A",
    notes: overrides.notes ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-03-10T12:00:00.000Z",
  };
}

describe("data quality history review persistence", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "dq-history-"));
    vi.resetModules();
    setBaseEnv(path.join(tempDir, "history.json"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("keeps reviewed row issues hidden after sync even when the row key changes", async () => {
    const {
      buildDataQualityIssueKey,
      buildDataQualityReviewedItemKey,
      buildDataQualitySnapshot,
    } = await import("@/lib/data-quality");
    const {
      markIssuesReviewed,
      paginateReviewedDataQualityIssues,
      syncDataQualityHistory,
    } = await import("@/lib/data-quality-history");

    const initialSnapshot = buildDataQualitySnapshot([
      buildRow({
        id: "acc-1",
        accountRecordId: "acc-1",
        rowKey: "acc-1:contact:501",
        businessAccountId: "",
        companyName: "",
        contactId: 501,
        primaryContactId: 501,
        primaryContactName: "Lauren Aleixo",
      }),
    ]);
    const initialIssue = initialSnapshot.issues.missingCompany.row[0];
    expect(initialIssue).toBeDefined();
    if (!initialIssue) {
      return;
    }

    await syncDataQualityHistory(initialSnapshot, "2026-03-13T10:00:00.000Z");
    await markIssuesReviewed(
      [buildDataQualityIssueKey("missingCompany", "row", initialIssue)],
      "review",
      [buildDataQualityReviewedItemKey("missingCompany", "row", initialIssue)],
      "2026-03-13T10:01:00.000Z",
    );

    const refreshedSnapshot = buildDataQualitySnapshot([
      buildRow({
        id: "acc-1",
        accountRecordId: "acc-1",
        rowKey: "acc-1:contact:501:refreshed",
        businessAccountId: "",
        companyName: "",
        contactId: 501,
        primaryContactId: 501,
        primaryContactName: "Lauren Aleixo",
      }),
    ]);
    await syncDataQualityHistory(refreshedSnapshot, "2026-03-13T10:05:00.000Z");

    const page = await paginateReviewedDataQualityIssues(
      refreshedSnapshot,
      "missingCompany",
      "row",
      1,
      25,
    );

    expect(page.total).toBe(0);
    expect(page.items).toHaveLength(0);
  });

  it("keeps reviewed duplicate groups hidden after sync", async () => {
    const {
      buildDataQualityIssueKey,
      buildDataQualityReviewedGroupKey,
      buildDataQualitySnapshot,
    } = await import("@/lib/data-quality");
    const {
      markIssuesReviewed,
      paginateReviewedDataQualityIssues,
      syncDataQualityHistory,
    } = await import("@/lib/data-quality-history");

    const initialSnapshot = buildDataQualitySnapshot([
      buildRow({
        id: "dup-a",
        accountRecordId: "dup-account",
        rowKey: "dup-account:contact:1001",
        businessAccountId: "BA-DUP",
        companyName: "University of Toronto Schools",
        contactId: 1001,
        primaryContactId: 1001,
        primaryContactName: "Navdeep Singh",
      }),
      buildRow({
        id: "dup-b",
        accountRecordId: "dup-account",
        rowKey: "dup-account:contact:1002",
        businessAccountId: "BA-DUP",
        companyName: "University of Toronto Schools",
        contactId: 1002,
        primaryContactId: 1002,
        primaryContactName: "Navdeep Singh",
      }),
    ]);
    const duplicateRows = initialSnapshot.issues.duplicateContact.row;
    expect(duplicateRows).toHaveLength(2);
    const duplicateGroupKey = duplicateRows[0]?.duplicateGroupKey;
    expect(duplicateGroupKey).toBeTruthy();
    if (!duplicateGroupKey) {
      return;
    }

    await syncDataQualityHistory(initialSnapshot, "2026-03-13T11:00:00.000Z");
    await markIssuesReviewed(
      duplicateRows.map((row) => buildDataQualityIssueKey("duplicateContact", "row", row)),
      "review",
      [buildDataQualityReviewedGroupKey("duplicateContact", "row", duplicateGroupKey)],
      "2026-03-13T11:01:00.000Z",
    );

    const refreshedSnapshot = buildDataQualitySnapshot([
      buildRow({
        id: "dup-a",
        accountRecordId: "dup-account",
        rowKey: "dup-account:contact:1001:refreshed",
        businessAccountId: "BA-DUP",
        companyName: "University of Toronto Schools",
        contactId: 1001,
        primaryContactId: 1001,
        primaryContactName: "Navdeep Singh",
      }),
      buildRow({
        id: "dup-b",
        accountRecordId: "dup-account",
        rowKey: "dup-account:contact:1002:refreshed",
        businessAccountId: "BA-DUP",
        companyName: "University of Toronto Schools",
        contactId: 1002,
        primaryContactId: 1002,
        primaryContactName: "Navdeep Singh",
      }),
    ]);
    await syncDataQualityHistory(refreshedSnapshot, "2026-03-13T11:05:00.000Z");

    const page = await paginateReviewedDataQualityIssues(
      refreshedSnapshot,
      "duplicateContact",
      "row",
      1,
      200,
    );

    expect(page.total).toBe(0);
    expect(page.items).toHaveLength(0);
  });

  it("counts same-day fix events in throughput and trends without treating the bootstrap snapshot as new work", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-13T16:30:00.000Z"));

      const { buildDataQualitySnapshot, buildDataQualityIssueKey } = await import(
        "@/lib/data-quality"
      );
      const {
        buildDataQualityThroughput,
        buildDataQualityTrends,
        recordFixedIssues,
        syncDataQualityHistory,
      } = await import("@/lib/data-quality-history");

      const snapshot = buildDataQualitySnapshot([
        buildRow({
          id: "acc-2",
          accountRecordId: "acc-2",
          rowKey: "acc-2:contact:9001",
          businessAccountId: "BA-200",
          companyName: "Example Company",
          contactId: 9001,
          primaryContactId: 9001,
          primaryContactName: "Richard Rozenberg",
          primaryContactEmail: "",
        }),
      ]);
      const issue = snapshot.issues.missingContactEmail.row[0];
      expect(issue).toBeDefined();
      if (!issue) {
        return;
      }

      await syncDataQualityHistory(snapshot, "2026-03-13T10:00:00.000Z");
      await recordFixedIssues(
        [buildDataQualityIssueKey("missingContactEmail", "row", issue)],
        {
          userId: "jserrano",
          userName: "Jorge Serrano",
        },
        "2026-03-13T15:15:00.000Z",
      );

      const throughput = await buildDataQualityThroughput("row");
      const trends = await buildDataQualityTrends("row");
      const todayPoint = trends.points[trends.points.length - 1];

      expect(throughput.today.fixed).toBe(1);
      expect(throughput.today.created).toBe(0);
      expect(throughput.today.netChange).toBe(1);
      expect(todayPoint?.fixed).toBe(1);
      expect(todayPoint?.created).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
