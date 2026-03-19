export type MailFolder = "inbox" | "sent" | "drafts" | "starred";

export type MailConnectionStatus = "connected" | "disconnected" | "needs_setup";

export type MailActivitySyncStatus = "pending" | "synced" | "failed" | "not_linked";

export type MailLinkedContact = {
  contactId: number | null;
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  contactName: string | null;
  companyName: string | null;
};

export type MailSessionResponse = {
  status: MailConnectionStatus;
  senderEmail: string | null;
  senderDisplayName: string | null;
  expectedGoogleEmail: string | null;
  connectedGoogleEmail: string | null;
  connectionError: string | null;
  folders: MailFolder[];
};

export type MailServiceEnvelope<T> = {
  ok: boolean;
  data: T;
};

export type MailLastEmailedLookupItem = {
  businessAccountRecordId: string | null;
  businessAccountId: string | null;
  lastEmailedAt: string | null;
};

export type MailLastEmailedResponse = {
  items: MailLastEmailedLookupItem[];
};
