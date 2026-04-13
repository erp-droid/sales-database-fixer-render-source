import type { AuthCookieRefreshState } from "@/lib/acumatica";
import {
  fetchBusinessAccounts,
  fetchBusinessAccountsByBusinessAccountIds,
  fetchContacts,
  fetchOpportunities,
} from "@/lib/acumatica";
import { getEnv } from "@/lib/env";
import {
  buildDataQualitySnapshot,
  paginateDataQualityIssues,
  toDataQualitySummaryResponse,
  type DataQualitySnapshot,
} from "@/lib/data-quality";
import { buildDataQualityTasks } from "@/lib/data-quality-tasks";
import {
  buildDataQualityContributors,
  buildDataQualityExpandedSummary,
  buildDataQualityLeaderboard,
  paginateReviewedDataQualityIssues,
  buildDataQualityThroughput,
  buildDataQualityTrends,
  syncDataQualityHistory,
} from "@/lib/data-quality-history";
import {
  normalizeBusinessAccount,
  normalizeBusinessAccountRows,
  filterSuppressedBusinessAccountRows,
  enforceSinglePrimaryPerAccountRows,
  selectPrimaryContactIndex,
} from "@/lib/business-accounts";
import { applyLastCalledAtToBusinessAccountRows } from "@/lib/business-account-call-history";
import {
  readContactBusinessAccountCode,
  readContactCompanyName,
} from "@/lib/contact-business-account";
import {
  isExcludedInternalCompanyName,
  isExcludedInternalContactEmail,
} from "@/lib/internal-records";
import { resolvePrimaryContactPhoneFields } from "@/lib/phone";
import { registerReadModelCacheClearer } from "@/lib/read-model/cache";
import { readAllAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import type { BusinessAccountRow } from "@/types/business-account";
import type {
  DataQualityBasis,
  DataQualityContributorsResponse,
  DataQualityExpandedSummaryResponse,
  DataQualityIssuesResponse,
  DataQualityLeaderboardResponse,
  DataQualityMetricKey,
  DataQualitySummaryResponse,
  DataQualityTasksResponse,
  DataQualityThroughputResponse,
  DataQualityTrendsResponse,
} from "@/types/data-quality";

const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;

type RawRecord = Record<string, unknown>;

type SnapshotCacheEntry = {
  expiresAtMs: number;
  snapshot: DataQualitySnapshot;
};

let snapshotCache: SnapshotCacheEntry | null = null;
let snapshotInFlight: Promise<DataQualitySnapshot> | null = null;

registerReadModelCacheClearer(() => {
  snapshotCache = null;
  snapshotInFlight = null;
});

function readWrappedString(record: unknown, key: string): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as RawRecord)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as RawRecord).value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasStandaloneApToken(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return /(?:^|[^a-z0-9])ap(?:$|[^a-z0-9])/i.test(value);
}

function shouldExcludeContactByApToken(contact: unknown): boolean {
  const candidates = [
    readWrappedString(contact, "DisplayName"),
    readWrappedString(contact, "FullName"),
    readWrappedString(contact, "ContactName"),
    readWrappedString(contact, "Attention"),
    readWrappedString(contact, "FirstName"),
    readWrappedString(contact, "MiddleName"),
    readWrappedString(contact, "LastName"),
    readWrappedString(contact, "JobTitle"),
    readWrappedString(contact, "Title"),
  ];

  return candidates.some((value) => hasStandaloneApToken(value));
}

