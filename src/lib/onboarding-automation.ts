import crypto from "node:crypto";

import {
  readOpportunityId,
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import {
  serviceFetchBusinessAccountById,
  serviceFetchContactById,
  serviceFetchOpportunities,
} from "@/lib/acumatica-service-auth";
import { normalizeBusinessAccountType } from "@/lib/business-account-region-resolution";
import { resolveBusinessAccountRecordId } from "@/lib/business-accounts";
import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { sendOnboardingEmail } from "@/lib/onboarding-mailer";
import {
  createOnboardingRequest,
  findOnboardingRequestByBusinessAccountId,
  findOnboardingRequestByOpportunityId,
  getOnboardingScanState,
  updateOnboardingRequest,
  updateOnboardingScanState,
} from "@/lib/onboarding-store";

type OnboardingScanResult = {
  opportunityId: string;
  businessAccountId: string | null;
  status: "created" | "skipped" | "failed";
  reason: string;
  token?: string;
};

function normalizeComparable(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeComparableLoose(value: string | null | undefined): string {
  return normalizeComparable(value).replace(/[-_]/g, "");
}

function buildComparableSet(values: string[], fallback: string[]): Set<string> {
  const source = values.length > 0 ? values : fallback;
  return new Set(source.map(normalizeComparableLoose).filter(Boolean));
}

function readNullableWrappedString(record: unknown, key: string): string | null {
  const value = readWrappedString(record, key);
  return value ? value : null;
}

function readOpportunityBusinessAccountId(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "BusinessAccountID") ||
    readNullableWrappedString(record, "BusinessAccount") ||
    readNullableWrappedString(record, "BAccountID") ||
    readNullableWrappedString(record, "AccountID") ||
    readNullableWrappedString(record, "Account") ||
    readNullableWrappedString(record, "AccountCD")
  );
}

function readOpportunityContactId(record: unknown): number | null {
  return (
    readWrappedNumber(record, "ContactID") ??
    readWrappedNumber(record, "Contact") ??
    readWrappedNumber(record, "PrimaryContactID") ??
    readWrappedNumber(record, "DefContactID") ??
    null
  );
}

function readOpportunityStage(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "Stage") ||
    readNullableWrappedString(record, "StageID") ||
    readNullableWrappedString(record, "StageId") ||
    readNullableWrappedString(record, "StageName") ||
    readNullableWrappedString(record, "StageDescription")
  );
}

function readOpportunityStatus(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "Status") ||
    readNullableWrappedString(record, "StatusID") ||
    readNullableWrappedString(record, "StatusId") ||
    readNullableWrappedString(record, "StatusDescription")
  );
}

function readOpportunityLastModified(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "LastModifiedDateTime") ||
    readNullableWrappedString(record, "LastModifiedDate")
  );
}

function readBusinessAccountType(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "Type") ||
    readNullableWrappedString(record, "TypeDescription") ||
    readNullableWrappedString(record, "BusinessAccountType")
  );
}

function isCustomerAccount(record: unknown): boolean {
  const normalized = normalizeBusinessAccountType(readBusinessAccountType(record));
  return normalized === "customer";
}

function readContactName(record: unknown): string | null {
  const display =
    readNullableWrappedString(record, "DisplayName") ||
    readNullableWrappedString(record, "ContactName") ||
    readNullableWrappedString(record, "FullName");
  if (display) {
    return display;
  }

  const first = readNullableWrappedString(record, "FirstName");
  const last = readNullableWrappedString(record, "LastName");
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function readContactEmail(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "Email") ||
    readNullableWrappedString(record, "EMail")
  );
}

