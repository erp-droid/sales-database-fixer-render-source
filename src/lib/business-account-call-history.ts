import { readCallActivitySyncBySessionId } from "@/lib/call-analytics/postcall-store";
import { readCallSessions } from "@/lib/call-analytics/sessionize";
import type { CallSessionRecord } from "@/lib/call-analytics/types";
import { resolveCompanyPhone } from "@/lib/business-accounts";
import { extractNormalizedPhoneDigits } from "@/lib/phone";
import type { BusinessAccountRow } from "@/types/business-account";
import type {
  BusinessAccountCallHistoryItem,
  BusinessAccountCallHistoryResponse,
} from "@/types/business-account-call-history";

type CallHistoryIndex = {
  byRowKey: Map<string, CallSessionRecord[]>;
  byContactId: Map<number, CallSessionRecord[]>;
  byPhoneDigits: Map<string, CallSessionRecord[]>;
  byBusinessAccountId: Map<string, CallSessionRecord[]>;
};

type MatchedSession = {
  session: CallSessionRecord;
  score: number;
  sortTimestamp: number;
};

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 25;

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeBusinessAccountId(value: string | null | undefined): string {
  return normalizeText(value).toUpperCase();
}

function normalizeRowKey(row: BusinessAccountRow): string {
  return normalizeText(row.rowKey ?? row.id);
}

function isPositiveInteger(value: number | null | undefined): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function uniquePhoneDigits(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => extractNormalizedPhoneDigits(value))
        .filter((value) => value.length > 0),
    ),
  ];
}

function uniqueContactIds(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter(isPositiveInteger))];
}

