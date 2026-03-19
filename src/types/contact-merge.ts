import type { BusinessAccountRow } from "@/types/business-account";

export const CONTACT_MERGE_FIELD_KEYS = [
  "firstName",
  "middleName",
  "lastName",
  "displayName",
  "jobTitle",
  "email",
  "phone1",
  "phone2",
  "phone3",
  "website",
  "notes",
] as const;

export type ContactMergeFieldKey = (typeof CONTACT_MERGE_FIELD_KEYS)[number];

export type MergeableContactCandidate = {
  contactId: number | null;
  rowKey: string | null;
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isPrimaryContact: boolean;
  salesRepName: string | null;
  lastModifiedIso: string | null;
};

export type ContactMergeExpectedContactLastModified = {
  contactId: number;
  lastModified: string | null;
};

export type ContactMergeFieldChoice = {
  field: ContactMergeFieldKey;
  sourceContactId: number;
};

export type ContactMergeRequest = {
  businessAccountRecordId: string;
  businessAccountId: string;
  keepContactId: number;
  selectedContactIds: number[];
  setKeptAsPrimary: boolean;
  expectedAccountLastModified: string | null;
  expectedContactLastModifieds: ContactMergeExpectedContactLastModified[];
  fieldChoices: ContactMergeFieldChoice[];
};

export type ImmediateContactMergeResponse = {
  merged: true;
  businessAccountRecordId: string;
  businessAccountId: string;
  keptContactId: number;
  deletedContactIds: number[];
  setKeptAsPrimary: boolean;
  updatedRow: BusinessAccountRow;
  deletedRowKeys: string[];
  accountRows: BusinessAccountRow[];
  warnings: string[];
};

export type QueuedContactMergeResponse = {
  queued: true;
  actionId: string;
  businessAccountRecordId: string;
  businessAccountId: string;
  keptContactId: number;
  deletedContactIds: number[];
  setKeptAsPrimary: boolean;
  updatedRow: BusinessAccountRow;
  deletedRowKeys: string[];
  accountRows: BusinessAccountRow[];
  warnings: string[];
  executeAfterAt: string;
};

export type ContactMergeResponse =
  | ImmediateContactMergeResponse
  | QueuedContactMergeResponse;

export type ContactMergePreviewContact = {
  contactId: number;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  lastModifiedIso: string | null;
};

export type ContactMergePreviewFieldValue = {
  contactId: number;
  value: string | null;
};

export type ContactMergePreviewField = {
  field: ContactMergeFieldKey;
  label: string;
  values: ContactMergePreviewFieldValue[];
  recommendedSourceContactId: number;
  valuesDiffer: boolean;
};

export type ContactMergePreviewResponse = {
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  keepContactId: number;
  contacts: ContactMergePreviewContact[];
  recommendedSetKeptAsPrimary: boolean;
  expectedAccountLastModified: string | null;
  warnings: string[];
  fields: ContactMergePreviewField[];
};
