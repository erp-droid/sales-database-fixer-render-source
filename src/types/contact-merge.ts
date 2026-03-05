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

export type ContactMergeFieldSource = "keep" | "delete";

export type ContactMergeFieldChoice = {
  field: ContactMergeFieldKey;
  source: ContactMergeFieldSource;
};

export type ContactMergeRequest = {
  businessAccountRecordId: string;
  businessAccountId: string;
  keepContactId: number;
  deleteContactId: number;
  setKeptAsPrimary: boolean;
  expectedAccountLastModified: string | null;
  expectedKeepContactLastModified: string | null;
  expectedDeleteContactLastModified: string | null;
  fieldChoices: ContactMergeFieldChoice[];
};

export type ContactMergeResponse = {
  merged: true;
  businessAccountRecordId: string;
  businessAccountId: string;
  keptContactId: number;
  deletedContactId: number;
  setKeptAsPrimary: boolean;
  updatedRow: BusinessAccountRow;
  deletedRowKey: string | null;
  accountRows: BusinessAccountRow[];
  warnings: string[];
};

export type ContactMergePreviewField = {
  field: ContactMergeFieldKey;
  label: string;
  keepValue: string | null;
  deleteValue: string | null;
  recommendedSource: ContactMergeFieldSource;
  valuesDiffer: boolean;
};

export type ContactMergePreviewResponse = {
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string;
  keepContactId: number;
  deleteContactId: number;
  keepIsPrimary: boolean;
  deleteIsPrimary: boolean;
  recommendedSetKeptAsPrimary: boolean;
  expectedAccountLastModified: string | null;
  expectedKeepContactLastModified: string | null;
  expectedDeleteContactLastModified: string | null;
  warnings: string[];
  fields: ContactMergePreviewField[];
};