function normalizeAccountType(value: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isLikelyVendorClassId(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  return (
    normalized.includes("vendor") ||
    normalized.includes("supplier") ||
    normalized.includes("suppl") ||
    normalized.startsWith("ven")
  );
}

function isAllowedBusinessAccountType(record: unknown): boolean {
  const normalizedType = normalizeAccountType(
    readWrappedString(record, "Type") ??
      readWrappedString(record, "TypeDescription"),
  );
  if (normalizedType) {
    return (
      normalizedType === "customer" ||
      normalizedType === "businessaccount" ||
      normalizedType === "prospect"
    );
  }

  const classId =
    readWrappedString(record, "ClassID") ??
    readWrappedString(record, "BusinessAccountClass");
  if (isLikelyVendorClassId(classId)) {
    return false;
  }

  return true;
}

function readContactDisplayName(record: unknown): string | null {
  const explicit = [
    "DisplayName",
    "FullName",
    "ContactName",
    "Attention",
  ]
    .map((key) => readWrappedString(record, key))
    .find((value) => Boolean(value));
  if (explicit) {
    return explicit;
  }

  const first = readWrappedString(record, "FirstName");
  const middle = readWrappedString(record, "MiddleName");
  const last = readWrappedString(record, "LastName");
  const full = [first, middle, last].filter(Boolean).join(" ").trim();
  return full || null;
}

function readContactEmail(record: unknown): string | null {
  const email = readWrappedString(record, "Email") ?? readWrappedString(record, "EMail");
  return email && email.trim() ? email.trim() : null;
}

function readContactJobTitle(record: unknown): string | null {
  return readWrappedString(record, "JobTitle") ?? readWrappedString(record, "Title");
}

function readWrappedNumber(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const field = (record as RawRecord)[key];
  if (!field || typeof field !== "object") {
    return null;
  }

  const value = (field as RawRecord).value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readRecordIdentity(record: unknown): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const id = (record as RawRecord).id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }

  return readWrappedString(record, "NoteID");
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickFirstText(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (hasText(value)) {
      return value;
    }
  }
  return null;
}

function normalizeBusinessAccountCode(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value.trim().toUpperCase();
}

function readOpportunityBusinessAccountCode(record: unknown): string | null {
  return pickFirstText([
    readWrappedString(record, "BusinessAccountID"),
    readWrappedString(record, "BAccountID"),
    readWrappedString(record, "BusinessAccount"),
    readWrappedString(record, "AccountCD"),
  ]);
}

