import { buildDataQualityIssueKey, type DataQualitySnapshot } from "@/lib/data-quality";
import {
  DATA_QUALITY_METRIC_KEYS,
  type DataQualityBasis,
  type DataQualityIssueRow,
  type DataQualityMetricKey,
  type DataQualityTask,
  type DataQualityTaskActionPage,
  type DataQualityTaskPriority,
  type DataQualityTasksResponse,
} from "@/types/data-quality";

type CompanyAssignmentContext = NonNullable<DataQualityTask["companyAssignmentContext"]>;

const TASK_BASIS_BY_METRIC: Record<DataQualityMetricKey, DataQualityBasis> = {
  missingCompany: "account",
  missingContact: "account",
  invalidPhone: "row",
  missingContactEmail: "row",
  missingSalesRep: "account",
  missingCategory: "account",
  missingRegion: "account",
  missingSubCategory: "account",
  missingIndustry: "account",
  duplicateBusinessAccount: "account",
  duplicateContact: "row",
};

const TASK_PRIORITY_BY_METRIC: Record<DataQualityMetricKey, DataQualityTaskPriority> = {
  missingCompany: "high",
  missingContact: "high",
  invalidPhone: "medium",
  missingContactEmail: "medium",
  missingSalesRep: "medium",
  missingCategory: "low",
  missingRegion: "low",
  missingSubCategory: "low",
  missingIndustry: "low",
  duplicateBusinessAccount: "high",
  duplicateContact: "high",
};

const TASK_ACTION_PAGE_BY_METRIC: Record<DataQualityMetricKey, DataQualityTaskActionPage> = {
  missingCompany: "accounts",
  missingContact: "accounts",
  invalidPhone: "accounts",
  missingContactEmail: "accounts",
  missingSalesRep: "accounts",
  missingCategory: "accounts",
  missingRegion: "accounts",
  missingSubCategory: "accounts",
  missingIndustry: "accounts",
  duplicateBusinessAccount: "quality",
  duplicateContact: "quality",
};

const PRIORITY_SORT_WEIGHT: Record<DataQualityTaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function normalizeComparable(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function hasMeaningfulText(value: string | null | undefined, minLength = 2): value is string {
  return typeof value === "string" && value.trim().length > minLength;
}

function hasMeaningfulPhone(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().replace(/\D/g, "").length >= 7;
}

function hasPlausibleEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value.trim());
}

function pickFirstMeaningful(
  values: Array<string | null | undefined>,
  minLength = 2,
): string | null {
  for (const value of values) {
    if (hasMeaningfulText(value, minLength)) {
      return value.trim();
    }
  }

  return null;
}

function buildMissingCompanyGroupKey(issue: DataQualityIssueRow): string {
  if (issue.contactId !== null) {
    return `contact:${issue.contactId}`;
  }

  const normalizedEmail = normalizeComparable(issue.contactEmail ?? issue.rawContactEmail);
  if (normalizedEmail) {
    return `email:${normalizedEmail}`;
  }

  const normalizedName = normalizeComparable(issue.contactName ?? issue.rawContactName);
  if (normalizedName) {
    return `name:${normalizedName}`;
  }

  const normalizedRowKey = normalizeComparable(issue.rowKey);
  if (normalizedRowKey) {
    return `row:${normalizedRowKey}`;
  }

  return buildDataQualityIssueKey("missingCompany", "account", issue);
}

function normalizeAssigneeName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Unassigned";
}

