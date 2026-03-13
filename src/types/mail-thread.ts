import type { MailActivitySyncStatus, MailFolder, MailLinkedContact } from "@/types/mail";
import type { MailRecipient } from "@/types/mail-compose";

export type MailThreadSummary = {
  threadId: string;
  subject: string;
  snippet: string;
  folder: MailFolder;
  unread: boolean;
  starred: boolean;
  lastMessageAt: string | null;
  participants: string[];
  linkedContact: MailLinkedContact;
  activitySyncStatus: MailActivitySyncStatus;
};

export type MailMessage = {
  messageId: string;
  threadId: string;
  draftId: string | null;
  direction: "incoming" | "outgoing";
  subject: string;
  htmlBody: string;
  textBody: string;
  from: MailRecipient | null;
  to: MailRecipient[];
  cc: MailRecipient[];
  bcc: MailRecipient[];
  sentAt: string | null;
  receivedAt: string | null;
  unread: boolean;
  hasAttachments: boolean;
  activitySyncStatus: MailActivitySyncStatus;
};

export type MailThreadResponse = {
  thread: MailThreadSummary;
  messages: MailMessage[];
};

export type MailThreadListResponse = {
  items: MailThreadSummary[];
  nextCursor: string | null;
  total: number;
};

export type MailLinkContactPayload = {
  contactId: number;
  businessAccountRecordId: string;
  businessAccountId: string | null;
};