async function readOpportunityCountByBusinessAccountId(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<Map<string, number>> {
  const opportunities = await fetchOpportunities(
    cookieValue,
    {
      batchSize: 250,
    },
    authCookieRefresh,
  );
  const counts = new Map<string, number>();

  for (const opportunity of opportunities) {
    const businessAccountCode = normalizeBusinessAccountCode(
      readOpportunityBusinessAccountCode(opportunity),
    );
    if (!businessAccountCode) {
      continue;
    }

    counts.set(businessAccountCode, (counts.get(businessAccountCode) ?? 0) + 1);
  }

  return counts;
}

function readBusinessAccountCode(record: unknown): string | null {
  return (
    readWrappedString(record, "BusinessAccountID") ??
    readWrappedString(record, "BAccountID") ??
    readWrappedString(record, "AccountCD")
  );
}

function readBusinessAccountName(record: unknown): string | null {
  return (
    readWrappedString(record, "Name") ??
    readWrappedString(record, "CompanyName") ??
    readWrappedString(record, "AcctName") ??
    readWrappedString(record, "BusinessAccountName")
  );
}

function readContactPhone(record: unknown): string | null {
  return resolvePrimaryContactPhoneFields({
    phone1: readWrappedString(record, "Phone1"),
    phone2: readWrappedString(record, "Phone2"),
    phone3: readWrappedString(record, "Phone3"),
  }).phone;
}

function readContactExtension(record: unknown): string | null {
  return resolvePrimaryContactPhoneFields({
    phone1: readWrappedString(record, "Phone1"),
    phone2: readWrappedString(record, "Phone2"),
    phone3: readWrappedString(record, "Phone3"),
  }).extension;
}

function readContactRawPhone(record: unknown): string | null {
  return (
    readWrappedString(record, "Phone1") ??
    readWrappedString(record, "Phone2") ??
    readWrappedString(record, "Phone3")
  );
}

function buildFallbackRowFromContact(contact: unknown, index: number): BusinessAccountRow {
  const contactId = readWrappedNumber(contact, "ContactID");
  const contactRecordId = readRecordIdentity(contact) ?? `contact-${contactId ?? index}`;
  const contactName = readContactDisplayName(contact);
  const contactEmail = readContactEmail(contact);
  const contactPhone = readContactPhone(contact);

  return {
    id: contactRecordId,
    accountRecordId: contactRecordId,
    rowKey: `${contactRecordId}:contact:${contactId ?? index}`,
    contactId,
    isPrimaryContact: false,
    phoneNumber: contactPhone,
    salesRepId: null,
    salesRepName: null,
    industryType: null,
    subCategory: null,
    companyRegion: null,
    week: null,
    businessAccountId: readContactBusinessAccountCode(contact, readWrappedString) ?? "",
    companyName: readContactCompanyName(contact, readWrappedString) ?? "",
    address: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    primaryContactName: contactName,
    primaryContactJobTitle: readContactJobTitle(contact),
    primaryContactPhone: contactPhone,
    primaryContactExtension: readContactExtension(contact),
    primaryContactRawPhone: readContactRawPhone(contact),
    primaryContactEmail: contactEmail,
    primaryContactId: contactId,
    category: null,
    notes: readWrappedString(contact, "note"),
    lastModifiedIso: readWrappedString(contact, "LastModifiedDateTime"),
  };
}

function buildSyncRowsFromContacts(
  rawContacts: unknown[],
  rawAccounts: unknown[],
): BusinessAccountRow[] {
  const accountByBusinessId = new Map<string, unknown>();
  rawAccounts.forEach((account) => {
    const businessId = readBusinessAccountCode(account);
    const normalizedBusinessId = normalizeBusinessAccountCode(businessId);
    if (normalizedBusinessId) {
      accountByBusinessId.set(normalizedBusinessId, account);
    }
  });

  type PreparedSyncRow = {
    row: BusinessAccountRow;
    accountKey: string;
    hint: {
      contactId: number | null;
      recordId: string | null;
      email: string | null;
      name: string | null;
    };
    candidate: {
      contactId: number | null;
      recordId: string | null;
      email: string | null;
      name: string | null;
      rowNumber: number | null;
    };
    basePrimary: {
      name: string | null;
      jobTitle: string | null;
      phone: string | null;
      extension: string | null;
      rawPhone: string | null;
      email: string | null;
      notes: string | null;
    };
  };

  const preparedRows: PreparedSyncRow[] = rawContacts.map((contact, index) => {
    const businessAccountCode = readContactBusinessAccountCode(contact, readWrappedString);
    const normalizedBusinessAccountCode = normalizeBusinessAccountCode(
      businessAccountCode,
    );
    const rawAccount = businessAccountCode
      ? accountByBusinessId.get(normalizedBusinessAccountCode)
      : undefined;

    const base = rawAccount
      ? normalizeBusinessAccount(rawAccount)
      : buildFallbackRowFromContact(contact, index);

    const primaryRaw =
      rawAccount && typeof rawAccount === "object"
        ? (rawAccount as RawRecord).PrimaryContact
        : undefined;
    const primaryContactId = readWrappedNumber(primaryRaw, "ContactID") ?? base.primaryContactId;
    const primaryContactName = readContactDisplayName(primaryRaw) ?? base.primaryContactName;
    const primaryContactEmail = readContactEmail(primaryRaw) ?? base.primaryContactEmail;
    const primaryRecordId = readRecordIdentity(primaryRaw);

    const contactId = readWrappedNumber(contact, "ContactID");
    const contactName = readContactDisplayName(contact);
    const contactJobTitle = readContactJobTitle(contact);
    const contactPhone = readContactPhone(contact);
    const contactExtension = readContactExtension(contact);
    const contactRawPhone = readContactRawPhone(contact);
    const contactEmail = readContactEmail(contact);
    const contactNotes = readWrappedString(contact, "note");
    const contactRecordId = readRecordIdentity(contact);

    const row: BusinessAccountRow = {
      ...base,
      rowKey: `${base.accountRecordId ?? base.id}:contact:${contactId ?? contactRecordId ?? index}`,
      accountRecordId: base.accountRecordId ?? base.id,
      businessAccountId: businessAccountCode ?? base.businessAccountId,
      companyName: hasText(businessAccountCode)
        ? pickFirstText([
            base.companyName,
            readContactCompanyName(contact, readWrappedString),
            businessAccountCode,
            contactName,
          ]) ?? ""
        : pickFirstText([
            base.companyName,
            readContactCompanyName(contact, readWrappedString),
          ]) ?? "",
      contactId,
      isPrimaryContact: false,
      primaryContactName: pickFirstText([contactName]),
      primaryContactJobTitle: pickFirstText([
        contactJobTitle,
        base.primaryContactJobTitle ?? null,
      ]),
      primaryContactPhone: pickFirstText([contactPhone]),
      primaryContactExtension: pickFirstText([
        contactExtension,
        base.primaryContactExtension ?? null,
      ]),
      primaryContactRawPhone: pickFirstText([
        contactRawPhone,
        base.primaryContactRawPhone ?? null,
      ]),
      primaryContactEmail: pickFirstText([contactEmail]),
      notes: pickFirstText([contactNotes]),
      phoneNumber: pickFirstText([base.phoneNumber, contactPhone, base.primaryContactPhone]),
      primaryContactId: primaryContactId ?? base.primaryContactId,
    };

    return {
      row,
      accountKey:
        (base.accountRecordId ?? "").trim() ||
        base.id.trim() ||
        (businessAccountCode ?? "").trim() ||
        base.businessAccountId.trim() ||
        base.companyName.trim() ||
        `row-${index}`,
      hint: {
        contactId: primaryContactId,
        recordId: primaryRecordId,
        email: primaryContactEmail,
        name: primaryContactName,
      },
      candidate: {
        contactId,
        recordId: contactRecordId,
        email: contactEmail,
        name: contactName,
        rowNumber: readWrappedNumber(contact, "rowNumber"),
      },
      basePrimary: {
        name: base.primaryContactName,
        jobTitle: base.primaryContactJobTitle ?? null,
        phone: base.primaryContactPhone,
        extension: base.primaryContactExtension ?? null,
        rawPhone: base.primaryContactRawPhone ?? null,
        email: base.primaryContactEmail,
        notes: base.notes,
      },
    };
  });

  const rowsByAccount = new Map<string, number[]>();
  preparedRows.forEach((preparedRow, index) => {
    const existing = rowsByAccount.get(preparedRow.accountKey);
    if (existing) {
      existing.push(index);
    } else {
      rowsByAccount.set(preparedRow.accountKey, [index]);
    }
  });

  rowsByAccount.forEach((rowIndexes) => {
    if (rowIndexes.length === 0) {
      return;
    }

    const hint = preparedRows[rowIndexes[0]]?.hint ?? {
      contactId: null,
      recordId: null,
      email: null,
      name: null,
    };
    const candidates = rowIndexes.map((rowIndex, candidateIndex) => {
      const candidate = preparedRows[rowIndex]?.candidate ?? {
        contactId: null,
        recordId: null,
        email: null,
        name: null,
        rowNumber: null,
      };
      return {
        contactId: candidate.contactId,
        recordId: candidate.recordId,
        email: candidate.email,
        name: candidate.name,
        rowNumber: candidate.rowNumber,
        index: candidateIndex,
      };
    });

    const selectedLocalIndex = selectPrimaryContactIndex(candidates, hint);
    if (selectedLocalIndex === null) {
      return;
    }

    const selectedRowIndex = rowIndexes[selectedLocalIndex];
    const selectedPrepared = preparedRows[selectedRowIndex];
    if (!selectedPrepared) {
      return;
    }

    preparedRows[selectedRowIndex] = {
      ...selectedPrepared,
      row: {
        ...selectedPrepared.row,
        isPrimaryContact: true,
        primaryContactName: pickFirstText([
          selectedPrepared.row.primaryContactName,
          selectedPrepared.basePrimary.name,
        ]),
        primaryContactJobTitle: pickFirstText([
          selectedPrepared.row.primaryContactJobTitle ?? null,
          selectedPrepared.basePrimary.jobTitle,
        ]),
        primaryContactPhone: pickFirstText([
          selectedPrepared.row.primaryContactPhone,
          selectedPrepared.basePrimary.phone,
        ]),
        primaryContactExtension: pickFirstText([
          selectedPrepared.row.primaryContactExtension ?? null,
          selectedPrepared.basePrimary.extension,
        ]),
        primaryContactRawPhone: pickFirstText([
          selectedPrepared.row.primaryContactRawPhone ?? null,
          selectedPrepared.basePrimary.rawPhone,
        ]),
        primaryContactEmail: pickFirstText([
          selectedPrepared.row.primaryContactEmail,
          selectedPrepared.basePrimary.email,
        ]),
        notes: pickFirstText([selectedPrepared.row.notes, selectedPrepared.basePrimary.notes]),
      },
    };
  });

  const rows = preparedRows.map((prepared) => prepared.row);

  return enforceSinglePrimaryPerAccountRows(rows).filter(
    (row) =>
      Boolean(
        row.id ||
          row.accountRecordId ||
          row.businessAccountId ||
          row.companyName ||
          row.primaryContactName,
      ),
  );
}

function dedupeRows(rows: BusinessAccountRow[]): BusinessAccountRow[] {
  const deduped = new Map<string, BusinessAccountRow>();
  rows.forEach((row, index) => {
    const key =
      row.rowKey ??
      `${row.accountRecordId ?? row.id}:contact:${row.contactId ?? index}`;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  });
  return [...deduped.values()];
}

export async function fetchAllSyncRows(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    includeInternal?: boolean;
  },
): Promise<BusinessAccountRow[]> {
  const includeInternal = Boolean(options?.includeInternal);
  const rawContacts = await fetchContacts(
    cookieValue,
    {
      batchSize: 250,
    },
    authCookieRefresh,
  );
  let rawAccounts: unknown[] = [];

  try {
    rawAccounts = await fetchBusinessAccounts(
      cookieValue,
      {
        batchSize: 250,
        ensureMainAddress: true,
        ensurePrimaryContact: true,
        ensureAttributes: true,
        ensureContacts: true,
      },
      authCookieRefresh,
    );
  } catch {
    const contactBusinessIds = rawContacts
      .map((contact) => readContactBusinessAccountCode(contact, readWrappedString))
      .filter((value): value is string => Boolean(value));

    rawAccounts = await fetchBusinessAccountsByBusinessAccountIds(
      cookieValue,
      contactBusinessIds,
      authCookieRefresh,
    );
  }
  const filteredContacts = rawContacts.filter(
    (contact) =>
      !shouldExcludeContactByApToken(contact) &&
      (includeInternal || !isExcludedInternalContactEmail(readContactEmail(contact))) &&
      (includeInternal ||
        !isExcludedInternalCompanyName(readContactCompanyName(contact, readWrappedString))),
  );
  const allowedRawAccounts = rawAccounts.filter(
    (account) =>
      isAllowedBusinessAccountType(account) &&
      (includeInternal ||
        !isExcludedInternalCompanyName(readBusinessAccountName(account))),
  );
  const allowedBusinessIds = new Set(
    allowedRawAccounts
      .map((account) => normalizeBusinessAccountCode(readBusinessAccountCode(account)))
      .filter((value) => Boolean(value)),
  );
  let opportunityCountByBusinessId: Map<string, number> | null = null;

  try {
    opportunityCountByBusinessId = await readOpportunityCountByBusinessAccountId(
      cookieValue,
      authCookieRefresh,
    );
  } catch (error) {
    console.warn("[accounts-sync]", {
      event: "opportunity-counts-unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const normalizedContactRows = buildSyncRowsFromContacts(
    filteredContacts,
    allowedRawAccounts,
  ).filter((row) => {
    const normalizedBusinessId = normalizeBusinessAccountCode(row.businessAccountId);
    if (!normalizedBusinessId) {
      return true;
    }

    return allowedBusinessIds.has(normalizedBusinessId);
  });
  const normalizedAccountRows = allowedRawAccounts
    .flatMap((account) => normalizeBusinessAccountRows(account))
    .filter((row) =>
      Boolean(
        row.id ||
          row.accountRecordId ||
          row.businessAccountId ||
          row.companyName ||
          row.primaryContactName,
      ),
    );

  const rowsWithOpportunityCounts = dedupeRows([
    ...normalizedAccountRows,
    ...normalizedContactRows,
  ]).map((row) => {
    if (!opportunityCountByBusinessId) {
      return row;
    }

    const normalizedBusinessId = normalizeBusinessAccountCode(row.businessAccountId);
    if (!normalizedBusinessId) {
      return row;
    }

    return {
      ...row,
      opportunityCount: opportunityCountByBusinessId.get(normalizedBusinessId) ?? 0,
    };
  });

  return applyLastCalledAtToBusinessAccountRows(
    filterSuppressedBusinessAccountRows(
      rowsWithOpportunityCounts,
      {
        includeInternalRows: includeInternal,
      },
    ),
  );
}

async function computeLiveSnapshot(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
): Promise<DataQualitySnapshot> {
  const { READ_MODEL_ENABLED } = getEnv();
  let rows: BusinessAccountRow[];

  if (READ_MODEL_ENABLED) {
    rows = readAllAccountRowsFromReadModel();
  } else {
    rows = await fetchAllSyncRows(cookieValue, authCookieRefresh);
  }

  return buildDataQualitySnapshot(rows);
}

export async function getLiveDataQualitySnapshot(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
  },
): Promise<DataQualitySnapshot> {
  const forceRefresh = Boolean(options?.refresh);
  const now = Date.now();

  if (!forceRefresh && snapshotCache && snapshotCache.expiresAtMs > now) {
    return snapshotCache.snapshot;
  }

  if (!forceRefresh && snapshotInFlight) {
    return snapshotInFlight;
  }

  const request = computeLiveSnapshot(cookieValue, authCookieRefresh)
    .then((snapshot) => {
      void syncDataQualityHistory(snapshot);
      snapshotCache = {
        snapshot,
        expiresAtMs: Date.now() + LIVE_CACHE_TTL_MS,
      };
      return snapshot;
    })
    .finally(() => {
      if (snapshotInFlight === request) {
        snapshotInFlight = null;
      }
    });

  snapshotInFlight = request;
  return request;
}

export async function getLiveDataQualitySummary(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
  },
): Promise<DataQualitySummaryResponse> {
  const snapshot = await getLiveDataQualitySnapshot(
    cookieValue,
    authCookieRefresh,
    options,
  );
  return toDataQualitySummaryResponse(snapshot);
}

