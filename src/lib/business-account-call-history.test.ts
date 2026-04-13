import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CallActivitySyncRecord,
  CallSessionRecord,
} from "@/lib/call-analytics/types";
import type { BusinessAccountRow } from "@/types/business-account";

const readCallSessionsMock = vi.fn<() => CallSessionRecord[]>();
const readCallActivitySyncBySessionIdMock = vi.fn<
  (sessionId: string) => CallActivitySyncRecord | null
>();

vi.mock("@/lib/call-analytics/sessionize", () => ({
  readCallSessions: readCallSessionsMock,
}));

vi.mock("@/lib/call-analytics/postcall-store", () => ({
  readCallActivitySyncBySessionId: readCallActivitySyncBySessionIdMock,
}));

function buildRow(overrides: Partial<BusinessAccountRow> = {}): BusinessAccountRow {
  return {
    id: overrides.id ?? "account-1",
    accountRecordId: overrides.accountRecordId ?? "account-1",
    rowKey: overrides.rowKey ?? "account-1:contact:101",
    contactId: overrides.contactId ?? 101,
    isPrimaryContact: overrides.isPrimaryContact ?? true,
    companyPhone: overrides.companyPhone ?? "905-555-0100",
    companyPhoneSource: overrides.companyPhoneSource ?? "account",
    phoneNumber: overrides.phoneNumber ?? "905-555-0100",
    salesRepId: overrides.salesRepId ?? null,
    salesRepName: overrides.salesRepName ?? null,
    accountType: overrides.accountType ?? "Customer",
    opportunityCount: overrides.opportunityCount ?? 0,
    industryType: overrides.industryType ?? null,
    subCategory: overrides.subCategory ?? null,
    companyRegion: overrides.companyRegion ?? null,
    week: overrides.week ?? null,
    businessAccountId: overrides.businessAccountId ?? "B2001",
    companyName: overrides.companyName ?? "Example Co",
    companyDescription: overrides.companyDescription ?? null,
    address: overrides.address ?? "123 Main St",
    addressLine1: overrides.addressLine1 ?? "123 Main St",
    addressLine2: overrides.addressLine2 ?? "",
    city: overrides.city ?? "Toronto",
    state: overrides.state ?? "ON",
    postalCode: overrides.postalCode ?? "M5H 2N2",
    country: overrides.country ?? "CA",
    primaryContactName: overrides.primaryContactName ?? "Alex Prospect",
    primaryContactJobTitle: overrides.primaryContactJobTitle ?? null,
    primaryContactPhone: overrides.primaryContactPhone ?? "905-555-0100",
    primaryContactExtension: overrides.primaryContactExtension ?? null,
    primaryContactRawPhone: overrides.primaryContactRawPhone ?? "9055550100",
    primaryContactEmail: overrides.primaryContactEmail ?? "alex@example.com",
    primaryContactId: overrides.primaryContactId ?? 101,
    category: overrides.category ?? null,
    notes: overrides.notes ?? null,
    lastCalledAt: overrides.lastCalledAt ?? null,
    lastEmailedAt: overrides.lastEmailedAt ?? null,
    lastModifiedIso: overrides.lastModifiedIso ?? "2026-04-01T09:00:00.000Z",
  };
}

function buildSession(overrides: Partial<CallSessionRecord> = {}): CallSessionRecord {
  return {
    sessionId: overrides.sessionId ?? "call-1",
    rootCallSid: overrides.rootCallSid ?? "CA-root",
    primaryLegSid: overrides.primaryLegSid ?? "CA-leg",
    source: overrides.source ?? "app_bridge",
    direction: overrides.direction ?? "outbound",
    outcome: overrides.outcome ?? "answered",
    answered: overrides.answered ?? true,
    startedAt: overrides.startedAt ?? "2026-04-10T14:00:00.000Z",
    answeredAt: overrides.answeredAt ?? "2026-04-10T14:00:03.000Z",
    endedAt: overrides.endedAt ?? "2026-04-10T14:10:00.000Z",
    talkDurationSeconds: overrides.talkDurationSeconds ?? 600,
    ringDurationSeconds: overrides.ringDurationSeconds ?? 3,
    employeeLoginName: overrides.employeeLoginName ?? "jserrano",
    employeeDisplayName: overrides.employeeDisplayName ?? "Jorge Serrano",
    employeeContactId: overrides.employeeContactId ?? 157497,
    employeePhone: overrides.employeePhone ?? "+14162304681",
    recipientEmployeeLoginName: overrides.recipientEmployeeLoginName ?? null,
    recipientEmployeeDisplayName: overrides.recipientEmployeeDisplayName ?? null,
    presentedCallerId: overrides.presentedCallerId ?? "+14162304681",
    bridgeNumber: overrides.bridgeNumber ?? "+16474929859",
    targetPhone: overrides.targetPhone ?? "+19055550100",
    counterpartyPhone: overrides.counterpartyPhone ?? "+19055550100",
    matchedContactId: overrides.matchedContactId ?? 101,
    matchedContactName: overrides.matchedContactName ?? "Alex Prospect",
    matchedBusinessAccountId: overrides.matchedBusinessAccountId ?? "B2001",
    matchedCompanyName: overrides.matchedCompanyName ?? "Example Co",
    phoneMatchType: overrides.phoneMatchType ?? "contact_phone",
    phoneMatchAmbiguityCount: overrides.phoneMatchAmbiguityCount ?? 1,
    initiatedFromSurface: overrides.initiatedFromSurface ?? "accounts",
    linkedAccountRowKey: overrides.linkedAccountRowKey ?? "account-1:contact:101",
    linkedBusinessAccountId: overrides.linkedBusinessAccountId ?? "B2001",
    linkedContactId: overrides.linkedContactId ?? 101,
    metadataJson: overrides.metadataJson ?? "{}",
    updatedAt: overrides.updatedAt ?? "2026-04-10T14:10:00.000Z",
  };
}

