import {
  canRunReadModelRefresh,
  collectTicketDiagnostics,
  decideTicketAction,
  runReadModelRefresh,
} from "@/lib/support-ticket-agent";
import {
  readTicketEmailThread,
  replyToTicketEmail,
  sendTicketAcknowledgement,
} from "@/lib/support-ticket-mail";
import {
  canDispatchTicketCodeRepair,
  dispatchTicketCodeRepair,
} from "@/lib/support-ticket-repair";
import {
  addSupportTicketEvent,
  claimSupportTicketForProcessing,
  hasSupportTicketEvent,
  readSupportTicket,
  releaseSupportTicketAfterFailure,
  updateSupportTicket,
  type SupportTicketRecord,
} from "@/lib/support-ticket-store";
import type { MailMessage } from "@/types/mail-thread";

const POLL_INTERVAL_MS = 60_000;

function messageTimestamp(message: MailMessage): string | null {
  return message.receivedAt || message.sentAt || null;
}

function newestIncomingMessage(ticket: SupportTicketRecord, messages: MailMessage[]): MailMessage | null {
  const lastProcessedMs = ticket.lastIncomingMessageAt ? Date.parse(ticket.lastIncomingMessageAt) : 0;
  return messages
    .filter((message) => message.direction === "incoming")
    .filter((message) => {
      const timestamp = messageTimestamp(message);
      return timestamp ? Date.parse(timestamp) > lastProcessedMs : false;
    })
    .sort((left, right) => Date.parse(messageTimestamp(left) ?? "") - Date.parse(messageTimestamp(right) ?? ""))
    .at(-1) ?? null;
}

export function classifyTicketConfirmation(text: string): "confirmed" | "not_resolved" | "unclear" {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return "unclear";
  }
  if (/\b(not|still|broken|failed|failing|doesn'?t|isn'?t|can'?t|cannot|same issue)\b/.test(normalized)) {
    return "not_resolved";
  }
  if (/\b(confirmed|resolved|fixed|works|working now|all good|good now|looks good)\b/.test(normalized)) {
    return "confirmed";
  }
  return "unclear";
}

async function ensureAcknowledgement(ticket: SupportTicketRecord): Promise<SupportTicketRecord> {
  if (ticket.emailThreadId) {
    return ticket;
  }
  const sent = await sendTicketAcknowledgement(ticket);
  const updated = updateSupportTicket(ticket.id, {
    emailThreadId: sent.threadId,
    emailMessageId: sent.messageId,
    lastError: null,
  });
  addSupportTicketEvent({
    ticketId: ticket.id,
    eventType: "acknowledgement_sent",
    actorType: "robot",
    message: `Acknowledgement emailed to ${ticket.employeeEmail}.`,
    details: { threadId: sent.threadId, messageId: sent.messageId },
  });
  if (!updated) {
    throw new Error("Ticket disappeared after acknowledgement.");
  }
  return updated;
}

