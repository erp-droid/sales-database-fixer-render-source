"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import Link from "next/link";

import { AppChrome } from "@/components/app-chrome";
import { ContactMergeModal } from "@/components/contact-merge-modal";
import { CallPhoneButton } from "@/components/call-phone-button";
import {
  CreateContactDrawer,
  type CreateContactAccountOption,
} from "@/components/create-contact-drawer";
import { buildDataQualityIssueKey } from "@/lib/data-quality";
import { BUSINESS_ACCOUNT_REGION_VALUES } from "@/lib/business-account-region-values";
import {
  formatPhoneDraftValue,
  normalizeExtensionForSave,
  normalizePhoneForSave,
  parsePhoneWithExtension,
} from "@/lib/phone";
import type {
  BusinessAccountDetailResponse,
  BusinessAccountRow,
  BusinessAccountUpdateRequest,
  BusinessAccountsResponse,
  Category,
} from "@/types/business-account";
import type {
  BusinessAccountContactCreatePartialResponse,
  BusinessAccountContactCreateResponse,
} from "@/types/business-account-create";
import type {
  DataQualityIssueRow,
  DataQualityMetricKey,
  DataQualityTask,
  DataQualityTaskRepSummary,
  DataQualityTasksResponse,
} from "@/types/data-quality";
import type {
  ContactMergeResponse,
  MergeableContactCandidate,
} from "@/types/contact-merge";

import styles from "./tasks-client.module.css";

const LIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type SessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
  } | null;
};

type EmployeeOption = {
  id: string;
  name: string;
};

type EmployeeLookupResponse = {
  items: EmployeeOption[];
};

type ErrorPayload = {
  error?: string;
};

type AttributeOption = {
  value: string;
  label: string;
  aliases?: string[];
};

type RowFixDraft = {
  accountSearchTerm: string;
  selectedAccountRecordId: string;
  companyName: string;
  salesRepId: string;
  category: string;
  companyRegion: string;
  subCategory: string;
  industryType: string;
  primaryContactPhone: string;
  primaryContactExtension: string;
  primaryContactEmail: string;
};

type TaskMetricSectionDefinition = {
  metric: DataQualityMetricKey;
  label: string;
};

type TaskGroupDefinition = {
  key: string;
  label: string;
  description: string;
  sections: TaskMetricSectionDefinition[];
};

type TaskGroupSection = {
  key: string;
  label: string;
  description: string;
  total: number;
  sections: Array<TaskMetricSectionDefinition & { items: DataQualityTask[] }>;
};

type CompanyAssignmentInfoRow = {
  label: string;
  value: string;
};

const CATEGORY_OPTIONS: AttributeOption[] = [
  { value: "A", label: "A - Type Customers", aliases: ["A - Type Clients"] },
  { value: "B", label: "B - Type Customers", aliases: ["B - Type Clients"] },
  { value: "C", label: "C - Type Customers", aliases: ["C - Type Clients"] },
  { value: "D", label: "D - Type Customers", aliases: ["D - Type Clients"] },
];

const INDUSTRY_TYPE_OPTIONS: AttributeOption[] = [
  { value: "Distributi", label: "Distribution", aliases: ["Distributi"] },
  { value: "Manufactur", label: "Manufacturing", aliases: ["Manufactur"] },
  { value: "Recreation", label: "Recreation" },
  { value: "Service", label: "Service" },
];

const SUB_CATEGORY_OPTIONS: AttributeOption[] = [
  { value: "Automotive", label: "Automotive" },
  { value: "Distributi", label: "Food & Beverage", aliases: ["Distribution"] },
  { value: "Electronic", label: "Electronics", aliases: ["Electronic"] },
  { value: "Fabric", label: "Fabrication" },
  { value: "General", label: "General" },
  { value: "Manufactur", label: "Pharmaceuticals", aliases: ["Manufacturing"] },
  { value: "Package", label: "Packaging" },
  { value: "Plastics", label: "Plastics" },
  { value: "Recreation", label: "Aerospace & Defense" },
  { value: "Service", label: "Chemical" },
];

const COMPANY_REGION_OPTIONS: AttributeOption[] = [
  ...BUSINESS_ACCOUNT_REGION_VALUES.map((value) => ({
    value,
    label: value,
  })),
];

const TASK_GROUP_DEFINITIONS: TaskGroupDefinition[] = [
  {
    key: "assignment",
    label: "Assignment Issues",
    description: "Work that assigns the record to the right company, contact, or sales rep.",
    sections: [
      { metric: "missingCompany", label: "Company Assignment" },
      { metric: "missingContact", label: "Primary Contact Assignment" },
      { metric: "missingSalesRep", label: "Sales Rep Assignment" },
    ],
  },
  {
    key: "contact-details",
    label: "Contact Detail Issues",
    description: "Missing or invalid contact information that can be fixed directly here.",
    sections: [
      { metric: "invalidPhone", label: "Phone Number Issues" },
      { metric: "missingContactEmail", label: "Email Address Issues" },
    ],
  },
  {
    key: "company-details",
    label: "Company Detail Issues",
    description: "Missing company classification and territory fields.",
    sections: [
      { metric: "missingCategory", label: "Category Assignment" },
      { metric: "missingRegion", label: "Company Region Assignment" },
      { metric: "missingSubCategory", label: "Sub-Category Assignment" },
      { metric: "missingIndustry", label: "Industry Type Assignment" },
    ],
  },
  {
    key: "duplicates",
    label: "Duplicate Issues",
    description: "Possible duplicate accounts and contacts that need cleanup.",
    sections: [
      { metric: "duplicateBusinessAccount", label: "Duplicate Companies" },
      { metric: "duplicateContact", label: "Duplicate Contacts" },
    ],
  },
];

const GROUPED_METRICS = new Set(
  TASK_GROUP_DEFINITIONS.flatMap((group) => group.sections.map((section) => section.metric)),
);

const MATCH_NOISE_TOKENS = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "the",
  "ca",
  "on",
  "canada",
]);

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const user = record.user;
  const validUser =
    user === null ||
    (typeof user === "object" &&
      user !== null &&
      typeof (user as Record<string, unknown>).id === "string" &&
      typeof (user as Record<string, unknown>).name === "string");

  return typeof record.authenticated === "boolean" && validUser;
}

function isEmployeeOption(value: unknown): value is EmployeeOption {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string";
}

function isEmployeeLookupResponse(value: unknown): value is EmployeeLookupResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.every((item) => isEmployeeOption(item));
}

function isBusinessAccountRow(value: unknown): value is BusinessAccountRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as Record<string, unknown>).id === "string";
}

function isBusinessAccountsResponse(value: unknown): value is BusinessAccountsResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.items) &&
    record.items.every((item) => isBusinessAccountRow(item)) &&
    typeof record.total === "number" &&
    typeof record.page === "number" &&
    typeof record.pageSize === "number"
  );
}

function isBusinessAccountDetailResponse(value: unknown): value is BusinessAccountDetailResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isBusinessAccountRow(record.row);
}

function readDetailResponseRow(value: unknown): BusinessAccountRow | null {
  if (isBusinessAccountDetailResponse(value)) {
    return value.row;
  }

  if (isBusinessAccountRow(value)) {
    return value;
  }

  return null;
}

function isDataQualityIssueRow(value: unknown): value is DataQualityIssueRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.accountKey === "string" &&
    (record.accountRecordId === null || typeof record.accountRecordId === "string") &&
    typeof record.businessAccountId === "string" &&
    typeof record.companyName === "string" &&
    (record.rowKey === null || typeof record.rowKey === "string") &&
    (record.contactId === null || typeof record.contactId === "number") &&
    (record.contactName === null || typeof record.contactName === "string") &&
    (record.contactPhone === null || typeof record.contactPhone === "string") &&
    (record.contactEmail === null || typeof record.contactEmail === "string") &&
    (record.rawContactName === null || typeof record.rawContactName === "string") &&
    (record.rawContactPhone === null || typeof record.rawContactPhone === "string") &&
    (record.rawContactEmail === null || typeof record.rawContactEmail === "string") &&
    (record.rawCompanyName === null || typeof record.rawCompanyName === "string") &&
    (record.rawAddress === null || typeof record.rawAddress === "string") &&
    (record.sourceRowKind === "contact" ||
      record.sourceRowKind === "account" ||
      record.sourceRowKind === "unknown") &&
    typeof record.isPrimaryContact === "boolean" &&
    (record.salesRepName === null || typeof record.salesRepName === "string") &&
    typeof record.address === "string"
  );
}