describe("business account call history", () => {
  beforeEach(() => {
    vi.resetModules();
    readCallSessionsMock.mockReset();
    readCallActivitySyncBySessionIdMock.mockReset();
    readCallActivitySyncBySessionIdMock.mockReturnValue(null);
  });

  it("uses contact phone matches to drive last-called values for contact rows", async () => {
    readCallSessionsMock.mockReturnValue([
      buildSession({
        sessionId: "call-linked-different-phone",
        startedAt: "2026-04-13T15:00:00.000Z",
        linkedAccountRowKey: "account-1:contact:101",
        linkedContactId: 101,
        matchedContactId: 101,
        targetPhone: "+14165550199",
        counterpartyPhone: "+14165550199",
      }),
      buildSession({
        sessionId: "call-phone-match",
        startedAt: "2026-04-12T13:00:00.000Z",
        linkedAccountRowKey: null,
        linkedContactId: null,
        matchedContactId: null,
      }),
      buildSession({
        sessionId: "call-other",
        startedAt: "2026-04-13T09:00:00.000Z",
        linkedAccountRowKey: "account-2:contact:202",
        linkedContactId: 202,
        matchedContactId: 202,
        targetPhone: "+14165550101",
        counterpartyPhone: "+14165550101",
      }),
    ]);

    const { applyLastCalledAtToBusinessAccountRows } = await import(
      "@/lib/business-account-call-history"
    );
    const rows = applyLastCalledAtToBusinessAccountRows([
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:101",
        contactId: 101,
        primaryContactId: 101,
        primaryContactPhone: "905-555-0100",
      }),
      buildRow({
        id: "account-2",
        accountRecordId: "account-2",
        rowKey: "account-2:contact:202",
        businessAccountId: "B2002",
        contactId: 202,
        primaryContactId: 202,
        primaryContactPhone: "416-555-0101",
      }),
    ]);

    expect(rows[0]?.lastCalledAt).toBe("2026-04-12T13:00:00.000Z");
    expect(rows[1]?.lastCalledAt).toBe("2026-04-13T09:00:00.000Z");
  });

  it("returns prior-call items with recording and AI summary metadata", async () => {
    readCallSessionsMock.mockReturnValue([
      buildSession({
        sessionId: "call-1",
        startedAt: "2026-04-12T15:00:00.000Z",
        linkedAccountRowKey: "account-1:contact:101",
        linkedContactId: 101,
      }),
    ]);
    readCallActivitySyncBySessionIdMock.mockReturnValue({
      sessionId: "call-1",
      recordingSid: "RE123",
      recordingStatus: "completed",
      recordingDurationSeconds: 42,
      status: "synced",
      attempts: 1,
      transcriptText: "Transcript text from the stored post-call pass.",
      summaryText: "Short AI summary.",
      activityId: "ACT-123",
      error: null,
      recordingDeletedAt: null,
      createdAt: "2026-04-12T15:05:00.000Z",
      updatedAt: "2026-04-12T15:06:00.000Z",
    });

    const { buildBusinessAccountCallHistoryResponse } = await import(
      "@/lib/business-account-call-history"
    );
    const response = buildBusinessAccountCallHistoryResponse(
      buildRow({
        id: "account-1",
        accountRecordId: "account-1",
        rowKey: "account-1:contact:101",
        contactId: 101,
        primaryContactId: 101,
      }),
    );

    expect(response.lastCalledAt).toBe("2026-04-12T15:00:00.000Z");
    expect(response.items).toEqual([
      expect.objectContaining({
        sessionId: "call-1",
        recordingSid: "RE123",
        recordingStatus: "completed",
        activitySyncStatus: "synced",
        summaryText: "Short AI summary.",
        transcriptText: "Transcript text from the stored post-call pass.",
      }),
    ]);
  });
});
