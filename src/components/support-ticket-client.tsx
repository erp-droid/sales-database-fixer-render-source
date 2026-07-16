"use client";

import Image from "next/image";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { AppChrome } from "@/components/app-chrome";
import {
  formatSupportAttachmentBytes,
  isAllowedSupportAttachment,
  SUPPORT_ATTACHMENT_ACCEPT,
  SUPPORT_ATTACHMENT_MAX_FILES,
  SUPPORT_ATTACHMENT_MAX_FILE_BYTES,
  SUPPORT_ATTACHMENT_MAX_TOTAL_BYTES,
} from "@/lib/support-ticket-attachment-policy";
import type {
  SupportTicketCreateResponse,
  SupportTicketListResponse,
  SupportTicketSummary,
} from "@/types/support-ticket";

import styles from "./support-ticket-client.module.css";

type SessionResponse = {
  authenticated: boolean;
  user: { id: string; name: string } | null;
};

type FormState = {
  category: string;
  impact: string;
  title: string;
  description: string;
  expectedBehavior: string;
  stepsToReproduce: string;
  pageUrl: string;
};

const EMPTY_FORM: FormState = {
  category: "accounts",
  impact: "major",
  title: "",
  description: "",
  expectedBehavior: "",
  stepsToReproduce: "",
  pageUrl: "",
};

const CATEGORY_OPTIONS = [
  ["accounts", "Accounts & search"],
  ["contacts", "Contacts"],
  ["mail", "Mail"],
  ["calendar", "Calendar"],
  ["calls", "Calls & coaching"],
  ["quotes", "Quotes"],
  ["sign_in", "Sign in"],
  ["performance", "Slow or unavailable"],
  ["other", "Something else"],
] as const;

const IMPACT_OPTIONS = [
  ["blocked", "I cannot work"],
  ["major", "Major problem"],
  ["minor", "Minor problem"],
  ["question", "Question"],
] as const;

const STATUS_LABELS: Record<SupportTicketSummary["status"], string> = {
  queued: "Queued",
  investigating: "Investigating",
  repairing: "Repairing & validating",
  waiting_for_employee: "Waiting for confirmation",
  escalated: "Needs human review",
  resolved: "Resolved",
  closed: "Closed",
};

function formatTicketNumber(ticketNumber: number): string {
  return `CRM-${String(ticketNumber).padStart(4, "0")}`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

async function readErrorMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : "Something went wrong. Please try again.";
}

function AttachmentThumbnail({ file }: { file: File }) {
  const [source] = useState<string | null>(() =>
    file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
  );

  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source);
    };
  }, [source]);

  if (!source) {
    return <span className={styles.fileType}>{file.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>;
  }

  return <Image alt="" className={styles.thumbnail} height={52} src={source} unoptimized width={52} />;
}

