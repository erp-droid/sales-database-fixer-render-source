import { promises as fs } from "node:fs";
import path from "node:path";

import {
  type DataQualityContributorRow,
  type DataQualityContributorsResponse,
  DATA_QUALITY_METRIC_KEYS,
  type DataQualityBasis,
  type DataQualityExpandedSummaryResponse,
  type DataQualityIssueRow,
  type DataQualityKpiSummary,
  type DataQualityLeaderboardResponse,
  type DataQualityLeaderboardRow,
  type DataQualityMetricKey,
  type DataQualityMetricScoreRow,
  type DataQualityStatus,
  type DataQualitySummaryResponse,
  type DataQualityThroughputResponse,
  type DataQualityTrendPoint,
  type DataQualityTrendsResponse,
} from "@/types/data-quality";
import {
  buildDataQualityIssueKey,
  type DataQualitySnapshot,
  toDataQualitySummaryResponse,
} from "@/lib/data-quality";
import { getEnv } from "@/lib/env";

type IssueHistoryEntry = {
  issueKey: string;
  metric: DataQualityMetricKey;
  basis: DataQualityBasis;
  status: DataQualityStatus;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
  reviewedAt: string | null;
  salesRepName: string | null;
  accountKey: string;
  rowKey: string | null;
};

type IssueFixEvent = {
  issueKey: string;
  metric: DataQualityMetricKey;
  basis: DataQualityBasis;
  fixedAt: string;
  userId: string;
  userName: string;
};

type DailyRollup = {
  day: string;
  updatedAt: string;
  openByBasis: Record<DataQualityBasis, number>;
  openIssueCountByBasis: Record<DataQualityBasis, number>;
  reviewedByBasis: Record<DataQualityBasis, number>;
  totalCheckedByBasis: Record<DataQualityBasis, number>;
  openByMetricBasis: Record<DataQualityBasis, Record<DataQualityMetricKey, number>>;
};

type DataQualityHistoryStore = {
  version: 2;
  issues: Record<string, IssueHistoryEntry>;
  fixEvents: IssueFixEvent[];
  daily: Record<string, DailyRollup>;
  lastSnapshotAt: string | null;
};

export type DataQualityFixActor = {
  userId: string;
  userName: string;
};

const TIMEZONE = "America/Toronto";
const BASIS_VALUES: DataQualityBasis[] = ["account", "row"];

let queue: Promise<unknown> = Promise.resolve();

function createEmptyStore(): DataQualityHistoryStore {
  return {
    version: 2,
    issues: {},
    fixEvents: [],
    daily: {},
    lastSnapshotAt: null,
  };
}

function resolveHistoryFilePath(): string {
  const { DATA_QUALITY_HISTORY_PATH } = getEnv();
  if (path.isAbsolute(DATA_QUALITY_HISTORY_PATH)) {
    return DATA_QUALITY_HISTORY_PATH;
  }

  return path.join(process.cwd(), DATA_QUALITY_HISTORY_PATH);
}

