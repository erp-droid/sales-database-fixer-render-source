import { getEnv } from "@/lib/env";
import { HttpError, getErrorMessage } from "@/lib/errors";
import {
  serviceFindContactsByEmailSubstring,
} from "@/lib/acumatica-service-auth";
import {
  readWrappedNumber,
  readWrappedString,
} from "@/lib/acumatica";
import { readCallEmployeeDirectory } from "@/lib/call-analytics/employee-directory";
import { readCallIngestState } from "@/lib/call-analytics/ingest";
import { countRemainingCallActivitySyncJobs } from "@/lib/call-analytics/postcall-worker";
import { readCallActivitySyncBySessionId } from "@/lib/call-analytics/postcall-store";
import { readCallSessions } from "@/lib/call-analytics/sessionize";
import type { CallIngestState } from "@/lib/call-analytics/types";
import { buildMailServiceAssertion, ensureMailServiceConfigured } from "@/lib/mail-auth";
import { getReadModelDb } from "@/lib/read-model/db";
import type { MailComposePayload, MailRecipient } from "@/types/mail-compose";

const DAILY_COACHING_MODEL_FALLBACK = "gpt-4o-mini";
const MAX_MODEL_CALLS = 40;
const MAX_TRANSCRIPT_CHARS_PER_CALL = 1_200;
const OPENAI_COACHING_TIMEOUT_MS = 25_000;
const MAIL_SEND_TIMEOUT_MS = 20_000;

export type DailyCallCoachingCall = {
  sessionId: string;
  startedAt: string | null;
  localTimeLabel: string;
  contactName: string | null;
  companyName: string | null;
  answered: boolean;
  outcome: string;
  talkDurationSeconds: number;
  transcriptText: string | null;
  summaryText: string | null;
  analysisSource: "transcript" | "summary" | "metadata";
};

export type DailyCallCoachingStats = {
  totalCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  totalTalkSeconds: number;
  averageTalkSeconds: number;
  uniqueNamedContacts: number;
  unresolvedCalls: number;
  shortCalls: number;
  mediumCalls: number;
  longCalls: number;
  matchedCalls: number;
};

type DailyCallCoachingScorecard = {
  effort: number;
  conversationQuality: number;
  targeting: number;
};

type DailyCallCoachingOpportunity = {
  title: string;
  detail: string;
};

type DailyCallCoachingActionItem = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

type DailyCallCoachingCallReview = {
  label: string;
  why: string;
};

type DailyCallCoachingFollowUp = {
  label: string;
  action: string;
  reason: string;
  priority: "high" | "medium" | "low";
};

export type DailyCallCoachingContent = {
  headline: string;
  executiveSummary: string;
  scorecard: DailyCallCoachingScorecard;
  strengths: string[];
  opportunities: DailyCallCoachingOpportunity[];
  actionItems: DailyCallCoachingActionItem[];
  strongCalls: DailyCallCoachingCallReview[];
  weakCalls: DailyCallCoachingCallReview[];
  followUps: DailyCallCoachingFollowUp[];
  confidenceNote: string;
};

export type DailyCallCoachingReport = {
  reportDate: string;
  subjectLoginName: string;
  subjectDisplayName: string;
  recipientEmail: string;
  previewMode: boolean;
  senderLoginName: string;
  stats: DailyCallCoachingStats;
  calls: DailyCallCoachingCall[];
  content: DailyCallCoachingContent;
  subjectLine: string;
};

export type DailyCallCoachingRunItem = {
  subjectLoginName: string;
  subjectDisplayName: string;
  recipientEmail: string;
  status: "sent" | "skipped" | "failed";
  detail: string;
  sessionCount: number;
  analyzedCallCount: number;
  transcriptCallCount: number;
  subjectLine: string | null;
};

export type DailyCallCoachingCoverage = {
  complete: boolean;
  detail: string;
  snapshotLastRecentSyncAt: string | null;
  snapshotLatestSeenStartTime: string | null;
  snapshotLastError: string | null;
  remainingCallSyncCount: number;
};

export type DailyCallCoachingRunResult = {
  reportDate: string;
  senderLoginName: string;
  ranAt: string;
  items: DailyCallCoachingRunItem[];
  dataCoverage: DailyCallCoachingCoverage;
};

type InternalMailboxProfile = {
  loginName: string;
  displayName: string;
  email: string;
  contactId: number | null;
};

