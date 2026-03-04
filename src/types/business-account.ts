export const CATEGORY_VALUES = ["A", "B", "C", "D"] as const;

export type Category = (typeof CATEGORY_VALUES)[number];

export type SortBy =
  | "companyName"
  | "salesRepName"
  | "industryType"
  | "subCategory"
  | "companyRegion"
  | "week"
  | "address"
  | "primaryContactName"
  | "primaryContactPhone"
  | "primaryContactEmail"
  | "category"
  | "lastModifiedIso";

export type SortDir = "asc" | "desc";

export type BusinessAccountRow = {
  id: string;
  accountRecordId?: string;
  rowKey?: string;
  contactId?: number | null;
  isPrimaryContact?: boolean;
  phoneNumber?: string | null;
  salesRepId: string | null;
  salesRepName: string | null;
  industryType: string | null;
  subCategory: string | null;
  companyRegion: string | null;
  week: string | null;
  businessAccountId: string;
  companyName: string;
  address: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  primaryContactId: number | null;
  category: Category | null;
  notes: string | null;
  lastModifiedIso: string | null;
};

export type BusinessAccountUpdateRequest = {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  salesRepId: string | null;
  salesRepName: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  category: Category | null;
  notes: string | null;
  expectedLastModified: string | null;
};

export type BusinessAccountsResponse = {
  items: BusinessAccountRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type BusinessAccountDetailResponse = {
  row: BusinessAccountRow;
};

export type BusinessAccountMapPoint = {
  id: string;
  businessAccountId: string;
  companyName: string;
  fullAddress: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  category: Category | null;
  notes: string | null;
  lastModifiedIso: string | null;
  latitude: number;
  longitude: number;
  geocodeProvider: "address-complete" | "nominatim" | "arcgis";
};

export type BusinessAccountMapResponse = {
  items: BusinessAccountMapPoint[];
  totalCandidates: number;
  geocodedCount: number;
  unmappedCount: number;
};
