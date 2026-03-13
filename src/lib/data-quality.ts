import { filterSuppressedBusinessAccountRows } from "@/lib/business-accounts";
import type { BusinessAccountRow } from "@/types/business-account";
import {
  DATA_QUALITY_METRIC_KEYS,
  type DataQualityBasis,
  type DataQualityIssueRow,
  type DataQualityIssuesResponse,
  type DataQualityMetric,
  type DataQualityMetricKey,
  type DataQualitySummaryResponse,
} from "@/types/data-quality";

type AccountGroup = {
  accountKey: string;
  rows: BusinessAccountRow[];
  representativeRow: BusinessAccountRow;
};

type MetricIssueSets = Record<
  DataQualityMetricKey,
  {
    account: DataQualityIssueRow[];
    row: DataQualityIssueRow[];
  }
>;

export type DataQualitySnapshot = {
  computedAtIso: string;
  totals: {
    accounts: number;
    rows: number;
  };
  issueTotals: {
    accountsWithIssues: number;
    rowsWithIssues: number;
    accountIssuePct: number;
    rowIssuePct: number;
  };
  overallScorePct: number;
  metrics: DataQualityMetric[];
  issues: MetricIssueSets;
};

const METRIC_LABELS: Record<DataQualityMetricKey, string> = {
  missingCompany: "Contact Assignment Issues",
  missingContact: "Primary Contact Issues",
  invalidPhone: "Phone Number Issues",
  missingContactEmail: "Email Address Issues",
  missingSalesRep: "Sales Representative Issues",
  missingCategory: "Category Issues",
  missingRegion: "Company Region Issues",
  missingSubCategory: "Sub-Category Issues",
  missingIndustry: "Industry Type Issues",
  duplicateBusinessAccount: "Duplicate Business Account",
  duplicateContact: "Duplicate Contact",
};

const COMPANY_DUPLICATE_NOISE_TOKENS = new Set<string>([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "lp",
  "llc",
  "plc",
  "the",
]);

const CONTACT_DUPLICATE_NOISE_TOKENS = new Set<string>([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "jr",
  "sr",
]);

function toPct(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((part / total) * 1000) / 10;
}

function toAccountKey(row: BusinessAccountRow, index: number): string {
  return (
    row.accountRecordId?.trim() ||
    row.id.trim() ||
    row.businessAccountId.trim() ||
    row.companyName.trim() ||
    `row-${index}`
  );
}

function hasUsableIssueContactName(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 2;
}

function resolveIssueSourceRowKind(
  row: BusinessAccountRow,
): "contact" | "account" | "unknown" {
  const rowKey = row.rowKey?.trim() ?? "";
  if (rowKey.includes(":contact:")) {
    return "contact";
  }
  if (rowKey) {
    return "account";
  }
  return "unknown";
}

function resolveIssueDisplayRow(
  row: BusinessAccountRow,
  siblingRows?: BusinessAccountRow[],
): BusinessAccountRow {
  if (hasUsableIssueContactName(row.primaryContactName) || !siblingRows?.length) {
    return row;
  }

  const matchingContactRow =
    row.contactId !== null && row.contactId !== undefined
      ? siblingRows.find(
          (candidate) =>
            candidate !== row &&
            candidate.contactId === row.contactId &&
            hasUsableIssueContactName(candidate.primaryContactName),
        )
      : null;
  if (matchingContactRow) {
    return matchingContactRow;
  }

  const namedPrimaryRow = siblingRows.find(
    (candidate) =>
      candidate !== row &&
      candidate.isPrimaryContact &&
      hasUsableIssueContactName(candidate.primaryContactName),
  );
  if (namedPrimaryRow) {
    return namedPrimaryRow;
  }

  return (
    siblingRows.find(
      (candidate) =>
        candidate !== row &&
        candidate.contactId !== null &&
        candidate.contactId !== undefined &&
        hasUsableIssueContactName(candidate.primaryContactName),
    ) ?? row
  );
}