type StoredDailyCallCoachingRow = {
  report_date: string;
  subject_login_name: string;
  recipient_email: string;
  sender_login_name: string;
  status: string;
  preview_mode: number;
  session_count: number;
  analyzed_call_count: number;
  transcript_call_count: number;
  subject_line: string | null;
  report_json: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type OpenAiTextContent = {
  text?: unknown;
};

type OpenAiOutputItem = {
  content?: unknown;
};

type OpenAiResponsePayload = {
  output?: unknown;
  error?: unknown;
};

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeComparable(value: string | null | undefined): string {
  return cleanText(value).toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function readDateParts(value: string, timeZone: string): {
  year: string;
  month: string;
  day: string;
} | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";

  if (!year || !month || !day) {
    return null;
  }

  return { year, month, day };
}

function formatLocalDateKey(value: string | null | undefined, timeZone: string): string | null {
  if (!value) {
    return null;
  }

  const parts = readDateParts(value, timeZone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

function formatDisplayDate(reportDate: string, timeZone: string): string {
  const date = new Date(`${reportDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function readDailyCallCoachingTimeZone(): string {
  return cleanText(process.env.DAILY_CALL_COACHING_TIME_ZONE) || "America/Toronto";
}

function formatLocalTimeLabel(value: string | null | undefined, timeZone: string): string {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDurationLabel(seconds: number): string {
  const clamped = Math.max(0, Math.trunc(seconds));
  if (clamped < 60) {
    return `${clamped}s`;
  }

  const minutes = Math.floor(clamped / 60);
  const remainder = clamped % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function buildCallLabel(call: DailyCallCoachingCall): string {
  return [call.contactName, call.companyName].filter(Boolean).join(" / ") || "Unresolved target";
}

function buildCallEvidenceLabel(call: DailyCallCoachingCall): string {
  return `${call.localTimeLabel} · ${call.answered ? "answered" : call.outcome} · ${formatDurationLabel(call.talkDurationSeconds)} · ${call.analysisSource}`;
}

function readCallContext(call: DailyCallCoachingCall): string {
  return cleanText([call.summaryText, call.transcriptText].filter(Boolean).join(" "));
}

function buildSpecificityReason(call: DailyCallCoachingCall): string | null {
  const context = normalizeComparable(readCallContext(call));
  if (!context) {
    return null;
  }

  if (/(follow|next|touchpoint|callback|call back|schedule|timing)/.test(context)) {
    return "The notes point to a concrete next step or timing, which means the close likely landed with more clarity.";
  }
  if (/(quote|pricing|price|availability|spec|sample|proposal|demo|meeting|visit)/.test(context)) {
    return "The conversation moved into specific commercial details instead of staying at a surface-level introduction.";
  }
  if (/(decision|approval|review|send)/.test(context)) {
    return "The notes suggest movement around review, approval, or sending material, which usually means the conversation created momentum.";
  }

  return null;
}

function buildStrongCallReason(call: DailyCallCoachingCall): string {
  const specificReason = buildSpecificityReason(call);
  if (specificReason) {
    return `${specificReason} Evidence: ${buildCallEvidenceLabel(call)}.`;
  }

  if (call.talkDurationSeconds >= 120) {
    return `The contact stayed engaged for ${formatDurationLabel(call.talkDurationSeconds)}, which is long enough to get beyond the opener and into a real business conversation. Evidence: ${buildCallEvidenceLabel(call)}.`;
  }

  if (call.analysisSource !== "metadata") {
    return `There is usable call evidence attached to this conversation, which gives you something concrete to coach and follow up on instead of guessing from duration alone. Evidence: ${buildCallEvidenceLabel(call)}.`;
  }

  return `This call stands out mainly because it held attention longer than most of the day and was tied to a real person or account. Evidence: ${buildCallEvidenceLabel(call)}.`;
}

function buildWeakCallReason(call: DailyCallCoachingCall): string {
  if (!call.answered) {
    return `This dial did not convert into a live conversation. The result was ${call.outcome.replace(/_/g, " ")}, so the issue is likely at the opener, targeting, or contact timing stage. Evidence: ${buildCallEvidenceLabel(call)}.`;
  }

  if (call.talkDurationSeconds < 30) {
    return `The conversation ended in ${formatDurationLabel(call.talkDurationSeconds)}, so there was very little room for discovery or a strong next-step close. Evidence: ${buildCallEvidenceLabel(call)}.`;
  }

  if (!call.contactName && !call.companyName) {
    return `The call is not tied to a resolved person or company, which weakens targeting and makes disciplined follow-up harder. Evidence: ${buildCallEvidenceLabel(call)}.`;
  }

  if (call.analysisSource === "metadata") {
    return `There is no transcript or summary evidence attached, so the call did not leave a strong record of what moved forward. Evidence: ${buildCallEvidenceLabel(call)}.`;
  }

  return `This conversation did not leave enough proof of a clear commitment or next step, so it should be treated as unfinished work. Evidence: ${buildCallEvidenceLabel(call)}.`;
}

function buildFollowUpRecommendation(call: DailyCallCoachingCall): DailyCallCoachingFollowUp | null {
  const context = normalizeComparable(readCallContext(call));
  const label = buildCallLabel(call);
  const evidence = buildCallEvidenceLabel(call);

  if (!call.answered) {
    return null;
  }

  if (context) {
    if (/(quote|pricing|price|proposal)/.test(context)) {
      return {
        label,
        action: "Send the commercial follow-up you discussed and anchor it to a concrete reply window.",
        reason: `The notes reference pricing or proposal work, so this conversation needs a same-day commercial follow-up. Evidence: ${evidence}.`,
        priority: "high",
      };
    }

    if (/(availability|schedule|timing|follow|next|touchpoint|callback|call back)/.test(context)) {
      return {
        label,
        action: "Book or confirm the next touchpoint while the timing discussed is still fresh.",
        reason: `The call notes mention timing or a next touchpoint, so the follow-up should lock in the next move rather than waiting. Evidence: ${evidence}.`,
        priority: "high",
      };
    }

    if (/(spec|sample|meeting|demo|visit|review|approval|send)/.test(context)) {
      return {
        label,
        action: "Send the promised material or recap and make the next owner/date explicit.",
        reason: `The conversation moved into specifics, which usually means the follow-up should carry the deal forward with written confirmation. Evidence: ${evidence}.`,
        priority: "medium",
      };
    }
  }

  if ((call.contactName || call.companyName) && call.talkDurationSeconds >= 120) {
    return {
      label,
      action: "Send a short same-day recap and pin down the next concrete step.",
      reason: `This was one of the longer named conversations of the day, so it deserves a fast follow-up before the momentum cools. Evidence: ${evidence}.`,
      priority: "medium",
    };
  }

  return null;
}

function buildCallQualityScore(call: DailyCallCoachingCall): number {
  let score = 0;
  if (!call.answered) {
    return -5;
  }

  if (call.talkDurationSeconds >= 120) {
    score += 3;
  } else if (call.talkDurationSeconds >= 60) {
    score += 2;
  } else if (call.talkDurationSeconds >= 30) {
    score += 1;
  } else {
    score -= 3;
  }

  if (call.contactName || call.companyName) {
    score += 1;
  } else {
    score -= 1;
  }

  if (call.analysisSource === "transcript") {
    score += 2;
  } else if (call.analysisSource === "summary") {
    score += 1;
  } else {
    score -= 1;
  }

  if (buildSpecificityReason(call)) {
    score += 2;
  }

  return score;
}

function readOutputItems(payload: unknown): OpenAiOutputItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const output = (payload as OpenAiResponsePayload).output;
  return Array.isArray(output) ? (output as OpenAiOutputItem[]) : [];
}

function readOutputText(payload: unknown): string | null {
  for (const item of readOutputItems(payload)) {
    const content = Array.isArray(item.content) ? (item.content as OpenAiTextContent[]) : [];
    for (const contentItem of content) {
      const text = cleanText(typeof contentItem.text === "string" ? contentItem.text : null);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseOpenAiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const directError = cleanText(typeof record.error === "string" ? record.error : null);
  if (directError) {
    return directError;
  }

  const nestedError =
    record.error && typeof record.error === "object"
      ? cleanText(typeof (record.error as Record<string, unknown>).message === "string"
          ? (record.error as Record<string, unknown>).message as string
          : null)
      : "";
  return nestedError || fallback;
}

function readComparableTimestamp(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function pickSubjectLogins(reportDate: string, timeZone: string, specificLoginName?: string | null): string[] {
  if (specificLoginName) {
    return [normalizeComparable(specificLoginName)];
  }

  const logins = new Set<string>();
  for (const session of readCallSessions()) {
    const loginName = normalizeComparable(session.employeeLoginName);
    if (!loginName || session.direction !== "outbound") {
      continue;
    }

    const dateKey = formatLocalDateKey(session.startedAt ?? session.updatedAt, timeZone);
    if (dateKey !== reportDate) {
      continue;
    }

    logins.add(loginName);
  }

  return [...logins].sort();
}

export function buildDailyCallCoachingCoverage(
  reportDate: string,
  timeZone: string,
  state: CallIngestState,
): DailyCallCoachingCoverage {
  const snapshotLastRecentSyncAt = state.lastRecentSyncAt ?? null;
  const snapshotLatestSeenStartTime = state.latestSeenStartTime ?? null;
  const snapshotLastError = cleanText(state.lastError) || null;
  const snapshotDateKey = formatLocalDateKey(snapshotLastRecentSyncAt, timeZone);
  const remainingCallSyncCount = countRemainingCallActivitySyncJobs({
    localDateKey: reportDate,
    timeZone,
  });

  if (snapshotLastError) {
    return {
      complete: false,
      detail: `Call import reported an error: ${snapshotLastError}`,
      snapshotLastRecentSyncAt,
      snapshotLatestSeenStartTime,
      snapshotLastError,
      remainingCallSyncCount,
    };
  }

  if (!snapshotLastRecentSyncAt || !snapshotDateKey) {
    return {
      complete: false,
      detail: "Call import has not completed a recent sync yet.",
      snapshotLastRecentSyncAt,
      snapshotLatestSeenStartTime,
      snapshotLastError,
      remainingCallSyncCount,
    };
  }

  // The 7 AM coaching run is read-only. It only trusts data that the 5 PM sync
  // pipeline has already imported and fully processed for the report date.
  if (snapshotDateKey < reportDate) {
    return {
      complete: false,
      detail: `Call import is only confirmed through ${snapshotDateKey}.`,
      snapshotLastRecentSyncAt,
      snapshotLatestSeenStartTime,
      snapshotLastError,
      remainingCallSyncCount,
    };
  }

  if (remainingCallSyncCount > 0) {
    return {
      complete: false,
      detail: `${remainingCallSyncCount} call activity job(s) for ${reportDate} are still pending processing.`,
      snapshotLastRecentSyncAt,
      snapshotLatestSeenStartTime,
      snapshotLastError,
      remainingCallSyncCount,
    };
  }

  return {
    complete: true,
    detail: `Call import and post-call processing are complete for ${reportDate}.`,
    snapshotLastRecentSyncAt,
    snapshotLatestSeenStartTime,
    snapshotLastError,
    remainingCallSyncCount,
  };
}

function readDailyCallCoachingRow(
  reportDate: string,
  subjectLoginName: string,
  recipientEmail: string,
): StoredDailyCallCoachingRow | null {
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        report_date,
        subject_login_name,
        recipient_email,
        sender_login_name,
        status,
        preview_mode,
        session_count,
        analyzed_call_count,
        transcript_call_count,
        subject_line,
        report_json,
        error_message,
        sent_at,
        created_at,
        updated_at
      FROM daily_call_coaching_reports
      WHERE report_date = ?
        AND subject_login_name = ?
        AND recipient_email = ?
      `,
    )
    .get(reportDate, subjectLoginName, normalizeComparable(recipientEmail)) as
    | StoredDailyCallCoachingRow
    | undefined;

  return row ?? null;
}

function writeDailyCallCoachingRow(input: {
  reportDate: string;
  subjectLoginName: string;
  recipientEmail: string;
  senderLoginName: string;
  previewMode: boolean;
  status: "sent" | "skipped" | "failed";
  sessionCount: number;
  analyzedCallCount: number;
  transcriptCallCount: number;
  subjectLine: string | null;
  reportJson: string | null;
  errorMessage: string | null;
  sentAt: string | null;
}): void {
  const db = getReadModelDb();
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO daily_call_coaching_reports (
      report_date,
      subject_login_name,
      recipient_email,
      sender_login_name,
      status,
      preview_mode,
      session_count,
      analyzed_call_count,
      transcript_call_count,
      subject_line,
      report_json,
      error_message,
      sent_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_date, subject_login_name, recipient_email) DO UPDATE SET
      sender_login_name = excluded.sender_login_name,
      status = excluded.status,
      preview_mode = excluded.preview_mode,
      session_count = excluded.session_count,
      analyzed_call_count = excluded.analyzed_call_count,
      transcript_call_count = excluded.transcript_call_count,
      subject_line = excluded.subject_line,
      report_json = excluded.report_json,
      error_message = excluded.error_message,
      sent_at = excluded.sent_at,
      updated_at = excluded.updated_at
    `,
  ).run(
    input.reportDate,
    normalizeComparable(input.subjectLoginName),
    normalizeComparable(input.recipientEmail),
    normalizeComparable(input.senderLoginName),
    input.status,
    input.previewMode ? 1 : 0,
    input.sessionCount,
    input.analyzedCallCount,
    input.transcriptCallCount,
    input.subjectLine,
    input.reportJson,
    input.errorMessage,
    input.sentAt,
    now,
    now,
  );
}

function findDirectoryMailbox(loginName: string): InternalMailboxProfile | null {
  const normalizedLogin = normalizeComparable(loginName);
  const employee =
    readCallEmployeeDirectory().find((item) => normalizeComparable(item.loginName) === normalizedLogin) ??
    null;
  if (!employee?.email) {
    return null;
  }

  return {
    loginName: employee.loginName,
    displayName: cleanText(employee.displayName) || employee.loginName,
    email: employee.email,
    contactId: employee.contactId ?? null,
  };
}

async function resolveInternalMailboxProfile(input: {
  loginName: string;
  email?: string | null;
  displayName?: string | null;
}): Promise<InternalMailboxProfile> {
  const env = getEnv();
  const normalizedLogin = normalizeComparable(input.loginName);
  if (!normalizedLogin) {
    throw new Error("An internal login name is required.");
  }

  const fromDirectory = findDirectoryMailbox(normalizedLogin);
  const email =
    cleanText(input.email) ||
    cleanText(fromDirectory?.email) ||
    `${normalizedLogin}@${env.MAIL_INTERNAL_DOMAIN}`;
  const displayName =
    cleanText(input.displayName) ||
    cleanText(fromDirectory?.displayName) ||
    normalizedLogin;

  let contactId = fromDirectory?.contactId ?? null;
  if (!contactId && email) {
    try {
      const contacts = await serviceFindContactsByEmailSubstring(
        null,
        email,
      );
      const exactMatch =
        contacts.find((contact) => {
          const contactEmail =
            readWrappedString(contact, "Email") || readWrappedString(contact, "EMail");
          return normalizeComparable(contactEmail) === normalizeComparable(email);
        }) ?? null;
      if (exactMatch) {
        contactId = readWrappedNumber(exactMatch, "ContactID");
      }
    } catch {
      contactId = null;
    }
  }

  return {
    loginName: normalizedLogin,
    displayName,
    email,
    contactId,
  };
}

function buildDailyCallList(
  subjectLoginName: string,
  reportDate: string,
  timeZone: string,
): DailyCallCoachingCall[] {
  return readCallSessions()
    .filter((session) => {
      return (
        normalizeComparable(session.employeeLoginName) === normalizeComparable(subjectLoginName) &&
        session.direction === "outbound" &&
        formatLocalDateKey(session.startedAt ?? session.updatedAt, timeZone) === reportDate
      );
    })
    .sort((left, right) => {
      return (
        readComparableTimestamp(left.startedAt ?? left.updatedAt) -
        readComparableTimestamp(right.startedAt ?? right.updatedAt)
      );
    })
    .map((session) => {
      const sync = readCallActivitySyncBySessionId(session.sessionId);
      const transcriptText = cleanText(sync?.transcriptText) || null;
      const summaryText = cleanText(sync?.summaryText) || null;
      const talkDurationSeconds = Math.max(0, session.talkDurationSeconds ?? 0);

      return {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        localTimeLabel: formatLocalTimeLabel(session.startedAt ?? session.updatedAt, timeZone),
        contactName: cleanText(session.matchedContactName) || null,
        companyName: cleanText(session.matchedCompanyName) || null,
        answered: session.answered,
        outcome: cleanText(session.outcome) || "unknown",
        talkDurationSeconds,
        transcriptText,
        summaryText,
        analysisSource: transcriptText ? "transcript" : summaryText ? "summary" : "metadata",
      };
    });
}

export function buildDailyCallCoachingStats(calls: DailyCallCoachingCall[]): DailyCallCoachingStats {
  const namedContacts = new Set<string>();
  let totalTalkSeconds = 0;
  let unresolvedCalls = 0;
  let shortCalls = 0;
  let mediumCalls = 0;
  let longCalls = 0;
  let matchedCalls = 0;
  let answeredCalls = 0;
  let unansweredCalls = 0;

  for (const call of calls) {
    totalTalkSeconds += call.talkDurationSeconds;
    if (call.answered) {
      answeredCalls += 1;
    } else {
      unansweredCalls += 1;
    }
    if (call.contactName || call.companyName) {
      matchedCalls += 1;
    } else {
      unresolvedCalls += 1;
    }

    const comparableTarget = normalizeComparable(
      [call.contactName, call.companyName].filter(Boolean).join(" / "),
    );
    if (comparableTarget) {
      namedContacts.add(comparableTarget);
    }

    if (call.talkDurationSeconds < 30) {
      shortCalls += 1;
    } else if (call.talkDurationSeconds < 120) {
      mediumCalls += 1;
    } else {
      longCalls += 1;
    }
  }

  return {
    totalCalls: calls.length,
    answeredCalls,
    unansweredCalls,
    totalTalkSeconds,
    averageTalkSeconds: calls.length > 0 ? totalTalkSeconds / calls.length : 0,
    uniqueNamedContacts: namedContacts.size,
    unresolvedCalls,
    shortCalls,
    mediumCalls,
    longCalls,
    matchedCalls,
  };
}

function buildCallRosterForModel(calls: DailyCallCoachingCall[]): string {
  return calls
    .slice(0, MAX_MODEL_CALLS)
    .map((call, index) => {
      const label =
        [call.contactName, call.companyName].filter(Boolean).join(" / ") || "Unresolved target";
      const lines = [
        `${index + 1}. ${call.localTimeLabel} | ${label} | ${call.answered ? "answered" : call.outcome} | ${formatDurationLabel(call.talkDurationSeconds)} | ${call.analysisSource}`,
      ];
      if (call.summaryText) {
        lines.push(`Summary: ${call.summaryText}`);
      }
      if (call.transcriptText) {
        lines.push(
          `Transcript excerpt: ${call.transcriptText.slice(0, MAX_TRANSCRIPT_CHARS_PER_CALL)}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export function buildFallbackDailyCallCoachingContent(input: {
  subjectDisplayName: string;
  stats: DailyCallCoachingStats;
  transcriptCallCount: number;
  calls: DailyCallCoachingCall[];
}): DailyCallCoachingContent {
  const strengths: string[] = [];
  const opportunities: DailyCallCoachingOpportunity[] = [];
  const actionItems: DailyCallCoachingActionItem[] = [];

  if (input.stats.totalCalls >= 20) {
    strengths.push("You kept the phone moving and created real volume instead of waiting for perfect conditions.");
  }
  if (input.stats.answeredCalls >= Math.max(4, Math.ceil(input.stats.totalCalls / 4))) {
    strengths.push("A solid share of your dials turned into real conversations instead of dying at the connect stage.");
  }
  if (input.stats.longCalls >= 3) {
    strengths.push("You generated multiple longer conversations, which usually means the opener earned enough trust to keep talking.");
  }
  if (input.stats.matchedCalls >= Math.ceil(input.stats.totalCalls / 3)) {
    strengths.push("A healthy share of your calls were tied to real people or accounts, which makes follow-up cleaner.");
  }
  if (strengths.length === 0) {
    strengths.push("You stayed active on the phones, which keeps the pipeline moving even on uneven call days.");
  }

  if (input.stats.shortCalls > input.stats.mediumCalls + input.stats.longCalls) {
    opportunities.push({
      title: "Too many conversations ended before the first real turn",
      detail:
        "The day skewed heavily toward short calls. That usually means the opener, reason-for-call, or first question is not buying enough permission to continue.",
    });
    actionItems.push({
      title: "Rebuild your first 12 seconds",
      detail:
        "Use a tighter opener: who you are, why you are calling today, and one concrete reason the person should stay on the line.",
      priority: "high",
    });
  }

  if (input.stats.unansweredCalls > input.stats.answeredCalls) {
    opportunities.push({
      title: "Too many dials failed before a real conversation started",
      detail:
        "The day had more unanswered outcomes than answered ones. That usually points to targeting, timing, or the first contact attempt strategy rather than mid-call skill alone.",
    });
    actionItems.push({
      title: "Tighten the first-connect strategy",
      detail:
        "Reorder tomorrow's call block around best-answer windows, sharper target lists, and faster second attempts on priority accounts.",
      priority: "high",
    });
  }

  if (input.stats.unresolvedCalls >= 5) {
    opportunities.push({
      title: "Too many dials were not tied to a known account or contact",
      detail:
        "Unresolved calls make it harder to personalize and harder to build a clean follow-up queue after the call ends.",
    });
    actionItems.push({
      title: "Tighten pre-call targeting",
      detail:
        "Launch more calls from mapped account records or confirm the right contact before dialing so the context is ready when the call connects.",
      priority: "high",
    });
  }

  if (input.stats.uniqueNamedContacts < Math.max(3, Math.floor(input.stats.totalCalls / 6))) {
    opportunities.push({
      title: "The day may have leaned too hard on repeat retries",
      detail:
        "A narrow target list can create activity without creating enough fresh conversations. Mix in more new names between retries.",
    });
    actionItems.push({
      title: "Broaden the next block",
      detail:
        "For your next calling block, mix new contacts with follow-up retries instead of clustering too many repeat dials together.",
      priority: "medium",
    });
  }

  if (input.transcriptCallCount === 0) {
    opportunities.push({
      title: "This report is reading call patterns, not voice content",
      detail:
        "There were no usable transcripts attached to these calls, so the coaching is based on duration, targeting, and conversation shape rather than word-for-word language.",
    });
    actionItems.push({
      title: "Flag a few calls for deep review",
      detail:
        "When recordings are available, review two of the longest calls and tighten the opener, discovery question, and next-step close.",
      priority: "medium",
    });
  }

  if (actionItems.length === 0) {
    actionItems.push({
      title: "Add a stronger close",
      detail:
        "End each solid conversation with one specific next step, one owner, and one timeframe instead of ending on a vague promise to reconnect.",
      priority: "medium",
    });
  }

  const scoredCalls = input.calls.map((call) => ({
    call,
    score: buildCallQualityScore(call),
  }));
  const strongCalls = scoredCalls
    .filter((item) => item.score >= 2)
    .sort((left, right) => right.score - left.score || right.call.talkDurationSeconds - left.call.talkDurationSeconds)
    .slice(0, 4)
    .map((item) => ({
      label: buildCallLabel(item.call),
      why: buildStrongCallReason(item.call),
    }));
  const weakCalls = scoredCalls
    .filter((item) => item.score <= 1)
    .sort((left, right) => left.score - right.score || left.call.talkDurationSeconds - right.call.talkDurationSeconds)
    .slice(0, 4)
    .map((item) => ({
      label: buildCallLabel(item.call),
      why: buildWeakCallReason(item.call),
    }));
  const followUps = input.calls
    .map((call) => buildFollowUpRecommendation(call))
    .filter((item): item is DailyCallCoachingFollowUp => Boolean(item))
    .slice(0, 5);

  if (strongCalls.length === 0 && input.calls[0]) {
    strongCalls.push({
      label: buildCallLabel(input.calls[0]),
      why: `This call is worth reviewing because it represents one of the clearest pieces of evidence from the day. Evidence: ${buildCallEvidenceLabel(input.calls[0])}.`,
    });
  }

  if (weakCalls.length === 0 && input.calls.at(-1)) {
    const lastCall = input.calls.at(-1);
    if (lastCall) {
      weakCalls.push({
        label: buildCallLabel(lastCall),
        why: `This conversation should be tightened because there is limited proof of what moved forward. Evidence: ${buildCallEvidenceLabel(lastCall)}.`,
      });
    }
  }

  if (followUps.length === 0) {
    const bestNamedCall =
      [...input.calls]
        .filter((call) => call.contactName || call.companyName)
        .sort((left, right) => right.talkDurationSeconds - left.talkDurationSeconds)[0] ?? null;
    if (bestNamedCall) {
      followUps.push({
        label: buildCallLabel(bestNamedCall),
        action: "Send a same-day recap and ask for the next date/owner explicitly.",
        reason: `This was one of the strongest named conversations of the day, so it should not be left without a written follow-up. Evidence: ${buildCallEvidenceLabel(bestNamedCall)}.`,
        priority: "medium",
      });
    }
  }

  return {
    headline: `${input.subjectDisplayName}'s day had strong activity, but the next improvement is turning more short connects into structured conversations.`,
    executiveSummary:
      "This coaching summary is grounded in today's call patterns. The rep generated activity, but the biggest upside is a tighter opener, cleaner targeting, and a firmer next-step close.",
    scorecard: {
      effort: clampScore(3 + input.stats.totalCalls / 4),
      conversationQuality: clampScore(3 + input.stats.longCalls * 1.5 + input.stats.mediumCalls * 0.3 - input.stats.shortCalls * 0.15),
      targeting: clampScore(7 - input.stats.unresolvedCalls * 0.35),
    },
    strengths,
    opportunities: opportunities.slice(0, 4),
    actionItems: actionItems.slice(0, 5),
    strongCalls,
    weakCalls,
    followUps,
    confidenceNote:
      input.transcriptCallCount > 0
        ? `This summary used ${input.transcriptCallCount} recorded conversation transcript(s) plus overall call patterns.`
        : "This summary is metadata-driven because no call transcripts were available for this day.",
  };
}

function buildOpenAiPrompt(input: {
  subjectDisplayName: string;
  reportDate: string;
  timeZone: string;
  stats: DailyCallCoachingStats;
  transcriptCallCount: number;
  calls: DailyCallCoachingCall[];
}): string {
  return [
    `Rep: ${input.subjectDisplayName}`,
    `Date: ${formatDisplayDate(input.reportDate, input.timeZone)}`,
    `Time zone: ${input.timeZone}`,
    "",
    "Daily stats:",
    `- Total outbound calls: ${input.stats.totalCalls}`,
    `- Answered outbound calls: ${input.stats.answeredCalls}`,
    `- Unanswered outbound calls: ${input.stats.unansweredCalls}`,
    `- Total talk time: ${formatDurationLabel(input.stats.totalTalkSeconds)}`,
    `- Average talk time: ${formatDurationLabel(Math.round(input.stats.averageTalkSeconds))}`,
    `- Short calls under 30 seconds: ${input.stats.shortCalls}`,
    `- Medium calls from 30 to 119 seconds: ${input.stats.mediumCalls}`,
    `- Long calls 120 seconds or more: ${input.stats.longCalls}`,
    `- Calls tied to a known contact/account: ${input.stats.matchedCalls}`,
    `- Unresolved calls: ${input.stats.unresolvedCalls}`,
    `- Distinct named contacts or companies reached: ${input.stats.uniqueNamedContacts}`,
    `- Calls with transcripts: ${input.transcriptCallCount}`,
    "",
    "Instructions:",
    "- Identify the calls that went well, name the person/company, and explain why using only the evidence provided.",
    "- Identify the calls that did not go well, name the person/company when available, and explain why.",
    "- Pull out concrete follow-up actions tied to the relevant conversation whenever the evidence supports it.",
    "- Do not invent language that is not in the transcript/summary.",
    "",
    "Call roster:",
    buildCallRosterForModel(input.calls),
  ].join("\n");
}

async function generateDailyCallCoachingContent(input: {
  subjectDisplayName: string;
  reportDate: string;
  timeZone: string;
  stats: DailyCallCoachingStats;
  transcriptCallCount: number;
  calls: DailyCallCoachingCall[];
}): Promise<DailyCallCoachingContent> {
  const fallback = buildFallbackDailyCallCoachingContent(input);
  const apiKey = getEnv().OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return fallback;
  }

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getEnv().OPENAI_SUMMARY_MODEL || DAILY_COACHING_MODEL_FALLBACK,
      input: [
        {
          role: "system",
          content:
            "You are a sales call coach for MeadowBrook. Be direct, practical, and creative, but stay grounded in the evidence. Never pretend you heard words that are not in a transcript. When transcript coverage is sparse, coach from call patterns only.",
        },
        {
          role: "user",
          content: buildOpenAiPrompt(input),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "daily_call_coaching_email",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "headline",
              "executiveSummary",
              "scorecard",
              "strengths",
              "opportunities",
              "actionItems",
              "strongCalls",
              "weakCalls",
              "followUps",
              "confidenceNote",
            ],
            properties: {
              headline: { type: "string" },
              executiveSummary: { type: "string" },
              scorecard: {
                type: "object",
                additionalProperties: false,
                required: ["effort", "conversationQuality", "targeting"],
                properties: {
                  effort: { type: "integer", minimum: 1, maximum: 10 },
                  conversationQuality: { type: "integer", minimum: 1, maximum: 10 },
                  targeting: { type: "integer", minimum: 1, maximum: 10 },
                },
              },
              strengths: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 4,
              },
              opportunities: {
                type: "array",
                minItems: 2,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "detail"],
                  properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                  },
                },
              },
              actionItems: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "detail", "priority"],
                  properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                    priority: {
                      type: "string",
                      enum: ["high", "medium", "low"],
                    },
                  },
                },
              },
              strongCalls: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "why"],
                  properties: {
                    label: { type: "string" },
                    why: { type: "string" },
                  },
                },
              },
              weakCalls: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "why"],
                  properties: {
                    label: { type: "string" },
                    why: { type: "string" },
                  },
                },
              },
              followUps: {
                type: "array",
                minItems: 1,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "action", "reason", "priority"],
                  properties: {
                    label: { type: "string" },
                    action: { type: "string" },
                    reason: { type: "string" },
                    priority: {
                      type: "string",
                      enum: ["high", "medium", "low"],
                    },
                  },
                },
              },
              confidenceNote: { type: "string" },
            },
          },
        },
      },
      max_output_tokens: 1_200,
    }),
    cache: "no-store",
  }, OPENAI_COACHING_TIMEOUT_MS);

  const bodyText = await response.text();
  const payload = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(`OpenAI coaching failed (${response.status}): ${parseOpenAiError(payload, bodyText || "Unknown error")}`);
  }

  const outputText = readOutputText(payload);
  const parsed = parseJsonObject(outputText || "");
  if (!parsed) {
    throw new Error("OpenAI coaching returned invalid JSON.");
  }

  const strengths = (
    Array.isArray(parsed.strengths)
      ? parsed.strengths.map((item) => cleanText(typeof item === "string" ? item : null)).filter(Boolean)
      : []
  ).slice(0, 4);
  const opportunities = (
    Array.isArray(parsed.opportunities)
    ? parsed.opportunities
        .map((item) => {
          const record = item as Record<string, unknown>;
          const title = cleanText(typeof record?.title === "string" ? record.title : null);
          const detail = cleanText(typeof record?.detail === "string" ? record.detail : null);
          return title && detail ? { title, detail } : null;
        })
        .filter((item): item is DailyCallCoachingOpportunity => Boolean(item))
    : []
  ).slice(0, 4);
  const actionItems = (
    Array.isArray(parsed.actionItems)
    ? parsed.actionItems
        .map((item) => {
          const record = item as Record<string, unknown>;
          const title = cleanText(typeof record?.title === "string" ? record.title : null);
          const detail = cleanText(typeof record?.detail === "string" ? record.detail : null);
          const priorityValue = cleanText(typeof record?.priority === "string" ? record.priority : null);
          const priority =
            priorityValue === "high" || priorityValue === "low" ? priorityValue : "medium";
          return title && detail ? { title, detail, priority } : null;
        })
        .filter((item): item is DailyCallCoachingActionItem => Boolean(item))
    : []
  ).slice(0, 5);
  const strongCalls = (
    Array.isArray(parsed.strongCalls)
    ? parsed.strongCalls
        .map((item) => {
          const record = item as Record<string, unknown>;
          const label = cleanText(typeof record?.label === "string" ? record.label : null);
          const why = cleanText(typeof record?.why === "string" ? record.why : null);
          return label && why ? { label, why } : null;
        })
        .filter((item): item is DailyCallCoachingCallReview => Boolean(item))
    : []
  ).slice(0, 4);
  const weakCalls = (
    Array.isArray(parsed.weakCalls)
    ? parsed.weakCalls
        .map((item) => {
          const record = item as Record<string, unknown>;
          const label = cleanText(typeof record?.label === "string" ? record.label : null);
          const why = cleanText(typeof record?.why === "string" ? record.why : null);
          return label && why ? { label, why } : null;
        })
        .filter((item): item is DailyCallCoachingCallReview => Boolean(item))
    : []
  ).slice(0, 4);
  const followUps = (
    Array.isArray(parsed.followUps)
    ? parsed.followUps
        .map((item) => {
          const record = item as Record<string, unknown>;
          const label = cleanText(typeof record?.label === "string" ? record.label : null);
          const action = cleanText(typeof record?.action === "string" ? record.action : null);
          const reason = cleanText(typeof record?.reason === "string" ? record.reason : null);
          const priorityValue = cleanText(typeof record?.priority === "string" ? record.priority : null);
          const priority =
            priorityValue === "high" || priorityValue === "low" ? priorityValue : "medium";
          return label && action && reason ? { label, action, reason, priority } : null;
        })
        .filter((item): item is DailyCallCoachingFollowUp => Boolean(item))
    : []
  ).slice(0, 5);

  return {
    headline: cleanText(typeof parsed.headline === "string" ? parsed.headline : null) || fallback.headline,
    executiveSummary: cleanText(typeof parsed.executiveSummary === "string" ? parsed.executiveSummary : null) || fallback.executiveSummary,
    scorecard: {
      effort: clampScore(Number((parsed.scorecard as Record<string, unknown> | undefined)?.effort ?? 5)),
      conversationQuality: clampScore(Number((parsed.scorecard as Record<string, unknown> | undefined)?.conversationQuality ?? 5)),
      targeting: clampScore(Number((parsed.scorecard as Record<string, unknown> | undefined)?.targeting ?? 5)),
    },
    strengths: strengths.length > 0 ? strengths : fallback.strengths,
    opportunities: opportunities.length > 0 ? opportunities : fallback.opportunities,
    actionItems: actionItems.length > 0 ? actionItems : fallback.actionItems,
    strongCalls: strongCalls.length > 0 ? strongCalls : fallback.strongCalls,
    weakCalls: weakCalls.length > 0 ? weakCalls : fallback.weakCalls,
    followUps: followUps.length > 0 ? followUps : fallback.followUps,
    confidenceNote:
      cleanText(typeof parsed.confidenceNote === "string" ? parsed.confidenceNote : null) ||
      fallback.confidenceNote,
  };
}