function readContactPhone(record: unknown): string | null {
  return (
    readNullableWrappedString(record, "Phone1") ||
    readNullableWrappedString(record, "Phone") ||
    readNullableWrappedString(record, "Phone2") ||
    readNullableWrappedString(record, "Phone3")
  );
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function buildOnboardingUrl(token: string): string {
  const env = getEnv();
  if (!env.APP_BASE_URL) {
    throw new HttpError(500, "APP_BASE_URL must be configured for onboarding emails.");
  }

  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return `${base}/onboarding/${token}`;
}

async function resolveContactForOpportunity(input: {
  opportunityContactId: number | null;
  account: Record<string, unknown>;
}): Promise<{
  contactId: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}> {
  const opportunityContactId = input.opportunityContactId;
  if (opportunityContactId) {
    const contact = await serviceFetchContactById(null, opportunityContactId);
    return {
      contactId: opportunityContactId,
      contactName: readContactName(contact),
      contactEmail: readContactEmail(contact),
      contactPhone: readContactPhone(contact),
    };
  }

  const primary =
    input.account && typeof input.account === "object"
      ? (input.account as Record<string, unknown>).PrimaryContact
      : null;
  if (primary && typeof primary === "object") {
    const primaryContactId = readWrappedNumber(primary, "ContactID");
    return {
      contactId: primaryContactId ?? null,
      contactName: readContactName(primary),
      contactEmail: readContactEmail(primary),
      contactPhone: readContactPhone(primary),
    };
  }

  return {
    contactId: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
  };
}

async function queueOnboardingRequest(input: {
  opportunityId: string;
  opportunityStage: string | null;
  opportunityStatus: string | null;
  opportunityLastModified: string | null;
  businessAccountId: string;
  accountRecord: Record<string, unknown>;
  contact: {
    contactId: number | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  };
  dryRun?: boolean;
}): Promise<OnboardingScanResult> {
  const existingByOpportunity = await findOnboardingRequestByOpportunityId(input.opportunityId);
  if (existingByOpportunity) {
    return {
      opportunityId: input.opportunityId,
      businessAccountId: input.businessAccountId,
      status: "skipped",
      reason: "already_requested",
    };
  }

  const existingByAccount = await findOnboardingRequestByBusinessAccountId(
    input.businessAccountId,
  );
  if (existingByAccount && existingByAccount.status !== "failed") {
    return {
      opportunityId: input.opportunityId,
      businessAccountId: input.businessAccountId,
      status: "skipped",
      reason: "account_already_pending",
    };
  }

  if (!input.contact.contactEmail) {
    return {
      opportunityId: input.opportunityId,
      businessAccountId: input.businessAccountId,
      status: "skipped",
      reason: "missing_contact_email",
    };
  }

  const token = generateToken();
  const onboardingUrl = buildOnboardingUrl(token);
  const businessAccountRecordId = resolveBusinessAccountRecordId(
    input.accountRecord,
    input.businessAccountId,
  );
  const companyName = readNullableWrappedString(input.accountRecord, "Name");

  await createOnboardingRequest(token, {
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    submittedAt: null,
    businessAccountId: input.businessAccountId,
    businessAccountRecordId,
    opportunityId: input.opportunityId,
    opportunityStage: input.opportunityStage,
    opportunityStatus: input.opportunityStatus,
    opportunityLastModified: input.opportunityLastModified,
    companyName,
    primaryContactId: input.contact.contactId,
    primaryContactName: input.contact.contactName,
    primaryContactEmail: input.contact.contactEmail,
    emailTo: input.contact.contactEmail,
    emailOverrideTo: null,
    emailSentAt: null,
    onboardingUrl,
    submission: null,
    conversion: null,
    finalization: null,
    activeEditor: null,
  });

  if (input.dryRun) {
    await updateOnboardingRequest(token, {
      status: "pending",
      emailSentAt: null,
    });
    return {
      opportunityId: input.opportunityId,
      businessAccountId: input.businessAccountId,
      status: "created",
      reason: "dry_run",
      token,
    };
  }

  const mailResult = await sendOnboardingEmail({
    companyName,
    contactName: input.contact.contactName,
    contactEmail: input.contact.contactEmail,
    onboardingUrl,
    opportunityId: input.opportunityId,
  });

  await updateOnboardingRequest(token, {
    emailSentAt: new Date().toISOString(),
    emailTo: mailResult.to,
    emailOverrideTo: mailResult.overrideTo,
  });

  return {
    opportunityId: input.opportunityId,
    businessAccountId: input.businessAccountId,
    status: "created",
    reason: "email_sent",
    token,
  };
}

function resolveWonStageSet(): Set<string> {
  const env = getEnv();
  return buildComparableSet(env.ONBOARDING_WON_STAGES, ["won", "closedwon"]);
}

function resolveWonStatusSet(): Set<string> {
  const env = getEnv();
  return buildComparableSet(env.ONBOARDING_WON_STATUSES, ["won", "closedwon"]);
}

function isWonOpportunity(stage: string | null, status: string | null): boolean {
  const stageSet = resolveWonStageSet();
  const statusSet = resolveWonStatusSet();

  if (stage && stageSet.has(normalizeComparableLoose(stage))) {
    return true;
  }

  if (status && statusSet.has(normalizeComparableLoose(status))) {
    return true;
  }

  return false;
}

function buildSinceTimestamp(): string {
  const env = getEnv();
  const now = new Date();
  const fallbackSince = new Date(now.getTime() - env.ONBOARDING_SCAN_LOOKBACK_HOURS * 3600 * 1000);
  return fallbackSince.toISOString();
}

export async function runOnboardingScan(options?: {
  dryRun?: boolean;
}): Promise<{
  ranAt: string;
  since: string;
  results: OnboardingScanResult[];
  created: number;
  skipped: number;
  failed: number;
}> {
  const state = await getOnboardingScanState();
  const now = new Date();
  const baseSince = state.lastScanAt ?? buildSinceTimestamp();
  const baseSinceMs = Date.parse(baseSince);
  const sinceWithBuffer = Number.isFinite(baseSinceMs)
    ? new Date(baseSinceMs - 10 * 60 * 1000).toISOString()
    : buildSinceTimestamp();

  await updateOnboardingScanState({ lastScanAt: now.toISOString() });

  const filter = `LastModifiedDateTime ge datetime'${sinceWithBuffer}'`;
  const opportunities = await serviceFetchOpportunities(null, {
    filter,
    maxRecords: 500,
    select: [
      "OpportunityID",
      "BusinessAccountID",
      "BAccountID",
      "ContactID",
      "Status",
      "Stage",
      "LastModifiedDateTime",
    ],
  });

  const results: OnboardingScanResult[] = [];

  for (const record of opportunities) {
    const opportunityId = readOpportunityId(record);
    if (!opportunityId) {
      continue;
    }

    const stage = readOpportunityStage(record);
    const status = readOpportunityStatus(record);
    if (!isWonOpportunity(stage, status)) {
      results.push({
        opportunityId,
        businessAccountId: readOpportunityBusinessAccountId(record),
        status: "skipped",
        reason: "not_won",
      });
      continue;
    }

    const businessAccountId = readOpportunityBusinessAccountId(record);
    if (!businessAccountId) {
      results.push({
        opportunityId,
        businessAccountId: null,
        status: "skipped",
        reason: "missing_account",
      });
      continue;
    }

    try {
      const account = await serviceFetchBusinessAccountById(null, businessAccountId);
      if (isCustomerAccount(account)) {
        results.push({
          opportunityId,
          businessAccountId,
          status: "skipped",
          reason: "already_customer",
        });
        continue;
      }

      const contact = await resolveContactForOpportunity({
        opportunityContactId: readOpportunityContactId(record),
        account,
      });

      const queued = await queueOnboardingRequest({
        opportunityId,
        opportunityStage: stage,
        opportunityStatus: status,
        opportunityLastModified: readOpportunityLastModified(record),
        businessAccountId,
        accountRecord: account,
        contact,
        dryRun: options?.dryRun,
      });
      results.push(queued);
    } catch (error) {
      results.push({
        opportunityId,
        businessAccountId,
        status: "failed",
        reason: getErrorMessage(error),
      });
    }
  }

  const created = results.filter((item) => item.status === "created").length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  const failed = results.filter((item) => item.status === "failed").length;

  await updateOnboardingScanState({ lastCompletedAt: now.toISOString() });

  return {
    ranAt: now.toISOString(),
    since: sinceWithBuffer,
    results,
    created,
    skipped,
    failed,
  };
}

export async function createManualOnboardingRequest(input: {
  businessAccountId: string;
  opportunityId: string;
  contactId?: number | null;
  contactEmail?: string | null;
  contactName?: string | null;
  opportunityStage?: string | null;
  opportunityStatus?: string | null;
}): Promise<OnboardingScanResult> {
  if (!input.businessAccountId.trim()) {
    throw new HttpError(400, "businessAccountId is required.");
  }
  if (!input.opportunityId.trim()) {
    throw new HttpError(400, "opportunityId is required.");
  }

  const account = await serviceFetchBusinessAccountById(null, input.businessAccountId);
  const contact =
    input.contactEmail || input.contactId
      ? {
          contactId: input.contactId ?? null,
          contactName: input.contactName ?? null,
          contactEmail: input.contactEmail ?? null,
          contactPhone: null,
        }
      : await resolveContactForOpportunity({
          opportunityContactId: input.contactId ?? null,
          account,
        });

  return queueOnboardingRequest({
    opportunityId: input.opportunityId,
    opportunityStage: input.opportunityStage ?? null,
    opportunityStatus: input.opportunityStatus ?? null,
    opportunityLastModified: null,
    businessAccountId: input.businessAccountId,
    accountRecord: account,
    contact,
  });
}