function isCompanyAssignmentContext(value: unknown): value is NonNullable<DataQualityTask["companyAssignmentContext"]> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.displayName === null || typeof record.displayName === "string") &&
    (record.email === null || typeof record.email === "string") &&
    (record.phone === null || typeof record.phone === "string") &&
    (record.sourceCompanyName === null || typeof record.sourceCompanyName === "string") &&
    (record.address === null || typeof record.address === "string") &&
    Array.isArray(record.clueBadges) &&
    record.clueBadges.every((item) => typeof item === "string")
  );
}

function isTask(value: unknown): value is DataQualityTask {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.taskKey === "string" &&
    typeof record.metric === "string" &&
    typeof record.metricLabel === "string" &&
    (record.basis === "account" || record.basis === "row") &&
    typeof record.assigneeName === "string" &&
    (record.priority === "high" || record.priority === "medium" || record.priority === "low") &&
    (record.actionPage === "accounts" || record.actionPage === "quality") &&
    typeof record.title === "string" &&
    typeof record.summary === "string" &&
    typeof record.affectedCount === "number" &&
    typeof record.actionable === "boolean" &&
    (record.reviewReason === null || record.reviewReason === "missing_identity") &&
    (!("companyAssignmentContext" in record) ||
      record.companyAssignmentContext === undefined ||
      isCompanyAssignmentContext(record.companyAssignmentContext)) &&
    Array.isArray(record.fixSteps) &&
    record.fixSteps.every((step) => typeof step === "string") &&
    isDataQualityIssueRow(record.issue) &&
    (!("relatedIssues" in record) ||
      record.relatedIssues === undefined ||
      (Array.isArray(record.relatedIssues) &&
        record.relatedIssues.every((item) => isDataQualityIssueRow(item))))
  );
}

function isRepSummary(value: unknown): value is DataQualityTaskRepSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.salesRepName === "string" &&
    typeof record.openTasks === "number" &&
    typeof record.highPriorityTasks === "number"
  );
}

function isTasksResponse(value: unknown): value is DataQualityTasksResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.computedAtIso === "string" &&
    typeof record.total === "number" &&
    (!("reviewTotal" in record) || typeof record.reviewTotal === "number") &&
    Array.isArray(record.tasks) &&
    record.tasks.every((task) => isTask(task)) &&
    Array.isArray(record.reps) &&
    record.reps.every((rep) => isRepSummary(rep))
  );
}

function parseError(payload: ErrorPayload | null): string {
  if (!payload?.error || !payload.error.trim()) {
    return "Request failed.";
  }

  return payload.error;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json().catch(() => null)) as T | null;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString();
}

