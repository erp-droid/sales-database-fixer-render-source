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
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    source: "submission" | "email_reply";
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
  scope: "mine" | "all";
};

export type SupportTicketCreateResponse = {
  ticket: SupportTicketDetail;
};

export type SupportTicketCloseResponse = {
  ok: true;
  alreadyClosed: boolean;
  ticket: {
    id: string;
    status: "closed";
    updatedAt: string;
    latestUpdate: string | null;
    nextAction: null;
  };
  event: {
    type: "closed_by_support_owner";
    message: string;
    details: string[];
    createdAt: string;
  } | null;
};

export type SupportTicketReplyResponse = {
  ok: true;
  ticket: {
    id: string;
    updatedAt: string;
    latestUpdate: string | null;
  };
  event: {
    type: "support_owner_reply_sent";
    message: string;
    details: string[];
    createdAt: string;
  };
};

export type SupportTicketStatusUpdateResponse = {
  ok: true;
  changed: boolean;
  ticket: {
    id: string;
    status: SupportTicketStatus;
    updatedAt: string;
    latestUpdate: string | null;
    nextAction: string | null;
  };
  event: {
    type: "status_changed_by_support_owner";
    message: string;
    details: string[];
    createdAt: string;
  } | null;
};

export type SupportTicketConversationParticipant = {
  name: string | null;
  email: string;
};

export type SupportTicketConversationMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  from: SupportTicketConversationParticipant | null;
  to: SupportTicketConversationParticipant[];
  subject: string;
  body: string;
  timestamp: string | null;
  hasAttachments: boolean;
};

export type SupportTicketConversationResponse = {
  available: boolean;
  subject: string | null;
  items: SupportTicketConversationMessage[];
};