function buildIssueRow(
  accountKey: string,
  row: BusinessAccountRow,
  siblingRows?: BusinessAccountRow[],
  duplicateGroupKey?: string | null,
): DataQualityIssueRow {
  const displayRow = resolveIssueDisplayRow(row, siblingRows);
  const isResolvedFromSameContact =
    displayRow === row ||
    (displayRow.contactId !== null &&
      displayRow.contactId !== undefined &&
      displayRow.contactId === row.contactId);

  return {
    accountKey,
    accountRecordId: row.accountRecordId ?? null,
    businessAccountId: row.businessAccountId,
    companyName: row.companyName,
    rowKey: row.rowKey ?? null,
    contactId: displayRow.contactId ?? null,
    contactName: displayRow.primaryContactName,
    contactPhone: displayRow.primaryContactPhone,
    contactExtension: displayRow.primaryContactExtension ?? null,
    contactEmail: displayRow.primaryContactEmail,
    rawContactName: row.primaryContactName,
    rawContactPhone: row.primaryContactRawPhone ?? row.primaryContactPhone,
    rawContactEmail: row.primaryContactEmail,
    rawCompanyName: row.companyName,
    rawAddress: row.address,
    sourceRowKind: resolveIssueSourceRowKind(row),
    isPrimaryContact: isResolvedFromSameContact ? Boolean(row.isPrimaryContact) : false,
    salesRepName: row.salesRepName,
    address: row.address,
    category: row.category,
    companyRegion: row.companyRegion,
    subCategory: row.subCategory,
    industryType: row.industryType,
    week: row.week,
    duplicateGroupKey: duplicateGroupKey ?? null,
  };
}