async function loadStore(): Promise<DataQualityHistoryStore> {
  try {
    const raw = await fs.readFile(resolveHistoryFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DataQualityHistoryStore>;
    if (!parsed || typeof parsed !== "object") {
      return createEmptyStore();
    }

    return {
      version: 2,
      issues:
        parsed.issues && typeof parsed.issues === "object"
          ? (parsed.issues as Record<string, IssueHistoryEntry>)
          : {},
      fixEvents: Array.isArray(parsed.fixEvents)
        ? parsed.fixEvents.filter((event): event is IssueFixEvent => {
            if (!event || typeof event !== "object") {
              return false;
            }

            const record = event as Record<string, unknown>;
            return (
              typeof record.issueKey === "string" &&
              typeof record.metric === "string" &&
              typeof record.basis === "string" &&
              typeof record.fixedAt === "string" &&
              typeof record.userId === "string" &&
              typeof record.userName === "string"
            );
          })
        : [],
      daily:
        parsed.daily && typeof parsed.daily === "object"
          ? (parsed.daily as Record<string, DailyRollup>)
          : {},
      lastSnapshotAt:
        typeof parsed.lastSnapshotAt === "string" ? parsed.lastSnapshotAt : null,
    };
  } catch {
    return createEmptyStore();
  }
}

async function saveStore(store: DataQualityHistoryStore): Promise<void> {
  const historyFilePath = resolveHistoryFilePath();
  await fs.mkdir(path.dirname(historyFilePath), { recursive: true });
  await fs.writeFile(historyFilePath, JSON.stringify(store, null, 2), "utf8");
}

function withStore<T>(
  updater: (store: DataQualityHistoryStore) => Promise<T> | T,
): Promise<T> {
  const next = queue.then(async () => {
    const store = await loadStore();
    const result = await updater(store);
    await saveStore(store);
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

function normalizeComparable(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase();
}

function dateKey(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function monthKey(day: string): string {
  return day.slice(0, 7);
}

function metricLabel(metricKey: DataQualityMetricKey): string {
  return (
    {
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
    }[metricKey] ?? metricKey
  );
}

function buildRecordIdentity(
  basis: DataQualityBasis,
  issue: DataQualityIssueRow,
): string {
  if (basis === "account") {
    return (
      issue.accountRecordId?.trim() ||
      issue.accountKey.trim() ||
      issue.businessAccountId.trim() ||
      normalizeComparable(issue.companyName)
    );
  }

  return (
    issue.rowKey?.trim() ||
    (issue.contactId !== null ? `${issue.accountKey}:contact:${issue.contactId}` : "") ||
    `${issue.accountKey}:${normalizeComparable(issue.contactName)}`
  );
}

function countResolvedInWindow(
  entries: IssueHistoryEntry[],
  nowDay: string,
  earliestDay: string,
): number {
  return entries.filter((entry) => {
    if (entry.status !== "resolved" || !entry.resolvedAt) {
      return false;
    }
    const resolvedDay = dateKey(entry.resolvedAt);
    if (resolvedDay < earliestDay || resolvedDay > nowDay) {
      return false;
    }

    return dateKey(entry.firstSeen) < earliestDay;
  }).length;
}

function countCreatedInWindow(
  entries: IssueHistoryEntry[],
  nowDay: string,
  earliestDay: string,
): number {
  return entries.filter((entry) => {
    const createdDay = dateKey(entry.firstSeen);
    return createdDay >= earliestDay && createdDay <= nowDay;
  }).length;
}

function getLastNDays(day: string, count: number): string[] {
  const base = new Date(`${day}T12:00:00.000Z`);
  const result: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const copy = new Date(base);
    copy.setUTCDate(copy.getUTCDate() - offset);
    result.push(dateKey(copy.toISOString()));
  }
  return result;
}

function computeKpis(
  snapshot: DataQualitySnapshot,
  store: DataQualityHistoryStore,
  basis: DataQualityBasis,
): {
  kpis: DataQualityKpiSummary;
  openMetricCounts: Record<DataQualityMetricKey, number>;
} {
  const openMetricCounts = DATA_QUALITY_METRIC_KEYS.reduce(
    (accumulator, metric) => {
      accumulator[metric] = 0;
      return accumulator;
    },
    {} as Record<DataQualityMetricKey, number>,
  );

  const recordStates = new Map<string, { hasOpen: boolean; hasReviewed: boolean }>();

  DATA_QUALITY_METRIC_KEYS.forEach((metric) => {
    snapshot.issues[metric][basis].forEach((issue) => {
      const issueKey = buildDataQualityIssueKey(metric, basis, issue);
      const entry = store.issues[issueKey];
      const status = entry?.status ?? "open";

      if (status === "reviewed") {
        return;
      }

      openMetricCounts[metric] += 1;
      const recordId = buildRecordIdentity(basis, issue);
      const current = recordStates.get(recordId) ?? { hasOpen: false, hasReviewed: false };
      current.hasOpen = true;
      recordStates.set(recordId, current);
    });
  });

  DATA_QUALITY_METRIC_KEYS.forEach((metric) => {
    snapshot.issues[metric][basis].forEach((issue) => {
      const issueKey = buildDataQualityIssueKey(metric, basis, issue);
      const entry = store.issues[issueKey];
      if (entry?.status !== "reviewed") {
        return;
      }

      const recordId = buildRecordIdentity(basis, issue);
      const current = recordStates.get(recordId) ?? { hasOpen: false, hasReviewed: false };
      if (!current.hasOpen) {
        current.hasReviewed = true;
      }
      recordStates.set(recordId, current);
    });
  });

  const openIssues = [...recordStates.values()].filter((state) => state.hasOpen).length;
  const reviewedExceptions = [...recordStates.values()].filter(
    (state) => !state.hasOpen && state.hasReviewed,
  ).length;
  const totalChecked = basis === "row" ? snapshot.totals.rows : snapshot.totals.accounts;
  const cleanRecords = Math.max(0, totalChecked - openIssues - reviewedExceptions);
  const percentComplete = totalChecked > 0 ? (cleanRecords / totalChecked) * 100 : 0;

  return {
    kpis: {
      timezone: TIMEZONE,
      basis,
      openIssues: Object.values(openMetricCounts).reduce((sum, count) => sum + count, 0),
      affectedRecords: openIssues,
      reviewedExceptions,
      cleanRecords,
      totalChecked,
      percentComplete: Math.round(percentComplete * 10) / 10,
    },
    openMetricCounts,
  };
}

function computeScoreboard(
  basis: DataQualityBasis,
  totalChecked: number,
  openMetricCounts: Record<DataQualityMetricKey, number>,
  store: DataQualityHistoryStore,
  nowIso: string,
): DataQualityMetricScoreRow[] {
  const nowDay = dateKey(nowIso);
  const weekDays = getLastNDays(nowDay, 7);
  const weekStart = weekDays[0];
  const currentMonthKey = monthKey(nowDay);
  const monthStart = `${currentMonthKey}-01`;
  const sevenDaysAgo = getLastNDays(nowDay, 8)[0];

  return DATA_QUALITY_METRIC_KEYS.map((metric) => {
    const entries = Object.values(store.issues).filter(
      (entry) => entry.metric === metric && entry.basis === basis,
    );
    const reviewedCurrent = entries.filter((entry) => entry.status === "reviewed").length;
    const open = openMetricCounts[metric];
    const percentComplete =
      totalChecked > 0 ? ((totalChecked - open) / totalChecked) * 100 : 0;
    const fixedToday = countResolvedInWindow(entries, nowDay, nowDay);
    const fixedWeek = countResolvedInWindow(entries, nowDay, weekStart);
    const fixedMonth = countResolvedInWindow(entries, nowDay, monthStart);

    const daySnapshotNow = store.daily[nowDay];
    const daySnapshotBefore = store.daily[sevenDaysAgo];
    const openNow = daySnapshotNow?.openByMetricBasis[basis]?.[metric] ?? open;
    const openBefore = daySnapshotBefore?.openByMetricBasis[basis]?.[metric] ?? openNow;

    return {
      key: metric,
      label: metricLabel(metric),
      open,
      reviewed: reviewedCurrent,
      totalChecked,
      percentComplete: Math.round(percentComplete * 10) / 10,
      fixedToday,
      fixedWeek,
      fixedMonth,
      delta7d: openNow - openBefore,
    };
  });
}

function computeTrends(
  basis: DataQualityBasis,
  store: DataQualityHistoryStore,
  nowIso: string,
): DataQualityTrendsResponse {
  const nowDay = dateKey(nowIso);
  const days = getLastNDays(nowDay, 30);
  const points: DataQualityTrendPoint[] = days.map((day) => {
    const daily = store.daily[day];
    const openIssues = daily?.openIssueCountByBasis[basis] ?? 0;
    const created = Object.values(store.issues).filter(
      (entry) => entry.basis === basis && dateKey(entry.firstSeen) === day,
    ).length;
    const fixed = Object.values(store.issues).filter(
      (entry) =>
        entry.basis === basis &&
        entry.status === "resolved" &&
        entry.resolvedAt !== null &&
        dateKey(entry.resolvedAt) === day &&
        dateKey(entry.firstSeen) < day,
    ).length;

    return {
      day,
      openIssues,
      created,
      fixed,
    };
  });

  const last14 = points.slice(-14);
  const avgNetFixPerDay14d =
    last14.length > 0
      ? Math.round(
          (last14.reduce((sum, point) => sum + (point.fixed - point.created), 0) /
            last14.length) *
            10,
        ) / 10
      : 0;
  const remainingOpenIssues = points[points.length - 1]?.openIssues ?? 0;
  const etaDaysToZero =
    avgNetFixPerDay14d > 0
      ? Math.max(0, Math.ceil(remainingOpenIssues / avgNetFixPerDay14d))
      : null;

  return {
    timezone: TIMEZONE,
    basis,
    points,
    burndown: {
      remainingOpenIssues,
      avgNetFixPerDay14d,
      etaDaysToZero,
    },
  };
}

function computeContributors(
  basis: DataQualityBasis,
  store: DataQualityHistoryStore,
  nowIso: string,
): DataQualityContributorsResponse {
  const nowDay = dateKey(nowIso);
  const weekDays = getLastNDays(nowDay, 7);
  const weekStart = weekDays[0];
  const currentMonthKey = monthKey(nowDay);

  const rowsByUser = new Map<string, DataQualityContributorRow>();
  const relevantEvents = store.fixEvents.filter((event) => event.basis === basis);

  relevantEvents.forEach((event) => {
    const resolvedDay = dateKey(event.fixedAt);
    const key = `${event.userId.trim().toLowerCase()}|${event.userName.trim().toLowerCase()}`;
    const current = rowsByUser.get(key) ?? {
      userId: event.userId,
      userName: event.userName,
      fixedTotal: 0,
      fixedToday: 0,
      fixedWeek: 0,
      fixedMonth: 0,
      rank: 0,
    };

    current.fixedTotal += 1;
    if (resolvedDay === nowDay) {
      current.fixedToday += 1;
    }
    if (resolvedDay >= weekStart && resolvedDay <= nowDay) {
      current.fixedWeek += 1;
    }
    if (monthKey(resolvedDay) === currentMonthKey) {
      current.fixedMonth += 1;
    }

    rowsByUser.set(key, current);
  });

  const items = [...rowsByUser.values()].sort((left, right) => {
    if (left.fixedTotal !== right.fixedTotal) {
      return right.fixedTotal - left.fixedTotal;
    }
    if (left.fixedMonth !== right.fixedMonth) {
      return right.fixedMonth - left.fixedMonth;
    }
    if (left.fixedWeek !== right.fixedWeek) {
      return right.fixedWeek - left.fixedWeek;
    }
    return left.userName.localeCompare(right.userName, undefined, {
      sensitivity: "base",
    });
  });

  items.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    timezone: TIMEZONE,
    basis,
    items,
  };
}

function computeThroughput(
  basis: DataQualityBasis,
  store: DataQualityHistoryStore,
  nowIso: string,
): DataQualityThroughputResponse {
  const nowDay = dateKey(nowIso);
  const weekDays = getLastNDays(nowDay, 7);
  const weekStart = weekDays[0];
  const currentMonthKey = monthKey(nowDay);
  const monthStart = `${currentMonthKey}-01`;
  const entries = Object.values(store.issues).filter((entry) => entry.basis === basis);

  const todayFixed = countResolvedInWindow(entries, nowDay, nowDay);
  const todayCreated = countCreatedInWindow(entries, nowDay, nowDay);
  const weekFixed = countResolvedInWindow(entries, nowDay, weekStart);
  const weekCreated = countCreatedInWindow(entries, nowDay, weekStart);
  const monthFixed = countResolvedInWindow(entries, nowDay, monthStart);
  const monthCreated = countCreatedInWindow(entries, nowDay, monthStart);

  return {
    timezone: TIMEZONE,
    basis,
    today: {
      fixed: todayFixed,
      created: todayCreated,
      netChange: todayFixed - todayCreated,
    },
    week: {
      fixed: weekFixed,
      created: weekCreated,
      netChange: weekFixed - weekCreated,
    },
    month: {
      fixed: monthFixed,
      created: monthCreated,
      netChange: monthFixed - monthCreated,
    },
  };
}

function computeLeaderboard(
  snapshot: DataQualitySnapshot,
  basis: DataQualityBasis,
  store: DataQualityHistoryStore,
  nowIso: string,
): DataQualityLeaderboardResponse {
  const nowDay = dateKey(nowIso);
  const weekDays = getLastNDays(nowDay, 7);
  const weekStart = weekDays[0];
  const currentMonthKey = monthKey(nowDay);
  const monthStart = `${currentMonthKey}-01`;

  const openByRep = new Map<string, Set<string>>();
  DATA_QUALITY_METRIC_KEYS.forEach((metric) => {
    snapshot.issues[metric][basis].forEach((issue) => {
      const issueKey = buildDataQualityIssueKey(metric, basis, issue);
      const entry = store.issues[issueKey];
      if (entry?.status === "reviewed") {
        return;
      }

      const repName = (issue.salesRepName?.trim() || "Unassigned").trim();
      const recordId = buildRecordIdentity(basis, issue);
      const existing = openByRep.get(repName) ?? new Set<string>();
      existing.add(recordId);
      openByRep.set(repName, existing);
    });
  });

  const fixedEntries = Object.values(store.issues).filter((entry) => entry.basis === basis);
  const fixedTodayByRep = new Map<string, number>();
  const fixedWeekByRep = new Map<string, number>();
  const fixedMonthByRep = new Map<string, number>();

  fixedEntries.forEach((entry) => {
    if (entry.status !== "resolved" || !entry.resolvedAt) {
      return;
    }

    const repName = (entry.salesRepName?.trim() || "Unassigned").trim();
    const resolvedDay = dateKey(entry.resolvedAt);
    if (resolvedDay === nowDay && dateKey(entry.firstSeen) < nowDay) {
      fixedTodayByRep.set(repName, (fixedTodayByRep.get(repName) ?? 0) + 1);
    }
    if (resolvedDay >= weekStart && resolvedDay <= nowDay && dateKey(entry.firstSeen) < weekStart) {
      fixedWeekByRep.set(repName, (fixedWeekByRep.get(repName) ?? 0) + 1);
    }
    if (
      monthKey(resolvedDay) === currentMonthKey &&
      dateKey(entry.firstSeen) < monthStart
    ) {
      fixedMonthByRep.set(repName, (fixedMonthByRep.get(repName) ?? 0) + 1);
    }
  });

  const repNames = new Set<string>([
    ...openByRep.keys(),
    ...fixedTodayByRep.keys(),
    ...fixedWeekByRep.keys(),
    ...fixedMonthByRep.keys(),
  ]);

  const rows: DataQualityLeaderboardRow[] = [...repNames].map((salesRepName) => {
    const assignedOpenIssues = openByRep.get(salesRepName)?.size ?? 0;
    const fixedToday = fixedTodayByRep.get(salesRepName) ?? 0;
    const fixedWeek = fixedWeekByRep.get(salesRepName) ?? 0;
    const fixedMonth = fixedMonthByRep.get(salesRepName) ?? 0;
    const denominator = assignedOpenIssues + fixedMonth;
    const closureRatePct =
      denominator > 0 ? Math.round((fixedMonth / denominator) * 1000) / 10 : 0;

    return {
      salesRepName,
      assignedOpenIssues,
      fixedToday,
      fixedWeek,
      fixedMonth,
      closureRatePct,
      rank: 0,
    };
  });

  rows.sort((left, right) => {
    if (left.closureRatePct !== right.closureRatePct) {
      return right.closureRatePct - left.closureRatePct;
    }
    if (left.fixedWeek !== right.fixedWeek) {
      return right.fixedWeek - left.fixedWeek;
    }
    if (left.assignedOpenIssues !== right.assignedOpenIssues) {
      return left.assignedOpenIssues - right.assignedOpenIssues;
    }
    return left.salesRepName.localeCompare(right.salesRepName, undefined, {
      sensitivity: "base",
    });
  });

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    timezone: TIMEZONE,
    basis,
    items: rows,
  };
}

export async function syncDataQualityHistory(
  snapshot: DataQualitySnapshot,
  atIso = new Date().toISOString(),
): Promise<void> {
  await withStore(async (store) => {
    const nowKey = dateKey(atIso);
    const currentByKey = new Map<
      string,
      {
        metric: DataQualityMetricKey;
        basis: DataQualityBasis;
        issue: DataQualityIssueRow;
      }
    >();
    const currentKeySet = new Set<string>();

    for (const metric of DATA_QUALITY_METRIC_KEYS) {
      for (const basis of BASIS_VALUES) {
        snapshot.issues[metric][basis].forEach((issue) => {
          const issueKey = buildDataQualityIssueKey(metric, basis, issue);
          currentKeySet.add(issueKey);
          currentByKey.set(issueKey, { metric, basis, issue });

          const existing = store.issues[issueKey];
          if (!existing) {
            store.issues[issueKey] = {
              issueKey,
              metric,
              basis,
              status: "open",
              firstSeen: atIso,
              lastSeen: atIso,
              resolvedAt: null,
              reviewedAt: null,
              salesRepName: issue.salesRepName ?? null,
              accountKey: issue.accountKey,
              rowKey: issue.rowKey ?? null,
            };
            return;
          }

          existing.lastSeen = atIso;
          existing.metric = metric;
          existing.basis = basis;
          existing.salesRepName = issue.salesRepName ?? existing.salesRepName;
          existing.accountKey = issue.accountKey;
          existing.rowKey = issue.rowKey ?? existing.rowKey;

          if (existing.status === "resolved") {
            existing.status = "open";
            existing.resolvedAt = null;
          }
        });
      }
    }

    Object.values(store.issues).forEach((entry) => {
      if (entry.status === "open" && !currentKeySet.has(entry.issueKey)) {
        entry.status = "resolved";
        entry.resolvedAt = atIso;
      }
    });

    const openRecordSets: Record<DataQualityBasis, Set<string>> = {
      account: new Set<string>(),
      row: new Set<string>(),
    };
    const reviewedRecordSets: Record<DataQualityBasis, Set<string>> = {
      account: new Set<string>(),
      row: new Set<string>(),
    };
    const openByMetricBasis: Record<DataQualityBasis, Record<DataQualityMetricKey, number>> = {
      account: DATA_QUALITY_METRIC_KEYS.reduce(
        (accumulator, metric) => ({ ...accumulator, [metric]: 0 }),
        {} as Record<DataQualityMetricKey, number>,
      ),
      row: DATA_QUALITY_METRIC_KEYS.reduce(
        (accumulator, metric) => ({ ...accumulator, [metric]: 0 }),
        {} as Record<DataQualityMetricKey, number>,
      ),
    };

    currentByKey.forEach(({ metric, basis, issue }, issueKey) => {
      const entry = store.issues[issueKey];
      const recordId = buildRecordIdentity(basis, issue);
      if (entry?.status === "reviewed") {
        reviewedRecordSets[basis].add(recordId);
        return;
      }

      openRecordSets[basis].add(recordId);
      openByMetricBasis[basis][metric] += 1;
    });

    store.daily[nowKey] = {
      day: nowKey,
      updatedAt: atIso,
      openByBasis: {
        account: openRecordSets.account.size,
        row: openRecordSets.row.size,
      },
      openIssueCountByBasis: {
        account: Object.values(openByMetricBasis.account).reduce((sum, count) => sum + count, 0),
        row: Object.values(openByMetricBasis.row).reduce((sum, count) => sum + count, 0),
      },
      reviewedByBasis: {
        account: reviewedRecordSets.account.size,
        row: reviewedRecordSets.row.size,
      },
      totalCheckedByBasis: {
        account: snapshot.totals.accounts,
        row: snapshot.totals.rows,
      },
      openByMetricBasis,
    };
    store.lastSnapshotAt = atIso;
  });
}

export async function markIssuesReviewed(
  issueKeys: string[],
  action: "review" | "unreview",
  atIso = new Date().toISOString(),
): Promise<void> {
  await withStore(async (store) => {
    issueKeys.forEach((issueKey) => {
      const trimmed = issueKey.trim();
      if (!trimmed) {
        return;
      }

      const entry = store.issues[trimmed];
      if (!entry) {
        return;
      }

      if (action === "review") {
        entry.status = "reviewed";
        entry.reviewedAt = atIso;
      } else {
        entry.status = "open";
        entry.reviewedAt = null;
      }
      entry.lastSeen = atIso;
    });
  });
}

function parseIssueKeyParts(issueKey: string): {
  metric: DataQualityMetricKey | null;
  basis: DataQualityBasis | null;
} {
  const [metric, basis] = issueKey.split("|", 3);
  const parsedMetric = DATA_QUALITY_METRIC_KEYS.includes(metric as DataQualityMetricKey)
    ? (metric as DataQualityMetricKey)
    : null;
  const parsedBasis = BASIS_VALUES.includes(basis as DataQualityBasis)
    ? (basis as DataQualityBasis)
    : null;

  return {
    metric: parsedMetric,
    basis: parsedBasis,
  };
}

export async function recordFixedIssues(
  issueKeys: string[],
  actor: DataQualityFixActor,
  atIso = new Date().toISOString(),
): Promise<void> {
  await withStore(async (store) => {
    const trimmedUserId = actor.userId.trim() || "unknown";
    const trimmedUserName = actor.userName.trim() || trimmedUserId;

    issueKeys.forEach((issueKey) => {
      const trimmed = issueKey.trim();
      if (!trimmed) {
        return;
      }

      const { metric, basis } = parseIssueKeyParts(trimmed);
      if (!metric || !basis) {
        return;
      }

      const duplicateExists = store.fixEvents.some(
        (event) =>
          event.issueKey === trimmed &&
          event.userId === trimmedUserId &&
          event.fixedAt === atIso,
      );
      if (duplicateExists) {
        return;
      }

      store.fixEvents.push({
        issueKey: trimmed,
        metric,
        basis,
        fixedAt: atIso,
        userId: trimmedUserId,
        userName: trimmedUserName,
      });
    });
  });
}

export async function buildDataQualityExpandedSummary(
  snapshot: DataQualitySnapshot,
  basis: DataQualityBasis,
): Promise<DataQualityExpandedSummaryResponse> {
  const nowIso = new Date().toISOString();
  const baseSummary: DataQualitySummaryResponse = toDataQualitySummaryResponse(snapshot);

  return withStore(async (store) => {
    const { kpis, openMetricCounts } = computeKpis(snapshot, store, basis);
    const scoreboard = computeScoreboard(
      basis,
      kpis.totalChecked,
      openMetricCounts,
      store,
      nowIso,
    );
    const metrics = baseSummary.metrics.map((metric) => {
      const open = openMetricCounts[metric.key];
      if (basis === "row") {
        return {
          ...metric,
          missingRows: open,
          completeRows: Math.max(0, snapshot.totals.rows - open),
          rowMissingPct:
            snapshot.totals.rows > 0 ? Math.round((open / snapshot.totals.rows) * 1000) / 10 : 0,
        };
      }

      return {
        ...metric,
        missingAccounts: open,
        completeAccounts: Math.max(0, snapshot.totals.accounts - open),
        accountMissingPct:
          snapshot.totals.accounts > 0
            ? Math.round((open / snapshot.totals.accounts) * 1000) / 10
            : 0,
      };
    });

    return {
      ...baseSummary,
      metrics,
      kpis,
      scoreboard,
    };
  });
}

export async function buildDataQualityTrends(
  basis: DataQualityBasis,
): Promise<DataQualityTrendsResponse> {
  const nowIso = new Date().toISOString();
  return withStore((store) => computeTrends(basis, store, nowIso));
}

export async function buildDataQualityThroughput(
  basis: DataQualityBasis,
): Promise<DataQualityThroughputResponse> {
  const nowIso = new Date().toISOString();
  return withStore((store) => computeThroughput(basis, store, nowIso));
}

export async function buildDataQualityLeaderboard(
  snapshot: DataQualitySnapshot,
  basis: DataQualityBasis,
): Promise<DataQualityLeaderboardResponse> {
  const nowIso = new Date().toISOString();
  return withStore((store) => computeLeaderboard(snapshot, basis, store, nowIso));
}

export async function buildDataQualityContributors(
  basis: DataQualityBasis,
): Promise<DataQualityContributorsResponse> {
  const nowIso = new Date().toISOString();
  return withStore((store) => computeContributors(basis, store, nowIso));
}