export async function getLiveDataQualityExpandedSummary(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
    basis?: DataQualityBasis;
  },
): Promise<DataQualityExpandedSummaryResponse> {
  const basis = options?.basis ?? "row";
  const snapshot = await getLiveDataQualitySnapshot(
    cookieValue,
    authCookieRefresh,
    options,
  );
  return buildDataQualityExpandedSummary(snapshot, basis);
}

export async function getLiveDataQualityIssues(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options: {
    metric: DataQualityMetricKey;
    basis: DataQualityBasis;
    page: number;
    pageSize: number;
    salesRep?: string;
    refresh?: boolean;
  },
): Promise<DataQualityIssuesResponse> {
  const snapshot = await getLiveDataQualitySnapshot(
    cookieValue,
    authCookieRefresh,
    { refresh: options.refresh },
  );

  return paginateReviewedDataQualityIssues(
    snapshot,
    options.metric,
    options.basis,
    options.page,
    options.pageSize,
    options.salesRep,
  );
}

export async function getLiveDataQualityTasks(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
  },
): Promise<DataQualityTasksResponse> {
  const snapshot = await getLiveDataQualitySnapshot(
    cookieValue,
    authCookieRefresh,
    options,
  );

  return buildDataQualityTasks(snapshot);
}

export async function getLiveDataQualityTrends(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
    basis?: DataQualityBasis;
  },
): Promise<DataQualityTrendsResponse> {
  const basis = options?.basis ?? "row";
  const snapshot = await getLiveDataQualitySnapshot(
    cookieValue,
    authCookieRefresh,
    options,
  );
  await syncDataQualityHistory(snapshot);
  return buildDataQualityTrends(basis);
}

