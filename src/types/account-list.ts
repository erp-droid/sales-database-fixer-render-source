export const ACCOUNT_LIST_SCOPES = ["user", "company"] as const;

export type AccountListScope = (typeof ACCOUNT_LIST_SCOPES)[number];

export type AccountListFilterView = "allCompanies" | "marketingOnly";

export type AccountListHeaderFilters = {
  companyName: string;
  accountType: string;
  opportunityCount: string;
  salesRepName: string;
  industryType: string;
  subCategory: string;
  companyRegion: string;
  week: string;
  address: string;
  companyPhone: string;
  primaryContactName: string;
  primaryContactJobTitle: string;
  primaryContactPhone: string;
  primaryContactExtension: string;
  primaryContactEmail: string;
  notes: string;
  category: string;
  lastCalled: string;
  lastCalendarInvited: string;
  lastEmailed: string;
  lastModified: string;
};

export type AccountListFilters = {
  activeFilterView: AccountListFilterView;
  selectedCategoryFilters: string[];
  selectedWeekFilters: string[];
  selectedSalesRepFilters: string[];
  q: string;
  headerFilters: AccountListHeaderFilters;
};

export type AccountListSummary = {
  id: string;
  name: string;
  scope: AccountListScope;
  ownerLoginName: string;
  filters: AccountListFilters;
  createdAt: string;
  updatedAt: string;
};

export type AccountListsResponse = {
  items: AccountListSummary[];
};

export type AccountListCreateRequest = {
  name: string;
  scope: AccountListScope;
  filters: AccountListFilters;
};

export type AccountListCreateResponse = {
  item: AccountListSummary;
};