function sortIssueRows(rows: DataQualityIssueRow[]): DataQualityIssueRow[] {
  return [...rows].sort((left, right) => {
    const groupCompare = (left.duplicateGroupKey ?? "").localeCompare(
      right.duplicateGroupKey ?? "",
      undefined,
      {
        sensitivity: "base",
        numeric: true,
      },
    );
    if (groupCompare !== 0) {
      return groupCompare;
    }

    const companyCompare = left.companyName.localeCompare(right.companyName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (companyCompare !== 0) {
      return companyCompare;
    }

    const contactCompare = (left.contactName ?? "").localeCompare(right.contactName ?? "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (contactCompare !== 0) {
      return contactCompare;
    }

    return (left.rowKey ?? "").localeCompare(right.rowKey ?? "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSalesRepFilter(
  row: DataQualityIssueRow,
  salesRep: string | undefined,
): boolean {
  if (!salesRep) {
    return true;
  }

  if (salesRep === "__unassigned__") {
    return !row.salesRepName?.trim();
  }

  return normalizeComparable(row.salesRepName ?? "") === normalizeComparable(salesRep);
}

export function buildDataQualityIssueKey(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  row: DataQualityIssueRow,
): string {
  if (basis === "account") {
    const identity =
      row.accountRecordId?.trim() ||
      row.accountKey.trim() ||
      row.businessAccountId.trim() ||
      normalizeComparable(row.companyName);
    return `${metric}|account|${identity}`;
  }

  const identity =
    row.rowKey?.trim() ||
    (row.contactId !== null ? `${row.accountKey}:contact:${row.contactId}` : "") ||
    `${row.accountKey}:${normalizeComparable(row.contactName ?? "contact")}:${metric}`;

  return `${metric}|row|${identity}`;
}

function buildDataQualityReviewIdentity(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  row: DataQualityIssueRow,
): string {
  if (basis === "account") {
    return (
      row.accountRecordId?.trim() ||
      row.accountKey.trim() ||
      row.businessAccountId.trim() ||
      normalizeComparable(row.companyName)
    );
  }

  return (
    (row.contactId !== null ? `${row.accountKey}:contact:${row.contactId}` : "") ||
    row.rowKey?.trim() ||
    `${row.accountKey}:${normalizeComparable(row.contactName ?? "contact")}:${metric}`
  );
}

export function buildDataQualityReviewedItemKey(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  row: DataQualityIssueRow,
): string {
  return `${metric}|${basis}|${buildDataQualityReviewIdentity(metric, basis, row)}`;
}

export function buildDataQualityReviewedGroupKey(
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  groupKey: string,
): string {
  return `${metric}|${basis}|group|${groupKey.trim()}`;
}

function normalizeDuplicateName(
  value: string | null | undefined,
  noiseTokens: Set<string>,
): string {
  if (!value) {
    return "";
  }

  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const normalized = ascii
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !noiseTokens.has(token));

  if (tokens.length === 0) {
    return normalized;
  }

  return tokens.join(" ");
}

function normalizeCompanyNameForDuplicate(value: string | null | undefined): string {
  return normalizeDuplicateName(value, COMPANY_DUPLICATE_NOISE_TOKENS);
}

function normalizeAddressForDuplicate(row: BusinessAccountRow): string {
  const composed = [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.state,
    row.postalCode,
    row.country,
  ]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join(" ");

  const fallback = composed || row.address || "";
  if (!fallback.trim()) {
    return "";
  }

  return fallback
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeContactNameForDuplicate(value: string | null | undefined): string {
  return normalizeDuplicateName(value, CONTACT_DUPLICATE_NOISE_TOKENS);
}

function isSalesRepMissing(row: BusinessAccountRow): boolean {
  if (isCompanyAssignmentMissing(row)) {
    return false;
  }
  const hasRepId = typeof row.salesRepId === "string" && row.salesRepId.trim().length > 0;
  const hasRepName = !isShortTextMissing(row.salesRepName, 2);
  return !hasRepId && !hasRepName;
}

function isCompanyAssignmentMissing(row: BusinessAccountRow): boolean {
  const businessAccountId =
    typeof row.businessAccountId === "string" ? row.businessAccountId.trim() : "";
  return businessAccountId.length === 0 || isShortTextMissing(row.companyName, 2);
}

function isAssociatedContactRow(row: BusinessAccountRow): boolean {
  return typeof row.rowKey === "string" && row.rowKey.includes(":contact:");
}

function isPhoneNumberIssue(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("111")) {
    return true;
  }

  return !/^\d{3}-\d{3}-\d{4}$/.test(trimmed);
}

function isContactEmailMissing(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function findDuplicateCompanyAccountGroups(groups: AccountGroup[]): Map<string, string> {
  const groupsByNameAndAddress = new Map<string, string[]>();

  groups.forEach((group) => {
    const canonicalName = normalizeCompanyNameForDuplicate(group.representativeRow.companyName);
    if (isShortTextMissing(canonicalName, 2)) {
      return;
    }
    const canonicalAddress = normalizeAddressForDuplicate(group.representativeRow);
    const duplicateKey = `${canonicalName}|${canonicalAddress || "(no-address)"}`;

    const existing = groupsByNameAndAddress.get(duplicateKey);
    if (existing) {
      existing.push(group.accountKey);
      return;
    }

    groupsByNameAndAddress.set(duplicateKey, [group.accountKey]);
  });

  const duplicateAccountGroupKeys = new Map<string, string>();
  groupsByNameAndAddress.forEach((accountKeys, duplicateKey) => {
    if (accountKeys.length < 2) {
      return;
    }

    accountKeys.forEach((accountKey) => {
      duplicateAccountGroupKeys.set(accountKey, duplicateKey || accountKey);
    });
  });

  return duplicateAccountGroupKeys;
}

function findDuplicateContactNamesByAccount(groups: AccountGroup[]): Map<string, Set<string>> {
  const duplicateNamesByAccount = new Map<string, Set<string>>();

  groups.forEach((group) => {
    const contactNameCounts = new Map<string, number>();

    group.rows.forEach((row) => {
      const canonicalName = normalizeContactNameForDuplicate(row.primaryContactName);
      if (isShortTextMissing(canonicalName, 2)) {
        return;
      }

      contactNameCounts.set(canonicalName, (contactNameCounts.get(canonicalName) ?? 0) + 1);
    });

    const duplicateNames = new Set<string>();
    contactNameCounts.forEach((count, canonicalName) => {
      if (count >= 2) {
        duplicateNames.add(canonicalName);
      }
    });

    if (duplicateNames.size > 0) {
      duplicateNamesByAccount.set(group.accountKey, duplicateNames);
    }
  });

  return duplicateNamesByAccount;
}

export function isShortTextMissing(
  value: string | null | undefined,
  minLength = 2,
): boolean {
  if (!value) {
    return true;
  }
  return value.trim().length <= minLength;
}

export function isAttributeMissing(value: string | null | undefined): boolean {
  if (!value) {
    return true;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed === "-") {
    return true;
  }

  return normalizeComparable(trimmed) === "unassigned";
}

export function groupRowsByAccount(rows: BusinessAccountRow[]): AccountGroup[] {
  const grouped = new Map<string, BusinessAccountRow[]>();

  rows.forEach((row, index) => {
    const key = toAccountKey(row, index);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
      return;
    }
    grouped.set(key, [row]);
  });

  const result: AccountGroup[] = [];
  grouped.forEach((accountRows, accountKey) => {
    const representativeRow = accountRows[0];
    result.push({
      accountKey,
      rows: accountRows,
      representativeRow,
    });
  });

  return result;
}

function buildRowIssueIdentity(
  accountKey: string,
  row: BusinessAccountRow,
  rowIndex: number,
): string {
  const rowKey = row.rowKey?.trim();
  if (rowKey) {
    return rowKey;
  }

  if (typeof row.contactId === "number" && Number.isFinite(row.contactId)) {
    return `${accountKey}:contact:${row.contactId}`;
  }

  return `${accountKey}:row:${rowIndex}`;
}

function createEmptyIssueSets(): MetricIssueSets {
  return {
    missingCompany: { account: [], row: [] },
    missingContact: { account: [], row: [] },
    invalidPhone: { account: [], row: [] },
    missingContactEmail: { account: [], row: [] },
    missingSalesRep: { account: [], row: [] },
    missingCategory: { account: [], row: [] },
    missingRegion: { account: [], row: [] },
    missingSubCategory: { account: [], row: [] },
    missingIndustry: { account: [], row: [] },
    duplicateBusinessAccount: { account: [], row: [] },
    duplicateContact: { account: [], row: [] },
  };
}

export function buildDataQualitySnapshot(
  rows: BusinessAccountRow[],
  computedAtIso = new Date().toISOString(),
): DataQualitySnapshot {
  const filteredRows = filterSuppressedBusinessAccountRows(rows);
  const groups = groupRowsByAccount(filteredRows);
  const totals = {
    accounts: groups.length,
    rows: filteredRows.length,
  };

  const duplicateCompanyAccountGroups = findDuplicateCompanyAccountGroups(groups);
  const duplicateContactNamesByAccount = findDuplicateContactNamesByAccount(groups);

  const issues = createEmptyIssueSets();
  const missingAccountSets: Record<DataQualityMetricKey, Set<string>> = {
    missingCompany: new Set<string>(),
    missingContact: new Set<string>(),
    invalidPhone: new Set<string>(),
    missingContactEmail: new Set<string>(),
    missingSalesRep: new Set<string>(),
    missingCategory: new Set<string>(),
    missingRegion: new Set<string>(),
    missingSubCategory: new Set<string>(),
    missingIndustry: new Set<string>(),
    duplicateBusinessAccount: new Set<string>(),
    duplicateContact: new Set<string>(),
  };
  const accountsWithAnyIssues = new Set<string>();
  const rowsWithAnyIssues = new Set<string>();

  groups.forEach((group) => {
    const accountIssueRow = buildIssueRow(
      group.accountKey,
      group.representativeRow,
      group.rows,
    );

    const missingCompanyAccount = isCompanyAssignmentMissing(group.representativeRow);
    const missingContactAccount =
      group.rows.length === 0 ||
      !group.rows.some((row) => isAssociatedContactRow(row));
    const invalidPhoneRows = group.rows.filter(
      (row) =>
        isAssociatedContactRow(row) &&
        isPhoneNumberIssue(row.primaryContactRawPhone ?? row.primaryContactPhone),
    );
    const invalidPhoneAccount = invalidPhoneRows.length > 0;
    const missingContactEmailRows = group.rows.filter(
      (row) => isAssociatedContactRow(row) && isContactEmailMissing(row.primaryContactEmail),
    );
    const missingContactEmailAccount = missingContactEmailRows.length > 0;
    const missingSalesRepAccount = isSalesRepMissing(group.representativeRow);
    const missingCategoryAccount = isAttributeMissing(group.representativeRow.category);
    const missingRegionAccount = isAttributeMissing(group.representativeRow.companyRegion);
    const missingSubCategoryAccount = isAttributeMissing(group.representativeRow.subCategory);
    const missingIndustryAccount = isAttributeMissing(group.representativeRow.industryType);
    const duplicateBusinessAccount = duplicateCompanyAccountGroups.has(group.accountKey);
    const duplicateCompanyGroupKey =
      duplicateCompanyAccountGroups.get(group.accountKey) ?? group.accountKey;
    const duplicateContactNames = duplicateContactNamesByAccount.get(group.accountKey);
    const duplicateContactAccount = Boolean(duplicateContactNames && duplicateContactNames.size > 0);
    const accountHasAnyIssue =
      missingCompanyAccount ||
      missingContactAccount ||
      invalidPhoneAccount ||
      missingContactEmailAccount ||
      missingSalesRepAccount ||
      missingCategoryAccount ||
      missingRegionAccount ||
      missingSubCategoryAccount ||
      missingIndustryAccount ||
      duplicateBusinessAccount ||
      duplicateContactAccount;
    if (accountHasAnyIssue) {
      accountsWithAnyIssues.add(group.accountKey);
    }

    if (missingCompanyAccount) {
      missingAccountSets.missingCompany.add(group.accountKey);
      issues.missingCompany.account.push(accountIssueRow);
    }
    if (missingContactAccount) {
      missingAccountSets.missingContact.add(group.accountKey);
      issues.missingContact.account.push(accountIssueRow);
    }
    if (invalidPhoneAccount) {
      missingAccountSets.invalidPhone.add(group.accountKey);
      issues.invalidPhone.account.push(
        buildIssueRow(group.accountKey, invalidPhoneRows[0], group.rows),
      );
    }
    if (missingContactEmailAccount) {
      missingAccountSets.missingContactEmail.add(group.accountKey);
      issues.missingContactEmail.account.push(
        buildIssueRow(group.accountKey, missingContactEmailRows[0], group.rows),
      );
    }
    if (missingSalesRepAccount) {
      missingAccountSets.missingSalesRep.add(group.accountKey);
      issues.missingSalesRep.account.push(accountIssueRow);
    }
    if (missingCategoryAccount) {
      missingAccountSets.missingCategory.add(group.accountKey);
      issues.missingCategory.account.push(accountIssueRow);
    }
    if (missingRegionAccount) {
      missingAccountSets.missingRegion.add(group.accountKey);
      issues.missingRegion.account.push(accountIssueRow);
    }
    if (missingSubCategoryAccount) {
      missingAccountSets.missingSubCategory.add(group.accountKey);
      issues.missingSubCategory.account.push(accountIssueRow);
    }
    if (missingIndustryAccount) {
      missingAccountSets.missingIndustry.add(group.accountKey);
      issues.missingIndustry.account.push(accountIssueRow);
    }
    if (duplicateBusinessAccount) {
      missingAccountSets.duplicateBusinessAccount.add(group.accountKey);
      issues.duplicateBusinessAccount.account.push(
        buildIssueRow(
          group.accountKey,
          group.representativeRow,
          group.rows,
          duplicateCompanyGroupKey,
        ),
      );
      // Count duplicate business accounts once per account even on row basis.
      // This avoids inflating duplicate-account issues by contact count.
      issues.duplicateBusinessAccount.row.push(
        buildIssueRow(
          group.accountKey,
          group.representativeRow,
          group.rows,
          duplicateCompanyGroupKey,
        ),
      );
    }
    if (duplicateContactAccount) {
      missingAccountSets.duplicateContact.add(group.accountKey);
      issues.duplicateContact.account.push(
        buildIssueRow(
          group.accountKey,
          group.representativeRow,
          group.rows,
          `${group.accountKey}|duplicate-contact`,
        ),
      );
    }

    group.rows.forEach((row, rowIndex) => {
      const rowIssueIdentity = buildRowIssueIdentity(group.accountKey, row, rowIndex);
      const rowIssue = buildIssueRow(group.accountKey, row, group.rows);
      const contactDuplicateKey = normalizeContactNameForDuplicate(row.primaryContactName);
      let rowHasIssue = false;

      if (isCompanyAssignmentMissing(row)) {
        issues.missingCompany.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (missingContactAccount && rowIndex === 0) {
        issues.missingContact.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (
        isAssociatedContactRow(row) &&
        isPhoneNumberIssue(row.primaryContactRawPhone ?? row.primaryContactPhone)
      ) {
        issues.invalidPhone.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (isAssociatedContactRow(row) && isContactEmailMissing(row.primaryContactEmail)) {
        issues.missingContactEmail.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (isSalesRepMissing(row)) {
        issues.missingSalesRep.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (isAttributeMissing(row.category)) {
        issues.missingCategory.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (isAttributeMissing(row.companyRegion)) {
        issues.missingRegion.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (isAttributeMissing(row.subCategory)) {
        issues.missingSubCategory.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (isAttributeMissing(row.industryType)) {
        issues.missingIndustry.row.push(rowIssue);
        rowHasIssue = true;
      }
      if (duplicateBusinessAccount) {
        rowHasIssue = true;
      }
      if (
        duplicateContactNames &&
        !isShortTextMissing(contactDuplicateKey, 2) &&
        duplicateContactNames.has(contactDuplicateKey)
      ) {
        issues.duplicateContact.row.push(
          buildIssueRow(
            group.accountKey,
            row,
            group.rows,
            `${group.accountKey}|${contactDuplicateKey}`,
          ),
        );
        rowHasIssue = true;
      }

      if (rowHasIssue) {
        rowsWithAnyIssues.add(rowIssueIdentity);
      }
    });
  });

  for (const key of DATA_QUALITY_METRIC_KEYS) {
    issues[key].account = sortIssueRows(issues[key].account);
    issues[key].row = sortIssueRows(issues[key].row);
  }

  const metrics: DataQualityMetric[] = DATA_QUALITY_METRIC_KEYS.map((key) => {
    const missingAccounts = missingAccountSets[key].size;
    const missingRows = issues[key].row.length;
    const completeAccounts = Math.max(0, totals.accounts - missingAccounts);
    const completeRows = Math.max(0, totals.rows - missingRows);

    return {
      key,
      label: METRIC_LABELS[key],
      missingAccounts,
      missingRows,
      completeAccounts,
      completeRows,
      accountMissingPct: toPct(missingAccounts, totals.accounts),
      rowMissingPct: toPct(missingRows, totals.rows),
    };
  });

  const accountCompletenessValues = metrics.map((metric) =>
    totals.accounts > 0 ? (metric.completeAccounts / totals.accounts) * 100 : 0,
  );
  const overallScorePct = accountCompletenessValues.length
    ? Math.round(
        (accountCompletenessValues.reduce((sum, value) => sum + value, 0) /
          accountCompletenessValues.length) *
          10,
      ) / 10
    : 0;

  return {
    computedAtIso,
    totals,
    issueTotals: {
      accountsWithIssues: accountsWithAnyIssues.size,
      rowsWithIssues: rowsWithAnyIssues.size,
      accountIssuePct: toPct(accountsWithAnyIssues.size, totals.accounts),
      rowIssuePct: toPct(rowsWithAnyIssues.size, totals.rows),
    },
    overallScorePct,
    metrics,
    issues,
  };
}

export function toDataQualitySummaryResponse(
  snapshot: DataQualitySnapshot,
): DataQualitySummaryResponse {
  return {
    source: "live",
    computedAtIso: snapshot.computedAtIso,
    totals: snapshot.totals,
    issueTotals: snapshot.issueTotals,
    overallScorePct: snapshot.overallScorePct,
    metrics: snapshot.metrics,
  };
}

export function paginateDataQualityIssues(
  snapshot: DataQualitySnapshot,
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  page: number,
  pageSize: number,
  salesRep?: string,
  includeRow?: (row: DataQualityIssueRow) => boolean,
): DataQualityIssuesResponse {
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.max(1, Math.trunc(pageSize));
  const sourceRows = (basis === "account" ? snapshot.issues[metric].account : snapshot.issues[metric].row).filter(
    (row) => matchesSalesRepFilter(row, salesRep) && (includeRow ? includeRow(row) : true),
  );
  const total = sourceRows.length;
  const start = (safePage - 1) * safePageSize;
  const items = sourceRows.slice(start, start + safePageSize).map((row) => ({
    ...row,
    issueKey: buildDataQualityIssueKey(metric, basis, row),
  }));

  return {
    metric,
    basis,
    salesRep: salesRep ?? null,
    total,
    page: safePage,
    pageSize: safePageSize,
    items,
    computedAtIso: snapshot.computedAtIso,
  };
}
