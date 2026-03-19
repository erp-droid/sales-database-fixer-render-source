import { getReadModelDb } from "@/lib/read-model/db";
import { formatPhoneForTwilioDial } from "@/lib/phone";
import { readAllCallerPhoneOverrides } from "@/lib/caller-phone-overrides";
import {
  buildPhoneMatchIndex,
  matchPhoneToAccountWithIndex,
  type PhoneMatchIndex,
} from "@/lib/call-analytics/phone-match";
import {
  readCallEmployeeDirectory,
  readCallEmployeeDirectoryMeta,
} from "@/lib/call-analytics/employee-directory";
import { publishAuditLogChanged } from "@/lib/audit-log-live";
import { invalidateDashboardSnapshotCache } from "@/lib/call-analytics/dashboard-cache";
import { upsertCallAuditEvent } from "@/lib/audit-log-store";
import type {
  CallAnalyticsDirection,
  CallAnalyticsOutcome,
  CallAnalyticsSource,
  CallEmployeeDirectoryItem,
  CallLegRecord,
  CallSessionRecord,
} from "@/lib/call-analytics/types";

type StoredCallLegRow = {
  sid: string;
  parent_sid: string | null;
  session_id: string;
  direction: string;
  from_number: string | null;
  to_number: string | null;
  status: string | null;
  answered: number;
  answered_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  ring_duration_seconds: number | null;
  price: string | null;
  price_unit: string | null;
  source: string;
  leg_type: string;
  raw_json: string;
  updated_at: string;
};

type ParsedLegMetadata = {
  appContext?: {
    sessionId?: string;
    loginName?: string;
    displayName?: string;
    userPhone?: string;
    callerId?: string;
    bridgeNumber?: string;
    sourcePage?: "accounts" | "map" | "tasks" | "quality" | "unknown";
    linkedAccountRowKey?: string | null;
    linkedBusinessAccountId?: string | null;
    linkedContactId?: number | null;
    linkedCompanyName?: string | null;
    linkedContactName?: string | null;
  };
  events?: Array<{
    event?: string;
    occurredAt?: string | null;
    status?: string | null;
    source?: string | null;
  }>;
};

type EmployeeIndex = {
  byLogin: Map<string, CallEmployeeDirectoryItem>;
  byNormalizedPhone: Map<string, CallEmployeeDirectoryItem[]>;
  byCallerIdPhone: Map<string, CallEmployeeDirectoryItem[]>;
};

type SessionizeOptions = {
  bridgeNumbers?: string[];
};

let repairingCallSessionsFromEmployeeDirectory = false;

function normalizeStoredCallLeg(row: StoredCallLegRow): CallLegRecord {
  return {
    sid: row.sid,
    parentSid: row.parent_sid,
    sessionId: row.session_id,
    direction: row.direction,
    fromNumber: row.from_number,
    toNumber: row.to_number,
    status: row.status,
    answered: row.answered === 1,
    answeredAt: row.answered_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    ringDurationSeconds: row.ring_duration_seconds,
    price: row.price,
    priceUnit: row.price_unit,
    source: normalizeSource(row.source),
    legType: normalizeLegType(row.leg_type),
    rawJson: row.raw_json,
    updatedAt: row.updated_at,
  };
}

function normalizeSource(value: string | null | undefined): CallAnalyticsSource {
  if (value === "app_bridge" || value === "twilio_direct" || value === "inbound") {
    return value;
  }

  return "unknown";
}

function normalizeLegType(value: string | null | undefined): CallLegRecord["legType"] {
  if (value === "root" || value === "destination" || value === "inbound") {
    return value;
  }

  return "unknown";
}

