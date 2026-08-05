"use client";

import { type DragEvent, type FormEvent, useMemo, useState } from "react";

import { AppChrome } from "@/components/app-chrome";
import type {
  SupportTicketConversationResponse,
  SupportTicketDetail,
  SupportTicketStatus,
} from "@/types/support-ticket";

import styles from "./support-owner-workspace.module.css";

export type SupportConversationLoadState = {
  loading: boolean;
  data: SupportTicketConversationResponse | null;
  error: string | null;
};

type Props = {
  userName?: string | null;
  tickets: SupportTicketDetail[];
  conversations: Record<string, SupportConversationLoadState>;
  closingTicketId: string | null;
  movingTicketId: string | null;
  ticketActionErrors: Record<string, string>;
  onCloseTicket: (ticket: SupportTicketDetail) => Promise<void>;
  onLoadConversation: (ticketId: string, force?: boolean) => Promise<void>;
  onMoveTicket: (ticket: SupportTicketDetail, status: SupportTicketStatus) => Promise<void>;
  onRefresh: () => Promise<void>;
  onReply: (ticket: SupportTicketDetail, message: string) => Promise<void>;
};

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  queued: "Received",
  investigating: "Investigating",
  waiting_for_details: "Waiting for details",
  repairing: "Repairing",
  waiting_for_employee: "Waiting for employee",
  monitoring: "Monitoring",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

const PIPELINE_STAGES: Array<{
  id: string;
  label: string;
  statuses: SupportTicketStatus[];
  dropStatus: SupportTicketStatus;
  footer: string;
}> = [
  { id: "received", label: "Received", statuses: ["queued"], dropStatus: "queued", footer: "New" },
  {
    id: "in_progress",
    label: "In progress",
    statuses: ["investigating", "repairing", "monitoring", "escalated"],
    dropStatus: "investigating",
    footer: "Active",
  },
  {
    id: "waiting",
    label: "Waiting on employee",
    statuses: ["waiting_for_details", "waiting_for_employee"],
    dropStatus: "waiting_for_employee",
    footer: "Waiting",
  },
  { id: "resolved", label: "Resolved", statuses: ["resolved"], dropStatus: "resolved", footer: "Resolved" },
  { id: "closed", label: "Closed", statuses: ["closed"], dropStatus: "closed", footer: "Closed" },
];

const CATEGORY_LABELS: Record<SupportTicketDetail["category"], string> = {
  accounts: "Accounts & search",
  contacts: "Contacts",
  mail: "Mail",
  calendar: "Calendar",
  calls: "Calls & coaching",
  quotes: "Quotes",
  sign_in: "Sign in",
  performance: "Slow or unavailable",
  other: "Other",
};

const IMPACT_LABELS: Record<SupportTicketDetail["impact"], string> = {
  blocked: "Cannot work",
  major: "Major",
  minor: "Minor",
  question: "Question",
};

