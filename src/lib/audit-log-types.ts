export const AUDIT_ITEM_TYPES = [
  "call",
  "email",
  "meeting",
  "contact",
  "business_account",
] as const;

export type AuditItemType = (typeof AUDIT_ITEM_TYPES)[number];

export const AUDIT_ACTION_GROUPS = [
  "call",
  "email_send",
  "meeting_create",
  "contact_create",
  "contact_delete",
  "contact_merge",
  "business_account_create",
  "business_account_delete",
] as const;

export type AuditActionGroup = (typeof AUDIT_ACTION_GROUPS)[number];

export const AUDIT_RESULT_CODES = [
  "answered",
  "not_answered",
  "succeeded",
  "failed",
  "partial",
  "queued",
  "approved",
  "cancelled",
  "executed",
] as const;

export type AuditResultCode = (typeof AUDIT_RESULT_CODES)[number];

export const AUDIT_LINK_TYPES = ["business_account", "contact"] as const;

export type AuditLinkType = (typeof AUDIT_LINK_TYPES)[number];

export const AUDIT_LINK_ROLES = [
  "primary",
  "linked_contact",
  "matched_contact",
  "recipient",
  "attendee",
  "merged_from",
  "merged_into",
] as const;

export type AuditLinkRole = (typeof AUDIT_LINK_ROLES)[number];

export type AuditAffectedField = {
  key: string;
  label: string;
};

export type AuditLogLink = {
  linkType: AuditLinkType;
  role: AuditLinkRole;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  contactId: number | null;
  contactName: string | null;
};

export type AuditLogRow = {
  id: string;
  occurredAt: string;
  itemType: AuditItemType;
  actionGroup: AuditActionGroup;
  resultCode: AuditResultCode;
  actorLoginName: string | null;
  actorName: string | null;
  sourceSurface: string | null;
  summary: string;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  companyName: string | null;
  contactId: number | null;
  contactName: string | null;
  phoneNumber: string | null;
  emailSubject: string | null;
  emailThreadId: string | null;
  emailMessageId: string | null;
  callSessionId: string | null;
  callDirection: string | null;
  activitySyncStatus: string | null;
  affectedFields: AuditAffectedField[];
  links: AuditLogLink[];
  createdAt: string;
  updatedAt: string;
};

export type AuditActorOption = {
  loginName: string | null;
  name: string | null;
  label: string;
};

export type AuditQuery = {
  q: string;
  itemType: AuditItemType | "all";
  actionGroup: AuditActionGroup | "all";
  result: AuditResultCode | "all";
  actor: string;
  dateFrom: string | null;
  dateTo: string | null;
  businessAccountRecordId: string | null;
  contactId: number | null;
  page: number;
  pageSize: number;
};

export type AuditLogResponse = {
  items: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  actors: AuditActorOption[];
};