async function investigateAndReply(
  ticket: SupportTicketRecord,
  latestEmployeeReply: string | null,
): Promise<void> {
  const diagnostics = await collectTicketDiagnostics();
  addSupportTicketEvent({
    ticketId: ticket.id,
    eventType: "diagnostics_completed",
    actorType: "robot",
    message: `Diagnostics completed: ${diagnostics.filter((item) => item.ok).length}/${diagnostics.length} checks healthy.`,
    details: { diagnostics },
  });

  const decision = await decideTicketAction({ ticket, diagnostics, latestEmployeeReply });
  let remediationNote = "No automatic change was made.";
  let remediationSucceeded = false;

  if (decision.remediation === "code_repair" && canDispatchTicketCodeRepair(ticket)) {
    try {
      const repair = await dispatchTicketCodeRepair(ticket);
      const latestTicket = readSupportTicket(ticket.id) ?? ticket;
      const sent = await replyToTicketEmail(latestTicket, {
        heading: "I’m preparing a verified code repair",
        paragraphs: [
          decision.employeeMessage,
          "An isolated coding agent is inspecting the repository now. A patch can deploy only after path restrictions, the full test suite, production build, lint checks, and an independent risk review all pass.",
          "After Render reports the exact repaired commit as healthy, I’ll reply here and ask you to test the original problem. If validation or deployment fails, no unverified repair will remain active.",
        ],
      });
      updateSupportTicket(ticket.id, {
        status: "repairing",
        diagnosis: decision.diagnosis,
        emailMessageId: sent.messageId,
        processingStartedAt: null,
        lastError: null,
      });
      addSupportTicketEvent({
        ticketId: ticket.id,
        eventType: "code_repair_update_sent",
        actorType: "robot",
        message: "The employee was told that a verified code repair is in progress.",
        details: { repairRunId: repair.repairRunId, messageId: sent.messageId },
      });
      return;
    } catch {
      remediationNote = "The isolated code repair job could not be started, so no repository or production change was made.";
    }
  } else if (decision.remediation === "code_repair") {
    remediationNote = "The proposed code repair did not meet the automatic repair gate, so no repository or production change was made.";
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "remediation_blocked",
      actorType: "system",
      message: remediationNote,
      details: { requested: decision.remediation, reason: decision.remediationReason },
    });
  }

  if (
    decision.remediation === "refresh_read_model" &&
    !hasSupportTicketEvent(ticket.id, "read_model_refresh_started") &&
    canRunReadModelRefresh(ticket, diagnostics)
  ) {
    const result = await runReadModelRefresh();
    remediationSucceeded = result.ok;
    remediationNote = result.ok
      ? "I started a safe refresh of the CRM’s local account cache. No source CRM records were changed."
      : "The safe cache refresh could not be started, so I left the data unchanged and flagged the ticket for review.";
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: result.ok ? "read_model_refresh_started" : "read_model_refresh_failed",
      actorType: "robot",
      message: remediationNote,
      details: { result, reason: decision.remediationReason },
    });
  } else if (decision.remediation !== "none" && decision.remediation !== "code_repair") {
    remediationNote = "The suggested action did not meet the automatic safety rule, so I left the CRM unchanged.";
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "remediation_blocked",
      actorType: "system",
      message: remediationNote,
      details: { requested: decision.remediation, reason: decision.remediationReason },
    });
  }

  const latestTicket = readSupportTicket(ticket.id) ?? ticket;
  const sent = await replyToTicketEmail(latestTicket, {
    heading: remediationSucceeded ? "I found a safe action to try" : "Investigation update",
    paragraphs: [
      decision.employeeMessage,
      remediationNote,
      `${decision.confirmationQuestion} Please reply with “resolved” if it is working, or “still broken” and what you see if it is not.`,
    ],
  });
  const shouldEscalate = decision.shouldEscalate ||
    decision.remediation === "code_repair" ||
    (decision.remediation === "refresh_read_model" && !remediationSucceeded);
  updateSupportTicket(ticket.id, {
    status: shouldEscalate ? "escalated" : "waiting_for_employee",
    diagnosis: decision.diagnosis,
    resolution: remediationSucceeded ? remediationNote : null,
    emailMessageId: sent.messageId,
    processingStartedAt: null,
    nextCheckAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
    lastError: null,
  });
  addSupportTicketEvent({
    ticketId: ticket.id,
    eventType: "investigation_update_sent",
    actorType: "robot",
    message: shouldEscalate
      ? "Investigation update sent; the ticket also needs human review."
      : "Investigation update sent; waiting for the employee to confirm.",
    details: { decision, messageId: sent.messageId },
  });
}