function formatTicketNumber(value: number) {
  return `CRM-${String(value).padStart(4, "0")}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function matchesSearch(ticket: SupportTicketDetail, query: string) {
  if (!query) return true;
  const text = [
    formatTicketNumber(ticket.ticketNumber),
    ticket.title,
    ticket.description,
    ticket.employeeName,
    ticket.employeeEmail,
    ticket.latestUpdate,
  ].join(" ").toLowerCase();
  return text.includes(query);
}

export function SupportOwnerWorkspace({
  userName,
  tickets,
  conversations,
  closingTicketId,
  movingTicketId,
  ticketActionErrors,
  onCloseTicket,
  onLoadConversation,
  onMoveTicket,
  onRefresh,
  onReply,
}: Props) {
  const [viewMode, setViewMode] = useState<"pipeline" | "table">("pipeline");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SupportTicketStatus>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySuccess, setReplySuccess] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredTickets = useMemo(
    () => tickets.filter((ticket) =>
      (statusFilter === "all" || ticket.status === statusFilter) &&
      matchesSearch(ticket, normalizedSearch),
    ),
    [normalizedSearch, statusFilter, tickets],
  );
  const selectedTicket = selectedTicketId
    ? tickets.find((ticket) => ticket.id === selectedTicketId) ?? null
    : null;
  const selectedConversation = selectedTicket ? conversations[selectedTicket.id] : undefined;
  const draggedTicket = draggedTicketId
    ? tickets.find((ticket) => ticket.id === draggedTicketId) ?? null
    : null;
  const ticketActionError = Object.values(ticketActionErrors)[0] ?? null;

  function openTicket(ticket: SupportTicketDetail) {
    setSelectedTicketId(ticket.id);
    setReplyText("");
    setReplyError(null);
    setReplySuccess(null);
    void onLoadConversation(ticket.id);
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
      if (selectedTicketId) {
        await onLoadConversation(selectedTicketId, true);
      }
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Unable to refresh support tickets.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;
    setReplying(true);
    setReplyError(null);
    setReplySuccess(null);
    try {
      await onReply(selectedTicket, replyText.trim());
      setReplyText("");
      setReplySuccess("Response sent and added to this ticket's email conversation.");
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "Unable to send the response.");
    } finally {
      setReplying(false);
    }
  }

  function canDropTicket(
    ticket: SupportTicketDetail | null,
    stage: (typeof PIPELINE_STAGES)[number],
  ) {
    return Boolean(
      ticket &&
      ticket.status !== "closed" &&
      !stage.statuses.includes(ticket.status),
    );
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, ticket: SupportTicketDetail) {
    if (ticket.status === "closed") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ticket.id);
    setDraggedTicketId(ticket.id);
    setDragOverStageId(null);
  }

  function handleDragOver(
    event: DragEvent<HTMLDivElement>,
    stage: (typeof PIPELINE_STAGES)[number],
  ) {
    if (!canDropTicket(draggedTicket, stage)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverStageId(stage.id);
  }

  async function handlePipelineDrop(
    event: DragEvent<HTMLDivElement>,
    stage: (typeof PIPELINE_STAGES)[number],
  ) {
    event.preventDefault();
    const ticketId = event.dataTransfer.getData("text/plain") || draggedTicketId;
    const ticket = tickets.find((item) => item.id === ticketId) ?? null;
    setDraggedTicketId(null);
    setDragOverStageId(null);
    if (!canDropTicket(ticket, stage) || !ticket) {
      return;
    }
    await onMoveTicket(ticket, stage.dropStatus);
  }

  return (
    <AppChrome
      title="Support tickets"
      subtitle="Every CRM support request, response, and next action in one place."
      userName={userName}
      headerActions={(
        <button className={styles.refreshButton} disabled={refreshing} onClick={() => void handleRefresh()} type="button">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      )}
    >
      <div className={styles.workspace}>
        <section className={styles.summaryRow} aria-label="Ticket summary">
          <div><span>All tickets</span><strong>{tickets.length}</strong></div>
          <div><span>Open</span><strong>{tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length}</strong></div>
          <div><span>Waiting</span><strong>{tickets.filter((ticket) => ["waiting_for_details", "waiting_for_employee"].includes(ticket.status)).length}</strong></div>
          <div><span>Resolved</span><strong>{tickets.filter((ticket) => ticket.status === "resolved").length}</strong></div>
          <div><span>Closed</span><strong>{tickets.filter((ticket) => ticket.status === "closed").length}</strong></div>
        </section>

        <section className={styles.toolbar} aria-label="Ticket filters and views">
          <label className={styles.searchField}>
            <span className={styles.srOnly}>Search support tickets</span>
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ticket, employee, email, or response"
              value={search}
            />
          </label>
          <label className={styles.statusField}>
            <span className={styles.srOnly}>Filter by ticket status</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value as "all" | SupportTicketStatus)}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className={styles.viewToggle} aria-label="Ticket layout">
            <button
              aria-pressed={viewMode === "pipeline"}
              className={viewMode === "pipeline" ? styles.viewActive : ""}
              onClick={() => setViewMode("pipeline")}
              type="button"
            >
              Pipeline
            </button>
            <button
              aria-pressed={viewMode === "table"}
              className={viewMode === "table" ? styles.viewActive : ""}
              onClick={() => setViewMode("table")}
              type="button"
            >
              Table
            </button>
          </div>
        </section>

        {refreshError ? <div className={styles.workspaceError} role="alert">{refreshError}</div> : null}
        {ticketActionError ? <div className={styles.workspaceError} role="alert">{ticketActionError}</div> : null}

        <div className={styles.resultLine}>
          Showing <strong>{filteredTickets.length}</strong> of {tickets.length} tickets
          {statusFilter !== "all" ? ` · ${STATUS_LABELS[statusFilter]}` : ""}
        </div>

        {viewMode === "pipeline" ? (
          <section className={styles.pipeline} aria-label="Support ticket pipeline">
            {PIPELINE_STAGES.map((stage) => {
              const stageTickets = filteredTickets.filter((ticket) => stage.statuses.includes(ticket.status));
              const acceptsDraggedTicket = canDropTicket(draggedTicket, stage);
              return (
                <div
                  className={styles.pipelineColumn}
                  data-drag-over={dragOverStageId === stage.id ? "true" : "false"}
                  data-drop-target={acceptsDraggedTicket ? "true" : "false"}
                  data-stage={stage.id}
                  key={stage.id}
                  onDragLeave={(event) => {
                    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                    if (dragOverStageId === stage.id) setDragOverStageId(null);
                  }}
                  onDragOver={(event) => handleDragOver(event, stage)}
                  onDrop={(event) => void handlePipelineDrop(event, stage)}
                >
                  <header>
                    <div><strong>{stage.label}</strong><span>{stageTickets.length} {stageTickets.length === 1 ? "ticket" : "tickets"}</span></div>
                  </header>
                  <div className={styles.pipelineCards}>
                    {acceptsDraggedTicket ? (
                      <div className={styles.pipelineDropHint} data-active={dragOverStageId === stage.id ? "true" : "false"}>
                        Drop to move to {stage.label}
                      </div>
                    ) : null}
                    {stageTickets.map((ticket) => (
                      <button
                        aria-label={`${formatTicketNumber(ticket.ticketNumber)} ${ticket.title}. ${ticket.status === "closed" ? "Closed ticket" : "Drag to change status or click to open"}.`}
                        className={`${styles.pipelineCard} ${movingTicketId === ticket.id || closingTicketId === ticket.id ? styles.pipelineCardMoving : ""}`.trim()}
                        draggable={ticket.status !== "closed" && movingTicketId !== ticket.id && closingTicketId !== ticket.id}
                        key={ticket.id}
                        onClick={() => openTicket(ticket)}
                        onDragEnd={() => {
                          setDraggedTicketId(null);
                          setDragOverStageId(null);
                        }}
                        onDragStart={(event) => handleDragStart(event, ticket)}
                        title={ticket.status === "closed" ? "Closed tickets are final" : "Drag this ticket to another Pipeline column"}
                        type="button"
                      >
                        <span className={styles.cardTopline}>
                          <b>{formatTicketNumber(ticket.ticketNumber)}</b>
                          <span className={styles.cardControls}>
                            <i data-status={ticket.status}>{STATUS_LABELS[ticket.status]}</i>
                            {ticket.status !== "closed" ? <span aria-hidden="true" className={styles.dragHandle}>⋮⋮</span> : null}
                          </span>
                        </span>
                        <strong>{ticket.title}</strong>
                        <span>{ticket.employeeName}</span>
                        <small>{ticket.latestUpdate || `Submitted ${formatDate(ticket.createdAt)}`}</small>
                      </button>
                    ))}
                    {stageTickets.length === 0 ? <div className={styles.emptyColumn}>No tickets</div> : null}
                  </div>
                  <footer><span>{stage.footer}</span><b>{stageTickets.length}</b></footer>
                </div>
              );
            })}
          </section>
        ) : (
          <section className={styles.tableCard} aria-label="Support ticket table">
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Employee</th>
                    <th>Area</th>
                    <th>Impact</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th><span className={styles.srOnly}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td><button className={styles.ticketLink} onClick={() => openTicket(ticket)} type="button"><strong>{ticket.title}</strong><span>{formatTicketNumber(ticket.ticketNumber)}</span></button></td>
                      <td><strong>{ticket.employeeName}</strong><span>{ticket.employeeEmail}</span></td>
                      <td>{CATEGORY_LABELS[ticket.category]}</td>
                      <td>{IMPACT_LABELS[ticket.impact]}</td>
                      <td><span className={styles.tableStatus} data-status={ticket.status}>{STATUS_LABELS[ticket.status]}</span></td>
                      <td>{formatDate(ticket.updatedAt)}</td>
                      <td><button className={styles.openButton} onClick={() => openTicket(ticket)} type="button">{ticket.status === "closed" ? "View" : "Respond"}</button></td>
                    </tr>
                  ))}
                  {filteredTickets.length === 0 ? <tr><td className={styles.emptyTable} colSpan={7}>No tickets match these filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {selectedTicket ? (
        <div
          className={styles.drawerBackdrop}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedTicketId(null);
          }}
        >
          <aside aria-labelledby="support-ticket-drawer-title" aria-modal="true" className={styles.drawer} role="dialog">
            <header className={styles.drawerHeader}>
              <div>
                <span>{formatTicketNumber(selectedTicket.ticketNumber)}</span>
                <h2 id="support-ticket-drawer-title">{selectedTicket.title}</h2>
                <p>{selectedTicket.employeeName} · {selectedTicket.employeeEmail}</p>
              </div>
              <button aria-label="Close ticket panel" className={styles.drawerClose} onClick={() => setSelectedTicketId(null)} type="button">×</button>
            </header>

            <div className={styles.drawerActions}>
              <span className={styles.drawerStatus} data-status={selectedTicket.status}>{STATUS_LABELS[selectedTicket.status]}</span>
              {selectedTicket.status !== "closed" ? (
                <button
                  className={styles.closeTicketButton}
                  disabled={closingTicketId !== null}
                  onClick={() => void onCloseTicket(selectedTicket)}
                  type="button"
                >
                  {closingTicketId === selectedTicket.id ? "Closing…" : "Close ticket"}
                </button>
              ) : null}
            </div>
            {ticketActionErrors[selectedTicket.id] ? <div className={styles.actionError} role="alert">{ticketActionErrors[selectedTicket.id]}</div> : null}

            <div className={styles.drawerBody}>
              <section className={styles.detailSection}>
                <h3>Original report</h3>
                <p>{selectedTicket.description}</p>
                <dl className={styles.detailGrid}>
                  <div><dt>Area</dt><dd>{CATEGORY_LABELS[selectedTicket.category]}</dd></div>
                  <div><dt>Impact</dt><dd>{IMPACT_LABELS[selectedTicket.impact]}</dd></div>
                  <div><dt>Created</dt><dd>{formatDate(selectedTicket.createdAt)}</dd></div>
                  <div><dt>Updated</dt><dd>{formatDate(selectedTicket.updatedAt)}</dd></div>
                </dl>
                {selectedTicket.expectedBehavior ? <div className={styles.reportExtra}><strong>Expected</strong><p>{selectedTicket.expectedBehavior}</p></div> : null}
                {selectedTicket.stepsToReproduce ? <div className={styles.reportExtra}><strong>Steps</strong><p>{selectedTicket.stepsToReproduce}</p></div> : null}
                {selectedTicket.attachments.length > 0 ? (
                  <div className={styles.attachmentLinks}>
                    <strong>Attachments</strong>
                    {selectedTicket.attachments.map((attachment) => (
                      <a
                        href={`/api/support/tickets/${encodeURIComponent(selectedTicket.id)}/attachments/${encodeURIComponent(attachment.id)}`}
                        key={attachment.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {attachment.fileName}
                      </a>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeading}>
                  <h3>Email conversation</h3>
                  <button disabled={selectedConversation?.loading} onClick={() => void onLoadConversation(selectedTicket.id, true)} type="button">
                    {selectedConversation?.loading ? "Refreshing…" : "Refresh responses"}
                  </button>
                </div>
                {selectedConversation?.loading && !selectedConversation.data ? <p className={styles.muted}>Loading every response…</p> : null}
                {selectedConversation?.error ? <div className={styles.actionError} role="alert">{selectedConversation.error}</div> : null}
                {selectedConversation?.data && !selectedConversation.data.available ? <p className={styles.muted}>The email conversation has not started yet.</p> : null}
                {selectedConversation?.data?.available && selectedConversation.data.items.length === 0 ? <p className={styles.muted}>No responses yet.</p> : null}
                {selectedConversation?.data?.items.length ? (
                  <div className={styles.messages}>
                    {selectedConversation.data.items.map((message) => (
                      <article data-direction={message.direction} key={message.id}>
                        <header><strong>{message.direction === "outgoing" ? "Support" : "Employee"}</strong><time>{formatDate(message.timestamp)}</time></header>
                        <span>{message.from?.name || message.from?.email || "Unknown sender"}</span>
                        <p>{message.body || "No message body."}</p>
                        {message.hasAttachments ? <small>Attachment included</small> : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className={styles.replySection}>
                <h3>Respond to employee</h3>
                {selectedTicket.status === "closed" ? (
                  <p className={styles.muted}>This ticket is closed. Its conversation remains available above.</p>
                ) : selectedConversation?.loading && !selectedConversation.data ? (
                  <p className={styles.muted}>Loading the email conversation before reply…</p>
                ) : selectedConversation?.data && !selectedConversation.data.available ? (
                  <p className={styles.muted}>A response cannot be sent until this ticket has an email conversation.</p>
                ) : (
                  <form onSubmit={handleReply}>
                    <textarea
                      maxLength={5000}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="Write your response. It will be sent in the same email conversation."
                      rows={5}
                      value={replyText}
                    />
                    <div><span>{replyText.length}/5000</span><button disabled={replying || !replyText.trim() || !selectedConversation?.data?.available} type="submit">{replying ? "Sending…" : "Send response"}</button></div>
                  </form>
                )}
                {replyError ? <div className={styles.actionError} role="alert">{replyError}</div> : null}
                {replySuccess ? <div className={styles.actionSuccess} role="status">{replySuccess}</div> : null}
              </section>

              {(selectedTicket.diagnosis || selectedTicket.resolution || selectedTicket.nextAction) ? (
                <section className={styles.detailSection}>
                  <h3>Progress</h3>
                  {selectedTicket.diagnosis ? <div className={styles.reportExtra}><strong>Diagnosis</strong><p>{selectedTicket.diagnosis}</p></div> : null}
                  {selectedTicket.resolution ? <div className={styles.reportExtra}><strong>Resolution</strong><p>{selectedTicket.resolution}</p></div> : null}
                  {selectedTicket.nextAction ? <div className={styles.reportExtra}><strong>Next action</strong><p>{selectedTicket.nextAction}</p></div> : null}
                </section>
              ) : null}

              {selectedTicket.history.length > 0 ? (
                <section className={styles.detailSection}>
                  <h3>Ticket history</h3>
                  <ol className={styles.history}>
                    {selectedTicket.history.map((event, index) => (
                      <li key={`${event.createdAt}-${event.type}-${index}`}><time>{formatDate(event.createdAt)}</time><span>{event.message}</span></li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </AppChrome>
  );
}