function formatText(value: string | null | undefined, fallback = "-"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function hasMeaningfulText(value: string | null | undefined, minLength = 2): value is string {
  return typeof value === "string" && value.trim().length > minLength;
}

function getPriorityClassName(priority: DataQualityTask["priority"]): string {
  if (priority === "high") {
    return styles.priorityHigh;
  }
  if (priority === "medium") {
    return styles.priorityMedium;
  }
  return styles.priorityLow;
}

function buildCompanyAssignmentInfoRows(task: DataQualityTask): CompanyAssignmentInfoRow[] {
  const context = task.companyAssignmentContext;
  if (!context) {
    return [];
  }

  const rows: CompanyAssignmentInfoRow[] = [];
  if (hasMeaningfulText(context.email, 3)) {
    rows.push({ label: "Email", value: context.email.trim() });
  }
  if (hasMeaningfulText(context.phone, 3)) {
    rows.push({ label: "Phone", value: context.phone.trim() });
  }
  if (hasMeaningfulText(context.address, 3)) {
    rows.push({ label: "Address clue", value: context.address.trim() });
  }
  if (hasMeaningfulText(context.sourceCompanyName, 3)) {
    rows.push({ label: "Source company clue", value: context.sourceCompanyName.trim() });
  }
  if (task.affectedCount > 1) {
    rows.push({
      label: "Matching rows",
      value: task.affectedCount.toLocaleString(),
    });
  }

  return rows;
}

function buildReviewInfoRows(task: DataQualityTask): CompanyAssignmentInfoRow[] {
  const rows: CompanyAssignmentInfoRow[] = [];

  if (hasMeaningfulText(task.issue.rawCompanyName, 0)) {
    rows.push({ label: "Raw source company", value: task.issue.rawCompanyName.trim() });
  }
  if (hasMeaningfulText(task.issue.rawContactEmail, 0)) {
    rows.push({ label: "Raw email", value: task.issue.rawContactEmail.trim() });
  }
  if (hasMeaningfulText(task.issue.rawContactPhone, 0)) {
    rows.push({ label: "Raw phone", value: task.issue.rawContactPhone.trim() });
  }
  if (hasMeaningfulText(task.issue.rawAddress, 0)) {
    rows.push({ label: "Address", value: task.issue.rawAddress.trim() });
  }
  if (hasMeaningfulText(task.issue.rowKey, 0)) {
    rows.push({ label: "Row key", value: task.issue.rowKey.trim() });
  }
  if (hasMeaningfulText(task.issue.accountRecordId, 0)) {
    rows.push({ label: "Account record ID", value: task.issue.accountRecordId.trim() });
  }
  if (hasMeaningfulText(task.issue.businessAccountId, 0)) {
    rows.push({ label: "Business account ID", value: task.issue.businessAccountId.trim() });
  }

  return rows;
}

function formatCreateContactAccountAddress(row: BusinessAccountRow): string {
  if (row.address.trim()) {
    return row.address;
  }

  return [row.addressLine1, row.addressLine2, row.city, row.state, row.postalCode, row.country]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

function buildCreateContactAccountOptions(
  rows: BusinessAccountRow[],
): CreateContactAccountOption[] {
  const byAccount = new Map<string, CreateContactAccountOption>();

  rows.forEach((row) => {
    const businessAccountRecordId = (row.accountRecordId ?? row.id ?? "").trim();
    const businessAccountId = row.businessAccountId.trim();
    const companyName = row.companyName.trim();
    if (!businessAccountRecordId || !businessAccountId || !companyName) {
      return;
    }

    const key = businessAccountRecordId || businessAccountId;
    if (byAccount.has(key)) {
      return;
    }

    byAccount.set(key, {
      businessAccountRecordId,
      businessAccountId,
      companyName,
      address: formatCreateContactAccountAddress(row),
    });
  });

  return [...byAccount.values()].sort((left, right) => {
    const companyCompare = left.companyName.localeCompare(right.companyName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (companyCompare !== 0) {
      return companyCompare;
    }

    return left.address.localeCompare(right.address, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

function normalizeOptionComparable(value: string): string {
  return value.trim().toLowerCase();
}

function extractMeaningfulTokens(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !MATCH_NOISE_TOKENS.has(part));
}

function normalizeCompactText(value: string | null | undefined): string {
  return extractMeaningfulTokens(value).join("");
}

function readEmailDomainRoot(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const parts = value.trim().toLowerCase().split("@");
  if (parts.length !== 2) {
    return "";
  }

  const labels = parts[1].split(".").filter(Boolean);
  return labels[0]?.replace(/[^a-z0-9]/g, "") ?? "";
}

function extractPhoneSearchTokens(value: string | null | undefined): string[] {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 7) {
    return [];
  }

  const tokens = new Set<string>();
  if (digits.length >= 3) {
    tokens.add(digits.slice(0, 3));
  }
  if (digits.length >= 6) {
    tokens.add(digits.slice(0, 6));
  }
  tokens.add(digits.slice(-4));
  return [...tokens];
}

function compareOptionsByName(
  left: CreateContactAccountOption,
  right: CreateContactAccountOption,
): number {
  return left.companyName.localeCompare(right.companyName, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function buildSuggestedAccountOptions(
  task: DataQualityTask,
  options: CreateContactAccountOption[],
): CreateContactAccountOption[] {
  const companyContext = task.companyAssignmentContext;
  const issueCompanyCompact = normalizeCompactText(
    companyContext?.sourceCompanyName ?? task.issue.rawCompanyName ?? task.issue.companyName,
  );
  const emailDomainRoot = readEmailDomainRoot(
    companyContext?.email ?? task.issue.contactEmail ?? task.issue.rawContactEmail,
  );
  const addressText = companyContext?.address ?? task.issue.address ?? task.issue.rawAddress;
  const addressTokens = extractMeaningfulTokens(addressText).slice(0, 6);
  const compactAddress = normalizeCompactText(addressText);
  const phoneTokens = extractPhoneSearchTokens(
    companyContext?.phone ?? task.issue.contactPhone ?? task.issue.rawContactPhone,
  );

  return options
    .map((option) => {
      const optionCompanyCompact = normalizeCompactText(option.companyName);
      const optionSearchable = `${option.companyName} ${option.businessAccountId} ${option.address}`.toLowerCase();
      const optionCompactAddress = normalizeCompactText(option.address);
      const optionDigits = optionSearchable.replace(/\D/g, "");
      let score = 0;

      if (emailDomainRoot) {
        if (optionCompanyCompact === emailDomainRoot) {
          score += 200;
        } else if (
          optionCompanyCompact.includes(emailDomainRoot) ||
          emailDomainRoot.includes(optionCompanyCompact)
        ) {
          score += 140;
        } else if (optionSearchable.replace(/[^a-z0-9]/g, "").includes(emailDomainRoot)) {
          score += 90;
        }
      }

      if (issueCompanyCompact) {
        if (optionCompanyCompact === issueCompanyCompact) {
          score += 180;
        } else if (
          optionCompanyCompact.includes(issueCompanyCompact) ||
          issueCompanyCompact.includes(optionCompanyCompact)
        ) {
          score += 120;
        }
      }

      if (compactAddress && optionCompactAddress && optionCompactAddress === compactAddress) {
        score += 180;
      }

      addressTokens.forEach((token) => {
        if (optionSearchable.includes(token)) {
          score += 18;
        }
      });

      phoneTokens.forEach((token) => {
        if (optionDigits.includes(token)) {
          score += token.length >= 6 ? 24 : 10;
        }
      });

      return {
        option,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return compareOptionsByName(left.option, right.option);
    })
    .map((candidate) => candidate.option)
    .slice(0, 3);
}

function normalizeOptionValue(
  options: AttributeOption[],
  value: string | null | undefined,
): string {
  if (!value || !value.trim()) {
    return "";
  }

  const comparable = normalizeOptionComparable(value);
  for (const option of options) {
    if (normalizeOptionComparable(option.value) === comparable) {
      return option.value;
    }
    if (normalizeOptionComparable(option.label) === comparable) {
      return option.value;
    }
    if (
      option.aliases &&
      option.aliases.some((alias) => normalizeOptionComparable(alias) === comparable)
    ) {
      return option.value;
    }
  }

  return value.trim();
}

function withCurrentOption(
  options: AttributeOption[],
  currentValue: string | null | undefined,
): AttributeOption[] {
  if (!currentValue || !currentValue.trim()) {
    return options;
  }

  const comparable = normalizeOptionComparable(currentValue);
  const exists = options.some(
    (option) =>
      normalizeOptionComparable(option.value) === comparable ||
      normalizeOptionComparable(option.label) === comparable,
  );
  if (exists) {
    return options;
  }

  return [{ value: currentValue.trim(), label: currentValue.trim() }, ...options];
}

function buildTaskFixKey(task: DataQualityTask): string {
  return task.taskKey;
}

function resolveAccountIdentifier(item: DataQualityIssueRow): string {
  return item.accountRecordId?.trim() || item.accountKey.trim() || item.businessAccountId.trim();
}

function toMergeableContactCandidate(item: DataQualityIssueRow): MergeableContactCandidate {
  return {
    contactId: item.contactId,
    rowKey: item.rowKey ?? null,
    businessAccountRecordId: item.accountRecordId ?? item.accountKey,
    businessAccountId: item.businessAccountId,
    companyName: item.companyName,
    contactName: item.contactName,
    contactEmail: item.contactEmail,
    contactPhone: item.contactPhone,
    isPrimaryContact: item.isPrimaryContact,
    salesRepName: item.salesRepName,
    lastModifiedIso: null,
  };
}

export function TasksClient() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);
  const [tasksResponse, setTasksResponse] = useState<DataQualityTasksResponse | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [isRefreshingTasks, setIsRefreshingTasks] = useState(false);
  const [selectedSalesRep, setSelectedSalesRep] = useState("all");
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [accountOptions, setAccountOptions] = useState<CreateContactAccountOption[]>([]);
  const [isLoadingAccountOptions, setIsLoadingAccountOptions] = useState(false);
  const [rowFixDrafts, setRowFixDrafts] = useState<Record<string, RowFixDraft>>({});
  const [savingFixKeys, setSavingFixKeys] = useState<Record<string, boolean>>({});
  const [activeSectionIndexes, setActiveSectionIndexes] = useState<Record<string, number>>({});
  const [createContactTask, setCreateContactTask] = useState<DataQualityTask | null>(null);
  const [mergeTask, setMergeTask] = useState<DataQualityTask | null>(null);
  const [showReviewBucket, setShowReviewBucket] = useState(false);

  const loadTasks = async (refresh = false) => {
    if (refresh) {
      setIsRefreshingTasks(true);
    } else {
      setIsLoadingTasks(true);
    }
    setTasksError(null);

    try {
      const query = refresh ? "?refresh=1" : "";
      const response = await fetch(`/api/data-quality/tasks${query}`, {
        cache: "no-store",
      });
      const payload = await readJsonResponse<DataQualityTasksResponse | ErrorPayload>(response);

      if (!response.ok || !isTasksResponse(payload)) {
        throw new Error(parseError(payload as ErrorPayload | null));
      }

      setTasksResponse(payload);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Unable to load tasks.");
    } finally {
      setIsLoadingTasks(false);
      setIsRefreshingTasks(false);
    }
  };

  const loadEmployees = useEffectEvent(async () => {
    if (isLoadingEmployees || employeeOptions.length > 0) {
      return;
    }

    setIsLoadingEmployees(true);
    try {
      const response = await fetch("/api/employees", { cache: "no-store" });
      const payload = await readJsonResponse<EmployeeLookupResponse | ErrorPayload>(response);

      if (!response.ok || !isEmployeeLookupResponse(payload)) {
        throw new Error(parseError(payload as ErrorPayload | null));
      }

      setEmployeeOptions(payload.items);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Unable to load sales reps.");
    } finally {
      setIsLoadingEmployees(false);
    }
  });

  const loadAccountOptions = useEffectEvent(async () => {
    if (isLoadingAccountOptions || accountOptions.length > 0) {
      return;
    }

    setIsLoadingAccountOptions(true);
    try {
      const response = await fetch("/api/business-accounts?full=1&page=1&pageSize=1", {
        cache: "no-store",
      });
      const payload = await readJsonResponse<BusinessAccountsResponse | ErrorPayload>(response);

      if (!response.ok || !isBusinessAccountsResponse(payload)) {
        throw new Error(parseError(payload as ErrorPayload | null));
      }

      setAccountOptions(buildCreateContactAccountOptions(payload.items));
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Unable to load business accounts.");
    } finally {
      setIsLoadingAccountOptions(false);
    }
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = await readJsonResponse<SessionResponse | ErrorPayload>(response);

        if (!response.ok || !isSessionResponse(payload)) {
          throw new Error(parseError(payload as ErrorPayload | null));
        }

        if (!cancelled) {
          setSession(payload);
          setSessionWarning(payload.authenticated ? null : "Your session has expired. Sign in again.");
        }
      } catch (error) {
        if (!cancelled) {
          setSessionWarning(error instanceof Error ? error.message : "Unable to load session.");
        }
      }
    }

    void loadSession();
    void loadTasks();
    void loadEmployees();

    const intervalId = window.setInterval(() => {
      void loadTasks();
    }, LIVE_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!tasksResponse) {
      return;
    }

    if (
      tasksResponse.tasks.some(
        (task) => task.metric === "missingCompany" || task.metric === "missingContact",
      )
    ) {
      void loadAccountOptions();
    }
  }, [tasksResponse]);

  useEffect(() => {
    if (
      !tasksResponse ||
      selectedSalesRep === "all" ||
      tasksResponse.reps.some((rep) => rep.salesRepName === selectedSalesRep)
    ) {
      return;
    }

    setSelectedSalesRep("all");
  }, [selectedSalesRep, tasksResponse]);

  const filteredTasks = useMemo(() => {
    if (!tasksResponse) {
      return [] as DataQualityTask[];
    }

    if (selectedSalesRep === "all") {
      return tasksResponse.tasks;
    }

    return tasksResponse.tasks.filter((task) => task.assigneeName === selectedSalesRep);
  }, [selectedSalesRep, tasksResponse]);

  const filteredActionableTasks = useMemo(
    () => filteredTasks.filter((task) => task.actionable),
    [filteredTasks],
  );

  const filteredReviewTasks = useMemo(
    () => filteredTasks.filter((task) => !task.actionable),
    [filteredTasks],
  );

  const groupedTasks = useMemo(() => {
    const tasksByMetric = filteredActionableTasks.reduce<Map<DataQualityMetricKey, DataQualityTask[]>>(
      (groups, task) => {
        const existing = groups.get(task.metric) ?? [];
        existing.push(task);
        groups.set(task.metric, existing);
        return groups;
      },
      new Map(),
    );

    const grouped = TASK_GROUP_DEFINITIONS.flatMap<TaskGroupSection>((group) => {
      const sections = group.sections
        .map((section) => ({
          ...section,
          items: tasksByMetric.get(section.metric) ?? [],
        }))
        .filter((section) => section.items.length > 0);

      if (sections.length === 0) {
        return [];
      }

      return [
        {
          key: group.key,
          label: group.label,
          description: group.description,
          total: sections.reduce((count, section) => count + section.items.length, 0),
          sections,
        },
      ];
    });

    const uncategorizedSections = [...tasksByMetric.entries()]
      .filter(([metric]) => !GROUPED_METRICS.has(metric))
      .map(([metric, items]) => ({
        metric,
        label: items[0]?.metricLabel ?? metric,
        items,
      }));

    if (uncategorizedSections.length > 0) {
      grouped.push({
        key: "other",
        label: "Other Issues",
        description: "Issue types that do not belong to one of the main work buckets yet.",
        total: uncategorizedSections.reduce((count, section) => count + section.items.length, 0),
        sections: uncategorizedSections,
      });
    }

    return grouped;
  }, [filteredActionableTasks]);

  const highPriorityCount = useMemo(
    () => filteredActionableTasks.filter((task) => task.priority === "high").length,
    [filteredActionableTasks],
  );

  const directActionCount = useMemo(
    () =>
      filteredActionableTasks.filter((task) =>
        [
          "missingCompany",
          "missingContact",
          "invalidPhone",
          "missingContactEmail",
          "missingSalesRep",
          "missingCategory",
          "missingRegion",
          "missingSubCategory",
          "missingIndustry",
          "duplicateContact",
          "duplicateBusinessAccount",
        ].includes(task.metric),
      ).length,
    [filteredActionableTasks],
  );

  const unassignedCount = useMemo(
    () => filteredActionableTasks.filter((task) => task.assigneeName === "Unassigned").length,
    [filteredActionableTasks],
  );

  function getTaskFixDraft(task: DataQualityTask): RowFixDraft {
    const key = buildTaskFixKey(task);
    const existing = rowFixDrafts[key];
    if (existing) {
      return existing;
    }

    const matchedSalesRep =
      employeeOptions.find(
        (option) =>
          normalizeOptionComparable(option.name) ===
          normalizeOptionComparable(task.issue.salesRepName ?? ""),
      ) ?? null;

    const rawPhone = task.issue.rawContactPhone ?? task.issue.contactPhone ?? "";
    const parsedPhone = parsePhoneWithExtension(rawPhone);

    return {
      accountSearchTerm: "",
      selectedAccountRecordId: "",
      companyName: task.issue.companyName || "",
      salesRepId: matchedSalesRep?.id ?? "",
      category: normalizeOptionValue(CATEGORY_OPTIONS, task.issue.category),
      companyRegion: normalizeOptionValue(COMPANY_REGION_OPTIONS, task.issue.companyRegion),
      subCategory: normalizeOptionValue(SUB_CATEGORY_OPTIONS, task.issue.subCategory),
      industryType: normalizeOptionValue(INDUSTRY_TYPE_OPTIONS, task.issue.industryType),
      primaryContactPhone:
        parsedPhone.kind === "phone_with_extension"
          ? parsedPhone.phone
          : task.issue.contactPhone ?? rawPhone,
      primaryContactExtension:
        parsedPhone.kind === "phone_with_extension"
          ? parsedPhone.extension
          : task.issue.contactExtension ?? "",
      primaryContactEmail: task.issue.contactEmail ?? "",
    };
  }

  function updateTaskFixDraft(
    taskKey: string,
    updater: (current: RowFixDraft) => RowFixDraft,
    seed: RowFixDraft,
  ) {
    setRowFixDrafts((current) => {
      const base = current[taskKey] ?? seed;
      return {
        ...current,
        [taskKey]: updater(base),
      };
    });
  }

  function readActiveSectionIndex(sectionKey: string, total: number): number {
    const current = activeSectionIndexes[sectionKey] ?? 0;
    if (total <= 0) {
      return 0;
    }

    return Math.min(Math.max(current, 0), total - 1);
  }

  function setActiveSectionIndex(sectionKey: string, index: number) {
    setActiveSectionIndexes((current) => ({
      ...current,
      [sectionKey]: Math.max(0, index),
    }));
  }

  async function recordFixedIssues(issueKeys: string[]) {
    const filtered = [...new Set(issueKeys.map((value) => value.trim()).filter(Boolean))];
    if (!filtered.length) {
      return;
    }

    const response = await fetch("/api/data-quality/fixes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        issueKeys: filtered,
      }),
    });
    const payload = await readJsonResponse<ErrorPayload>(response);
    if (!response.ok) {
      throw new Error(parseError(payload));
    }
  }

  function buildUpdatePayloadFromRow(
    sourceRow: BusinessAccountRow,
    overrides: Partial<BusinessAccountUpdateRequest>,
  ): BusinessAccountUpdateRequest {
    return {
      companyName: sourceRow.companyName,
      assignedBusinessAccountRecordId:
        sourceRow.businessAccountId.trim().length > 0
          ? (sourceRow.accountRecordId ?? sourceRow.id)
          : null,
      assignedBusinessAccountId: sourceRow.businessAccountId.trim() || null,
      addressLine1: sourceRow.addressLine1,
      addressLine2: sourceRow.addressLine2,
      city: sourceRow.city,
      state: sourceRow.state,
      postalCode: sourceRow.postalCode,
      country: sourceRow.country,
      targetContactId: sourceRow.contactId ?? sourceRow.primaryContactId ?? null,
      setAsPrimaryContact: false,
      primaryOnlyIntent: false,
      contactOnlyIntent: false,
      salesRepId: sourceRow.salesRepId ?? null,
      salesRepName: sourceRow.salesRepName ?? null,
      industryType: sourceRow.industryType ?? null,
      subCategory: sourceRow.subCategory ?? null,
      companyRegion: sourceRow.companyRegion ?? null,
      week: sourceRow.week ?? null,
      companyPhone: sourceRow.companyPhone ?? null,
      primaryContactName: sourceRow.primaryContactName ?? null,
      primaryContactPhone: sourceRow.primaryContactPhone ?? null,
      primaryContactExtension: sourceRow.primaryContactExtension ?? null,
      primaryContactEmail: sourceRow.primaryContactEmail ?? null,
      category: sourceRow.category ?? null,
      notes: sourceRow.notes ?? null,
      expectedLastModified: sourceRow.lastModifiedIso ?? null,
      ...overrides,
    };
  }

  async function fetchIssueAccountRow(item: DataQualityIssueRow): Promise<BusinessAccountRow> {
    const identifier = resolveAccountIdentifier(item);
    if (!identifier) {
      throw new Error("Missing account identifier.");
    }

    const detailUrl = new URL(
      `/api/business-accounts/${encodeURIComponent(identifier)}`,
      window.location.origin,
    );
    if (item.contactId !== null) {
      detailUrl.searchParams.set("contactId", String(item.contactId));
    }

    const response = await fetch(`${detailUrl.pathname}${detailUrl.search}`, {
      cache: "no-store",
    });
    const payload = await readJsonResponse<BusinessAccountDetailResponse | BusinessAccountRow | ErrorPayload>(
      response,
    );

    if (!response.ok) {
      throw new Error(parseError(payload as ErrorPayload | null));
    }

    const row = readDetailResponseRow(payload);
    if (!row) {
      throw new Error("Unable to load latest account details for update.");
    }

    return row;
  }

  async function handleSaveTask(task: DataQualityTask) {
    const fixKey = buildTaskFixKey(task);
    if (savingFixKeys[fixKey]) {
      return;
    }

    const draft = getTaskFixDraft(task);
    const payloadOverrides: Partial<BusinessAccountUpdateRequest> = {};

    if (task.metric === "missingCompany") {
      const selectedAccount =
        accountOptions.find(
          (option) => option.businessAccountRecordId === draft.selectedAccountRecordId,
        ) ?? null;
      if (!selectedAccount) {
        setTasksError("Select the business account this contact belongs to.");
        return;
      }

      payloadOverrides.companyName = selectedAccount.companyName;
      payloadOverrides.assignedBusinessAccountRecordId =
        selectedAccount.businessAccountRecordId;
      payloadOverrides.assignedBusinessAccountId = selectedAccount.businessAccountId;
    } else if (task.metric === "missingSalesRep") {
      const selectedEmployee =
        employeeOptions.find((option) => option.id === draft.salesRepId) ?? null;
      if (!selectedEmployee) {
        setTasksError("Select a valid sales rep before saving.");
        return;
      }

      payloadOverrides.salesRepId = selectedEmployee.id;
      payloadOverrides.salesRepName = selectedEmployee.name;
    } else if (task.metric === "missingCategory") {
      payloadOverrides.category = (draft.category || null) as Category | null;
    } else if (task.metric === "missingRegion") {
      payloadOverrides.companyRegion = draft.companyRegion || null;
    } else if (task.metric === "missingSubCategory") {
      payloadOverrides.subCategory = draft.subCategory || null;
    } else if (task.metric === "missingIndustry") {
      payloadOverrides.industryType = draft.industryType || null;
    } else if (task.metric === "invalidPhone") {
      payloadOverrides.contactOnlyIntent = true;
      const trimmedPhone = draft.primaryContactPhone.trim();
      const trimmedExtension = draft.primaryContactExtension.trim();
      if (trimmedPhone.length === 0) {
        payloadOverrides.primaryContactPhone = null;
        payloadOverrides.primaryContactExtension = null;
      } else {
        const normalizedPhone = normalizePhoneForSave(trimmedPhone);
        if (normalizedPhone === null) {
          setTasksError("Phone number must use the format ###-###-####.");
          return;
        }
        if (normalizedPhone.startsWith("111-")) {
          setTasksError("Phone numbers starting with 111 are not allowed.");
          return;
        }
        payloadOverrides.primaryContactPhone = normalizedPhone;
        if (!trimmedExtension) {
          payloadOverrides.primaryContactExtension = null;
        } else {
          const normalizedExtension = normalizeExtensionForSave(trimmedExtension);
          if (!normalizedExtension || normalizedExtension.length > 5) {
            setTasksError("Extension must use 1 to 5 digits.");
            return;
          }
          payloadOverrides.primaryContactExtension = normalizedExtension;
        }
      }
    } else if (task.metric === "missingContactEmail") {
      payloadOverrides.contactOnlyIntent = true;
      const email = draft.primaryContactEmail.trim();
      if (!email) {
        setTasksError("Email address is required.");
        return;
      }
      payloadOverrides.primaryContactEmail = email;
    } else if (task.metric === "duplicateBusinessAccount") {
      const companyName = draft.companyName.trim();
      if (companyName.length <= 2) {
        setTasksError("Company name must be longer than 2 characters.");
        return;
      }
      payloadOverrides.companyName = companyName;
    } else {
      return;
    }

    setSavingFixKeys((current) => ({
      ...current,
      [fixKey]: true,
    }));
    setTasksError(null);
    setSaveNotice(null);

    try {
      const targetIssues =
        task.metric === "missingCompany" && task.relatedIssues?.length
          ? task.relatedIssues
          : [task.issue];

      for (const issue of targetIssues) {
        const identifier = resolveAccountIdentifier(issue);
        const isContactOnlyMetric =
          task.metric === "invalidPhone" || task.metric === "missingContactEmail";
        const updatePayload = isContactOnlyMetric
          ? {
              targetContactId: issue.contactId,
              contactOnlyIntent: true,
              ...(Object.prototype.hasOwnProperty.call(payloadOverrides, "primaryContactPhone")
                ? { primaryContactPhone: payloadOverrides.primaryContactPhone ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(payloadOverrides, "primaryContactExtension")
                ? { primaryContactExtension: payloadOverrides.primaryContactExtension ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(payloadOverrides, "primaryContactEmail")
                ? { primaryContactEmail: payloadOverrides.primaryContactEmail ?? null }
                : {}),
            }
          : (() => {
              const latestRowPromise = fetchIssueAccountRow(issue);
              return latestRowPromise.then((latestRow) =>
                buildUpdatePayloadFromRow(latestRow, {
                  ...payloadOverrides,
                  targetContactId:
                    issue.contactId ?? latestRow.contactId ?? latestRow.primaryContactId ?? null,
                }),
              );
            })();

        const response = await fetch(`/api/business-accounts/${encodeURIComponent(identifier)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(await updatePayload),
        });
        const payload = await readJsonResponse<BusinessAccountRow | ErrorPayload>(response);

        if (!response.ok) {
          throw new Error(parseError(payload as ErrorPayload | null));
        }

        if (!isBusinessAccountRow(payload)) {
          throw new Error("Unexpected save response.");
        }
      }

      await recordFixedIssues(
        targetIssues.map(
          (issue) => issue.issueKey ?? buildDataQualityIssueKey(task.metric, task.basis, issue),
        ),
      );
      setSaveNotice(`${task.title} updated.`);
      await loadTasks(true);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "Failed to save task.");
    } finally {
      setSavingFixKeys((current) => {
        const next = { ...current };
        delete next[fixKey];
        return next;
      });
    }
  }

  async function handleRefreshNow() {
    await loadTasks(true);
  }

  function handleContactCreated(
    result:
      | BusinessAccountContactCreateResponse
      | BusinessAccountContactCreatePartialResponse,
  ) {
    const activeTask = createContactTask;
    if (result.created === true) {
      setSaveNotice("Contact created.");
    }

    void (async () => {
      try {
        if (activeTask && result.created === true) {
          await recordFixedIssues([
            activeTask.issue.issueKey ??
              buildDataQualityIssueKey(activeTask.metric, activeTask.basis, activeTask.issue),
          ]);
        }
      } catch (error) {
        setTasksError(
          error instanceof Error ? error.message : "Contact was created but fix history failed.",
        );
      }
      await loadTasks(true);
    })();
  }

  function handleMergeCompleted(result: ContactMergeResponse) {
    const activeTask = mergeTask;
    setMergeTask(null);
    setSaveNotice(
      "queued" in result
        ? `Contact merge queued. ${result.deletedContactIds.length} contact${
            result.deletedContactIds.length === 1 ? "" : "s"
          } hidden until the scheduled merge runs${
            result.setKeptAsPrimary ? ". Primary contact will update when it executes." : "."
          }`
        : `Contact merge completed. ${result.deletedContactIds.length} contact${
            result.deletedContactIds.length === 1 ? "" : "s"
          } deleted${result.setKeptAsPrimary ? ". Primary contact updated." : "."}`,
    );

    void (async () => {
      try {
        const issueKeys =
          activeTask?.relatedIssues
            ?.map(
              (issue) =>
                issue.issueKey ??
                buildDataQualityIssueKey(activeTask.metric, activeTask.basis, issue),
            )
            .filter((value): value is string => Boolean(value && value.trim())) ?? [];
        await recordFixedIssues(issueKeys);
      } catch (error) {
        setTasksError(
          error instanceof Error ? error.message : "Merged the contacts but fix history failed.",
        );
      }
      await loadTasks(true);
    })();
  }

  function renderTaskDetails(task: DataQualityTask) {
    if (task.metric === "missingCompany") {
      const infoRows = task.actionable
        ? buildCompanyAssignmentInfoRows(task)
        : buildReviewInfoRows(task);

      return (
        <div className={styles.companyAssignmentBlock}>
          {task.companyAssignmentContext?.clueBadges.length ? (
            <div className={styles.badgeRow}>
              {task.companyAssignmentContext.clueBadges.map((badge) => (
                <span className={styles.clueBadge} key={badge}>
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
          <dl className={styles.compactDetailList}>
            {infoRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }

    return (
      <dl className={styles.metaGrid}>
        <div>
          <dt>Sales Rep</dt>
          <dd>{task.assigneeName}</dd>
        </div>
        <div>
          <dt>Company</dt>
          <dd>{formatText(task.issue.companyName, "Unassigned company")}</dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>{formatText(task.issue.contactName)}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{formatText(task.issue.contactEmail)}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd className={styles.taskPhoneRow}>
            <span>{formatText(task.issue.contactPhone)}</span>
            <CallPhoneButton
              label={`${task.issue.contactName ?? task.issue.companyName ?? "Contact"} phone`}
              phone={task.issue.contactPhone}
              context={{
                sourcePage: "tasks",
                linkedBusinessAccountId: task.issue.businessAccountId,
                linkedAccountRowKey: task.issue.rowKey,
                linkedContactId: task.issue.contactId,
                linkedCompanyName: task.issue.companyName,
                linkedContactName: task.issue.contactName,
              }}
            />
          </dd>
        </div>
        <div>
          <dt>Affected Records</dt>
          <dd>{task.affectedCount.toLocaleString()}</dd>
        </div>
        <div className={styles.metaWide}>
          <dt>Address</dt>
          <dd>{formatText(task.issue.address)}</dd>
        </div>
      </dl>
    );
  }

  function renderTaskEditor(task: DataQualityTask) {
    const fixKey = buildTaskFixKey(task);
    const draft = getTaskFixDraft(task);
    const savingFix = Boolean(savingFixKeys[fixKey]);
    const companyRegionOptions = withCurrentOption(
      COMPANY_REGION_OPTIONS,
      draft.companyRegion || task.issue.companyRegion,
    );
    const subCategoryOptions = withCurrentOption(
      SUB_CATEGORY_OPTIONS,
      draft.subCategory || task.issue.subCategory,
    );
    const industryTypeOptions = withCurrentOption(
      INDUSTRY_TYPE_OPTIONS,
      draft.industryType || task.issue.industryType,
    );
    const trimmedAccountSearch = draft.accountSearchTerm.trim().toLowerCase();
    const shouldSearchAccounts = trimmedAccountSearch.length >= 2;
    const filteredAccountOptions = shouldSearchAccounts
      ? accountOptions
          .filter((option) =>
            [option.companyName, option.businessAccountId, option.address]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(trimmedAccountSearch),
          )
          .slice(0, 5)
      : [];
    const selectedAccountOption =
      accountOptions.find(
        (option) => option.businessAccountRecordId === draft.selectedAccountRecordId,
      ) ?? null;
    const suggestedAccountOptions =
      selectedAccountOption || shouldSearchAccounts
        ? []
        : buildSuggestedAccountOptions(task, accountOptions);

    if (task.metric === "missingCompany") {
      if (!task.actionable) {
        return (
          <div className={styles.editorBlock}>
            <p className={styles.inlineHint}>
              This record is in review because it does not include enough identity information to assign safely.
            </p>
            {resolveAccountIdentifier(task.issue) ? (
              <Link className={styles.secondaryButton} href="/accounts">
                Open in Accounts
              </Link>
            ) : null}
          </div>
        );
      }

      return (
        <div className={styles.editorBlock}>
          {selectedAccountOption ? (
            <div className={styles.selectedOptionCard}>
              <strong>{selectedAccountOption.companyName}</strong>
              <span>{selectedAccountOption.businessAccountId}</span>
              <span>{selectedAccountOption.address}</span>
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  updateTaskFixDraft(
                    fixKey,
                    (current) => ({
                      ...current,
                      accountSearchTerm: "",
                      selectedAccountRecordId: "",
                    }),
                    draft,
                  );
                }}
                type="button"
              >
                Change selection
              </button>
            </div>
          ) : suggestedAccountOptions.length > 0 ? (
            <div className={styles.suggestionSection}>
              <p className={styles.inlineLabel}>Suggested companies</p>
              <div className={styles.suggestionList}>
                {suggestedAccountOptions.map((option) => (
                  <button
                    className={styles.suggestionItem}
                    key={option.businessAccountRecordId}
                    onClick={() => {
                      updateTaskFixDraft(
                        fixKey,
                        (current) => ({
                          ...current,
                          accountSearchTerm: option.companyName,
                          selectedAccountRecordId: option.businessAccountRecordId,
                        }),
                        draft,
                      );
                    }}
                    type="button"
                  >
                    <span className={styles.suggestionTitle}>{option.companyName}</span>
                    <span className={styles.suggestionMeta}>{option.businessAccountId}</span>
                    <span className={styles.suggestionMeta}>{option.address}</span>
                  </button>
                ))}
              </div>
              <p className={styles.inlineHint}>If the right company is not here, search for it below.</p>
            </div>
          ) : null}
          <label className={styles.editorLabel}>
            Search another company
            <input
              className={styles.editorInput}
              onChange={(event) => {
                updateTaskFixDraft(
                  fixKey,
                  (current) => ({
                    ...current,
                    accountSearchTerm: event.target.value,
                    selectedAccountRecordId: "",
                  }),
                  draft,
                );
              }}
              placeholder="Search another company"
              value={selectedAccountOption ? selectedAccountOption.companyName : draft.accountSearchTerm}
            />
          </label>
          {shouldSearchAccounts && filteredAccountOptions.length > 0 ? (
            <div className={styles.suggestionList}>
              {filteredAccountOptions.map((option) => (
                <button
                  className={styles.suggestionItem}
                  key={option.businessAccountRecordId}
                  onClick={() => {
                    updateTaskFixDraft(
                      fixKey,
                      (current) => ({
                        ...current,
                        accountSearchTerm: option.companyName,
                        selectedAccountRecordId: option.businessAccountRecordId,
                      }),
                      draft,
                    );
                  }}
                  type="button"
                >
                  <span className={styles.suggestionTitle}>{option.companyName}</span>
                  <span className={styles.suggestionMeta}>{option.businessAccountId}</span>
                  <span className={styles.suggestionMeta}>{option.address}</span>
                  </button>
                ))}
              </div>
            ) : shouldSearchAccounts ? (
            <p className={styles.inlineHint}>No matching business accounts found.</p>
          ) : (
            <p className={styles.inlineHint}>
              Start typing if you need to search for a different company.
            </p>
          )}
          {accountOptions.length === 0 ? (
            <p className={styles.inlineHint}>
              {isLoadingAccountOptions ? "Loading business accounts..." : "No business accounts loaded."}
            </p>
          ) : null}
          <button
            className={styles.primaryButton}
            disabled={savingFix || !selectedAccountOption}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix
              ? "Saving..."
              : selectedAccountOption
                ? "Assign to selected company"
                : "Choose a company first"}
          </button>
        </div>
      );
    }

    if (task.metric === "missingContact") {
      return (
        <div className={styles.editorBlock}>
          <p className={styles.inlineHint}>
            This company needs a primary contact. Create it here and the task will clear after save.
          </p>
          <p className={styles.inlineHint}>
            {isLoadingAccountOptions
              ? "Loading account details..."
              : accountOptions.length === 0
                ? "Business accounts are not loaded yet."
                : "The contact form will open on this page."}
          </p>
          <button
            className={styles.primaryButton}
            disabled={isLoadingAccountOptions || accountOptions.length === 0}
            onClick={() => {
              setCreateContactTask(task);
            }}
            type="button"
          >
            Add contact
          </button>
        </div>
      );
    }

    if (task.metric === "duplicateContact") {
      const mergeReady =
        Array.isArray(task.relatedIssues) &&
        task.relatedIssues.length >= 2 &&
        task.relatedIssues.every((issue) => issue.contactId !== null);

      return (
        <div className={styles.editorBlock}>
          <p className={styles.inlineHint}>
            {mergeReady
              ? "This duplicate pair can be merged directly here."
              : "This duplicate set needs review before it can be merged here."}
          </p>
          <button
            className={styles.primaryButton}
            disabled={!mergeReady}
            onClick={() => {
              if (mergeReady) {
                setMergeTask(task);
              }
            }}
            type="button"
          >
            Merge contacts
          </button>
        </div>
      );
    }

    if (task.metric === "missingSalesRep") {
      return (
        <div className={styles.inlineControlRow}>
          <select
            className={styles.editorSelect}
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  salesRepId: event.target.value,
                }),
                draft,
              );
            }}
            value={draft.salesRepId}
          >
            <option value="">
              {isLoadingEmployees ? "Loading sales reps..." : "Select sales rep"}
            </option>
            {employeeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <button
            className={styles.primaryButton}
            disabled={savingFix || !draft.salesRepId || isLoadingEmployees}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save sales rep"}
          </button>
        </div>
      );
    }

    if (task.metric === "missingCategory") {
      return (
        <div className={styles.inlineControlRow}>
          <select
            className={styles.editorSelect}
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  category: event.target.value,
                }),
                draft,
              );
            }}
            value={draft.category}
          >
            <option value="">Unassigned</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className={styles.primaryButton}
            disabled={savingFix}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save category"}
          </button>
        </div>
      );
    }

    if (task.metric === "missingRegion") {
      return (
        <div className={styles.inlineControlRow}>
          <select
            className={styles.editorSelect}
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  companyRegion: event.target.value,
                }),
                draft,
              );
            }}
            value={draft.companyRegion}
          >
            <option value="">Unassigned</option>
            {companyRegionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className={styles.primaryButton}
            disabled={savingFix}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save region"}
          </button>
        </div>
      );
    }

    if (task.metric === "missingSubCategory") {
      return (
        <div className={styles.inlineControlRow}>
          <select
            className={styles.editorSelect}
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  subCategory: event.target.value,
                }),
                draft,
              );
            }}
            value={draft.subCategory}
          >
            <option value="">Unassigned</option>
            {subCategoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className={styles.primaryButton}
            disabled={savingFix}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save sub-category"}
          </button>
        </div>
      );
    }

    if (task.metric === "missingIndustry") {
      return (
        <div className={styles.inlineControlRow}>
          <select
            className={styles.editorSelect}
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  industryType: event.target.value,
                }),
                draft,
              );
            }}
            value={draft.industryType}
          >
            <option value="">Unassigned</option>
            {industryTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className={styles.primaryButton}
            disabled={savingFix}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save industry"}
          </button>
        </div>
      );
    }

    if (task.metric === "invalidPhone") {
      return (
        <div className={styles.inlineControlRow}>
          <input
            className={styles.editorInput}
            inputMode="numeric"
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  primaryContactPhone: formatPhoneDraftValue(event.target.value),
                }),
                draft,
              );
            }}
            placeholder="###-###-####"
            value={draft.primaryContactPhone}
          />
          <input
            className={styles.editorInput}
            inputMode="numeric"
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  primaryContactExtension: event.target.value.replace(/\D/g, "").slice(0, 5),
                }),
                draft,
              );
            }}
            placeholder="Extension"
            value={draft.primaryContactExtension}
          />
          <button
            className={styles.primaryButton}
            disabled={savingFix}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save phone"}
          </button>
        </div>
      );
    }

    if (task.metric === "missingContactEmail") {
      return (
        <div className={styles.inlineControlRow}>
          <input
            className={styles.editorInput}
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  primaryContactEmail: event.target.value,
                }),
                draft,
              );
            }}
            placeholder="Email address"
            type="email"
            value={draft.primaryContactEmail}
          />
          <button
            className={styles.primaryButton}
            disabled={savingFix || !draft.primaryContactEmail.trim()}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save email"}
          </button>
        </div>
      );
    }

    if (task.metric === "duplicateBusinessAccount") {
      return (
        <div className={styles.inlineControlRow}>
          <input
            className={styles.editorInput}
            onChange={(event) => {
              updateTaskFixDraft(
                fixKey,
                (current) => ({
                  ...current,
                  companyName: event.target.value,
                }),
                draft,
              );
            }}
            placeholder="Normalized company name"
            value={draft.companyName}
          />
          <button
            className={styles.primaryButton}
            disabled={savingFix}
            onClick={() => {
              void handleSaveTask(task);
            }}
            type="button"
          >
            {savingFix ? "Saving..." : "Save company name"}
          </button>
        </div>
      );
    }

    return (
      <div className={styles.editorBlock}>
        <p className={styles.inlineHint}>No inline fix is available for this task yet.</p>
      </div>
    );
  }

  return (
    <AppChrome
      contentClassName={styles.pageContent}
      headerActions={
        <button
          className={styles.secondaryButton}
          disabled={isRefreshingTasks}
          onClick={() => {
            void handleRefreshNow();
          }}
          type="button"
        >
          {isRefreshingTasks ? "Refreshing..." : "Refresh now"}
        </button>
      }
      subtitle="Filter by sales rep, see exactly what is wrong, and fix the supported issues directly from this page."
      title="Tasks"
      userName={session?.user?.name ?? "Signed in"}
    >

      {sessionWarning ? <p className={styles.warning}>{sessionWarning}</p> : null}
      {tasksError ? <p className={styles.warning}>{tasksError}</p> : null}
      {saveNotice ? <p className={styles.success}>{saveNotice}</p> : null}

      <section className={styles.statusBar}>
        <span className={styles.stateTag}>{tasksResponse ? "Inline task queue" : "Loading queue"}</span>
        <span>Last computed: {formatDateTime(tasksResponse?.computedAtIso)}</span>
        <span>Open tasks: {filteredActionableTasks.length.toLocaleString()}</span>
        <span>Needs review: {filteredReviewTasks.length.toLocaleString()}</span>
      </section>

      <section className={styles.filtersCard}>
        <label className={styles.filterField}>
          Sales Rep
          <select
            className={styles.filterSelect}
            onChange={(event) => setSelectedSalesRep(event.target.value)}
            value={selectedSalesRep}
          >
            <option value="all">
              All reps ({tasksResponse?.total.toLocaleString() ?? "0"})
            </option>
            {tasksResponse?.reps.map((rep) => (
              <option key={rep.salesRepName} value={rep.salesRepName}>
                {rep.salesRepName} ({rep.openTasks})
              </option>
            )) ?? null}
          </select>
        </label>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <small>Open Tasks</small>
          <strong>{filteredActionableTasks.length.toLocaleString()}</strong>
        </article>
        <article className={styles.summaryCard}>
          <small>High Priority</small>
          <strong>{highPriorityCount.toLocaleString()}</strong>
        </article>
        <article className={styles.summaryCard}>
          <small>Direct Fixes</small>
          <strong>{directActionCount.toLocaleString()}</strong>
        </article>
        <article className={styles.summaryCard}>
          <small>Unassigned</small>
          <strong>{unassignedCount.toLocaleString()}</strong>
        </article>
        <article className={styles.summaryCard}>
          <small>Needs Review</small>
          <strong>{filteredReviewTasks.length.toLocaleString()}</strong>
        </article>
      </section>

      {isLoadingTasks && !tasksResponse ? (
        <section className={styles.emptyState}>
          <p>Loading tasks...</p>
        </section>
      ) : groupedTasks.length === 0 && filteredReviewTasks.length === 0 ? (
        <section className={styles.emptyState}>
          <p>No tasks match the selected sales rep.</p>
        </section>
      ) : (
        <section className={styles.taskSections}>
          {groupedTasks.map((group) => (
            <article className={styles.taskGroup} key={group.key}>
              <header className={styles.taskGroupHeader}>
                <div>
                  <h2>{group.label}</h2>
                  <p>{group.description}</p>
                </div>
                <strong className={styles.groupCount}>{group.total} open tasks</strong>
              </header>

              <div className={styles.taskSubgroups}>
                {group.sections.map((section) => {
                  const activeIndex = readActiveSectionIndex(section.metric, section.items.length);
                  const activeTask = section.items[activeIndex];
                  if (!activeTask) {
                    return null;
                  }

                  return (
                    <section className={styles.taskSubgroup} key={section.metric}>
                      <header className={styles.taskSubgroupHeader}>
                        <div>
                          <h3>{section.label}</h3>
                          <p>{section.items.length} open tasks</p>
                        </div>
                        {section.items.length > 1 ? (
                          <div className={styles.queueControls}>
                            <span className={styles.queueStatus}>
                              Showing {activeIndex + 1} of {section.items.length}
                            </span>
                            <div className={styles.queueButtons}>
                              <button
                                className={styles.secondaryButton}
                                disabled={activeIndex === 0}
                                onClick={() => {
                                  setActiveSectionIndex(section.metric, activeIndex - 1);
                                }}
                                type="button"
                              >
                                Previous
                              </button>
                              <button
                                className={styles.secondaryButton}
                                disabled={activeIndex >= section.items.length - 1}
                                onClick={() => {
                                  setActiveSectionIndex(section.metric, activeIndex + 1);
                                }}
                                type="button"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </header>

                      <div className={styles.taskList}>
                        <article className={styles.taskCard} key={activeTask.taskKey}>
                          <div className={styles.taskCardHeader}>
                            <div className={styles.badgeRow}>
                              <span className={`${styles.priorityBadge} ${getPriorityClassName(activeTask.priority)}`}>
                                {activeTask.priority} priority
                              </span>
                              {activeTask.affectedCount > 1 ? (
                                <span className={styles.countBadge}>
                                  {activeTask.affectedCount} matching rows
                                </span>
                              ) : null}
                            </div>
                            <h3>{activeTask.title}</h3>
                            <p>{activeTask.summary}</p>
                          </div>

                          {renderTaskDetails(activeTask)}

                          <div className={styles.fixNowBlock}>{renderTaskEditor(activeTask)}</div>
                        </article>
                      </div>
                    </section>
                  );
                })}
              </div>
            </article>
          ))}

          {filteredReviewTasks.length > 0 ? (
            <article className={styles.taskGroup}>
              <header className={styles.taskGroupHeader}>
                <div>
                  <h2>Needs review</h2>
                  <p>Records with too little information to assign safely.</p>
                </div>
                <div className={styles.reviewHeaderActions}>
                  <strong className={styles.groupCount}>
                    {filteredReviewTasks.length} review item{filteredReviewTasks.length === 1 ? "" : "s"}
                  </strong>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setShowReviewBucket((current) => !current)}
                    type="button"
                  >
                    {showReviewBucket ? "Hide review items" : "Show review items"}
                  </button>
                </div>
              </header>

              {showReviewBucket ? (() => {
                const reviewKey = "needs-review";
                const activeIndex = readActiveSectionIndex(reviewKey, filteredReviewTasks.length);
                const activeTask = filteredReviewTasks[activeIndex];
                if (!activeTask) {
                  return null;
                }

                return (
                  <section className={styles.taskSubgroup}>
                    <header className={styles.taskSubgroupHeader}>
                      <div>
                        <h3>Company Assignment Review</h3>
                        <p>{filteredReviewTasks.length} records need manual review</p>
                      </div>
                      {filteredReviewTasks.length > 1 ? (
                        <div className={styles.queueControls}>
                          <span className={styles.queueStatus}>
                            Showing {activeIndex + 1} of {filteredReviewTasks.length}
                          </span>
                          <div className={styles.queueButtons}>
                            <button
                              className={styles.secondaryButton}
                              disabled={activeIndex === 0}
                              onClick={() => {
                                setActiveSectionIndex(reviewKey, activeIndex - 1);
                              }}
                              type="button"
                            >
                              Previous
                            </button>
                            <button
                              className={styles.secondaryButton}
                              disabled={activeIndex >= filteredReviewTasks.length - 1}
                              onClick={() => {
                                setActiveSectionIndex(reviewKey, activeIndex + 1);
                              }}
                              type="button"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </header>

                    <div className={styles.taskList}>
                      <article className={styles.taskCard} key={activeTask.taskKey}>
                        <div className={styles.taskCardHeader}>
                          <div className={styles.badgeRow}>
                            <span className={`${styles.priorityBadge} ${getPriorityClassName(activeTask.priority)}`}>
                              {activeTask.priority} priority
                            </span>
                            <span className={styles.reviewReasonBadge}>Missing identity</span>
                          </div>
                          <h3>{activeTask.title}</h3>
                          <p>{activeTask.summary}</p>
                        </div>

                        {renderTaskDetails(activeTask)}

                        <div className={styles.fixNowBlock}>{renderTaskEditor(activeTask)}</div>
                      </article>
                    </div>
                  </section>
                );
              })() : null}
            </article>
          ) : null}
        </section>
      )}

      <CreateContactDrawer
        accountOptions={accountOptions}
        initialAccountRecordId={createContactTask?.issue.accountRecordId ?? null}
        isOpen={createContactTask !== null}
        onClose={() => {
          setCreateContactTask(null);
        }}
        onContactCreated={handleContactCreated}
      />

      {mergeTask && mergeTask.relatedIssues ? (
        <ContactMergeModal
          businessAccountId={mergeTask.issue.businessAccountId}
          businessAccountRecordId={
            mergeTask.issue.accountRecordId ??
            mergeTask.issue.accountKey
          }
          companyName={mergeTask.issue.companyName}
          contacts={mergeTask.relatedIssues.map((issue) => toMergeableContactCandidate(issue))}
          isOpen
          onClose={() => {
            setMergeTask(null);
          }}
          onMerged={handleMergeCompleted}
        />
      ) : null}
    </AppChrome>
  );
}