async function checkEmployeeReply(ticket: SupportTicketRecord): Promise<void> {
  const thread = await readTicketEmailThread(ticket);
  const incoming = newestIncomingMessage(ticket, thread.messages);
  if (!incoming) {
    updateSupportTicket(ticket.id, {
      processingStartedAt: null,
      nextCheckAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
      lastError: null,
    });
    return;
  }

  const receivedAt = messageTimestamp(incoming) ?? new Date().toISOString();
  const text = (incoming.textBody || incoming.htmlBody || "").trim().slice(0, 5000);
  updateSupportTicket(ticket.id, { lastIncomingMessageAt: receivedAt });
  addSupportTicketEvent({
    ticketId: ticket.id,
    eventType: "employee_reply_received",
    actorType: "employee",
    message: "Employee replied on the ticket email thread.",
    details: { messageId: incoming.messageId, receivedAt, text },
    createdAt: receivedAt,
  });

  const confirmation = classifyTicketConfirmation(text);
  if (confirmation === "confirmed") {
    const latestTicket = readSupportTicket(ticket.id) ?? ticket;
    const sent = await replyToTicketEmail(latestTicket, {
      heading: "Ticket resolved",
      paragraphs: [
        `Thanks for confirming, ${ticket.employeeName}.`,
        "I’ve marked this CRM support ticket as resolved. Reply on this thread if the same problem returns and it can be reopened for review.",
      ],
    });
    updateSupportTicket(ticket.id, {
      status: "resolved",
      resolution: ticket.resolution || "Employee confirmed the issue is resolved.",
      emailMessageId: sent.messageId,
      processingStartedAt: null,
      nextCheckAt: null,
      lastError: null,
    });
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "employee_confirmed_resolution",
      actorType: "employee",
      message: "Employee confirmed the issue is resolved; ticket closed by the robot.",
    });
    return;
  }

  await investigateAndReply(readSupportTicket(ticket.id) ?? ticket, text || null);
}

async function processClaimedTicket(ticket: SupportTicketRecord): Promise<void> {
  const acknowledged = await ensureAcknowledgement(ticket);
  if (acknowledged.status === "investigating") {
    await investigateAndReply(acknowledged, null);
    return;
  }
  if (acknowledged.status === "waiting_for_employee" || acknowledged.status === "escalated") {
    await checkEmployeeReply(acknowledged);
    return;
  }
  if (acknowledged.status === "repairing") {
    const sent = await replyToTicketEmail(acknowledged, {
      heading: "The automated repair needs human review",
      paragraphs: [
        "The isolated repair job did not report a verified deployment before its safety deadline.",
        "I left the ticket open for human review. A late successful deployment callback will still be verified and reported on this same thread.",
      ],
    });
    updateSupportTicket(acknowledged.id, {
      status: "escalated",
      emailMessageId: sent.messageId,
      processingStartedAt: null,
      nextCheckAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
      lastError: "Automated code repair exceeded its reporting deadline.",
    });
    addSupportTicketEvent({
      ticketId: acknowledged.id,
      eventType: "code_repair_timed_out",
      actorType: "system",
      message: "The automated code repair exceeded its reporting deadline and needs human review.",
    });
  }
}

export async function processSupportTicketById(ticketId: string): Promise<boolean> {
  const ticket = claimSupportTicketForProcessing(ticketId);
  if (!ticket) {
    return false;
  }
  try {
    await processClaimedTicket(ticket);
  } catch (error) {
    releaseSupportTicketAfterFailure(
      readSupportTicket(ticket.id) ?? ticket,
      error instanceof Error ? error.message : String(error),
    );
  }
  return true;
}

export async function drainSupportTicketQueue(limit = 3): Promise<number> {
  let processed = 0;
  for (let index = 0; index < Math.max(1, Math.min(limit, 10)); index += 1) {
    const ticket = claimSupportTicketForProcessing();
    if (!ticket) {
      break;
    }
    try {
      await processClaimedTicket(ticket);
    } catch (error) {
      releaseSupportTicketAfterFailure(
        readSupportTicket(ticket.id) ?? ticket,
        error instanceof Error ? error.message : String(error),
      );
    }
    processed += 1;
  }
  return processed;
}
