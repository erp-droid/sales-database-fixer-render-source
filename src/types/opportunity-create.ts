export const OPPORTUNITY_WILL_WIN_JOB_VALUES = ["Yes", "No"] as const;

export type OpportunityWillWinJob =
  (typeof OPPORTUNITY_WILL_WIN_JOB_VALUES)[number];

export const OPPORTUNITY_PROJECT_TYPE_VALUES = [
  "Construct",
  "Electrical",
  "HVAC",
  "M-Trade",
  "Plumbing",
] as const;

export type OpportunityProjectType =
  (typeof OPPORTUNITY_PROJECT_TYPE_VALUES)[number];

export type OpportunityCreateRequest = {
  businessAccountRecordId: string;
  businessAccountId: string;
  contactId: number;
  subject: string;
  classId: string;
  location: string;
  stage: string;
  estimationDate: string;
  note: string | null;
  willWinJob: OpportunityWillWinJob;
  linkToDrive: string;
  projectType: OpportunityProjectType;
  ownerId: string | null;
  ownerName: string | null;
};

export type OpportunityClassOption = {
  value: string;
  label: string;
};

export type OpportunityCreateOptionsResponse = {
  classOptions: OpportunityClassOption[];
  defaultClassId: string;
  defaultStage: string;
  defaultLocation: string;
  defaultOwnerName: string | null;
  defaultEstimationDate: string;
  defaultLinkToDrive: string;
  projectTypeOptions: Array<{
    value: OpportunityProjectType;
    label: OpportunityProjectType;
  }>;
  requiredAttributeLabels: {
    willWinJob: string;
    linkToDrive: string;
    projectType: string;
  };
};

export type OpportunityCreateResponse = {
  created: true;
  opportunityId: string;
  businessAccountRecordId: string;
  businessAccountId: string;
  companyName: string | null;
  contactId: number;
  contactName: string | null;
  subject: string;
  ownerId: string | null;
  ownerName: string | null;
  warnings: string[];
};
