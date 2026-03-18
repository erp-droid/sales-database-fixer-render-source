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
  | "companyPhone"
  | "primaryContactName"
  | "primaryContactJobTitle"
  | "primaryContactPhone"
  | "primaryContactExtension"
  | "primaryContactEmail"
  | "notes"
  | "category"
  | "lastEmailedAt"
  | "lastModifiedIso";

export type SortDir = "asc" | "desc";

export type CompanyPhoneSource = "account" | "placeholder" | "fallback";

export type BusinessAccountRow = {
  id: string;
  accountRecordId?: string;
  rowKey?: string;
  contactId?: number | null;
  isPrimaryContact?: boolean;
  companyPhone?: string | null;
  companyPhoneSource?: CompanyPhoneSource | null;
  phoneNumber?: string | null;
  salesRepId: string | null;
  salesRepName: string | null;
  industryType: string | null;
  subCategory: string | null;
  companyRegion: string | null;
  week: string | null;
  businessAccountId: string;
  companyName: string;
  companyDescription?: string | null;
  address: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primaryContactName: string | null;
  primaryContactJobTitle?: string | null;
  primaryContactPhone: string | null;
  primaryContactExtension?: string | null;
  primaryContactRawPhone?: string | null;
  primaryContactEmail: string | null;
  primaryContactId: number | null;
  category: Category | null;
  notes: string | null;
  lastEmailedAt?: string | null;
  lastModifiedIso: string | null;
};

export type BusinessAccountUpdateRequest = {
  companyName: string;
  companyDescription?: string | null;
  assignedBusinessAccountRecordId: string | null;
  assignedBusinessAccountId: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  targetContactId: number | null;
  setAsPrimaryContact: boolean;
  primaryOnlyIntent: boolean;
  contactOnlyIntent?: boolean;
  salesRepId: string | null;
  salesRepName: string | null;
  industryType: string | null;
  subCategory: string | null;
  companyRegion: string | null;
  week: string | null;
  companyPhone: string | null;
  primaryContactName: string | null;
  primaryContactJobTitle?: string | null;
  primaryContactPhone: string | null;
  primaryContactExtension?: string | null;
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
  rows?: BusinessAccountRow[];
  accountLocation?: string | null;
};

export type BusinessAccountMapPoint = {
  id: string;
  accountRecordId?: string;
  businessAccountId: string;
  companyName: string;
  salesRepId: string | null;
  salesRepName: string | null;
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
  contacts?: Array<{
    rowKey?: string;
    contactId: number | null;
    name: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
    notes: string | null;
  }>;
};

export type BusinessAccountMapResponse = {
  items: BusinessAccountMapPoint[];
  totalCandidates: number;
  geocodedCount: number;
  unmappedCount: number;
};

export type PostalRegion = {
  id: string;
  name: string;
  styleId: string | null;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  fillColor: string;
  fillOpacity: number;
  polygons: Array<Array<[number, number]>>;
};

export type PostalRegionsResponse = {
  items: PostalRegion[];
  total: number;
  sourceUrl: string;
  generatedAtIso: string;
};
