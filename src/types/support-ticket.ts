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
  "repairing",
  "waiting_for_employee",
  "escalated",
  "resolved",
  "closed",
] as const;

export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];
export type SupportTicketImpact = (typeof SUPPORT_TICKET_IMPACTS)[number];
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

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
};

export type SupportTicketListResponse = {
  items: SupportTicketSummary[];
};

export type SupportTicketCreateResponse = {
  ticket: SupportTicketSummary;
};
