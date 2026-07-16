import crypto from "node:crypto";

import {
  addSupportTicketEvent,
  listSupportTicketEvents,
  updateSupportTicket,
  type SupportTicketEvent,
  type SupportTicketRecord,
} from "@/lib/support-ticket-store";

const DEFAULT_REPAIR_TIMEOUT_MINUTES = 45;
const MAX_REPAIR_ATTEMPTS = 2;

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function featureEnabled(value: string | null | undefined, fallback = false) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function repairTimeoutMs() {
  const configured = Number(process.env.TICKET_REPAIR_TIMEOUT_MINUTES);
  const minutes = Number.isFinite(configured)
    ? Math.max(15, Math.min(90, Math.trunc(configured)))
    : DEFAULT_REPAIR_TIMEOUT_MINUTES;
  return minutes * 60_000;
}

function repairConfiguration() {
  const owner = clean(process.env.TICKET_REPAIR_GITHUB_OWNER);
  const repository = clean(process.env.TICKET_REPAIR_GITHUB_REPO);
  const workflow = clean(process.env.TICKET_REPAIR_GITHUB_WORKFLOW) || "crm-ticket-repair.yml";
  const gitRef = clean(process.env.TICKET_REPAIR_GITHUB_REF) || "main";
  const token = clean(process.env.TICKET_REPAIR_GITHUB_TOKEN);
  const callbackSecret = clean(process.env.TICKET_REPAIR_CALLBACK_SECRET);
  if (!owner || !repository || !token || !callbackSecret) {
    throw new Error("Automated code repair is enabled but its GitHub or callback configuration is incomplete.");
  }
  return { owner, repository, workflow, gitRef, token };
}

export function isTicketCodeRepairEnabled() {
  return featureEnabled(process.env.TICKET_REPAIR_ENABLED, false);
}

export function ticketRepairDispatchEvents(ticketId: string): SupportTicketEvent[] {
  return listSupportTicketEvents(ticketId, 500).filter(
    (event) => event.eventType === "code_repair_dispatched",
  );
}

export function findTicketRepairDispatch(ticketId: string, repairRunId: string) {
  return ticketRepairDispatchEvents(ticketId).find(
    (event) => event.details?.repairRunId === repairRunId,
  ) ?? null;
}

export function canDispatchTicketCodeRepair(ticket: SupportTicketRecord) {
  return isTicketCodeRepairEnabled() &&
    ticket.impact !== "question" &&
    ticket.status !== "repairing" &&
    ticketRepairDispatchEvents(ticket.id).length < MAX_REPAIR_ATTEMPTS;
}

export async function dispatchTicketCodeRepair(ticket: SupportTicketRecord) {
  const config = repairConfiguration();
  const repairRunId = crypto.randomUUID();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  updateSupportTicket(ticket.id, {
    status: "repairing",
    processingStartedAt: null,
    nextCheckAt: new Date(Date.now() + repairTimeoutMs()).toISOString(),
    lastError: null,
  });

  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: config.gitRef,
          inputs: {
            ticketId: ticket.id,
            ticketNumber: String(ticket.ticketNumber),
            repairRunId,
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 500);
      throw new Error(`GitHub repair dispatch returned ${response.status}${detail ? `: ${detail}` : "."}`);
    }

    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "code_repair_dispatched",
      actorType: "robot",
      message: "An isolated code repair, review, test, and deployment job was started.",
      details: { repairRunId },
    });
    return { repairRunId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateSupportTicket(ticket.id, {
      status: "escalated",
      processingStartedAt: null,
      nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
      lastError: message.slice(0, 1200),
    });
    addSupportTicketEvent({
      ticketId: ticket.id,
      eventType: "code_repair_dispatch_failed",
      actorType: "system",
      message: "The isolated code repair job could not be started; no repository change was made.",
      details: { repairRunId, error: message.slice(0, 1200) },
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
