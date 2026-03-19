export const DATA_QUALITY_METRIC_KEYS = [
  "missingCompany",
  "missingContact",
  "invalidPhone",
  "missingContactEmail",
  "missingSalesRep",
  "missingCategory",
  "missingRegion",
  "missingSubCategory",
  "missingIndustry",
  "duplicateBusinessAccount",
  "duplicateContact",
] as const;

export type DataQualityMetricKey = (typeof DATA_QUALITY_METRIC_KEYS)[number];

export const DATA_QUALITY_BASIS_VALUES = ["account", "row"] as const;

export type DataQualityBasis = (typeof DATA_QUALITY_BASIS_VALUES)[number];

export type DataQualityMetric = {
  key: DataQualityMetricKey;
  label: string;
  missingAccounts: number;
  missingRows: number;
  completeAccounts: number;
  completeRows: number;
  accountMissingPct: number;
  rowMissingPct: number;
};

export type DataQualitySummaryResponse = {
  source: "live";
  computedAtIso: string;
  totals: { accounts: number; rows: number };
  issueTotals: {
    accountsWithIssues: number;
    rowsWithIssues: number;
    accountIssuePct: number;
    rowIssuePct: number;
  };
  overallScorePct: number;
  metrics: DataQualityMetric[];
};

export type DataQualityIssueRow = {
  issueKey?: string;
  accountKey: string;
  accountRecordId: string | null;
  businessAccountId: string;
  companyName: string;
  rowKey: string | null;
  contactId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactExtension?: string | null;
  contactEmail: string | null;
  rawContactName: string | null;
  rawContactPhone: string | null;
  rawContactEmail: string | null;
  rawCompanyName: string | null;
  rawAddress: string | null;
  sourceRowKind: "contact" | "account" | "unknown";
  isPrimaryContact: boolean;
  salesRepName: string | null;
  address: string;
  category: string | null;
  companyRegion: string | null;
  subCategory: string | null;
  industryType: string | null;
  week: string | null;
  duplicateGroupKey?: string | null;
};

export type DataQualityIssuesResponse = {
  metric: DataQualityMetricKey;
  basis: DataQualityBasis;
  salesRep: string | null;
  total: number;
  page: number;
  pageSize: number;
  items: DataQualityIssueRow[];
  computedAtIso: string;
};

export type DataQualityTaskPriority = "high" | "medium" | "low";

export type DataQualityTaskActionPage = "accounts" | "quality";

export type DataQualityTask = {
  taskKey: string;
  metric: DataQualityMetricKey;
  metricLabel: string;
  basis: DataQualityBasis;
  assigneeName: string;
  priority: DataQualityTaskPriority;
  actionPage: DataQualityTaskActionPage;
  title: string;
  summary: string;
  fixSteps: string[];
  affectedCount: number;
  actionable: boolean;
  reviewReason: "missing_identity" | null;
  companyAssignmentContext?: {
    displayName: string | null;
    email: string | null;
    phone: string | null;
    sourceCompanyName: string | null;
    address: string | null;
    clueBadges: string[];
  };
  issue: DataQualityIssueRow;
  relatedIssues?: DataQualityIssueRow[];
};

export type DataQualityTaskRepSummary = {
  salesRepName: string;
  openTasks: number;
  highPriorityTasks: number;
};

export type DataQualityTasksResponse = {
  computedAtIso: string;
  total: number;
  reviewTotal?: number;
  tasks: DataQualityTask[];
  reps: DataQualityTaskRepSummary[];
};

export type DataQualityStatus = "open" | "reviewed" | "resolved";

export type DataQualityKpiSummary = {
  timezone: string;
  basis: DataQualityBasis;
  openIssues: number;
  affectedRecords: number;
  reviewedExceptions: number;
  cleanRecords: number;
  totalChecked: number;
  percentComplete: number;
};

export type DataQualityThroughputWindow = {
  fixed: number;
  created: number;
  netChange: number;
};

export type DataQualityThroughputResponse = {
  timezone: string;
  basis: DataQualityBasis;
  today: DataQualityThroughputWindow;
  week: DataQualityThroughputWindow;
  month: DataQualityThroughputWindow;
};

export type DataQualityTrendPoint = {
  day: string;
  openIssues: number;
  created: number;
  fixed: number;
};

export type DataQualityTrendsResponse = {
  timezone: string;
  basis: DataQualityBasis;
  points: DataQualityTrendPoint[];
  burndown: {
    remainingOpenIssues: number;
    avgNetFixPerDay14d: number;
    etaDaysToZero: number | null;
  };
};

export type DataQualityMetricScoreRow = {
  key: DataQualityMetricKey;
  label: string;
  open: number;
  reviewed: number;
  totalChecked: number;
  percentComplete: number;
  fixedToday: number;
  fixedWeek: number;
  fixedMonth: number;
  delta7d: number;
};

export type DataQualityLeaderboardRow = {
  salesRepName: string;
  assignedOpenIssues: number;
  fixedToday: number;
  fixedWeek: number;
  fixedMonth: number;
  closureRatePct: number;
  rank: number;
};

export type DataQualityLeaderboardResponse = {
  timezone: string;
  basis: DataQualityBasis;
  items: DataQualityLeaderboardRow[];
};

export type DataQualityContributorRow = {
  userId: string;
  userName: string;
  fixedTotal: number;
  fixedToday: number;
  fixedWeek: number;
  fixedMonth: number;
  rank: number;
};

export type DataQualityContributorsResponse = {
  timezone: string;
  basis: DataQualityBasis;
  items: DataQualityContributorRow[];
};

export type DataQualityExpandedSummaryResponse = DataQualitySummaryResponse & {
  kpis: DataQualityKpiSummary;
  scoreboard: DataQualityMetricScoreRow[];
};