function parseLegMetadata(rawJson: string): ParsedLegMetadata {
  try {
    const parsed = JSON.parse(rawJson) as ParsedLegMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildEmployeeIndex(items: CallEmployeeDirectoryItem[]): EmployeeIndex {
  const mergedByLogin = new Map<string, CallEmployeeDirectoryItem>();
  const overrideLoginByPhone = new Map<string, string>();

  for (const override of readAllCallerPhoneOverrides()) {
    const normalizedLoginName = override.loginName.trim().toLowerCase();
    if (!normalizedLoginName) {
      continue;
    }

    const normalizedPhone = formatPhoneForTwilioDial(override.phoneNumber);
    if (!normalizedPhone) {
      continue;
    }

    overrideLoginByPhone.set(normalizedPhone, normalizedLoginName);
  }

  function looksLikePhoneLoginName(value: string): boolean {
    return /^\d{10,15}$/.test(value.trim());
  }

  for (const item of items) {
    const normalizedLoginName = item.loginName.trim().toLowerCase();
    const normalizedItemPhone =
      formatPhoneForTwilioDial(item.normalizedPhone) ??
      formatPhoneForTwilioDial(item.callerIdPhone);
    if (
      looksLikePhoneLoginName(normalizedLoginName) &&
      normalizedItemPhone &&
      overrideLoginByPhone.has(normalizedItemPhone) &&
      overrideLoginByPhone.get(normalizedItemPhone) !== normalizedLoginName
    ) {
      continue;
    }

    mergedByLogin.set(item.loginName, item);
  }

  for (const override of readAllCallerPhoneOverrides()) {
    const normalizedLoginName = override.loginName.trim().toLowerCase();
    if (!normalizedLoginName) {
      continue;
    }

    const normalizedPhone = formatPhoneForTwilioDial(override.phoneNumber);
    if (!normalizedPhone) {
      continue;
    }

    const existing = mergedByLogin.get(normalizedLoginName);
    if (existing) {
      mergedByLogin.set(normalizedLoginName, {
        ...existing,
        normalizedPhone: normalizedPhone,
        callerIdPhone: normalizedPhone,
        updatedAt:
          override.updatedAt > existing.updatedAt ? override.updatedAt : existing.updatedAt,
      });
      continue;
    }

    mergedByLogin.set(normalizedLoginName, {
      loginName: normalizedLoginName,
      contactId: null,
      displayName: normalizedLoginName,
      email: null,
      normalizedPhone,
      callerIdPhone: normalizedPhone,
      isActive: true,
      updatedAt: override.updatedAt,
    });
  }

  const byLogin = new Map<string, CallEmployeeDirectoryItem>();
  const byNormalizedPhone = new Map<string, CallEmployeeDirectoryItem[]>();
  const byCallerIdPhone = new Map<string, CallEmployeeDirectoryItem[]>();

  for (const item of mergedByLogin.values()) {
    byLogin.set(item.loginName, item);

    const normalizedPhone = formatPhoneForTwilioDial(item.normalizedPhone);
    if (normalizedPhone) {
      const list = byNormalizedPhone.get(normalizedPhone) ?? [];
      list.push(item);
      byNormalizedPhone.set(normalizedPhone, list);
    }

    const callerIdPhone = formatPhoneForTwilioDial(item.callerIdPhone);
    if (callerIdPhone) {
      const list = byCallerIdPhone.get(callerIdPhone) ?? [];
      list.push(item);
      byCallerIdPhone.set(callerIdPhone, list);
    }
  }

  return { byLogin, byNormalizedPhone, byCallerIdPhone };
}

function findUniqueEmployeeMatch(
  index: Map<string, CallEmployeeDirectoryItem[]>,
  phone: string | null | undefined,
): CallEmployeeDirectoryItem | null {
  const normalized = formatPhoneForTwilioDial(phone);
  if (!normalized) {
    return null;
  }

  const matches = index.get(normalized) ?? [];
  return matches.length === 1 ? matches[0] ?? null : null;
}

function toMillis(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const numeric = Date.parse(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function minIso(values: Array<string | null | undefined>): string | null {
  const millis = values.map(toMillis).filter((value): value is number => value !== null);
  if (millis.length === 0) {
    return null;
  }

  return new Date(Math.min(...millis)).toISOString();
}

function maxIso(values: Array<string | null | undefined>): string | null {
  const millis = values.map(toMillis).filter((value): value is number => value !== null);
  if (millis.length === 0) {
    return null;
  }

  return new Date(Math.max(...millis)).toISOString();
}

function computeRingDuration(
  startedAt: string | null,
  answeredAt: string | null,
  endedAt: string | null,
  answered: boolean,
): number | null {
  const startMs = toMillis(startedAt);
  const answerMs = toMillis(answeredAt);
  const endMs = toMillis(endedAt);
  if (startMs === null) {
    return null;
  }

  if (answered && answerMs !== null && answerMs >= startMs) {
    return Math.max(0, Math.round((answerMs - startMs) / 1000));
  }

  if (!answered && endMs !== null && endMs >= startMs) {
    return Math.max(0, Math.round((endMs - startMs) / 1000));
  }

  return null;
}

function computeOutcome(leg: CallLegRecord | null): {
  answered: boolean;
  outcome: CallAnalyticsOutcome;
} {
  if (!leg) {
    return {
      answered: false,
      outcome: "unknown",
    };
  }

  if (leg.answered || ((leg.status ?? "") === "completed" && (leg.durationSeconds ?? 0) > 0)) {
    return {
      answered: true,
      outcome: "answered",
    };
  }

  switch (leg.status) {
    case "busy":
      return { answered: false, outcome: "busy" };
    case "no-answer":
      return { answered: false, outcome: "no_answer" };
    case "failed":
      return { answered: false, outcome: "failed" };
    case "canceled":
      return { answered: false, outcome: "canceled" };
    case "queued":
    case "ringing":
    case "in-progress":
      return { answered: false, outcome: "in_progress" };
    default:
      return { answered: false, outcome: "unknown" };
  }
}

function looksInbound(direction: string | null | undefined): boolean {
  return (direction ?? "").startsWith("inbound") || direction === "trunking-originating";
}

function looksOutbound(direction: string | null | undefined): boolean {
  return (direction ?? "").startsWith("outbound") || direction === "trunking-terminating";
}

function readAppContext(group: CallLegRecord[]): ParsedLegMetadata["appContext"] | null {
  for (const leg of group) {
    const appContext = parseLegMetadata(leg.rawJson).appContext;
    if (appContext) {
      return appContext;
    }
  }

  return null;
}

function determineSessionId(rootSid: string, group: CallLegRecord[], appContext: ParsedLegMetadata["appContext"] | null): string {
  if (appContext?.sessionId?.trim()) {
    return appContext.sessionId.trim();
  }

  for (const leg of group) {
    if (leg.sessionId?.trim() && leg.sessionId !== leg.sid) {
      return leg.sessionId.trim();
    }
  }

  return `sid:${rootSid}`;
}

function choosePrimaryLeg(
  group: CallLegRecord[],
  isBridge: boolean,
): CallLegRecord | null {
  if (isBridge) {
    const childLeg = group.find((leg) => leg.parentSid && looksOutbound(leg.direction));
    if (childLeg) {
      return childLeg;
    }
  }

  const inboundLeg = group.find((leg) => looksInbound(leg.direction));
  if (inboundLeg) {
    return inboundLeg;
  }

  const outboundLeg = group.find((leg) => looksOutbound(leg.direction));
  if (outboundLeg) {
    return outboundLeg;
  }

  return group[0] ?? null;
}

function determineDirection(
  primaryLeg: CallLegRecord | null,
  isBridge: boolean,
): CallAnalyticsDirection {
  if (isBridge) {
    return "outbound";
  }

  if (primaryLeg && looksInbound(primaryLeg.direction)) {
    return "inbound";
  }

  if (primaryLeg && looksOutbound(primaryLeg.direction)) {
    return "outbound";
  }

  return "unknown";
}

function determineSource(
  group: CallLegRecord[],
  direction: CallAnalyticsDirection,
  isBridge: boolean,
  appContext: ParsedLegMetadata["appContext"] | null,
): CallAnalyticsSource {
  if (appContext || isBridge || group.some((leg) => leg.source === "app_bridge")) {
    return "app_bridge";
  }

  if (direction === "inbound") {
    return "inbound";
  }

  if (direction === "outbound") {
    return "twilio_direct";
  }

  return "unknown";
}

function detectBridgeCall(
  rootLeg: CallLegRecord | null,
  group: CallLegRecord[],
  employeeIndex: EmployeeIndex,
  bridgeNumbers: Set<string>,
): boolean {
  if (!rootLeg) {
    return false;
  }

  const normalizedRootFrom = formatPhoneForTwilioDial(rootLeg.fromNumber);
  const normalizedRootTo = formatPhoneForTwilioDial(rootLeg.toNumber);
  if (!normalizedRootFrom || !normalizedRootTo) {
    return false;
  }

  const hasChildOutbound = group.some(
    (leg) => leg.parentSid === rootLeg.sid && looksOutbound(leg.direction),
  );
  if (!hasChildOutbound) {
    return false;
  }

  return (
    bridgeNumbers.has(normalizedRootFrom) &&
    Boolean(findUniqueEmployeeMatch(employeeIndex.byNormalizedPhone, normalizedRootTo))
  );
}

function determineEmployeeAttribution(
  primaryLeg: CallLegRecord | null,
  rootLeg: CallLegRecord | null,
  direction: CallAnalyticsDirection,
  appContext: ParsedLegMetadata["appContext"] | null,
  employeeIndex: EmployeeIndex,
): {
  employee: CallEmployeeDirectoryItem | null;
  recipientEmployee: CallEmployeeDirectoryItem | null;
} {
  if (appContext?.loginName) {
    const explicit = employeeIndex.byLogin.get(appContext.loginName.trim().toLowerCase()) ?? null;
    if (explicit) {
      return {
        employee: explicit,
        recipientEmployee:
          direction === "inbound"
            ? findUniqueEmployeeMatch(employeeIndex.byNormalizedPhone, primaryLeg?.toNumber)
            : null,
      };
    }
  }

  if (direction === "outbound") {
    return {
      employee:
        findUniqueEmployeeMatch(employeeIndex.byCallerIdPhone, primaryLeg?.fromNumber) ??
        findUniqueEmployeeMatch(employeeIndex.byCallerIdPhone, appContext?.callerId) ??
        findUniqueEmployeeMatch(employeeIndex.byNormalizedPhone, rootLeg?.toNumber) ??
        findUniqueEmployeeMatch(employeeIndex.byNormalizedPhone, primaryLeg?.fromNumber),
      recipientEmployee: null,
    };
  }

  if (direction === "inbound") {
    return {
      employee: null,
      recipientEmployee:
        findUniqueEmployeeMatch(employeeIndex.byCallerIdPhone, primaryLeg?.toNumber) ??
        findUniqueEmployeeMatch(employeeIndex.byNormalizedPhone, primaryLeg?.toNumber),
    };
  }

  return {
    employee: null,
    recipientEmployee: null,
  };
}

function buildMetadataJson(group: CallLegRecord[], appContext: ParsedLegMetadata["appContext"] | null): string {
  const events = group.flatMap((leg) => parseLegMetadata(leg.rawJson).events ?? []);
  return JSON.stringify({
    appContext: appContext ?? null,
    events,
  });
}

function readPresentedCallerId(
  primaryLeg: CallLegRecord | null,
  appContext: ParsedLegMetadata["appContext"] | null,
): string | null {
  return formatPhoneForTwilioDial(appContext?.callerId) ?? formatPhoneForTwilioDial(primaryLeg?.fromNumber);
}

function readCounterpartyPhone(
  primaryLeg: CallLegRecord | null,
  direction: CallAnalyticsDirection,
): string | null {
  if (!primaryLeg) {
    return null;
  }

  if (direction === "inbound") {
    return formatPhoneForTwilioDial(primaryLeg.fromNumber);
  }

  return formatPhoneForTwilioDial(primaryLeg.toNumber);
}

function buildSessionRecord(
  rootSid: string,
  group: CallLegRecord[],
  employeeIndex: EmployeeIndex,
  phoneIndex: PhoneMatchIndex,
  options: SessionizeOptions,
): CallSessionRecord {
  const rootLeg = group.find((leg) => leg.sid === rootSid) ?? group.find((leg) => !leg.parentSid) ?? group[0] ?? null;
  const appContext = readAppContext(group);
  const bridgeNumbers = new Set((options.bridgeNumbers ?? []).map((value) => formatPhoneForTwilioDial(value)).filter((value): value is string => Boolean(value)));
  const isBridge = detectBridgeCall(rootLeg, group, employeeIndex, bridgeNumbers) || Boolean(appContext?.sourcePage);
  const primaryLeg = choosePrimaryLeg(group, isBridge);
  const direction = determineDirection(primaryLeg, isBridge);
  const source = determineSource(group, direction, isBridge, appContext);
  const outcomeData = computeOutcome(primaryLeg);
  const attribution = determineEmployeeAttribution(primaryLeg, rootLeg, direction, appContext, employeeIndex);
  const startedAt = minIso(group.map((leg) => leg.startedAt));
  const answeredAt = primaryLeg?.answeredAt ?? null;
  const endedAt = maxIso(group.map((leg) => leg.endedAt));
  const counterpartyPhone = readCounterpartyPhone(primaryLeg, direction);
  const match = matchPhoneToAccountWithIndex(phoneIndex, counterpartyPhone);
  const sessionId = determineSessionId(rootSid, group, appContext);

  return {
    sessionId,
    rootCallSid: rootSid,
    primaryLegSid: primaryLeg?.sid ?? null,
    source,
    direction,
    outcome: outcomeData.outcome,
    answered: outcomeData.answered,
    startedAt,
    answeredAt,
    endedAt,
    talkDurationSeconds: primaryLeg?.durationSeconds ?? null,
    ringDurationSeconds:
      primaryLeg?.ringDurationSeconds ??
      computeRingDuration(startedAt, answeredAt, endedAt, outcomeData.answered),
    employeeLoginName: attribution.employee?.loginName ?? appContext?.loginName ?? null,
    employeeDisplayName: attribution.employee?.displayName ?? appContext?.displayName ?? null,
    employeeContactId: attribution.employee?.contactId ?? null,
    employeePhone: attribution.employee?.normalizedPhone ?? formatPhoneForTwilioDial(appContext?.userPhone) ?? null,
    recipientEmployeeLoginName: attribution.recipientEmployee?.loginName ?? null,
    recipientEmployeeDisplayName: attribution.recipientEmployee?.displayName ?? null,
    presentedCallerId: readPresentedCallerId(primaryLeg, appContext),
    bridgeNumber: formatPhoneForTwilioDial(appContext?.bridgeNumber) ?? formatPhoneForTwilioDial(rootLeg?.fromNumber),
    targetPhone:
      direction === "outbound"
        ? formatPhoneForTwilioDial(primaryLeg?.toNumber)
        : formatPhoneForTwilioDial(primaryLeg?.fromNumber),
    counterpartyPhone,
    matchedContactId: match.matchedContactId,
    matchedContactName: match.matchedContactName,
    matchedBusinessAccountId: match.matchedBusinessAccountId,
    matchedCompanyName:
      match.matchedCompanyName ?? appContext?.linkedCompanyName ?? null,
    phoneMatchType: match.phoneMatchType,
    phoneMatchAmbiguityCount: match.phoneMatchAmbiguityCount,
    initiatedFromSurface: appContext?.sourcePage ?? "unknown",
    linkedAccountRowKey: appContext?.linkedAccountRowKey ?? null,
    linkedBusinessAccountId:
      appContext?.linkedBusinessAccountId ?? match.matchedBusinessAccountId ?? null,
    linkedContactId: appContext?.linkedContactId ?? match.matchedContactId ?? null,
    metadataJson: buildMetadataJson(group, appContext),
    updatedAt: new Date().toISOString(),
  };
}

function readAllCallLegs(): CallLegRecord[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      FROM call_legs
      ORDER BY COALESCE(started_at, updated_at) ASC, sid ASC
      `,
    )
    .all() as StoredCallLegRow[];

  return rows.map(normalizeStoredCallLeg);
}

function readRootSidMap(legs: CallLegRecord[]): Map<string, string> {
  const bySid = new Map(legs.map((leg) => [leg.sid, leg]));
  const memo = new Map<string, string>();

  function resolveRootSid(sid: string): string {
    const cached = memo.get(sid);
    if (cached) {
      return cached;
    }

    const leg = bySid.get(sid);
    if (!leg || !leg.parentSid || !bySid.has(leg.parentSid)) {
      memo.set(sid, sid);
      return sid;
    }

    const rootSid = resolveRootSid(leg.parentSid);
    memo.set(sid, rootSid);
    return rootSid;
  }

  for (const leg of legs) {
    resolveRootSid(leg.sid);
  }

  return memo;
}

export function rebuildCallSessions(options: SessionizeOptions = {}): CallSessionRecord[] {
  const db = getReadModelDb();
  const legs = readAllCallLegs();
  const employeeIndex = buildEmployeeIndex(readCallEmployeeDirectory());
  const phoneIndex = buildPhoneMatchIndex();
  const rootSidMap = readRootSidMap(legs);
  const groups = new Map<string, CallLegRecord[]>();

  for (const leg of legs) {
    const rootSid = rootSidMap.get(leg.sid) ?? leg.sid;
    const group = groups.get(rootSid) ?? [];
    group.push(leg);
    groups.set(rootSid, group);
  }

  const sessions = [...groups.entries()].map(([rootSid, group]) =>
    buildSessionRecord(rootSid, group, employeeIndex, phoneIndex, options),
  );

  const replace = db.transaction((nextSessions: CallSessionRecord[]) => {
    const updateLegSession = db.prepare(
      `
      UPDATE call_legs
      SET session_id = ?,
          updated_at = ?
      WHERE sid = ?
      `,
    );
    for (const session of nextSessions) {
      const group = groups.get(session.rootCallSid) ?? [];
      for (const leg of group) {
        updateLegSession.run(session.sessionId, new Date().toISOString(), leg.sid);
      }
    }

    db.prepare("DELETE FROM call_sessions").run();
    const insert = db.prepare(
      `
      INSERT INTO call_sessions (
        session_id,
        root_call_sid,
        primary_leg_sid,
        source,
        direction,
        outcome,
        answered,
        started_at,
        answered_at,
        ended_at,
        talk_duration_seconds,
        ring_duration_seconds,
        employee_login_name,
        employee_display_name,
        employee_contact_id,
        employee_phone,
        recipient_employee_login_name,
        recipient_employee_display_name,
        presented_caller_id,
        bridge_number,
        target_phone,
        counterparty_phone,
        matched_contact_id,
        matched_contact_name,
        matched_business_account_id,
        matched_company_name,
        phone_match_type,
        phone_match_ambiguity_count,
        initiated_from_surface,
        linked_account_row_key,
        linked_business_account_id,
        linked_contact_id,
        metadata_json,
        updated_at
      ) VALUES (
        @session_id,
        @root_call_sid,
        @primary_leg_sid,
        @source,
        @direction,
        @outcome,
        @answered,
        @started_at,
        @answered_at,
        @ended_at,
        @talk_duration_seconds,
        @ring_duration_seconds,
        @employee_login_name,
        @employee_display_name,
        @employee_contact_id,
        @employee_phone,
        @recipient_employee_login_name,
        @recipient_employee_display_name,
        @presented_caller_id,
        @bridge_number,
        @target_phone,
        @counterparty_phone,
        @matched_contact_id,
        @matched_contact_name,
        @matched_business_account_id,
        @matched_company_name,
        @phone_match_type,
        @phone_match_ambiguity_count,
        @initiated_from_surface,
        @linked_account_row_key,
        @linked_business_account_id,
        @linked_contact_id,
        @metadata_json,
        @updated_at
      )
      `,
    );

    for (const session of nextSessions) {
      insert.run({
        session_id: session.sessionId,
        root_call_sid: session.rootCallSid,
        primary_leg_sid: session.primaryLegSid,
        source: session.source,
        direction: session.direction,
        outcome: session.outcome,
        answered: session.answered ? 1 : 0,
        started_at: session.startedAt,
        answered_at: session.answeredAt,
        ended_at: session.endedAt,
        talk_duration_seconds: session.talkDurationSeconds,
        ring_duration_seconds: session.ringDurationSeconds,
        employee_login_name: session.employeeLoginName,
        employee_display_name: session.employeeDisplayName,
        employee_contact_id: session.employeeContactId,
        employee_phone: session.employeePhone,
        recipient_employee_login_name: session.recipientEmployeeLoginName,
        recipient_employee_display_name: session.recipientEmployeeDisplayName,
        presented_caller_id: session.presentedCallerId,
        bridge_number: session.bridgeNumber,
        target_phone: session.targetPhone,
        counterparty_phone: session.counterpartyPhone,
        matched_contact_id: session.matchedContactId,
        matched_contact_name: session.matchedContactName,
        matched_business_account_id: session.matchedBusinessAccountId,
        matched_company_name: session.matchedCompanyName,
        phone_match_type: session.phoneMatchType,
        phone_match_ambiguity_count: session.phoneMatchAmbiguityCount,
        initiated_from_surface: session.initiatedFromSurface,
        linked_account_row_key: session.linkedAccountRowKey,
        linked_business_account_id: session.linkedBusinessAccountId,
        linked_contact_id: session.linkedContactId,
        metadata_json: session.metadataJson,
        updated_at: session.updatedAt,
      });
    }
  });

  replace(sessions);
  sessions.forEach((session) => {
    upsertCallAuditEvent(session);
  });
  invalidateDashboardSnapshotCache();
  publishAuditLogChanged("call-sessions-rebuilt");
  return sessions;
}

type StoredCallSessionRow = {
  session_id: string;
  root_call_sid: string;
  primary_leg_sid: string | null;
  source: string;
  direction: string;
  outcome: string;
  answered: number;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  talk_duration_seconds: number | null;
  ring_duration_seconds: number | null;
  employee_login_name: string | null;
  employee_display_name: string | null;
  employee_contact_id: number | null;
  employee_phone: string | null;
  recipient_employee_login_name: string | null;
  recipient_employee_display_name: string | null;
  presented_caller_id: string | null;
  bridge_number: string | null;
  target_phone: string | null;
  counterparty_phone: string | null;
  matched_contact_id: number | null;
  matched_contact_name: string | null;
  matched_business_account_id: string | null;
  matched_company_name: string | null;
  phone_match_type: string | null;
  phone_match_ambiguity_count: number;
  initiated_from_surface: string | null;
  linked_account_row_key: string | null;
  linked_business_account_id: string | null;
  linked_contact_id: number | null;
  metadata_json: string;
  updated_at: string;
};

function normalizeCallSessionRow(row: StoredCallSessionRow): CallSessionRecord {
  return {
    sessionId: row.session_id,
    rootCallSid: row.root_call_sid,
    primaryLegSid: row.primary_leg_sid,
    source: normalizeSource(row.source),
    direction: (["outbound", "inbound", "internal", "unknown"].includes(row.direction)
      ? row.direction
      : "unknown") as CallAnalyticsDirection,
    outcome: (
      [
        "answered",
        "no_answer",
        "busy",
        "failed",
        "canceled",
        "in_progress",
        "unknown",
      ].includes(row.outcome)
        ? row.outcome
        : "unknown"
    ) as CallAnalyticsOutcome,
    answered: row.answered === 1,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    talkDurationSeconds: row.talk_duration_seconds,
    ringDurationSeconds: row.ring_duration_seconds,
    employeeLoginName: row.employee_login_name,
    employeeDisplayName: row.employee_display_name,
    employeeContactId: row.employee_contact_id,
    employeePhone: row.employee_phone,
    recipientEmployeeLoginName: row.recipient_employee_login_name,
    recipientEmployeeDisplayName: row.recipient_employee_display_name,
    presentedCallerId: row.presented_caller_id,
    bridgeNumber: row.bridge_number,
    targetPhone: row.target_phone,
    counterpartyPhone: row.counterparty_phone,
    matchedContactId: row.matched_contact_id,
    matchedContactName: row.matched_contact_name,
    matchedBusinessAccountId: row.matched_business_account_id,
    matchedCompanyName: row.matched_company_name,
    phoneMatchType: (row.phone_match_type === "contact_phone" || row.phone_match_type === "company_phone"
      ? row.phone_match_type
      : "none"),
    phoneMatchAmbiguityCount: row.phone_match_ambiguity_count,
    initiatedFromSurface:
      row.initiated_from_surface === "accounts" ||
      row.initiated_from_surface === "map" ||
      row.initiated_from_surface === "tasks"
        ? row.initiated_from_surface
        : "unknown",
    linkedAccountRowKey: row.linked_account_row_key,
    linkedBusinessAccountId: row.linked_business_account_id,
    linkedContactId: row.linked_contact_id,
    metadataJson: row.metadata_json,
    updatedAt: row.updated_at,
  };
}

export function readCallSessions(): CallSessionRecord[] {
  maybeRepairCallSessionsFromEmployeeDirectory();
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        session_id,
        root_call_sid,
        primary_leg_sid,
        source,
        direction,
        outcome,
        answered,
        started_at,
        answered_at,
        ended_at,
        talk_duration_seconds,
        ring_duration_seconds,
        employee_login_name,
        employee_display_name,
        employee_contact_id,
        employee_phone,
        recipient_employee_login_name,
        recipient_employee_display_name,
        presented_caller_id,
        bridge_number,
        target_phone,
        counterparty_phone,
        matched_contact_id,
        matched_contact_name,
        matched_business_account_id,
        matched_company_name,
        phone_match_type,
        phone_match_ambiguity_count,
        initiated_from_surface,
        linked_account_row_key,
        linked_business_account_id,
        linked_contact_id,
        metadata_json,
        updated_at
      FROM call_sessions
      ORDER BY COALESCE(started_at, updated_at) DESC, session_id DESC
      `,
    )
    .all() as StoredCallSessionRow[];

  return rows.map(normalizeCallSessionRow);
}

export function readCallSessionById(sessionId: string): CallSessionRecord | null {
  maybeRepairCallSessionsFromEmployeeDirectory();
  const db = getReadModelDb();
  const row = db
    .prepare(
      `
      SELECT
        session_id,
        root_call_sid,
        primary_leg_sid,
        source,
        direction,
        outcome,
        answered,
        started_at,
        answered_at,
        ended_at,
        talk_duration_seconds,
        ring_duration_seconds,
        employee_login_name,
        employee_display_name,
        employee_contact_id,
        employee_phone,
        recipient_employee_login_name,
        recipient_employee_display_name,
        presented_caller_id,
        bridge_number,
        target_phone,
        counterparty_phone,
        matched_contact_id,
        matched_contact_name,
        matched_business_account_id,
        matched_company_name,
        phone_match_type,
        phone_match_ambiguity_count,
        initiated_from_surface,
        linked_account_row_key,
        linked_business_account_id,
        linked_contact_id,
        metadata_json,
        updated_at
      FROM call_sessions
      WHERE session_id = ?
      `,
    )
    .get(sessionId.trim()) as StoredCallSessionRow | undefined;

  return row ? normalizeCallSessionRow(row) : null;
}

export function readCallLegsBySessionId(sessionId: string): CallLegRecord[] {
  const db = getReadModelDb();
  const rows = db
    .prepare(
      `
      SELECT
        sid,
        parent_sid,
        session_id,
        direction,
        from_number,
        to_number,
        status,
        answered,
        answered_at,
        started_at,
        ended_at,
        duration_seconds,
        ring_duration_seconds,
        price,
        price_unit,
        source,
        leg_type,
        raw_json,
        updated_at
      FROM call_legs
      WHERE session_id = ?
      ORDER BY COALESCE(started_at, updated_at) ASC, sid ASC
      `,
    )
    .all(sessionId.trim()) as StoredCallLegRow[];

  return rows.map(normalizeStoredCallLeg);
}

function maybeRepairCallSessionsFromEmployeeDirectory(): void {
  if (repairingCallSessionsFromEmployeeDirectory) {
    return;
  }

  const directoryMeta = readCallEmployeeDirectoryMeta();
  if (!directoryMeta.latestUpdatedAt) {
    return;
  }

  const db = getReadModelDb();
  const staleUnattributedRow = db
    .prepare(
      `
      SELECT session_id
      FROM call_sessions
      WHERE employee_login_name IS NULL
        AND recipient_employee_login_name IS NULL
        AND updated_at < ?
      LIMIT 1
      `,
    )
    .get(directoryMeta.latestUpdatedAt) as { session_id: string } | undefined;

  if (!staleUnattributedRow) {
    return;
  }

  repairingCallSessionsFromEmployeeDirectory = true;
  try {
    rebuildCallSessions();
  } finally {
    repairingCallSessionsFromEmployeeDirectory = false;
  }
}
