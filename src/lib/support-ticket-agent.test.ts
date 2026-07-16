import { describe, expect, it } from "vitest";

import {
  canRunReadModelRefresh,
  isPlainSupportLanguage,
  type TicketDiagnostic,
} from "@/lib/support-ticket-agent";
import type { SupportTicketRecord } from "@/lib/support-ticket-store";
import { classifyTicketConfirmation } from "@/lib/support-ticket-worker";

function buildTicket(overrides?: Partial<SupportTicketRecord>): SupportTicketRecord {
  return {
    id: "ticket-1",
    ticketNumber: 1,
    title: "Account search is showing old results",
    category: "accounts",
    impact: "major",
    status: "investigating",
    employeeName: "Preview Employee",
    employeeEmail: "preview@meadowb.com",
    description: "A newly assigned account is missing from search.",
    expectedBehavior: null,
    stepsToReproduce: null,
    pageUrl: null,
    submittedByLogin: "preview",
    emailThreadId: null,
    emailMessageId: null,
    lastIncomingMessageAt: null,
    diagnosis: null,
    resolution: null,
    processingAttempts: 1,
    processingStartedAt: null,
    nextCheckAt: null,
    lastError: null,
    latestUpdate: null,
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
    ...overrides,
  };
}

function buildDiagnostics(syncPayload: Record<string, unknown>): TicketDiagnostic[] {
  return [
    {
      name: "sync_status",
      path: "/api/sync/status",
      ok: true,
      statusCode: 200,
      durationMs: 10,
      summary: "200",
      payload: syncPayload,
    },
  ];
}

describe("support ticket safety gates", () => {
  it("allows a local read-model refresh only for stale account data", () => {
    expect(canRunReadModelRefresh(
      buildTicket(),
      buildDiagnostics({ status: "stale", lastSuccessfulSyncAt: "2026-07-16T09:00:00.000Z" }),
    )).toBe(true);
  });

  it("blocks the refresh for unrelated CRM areas even when sync is stale", () => {
    expect(canRunReadModelRefresh(
      buildTicket({ category: "mail", title: "Mail will not send", description: "Sending fails." }),
      buildDiagnostics({ status: "stale" }),
    )).toBe(false);
  });

  it("blocks the refresh when sync evidence is healthy", () => {
    expect(canRunReadModelRefresh(
      buildTicket(),
      buildDiagnostics({ status: "idle", lastSuccessfulSyncAt: new Date().toISOString() }),
    )).toBe(false);
  });
});

describe("employee confirmation classification", () => {
  it("recognizes a clear resolution confirmation", () => {
    expect(classifyTicketConfirmation("Yes, it is working now. Thanks!")).toBe("confirmed");
  });

  it("prioritizes an unresolved signal over positive words", () => {
    expect(classifyTicketConfirmation("Thanks, but it is still not working.")).toBe("not_resolved");
  });

  it("keeps ambiguous replies open", () => {
    expect(classifyTicketConfirmation("I will try again after lunch.")).toBe("unclear");
    expect(classifyTicketConfirmation("Thanks for looking into this.")).toBe("unclear");
    expect(classifyTicketConfirmation("Yes.")).toBe("unclear");
  });
});

describe("employee-facing language", () => {
  it("accepts short, clear support language", () => {
    expect(isPlainSupportLanguage(
      "We found the problem and are working on a fix. We will email you when it is ready.",
    )).toBe(true);
  });

  it("rejects internal technical wording", () => {
    expect(isPlainSupportLanguage(
      "The deployment passed the runtime health check for the latest commit.",
    )).toBe(false);
  });

  it("rejects sentences that are too long for the intended reader", () => {
    expect(isPlainSupportLanguage(
      "We reviewed all of the information that was provided with your ticket and carefully checked several parts of the CRM before deciding what should happen next.",
    )).toBe(false);
  });
});
