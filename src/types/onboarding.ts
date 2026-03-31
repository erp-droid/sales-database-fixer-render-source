export type OnboardingContactOption = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
};

export type OnboardingPaymentTermOption = {
  id: string;
  label: string;
};

export type OnboardingAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type OnboardingContactSelection =
  | {
      mode: "existing";
      contactId: number;
    }
  | {
      mode: "new";
      name: string;
      email: string;
      phone: string;
    };

export type OnboardingFormPayload = {
  billingName: string;
  billingAddress: OnboardingAddress;
  invoiceContact: OnboardingContactSelection;
  collectionsContact: {
    sameAsInvoice: boolean;
    selection: OnboardingContactSelection | null;
  };
  paymentTermsDifferent: boolean;
  paymentTermId: string;
  poRequired: boolean;
  poInstructions: string | null;
};

export type OnboardingFinalizationSummary = {
  status: "queued" | "processing" | "retrying" | "failed" | "completed";
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};

export type OnboardingPendingRequestResponse = {
  status: "pending";
  token: string;
  companyName: string | null;
  businessAccountId: string;
  opportunityId: string;
  billingAddress: OnboardingAddress;
  contacts: OnboardingContactOption[];
  defaultInvoiceContactId: number | null;
  paymentTerms: OnboardingPaymentTermOption[];
  defaultPaymentTermId: string;
  paymentTermsError?: string | null;
  submittedAt?: string | null;
  finalization?: OnboardingFinalizationSummary | null;
};

export type OnboardingStatusResponse = {
  status: "submitted" | "converted" | "failed";
  token: string;
  companyName: string | null;
  businessAccountId: string;
  opportunityId: string;
  submittedAt?: string | null;
  finalization?: OnboardingFinalizationSummary | null;
};

export type OnboardingRequestResponse =
  | OnboardingPendingRequestResponse
  | OnboardingStatusResponse;
