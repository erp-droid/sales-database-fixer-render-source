import type { BusinessAccountRow, Category } from "@/types/business-account";

export const BUSINESS_ACCOUNT_CLASS_CODES = ["LEAD", "CUSTOMER"] as const;

export type BusinessAccountClassCode = (typeof BUSINESS_ACCOUNT_CLASS_CODES)[number];

export const CONTACT_CLASS_KEYS = [
  "billing",
  "operations",
  "production",
  "sales",
  "service",
] as const;

export type ContactClassKey = (typeof CONTACT_CLASS_KEYS)[number];

export type BusinessAccountCreateRequest = {
  companyName: string;
  classId: BusinessAccountClassCode;
  salesRepId: string | null;
  salesRepName: string | null;
  industryType: string;
  subCategory: string;
  companyRegion: string;
  week: string | null;
  category: Category;
  addressLookupId: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: "CA";
};

export type BusinessAccountCreateResponse = {
  created: true;
  businessAccountRecordId: string;
  businessAccountId: string;
  accountRows: BusinessAccountRow[];
  createdRow: BusinessAccountRow;
  warnings: string[];
};

export type BusinessAccountContactCreateRequest = {
  displayName: string;
  jobTitle: string;
  email: string;
  phone1: string;
  contactClass: ContactClassKey;
};

export type BusinessAccountContactCreateResponse = {
  created: true;
  businessAccountRecordId: string;
  businessAccountId: string;
  contactId: number;
  accountRows: BusinessAccountRow[];
  createdRow: BusinessAccountRow;
  setAsPrimary: true;
  warnings: string[];
};

export type BusinessAccountContactCreatePartialResponse = {
  created: false;
  partial: true;
  businessAccountRecordId: string;
  businessAccountId: string;
  contactId: number;
  accountRows: BusinessAccountRow[];
  error: string;
};