function formatText(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function buildCompanyAssignmentContext(
  issue: DataQualityIssueRow,
): CompanyAssignmentContext {
  const displayName = pickFirstMeaningful(
    [issue.contactName, issue.rawContactName],
    2,
  );
  const email = hasPlausibleEmail(issue.contactEmail)
    ? issue.contactEmail.trim()
    : hasPlausibleEmail(issue.rawContactEmail)
      ? issue.rawContactEmail.trim()
      : null;
  const phone = hasMeaningfulPhone(issue.contactPhone)
    ? issue.contactPhone.trim()
    : hasMeaningfulPhone(issue.rawContactPhone)
      ? issue.rawContactPhone.trim()
      : null;
  const sourceCompanyName = pickFirstMeaningful(
    [issue.rawCompanyName, issue.companyName],
    3,
  );
  const address = pickFirstMeaningful([issue.address, issue.rawAddress], 3);
  const clueBadges: string[] = [];

  if (email) {
    clueBadges.push("Email available");
  }
  if (phone) {
    clueBadges.push("Phone available");
  }
  if (sourceCompanyName) {
    clueBadges.push("Source company clue");
  }
  if (address) {
    clueBadges.push("Address clue");
  }

  return {
    displayName,
    email,
    phone,
    sourceCompanyName,
    address,
    clueBadges,
  };
}

function hasActionableCompanyAssignmentClue(
  context: CompanyAssignmentContext,
): boolean {
  return Boolean(
    context.displayName ||
      context.email ||
      context.phone ||
      context.sourceCompanyName ||
      context.address,
  );
}

function buildMissingCompanyReviewReason(
  context: CompanyAssignmentContext,
): DataQualityTask["reviewReason"] {
  return hasActionableCompanyAssignmentClue(context) ? null : "missing_identity";
}

function scoreCompanyAssignmentContext(context: CompanyAssignmentContext): number {
  let score = 0;

  if (context.displayName) {
    score += 40;
  }
  if (context.email) {
    score += 30;
  }
  if (context.phone) {
    score += 20;
  }
  if (context.sourceCompanyName) {
    score += 15;
  }
  if (context.address) {
    score += 10;
  }

  return score;
}

function pickBestMissingCompanyIssue(issues: DataQualityIssueRow[]): DataQualityIssueRow | null {
  let bestIssue: DataQualityIssueRow | null = null;
  let bestScore = -1;

  for (const issue of issues) {
    const score = scoreCompanyAssignmentContext(buildCompanyAssignmentContext(issue));
    if (score > bestScore) {
      bestIssue = issue;
      bestScore = score;
    }
  }

  return bestIssue;
}

function buildTaskTitle(
  metric: DataQualityMetricKey,
  issue: DataQualityIssueRow,
  affectedCount: number,
  companyAssignmentContext?: CompanyAssignmentContext,
): string {
  const companyName = formatText(issue.companyName, "Unnamed company");
  const contactName = formatText(issue.contactName, "primary contact");

  switch (metric) {
    case "missingCompany":
      return (
        companyAssignmentContext?.displayName ??
        pickFirstMeaningful(
          [
            issue.contactEmail,
            issue.rawContactEmail,
            issue.contactPhone,
            issue.rawContactPhone,
            issue.rawCompanyName,
          ],
          2,
        ) ??
        "Review unassigned record"
      );
    case "missingContact":
      return `${companyName}: add a primary contact`;
    case "invalidPhone":
      return `${contactName}: correct the phone number`;
    case "missingContactEmail":
      return `${contactName}: add a contact email`;
    case "missingSalesRep":
      return `${companyName}: assign a sales rep`;
    case "missingCategory":
      return `${companyName}: choose a category`;
    case "missingRegion":
      return `${companyName}: choose a company region`;
    case "missingSubCategory":
      return `${companyName}: choose a sub-category`;
    case "missingIndustry":
      return `${companyName}: choose an industry type`;
    case "duplicateBusinessAccount":
      return `${companyName}: review ${affectedCount} duplicate account${affectedCount === 1 ? "" : "s"}`;
    case "duplicateContact":
      return `${companyName}: merge ${affectedCount} duplicate contact${affectedCount === 1 ? "" : "s"}`;
  }
}

function buildTaskSummary(
  metric: DataQualityMetricKey,
  issue: DataQualityIssueRow,
  affectedCount: number,
  companyAssignmentContext?: CompanyAssignmentContext,
): string {
  const companyName = formatText(issue.companyName, "This record");
  const contactName = formatText(issue.contactName, "The primary contact");
  const phone = formatText(issue.contactPhone, "missing");
  const email = formatText(issue.contactEmail, "missing");

  switch (metric) {
    case "missingCompany":
      if (!hasActionableCompanyAssignmentClue(companyAssignmentContext ?? buildCompanyAssignmentContext(issue))) {
        return "This record does not have enough contact or company information to assign safely.";
      }
      return affectedCount > 1
        ? `This person appears in ${affectedCount} unassigned rows. Pick the correct company once and the app will update all of them.`
        : "This person is not linked to a company yet. Pick the correct company below.";
    case "missingContact":
      return `${companyName} does not have an associated contact row yet.`;
    case "invalidPhone":
      return `${contactName} is using an invalid phone value: ${phone}.`;
    case "missingContactEmail":
      return `${contactName} does not have an email address on file (${email}).`;
    case "missingSalesRep":
      return `${companyName} is not assigned to a sales rep.`;
    case "missingCategory":
      return `${companyName} is missing a client category.`;
    case "missingRegion":
      return `${companyName} is missing a company region value.`;
    case "missingSubCategory":
      return `${companyName} is missing a sub-category value.`;
    case "missingIndustry":
      return `${companyName} is missing an industry type value.`;
    case "duplicateBusinessAccount":
      return `${affectedCount} business account records appear to describe the same company.`;
    case "duplicateContact":
      return `${affectedCount} contacts on this account appear to be duplicates and should be reviewed together.`;
  }
}

function buildFixSteps(metric: DataQualityMetricKey): string[] {
  switch (metric) {
    case "missingCompany":
      return [
        "Open Accounts and identify which business account this contact should belong to.",
        "Update or recreate the record so it has the correct company name and business account assignment.",
        "Save the account, then refresh Tasks or Data Quality to confirm the issue disappears.",
      ];
    case "missingContact":
      return [
        "Open Accounts for the company.",
        "Create a contact or choose the right existing contact as the primary contact.",
        "Fill the contact details, save, and refresh the issue list.",
      ];
    case "invalidPhone":
      return [
        "Open Accounts for the contact shown on this task.",
        "Replace the phone number with the correct `###-###-####` format.",
        "Save the record and refresh the issue list to verify the phone now passes validation.",
      ];
    case "missingContactEmail":
      return [
        "Open Accounts for the contact shown on this task.",
        "Enter the correct primary contact email address.",
        "Save the record and refresh the issue list.",
      ];
    case "missingSalesRep":
      return [
        "Open Accounts for the company.",
        "Choose the correct Sales Rep from the employee list so both name and employee ID are saved.",
        "Save the company and refresh the issue list.",
      ];
    case "missingCategory":
      return [
        "Open Accounts for the company.",
        "Pick the correct client category from the dropdown.",
        "Save the company and refresh the issue list.",
      ];
    case "missingRegion":
      return [
        "Open Accounts for the company.",
        "Pick the correct Company Region value.",
        "Save the company and refresh the issue list.",
      ];
    case "missingSubCategory":
      return [
        "Open Accounts for the company.",
        "Pick the correct Sub-Category value.",
        "Save the company and refresh the issue list.",
      ];
    case "missingIndustry":
      return [
        "Open Accounts for the company.",
        "Pick the correct Industry Type value.",
        "Save the company and refresh the issue list.",
      ];
    case "duplicateBusinessAccount":
      return [
        "Open Data Quality and compare the duplicate business account records for this company.",
        "Decide which record is the survivor and move any missing information to that record.",
        "Complete the merge or cleanup in Acumatica, then refresh the issue list.",
      ];
    case "duplicateContact":
      return [
        "Open Data Quality for this company and review the duplicate contacts together.",
        "Click Merge contacts and keep the best values for each field.",
        "Confirm the correct primary contact, complete the merge, and refresh the issue list.",
      ];
  }
}

function sortTasks(tasks: DataQualityTask[]): DataQualityTask[] {
  return [...tasks].sort((left, right) => {
    const actionableDelta = Number(right.actionable) - Number(left.actionable);
    if (actionableDelta !== 0) {
      return actionableDelta;
    }

    const priorityDelta =
      PRIORITY_SORT_WEIGHT[left.priority] - PRIORITY_SORT_WEIGHT[right.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const metricDelta =
      DATA_QUALITY_METRIC_KEYS.indexOf(left.metric) -
      DATA_QUALITY_METRIC_KEYS.indexOf(right.metric);
    if (metricDelta !== 0) {
      return metricDelta;
    }

    const assigneeDelta = left.assigneeName.localeCompare(right.assigneeName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (assigneeDelta !== 0) {
      return assigneeDelta;
    }

    return left.issue.companyName.localeCompare(right.issue.companyName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

function buildBaseTask(
  metric: DataQualityMetricKey,
  metricLabel: string,
  basis: DataQualityBasis,
  issue: DataQualityIssueRow,
  taskKey: string,
  affectedCount: number,
  relatedIssues?: DataQualityIssueRow[],
): DataQualityTask {
  const companyAssignmentContext =
    metric === "missingCompany" ? buildCompanyAssignmentContext(issue) : undefined;
  const actionable =
    metric === "missingCompany" && companyAssignmentContext
      ? hasActionableCompanyAssignmentClue(companyAssignmentContext)
      : true;
  const reviewReason =
    metric === "missingCompany" && companyAssignmentContext
      ? buildMissingCompanyReviewReason(companyAssignmentContext)
      : null;

  return {
    taskKey,
    metric,
    metricLabel,
    basis,
    assigneeName: normalizeAssigneeName(issue.salesRepName),
    priority: TASK_PRIORITY_BY_METRIC[metric],
    actionPage: TASK_ACTION_PAGE_BY_METRIC[metric],
    title: buildTaskTitle(metric, issue, affectedCount, companyAssignmentContext),
    summary: buildTaskSummary(metric, issue, affectedCount, companyAssignmentContext),
    fixSteps: buildFixSteps(metric),
    affectedCount,
    actionable,
    reviewReason,
    companyAssignmentContext,
    issue: {
      ...issue,
      issueKey: buildDataQualityIssueKey(metric, basis, issue),
    },
    relatedIssues: relatedIssues?.map((relatedIssue) => ({
      ...relatedIssue,
      issueKey: buildDataQualityIssueKey(metric, basis, relatedIssue),
    })),
  };
}

function buildMetricTasks(
  snapshot: DataQualitySnapshot,
  metric: DataQualityMetricKey,
  metricLabel: string,
): DataQualityTask[] {
  const basis = TASK_BASIS_BY_METRIC[metric];
  const sourceRows = snapshot.issues[metric][basis];

  if (metric === "duplicateBusinessAccount" || metric === "duplicateContact") {
    const groups = new Map<string, DataQualityIssueRow[]>();

    sourceRows.forEach((issue) => {
      const groupKey =
        issue.duplicateGroupKey?.trim() ||
        buildDataQualityIssueKey(metric, basis, issue);
      const existing = groups.get(groupKey);
      if (existing) {
        existing.push(issue);
      } else {
        groups.set(groupKey, [issue]);
      }
    });

    return [...groups.entries()].flatMap(([groupKey, issues]) => {
      const representativeIssue = pickBestMissingCompanyIssue(issues);
      if (!representativeIssue) {
        return [];
      }

      return [
        buildBaseTask(
          metric,
          metricLabel,
          basis,
          representativeIssue,
          `task|${metric}|${groupKey}`,
          issues.length,
          issues,
        ),
      ];
    });
  }

  if (metric === "missingCompany") {
    const groups = new Map<string, DataQualityIssueRow[]>();

    sourceRows.forEach((issue) => {
      const groupKey = buildMissingCompanyGroupKey(issue);
      const existing = groups.get(groupKey);
      if (existing) {
        existing.push(issue);
      } else {
        groups.set(groupKey, [issue]);
      }
    });

    return [...groups.entries()].flatMap(([groupKey, issues]) => {
      const representativeIssue = issues[0];
      if (!representativeIssue) {
        return [];
      }

      return [
        buildBaseTask(
          metric,
          metricLabel,
          basis,
          representativeIssue,
          `task|${metric}|${groupKey}`,
          issues.length,
          issues,
        ),
      ];
    });
  }

  return sourceRows.map((issue) => {
    const taskKey = `task|${buildDataQualityIssueKey(metric, basis, issue)}`;
    return buildBaseTask(metric, metricLabel, basis, issue, taskKey, 1);
  });
}

export function buildDataQualityTasks(
  snapshot: DataQualitySnapshot,
): DataQualityTasksResponse {
  const metricLabelByKey = new Map(
    snapshot.metrics.map((metric) => [metric.key, metric.label] as const),
  );

  const tasks = sortTasks(
    DATA_QUALITY_METRIC_KEYS.flatMap((metric) =>
      buildMetricTasks(
        snapshot,
        metric,
        metricLabelByKey.get(metric) ?? metric,
      ),
    ),
  );
  const actionableTasks = tasks.filter((task) => task.actionable);
  const reviewTotal = tasks.length - actionableTasks.length;

  const repsByName = new Map<
    string,
    {
      openTasks: number;
      highPriorityTasks: number;
    }
  >();

  actionableTasks.forEach((task) => {
    const existing = repsByName.get(task.assigneeName) ?? {
      openTasks: 0,
      highPriorityTasks: 0,
    };
    existing.openTasks += 1;
    if (task.priority === "high") {
      existing.highPriorityTasks += 1;
    }
    repsByName.set(task.assigneeName, existing);
  });

  const reps = [...repsByName.entries()]
    .map(([salesRepName, counts]) => ({
      salesRepName,
      openTasks: counts.openTasks,
      highPriorityTasks: counts.highPriorityTasks,
    }))
    .sort((left, right) => {
      const taskDelta = right.openTasks - left.openTasks;
      if (taskDelta !== 0) {
        return taskDelta;
      }

      return left.salesRepName.localeCompare(right.salesRepName, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });

  return {
    computedAtIso: snapshot.computedAtIso,
    total: actionableTasks.length,
    reviewTotal,
    tasks,
    reps,
  };
}
