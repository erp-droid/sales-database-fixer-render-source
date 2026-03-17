export type ContactEnhanceFilledFieldKey = "name" | "jobTitle" | "email" | "phone";

export type ContactEnhanceRequest = {
  companyName: string | null;
  businessAccountId: string | null;
  contactName: string | null;
  contactJobTitle?: string | null;
  candidateCurrentTitle?: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  candidatePersonId?: number | null;
};

export type ContactEnhanceCandidate = {
  id: number;
  name: string | null;
  currentTitle: string | null;
  currentEmployer: string | null;
  location: string | null;
  linkedinUrl: string | null;
};

export type ContactEnhanceSuggestion = {
  name: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
};

export type ContactEnhanceReadyResponse = {
  status: "ready";
  suggestion: ContactEnhanceSuggestion;
  filledFieldKeys: ContactEnhanceFilledFieldKey[];
};

export type ContactEnhanceNeedsSelectionResponse = {
  status: "needs_selection";
  candidates: ContactEnhanceCandidate[];
};

export type ContactEnhanceNoMatchResponse = {
  status: "no_match";
  message: string;
};

export type ContactEnhanceNeedMoreContextResponse = {
  status: "need_more_context";
  message: string;
};

export type ContactEnhanceResponse =
  | ContactEnhanceReadyResponse
  | ContactEnhanceNeedsSelectionResponse
  | ContactEnhanceNoMatchResponse
  | ContactEnhanceNeedMoreContextResponse;
