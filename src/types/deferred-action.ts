import type { BusinessAccountType } from "@/types/business-account";

export const DEFERRED_ACTION_STATUSES = [
  "pending_review",
  "approved",
  "cancelled",
  "executing",
  "executed",
  "failed",
] as const;

export type DeferredActionStatus = (typeof DEFERRED_ACTION_STATUSES)[number];

export const DEFERRED_ACTION_TYPES = [
  "deleteContact",
  "deleteBusinessAccount",
  "mergeContacts",
] as const;

export type DeferredActionType = (typeof DEFERRED_ACTION_TYPES)[number];

export type DeferredActionSummary = {
  id: string;
  actionType: DeferredActionType;
  status: DeferredActionStatus;
  sourceSurface: string;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  accountType: BusinessAccountType | null;
  opportunityCount: number | null;
  acumaticaBusinessAccountUrl: string | null;
  contactId: number | null;
  contactName: string | null;
  keptContactId: number | null;
  keptContactName: string | null;
  loserContactIds: number[];
  loserContactNames: string[];
  affectedFields: string[];
  reason: string | null;
  requestedByLoginName: string | null;
  requestedByName: string | null;
  approvedByLoginName: string | null;
  approvedByName: string | null;
  cancelledByLoginName: string | null;
  cancelledByName: string | null;
  requestedAt: string;
  executeAfterAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  executedAt: string | null;
  failureMessage: string | null;
};

export type DeferredActionCounts = Record<DeferredActionStatus, number>;

export type DeferredActionListResponse = {
  items: DeferredActionSummary[];
  counts: DeferredActionCounts;
  now: string;
  executeTimeZone: string;
  executedNowCount: number;
  failedNowCount: number;
};

export type DeferredActionBulkRequest = {
  action: "approve" | "cancel";
  actionIds: string[];
};

export type DeferredActionBulkResponse = DeferredActionListResponse & {
  updatedCount: number;
};

export type DeferredActionRunDueResponse = DeferredActionListResponse;

export type DeferredDeleteContactResponse = {
  queued: true;
  actionId: string;
  actionType: "deleteContact";
  contactId: number;
  reason: string;
  executeAfterAt: string;
  status: "pending_review";
};

export type DeferredDeleteBusinessAccountResponse = {
  queued: true;
  actionId: string;
  actionType: "deleteBusinessAccount";
  businessAccountRecordId: string;
  businessAccountId: string;
  reason: string;
  executeAfterAt: string;
  status: "pending_review";
};
