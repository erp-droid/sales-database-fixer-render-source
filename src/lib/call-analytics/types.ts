export type CallAnalyticsSource = "app_bridge" | "twilio_direct" | "inbound" | "unknown";

export type CallAnalyticsDirection = "outbound" | "inbound" | "internal" | "unknown";

export type CallAnalyticsOutcome =
  | "answered"
  | "no_answer"
  | "busy"
  | "failed"
  | "canceled"
  | "in_progress"
  | "unknown";

export type CallPhoneMatchType = "contact_phone" | "company_phone" | "none";

export type CallActivitySyncStatus =
  | "queued"
  | "processing"
  | "transcribed"
  | "synced"
  | "failed"
  | "skipped";

export type CallActivitySyncRecord = {
  sessionId: string;
  recordingSid: string | null;
  recordingStatus: string | null;
  recordingDurationSeconds: number | null;
  status: CallActivitySyncStatus;
  attempts: number;
  transcriptText: string | null;
  summaryText: string | null;
  activityId: string | null;
  error: string | null;
  recordingDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CallSourceFilter = "all" | "app" | "non_app";

export type CallDirectionFilter = "all" | "outbound" | "inbound";

export type CallOutcomeFilter =
  | "all"
  | "answered"
  | "unanswered"
  | "busy"
  | "failed"
  | "canceled";

export type CallBreakdownDimension =
  | "employee"
  | "outcome"
  | "company"
  | "contact"
  | "source"
  | "direction";

export type CallEmployeeDirectoryItem = {
  loginName: string;
  contactId: number | null;
  displayName: string;
  email: string | null;
  normalizedPhone: string | null;
  callerIdPhone: string | null;
  isActive: boolean;
  updatedAt: string;
};

export type CallLegRecord = {
  sid: string;
  parentSid: string | null;
  sessionId: string;
  direction: string;
  fromNumber: string | null;
  toNumber: string | null;
  status: string | null;
  answered: boolean;
  answeredAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  ringDurationSeconds: number | null;
  price: string | null;
  priceUnit: string | null;
  source: CallAnalyticsSource;
  legType: "root" | "destination" | "inbound" | "unknown";
  rawJson: string;
  updatedAt: string;
};

export type CallSessionRecord = {
  sessionId: string;
  rootCallSid: string;
  primaryLegSid: string | null;
  source: CallAnalyticsSource;
  direction: CallAnalyticsDirection;
  outcome: CallAnalyticsOutcome;
  answered: boolean;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  talkDurationSeconds: number | null;
  ringDurationSeconds: number | null;
  employeeLoginName: string | null;
  employeeDisplayName: string | null;
  employeeContactId: number | null;
  employeePhone: string | null;
  recipientEmployeeLoginName: string | null;
  recipientEmployeeDisplayName: string | null;
  presentedCallerId: string | null;
  bridgeNumber: string | null;
  targetPhone: string | null;
  counterpartyPhone: string | null;
  matchedContactId: number | null;
  matchedContactName: string | null;
  matchedBusinessAccountId: string | null;
  matchedCompanyName: string | null;
  phoneMatchType: CallPhoneMatchType;
  phoneMatchAmbiguityCount: number;
  initiatedFromSurface: "accounts" | "map" | "tasks" | "quality" | "unknown";
  linkedAccountRowKey: string | null;
  linkedBusinessAccountId: string | null;
  linkedContactId: number | null;
  metadataJson: string;
  updatedAt: string;
};

export type CallIngestState = {
  scope: "voice";
  status: "idle" | "recent_sync_running" | "full_backfill_running" | "complete" | "error";
  lastRecentSyncAt: string | null;
  lastFullBackfillAt: string | null;
  latestSeenStartTime: string | null;
  oldestSeenStartTime: string | null;
  fullHistoryComplete: boolean;
  lastWebhookAt: string | null;
  lastError: string | null;
  progress: {
    phase: "idle" | "warm_recent" | "recent_reconcile" | "historical_backfill";
    processedCalls: number;
    importedCalls: number;
    windowStartIso: string | null;
    windowEndIso: string | null;
  } | null;
  updatedAt: string;
};

export type DashboardFilters = {
  start: string;
  end: string;
  employees: string[];
  direction: CallDirectionFilter;
  outcome: CallOutcomeFilter;
  source: CallSourceFilter;
  search: string;
};

export type CallSummaryStats = {
  totalCalls: number;
  outboundCalls: number;
  inboundCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  answerRate: number;
  totalTalkSeconds: number;
  averageTalkSeconds: number;
  missedInboundCalls: number;
};

export type DashboardRecentCall = {
  sessionId: string;
  startedAt: string | null;
  employeeDisplayName: string | null;
  employeeLoginName: string | null;
  direction: CallAnalyticsDirection;
  source: CallAnalyticsSource;
  outcome: CallAnalyticsOutcome;
  answered: boolean;
  talkDurationSeconds: number | null;
  ringDurationSeconds: number | null;
  contactName: string | null;
  companyName: string | null;
  phoneNumber: string | null;
};

export type DashboardOverviewResponse = {
  filters: DashboardFilters;
  importState: CallIngestState;
  employees: Array<{
    loginName: string;
    displayName: string;
    email: string | null;
  }>;
  viewer: {
    loginName: string | null;
    displayName: string | null;
  };
  myStats: CallSummaryStats;
  myRecentCalls: DashboardRecentCall[];
  teamStats: CallSummaryStats;
};

export type DashboardTrendPoint = {
  bucketLabel: string;
  bucketStart: string;
  totalCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  talkSeconds: number;
};

export type DashboardTrendResponse = {
  filters: DashboardFilters;
  bucket: "day" | "week";
  items: DashboardTrendPoint[];
};

export type DashboardEmailSummaryStats = {
  totalSent: number;
  uniqueSenders: number;
  averagePerSender: number;
  busiestSenderLoginName: string | null;
  busiestSenderDisplayName: string | null;
  busiestSenderCount: number;
};

export type DashboardEmailTrendPoint = {
  bucketLabel: string;
  bucketStart: string;
  sentCount: number;
};

export type DashboardEmailTrendResponse = {
  filters: DashboardFilters;
  bucket: "day" | "week";
  items: DashboardEmailTrendPoint[];
};

export type DashboardEmailActivityItem = {
  loginName: string | null;
  displayName: string;
  email: string | null;
  sentCount: number;
  lastSentAt: string | null;
};

export type DashboardMeetingSummaryStats = {
  totalMeetings: number;
  uniqueBookers: number;
  averagePerBooker: number;
  totalAttendees: number;
  meetingsWithGoogleInvite: number;
};

export type DashboardMeetingActivityItem = {
  loginName: string;
  displayName: string;
  totalMeetings: number;
  totalAttendees: number;
  meetingsWithUnknownAttendeeCount: number;
  googleInviteMeetings: number;
  averageAttendees: number;
  lastMeetingAt: string | null;
};

export type DashboardRecentMeeting = {
  id: string;
  occurredAt: string;
  actorLoginName: string | null;
  actorName: string | null;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  meetingSummary: string;
  attendeeCount: number;
  inviteAuthority: "google" | "acumatica" | null;
  calendarInviteStatus: "created" | "updated" | "skipped" | "failed" | null;
};

export type DashboardRecentEmail = {
  id: string;
  occurredAt: string;
  actorLoginName: string | null;
  actorName: string | null;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  subject: string | null;
  resultCode: string;
  sourceSurface: string | null;
};

export type DashboardEmployeeActivityItem = {
  loginName: string;
  displayName: string;
  totalCalls: number;
  outboundCalls: number;
  inboundCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  answerRate: number;
  talkSeconds: number;
  averageTalkSeconds: number;
  lastCallAt: string | null;
};

export type DashboardActivityGapItem = {
  loginName: string;
  displayName: string;
  totalCalls: number;
  outboundCalls: number;
  unansweredCalls: number;
  answerRate: number;
  talkSeconds: number;
  lastCallAt: string | null;
};

export type DashboardBreakdownItem = {
  key: string;
  label: string;
  totalCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  answerRate: number;
  talkSeconds: number;
};

export type DashboardBreakdownResponse = {
  filters: DashboardFilters;
  dimension: CallBreakdownDimension;
  items: DashboardBreakdownItem[];
};

export type DashboardBucketDrilldown = {
  bucket: DashboardTrendPoint;
  bucketEnd: string;
  stats: CallSummaryStats;
  employees: DashboardEmployeeActivityItem[];
  outcomes: DashboardBreakdownItem[];
  sources: DashboardBreakdownItem[];
  companies: DashboardBreakdownItem[];
  calls: DashboardRecentCall[];
};

export type DashboardSnapshotResponse = {
  filters: DashboardFilters;
  generatedAt: string;
  cacheExpiresAt: string;
  importState: CallIngestState;
  backgroundRefreshTriggered: boolean;
  viewer: {
    loginName: string | null;
  };
  employees: Array<{
    loginName: string;
    displayName: string;
    email: string | null;
  }>;
  teamStats: CallSummaryStats;
  meetingStats: DashboardMeetingSummaryStats;
  emailStats: DashboardEmailSummaryStats;
  trend: DashboardTrendResponse;
  emailTrend: DashboardEmailTrendResponse;
  bucketDrilldowns: DashboardBucketDrilldown[];
  employeeLeaderboard: DashboardEmployeeActivityItem[];
  meetingLeaderboard: DashboardMeetingActivityItem[];
  emailLeaderboard: DashboardEmailActivityItem[];
  activityGaps: DashboardActivityGapItem[];
  outcomeSummary: DashboardBreakdownItem[];
  sourceSummary: DashboardBreakdownItem[];
  companySummary: DashboardBreakdownItem[];
  recentCalls: DashboardRecentCall[];
  recentMeetings: DashboardRecentMeeting[];
  recentEmails: DashboardRecentEmail[];
};

export type DashboardCallListResponse = {
  filters: DashboardFilters;
  importState: CallIngestState;
  backgroundRefreshTriggered: boolean;
  viewer: {
    loginName: string | null;
  };
  employees: Array<{
    loginName: string;
    displayName: string;
    email: string | null;
  }>;
  page: number;
  pageSize: number;
  total: number;
  items: DashboardRecentCall[];
};

export type DashboardCallDetailResponse = {
  session: CallSessionRecord;
  legs: CallLegRecord[];
  timeline: Array<{
    label: string;
    status: string;
    occurredAt: string | null;
    legSid: string | null;
  }>;
  activitySync: Pick<
    CallActivitySyncRecord,
    "status" | "activityId" | "error" | "updatedAt"
  > | null;
};
