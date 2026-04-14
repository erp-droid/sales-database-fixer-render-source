export type SyncProgress = {
  fetchedAccounts: number;
  fetchedContacts: number;
  totalAccounts: number | null;
  totalContacts: number | null;
};

export type SyncStatusResponse = {
  status: "idle" | "running" | "failed";
  phase: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  rowsCount: number;
  accountsCount: number;
  contactsCount: number;
  progress: SyncProgress | null;
  manualSyncBlockedReason: string | null;
};

export type SyncRunResponse = {
  accepted: true;
  alreadyRunning: boolean;
  status: SyncStatusResponse;
};