export function SupportTicketClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTicket, setSuccessTicket] = useState<SupportTicketSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const [sessionResponse, ticketsResponse] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          fetch("/api/support/tickets", { cache: "no-store" }),
        ]);
        if (!sessionResponse.ok) throw new Error(await readErrorMessage(sessionResponse));
        if (!ticketsResponse.ok) throw new Error(await readErrorMessage(ticketsResponse));

        const nextSession = (await sessionResponse.json()) as SessionResponse;
        const ticketPayload = (await ticketsResponse.json()) as SupportTicketListResponse;
        if (!cancelled) {
          setSession(nextSession);
          setTickets(Array.isArray(ticketPayload.items) ? ticketPayload.items : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load CRM support.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addAttachments(files: File[]) {
    setError(null);
    let next = [...attachments];
    let totalBytes = next.reduce((sum, file) => sum + file.size, 0);

    for (const file of files) {
      if (next.length >= SUPPORT_ATTACHMENT_MAX_FILES) {
        setError(`You can add up to ${SUPPORT_ATTACHMENT_MAX_FILES} attachments.`);
        break;
      }
      if (!isAllowedSupportAttachment(file.name, file.type)) {
        setError(`${file.name} is not supported. Add a photo, PDF, text, CSV, or log file.`);
        continue;
      }
      if (file.size > SUPPORT_ATTACHMENT_MAX_FILE_BYTES) {
        setError(`${file.name} is too large. Each file must be 6 MB or less.`);
        continue;
      }
      if (totalBytes + file.size > SUPPORT_ATTACHMENT_MAX_TOTAL_BYTES) {
        setError("Attachments must total 12 MB or less.");
        break;
      }
      next = [...next, file];
      totalBytes += file.size;
    }

    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    addAttachments(Array.from(event.dataTransfer.files));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessTicket(null);
    setIsSubmitting(true);

    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(form)) body.append(key, value);
      for (const attachment of attachments) body.append("attachments", attachment, attachment.name);

      const response = await fetch("/api/support/tickets", { method: "POST", body });
      if (!response.ok) throw new Error(await readErrorMessage(response));

      const payload = (await response.json()) as SupportTicketCreateResponse;
      setSuccessTicket(payload.ticket);
      setTickets((current) => [payload.ticket, ...current.filter((item) => item.id !== payload.ticket.id)]);
      setAttachments([]);
      setForm(EMPTY_FORM);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit the ticket.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppChrome
      title="CRM support"
      subtitle="Report a problem and attach anything that helps us see it."
      userName={session?.user?.name}
    >
      <div className={styles.layout}>
        <section className={styles.formCard}>
          <div className={styles.cardHeading}>
            <h2>Report a CRM issue</h2>
            <p>The support robot will investigate and follow up by email.</p>
          </div>

          {successTicket ? (
            <div className={styles.successMessage} role="status">
              <span className={styles.successIcon}>✓</span>
              <div>
                <strong>{formatTicketNumber(successTicket.ticketNumber)} was submitted</strong>
                <p>
                  Investigation queued{successTicket.attachmentCount > 0
                    ? ` with ${successTicket.attachmentCount} attachment${successTicket.attachmentCount === 1 ? "" : "s"}`
                    : ""}. Updates will be emailed to {successTicket.employeeEmail}.
                </p>
              </div>
            </div>
          ) : null}

          {error ? <div className={styles.errorMessage} role="alert">{error}</div> : null}

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span>CRM area</span>
                <select onChange={(event) => updateField("category", event.target.value)} value={form.category}>
                  {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Impact</span>
                <select onChange={(event) => updateField("impact", event.target.value)} value={form.impact}>
                  {IMPACT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <label className={styles.field}>
              <span>Short summary</span>
              <input maxLength={140} onChange={(event) => updateField("title", event.target.value)} placeholder="Example: Account search stays blank" required value={form.title} />
            </label>

            <label className={styles.field}>
              <span>What happened?</span>
              <textarea maxLength={4000} onChange={(event) => updateField("description", event.target.value)} placeholder="Include the error message and roughly when it happened." required rows={5} value={form.description} />
            </label>

            <section className={styles.attachmentSection} aria-labelledby="attachment-heading">
              <div className={styles.attachmentHeading}>
                <div>
                  <strong id="attachment-heading">Attachments <span>optional</span></strong>
                  <p>Screenshots and photos help the robot see what you saw.</p>
                </div>
                {attachments.length > 0 ? <span>{attachments.length}/{SUPPORT_ATTACHMENT_MAX_FILES}</span> : null}
              </div>
              <label
                className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ""}`}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  accept={SUPPORT_ATTACHMENT_ACCEPT}
                  className={styles.fileInput}
                  multiple
                  onChange={(event) => addAttachments(Array.from(event.target.files ?? []))}
                  ref={fileInputRef}
                  type="file"
                />
                <span className={styles.uploadIcon} aria-hidden="true">＋</span>
                <span><strong>Drop files here</strong> or choose from your device</span>
                <small>Photos, PDF, text, CSV, or logs · 6 MB each</small>
              </label>

              {attachments.length > 0 ? (
                <div className={styles.attachmentList}>
                  {attachments.map((file, index) => (
                    <div className={styles.attachmentItem} key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                      <AttachmentThumbnail file={file} />
                      <div>
                        <strong title={file.name}>{file.name}</strong>
                        <span>{formatSupportAttachmentBytes(file.size)}</span>
                      </div>
                      <button aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">×</button>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className={styles.attachmentPrivacy}>Supported photos may be analyzed as ticket evidence and are included in the support email.</p>
            </section>

            <details className={styles.moreDetails}>
              <summary>Add technical details <span>optional</span></summary>
              <div className={styles.moreDetailsFields}>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>What did you expect?</span>
                    <textarea maxLength={1200} onChange={(event) => updateField("expectedBehavior", event.target.value)} placeholder="What should have happened?" rows={3} value={form.expectedBehavior} />
                  </label>
                  <label className={styles.field}>
                    <span>Steps to reproduce</span>
                    <textarea maxLength={1600} onChange={(event) => updateField("stepsToReproduce", event.target.value)} placeholder={'1. Open Accounts\n2. Search for…'} rows={3} value={form.stepsToReproduce} />
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Page URL</span>
                  <input maxLength={500} onChange={(event) => updateField("pageUrl", event.target.value)} placeholder="https://sales-meadowb.onrender.com/…" type="url" value={form.pageUrl} />
                </label>
              </div>
            </details>

            <div className={styles.submitRow}>
              <p><span aria-hidden="true">◇</span> Diagnostics and reversible actions only. No CRM records are changed.</p>
              <button disabled={isSubmitting} type="submit">
                {isSubmitting ? "Submitting…" : "Submit ticket"}
                {!isSubmitting ? <span aria-hidden="true">→</span> : null}
              </button>
            </div>
          </form>
        </section>

        <aside className={styles.sideColumn}>
          <section className={styles.processCard}>
            <span className={styles.eyebrow}>WHAT HAPPENS NEXT</span>
            <h3>One ticket. One email chain.</h3>
            <p>The robot investigates immediately, replies with what it found, and keeps the ticket open until the employee confirms the result.</p>
            <div className={styles.policyLine}><span aria-hidden="true">✓</span> Safe fixes only; anything else is escalated.</div>
          </section>

          <section className={styles.recentCard}>
            <div className={styles.recentHeading}>
              <div><span className={styles.eyebrow}>RECENT TICKETS</span><h3>Your requests</h3></div>
              <span className={styles.ticketCount}>{tickets.length}</span>
            </div>
            {isLoading ? <p className={styles.emptyState}>Loading tickets…</p> : null}
            {!isLoading && tickets.length === 0 ? <p className={styles.emptyState}>No tickets submitted from this sign-in yet.</p> : null}
            <div className={styles.ticketList}>
              {tickets.slice(0, 5).map((ticket) => (
                <article className={styles.ticketItem} key={ticket.id}>
                  <div className={styles.ticketMeta}>
                    <strong>{formatTicketNumber(ticket.ticketNumber)}</strong>
                    <span className={`${styles.statusPill} ${styles[`status_${ticket.status}`]}`}>{STATUS_LABELS[ticket.status]}</span>
                  </div>
                  <h4>{ticket.title}</h4>
                  <p>{ticket.attachmentCount > 0 ? `↳ ${ticket.attachmentCount} attachment${ticket.attachmentCount === 1 ? "" : "s"} · ` : ""}{ticket.latestUpdate || `Submitted ${formatDate(ticket.createdAt)}`}</p>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </AppChrome>
  );
}
