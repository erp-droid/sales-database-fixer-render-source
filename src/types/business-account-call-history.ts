import type {
  CallActivitySyncStatus,
  CallAnalyticsDirection,
  CallAnalyticsOutcome,
} from "@/lib/call-analytics/types";

export type BusinessAccountCallHistoryItem = {
  sessionId: string;
  startedAt: string | null;
  employeeDisplayName: string | null;
  employeeLoginName: string | null;
  direction: CallAnalyticsDirection;
  outcome: CallAnalyticsOutcome;
  answered: boolean;
  talkDurationSeconds: number | null;
  ringDurationSeconds: number | null;
  phoneNumber: string | null;
  contactName: string | null;
  companyName: string | null;
  recordingSid: string | null;
  recordingStatus: string | null;
  recordingDurationSeconds: number | null;
  activitySyncStatus: CallActivitySyncStatus | null;
  activityId: string | null;
  activitySyncUpdatedAt: string | null;
  summaryText: string | null;
  transcriptText: string | null;
};

export type BusinessAccountCallHistoryResponse = {
  lastCalledAt: string | null;
  items: BusinessAccountCallHistoryItem[];
};
