import { describe, expect, it } from "vitest";

import { buildTicketAcknowledgementCopy } from "@/lib/support-ticket-mail";
import type { SupportTicketRecord } from "@/lib/support-ticket-store";

function ticket(): SupportTicketRecord {
  return {
    id: "ticket-1",
    ticketNumber: 1,
    title: "I cannot save a customer note",
    category: "accounts",
    impact: "major",
    status: "investigating",
    employeeName: "Jamie Employee",
    employeeEmail: "jamie@meadowb.com",
    description: "The save button does not work.",
    expectedBehavior: null,
    stepsToReproduce: null,
    pageUrl: null,
    submittedByLogin: "jamie",
    emailThreadId: null,
    emailMessageId: null,
    lastIncomingMessageAt: null,
    diagnosis: null,
    resolution: null,
    processingAttempts: 0,
    processingStartedAt: null,
    nextCheckAt: null,
    lastError: null,
    latestUpdate: null,
    attachmentCount: 0,
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  };
}

describe("ticket acknowledgement copy", () => {
  it("uses simple language and confirms attached files", () => {
    const copy = buildTicketAcknowledgementCopy(ticket(), 2);
    const message = [copy.heading, ...copy.paragraphs].join(" ");

    expect(message).toContain("Your ticket number is CRM-0001");
    expect(message).toContain("We also received 2 files");
    expect(message).not.toMatch(/\b(?:diagnostics|sync|runtime|repository|deployment|pipeline)\b/i);
  });
});