function buildSubjectLine(report: DailyCallCoachingReport): string {
  const base = `Daily Call Coaching for ${report.subjectDisplayName} · ${formatDisplayDate(report.reportDate, readDailyCallCoachingTimeZone())}`;
  return report.previewMode ? `[Preview] ${base}` : base;
}

function buildMailRecipient(profile: InternalMailboxProfile): MailRecipient {
  return {
    email: profile.email,
    name: profile.displayName,
    contactId: profile.contactId,
    businessAccountRecordId: null,
    businessAccountId: null,
  };
}

function renderScoreCardBox(label: string, score: number, accent: string): string {
  return `
    <div style="flex:1; min-width:160px; background:#ffffff; border:1px solid #dbe4ee; border-radius:16px; padding:16px;">
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:8px;">${escapeHtml(label)}</div>
      <div style="font-size:34px; line-height:1; font-weight:700; color:${accent};">${score}<span style="font-size:16px; color:#98a2b3;">/10</span></div>
    </div>
  `;
}

function renderBullets(items: string[]): string {
  return items
    .map((item) => `<li style="margin-bottom:10px;">${escapeHtml(item)}</li>`)
    .join("");
}

function renderOpportunityList(items: DailyCallCoachingOpportunity[]): string {
  return items
    .map(
      (item) => `
        <div style="padding:14px 0; border-top:1px solid #eef2f6;">
          <div style="font-weight:700; color:#111827; margin-bottom:6px;">${escapeHtml(item.title)}</div>
          <div style="color:#475467; line-height:1.6;">${escapeHtml(item.detail)}</div>
        </div>
      `,
    )
    .join("");
}

