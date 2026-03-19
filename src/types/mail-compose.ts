import type { MailLinkedContact } from "@/types/mail";

export type MailRecipient = {
  email: string;
  name: string | null;
  contactId: number | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
};

export type MailAttachmentInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64Data: string;
};

export type MailContactSuggestion = {
  key: string;
  email: string;
  name: string | null;
  companyName: string | null;
  contactId: number | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
};

export type MailMatchedContact = {
  contactId: number;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  contactName: string | null;
  companyName: string | null;
  email: string | null;
};

export type MailComposePayload = {
  threadId: string | null;
  draftId: string | null;
  subject: string;
  htmlBody: string;
  textBody: string;
  to: MailRecipient[];
  cc: MailRecipient[];
  bcc: MailRecipient[];
  linkedContact: MailLinkedContact;
  matchedContacts?: MailMatchedContact[];
  attachments: MailAttachmentInput[];
  sourceSurface: "accounts" | "mail";
};

export type MailSendResponse = {
  sent: true;
  threadId: string;
  messageId: string;
  draftId: string | null;
  activitySyncStatus: "pending" | "synced" | "failed" | "not_linked";
  activityId?: string | null;
  activityIds?: string[];
  activityError?: string | null;
};

export type MailDraftResponse = {
  saved: true;
  threadId: string | null;
  draftId: string;
};