function resolveSessionSortTimestamp(session: CallSessionRecord): number {
  const parsed = Date.parse(session.startedAt ?? session.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pushSession<TKey>(
  map: Map<TKey, CallSessionRecord[]>,
  key: TKey,
  session: CallSessionRecord,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(session);
    return;
  }

  map.set(key, [session]);
}

function buildCallHistoryIndex(): CallHistoryIndex {
  const byRowKey = new Map<string, CallSessionRecord[]>();
  const byContactId = new Map<number, CallSessionRecord[]>();
  const byPhoneDigits = new Map<string, CallSessionRecord[]>();
  const byBusinessAccountId = new Map<string, CallSessionRecord[]>();

  for (const session of readCallSessions()) {
    const linkedRowKey = normalizeText(session.linkedAccountRowKey);
    if (linkedRowKey) {
      pushSession(byRowKey, linkedRowKey, session);
    }

    for (const contactId of uniqueContactIds([
      session.linkedContactId,
      session.matchedContactId,
    ])) {
      pushSession(byContactId, contactId, session);
    }

    for (const phoneDigits of uniquePhoneDigits([
      session.counterpartyPhone,
      session.targetPhone,
    ])) {
      pushSession(byPhoneDigits, phoneDigits, session);
    }

    for (const businessAccountId of uniqueStrings([
      normalizeBusinessAccountId(session.linkedBusinessAccountId),
      normalizeBusinessAccountId(session.matchedBusinessAccountId),
    ])) {
      pushSession(byBusinessAccountId, businessAccountId, session);
    }
  }

  return {
    byRowKey,
    byContactId,
    byPhoneDigits,
    byBusinessAccountId,
  };
}

function collectContactPhoneDigits(row: BusinessAccountRow): string[] {
  return uniquePhoneDigits([
    row.primaryContactPhone,
    row.primaryContactRawPhone,
    row.phoneNumber,
  ]);
}

function collectCompanyPhoneDigits(row: BusinessAccountRow): string[] {
  return uniquePhoneDigits([resolveCompanyPhone(row)]);
}

function collectCandidateSessions(
  row: BusinessAccountRow,
  index: CallHistoryIndex,
): CallSessionRecord[] {
  const candidates = new Map<string, CallSessionRecord>();
  const rowKey = normalizeRowKey(row);
  const contactIds = uniqueContactIds([row.contactId, row.primaryContactId]);
  const contactPhoneDigits = collectContactPhoneDigits(row);
  const hasContactSpecificIdentity = contactIds.length > 0 || contactPhoneDigits.length > 0;

  const addSessions = (sessions: CallSessionRecord[] | undefined) => {
    if (!sessions) {
      return;
    }

    for (const session of sessions) {
      candidates.set(session.sessionId, session);
    }
  };

  if (rowKey) {
    addSessions(index.byRowKey.get(rowKey));
  }

  for (const contactId of contactIds) {
    addSessions(index.byContactId.get(contactId));
  }

  for (const phoneDigits of contactPhoneDigits) {
    addSessions(index.byPhoneDigits.get(phoneDigits));
  }

  if (!hasContactSpecificIdentity) {
    for (const phoneDigits of collectCompanyPhoneDigits(row)) {
      addSessions(index.byPhoneDigits.get(phoneDigits));
    }

    const businessAccountId = normalizeBusinessAccountId(row.businessAccountId);
    if (businessAccountId) {
      addSessions(index.byBusinessAccountId.get(businessAccountId));
    }
  }

  return [...candidates.values()];
}

function scoreSessionForRow(row: BusinessAccountRow, session: CallSessionRecord): number {
  const rowKey = normalizeRowKey(row);
  if (rowKey && normalizeText(session.linkedAccountRowKey) === rowKey) {
    return 100;
  }

  const contactIds = uniqueContactIds([row.contactId, row.primaryContactId]);
  if (contactIds.length > 0) {
    if (isPositiveInteger(session.linkedContactId) && contactIds.includes(session.linkedContactId)) {
      return 95;
    }

    if (isPositiveInteger(session.matchedContactId) && contactIds.includes(session.matchedContactId)) {
      return 90;
    }
  }

  const sessionPhoneDigits = uniquePhoneDigits([
    session.counterpartyPhone,
    session.targetPhone,
  ]);
  const contactPhoneDigits = collectContactPhoneDigits(row);
  if (
    contactPhoneDigits.length > 0 &&
    contactPhoneDigits.some((digits) => sessionPhoneDigits.includes(digits))
  ) {
    return 80;
  }

  if (contactIds.length === 0 && contactPhoneDigits.length === 0) {
    const companyPhoneDigits = collectCompanyPhoneDigits(row);
    if (
      companyPhoneDigits.length > 0 &&
      companyPhoneDigits.some((digits) => sessionPhoneDigits.includes(digits))
    ) {
      return 60;
    }

    const businessAccountId = normalizeBusinessAccountId(row.businessAccountId);
    if (
      businessAccountId &&
      [
        normalizeBusinessAccountId(session.linkedBusinessAccountId),
        normalizeBusinessAccountId(session.matchedBusinessAccountId),
      ].includes(businessAccountId)
    ) {
      return 50;
    }
  }

  return 0;
}

function readMatchedSessions(
  row: BusinessAccountRow,
  index: CallHistoryIndex,
): MatchedSession[] {
  return collectCandidateSessions(row, index)
    .map((session) => ({
      session,
      score: scoreSessionForRow(row, session),
      sortTimestamp: resolveSessionSortTimestamp(session),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.sortTimestamp !== left.sortTimestamp) {
        return right.sortTimestamp - left.sortTimestamp;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.session.sessionId.localeCompare(left.session.sessionId);
    });
}

function readPhoneMatchedSessions(
  phoneDigits: string[],
  index: CallHistoryIndex,
): MatchedSession[] {
  const candidates = new Map<string, CallSessionRecord>();

  for (const digits of phoneDigits) {
    const sessions = index.byPhoneDigits.get(digits);
    if (!sessions) {
      continue;
    }

    for (const session of sessions) {
      candidates.set(session.sessionId, session);
    }
  }

  return [...candidates.values()]
    .map((session) => ({
      session,
      score: 1,
      sortTimestamp: resolveSessionSortTimestamp(session),
    }))
    .sort((left, right) => {
      if (right.sortTimestamp !== left.sortTimestamp) {
        return right.sortTimestamp - left.sortTimestamp;
      }

      return right.session.sessionId.localeCompare(left.session.sessionId);
    });
}

function readPreferredSessionsForRow(
  row: BusinessAccountRow,
  index: CallHistoryIndex,
): MatchedSession[] {
  const contactPhoneDigits = collectContactPhoneDigits(row);
  if (contactPhoneDigits.length > 0) {
    return readPhoneMatchedSessions(contactPhoneDigits, index);
  }

  const companyPhoneDigits = collectCompanyPhoneDigits(row);
  if (companyPhoneDigits.length > 0) {
    const phoneMatchedSessions = readPhoneMatchedSessions(companyPhoneDigits, index);
    if (phoneMatchedSessions.length > 0) {
      return phoneMatchedSessions;
    }
  }

  return readMatchedSessions(row, index);
}

function buildCallHistoryItem(session: CallSessionRecord): BusinessAccountCallHistoryItem {
  const sync = readCallActivitySyncBySessionId(session.sessionId);

  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    employeeDisplayName: session.employeeDisplayName ?? session.recipientEmployeeDisplayName,
    employeeLoginName: session.employeeLoginName ?? session.recipientEmployeeLoginName,
    direction: session.direction,
    outcome: session.outcome,
    answered: session.answered,
    talkDurationSeconds: session.talkDurationSeconds,
    ringDurationSeconds: session.ringDurationSeconds,
    phoneNumber: session.counterpartyPhone ?? session.targetPhone,
    contactName: session.matchedContactName,
    companyName: session.matchedCompanyName,
    recordingSid: sync?.recordingSid ?? null,
    recordingStatus: sync?.recordingStatus ?? null,
    recordingDurationSeconds: sync?.recordingDurationSeconds ?? null,
    activitySyncStatus: sync?.status ?? null,
    activityId: sync?.activityId ?? null,
    activitySyncUpdatedAt: sync?.updatedAt ?? null,
    summaryText: sync?.summaryText ?? null,
    transcriptText: sync?.transcriptText ?? null,
  };
}

function coerceLimit(limit: number | null | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_HISTORY_LIMIT)));
}

export function buildBusinessAccountCallHistoryResponse(
  row: BusinessAccountRow,
  options?: { limit?: number | null; index?: CallHistoryIndex },
): BusinessAccountCallHistoryResponse {
  const index = options?.index ?? buildCallHistoryIndex();
  const matched = readPreferredSessionsForRow(row, index);
  const limit = coerceLimit(options?.limit);
  const items = matched.slice(0, limit).map((candidate) => buildCallHistoryItem(candidate.session));

  return {
    lastCalledAt: matched[0]?.session.startedAt ?? matched[0]?.session.updatedAt ?? null,
    items,
  };
}

export function applyLastCalledAtToBusinessAccountRows(
  rows: BusinessAccountRow[],
): BusinessAccountRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const index = buildCallHistoryIndex();
  let changed = false;
  const nextRows = rows.map((row) => {
    const matched = readPreferredSessionsForRow(row, index);
    const lastCalledAt = matched[0]?.session.startedAt ?? matched[0]?.session.updatedAt ?? null;

    if ((row.lastCalledAt ?? null) === lastCalledAt) {
      return row;
    }

    changed = true;
    return {
      ...row,
      lastCalledAt,
    };
  });

  return changed ? nextRows : rows;
}
