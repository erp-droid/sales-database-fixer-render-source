import {
  canRunReadModelRefresh,
  collectTicketDiagnostics,
  decideTicketAction,
  runReadModelRefresh,
} from "@/lib/support-ticket-agent";
import {
  clarificationEmailParagraphs,
  MAX_CLARIFICATION_ROUNDS,
} from "@/lib/support-ticket-clarification";
import {
  isAllowedSupportAttachment,
  SUPPORT_ATTACHMENT_MAX_FILE_BYTES,
  SUPPORT_ATTACHMENT_MAX_FILES,
  SUPPORT_ATTACHMENT_MAX_TOTAL_BYTES,
} from "@/lib/support-ticket-attachment-policy";
import {
  readTicketEmailThread,
  readTicketEmailAttachments,
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
  listSupportTicketEvents,
  readSupportTicket,
  releaseSupportTicketAfterFailure,
  storeSupportTicketReplyAttachments,
  updateSupportTicket,
  type SupportTicketRecord,
} from "@/lib/support-ticket-store";
import type { MailMessage } from "@/types/mail-thread";

const POLL_INTERVAL_MS = 60_000;
const MONITOR_INTERVAL_MS = 5 * 60_000;

function messageTimestamp(message: MailMessage): string | null {
  return message.receivedAt || message.sentAt || null;
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function robotMessageIds(ticket: SupportTicketRecord): Set<string> {
  const ids = new Set<string>();
  if (ticket.emailMessageId) {
    ids.add(ticket.emailMessageId);
  }
  for (const event of listSupportTicketEvents(ticket.id, 500)) {
    const messageId = event.details?.messageId;
    if (typeof messageId === "string" && messageId.trim()) {
      ids.add(messageId.trim());
    }
  }
  return ids;
}

function isEmployeeMessage(
  ticket: Pick<SupportTicketRecord, "employeeEmail">,
  message: MailMessage,
  knownRobotMessageIds: ReadonlySet<string>,
  robotSenderEmail = process.env.TICKET_AGENT_SENDER_EMAIL ?? "jserrano@meadowb.com",
): boolean {
  const employeeUsesRobotMailbox = normalizeEmail(ticket.employeeEmail) === normalizeEmail(robotSenderEmail);
  return message.direction === "incoming" || (
    employeeUsesRobotMailbox &&
    message.direction === "outgoing" &&
    !knownRobotMessageIds.has(message.messageId)
  );
}

export function newestEmployeeMessage(
  ticket: Pick<SupportTicketRecord, "employeeEmail" | "lastIncomingMessageAt">,
  messages: MailMessage[],
  knownRobotMessageIds: ReadonlySet<string>,
  robotSenderEmail = process.env.TICKET_AGENT_SENDER_EMAIL ?? "jserrano@meadowb.com",
): MailMessage | null {
  const lastProcessedMs = ticket.lastIncomingMessageAt ? Date.parse(ticket.lastIncomingMessageAt) : 0;
  return messages
    .filter((message) => isEmployeeMessage(ticket, message, knownRobotMessageIds, robotSenderEmail))
    .filter((message) => {
      const timestamp = messageTimestamp(message);
      return timestamp ? Date.parse(timestamp) > lastProcessedMs : false;
    })
    .sort((left, right) => Date.parse(messageTimestamp(left) ?? "") - Date.parse(messageTimestamp(right) ?? ""))
    .at(-1) ?? null;
}

async function ingestEmployeeReplyAttachments(
  ticket: SupportTicketRecord,
  messages: MailMessage[],
  knownRobotMessageIds: ReadonlySet<string>,
): Promise<{ storedCount: number; latestEvidenceMessage: MailMessage | null }> {
  const alreadyChecked = new Set(
    listSupportTicketEvents(ticket.id, 500)
      .filter((event) => event.eventType === "email_attachments_checked")
      .map((event) => event.details?.messageId)
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim())),
  );
  const candidates = messages
    .filter((message) => message.hasAttachments)
    .filter((message) => isEmployeeMessage(ticket, message, knownRobotMessageIds))
    .filter((message) => !alreadyChecked.has(message.messageId))
    .sort((left, right) => Date.parse(messageTimestamp(left) ?? "") - Date.parse(messageTimestamp(right) ?? ""));

  let storedCount = 0;
  let latestEvidenceMessage: MailMessage | null = null;
  for (const message of candidates) {
    const payload = await readTicketEmailAttachments(ticket, message.messageId);
    const accepted = [];
    let totalBytes = 0;
    for (const attachment of payload.items) {
      if (accepted.length >= SUPPORT_ATTACHMENT_MAX_FILES) break;
      if (!isAllowedSupportAttachment(attachment.fileName, attachment.mimeType)) continue;
      const data = Buffer.from(attachment.base64Data, "base64");
      if (
        data.byteLength === 0 ||
        data.byteLength > SUPPORT_ATTACHMENT_MAX_FILE_BYTES ||
        totalBytes + data.byteLength > SUPPORT_ATTACHMENT_MAX_TOTAL_BYTES
      ) {
        continue;
      }
      accepted.push({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        data,
        sourceMessageId: message.messageId,
        sourceAttachmentId: attachment.id,
      });
      totalBytes += data.byteLength;
    }

    const stored = storeSupportTicketReplyAttachments(ticket.id, accepted);
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "email_attachments_checked",
      actorType: "robot",
      message: stored.length > 0
        ? `Stored ${stored.length} attachment${stored.length === 1 ? "" : "s"} from the employee's email reply as ticket evidence.`
        : "Checked the employee's email reply for supported ticket evidence.",
      details: {
        messageId: message.messageId,
        storedAttachmentIds: stored.map((attachment) => attachment.id),
        fileNames: stored.map((attachment) => attachment.fileName),
      },
      createdAt: messageTimestamp(message) ?? undefined,
    });
    if (stored.length > 0) {
      addSupportTicketEvent({
        ticketId: ticket.id,
        eventType: "email_attachments_stored",
        actorType: "employee",
        message: "Pictures or files attached to the employee's reply were added to the ticket evidence.",
        details: {
          messageId: message.messageId,
          attachmentIds: stored.map((attachment) => attachment.id),
          fileNames: stored.map((attachment) => attachment.fileName),
        },
        createdAt: messageTimestamp(message) ?? undefined,
      });
      storedCount += stored.length;
      latestEvidenceMessage = message;
    }
  }
  return { storedCount, latestEvidenceMessage };
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
  addSupportTicketEvent({
    ticketId: ticket.id,
    eventType: "autonomous_decision_made",
    actorType: "robot",
    message: `Autonomous next action selected: ${decision.remediation}.`,
    details: { decision },
  });

  if (decision.remediation === "clarify" && ticket.clarificationRounds < MAX_CLARIFICATION_ROUNDS) {
    const sent = await replyToTicketEmail(ticket, {
      heading: "A few quick questions",
      paragraphs: clarificationEmailParagraphs(decision.questions),
    });
    updateSupportTicket(ticket.id, {
      status: "waiting_for_details",
      clarificationRounds: ticket.clarificationRounds + 1,
      understanding: decision.understanding,
      nextAction: "Wait for the employee's answers, then choose an automated action.",
      lastActionKey: decision.actionKey,
      emailMessageId: sent.messageId,
      processingStartedAt: null,
      nextCheckAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
      lastError: null,
    });
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "clarification_questions_sent",
      actorType: "robot",
      message: `Clarification round ${ticket.clarificationRounds + 1} sent with ${decision.questions.length} question${decision.questions.length === 1 ? "" : "s"}.`,
      details: {
        round: ticket.clarificationRounds + 1,
        questions: decision.questions,
        messageId: sent.messageId,
        understanding: decision.understanding,
      },
    });
    return;
  }

  let remediation = decision.remediation;
  const refreshAllowed = remediation === "refresh_read_model" &&
    !hasSupportTicketEvent(ticket.id, "read_model_refresh_started") &&
    !hasSupportTicketEvent(ticket.id, "read_model_refresh_failed") &&
    canRunReadModelRefresh(ticket, diagnostics);
  if (remediation === "refresh_read_model" && !refreshAllowed) {
    remediation = canDispatchTicketCodeRepair(ticket) ? "code_repair" : "monitor";
  }
  if (remediation === "guidance" && decision.guidanceSteps.length === 0 && ticket.impact !== "question") {
    remediation = "monitor";
  }

  if (remediation === "code_repair" && canDispatchTicketCodeRepair(ticket)) {
    let repair: Awaited<ReturnType<typeof dispatchTicketCodeRepair>>;
    try {
      repair = await dispatchTicketCodeRepair(ticket);
    } catch (error) {
      updateSupportTicket(ticket.id, {
        status: "monitoring",
        understanding: decision.understanding,
        nextAction: "Retry the automated repair decision after the dispatch failure.",
        lastActionKey: decision.actionKey,
        processingStartedAt: null,
        nextCheckAt: new Date(Date.now() + MONITOR_INTERVAL_MS).toISOString(),
        lastError: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200),
      });
      return;
    }

    updateSupportTicket(ticket.id, {
      status: "repairing",
      diagnosis: decision.diagnosis,
      understanding: decision.understanding,
      remediationAttempts: ticket.remediationAttempts + 1,
      nextAction: "Wait for the verified repair callback and deployed-version check.",
      lastActionKey: decision.actionKey,
      processingStartedAt: null,
      lastError: null,
    });
    try {
      const latestTicket = readSupportTicket(ticket.id) ?? ticket;
      const sent = await replyToTicketEmail(latestTicket, {
        heading: "We are working on a fix",
        paragraphs: [
          decision.employeeMessage,
          "We found a problem that needs a change to the CRM. We are making and testing that change now.",
          "You do not need to do anything. We will email you when the tested fix is ready.",
        ],
      });
      updateSupportTicket(ticket.id, {
        emailMessageId: sent.messageId,
      });
      addSupportTicketEvent({
        ticketId: ticket.id,
        eventType: "code_repair_update_sent",
        actorType: "robot",
        message: "The employee was told that a verified automated code repair is in progress.",
        details: { repairRunId: repair.repairRunId, messageId: sent.messageId },
      });
    } catch (error) {
      addSupportTicketEvent({
        ticketId: ticket.id,
        eventType: "code_repair_update_email_failed",
        actorType: "system",
        message: "The repair job is running, but its progress email could not be sent.",
        details: { repairRunId: repair.repairRunId },
      });
      updateSupportTicket(ticket.id, {
        lastError: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200),
      });
    }
    return;
  }

  let remediationNote = "I did not change anything in the CRM.";
  let remediationSucceeded = false;
  if (refreshAllowed) {
    const result = await runReadModelRefresh();
    remediationSucceeded = result.ok;
    remediationNote = result.ok
      ? "We reloaded the CRM information. No customer records were deleted or changed."
      : "We could not reload the CRM information. Nothing was changed, and your ticket is still open.";
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: result.ok ? "read_model_refresh_started" : "read_model_refresh_failed",
      actorType: "robot",
      message: remediationNote,
      details: { result, reason: decision.remediationReason },
    });
    if (!result.ok) {
      const latestTicket = readSupportTicket(ticket.id) ?? ticket;
      const sent = await replyToTicketEmail(latestTicket, {
        heading: "Your ticket is still being checked",
        paragraphs: [
          decision.employeeMessage,
          remediationNote,
          "The CRM will choose a different safe step automatically. You do not need to send another ticket.",
        ],
      });
      updateSupportTicket(ticket.id, {
        status: "monitoring",
        diagnosis: decision.diagnosis,
        understanding: decision.understanding,
        remediationAttempts: ticket.remediationAttempts + 1,
        nextAction: "Reinvestigate after the CRM information reload did not finish.",
        lastActionKey: decision.actionKey,
        emailMessageId: sent.messageId,
        processingStartedAt: null,
        nextCheckAt: new Date(Date.now() + MONITOR_INTERVAL_MS).toISOString(),
        lastError: result.detail.slice(0, 1200),
      });
      return;
    }
  } else if (remediation === "guidance") {
    remediationNote = decision.guidanceSteps.length > 0
      ? "Please try the steps below."
      : "No CRM information was changed.";
  } else if (remediation === "monitor" || remediation === "code_repair") {
    const shouldNotify = ticket.lastActionKey !== decision.actionKey;
    let messageId = ticket.emailMessageId;
    if (shouldNotify) {
      const sent = await replyToTicketEmail(ticket, {
        heading: "Your ticket is still being checked",
        paragraphs: [
          decision.employeeMessage,
          "The ticket is still open. The CRM will check again automatically.",
          "You do not need to send another ticket.",
        ],
      });
      messageId = sent.messageId;
    }
    updateSupportTicket(ticket.id, {
      status: "monitoring",
      diagnosis: decision.diagnosis,
      understanding: decision.understanding,
      nextAction: "Recheck the available evidence automatically.",
      lastActionKey: decision.actionKey,
      emailMessageId: messageId,
      processingStartedAt: null,
      nextCheckAt: new Date(Date.now() + MONITOR_INTERVAL_MS).toISOString(),
      lastError: null,
    });
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "automatic_monitoring_scheduled",
      actorType: "robot",
      message: "The ticket remains active and has an automatic recheck scheduled.",
      details: { actionKey: decision.actionKey, verificationPlan: decision.verificationPlan },
    });
    return;
  }

  const latestTicket = readSupportTicket(ticket.id) ?? ticket;
  const confirmationQuestion = decision.confirmationQuestion || (ticket.impact === "question"
    ? "Did that answer your question?"
    : "Does it work now?");
  const confirmationInstruction = ticket.impact === "question"
    ? `${confirmationQuestion} Reply “resolved” if that answers your question. If not, reply “still broken” and tell us what is still unclear.`
    : `${confirmationQuestion} Reply “resolved” if it works now. If it does not, reply “still broken” and tell us what happened.`;
  const sent = await replyToTicketEmail(latestTicket, {
    heading: remediationSucceeded ? "We made a safe update" : "We checked your report",
    paragraphs: [
      decision.employeeMessage,
      remediationNote,
      ...decision.guidanceSteps.map((step, index) => `${index + 1}. ${step}`),
      confirmationInstruction,
    ],
  });
  updateSupportTicket(ticket.id, {
    status: "waiting_for_employee",
    diagnosis: decision.diagnosis,
    understanding: decision.understanding,
    resolution: remediationSucceeded ? remediationNote : null,
    remediationAttempts: ticket.remediationAttempts + 1,
    nextAction: "Wait for the employee to confirm the verified result or report that it is still broken.",
    lastActionKey: decision.actionKey,
    emailMessageId: sent.messageId,
    processingStartedAt: null,
    nextCheckAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
    lastError: null,
  });
  addSupportTicketEvent({
    ticketId: ticket.id,
    eventType: "investigation_update_sent",
    actorType: "robot",
    message: "Autonomous action update sent; waiting for the employee to confirm the result.",
    details: { decision, effectiveRemediation: remediation, messageId: sent.messageId },
  });
}

