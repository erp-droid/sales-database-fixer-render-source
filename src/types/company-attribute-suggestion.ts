export type CompanyAttributeSuggestionField =
  | "industryType"
  | "subCategory"
  | "category"
  | "companyRegion";

export type CompanyAttributeSuggestionRequest = {
  companyName: string | null;
  businessAccountId: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  contactEmail: string | null;
  industryType: string | null;
  subCategory: string | null;
  category: string | null;
  companyRegion: string | null;
};

export type CompanyAttributeSuggestionSource = {
  title: string;
  url: string;
  domain: string | null;
};

export type CompanyAttributeSuggestion = {
  industryType: string | null;
  industryTypeLabel: string | null;
  subCategory: string | null;
  subCategoryLabel: string | null;
  category: string | null;
  categoryLabel: string | null;
  companyRegion: string | null;
  companyRegionLabel: string | null;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  sources: CompanyAttributeSuggestionSource[];
};

export type CompanyAttributeSuggestionResponse =
  | {
      status: "ready";
      suggestion: CompanyAttributeSuggestion;
      filledFieldKeys: CompanyAttributeSuggestionField[];
    }
  | {
      status: "need_more_context";
      message: string;
    }
  | {
      status: "no_match";
      message: string;
    };