function renderActionList(items: DailyCallCoachingActionItem[]): string {
  return items
    .map(
      (item) => `
        <div style="display:flex; gap:12px; padding:14px 0; border-top:1px solid #eef2f6;">
          <div style="min-width:64px; height:28px; border-radius:999px; background:#f4f7fb; color:#344054; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; text-transform:uppercase;">
            ${escapeHtml(item.priority)}
          </div>
          <div>
            <div style="font-weight:700; color:#111827; margin-bottom:6px;">${escapeHtml(item.title)}</div>
            <div style="color:#475467; line-height:1.6;">${escapeHtml(item.detail)}</div>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderCallReviewList(items: DailyCallCoachingCallReview[]): string {
  return items
    .map(
      (item) => `
        <div style="padding:14px 0; border-top:1px solid #eef2f6;">
          <div style="font-weight:700; color:#111827; margin-bottom:6px;">${escapeHtml(item.label)}</div>
          <div style="color:#475467; line-height:1.6;">${escapeHtml(item.why)}</div>
        </div>
      `,
    )
    .join("");
}

function renderFollowUpList(items: DailyCallCoachingFollowUp[]): string {
  return items
    .map(
      (item) => `
        <div style="display:flex; gap:12px; padding:14px 0; border-top:1px solid #eef2f6;">
          <div style="min-width:64px; height:28px; border-radius:999px; background:#f4f7fb; color:#344054; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; text-transform:uppercase;">
            ${escapeHtml(item.priority)}
          </div>
          <div>
            <div style="font-weight:700; color:#111827; margin-bottom:6px;">${escapeHtml(item.label)}</div>
            <div style="color:#111827; line-height:1.6; margin-bottom:6px;">${escapeHtml(item.action)}</div>
            <div style="color:#475467; line-height:1.6;">${escapeHtml(item.reason)}</div>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderCallTable(calls: DailyCallCoachingCall[]): string {
  return calls
    .slice()
    .sort((left, right) => right.talkDurationSeconds - left.talkDurationSeconds)
    .slice(0, 10)
    .map((call) => {
      const target =
        [call.contactName, call.companyName].filter(Boolean).join(" / ") || "Unresolved target";
      return `
        <tr>
          <td style="padding:10px 12px; border-top:1px solid #eef2f6; color:#111827;">${escapeHtml(call.localTimeLabel)}</td>
          <td style="padding:10px 12px; border-top:1px solid #eef2f6; color:#111827;">${escapeHtml(target)}</td>
          <td style="padding:10px 12px; border-top:1px solid #eef2f6; color:#111827;">${escapeHtml(formatDurationLabel(call.talkDurationSeconds))}</td>
          <td style="padding:10px 12px; border-top:1px solid #eef2f6; color:#667085; text-transform:capitalize;">${escapeHtml(call.analysisSource)}</td>
        </tr>
      `;
    })
    .join("");
}

export function buildDailyCallCoachingMailPayload(
  report: DailyCallCoachingReport,
  recipient: InternalMailboxProfile,
): MailComposePayload {
  const previewBanner = report.previewMode
    ? `
      <div style="margin-bottom:20px; padding:14px 16px; border-radius:14px; background:#fff4e5; color:#9a3412; font-weight:600;">
        Preview copy for ${escapeHtml(recipient.displayName)}. This report is about ${escapeHtml(report.subjectDisplayName)}.
      </div>
    `
    : "";

  const htmlBody = `
    <div style="background:#f3f6fb; padding:28px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#101828;">
      <div style="max-width:760px; margin:0 auto; background:#ffffff; border:1px solid #d9e3ef; border-radius:24px; overflow:hidden;">
        <div style="padding:28px 32px; background:linear-gradient(135deg, #0f4c81 0%, #1768ac 52%, #49a078 100%); color:#ffffff;">
          <div style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; opacity:0.85; margin-bottom:8px;">Daily Call Coaching</div>
          <div style="font-size:30px; line-height:1.2; font-weight:800; margin-bottom:10px;">${escapeHtml(report.subjectDisplayName)} · ${escapeHtml(formatDisplayDate(report.reportDate, readDailyCallCoachingTimeZone()))}</div>
          <div style="font-size:16px; line-height:1.7; max-width:620px; opacity:0.95;">${escapeHtml(report.content.headline)}</div>
        </div>
        <div style="padding:28px 32px;">
          ${previewBanner}
          <div style="font-size:16px; line-height:1.7; color:#344054; margin-bottom:24px;">${escapeHtml(report.content.executiveSummary)}</div>
          <div style="display:flex; flex-wrap:wrap; gap:14px; margin-bottom:28px;">
            ${renderScoreCardBox("Effort", report.content.scorecard.effort, "#1768ac")}
            ${renderScoreCardBox("Conversation Quality", report.content.scorecard.conversationQuality, "#0f766e")}
            ${renderScoreCardBox("Targeting", report.content.scorecard.targeting, "#9333ea")}
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:14px; margin-bottom:28px;">
            <div style="background:#f8fafc; border:1px solid #e5edf5; border-radius:16px; padding:16px;">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:6px;">Calls</div>
              <div style="font-size:30px; font-weight:800;">${report.stats.totalCalls}</div>
            </div>
            <div style="background:#f8fafc; border:1px solid #e5edf5; border-radius:16px; padding:16px;">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:6px;">Answered</div>
              <div style="font-size:30px; font-weight:800;">${report.stats.answeredCalls}</div>
            </div>
            <div style="background:#f8fafc; border:1px solid #e5edf5; border-radius:16px; padding:16px;">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:6px;">Unanswered</div>
              <div style="font-size:30px; font-weight:800;">${report.stats.unansweredCalls}</div>
            </div>
            <div style="background:#f8fafc; border:1px solid #e5edf5; border-radius:16px; padding:16px;">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:6px;">Talk Time</div>
              <div style="font-size:30px; font-weight:800;">${escapeHtml(formatDurationLabel(report.stats.totalTalkSeconds))}</div>
            </div>
          </div>
          <div style="margin-bottom:28px; padding:22px; border-radius:18px; border:1px solid #dbe4ee; background:#fbfdff;">
            <div style="font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:12px;">What Went Well</div>
            <ul style="margin:0; padding-left:20px; color:#111827; line-height:1.7;">${renderBullets(report.content.strengths)}</ul>
          </div>
          <div style="margin-bottom:28px; padding:22px; border-radius:18px; border:1px solid #dbe4ee; background:#fbfdff;">
            <div style="font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:12px;">Calls That Landed</div>
            ${renderCallReviewList(report.content.strongCalls)}
          </div>
          <div style="margin-bottom:28px; padding:22px; border-radius:18px; border:1px solid #dbe4ee; background:#fbfdff;">
            <div style="font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:12px;">What To Tighten</div>
            ${renderOpportunityList(report.content.opportunities)}
          </div>
          <div style="margin-bottom:28px; padding:22px; border-radius:18px; border:1px solid #dbe4ee; background:#fbfdff;">
            <div style="font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:12px;">Calls That Missed</div>
            ${renderCallReviewList(report.content.weakCalls)}
          </div>
          <div style="margin-bottom:28px; padding:22px; border-radius:18px; border:1px solid #dbe4ee; background:#fbfdff;">
            <div style="font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:12px;">Next Things To Do</div>
            ${renderActionList(report.content.actionItems)}
          </div>
          <div style="margin-bottom:28px; padding:22px; border-radius:18px; border:1px solid #dbe4ee; background:#fbfdff;">
            <div style="font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:12px;">Follow Up Next</div>
            ${renderFollowUpList(report.content.followUps)}
          </div>
          <div style="margin-bottom:28px; padding:22px; border-radius:18px; border:1px solid #dbe4ee; background:#fbfdff;">
          <div style="font-size:14px; text-transform:uppercase; letter-spacing:0.08em; color:#667085; margin-bottom:12px;">Longest Conversations</div>
            <table style="width:100%; border-collapse:collapse; font-size:14px;">
              <thead>
                <tr>
                  <th align="left" style="padding:0 12px 10px; color:#667085; font-weight:600;">Time</th>
                  <th align="left" style="padding:0 12px 10px; color:#667085; font-weight:600;">Conversation</th>
                  <th align="left" style="padding:0 12px 10px; color:#667085; font-weight:600;">Talk</th>
                  <th align="left" style="padding:0 12px 10px; color:#667085; font-weight:600;">Evidence</th>
                </tr>
              </thead>
              <tbody>${renderCallTable(report.calls)}</tbody>
            </table>
          </div>
          <div style="padding:16px 18px; border-radius:14px; background:#f4f7fb; color:#475467; font-size:14px; line-height:1.7;">
            ${escapeHtml(report.content.confidenceNote)}
          </div>
        </div>
      </div>
    </div>
  `;

  const textBody = [
    report.subjectLine,
    "",
    report.content.headline,
    "",
    report.content.executiveSummary,
    "",
    `Effort: ${report.content.scorecard.effort}/10`,
    `Conversation Quality: ${report.content.scorecard.conversationQuality}/10`,
    `Targeting: ${report.content.scorecard.targeting}/10`,
    "",
    "What Went Well:",
    ...report.content.strengths.map((item) => `- ${item}`),
    "",
    "Calls That Landed:",
    ...report.content.strongCalls.map((item) => `- ${item.label}: ${item.why}`),
    "",
    "What To Tighten:",
    ...report.content.opportunities.map((item) => `- ${item.title}: ${item.detail}`),
    "",
    "Calls That Missed:",
    ...report.content.weakCalls.map((item) => `- ${item.label}: ${item.why}`),
    "",
    "Next Things To Do:",
    ...report.content.actionItems.map((item) => `- [${item.priority}] ${item.title}: ${item.detail}`),
    "",
    "Follow Up Next:",
    ...report.content.followUps.map((item) => `- [${item.priority}] ${item.label}: ${item.action} ${item.reason}`),
    "",
    report.content.confidenceNote,
  ].join("\n");

  return {
    threadId: null,
    draftId: null,
    subject: report.subjectLine,
    htmlBody,
    textBody,
    to: [buildMailRecipient(recipient)],
    cc: [],
    bcc: [],
    linkedContact: {
      contactId: null,
      businessAccountRecordId: null,
      businessAccountId: null,
      contactName: null,
      companyName: null,
    },
    matchedContacts: [],
    attachments: [],
    sourceSurface: "mail",
  };
}

async function sendDailyCallCoachingEmail(
  report: DailyCallCoachingReport,
  sender: InternalMailboxProfile,
  recipient: InternalMailboxProfile,
): Promise<void> {
  const { serviceUrl } = ensureMailServiceConfigured();
  const payload = buildDailyCallCoachingMailPayload(report, recipient);
  const assertion = buildMailServiceAssertion({
    loginName: sender.loginName,
    senderEmail: sender.email,
    displayName: sender.displayName,
  });

  const response = await fetchWithTimeout(`${serviceUrl.replace(/\/$/, "")}/api/mail/messages/send`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${assertion}`,
      "Content-Type": "application/json",
      "x-mb-skip-activity-sync": "1",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  }, MAIL_SEND_TIMEOUT_MS);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Coaching email send failed (${response.status}): ${body || "Unknown error"}`);
  }
}

async function buildDailyCallCoachingReport(input: {
  reportDate: string;
  subjectLoginName: string;
  recipientEmail: string;
  previewMode: boolean;
  senderLoginName: string;
  timeZone: string;
}): Promise<DailyCallCoachingReport | null> {
  const subjectProfile = await resolveInternalMailboxProfile({
    loginName: input.subjectLoginName,
  });
  const calls = buildDailyCallList(input.subjectLoginName, input.reportDate, input.timeZone);
  if (calls.length === 0) {
    return null;
  }

  const stats = buildDailyCallCoachingStats(calls);
  const transcriptCallCount = calls.filter((call) => call.analysisSource === "transcript").length;
  let content: DailyCallCoachingContent;
  try {
    content = await generateDailyCallCoachingContent({
      subjectDisplayName: subjectProfile.displayName,
      reportDate: input.reportDate,
      timeZone: input.timeZone,
      stats,
      transcriptCallCount,
      calls,
    });
  } catch {
    content = buildFallbackDailyCallCoachingContent({
      subjectDisplayName: subjectProfile.displayName,
      stats,
      transcriptCallCount,
      calls,
    });
  }

  const report: DailyCallCoachingReport = {
    reportDate: input.reportDate,
    subjectLoginName: input.subjectLoginName,
    subjectDisplayName: subjectProfile.displayName,
    recipientEmail: input.recipientEmail,
    previewMode: input.previewMode,
    senderLoginName: input.senderLoginName,
    stats,
    calls,
    content,
    subjectLine: "",
  };
  report.subjectLine = buildSubjectLine(report);
  return report;
}

export async function runDailyCallCoaching(options?: {
  reportDate?: string;
  loginName?: string | null;
  previewRecipientLoginName?: string | null;
  previewRecipientEmail?: string | null;
  force?: boolean;
}): Promise<DailyCallCoachingRunResult> {
  const env = getEnv();
  const reportDate =
    cleanText(options?.reportDate) ||
    formatLocalDateKey(new Date().toISOString(), env.DAILY_CALL_COACHING_TIME_ZONE);
  if (!reportDate) {
    throw new HttpError(500, "Unable to resolve the coaching report date.");
  }

  const sender = await resolveInternalMailboxProfile({
    loginName: env.DAILY_CALL_COACHING_SENDER_LOGIN,
  });
  const snapshotState = readCallIngestState();
  const dataCoverage = buildDailyCallCoachingCoverage(
    reportDate,
    env.DAILY_CALL_COACHING_TIME_ZONE,
    snapshotState,
  );
  if (!dataCoverage.complete) {
    return {
      reportDate,
      senderLoginName: sender.loginName,
      ranAt: new Date().toISOString(),
      items: [],
      dataCoverage,
    };
  }
  const previewLoginName = cleanText(options?.previewRecipientLoginName) || null;
  const previewEmail = cleanText(options?.previewRecipientEmail) || null;
  const previewMode = Boolean(previewLoginName || previewEmail);
  const subjectLogins = pickSubjectLogins(
    reportDate,
    env.DAILY_CALL_COACHING_TIME_ZONE,
    options?.loginName,
  );

  const items: DailyCallCoachingRunItem[] = [];
  for (const subjectLoginName of subjectLogins) {
    const targetRecipient = previewMode
      ? await resolveInternalMailboxProfile({
          loginName: previewLoginName || env.DAILY_CALL_COACHING_SENDER_LOGIN,
          email: previewEmail,
        })
      : await resolveInternalMailboxProfile({
          loginName: subjectLoginName,
        });

    const existing = readDailyCallCoachingRow(
      reportDate,
      subjectLoginName,
      targetRecipient.email,
    );
    if (!options?.force && existing?.status === "sent") {
      items.push({
        subjectLoginName,
        subjectDisplayName: cleanText(subjectLoginName),
        recipientEmail: targetRecipient.email,
        status: "skipped",
        detail: "Already sent for this date and recipient.",
        sessionCount: existing.session_count,
        analyzedCallCount: existing.analyzed_call_count,
        transcriptCallCount: existing.transcript_call_count,
        subjectLine: existing.subject_line,
      });
      continue;
    }

    try {
      const report = await buildDailyCallCoachingReport({
        reportDate,
        subjectLoginName,
        recipientEmail: targetRecipient.email,
        previewMode,
        senderLoginName: sender.loginName,
        timeZone: env.DAILY_CALL_COACHING_TIME_ZONE,
      });

      if (!report) {
        writeDailyCallCoachingRow({
          reportDate,
          subjectLoginName,
          recipientEmail: targetRecipient.email,
          senderLoginName: sender.loginName,
          previewMode,
          status: "skipped",
          sessionCount: 0,
          analyzedCallCount: 0,
          transcriptCallCount: 0,
          subjectLine: null,
          reportJson: null,
          errorMessage: null,
          sentAt: null,
        });
        items.push({
          subjectLoginName,
          subjectDisplayName: subjectLoginName,
          recipientEmail: targetRecipient.email,
          status: "skipped",
          detail: "No outbound calls were found for this day.",
          sessionCount: 0,
          analyzedCallCount: 0,
          transcriptCallCount: 0,
          subjectLine: null,
        });
        continue;
      }

      await sendDailyCallCoachingEmail(report, sender, targetRecipient);
      writeDailyCallCoachingRow({
        reportDate,
        subjectLoginName,
        recipientEmail: targetRecipient.email,
        senderLoginName: sender.loginName,
        previewMode,
        status: "sent",
        sessionCount: report.calls.length,
        analyzedCallCount: report.calls.length,
        transcriptCallCount: report.calls.filter((call) => call.analysisSource === "transcript").length,
        subjectLine: report.subjectLine,
        reportJson: JSON.stringify(report),
        errorMessage: null,
        sentAt: new Date().toISOString(),
      });
      items.push({
        subjectLoginName,
        subjectDisplayName: report.subjectDisplayName,
        recipientEmail: targetRecipient.email,
        status: "sent",
        detail: "Daily coaching email sent.",
        sessionCount: report.calls.length,
        analyzedCallCount: report.calls.length,
        transcriptCallCount: report.calls.filter((call) => call.analysisSource === "transcript").length,
        subjectLine: report.subjectLine,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      writeDailyCallCoachingRow({
        reportDate,
        subjectLoginName,
        recipientEmail: targetRecipient.email,
        senderLoginName: sender.loginName,
        previewMode,
        status: "failed",
        sessionCount: 0,
        analyzedCallCount: 0,
        transcriptCallCount: 0,
        subjectLine: null,
        reportJson: null,
        errorMessage: message,
        sentAt: null,
      });
      items.push({
        subjectLoginName,
        subjectDisplayName: subjectLoginName,
        recipientEmail: targetRecipient.email,
        status: "failed",
        detail: message,
        sessionCount: 0,
        analyzedCallCount: 0,
        transcriptCallCount: 0,
        subjectLine: null,
      });
    }
  }

  return {
    reportDate,
    senderLoginName: sender.loginName,
    ranAt: new Date().toISOString(),
    items,
    dataCoverage,
  };
}