async function checkEmployeeReply(ticket: SupportTicketRecord): Promise<void> {
  const thread = await readTicketEmailThread(ticket);
  const knownRobotMessageIds = robotMessageIds(ticket);
  const evidence = await ingestEmployeeReplyAttachments(ticket, thread.messages, knownRobotMessageIds);
  const incoming = newestEmployeeMessage(ticket, thread.messages, knownRobotMessageIds);
  if (!incoming) {
    if (evidence.storedCount > 0 && evidence.latestEvidenceMessage) {
      const text = (evidence.latestEvidenceMessage.textBody || evidence.latestEvidenceMessage.htmlBody || "")
        .trim()
        .slice(0, 5000);
      await investigateAndReply(readSupportTicket(ticket.id) ?? ticket, text || null);
      return;
    }
    if (ticket.status === "monitoring" || ticket.status === "escalated") {
      await investigateAndReply(ticket, null);
      return;
    }
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
      heading: "Your ticket is closed",
      paragraphs: [
        `Thanks for letting us know, ${ticket.employeeName}.`,
        "We marked this ticket as resolved. If the problem comes back, reply to this email and we will check it again.",
      ],
    });
    updateSupportTicket(ticket.id, {
      status: "resolved",
      resolution: ticket.resolution || "Employee confirmed the issue is resolved.",
      nextAction: null,
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
  if (
    acknowledged.status === "waiting_for_details" ||
    acknowledged.status === "waiting_for_employee" ||
    acknowledged.status === "monitoring" ||
    acknowledged.status === "escalated"
  ) {
    await checkEmployeeReply(acknowledged);
    return;
  }
  if (acknowledged.status === "repairing") {
    const sent = await replyToTicketEmail(acknowledged, {
      heading: "Your ticket is still open",
      paragraphs: [
        "The first automated fix took longer than expected.",
        "The CRM will try another safe approach. You do not need to send another ticket.",
      ],
    });
    updateSupportTicket(acknowledged.id, {
      status: "queued",
      nextAction: "Reinvestigate and choose a different automated repair attempt.",
      emailMessageId: sent.messageId,
      processingStartedAt: null,
      nextCheckAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
      lastError: "Automated code repair exceeded its reporting deadline.",
    });
    addSupportTicketEvent({
      ticketId: acknowledged.id,
      eventType: "code_repair_timed_out_retry_scheduled",
      actorType: "system",
      message: "The automated code repair exceeded its reporting deadline; autonomous reinvestigation was scheduled.",
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
