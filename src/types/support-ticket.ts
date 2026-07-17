export const SUPPORT_TICKET_CATEGORIES = [
  "accounts",
  "contacts",
  "mail",
  "calendar",
  "calls",
  "quotes",
  "sign_in",
  "performance",
  "other",
] as const;

export const SUPPORT_TICKET_IMPACTS = ["blocked", "major", "minor", "question"] as const;

export const SUPPORT_TICKET_STATUSES = [
  "queued",
  "investigating",
  "waiting_for_details",
  "repairing",
  "waiting_for_employee",
  "monitoring",
  "escalated",
  "resolved",
  "closed",
] as const;

export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];
export type SupportTicketImpact = (typeof SUPPORT_TICKET_IMPACTS)[number];
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export type SupportTicketUnderstanding = {
  summary: string;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
  unknowns: string[];
};

export type SupportTicketSummary = {
  id: string;
  ticketNumber: number;
  title: string;
  category: SupportTicketCategory;
  impact: SupportTicketImpact;
  status: SupportTicketStatus;
  employeeName: string;
  employeeEmail: string;
  createdAt: string;
  updatedAt: string;
  latestUpdate: string | null;
  attachmentCount: number;
  clarificationRounds: number;
  remediationAttempts: number;
  nextAction: string | null;
  understanding: SupportTicketUnderstanding | null;
};

export type SupportTicketDetail = SupportTicketSummary & {
  description: string;
  expectedBehavior: string | null;
  stepsToReproduce: string | null;
  pageUrl: string | null;
  diagnosis: string | null;
  resolution: string | null;
  attachments: Array<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  history: Array<{
    type: string;
    message: string;
    details: string[];
    createdAt: string;
  }>;
};

export type SupportTicketListResponse = {
  items: SupportTicketDetail[];
};

export type SupportTicketCreateResponse = {
  ticket: SupportTicketDetail;
};