export async function getLiveDataQualityThroughput(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
    basis?: DataQualityBasis;
  },
): Promise<DataQualityThroughputResponse> {
  const basis = options?.basis ?? "row";
  const snapshot = await getLiveDataQualitySnapshot(
    cookieValue,
    authCookieRefresh,
    options,
  );
  await syncDataQualityHistory(snapshot);
  return buildDataQualityThroughput(basis);
}

export async function getLiveDataQualityLeaderboard(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
    basis?: DataQualityBasis;
  },
): Promise<DataQualityLeaderboardResponse> {
  const basis = options?.basis ?? "row";
  const snapshot = await getLiveDataQualitySnapshot(
    cookieValue,
    authCookieRefresh,
    options,
  );
  await syncDataQualityHistory(snapshot);
  return buildDataQualityLeaderboard(snapshot, basis);
}

export async function getLiveDataQualityContributors(
  cookieValue: string,
  authCookieRefresh: AuthCookieRefreshState,
  options?: {
    refresh?: boolean;
    basis?: DataQualityBasis;
  },
): Promise<DataQualityContributorsResponse> {
  const basis = options?.basis ?? "row";
  if (options?.refresh) {
    const snapshot = await getLiveDataQualitySnapshot(
      cookieValue,
      authCookieRefresh,
      options,
    );
    await syncDataQualityHistory(snapshot);
  }

  return buildDataQualityContributors(basis);
}

export function buildLocalDataQualitySummary(rows: BusinessAccountRow[]): DataQualitySummaryResponse {
  const snapshot = buildDataQualitySnapshot(rows);
  return toDataQualitySummaryResponse(snapshot);
}

export function buildLocalDataQualityIssues(
  rows: BusinessAccountRow[],
  metric: DataQualityMetricKey,
  basis: DataQualityBasis,
  page: number,
  pageSize: number,
): DataQualityIssuesResponse {
  const snapshot = buildDataQualitySnapshot(rows);
  return paginateDataQualityIssues(snapshot, metric, basis, page, pageSize);
}

export function clearLiveDataQualityCache(): void {
  snapshotCache = null;
  snapshotInFlight = null;
}
